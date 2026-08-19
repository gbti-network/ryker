#!/usr/bin/env node
// Cut a new Ryker version.
//
// Ryker carries its version in SIX places, and `test/package-check.mjs` fails
// the build when any of them disagree. Bumping by hand means editing five files
// and rebuilding two bundles in the right order, which is exactly the kind of
// job that gets done four-fifths of the way. This does the whole thing.
//
//   package.json                     the npm version
//   bin/ryker.js                     the CLI's --version
//   drop-in/build/bundle.mjs         stamped into both generated bundles
//   drop-in/README.md                "Version X.Y.Z."
//   extension/manifest.json          the store's version, numeric only
//   README.md                        the install prose
//
// The extension manifest takes the NUMERIC version only. npm accepts
// `1.2.3-rc.1`; Chrome does not, and the package gate encodes that difference.
//
//   node tools/release.mjs patch          0.1.1 -> 0.1.2
//   node tools/release.mjs minor          0.1.1 -> 0.2.0
//   node tools/release.mjs major          0.1.1 -> 1.0.0
//   node tools/release.mjs 0.2.0-rc.1     an explicit version
//   node tools/release.mjs patch --no-build   bump the files, skip the rebuild
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KINDS = new Set(['patch', 'minor', 'major']);

/** The next semver for a bump kind. Pure. A prerelease bumps to its own base:
 *  0.1.1-rc.1 patch is 0.1.1, not 0.1.2, because the RC was always aiming at it. */
export function nextVersion(current, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(String(current).trim());
  if (!m) throw new Error(`current version is not X.Y.Z or X.Y.Z-tag: ${current}`);
  let [major, minor, patch] = m.slice(1, 4).map(Number);
  const prerelease = m[4];
  if (kind === 'major') { major += 1; minor = 0; patch = 0; }
  else if (kind === 'minor') { minor += 1; patch = 0; }
  else if (kind === 'patch') { if (!prerelease) patch += 1; }
  else throw new Error(`unknown bump kind: ${kind} (want patch, minor or major)`);
  return `${major}.${minor}.${patch}`;
}

/** Every file that carries the version, with the pattern that finds it. The
 *  third group is the suffix, so a replacement cannot eat neighbouring text. */
export const STAMPS = [
  { file: 'package.json', re: /("version"\s*:\s*")([^"]+)(")/ },
  { file: 'bin/ryker.js', re: /(const VERSION = ')([^']+)(')/ },
  { file: 'drop-in/build/bundle.mjs', re: /(const VERSION = ')([^']+)(')/ },
  { file: 'drop-in/README.md', re: /(Version )(\d[^.]*(?:\.[^.\s]+)*)(\.)/ },
  { file: 'extension/manifest.json', re: /("version"\s*:\s*")([^"]+)(")/, numericOnly: true },
  { file: 'README.md', re: /(This repository is at version `)([^`]+)(`)/ }
];

/** Swap the version inside one blob. Pure, so the substitution is testable. */
export function stamp(text, re, version) {
  const m = re.exec(text);
  if (!m) return { text, found: null };
  return { text: text.replace(re, `$1${version}$3`), found: m[2] };
}

function numeric(version) { return String(version).split('-')[0]; }

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

function main() {
  const argv = process.argv.slice(2);
  const noBuild = argv.includes('--no-build');
  const requested = argv.find((a) => !a.startsWith('--')) || 'patch';

  const pkgPath = join(ROOT, 'package.json');
  const current = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  const next = KINDS.has(requested) ? nextVersion(current, requested) : requested;
  if (!/^\d+\.\d+\.\d+(?:-.+)?$/.test(next)) {
    throw new Error(`refusing an unparseable version: ${next}`);
  }
  if (next === current) {
    throw new Error(`refusing a no-op release: already at ${current}. ` +
      'The store rejects an upload whose version is not strictly greater.');
  }

  console.log(`Ryker ${current} -> ${next}\n`);
  for (const { file, re, numericOnly } of STAMPS) {
    const path = join(ROOT, file);
    const before = readFileSync(path, 'utf8');
    const want = numericOnly ? numeric(next) : next;
    const { text, found } = stamp(before, re, want);
    if (found === null) throw new Error(`no version token found in ${file}`);
    writeFileSync(path, text);
    console.log(`  ${file.padEnd(28)} ${found} -> ${want}`);
  }

  // The root README carries the version in prose rather than a token, so it is
  // reported instead of rewritten. A wrong sentence about the current release
  // is worse than an obviously missing one.
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  if (!readme.includes(next)) {
    console.log(`\n  README.md still describes ${current}. Update the install prose by hand.`);
  }

  if (!noBuild) {
    console.log('\nRebuilding the bundles so the stamp reaches them.');
    run('node', ['drop-in/build/bundle.mjs']);
    run('node', ['test/package-check.mjs']);
    run('node', ['extension/build/package.mjs']);
  }

  console.log(`\nRyker ${next} is staged in the working tree. Remaining steps:
  1. node test/run.mjs                       the full suite
  2. git add -A && git commit                the release commit
  3. git tag -a v${next} -m "Ryker ${next}"  and push both
  4. npm publish                             the drop-in and CLI
  5. npm run publish:extension               the store package, or upload by hand`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (err) { console.error(`release: ${err.message}`); process.exit(1); }
}
