// The gate on the Chrome Web Store artifact.
//
// `test/package-check.mjs` guards the npm boundary. This guards the store one,
// and they fail for different reasons: the store cares about what is inside the
// zip, whether the manifest a reviewer reads matches the code, and whether the
// permission set has quietly grown. A permission added in a refactor is the
// change most likely to cost a review round trip, so it is asserted by name
// rather than by count.
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack, packageFiles, readZipEntries, EXTENSION } from '../extension/build/package.mjs';
import { decidePublish, compareVersions, zipManifestVersion } from '../extension/build/publish.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
function check(ok, message) { if (!ok) problems.push(message); }

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(EXTENSION, 'manifest.json'), 'utf8'));

// ---- the archive ---------------------------------------------------------

const { entries, bytes } = pack();
const names = entries.map((e) => e.name).sort();

check(names.includes('manifest.json'), 'the package has no manifest.json');
check(names.includes('service-worker.js'), 'the package has no service worker');
check(names.includes('ryker.js'), 'the package has no bundle');
check(!names.some((n) => /(^|\/)README\.md$/i.test(n)),
  'the package ships a developer README: ' + names.filter((n) => /README/i.test(n)).join(', '));
check(!names.some((n) => n.startsWith('dist/') || n.startsWith('build/')),
  'the package contains its own build output');

// Every icon the manifest promises has to actually be in the archive. A missing
// icon is accepted at upload and then renders as a blank square in the store.
const iconPaths = new Set([
  ...Object.values(manifest.icons || {}),
  ...Object.values((manifest.action && manifest.action.default_icon) || {})
]);
for (const p of iconPaths) {
  check(names.includes(p), `the manifest names ${p} but the package does not contain it`);
}
check(iconPaths.size > 0, 'the manifest declares no icons');

// Determinism. The publish path builds rather than trusting a committed
// artifact, which is only safe if two builds of one tree agree.
const again = pack();
check(Buffer.compare(readFileSync(again.out), readFileSync(join(EXTENSION, 'dist', 'ryker-chrome.zip'))) === 0,
  'two builds of the same tree produced different archives');

// The archive must read back as what went in.
const roundTrip = readZipEntries(readFileSync(join(EXTENSION, 'dist', 'ryker-chrome.zip')));
check(roundTrip.length === entries.length,
  `the archive reads back ${roundTrip.length} entries, not ${entries.length}`);
for (const entry of entries) {
  const back = roundTrip.find((e) => e.name === entry.name);
  check(back && Buffer.compare(back.data, entry.data) === 0,
    `${entry.name} does not survive a round trip through the archive`);
}

// ---- what a reviewer reads ------------------------------------------------

check(manifest.manifest_version === 3, 'the manifest is not MV3');
check(manifest.version === pkg.version.split('-')[0],
  `manifest version ${manifest.version} differs from the numeric package version ` +
  `${pkg.version.split('-')[0]}`);
check(zipManifestVersion(readFileSync(join(EXTENSION, 'dist', 'ryker-chrome.zip'))) === manifest.version,
  'the archive carries a different version from the working-tree manifest');

// The permission set is the single biggest factor in how a human reviews this,
// and the whole activation design exists to keep it this short. Asserted by
// name so that adding one is a deliberate act with a failing gate attached.
const EXPECTED_PERMISSIONS = ['activeTab', 'scripting'];
check(JSON.stringify((manifest.permissions || []).slice().sort()) ===
  JSON.stringify(EXPECTED_PERMISSIONS.slice().sort()),
`permissions changed to ${JSON.stringify(manifest.permissions)}. If this is deliberate, update
   EXPECTED_PERMISSIONS here AND the justification in .data/ops/extension-ops/chrome-web-store.md,
   because the store asks for one per permission`);
check(!manifest.host_permissions || manifest.host_permissions.length === 0,
  'host permissions were added: every one needs its own written justification');
check(!manifest.content_scripts,
  'a declarative content script was added: Ryker injects on click, which is why it needs no host access');
check(typeof manifest.description === 'string' && manifest.description.length <= 132,
  `the store truncates the description at 132 characters (currently ${(manifest.description || '').length})`);

// Remote code is the most common rejection reason. Ryker has no excuse to
// contain any, so this is asserted over the shipped bytes rather than trusted.
for (const entry of entries) {
  if (!entry.name.endsWith('.js')) continue;
  const text = entry.data.toString('utf8');
  check(!/\beval\s*\(/.test(text), `${entry.name} contains eval()`);
  check(!/new\s+Function\s*\(/.test(text), `${entry.name} contains new Function()`);
  check(!/https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+\/[a-z0-9./-]*\.js\b/i.test(text),
    `${entry.name} references a remote script`);
}

// ---- the publish gate -----------------------------------------------------

check(compareVersions('0.2.0', '0.1.9') === 1, 'compareVersions ranks 0.2.0 below 0.1.9');
check(compareVersions('0.1.1', '0.1.1') === 0, 'compareVersions cannot see equality');
check(decidePublish({ zip: '0.1.1', manifest: '0.1.1', item: '0.1.1' }).ok === false,
  'the publish gate would spend an upload on a version the item already holds');
check(decidePublish({ zip: '0.1.1', manifest: '0.1.2', item: null }).ok === false,
  'the publish gate would upload an archive that disagrees with the manifest');
check(decidePublish({ zip: '0.1.2', manifest: '0.1.2', item: null }).ok === true,
  'the publish gate blocks a release when the item version cannot be read');
check(decidePublish({ zip: '0.1.2', manifest: '0.1.2', item: '0.1.1' }).ok === true,
  'the publish gate blocks a legitimate upgrade');

// ---- report ---------------------------------------------------------------

if (problems.length) {
  console.error('Chrome Web Store package gate failed:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`Ryker ${manifest.version} passed the Chrome Web Store package gate ` +
  `(${entries.length} files, ${(bytes / 1024).toFixed(1)} KB, ` +
  `permissions: ${(manifest.permissions || []).join(' + ')}).`);
