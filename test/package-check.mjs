import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const bundle = readFileSync(new URL('../drop-in/dist/ryker.js', import.meta.url), 'utf8');
const cli = readFileSync(new URL('../bin/ryker.js', import.meta.url), 'utf8');
const license = existsSync(new URL('../LICENSE', import.meta.url))
  ? readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')
  : '';
const problems = [];

if (pkg.private) problems.push('package.json is still private');
if (pkg.name !== '@gbti/ryker') problems.push('unexpected package name');
if (!bundle.includes(`Ryker ${pkg.version}`)) problems.push('bundle version differs from package version');
if (!cli.includes(`const VERSION = '${pkg.version}'`)) problems.push('CLI version differs from package version');
if (!pkg.files || pkg.files.some((entry) => entry.startsWith('.data') || entry.startsWith('.product'))) problems.push('unsafe package files allowlist');
if (!existsSync(new URL('../LICENSE', import.meta.url))) problems.push('LICENSE is missing; add the project license before publishing');
if (pkg.license !== 'SEE LICENSE IN LICENSE') problems.push('package.json must point to the custom LICENSE before publishing');
if (!license.includes('Copyright (c) 2026 GETHSEMANE LLC')) problems.push('LICENSE has the wrong copyright holder');
if (!license.includes('must remain intact')) problems.push('LICENSE must preserve its notice in copies and derivatives');
if (!license.includes('internal teams') || !license.includes('commercial endeavors')) problems.push('LICENSE must permit internal commercial use');
if (!license.includes('client') || !license.includes('are also permitted')) problems.push('LICENSE must permit use with client deliverables');

if (problems.length) {
  console.error('Package release gate failed:');
  problems.forEach((problem) => console.error('  - ' + problem));
  process.exit(1);
}
console.log(`${pkg.name}@${pkg.version} passed the package release gate.`);
