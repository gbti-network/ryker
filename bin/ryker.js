#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.1-rc.1';
const BEGIN = '<!-- ryker:begin -->';
const END = '<!-- ryker:end -->';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shippedBundle = resolve(root, 'drop-in', 'dist', 'ryker.js');

function fail(message) { console.error('Ryker: ' + message); process.exitCode = 1; }
function hash(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
}
function parse(argv) {
  const out = { command: argv[0], target: argv[1], dryRun: false, documentId: null, assetDir: 'ryker' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--document-id') out.documentId = argv[++i];
    else if (argv[i] === '--asset-dir') out.assetDir = argv[++i];
    else throw new Error('Unknown option: ' + argv[i]);
  }
  return out;
}
function usage() {
  console.log(`Ryker ${VERSION}\n\nUsage:\n  ryker insert <file.html> [--dry-run] [--document-id id] [--asset-dir dir]\n  ryker sync <file.html> [--dry-run] [--asset-dir dir]\n  ryker doctor <file.html> [--asset-dir dir]\n  ryker remove <file.html> [--dry-run] [--asset-dir dir]\n  ryker --version`);
}
function targetInfo(options) {
  if (!options.target) throw new Error('Name an HTML file.');
  const cwd = resolve(process.cwd());
  const file = resolve(cwd, options.target);
  const rel = relative(cwd, file);
  if (rel.startsWith('..') || resolve(cwd, rel) !== file) throw new Error('Target must be inside the current working directory.');
  if (!['.html', '.htm'].includes(extname(file).toLowerCase())) throw new Error('Target must be an .html or .htm file.');
  if (!existsSync(file)) throw new Error('Target does not exist: ' + file);
  if (!options.assetDir || resolve(dirname(file), options.assetDir).startsWith(dirname(file)) === false) throw new Error('Asset directory must stay beside or below the target.');
  const asset = resolve(dirname(file), options.assetDir, 'dist', 'ryker.js');
  return { cwd, file, rel, asset, html: readFileSync(file, 'utf8') };
}
function managedRange(html) {
  const start = html.indexOf(BEGIN), end = html.indexOf(END);
  if ((start < 0) !== (end < 0)) throw new Error('Found an incomplete managed Ryker block.');
  if (start < 0) return null;
  if (html.indexOf(BEGIN, start + 1) >= 0 || html.indexOf(END, end + 1) >= 0) throw new Error('Found multiple managed Ryker blocks.');
  return { start, end: end + END.length };
}
function block(info, options, newline) {
  const id = options.documentId || slug(relative(info.cwd, info.file).replace(/\\/g, '/'));
  const src = relative(dirname(info.file), info.asset).replace(/\\/g, '/');
  return [BEGIN, '<script type="application/json" id="ryker-config">', JSON.stringify({ RYKER_DOCUMENT_ID: id, RYKER_DOCUMENT_PATH: relative(info.cwd, info.file).replace(/\\/g, '/') }), '</script>', `<script src="${src}" data-ryker></script>`, END].join(newline);
}
function install(options) {
  const info = targetInfo(options), range = managedRange(info.html);
  if (!range && /<script\b[^>]*\bdata-ryker\b/i.test(info.html)) throw new Error('An unmanaged Ryker insert already exists; refusing to overwrite it.');
  const newline = info.html.includes('\r\n') ? '\r\n' : '\n';
  const insertion = block(info, options, newline);
  let next;
  if (range) next = info.html.slice(0, range.start) + insertion + info.html.slice(range.end);
  else {
    const body = info.html.search(/<\/body\s*>/i);
    if (body < 0) throw new Error('No closing body element was found.');
    next = info.html.slice(0, body) + insertion + newline + info.html.slice(body);
  }
  const packaged = readFileSync(shippedBundle);
  if (existsSync(info.asset) && hash(readFileSync(info.asset)) !== hash(packaged)) throw new Error('The destination Ryker bundle is unrecognized; refusing to overwrite it: ' + info.asset);
  console.log(`${options.dryRun ? 'Would install' : 'Installing'} Ryker ${VERSION}`);
  console.log('  document: ' + info.file);
  console.log('  bundle:   ' + info.asset);
  if (options.dryRun) return;
  const backup = info.file + '.ryker-backup';
  if (!existsSync(backup)) copyFileSync(info.file, backup);
  mkdirSync(dirname(info.asset), { recursive: true });
  copyFileSync(shippedBundle, info.asset);
  writeFileSync(info.file, next, 'utf8');
  console.log('  backup:   ' + backup);
}
function doctor(options) {
  const info = targetInfo(options), range = managedRange(info.html);
  const problems = [];
  if (!range) problems.push('managed insert is missing');
  if (!existsSync(info.asset)) problems.push('bundle is missing: ' + info.asset);
  else if (hash(readFileSync(info.asset)) !== hash(readFileSync(shippedBundle))) problems.push('bundle does not match this package version');
  if (problems.length) { problems.forEach((p) => console.error('FAIL  ' + p)); process.exitCode = 1; }
  else console.log('OK    Ryker ' + VERSION + ' is installed and current in ' + info.file);
}
function remove(options) {
  const info = targetInfo(options), range = managedRange(info.html);
  if (!range) throw new Error('No managed Ryker insert was found.');
  const next = info.html.slice(0, range.start) + info.html.slice(range.end).replace(/^(\r?\n)/, '');
  console.log(`${options.dryRun ? 'Would remove' : 'Removing'} Ryker from ${info.file}`);
  if (options.dryRun) return;
  writeFileSync(info.file, next, 'utf8');
  if (existsSync(info.asset) && hash(readFileSync(info.asset)) === hash(readFileSync(shippedBundle))) rmSync(info.asset);
}

try {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help' || args[0] === '-h') usage();
  else if (args[0] === '--version' || args[0] === '-v') console.log(VERSION);
  else {
    const options = parse(args);
    if (options.command === 'insert' || options.command === 'sync') install(options);
    else if (options.command === 'doctor') doctor(options);
    else if (options.command === 'remove') remove(options);
    else throw new Error('Unknown command: ' + options.command);
  }
} catch (error) { fail(error.message); }
