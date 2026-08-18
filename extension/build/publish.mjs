// Publish the Ryker extension to the Chrome Web Store through the Publish API,
// so a new BUILD ships without the dashboard.
//
// The API pushes the CODE PACKAGE only. The listing (screenshots, promo tiles,
// description, privacy answers) is dashboard-only and stays that way. Do not
// read a successful publish here as "the listing is updated".
//
// INERT until the OAuth credentials exist. A missing credential is a clean skip
// and exit 0, never a hard failure, so a workflow can call this unconditionally.
//
// Credentials, from the environment and never committed:
//   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
//   CWS_APP_ID            the store item id (no default: Ryker has no item yet)
//   CWS_PUBLISH_TARGET    'default' (everyone) or 'trustedTesters'
//
//   node extension/build/publish.mjs --check        verify credentials, upload nothing
//   node extension/build/publish.mjs --upload-only  upload a draft, review it in the dashboard
//   node extension/build/publish.mjs                upload and go live
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack, readZipEntries, DEFAULT_OUT } from './package.mjs';

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const UPLOAD_ONLY = args.has('--upload-only');

/** Semver compare for X.Y.Z. 1 when a > b, -1 when a < b, 0 when equal. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The version inside the archive about to be uploaded. The only version that
 *  is true about the artifact: a working-tree manifest can describe a package
 *  that was never built. */
export function zipManifestVersion(buf) {
  try {
    const entry = readZipEntries(buf).find((e) => e.name === 'manifest.json');
    return entry ? (JSON.parse(entry.data.toString('utf8')).version || null) : null;
  } catch { return null; }
}

/**
 * The whole version decision, pure, so it is testable without a zip, a token or
 * a network.
 *   zip      version inside the package about to be uploaded
 *   manifest version in the working-tree extension/manifest.json, a cross-check
 *   item     version already on the store item, or null when unreadable
 */
export function decidePublish({ zip, manifest, item }) {
  if (zip && manifest && compareVersions(zip, manifest) !== 0) {
    return { ok: false, error:
      `refusing to upload: the package is ${zip} but extension/manifest.json is ${manifest}. ` +
      'The archive is stale relative to the manifest, so a build was skipped. ' +
      'Run `npm run build` then `npm run package:extension` and try again.' };
  }
  // FAIL OPEN when the item version cannot be read. A failed read is not a
  // reason to block a legitimate release; let the upload itself answer.
  if (!zip || !item) {
    return { ok: true, note: 'could not read both versions; proceeding and letting the upload decide.' };
  }
  if (compareVersions(zip, item) <= 0) {
    return { ok: false, error:
      `refusing to upload: the store item already holds ${item} and this package is ${zip}. ` +
      'The store requires a strictly greater version on every upload. ' +
      'Run `npm run release -- patch`, commit, then publish again.' };
  }
  return { ok: true, note: `item holds ${item}, shipping ${zip}.` };
}

async function accessToken({ clientId, clientSecret, refreshToken, fetchImpl }) {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token'
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`OAuth token exchange failed (${res.status}): ` +
      (body.error_description || body.error || 'no access_token'));
  }
  return body.access_token;
}

/** The version on the item, from the DRAFT projection so it reflects an upload
 *  that has not cleared review. Null when the API does not report one. */
async function itemVersion({ appId, token, fetchImpl }) {
  const res = await fetchImpl(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${appId}?projection=DRAFT`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return typeof body.crxVersion === 'string' && body.crxVersion ? body.crxVersion : null;
}

async function uploadPackage({ appId, token, buf, fetchImpl }) {
  const res = await fetchImpl(
    `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${appId}?uploadType=media`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' }, body: buf });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.uploadState === 'FAILURE') {
    const detail = (body.itemError || []).map((e) => e.error_detail).join('; ') ||
      body.error?.message || `status ${res.status}`;
    throw new Error(`Chrome Web Store upload failed: ${detail}`);
  }
  return body;
}

async function publishItem({ appId, token, target, fetchImpl }) {
  const res = await fetchImpl(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${appId}/publish` +
      `?publishTarget=${encodeURIComponent(target)}`,
    { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'x-goog-api-version': '2', 'Content-Length': '0' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Chrome Web Store publish failed (${res.status}): ` +
      (body.error?.message || JSON.stringify(body).slice(0, 200)));
  }
  return body;
}

export async function main({
  env = process.env, fetchImpl = globalThis.fetch,
  checkOnly = CHECK_ONLY, uploadOnly = UPLOAD_ONLY
} = {}) {
  const clientId = (env.CWS_CLIENT_ID || '').trim();
  const clientSecret = (env.CWS_CLIENT_SECRET || '').trim();
  const refreshToken = (env.CWS_REFRESH_TOKEN || '').trim();
  const appId = (env.CWS_APP_ID || '').trim();
  const target = (env.CWS_PUBLISH_TARGET || '').trim() || 'default';

  // Build rather than trust a committed artifact. The archive is deterministic,
  // so this is cheap and removes the whole class of "the zip was stale".
  const { bytes } = pack();
  const buf = readFileSync(DEFAULT_OUT);
  const zip = zipManifestVersion(buf);

  if (!clientId || !clientSecret || !refreshToken) {
    console.log('publish: Chrome Web Store credentials are not set ' +
      '(CWS_CLIENT_ID / CWS_CLIENT_SECRET / CWS_REFRESH_TOKEN); skipping. ' +
      'Upload ' + relative(process.cwd(), DEFAULT_OUT) + ' from the dashboard, or provision the ' +
      'credentials. Setup: .data/ops/extension-ops/chrome-web-store.md');
    return { skipped: true };
  }
  if (!appId) {
    console.log('publish: CWS_APP_ID is not set, so there is no item to upload to. ' +
      'Create the item once in the dashboard, then record its id. ' +
      'Setup: .data/ops/extension-ops/chrome-web-store.md');
    return { skipped: true };
  }

  console.log(`publish: item ${appId}, package ${(bytes / 1024).toFixed(1)} KB, ` +
    `version ${zip}, target ${target}` +
    `${uploadOnly ? ' (upload only)' : ''}${checkOnly ? ' (check only)' : ''}.`);

  const token = await accessToken({ clientId, clientSecret, refreshToken, fetchImpl });
  if (checkOnly) {
    console.log('publish: credentials valid and package built. Nothing uploaded (--check).');
    return { ok: true, checked: true };
  }

  const manifest = JSON.parse(
    readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')).version || null;
  const decision = decidePublish({
    zip, manifest, item: await itemVersion({ appId, token, fetchImpl })
  });
  if (!decision.ok) throw new Error(decision.error);
  if (decision.note) console.log(`publish: ${decision.note}`);

  const up = await uploadPackage({ appId, token, buf, fetchImpl });
  console.log(`publish: uploaded (uploadState=${up.uploadState || 'unknown'}).`);
  if (uploadOnly) {
    console.log('publish: --upload-only, not publishing. Review the draft in the dashboard.');
    return { ok: true, uploaded: true };
  }

  const pub = await publishItem({ appId, token, target, fetchImpl });
  const status = Array.isArray(pub.status) ? pub.status.join(', ') : String(pub.status ?? 'unknown');
  console.log(`publish: publish requested (status=${status}). ` +
    'A code change re-enters review; the listing updates once it clears.');
  return { ok: true, published: true, status };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((r) => { if (r?.skipped) process.exit(0); })
    .catch((err) => { console.error(`publish: ${err.message}`); process.exit(1); });
}
