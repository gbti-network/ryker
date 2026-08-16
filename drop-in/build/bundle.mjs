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

const VERSION = '0.1.0';
const MAX_LINES = 600;

// Two products from one source tree.
//
// ryker is the full editor: revisions, comments, storage backends. ryker-lite
// keeps the shell, the editor and the export path, drops everything durable,
// and adds the instruction pane. The shared modules are byte-identical in both
// bundles; only the load list differs.
const CORE = [
  'utils/dom.js',
  'config/config.js',
  'security/scan.js',
  'editor/sanitize.js',
  'editor/blocks.js',
  'export/zip.js',
  'export/html.js',
  'export/packager.js',
  'ui/styles.js',
  'ui/shell.js',
  'ui/icons.js',
  'ui/tooltip.js',
  'ui/dialog.js',
  'ui/menu.js',
  'editor/editable.js',
  'editor/history.js',
  'editor/formatbar.js',
  'editor/links.js',
  'editor/pick.js',
  'editor/multi.js'
];

const TARGETS = {
  'ryker.js': {
    name: 'Ryker',
    modules: [
      'utils/dom.js',
      'config/config.js',
      'config/identity.js',
      'security/scan.js',
      'editor/sanitize.js',
      'editor/blocks.js',
      'revisions/diff.js',
      'revisions/journal.js',
      'comments/anchor.js',
      'comments/highlight.js',
      'comments/comments.js',
      'storage/adapter.js',
      'storage/local.js',
      'storage/fs.js',
      'storage/github.js',
      'export/zip.js',
      'export/html.js',
      'export/packager.js',
      'ui/styles.js',
      'ui/shell.js',
      'ui/icons.js',
      'ui/tooltip.js',
      'ui/dialog.js',
      'ui/menu.js',
      'ui/panel.js',
      'revisions/review.js',
      'editor/editable.js',
      'editor/history.js',
      'editor/formatbar.js',
      'editor/links.js',
      'editor/pick.js',
      'editor/multi.js',
      'editor/save.js',
      'github/onboard.js',
      'comments/select.js',
      'ui/toolbar.js',
      'bootstrap/boot.js'
    ]
  },
  'ryker-lite.js': {
    name: 'Ryker Lite',
    modules: CORE.concat([
      'editor/outline.js',
      'editor/move.js',
      'ui/rail.js',
      'lite/instructions.js',
      'lite/logger.js',
      'lite/browser.js',
      'lite/pane.js',
      'lite/recover.js',
      'lite/lite.js'
    ])
  }
};

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
  const used = new Set(Object.values(TARGETS).flatMap((t) => t.modules));
  for (const rel of onDisk) {
    if (!used.has(rel)) problems.push(`${rel} exists but no bundle loads it`);
  }
  for (const rel of used) {
    if (!onDisk.includes(rel)) problems.push(`${rel} is in a bundle but not on disk`);
  }
  return problems;
}

const problems = lint();
if (problems.length) {
  console.error('Build failed:');
  problems.forEach((p) => console.error('  - ' + p));
  process.exit(1);
}

mkdirSync(DIST, { recursive: true });

for (const [file, target] of Object.entries(TARGETS)) {
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
    '  var Ryker = { VERSION: ' + JSON.stringify(VERSION) + ', BUILD: ' + JSON.stringify(target.name) + ' };',
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
  writeFileSync(join(DIST, file), out, 'utf8');

  const totalSrc = parts.reduce((n, p) => n + p.lines, 0);
  const biggest = parts.slice().sort((a, b) => b.lines - a.lines)[0];
  console.log(
    `${file}: ${parts.length} modules, ${totalSrc} source lines, ` +
    `${(out.length / 1024).toFixed(1)} KB. Largest: ${biggest.rel} (${biggest.lines} lines, cap ${MAX_LINES}).`
  );
}
