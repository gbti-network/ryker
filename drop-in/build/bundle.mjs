#!/usr/bin/env node
// Bundles src/ into dist/ryker.js as a single classic script.
//
// Classic, not a module. Measured 2026-08-13: <script src> loads from a file://
// page and <script type="module" src> does not, so a module bundle would work
// on a served report and fail silently on the one opened from a ZIP.
//
// The bundler is concatenation on purpose. Each source file assigns onto the
// Ryker namespace rather than importing, which means no build-time dependency,
// nothing to vendor, and output anyone can read.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const EXTENSION = join(ROOT, '..', 'extension');

const VERSION = '0.2.0';
const MAX_LINES = 600;

// One product, one bundle, per sow-006 decision 1.
//
// There were two targets until 2026-08-16: a full build carrying comments, a
// revision journal and storage backends, and a lite build that dropped all of
// it and wrote an instruction set instead. The owner decided the instruction
// set is the product, so the full build is gone and this list is what the lite
// build was. The two-build tree is recoverable at the v0.1.0-two-builds tag.
const MODULES = [
  'utils/dom.js',
  'config/config.js',
  'security/scan.js',
  'editor/sanitize.js',
  'editor/blocks.js',
  'export/zip.js',
  'export/html.js',
  'export/markdown.js',
  'export/target.js',
  'export/packager.js',
  'ui/theme.js',
  'ui/styles.js',
  'ui/shell.js',
  'ui/icons.js',
  'ui/tooltip.js',
  'ui/dialog.js',
  'ui/menu.js',
  'export/dialog.js',
  'editor/editable.js',
  'editor/history.js',
  'editor/formatbar.js',
  'editor/links.js',
  'editor/pick.js',
  'editor/multi.js',
  'editor/table.js',
  'editor/outline.js',
  'editor/move.js',
  'editor/units.js',
  'ui/rail.js',
  'instructions/steps.js',
  'instructions/moves.js',
  'instructions/instructions.js',
  'instructions/merge.js',
  'storage/fs.js',
  'storage/logger.js',
  'instructions/browser.js',
  'ui/pane.js',
  'storage/recover.js',
  'bootstrap/boot.js'
];

const TARGETS = [
  { file: 'ryker.js', dir: DIST, name: 'Ryker', surface: 'drop-in', modules: MODULES },
  { file: 'ryker.js', dir: EXTENSION, name: 'Ryker Extension', surface: 'extension', modules: MODULES }
];

// Modules kept on disk on purpose while no bundle loads them. The set is empty
// today, but the checked exemption mechanism remains for intentional future
// source that is temporarily not shipped.
const UNBUNDLED = new Set();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// The 600 line cap is a hard project constraint, so it is checked here rather
// than left to review. The generated bundle is exempt and names its sources.
function lint() {
  const problems = [];
  const onDisk = walk(SRC).map((p) => relative(SRC, p).split('\\').join('/'));

  for (const rel of onDisk) {
    const text = readFileSync(join(SRC, rel), 'utf8');
    const lines = text.split('\n').length;
    if (lines > MAX_LINES) problems.push(`${rel} is ${lines} lines, over the ${MAX_LINES} cap`);

    // A literal control character in the source is invisible in an editor and
    // harmless in an external script, so it survives review. Inlined into HTML
    // it is fatal: the tokenizer rewrites NUL to U+FFFD in script data, the
    // script becomes a parse error, and it silently never runs. Ryker ships
    // inlined, so this is checked rather than hoped for. Write \u00XX escapes.
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      const bad = c < 0x09 || (c > 0x0D && c < 0x20) || c === 0x7F || c === 0x2028 || c === 0x2029;
      if (bad) {
        const line = text.slice(0, i).split('\n').length;
        problems.push(`${rel}:${line} contains a literal control character (0x${c.toString(16)})`);
        break;
      }
    }

    // Same class of failure, different trigger: these sequences move the HTML
    // tokenizer out of script-data state and swallow the rest of the document.
    for (const seq of ['</script', '<script', '<!--']) {
      if (text.includes(seq)) {
        problems.push(`${rel} contains the literal sequence "${seq}", which breaks an inlined script`);
      }
    }
  }
  const used = new Set(TARGETS.flatMap((t) => t.modules));
  for (const rel of onDisk) {
    if (!used.has(rel) && !UNBUNDLED.has(rel)) problems.push(`${rel} exists but no bundle loads it`);
  }
  for (const rel of used) {
    if (!onDisk.includes(rel)) problems.push(`${rel} is in a bundle but not on disk`);
  }
  // An UNBUNDLED entry that no longer exists means the exemption outlived the
  // file, which is how a stale exemption starts hiding a real orphan.
  for (const rel of UNBUNDLED) {
    if (!onDisk.includes(rel)) problems.push(`${rel} is exempted from bundling but not on disk`);
    if (used.has(rel)) problems.push(`${rel} is exempted from bundling but a bundle loads it`);
  }
  return problems;
}

const problems = lint();
if (problems.length) {
  console.error('Build failed:');
  problems.forEach((p) => console.error('  - ' + p));
  process.exit(1);
}

for (const target of TARGETS) {
  mkdirSync(target.dir, { recursive: true });
  const parts = target.modules.map((rel) => {
    const code = readFileSync(join(SRC, rel), 'utf8');
    return { rel, code, lines: code.split('\n').length };
  });

  const header = [
    '/*!',
    ' * ' + target.name + ' ' + VERSION,
    ' * A drop-in editing layer for authored HTML reports.',
    ' *',
    ' * Generated bundle. Do not edit. Sources, in load order:',
    ...parts.map((p) => ' *   ' + p.rel + '  (' + p.lines + ' lines)'),
    ' *',
    ' * Classic script by design: module scripts do not load from file:// URLs,',
    ' * and a report handed over as a ZIP is opened from disk.',
    ' */'
  ].join('\n');

  const body = [
    '(function () {',
    "  'use strict';",
    '  if (window.Ryker && window.Ryker.VERSION) return;',
    '  var Ryker = { VERSION: ' + JSON.stringify(VERSION) + ', BUILD: ' +
      JSON.stringify(target.name) + ', SURFACE: ' + JSON.stringify(target.surface) + ' };',
    '  window.Ryker = Ryker;',
    '',
    ...parts.map((p) => [
      '  /* ---- ' + p.rel + ' ' + '-'.repeat(Math.max(0, 58 - p.rel.length)) + ' */',
      p.code.split('\n').map((l) => (l ? '  ' + l : l)).join('\n'),
      ''
    ].join('\n')),
    '})();'
  ].join('\n');

  const out = header + '\n' + body + '\n';
  writeFileSync(join(target.dir, target.file), out, 'utf8');

  const totalSrc = parts.reduce((n, p) => n + p.lines, 0);
  const biggest = parts.slice().sort((a, b) => b.lines - a.lines)[0];
  console.log(
    `${target.surface}/${target.file}: ${parts.length} modules, ${totalSrc} source lines, ` +
    `${(out.length / 1024).toFixed(1)} KB. Largest: ${biggest.rel} (${biggest.lines} lines, cap ${MAX_LINES}).`
  );
}
