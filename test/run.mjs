// The Ryker regression suite.
//
// sow-006 Phase 1's guard is "both shipped reports render identically and both
// PDFs keep their page counts". Those reports are not in this repository and
// should not be: a product repo whose only regression check is two WooCommerce
// reports in a Desktop folder is coupled to the thing it was extracted from.
// This fixture replaces them, and the central assertion is stricter than a page
// count. A clean export of the document with Ryker booted inside it must be
// character-for-character the document as it was before Ryker loaded.
//
// The bundle is injected after load rather than carried by a <script> tag in
// the fixture, because that is how the sow-007 extension will inject it, and
// because it gives an exact pristine capture to compare against.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, navigate, evaluate, waitInPage } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'drop-in', 'dist');
const FIXTURE = 'file://' + resolve(join(HERE, 'fixtures', 'report.html'));

// Counted by hand against the fixture's comments, then confirmed by the first
// run. Asserted alongside the named inclusions and exclusions below, so a
// change to excluded() cannot pass by restoring the total through another route.
const EXPECTED_EDITABLE = 17;

const MUST_BE_EDITABLE = [
  'Fixture Report',                        // h1 in a header INSIDE main
  'The subtitle that sits in the title block.',
  'List item alpha',
  '22',                                    // sibling of a data-effort cell
  'The caption underneath the chart.',
  'A quoted paragraph inside a blockquote.',
  'The definition of term one.'
];

const MUST_NOT_BE_EDITABLE = [
  'Site chrome above the document. Not part of the report.',  // header outside main
  'Contents link one',                                        // nav
  'Sorted on effort',                                         // data-effort
  'chart label',                                              // inside svg
  'Generated on a fixed date. Do not edit.',                  // data-ryker-lock
  'Footer text below the document.'                           // footer
];

let failures = 0;
let checks = 0;

function ok(name) { checks++; console.log(`  PASS  ${name}`); }
function bad(name, detail) {
  checks++; failures++;
  console.log(`  FAIL  ${name}`);
  if (detail) console.log(String(detail).split('\n').map((l) => '        ' + l).join('\n'));
}
function assert(cond, name, detail) { cond ? ok(name) : bad(name, detail); }

function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return `diverges at character ${i}:\n` +
             `  pristine: ...${JSON.stringify(a.slice(Math.max(0, i - 60), i + 60))}\n` +
             `  exported: ...${JSON.stringify(b.slice(Math.max(0, i - 60), i + 60))}`;
    }
  }
  return `identical for ${n} characters, then lengths differ: pristine ${a.length}, exported ${b.length}\n` +
         `  tail: ${JSON.stringify((a.length > b.length ? a : b).slice(n, n + 160))}`;
}

async function runBuild(sess, file) {
  console.log(`\n${file}`);
  const code = readFileSync(join(DIST, file), 'utf8');

  await navigate(sess, FIXTURE);

  // Captured before a single line of Ryker has run. This is the baseline the
  // clean export has to reproduce exactly.
  const pristine = await evaluate(sess,
    `'<!DOCTYPE html>\\n' + document.documentElement.outerHTML`);

  await evaluate(sess, code);
  await waitInPage(sess,
    `!!(window.Ryker && window.Ryker.VERSION && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot and mount');

  const info = await evaluate(sess, `({
    version: Ryker.VERSION,
    build: Ryker.BUILD,
    hasShadow: !!document.getElementById('ryker-root').shadowRoot,
    docCss: !!document.getElementById('ryker-document-css')
  })`);

  assert(info.hasShadow, `boots and mounts a shadow root (${info.build} ${info.version})`);

  // --- what is editable -----------------------------------------------------

  const texts = await evaluate(sess,
    `Ryker.blocks.all().map(function (b) { return (b.node.textContent || '').trim(); })`);

  assert(texts.length === EXPECTED_EDITABLE,
    `editable block count is ${EXPECTED_EDITABLE}`,
    texts.length === EXPECTED_EDITABLE ? null
      : `got ${texts.length}:\n` + texts.map((t, i) => `${i + 1}. ${JSON.stringify(t)}`).join('\n'));

  const missing = MUST_BE_EDITABLE.filter((t) => !texts.includes(t));
  assert(missing.length === 0, 'every block that should be editable is',
    missing.length ? 'not found in the editable set: ' + JSON.stringify(missing) : null);

  const leaked = MUST_NOT_BE_EDITABLE.filter((t) => texts.includes(t));
  assert(leaked.length === 0, 'no excluded element leaked into the editable set',
    leaked.length ? 'wrongly editable: ' + JSON.stringify(leaked) : null);

  // --- the central assertion ------------------------------------------------

  const exported = await evaluate(sess, `Ryker.exportHtml.clean()`);

  assert(exported === pristine,
    'clean export is character-identical to the document before Ryker loaded',
    exported === pristine ? null : firstDifference(pristine, exported));

  // Named separately so a failure says which residue survived rather than only
  // that two long strings differ. sow-004 records the stylesheet leak shipping.
  for (const [needle, what] of [
    ['ryker-root', 'chrome element'],
    ['ryker-document-css', 'document stylesheet'],
    ['contenteditable', 'contenteditable attribute'],
    ['data-ryker-id', 'block id stamp'],
    ['--ryker-offset', 'root offset property']
  ]) {
    assert(!exported.includes(needle), `clean export carries no ${what}`);
  }

  // --- an edit becomes exactly one instruction ------------------------------

  // Capability, not name. This was a name test until the decommission renamed
  // the only surviving build from "Ryker Lite" to "Ryker", which would have
  // silently skipped these three checks at exactly the moment they mattered.
  const hasInstructions = await evaluate(sess,
    `!!(window.Ryker && Ryker.instructions && Ryker.pane)`);

  if (hasInstructions) {
    const before = MUST_BE_EDITABLE[2]; // 'List item alpha'
    const result = await evaluate(sess, `(function () {
      var hit = Ryker.blocks.all().filter(function (b) {
        return (b.node.textContent || '').trim() === ${JSON.stringify(before)};
      })[0];
      if (!hit) return { error: 'fixture block not found' };
      hit.node.textContent = 'List item alpha, edited';
      Ryker.editable.touch();
      if (!Ryker.editable.isDirty()) return { error: 'edit did not mark the document dirty' };
      Ryker.lite.save();
      return {
        edits: Ryker.instructions.edits().length,
        pane: Ryker.pane.value()
      };
    })()`);

    if (result.error) {
      bad('an edit becomes exactly one instruction', result.error);
    } else {
      assert(result.edits === 1, 'an edit becomes exactly one instruction',
        result.edits === 1 ? null : `got ${result.edits}`);
      assert(result.pane.includes(before),
        'the instruction quotes the block as it was authored',
        result.pane.includes(before) ? null : 'FROM text not present in the pane');
      assert(result.pane.includes('List item alpha, edited'),
        'the instruction carries the edited text');
    }
  }
}


// Spec section 42: "Ryker must not be able to destroy the report merely because
// a module fails." The guard() wrapper that implements this went with
// bootstrap/boot.js in the decommission and was restored into lite.js, so it is
// asserted rather than assumed. One initialiser is poisoned in the injected
// bundle and Ryker still has to mount, stay usable and name the failure.
async function runFailureIsolation(sess, file) {
  console.log(`\n${file} (failure isolation, spec section 42)`);
  const code = readFileSync(join(DIST, file), 'utf8');

  const NEEDLE = 'Ryker.tooltip.init();';
  if (!code.includes(NEEDLE)) {
    bad('the poison target still exists in the bundle',
      `${NEEDLE} not found. If an initialiser was renamed, update this test rather than deleting it.`);
    return;
  }
  const poisoned = code.replace(NEEDLE, `(function () { throw new Error('poisoned by the test suite'); })();`);

  await navigate(sess, FIXTURE);
  const pristine = await evaluate(sess,
    `'<!DOCTYPE html>\\n' + document.documentElement.outerHTML`);
  await evaluate(sess, poisoned);
  await waitInPage(sess,
    `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to mount despite a failing initialiser');

  const state = await evaluate(sess, `({
    mounted: !!document.getElementById('ryker-root'),
    problems: Ryker.lite.problems(),
    editable: Ryker.blocks.all().length,
    exported: Ryker.exportHtml.clean()
  })`);

  assert(state.mounted, 'a failing initialiser does not stop Ryker mounting');
  assert(state.problems.some((p) => /poisoned by the test suite/.test(p)),
    'the failure is recorded rather than swallowed',
    'problems: ' + JSON.stringify(state.problems));
  assert(state.editable === EXPECTED_EDITABLE,
    'the document is still fully editable after a module fails',
    state.editable === EXPECTED_EDITABLE ? null : `got ${state.editable}`);
  assert(state.exported === pristine,
    'the document still exports clean after a module fails',
    state.exported === pristine ? null : firstDifference(pristine, state.exported));
}

const bundles = ['ryker.js', 'ryker-lite.js'].filter((f) => existsSync(join(DIST, f)));
if (!bundles.length) {
  console.error('No bundle found in drop-in/dist. Run: node drop-in/build/bundle.mjs');
  process.exit(1);
}

const sess = await launch();
try {
  for (const file of bundles) { await runBuild(sess, file); await runFailureIsolation(sess, file); }
} finally {
  await sess.close();
}

console.log(`\n${checks - failures}/${checks} checks passed across ${bundles.length} bundle(s).`);
process.exit(failures ? 1 : 0);
