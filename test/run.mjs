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
import * as RECORDS from './fixtures/records.mjs';

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
  // the only surviving build from "Ryker Lite" to plain "Ryker", which would
  // have silently skipped these three checks at the moment they mattered most.
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
      Ryker.boot.save();
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
// a module fails."
//
// Two targets, and the second is the one that matters. Poisoning the tooltip
// proves almost nothing, because nothing after it depends on it. Poisoning a
// call inside build() takes out the toolbar, and the tail of start() then has to
// make the document editable anyway. That case was broken when this test was
// first written and the test passed regardless, because it poisoned the easy
// target and then asserted Ryker.blocks.all().length, which counts DOM
// candidates whether or not editing was ever switched on. Both halves are fixed:
// a target with real dependents, and an assertion that reads editing state.
const POISON_TARGETS = [
  { needle: 'Ryker.tooltip.init();', what: 'a leaf initialiser' },
  { needle: 'Ryker.rail.onToggle(sync);', what: 'a call inside build(), taking the toolbar with it' }
];

async function runFailureIsolation(sess, file) {
  const code = readFileSync(join(DIST, file), 'utf8');

  for (const target of POISON_TARGETS) {
    console.log(`\n${file} (failure isolation, poisoning ${target.what})`);

    const hits = code.split(target.needle).length - 1;
    if (hits !== 1) {
      bad(`the poison target "${target.needle}" appears exactly once`,
        `found ${hits} occurrence(s). If a call was renamed or duplicated, update this ` +
        `test rather than deleting it: the target has to be load-bearing to prove anything.`);
      continue;
    }
    const poisoned = code.replace(target.needle,
      `(function () { throw new Error('poisoned by the test suite'); })();`);

    await navigate(sess, FIXTURE);
    const pristine = await evaluate(sess,
      `'<!DOCTYPE html>\\n' + document.documentElement.outerHTML`);
    await evaluate(sess, poisoned);
    await waitInPage(sess,
      `!!(window.Ryker && document.getElementById('ryker-root'))`,
      10000, 'Ryker to mount despite a failing initialiser');

    const state = await evaluate(sess, `({
      mounted: !!document.getElementById('ryker-root'),
      problems: Ryker.boot.problems(),
      editingOn: Ryker.editable.isOn(),
      contenteditable: document.querySelectorAll('[contenteditable="true"]').length,
      exported: Ryker.exportHtml.clean()
    })`);

    assert(state.mounted, 'Ryker still mounts');
    assert(state.problems.some((p) => /poisoned by the test suite/.test(p)),
      'the failure is recorded rather than swallowed',
      'problems: ' + JSON.stringify(state.problems));

    // The assertion that was missing. Editing is the capability worth
    // protecting, and it must survive a failure in anything cosmetic.
    assert(state.editingOn, 'edit mode is still switched on');
    assert(state.contenteditable === EXPECTED_EDITABLE,
      `all ${EXPECTED_EDITABLE} blocks are still editable`,
      state.contenteditable === EXPECTED_EDITABLE ? null
        : `got ${state.contenteditable} contenteditable blocks`);

    assert(state.exported === pristine,
      'the document still exports clean',
      state.exported === pristine ? null : firstDifference(pristine, state.exported));
  }
}

// The Package dialog, driven for real.
//
// Every check here exists because an audit found the defect by opening the
// dialog in a browser, which no amount of reading the source had surfaced. The
// dialog is reachable from the toolbar's More menu and is one of five actions
// in the shipped product, so it is worth driving rather than reasoning about.
async function runPackager(sess, file) {
  console.log(`\n${file} (package dialog)`);
  const code = readFileSync(join(DIST, file), 'utf8');

  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot');

  const seen = await evaluate(sess, `(function () {
    Ryker.packager.open();
    var sr = document.getElementById('ryker-root').shadowRoot;
    var note = sr.querySelector('.note');
    return {
      note: note ? note.textContent.trim() : null,
      buttons: Array.prototype.map.call(sr.querySelectorAll('.modal button, .foot button'),
        function (b) { return b.textContent.trim(); }),
      manifestKeyKept: 'RYKER_PACKAGE_MANIFEST' in Ryker.config.load()
    };
  })()`);

  assert(seen.note !== null, 'the package dialog opens and carries a note',
    seen.note === null ? 'no .note found in the shadow root' : null);

  // The defect: the note told people to use "Choose report folder", a button
  // that fsBackend() returning null means is never built and is filtered out of
  // the button list before render.
  const promisesFolderButton = /choose the report folder/i.test(seen.note || '');
  const hasFolderButton = seen.buttons.some((b) => /choose report folder/i.test(b));
  assert(promisesFolderButton === hasFolderButton,
    'the note only names the folder button when that button is actually rendered',
    promisesFolderButton === hasFolderButton ? null
      : `note promises it: ${promisesFolderButton}, buttons: ${JSON.stringify(seen.buttons)}`);

  // config.load() copies only keys present in DEFAULTS, so a key the packager
  // reads but config does not declare is stripped before the packager sees it.
  assert(seen.manifestKeyKept,
    'RYKER_PACKAGE_MANIFEST survives config intake',
    seen.manifestKeyKept ? null
      : 'the packager reads this key at packager.js:37 but config.js drops it, so ' +
        'manifestAssets() can never return a row');

  // .acts was styled only as '.card .acts', and .card was a comment card. When
  // comments were decommissioned the qualifier stopped matching and both
  // surviving .acts rows silently lost their layout. Nothing threw and nothing
  // looked obviously wrong in the source; the buttons simply ran together.
  const actsDisplay = await evaluate(sess, `(function () {
    var layer = document.getElementById('ryker-root').shadowRoot.querySelector('.layer');
    var probe = document.createElement('div');
    probe.className = 'acts';
    layer.appendChild(probe);
    var d = getComputedStyle(probe).display;
    probe.remove();
    return d;
  })()`);
  assert(actsDisplay === 'flex', 'button rows (.acts) still get flex layout',
    actsDisplay === 'flex' ? null
      : `computed display is "${actsDisplay}", so the rule is not matching`);

  // Spec section 21. exportHtml.clean() worked throughout, and this suite
  // proved it worked, while no user could invoke it: the menu that reached it
  // was deleted with the full build. A capability with no route to it is
  // exactly what a unit-level test cannot see, so this drives the menu.
  const exportUi = await evaluate(sess, `(function () {
    var sr = document.getElementById('ryker-root').shadowRoot;
    // Open the More menu the way a person does, then read its item labels.
    var more = sr.querySelector('[aria-haspopup="menu"]');
    if (!more) return { error: 'no More button in the toolbar' };
    more.click();
    var labels = Array.prototype.map.call(sr.querySelectorAll('[role="menuitem"], .menu button'),
      function (b) { return b.textContent.trim(); });
    return { labels: labels };
  })()`);

  if (exportUi.error) {
    bad('the export menu is reachable from the toolbar', exportUi.error);
  } else {
    const hasExport = exportUi.labels.some((l) => /^export report/i.test(l));
    assert(hasExport, 'the export menu is reachable from the toolbar',
      hasExport ? null : `More menu offers: ${JSON.stringify(exportUi.labels)}`);
  }
}

// Folding many saved records into one instruction set.
//
// The hard case is not deduplication. Records from one page load share a
// baseline and are cumulative supersets, so the last supersedes the rest.
// Records from different loads quote different starting text and have to be
// composed. The fixtures reproduce the shape of the real corpus, including
// saveNumber restarting and a session with no baselineId at all.
async function runMerge(sess, file) {
  console.log(`\n${file} (merge)`);
  const code = readFileSync(join(DIST, file), 'utf8');

  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && Ryker.merge)`, 10000, 'the merge module');

  const call = async (records) => evaluate(sess,
    `JSON.parse(JSON.stringify(Ryker.merge.fold(${JSON.stringify(records)})))`);

  // 1. Same baseline: keep the last, drop the rest, change nothing else.
  const a = await call(RECORDS.SESSION_A);
  assert(a.superseded === 2, 'records sharing a baseline collapse to the latest',
    a.superseded === 2 ? null : `superseded ${a.superseded}, expected 2`);
  assert(a.steps.length === 3, 'the surviving record keeps all of its own steps',
    a.steps.length === 3 ? null : `got ${a.steps.length}`);

  // 2. Composition. Session B edits session A's output, and C edits B's, so the
  //    first line should read as one step from the ORIGINAL text to the final
  //    text rather than as three separate rewrites.
  const chained = await call([].concat(RECORDS.SESSION_A, RECORDS.SESSION_B, RECORDS.SESSION_C));
  const firstLine = chained.steps.filter((s) => /first line/.test(s.before || ''));
  assert(firstLine.length === 1,
    'three sessions editing one paragraph compose into a single step',
    firstLine.length === 1 ? null
      : 'got ' + JSON.stringify(firstLine.map((s) => `${s.before} -> ${s.after}`), null, 1));
  if (firstLine.length === 1) {
    assert(firstLine[0].before === 'The original first line.' &&
           firstLine[0].after === 'The final first line.',
      'the composed step runs from the original text to the final text',
      `got "${firstLine[0].before}" -> "${firstLine[0].after}"`);
  }

  // 3. A conflict is refused, not guessed. Session D rewrites the ORIGINAL
  //    first line to something incompatible with what A already did to it.
  const conflict = await call([].concat(RECORDS.SESSION_A, RECORDS.SESSION_D));
  assert(conflict.refused.length === 1,
    'an unfoldable change is reported rather than dropped or guessed',
    conflict.refused.length === 1 ? null : `refused ${conflict.refused.length}, expected 1`);
  const lost = JSON.stringify(conflict.steps).includes('A completely different first line');
  assert(!lost || conflict.refused.length > 0,
    'nothing is silently discarded when a fold fails');

  // 4. The refusal to deduplicate identical inserts survives the fold. This is
  //    a rule instructions.js applies within one record and it is no more
  //    knowable across records than within one.
  const dupes = await call(RECORDS.SESSION_E);
  assert(dupes.steps.length === 2,
    'identical inserts are kept, not tidied away',
    dupes.steps.length === 2 ? null : `got ${dupes.steps.length} steps`);
  assert(dupes.warnings.some((w) => /identical content/i.test(w)),
    'identical inserts are reported as a suggestion',
    'warnings: ' + JSON.stringify(dupes.warnings));

  // 5. A record with no baselineId, which is every record written before
  //    2026-08-16, still folds by matching content.
  const legacy = await call([].concat(RECORDS.SESSION_B, RECORDS.SESSION_C));
  assert(legacy.inferred === true,
    'a record with no baseline is folded but flagged as inferred',
    `inferred was ${legacy.inferred}`);
  assert(legacy.warnings.some((w) => /predate baseline tracking/i.test(w)),
    'the inferred grouping says so rather than presenting itself as certain');

  // 6. Conservation. The one property that matters more than any individual
  //    rule: every structured edit that goes in has to come out somewhere. This
  //    is the assertion that would have caught the real bug, where a corpus
  //    with no baselineId on any record collapsed into one group and 16 of 17
  //    records were discarded while the fold reported success.
  const all = await call(RECORDS.ALL);
  const acc = all.accounted;
  const out = acc.kept + acc.refused + acc.duplicated + acc.composed + acc.supersededEdits;
  assert(out === acc.in,
    'every edit that goes into a fold comes out of it somewhere',
    out === acc.in
      ? null
      : `${acc.in} edits in, ${out} accounted for ` +
        `(kept ${acc.kept}, refused ${acc.refused}, duplicate ${acc.duplicated}, ` +
        `composed ${acc.composed}, ` +
        `superseded ${acc.supersededEdits}). The difference is work that vanished.`);

  // 7. The real-corpus shape: many records, not one of them carrying a
  //    baselineId. Every record written before 2026-08-16 looks like this.
  const unkeyed = RECORDS.ALL.map(({ baselineId, ...rest }) => rest);
  const noKeys = await call(unkeyed);
  assert(noKeys.superseded === 0,
    'records with no baseline are never discarded as superseded',
    noKeys.superseded === 0 ? null
      : `${noKeys.superseded} records dropped, which is the bug the real corpus exposed`);
  const na = noKeys.accounted;
  assert(na.kept + na.refused + na.duplicated + na.composed + na.supersededEdits === na.in,
    'a fold with no baselines anywhere still loses nothing');

  // 8. The rendered artifact. This is what someone actually downloads and hands
  //    to an agent, so the checks are on the text rather than on the object
  //    behind it. render() lives in the merge module rather than the browser
  //    precisely so it can be reached without a granted folder.
  const rendered = await evaluate(sess,
    `Ryker.merge.render(Ryker.merge.fold(${JSON.stringify(
      [].concat(RECORDS.SESSION_A, RECORDS.SESSION_B, RECORDS.SESSION_C, RECORDS.SESSION_D))}))`);

  assert(rendered.includes('The original first line.'),
    'the merged file quotes the original text, not an intermediate version',
    rendered.includes('The original first line.') ? null
      : 'the FROM text an agent has to match is missing');
  assert(rendered.includes('The final first line.'),
    'the merged file carries the final text');
  assert(!rendered.includes('The edited first line.\n>>>'),
    'intermediate versions do not appear as their own steps');
  assert(/## Not merged/.test(rendered),
    'what could not be merged is written into the file, not just the dialog',
    /## Not merged/.test(rendered) ? null
      : 'a refusal was reported in the object but never reached the artifact, ' +
        'so whoever downloads it would not know anything was left out');

  // 9. Order independence. The caller lists a directory and gets whatever order
  //    the filesystem hands back, so the fold sorts by savedAt itself.
  const shuffled = await call(RECORDS.ALL);
  const inOrder = await call(RECORDS.ALL.slice().sort((x, y) =>
    Date.parse(x.savedAt) - Date.parse(y.savedAt)));
  assert(JSON.stringify(shuffled.steps) === JSON.stringify(inOrder.steps),
    'the fold does not depend on the order records arrive in');
}

const bundles = ['ryker.js'].filter((f) => existsSync(join(DIST, f)));
if (!bundles.length) {
  console.error('No bundle found in drop-in/dist. Run: node drop-in/build/bundle.mjs');
  process.exit(1);
}

const sess = await launch();
try {
  for (const file of bundles) { await runBuild(sess, file); await runMerge(sess, file); await runPackager(sess, file); await runFailureIsolation(sess, file); }
} finally {
  await sess.close();
}

console.log(`\n${checks - failures}/${checks} checks passed across ${bundles.length} bundle(s).`);
process.exit(failures ? 1 : 0);
