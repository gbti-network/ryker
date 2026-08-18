#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.1';
const BEGIN = '<!-- ryker:begin -->';
const END = '<!-- ryker:end -->';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shippedBundle = resolve(root, 'drop-in', 'dist', 'ryker.js');

function fail(message) { console.error('Ryker: ' + message); process.exitCode = 1; }
function hash(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
}
function optionValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(name + ' requires a value.');
  return value;
}
function parse(argv) {
  const out = { command: argv[0], target: argv[1], dryRun: false, documentId: null, assetDir: 'ryker' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--document-id') { out.documentId = optionValue(argv, i, '--document-id'); i++; }
    else if (argv[i] === '--asset-dir') { out.assetDir = optionValue(argv, i, '--asset-dir'); i++; }
    else throw new Error('Unknown option: ' + argv[i]);
  }
  return out;
}
function usage() {
  console.log(`Ryker ${VERSION}\n\nUsage:\n  ryker insert <file.html> [--dry-run] [--document-id id] [--asset-dir dir]\n  ryker sync <file.html> [--dry-run] [--document-id id] [--asset-dir dir]\n  ryker doctor <file.html> [--asset-dir dir]\n  ryker remove <file.html> [--dry-run] [--asset-dir dir]\n  ryker --version`);
}
function contained(base, target) {
  const rel = relative(base, target);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}
function physical(path) {
  let cursor = path;
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(basename(cursor));
    cursor = parent;
  }
  return resolve(realpathSync(cursor), ...suffix);
}
function targetInfo(options) {
  if (!options.target) throw new Error('Name an HTML file.');
  const requestedCwd = resolve(process.cwd());
  const requestedFile = resolve(requestedCwd, options.target);
  if (!contained(requestedCwd, requestedFile)) throw new Error('Target must be inside the current working directory.');
  if (!['.html', '.htm'].includes(extname(requestedFile).toLowerCase())) throw new Error('Target must be an .html or .htm file.');
  if (!existsSync(requestedFile)) throw new Error('Target does not exist: ' + requestedFile);
  const cwd = realpathSync(requestedCwd);
  const file = realpathSync(requestedFile);
  const rel = relative(cwd, file);
  if (!contained(cwd, file)) throw new Error('Target must be inside the current working directory.');
  const assetRoot = options.assetDir ? physical(resolve(dirname(file), options.assetDir)) : null;
  if (!assetRoot || !contained(dirname(file), assetRoot)) throw new Error('Asset directory must stay beside or below the target.');
  const asset = resolve(assetRoot, 'dist', 'ryker.js');
  return { cwd, file, rel, asset, html: readFileSync(file, 'utf8') };
}
function managedRange(html) {
  const start = html.indexOf(BEGIN), end = html.indexOf(END);
  if ((start < 0) !== (end < 0)) throw new Error('Found an incomplete managed Ryker block.');
  if (start < 0) return null;
  if (end < start) throw new Error('Found Ryker managed markers in the wrong order.');
  if (html.indexOf(BEGIN, start + 1) >= 0 || html.indexOf(END, end + 1) >= 0) throw new Error('Found multiple managed Ryker blocks.');
  return { start, end: end + END.length };
}
function tagEnd(html, start) {
  let quote = null;
  for (let i = start + 1; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i;
  }
  return html.length - 1;
}
function opaqueRanges(html) {
  const ranges = [];
  for (let i = 0; i < html.length;) {
    if (html.startsWith(BEGIN, i) || html.startsWith(END, i)) {
      i += html.startsWith(BEGIN, i) ? BEGIN.length : END.length;
      continue;
    }
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      ranges.push([i, end < 0 ? html.length : end + 3]);
      i = ranges[ranges.length - 1][1];
      continue;
    }
    if (html[i] !== '<') { i++; continue; }
    const end = tagEnd(html, i);
    const tag = /^<\s*(script|style|template|pre|textarea)\b/i.exec(html.slice(i, end + 1));
    if (!tag) { i = end + 1; continue; }
    const close = new RegExp('<\\/\\s*' + tag[1] + '\\s*>', 'ig');
    close.lastIndex = end + 1;
    const match = close.exec(html);
    const stop = match ? match.index + match[0].length : html.length;
    ranges.push([i, stop]);
    i = stop;
  }
  return ranges;
}
function covered(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}
function bodyClose(html, ranges = opaqueRanges(html)) {
  const close = /<\/body\s*>/ig;
  let found = -1;
  for (let match; (match = close.exec(html));) {
    if (!covered(match.index, ranges)) found = match.index;
  }
  if (found < 0) throw new Error('No top-level closing body element was found.');
  return found;
}
function managedAtTopLevel(html, range) {
  const ranges = opaqueRanges(html);
  if (covered(range.start, ranges) || covered(range.end, ranges)) return false;
  const body = bodyClose(html, ranges);
  return range.start < body && html.slice(range.end, body).trim() === '';
}
function managedDocumentId(html, range) {
  const managed = html.slice(range.start, range.end);
  const config = /<script\b[^>]*\sid=["']ryker-config["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(managed);
  if (!config) throw new Error('The managed Ryker block has no readable config element.');
  try {
    const parsed = JSON.parse(config[1]);
    if (!parsed.RYKER_DOCUMENT_ID) throw new Error('missing document id');
    return parsed.RYKER_DOCUMENT_ID;
  } catch (error) {
    throw new Error('The managed Ryker block has invalid configuration: ' + error.message);
  }
}
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
function attribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function block(info, options, newline) {
  const id = options.documentId || slug(relative(info.cwd, info.file).replace(/\\/g, '/'));
  const src = relative(dirname(info.file), info.asset).replace(/\\/g, '/');
  return [BEGIN, '<script type="application/json" id="ryker-config">', scriptJson({ RYKER_DOCUMENT_ID: id, RYKER_DOCUMENT_PATH: relative(info.cwd, info.file).replace(/\\/g, '/') }), '</script>', `<script src="${attribute(src)}" data-ryker></script>`, END].join(newline);
}
function install(options) {
  const info = targetInfo(options), range = managedRange(info.html);
  if (!range && /<script\b[^>]*\bdata-ryker\b/i.test(info.html)) throw new Error('An unmanaged Ryker insert already exists; refusing to overwrite it.');
  if (range && !managedAtTopLevel(info.html, range)) throw new Error('The managed Ryker block is not directly inside the document body.');
  if (range && !options.documentId) options.documentId = managedDocumentId(info.html, range);
  const newline = info.html.includes('\r\n') ? '\r\n' : '\n';
  const insertion = block(info, options, newline);
  let next;
  if (range) next = info.html.slice(0, range.start) + insertion + info.html.slice(range.end);
  else {
    const body = bodyClose(info.html);
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
  else {
    try {
      if (!managedAtTopLevel(info.html, range)) problems.push('managed insert is not directly inside the document body');
      managedDocumentId(info.html, range);
    } catch (error) { problems.push(error.message); }
  }
  if (!existsSync(info.asset)) problems.push('bundle is missing: ' + info.asset);
  else if (hash(readFileSync(info.asset)) !== hash(readFileSync(shippedBundle))) problems.push('bundle does not match this package version');
  if (problems.length) { problems.forEach((p) => console.error('FAIL  ' + p)); process.exitCode = 1; }
  else console.log('OK    Ryker ' + VERSION + ' is installed and current in ' + info.file);
}
function remove(options) {
  const info = targetInfo(options), range = managedRange(info.html);
  if (!range) throw new Error('No managed Ryker insert was found.');
  if (!managedAtTopLevel(info.html, range)) throw new Error('The managed Ryker block is not directly inside the document body.');
  managedDocumentId(info.html, range);
  const next = info.html.slice(0, range.start) + info.html.slice(range.end).replace(/^(\r?\n)/, '');
  console.log(`${options.dryRun ? 'Would remove' : 'Removing'} Ryker from ${info.file}`);
  if (options.dryRun) return;
  writeFileSync(info.file, next, 'utf8');
  if (existsSync(info.asset)) console.log('  bundle:   retained because another document may share it');
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
