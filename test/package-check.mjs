import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const bundle = readFileSync(new URL('../drop-in/dist/ryker.js', import.meta.url), 'utf8');
const cli = readFileSync(new URL('../bin/ryker.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const extensionReadme = readFileSync(new URL('../extension/README.md', import.meta.url), 'utf8');
const dropInReadme = readFileSync(new URL('../drop-in/README.md', import.meta.url), 'utf8');
const rootReadme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const license = existsSync(new URL('../LICENSE', import.meta.url))
  ? readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')
  : '';
const problems = [];

if (pkg.private) problems.push('package.json is still private');
if (pkg.name !== '@gbti/ryker') problems.push('unexpected package name');
if (!bundle.includes(`Ryker ${pkg.version}`)) problems.push('bundle version differs from package version');
if (!cli.includes(`const VERSION = '${pkg.version}'`)) problems.push('CLI version differs from package version');
if (manifest.version !== pkg.version.split('-')[0]) problems.push('extension manifest version differs from the numeric package version');
if (/saving changes directly/i.test(manifest.description) || /saved directly to the loaded asset/i.test(extensionReadme)) {
  problems.push('extension copy promises direct write-back that the product does not provide');
}
if (extensionReadme.includes('\u2014')) problems.push('extension README violates the no-em-dash writing convention');
if (!dropInReadme.includes(`Version ${pkg.version}.`)) problems.push('drop-in README version differs from package version');
if (!rootReadme.includes(`This repository is at version \`${pkg.version}\``)) problems.push('root README version differs from package version');
const prepublish = pkg.scripts.prepublishOnly || '';
const prepublishBuild = prepublish.indexOf('npm run build');
const prepublishTest = prepublish.indexOf('npm test');
if (prepublishBuild < 0 || prepublishTest < 0 || prepublishBuild > prepublishTest) {
  problems.push('prepublishOnly must build before running the browser suite');
}
if (pkg.scripts.sync) problems.push('private repository sync commands must not ship in package.json');
if (!pkg.files || pkg.files.some((entry) => entry.startsWith('.data') || entry.startsWith('.product'))) problems.push('unsafe package files allowlist');
if (!existsSync(new URL('../LICENSE', import.meta.url))) problems.push('LICENSE is missing; add the project license before publishing');
if (pkg.license !== 'SEE LICENSE IN LICENSE') problems.push('package.json must point to the custom LICENSE before publishing');
if (!license.includes('Copyright (c) 2026 GETHSEMANE LLC')) problems.push('LICENSE has the wrong copyright holder');
if (!license.includes('must remain intact')) problems.push('LICENSE must preserve its notice in copies and derivatives');
if (!license.includes('internal teams') || !license.includes('commercial endeavors')) problems.push('LICENSE must permit internal commercial use');
if (!license.includes('client') || !license.includes('are also permitted')) problems.push('LICENSE must permit use with client deliverables');

// The shipped icons against the brand library they are supposed to be a copy
// of. This is the check whose absence let the extension ship the OLD wing for a
// full day after the icon was replaced: build-icons.mjs writes into the tree
// named by RYKER_ROOT, every run that day pointed it at a release worktree, and
// nothing anywhere compared what the manifest reads against what the brand
// library holds. Every gate stayed green because none of them looked.
//
// SKIPPED when the brand library is absent, which is the normal case in CI:
// .product/ is a local working directory and is never committed. So this
// catches the mismatch on the machine that creates it, which is the only
// machine that can. A check that cannot run everywhere still earns its place
// when it runs where the mistake is made.
const brandIcons = new URL('../.product/brand/ryker/icons/chrome/', import.meta.url);
if (existsSync(brandIcons)) {
  for (const size of [16, 32, 48, 128]) {
    const shipped = new URL(`../extension/icons/ryker-${size}.png`, import.meta.url);
    const master = new URL(`ryker-${size}.png`, brandIcons);
    if (!existsSync(shipped)) {
      problems.push(`extension/icons/ryker-${size}.png is missing`);
    } else if (!readFileSync(shipped).equals(readFileSync(master))) {
      problems.push(
        `extension/icons/ryker-${size}.png differs from the brand library. ` +
        'Run `node .product/brand/ryker/build-icons.mjs` with RYKER_ROOT unset, ' +
        'then rebuild the bundles: BRAND_MARK is stale too.');
    }
  }
}

if (problems.length) {
  console.error('Package release gate failed:');
  problems.forEach((problem) => console.error('  - ' + problem));
  process.exit(1);
}
console.log(`${pkg.name}@${pkg.version} passed the package release gate.`);
