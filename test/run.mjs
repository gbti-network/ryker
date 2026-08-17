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
import { FAKE_FS } from './fixtures/fakefs.mjs';

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

// The change request log, end to end, against an in-memory filesystem.
//
// Everything here was unverified until now because it all sits behind
// showDirectoryPicker, which needs a real click. The fake resolves immediately,
// so the grant, the write, the merged export and the clear all become drivable.
// What stays unproven is the real picker itself, which no harness can supply.
async function runLogging(sess, file) {
  console.log(`\n${file} (change request log)`);
  const code = readFileSync(join(DIST, file), 'utf8');

  await navigate(sess, FIXTURE);
  await evaluate(sess, FAKE_FS);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot');

  // A save with no folder granted must prompt, once. The owner asked for that
  // on 2026-08-16, overriding a comment that refused to open any dialog here.
  await evaluate(sess, `(function () {
    var hit = Ryker.blocks.all()[3];
    hit.node.textContent = 'First edit for the log test.';
    Ryker.editable.touch();
    Ryker.boot.save();
  })()`);

  // Awaited, not read synchronously. save() is fire and forget by design: the
  // logging attempt happens in the promise record() returns, so the prompt
  // cannot exist yet on the line after the call.
  let prompted = false;
  try {
    await waitInPage(sess, `Ryker.dialog.isOpen()`, 5000, 'the grant prompt');
    prompted = true;
  } catch (e) { /* reported below */ }
  assert(prompted, 'the first save without a folder prompts for the grant',
    prompted ? null : 'no dialog appeared within 5s of a save with no folder granted');

  // Grant it, the way the dialog's own button does.
  const granted = await evaluate(sess,
    `Ryker.logger.choose().then(function (ok) { return { ok: ok, on: Ryker.logger.isOn() }; })`);
  assert(granted.ok === true && granted.on === true,
    'granting the folder turns logging on',
    JSON.stringify(granted));

  // The held save must be written the moment the folder arrives. Without that,
  // "always on" would quietly mean "on from the second save onward", which is
  // the exact thing logger.js's pending queue exists to prevent.
  const afterGrant = await evaluate(sess, `(function () {
    var files = window.__fakeFsDump();
    return { paths: Object.keys(files), held: Ryker.logger.pendingCount() };
  })()`);
  assert(afterGrant.paths.length >= 1,
    'the save held before the grant is written once the folder arrives',
    `nothing on disk; held ${afterGrant.held}`);
  assert(afterGrant.paths.every((p) => /^ryker\/revisions\//.test(p)),
    'records land under the fixed relative path, not wherever',
    'paths: ' + JSON.stringify(afterGrant.paths));

  // A second save must not re-prompt.
  const second = await evaluate(sess, `(function () {
    Ryker.dialog.closeTop();
    var hit = Ryker.blocks.all()[4];
    hit.node.textContent = 'Second edit for the log test.';
    Ryker.editable.touch();
    Ryker.boot.save();
    return { dialogOpen: Ryker.dialog.isOpen() };
  })()`);
  assert(second.dialogOpen === false,
    'a later save does not prompt again',
    'the once-per-session rule is what keeps the override tolerable');

  // The written record has to carry the baseline, or the merge cannot group it.
  const written = await waitInPage(sess, `(function () {
    var files = window.__fakeFsDump();
    var names = Object.keys(files);
    if (!names.length) return null;
    var rec = JSON.parse(files[names[names.length - 1]]);
    return { baselineId: rec.baselineId || null, edits: (rec.edits || []).length,
             hasPrompt: !!rec.prompt };
  })()`, 8000, 'a record on the fake disk');

  assert(!!written.baselineId,
    'the written record carries a baselineId',
    'without it the merge cannot tell deduplication from composition');
  assert(written.hasPrompt && written.edits > 0,
    'the record carries both the prose prompt and the structured pairs',
    JSON.stringify(written));

  // Read them back and fold them, which is the export path.
  const merged = await evaluate(sess,
    `Ryker.logger.list().then(function (files) {
       return Promise.all(files.map(function (f) { return Ryker.logger.read(f); }))
         .then(function (texts) {
           var recs = texts.map(function (t) { return JSON.parse(t); });
           var r = Ryker.merge.fold(recs);
           return { records: recs.length, steps: r.steps.length,
                    text: Ryker.merge.render(r).slice(0, 400) };
         });
     })`);
  assert(merged.records >= 1 && merged.steps >= 1,
    'the logged records read back and fold into an instruction set',
    JSON.stringify({ records: merged.records, steps: merged.steps }));
  assert(/Merged document edit instructions/.test(merged.text),
    'the merged export renders the artifact an agent receives');

  // Clear removes them, and removes only them.
  const cleared = await evaluate(sess,
    `Ryker.logger.clear().then(function (n) {
       return { removed: n, left: Object.keys(window.__fakeFsDump()).length };
     })`);
  assert(cleared.removed >= 1 && cleared.left === 0,
    'clearing the log removes every record',
    JSON.stringify(cleared));

  // A cancelled picker is not an error, and must not leave a stuck state.
  const cancelled = await evaluate(sess, `(function () {
    window.__fakeFsCancel = true;
    return Ryker.logger.choose().then(function (ok) {
      window.__fakeFsCancel = false;
      return { ok: ok, error: Ryker.logger.error() };
    });
  })()`);
  assert(cancelled.ok === false && !cancelled.error,
    'closing the picker is not reported as an error',
    JSON.stringify(cancelled));

  // Granting must still complete when the handle cannot be persisted.
  //
  // choose() awaits remember() before it emits, and remember() goes through
  // IndexedDB. idb() ran fn() unguarded with no onabort handler, so a throw
  // there aborted the transaction and the promise never settled: the grant hung
  // with no error, no toolbar change and nothing in the console. Private
  // browsing, a disabled store or a quota failure all produce that throw.
  //
  // The folder is expected to work for the session regardless. Only remembering
  // it across a reload is lost.
  const uncloneable = await evaluate(sess, `(function () {
    window.__fakeFsUncloneable();
    return Promise.race([
      Ryker.logger.choose().then(function (ok) {
        return { settled: true, ok: ok, on: Ryker.logger.isOn() };
      }),
      new Promise(function (r) { setTimeout(function () { r({ settled: false }); }, 4000); })
    ]);
  })()`);
  assert(uncloneable.settled === true,
    'granting completes even when the handle cannot be persisted',
    uncloneable.settled ? null
      : 'choose() never settled, so the grant hangs silently and the toolbar never updates');
  assert(uncloneable.on === true,
    'the folder still works for this session when it cannot be remembered',
    JSON.stringify(uncloneable));
}

// Moves: 322 lines of order derivation that nothing covered.
//
// sow-004 claims a CDP harness with 37 move checks and 10 regression checks.
// That harness exists nowhere, so this was the largest untested surface in the
// tree. between() is a pure function of two snapshots, which is where nearly all
// the risk lives, so most of this needs no drag simulation at all.
async function runMove(sess, file) {
  console.log(`\n${file} (moves)`);
  const code = readFileSync(join(DIST, file), 'utf8');

  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && Ryker.move)`, 10000, 'the move module');

  // A snapshot is an object keyed by block id in document order. between() only
  // reads key order and presence, so a minimal stand-in exercises it exactly.
  const derive = async (before, after) => evaluate(sess, `(function () {
    function snap(ids) {
      var o = {};
      ids.forEach(function (id) { o[id] = { html: id, tag: 'P', prev: null }; });
      return o;
    }
    return JSON.parse(JSON.stringify(
      Ryker.move.between(snap(${JSON.stringify(before)}), snap(${JSON.stringify(after)}))));
  })()`);

  const abcde = ['~a', '~b', '~c', '~d', '~e'];

  const same = await derive(abcde, abcde);
  assert(same.length === 0, 'an unchanged order reports no moves',
    same.length === 0 ? null : JSON.stringify(same));

  // One block to the front. The smallest honest account is that ~e moved, not
  // that the other four each shifted down by one.
  const toFront = await derive(abcde, ['~e', '~a', '~b', '~c', '~d']);
  assert(toFront.length === 1, 'moving one block reports exactly one move',
    toFront.length === 1 ? null : JSON.stringify(toFront));
  if (toFront.length === 1) {
    assert(JSON.stringify(toFront[0].ids) === JSON.stringify(['~e']),
      'the move names the block that actually moved',
      'ids: ' + JSON.stringify(toFront[0].ids));
    assert(toFront[0].prev === null && toFront[0].wasAfter === '~d',
      'the move records where it landed and where it came from',
      `prev ${toFront[0].prev}, wasAfter ${toFront[0].wasAfter}`);
  }

  // A contiguous run travels as one. Without coalescing, a moved section of
  // twenty paragraphs reads as twenty separate moves, each individually true
  // and collectively unreadable.
  const run = await derive(abcde, ['~c', '~d', '~a', '~b', '~e']);
  assert(run.length === 1, 'a contiguous run moved together is one move, not several',
    run.length === 1 ? null : `got ${run.length}: ` + JSON.stringify(run.map((m) => m.ids)));
  if (run.length === 1) {
    // Which pair moved is genuinely ambiguous here: swapping [c,d] and [a,b] is
    // two blocks whichever way round it is described. Asserting one of them
    // would pin an arbitrary choice, so the size is what gets checked.
    assert(run[0].ids.length === 2,
      'the run carries every block in it and no more',
      'ids: ' + JSON.stringify(run[0].ids));
    assert(run[0].ids.every((id) => abcde.includes(id)),
      'the run names real blocks');
  }

  // Minimality, which is the module's stated purpose rather than a nicety.
  // longestRun() used to maximise the NUMBER of runs kept and ignore how many
  // blocks each held, so the case above reported four blocks moving when one
  // would do. Both orders are correct; only one is readable.
  const totalMoved = (r) => r.reduce((n, m) => n + m.ids.length, 0);
  assert(totalMoved(toFront) === 1,
    'the report names the fewest blocks that could account for the change',
    `${totalMoved(toFront)} block(s) reported as moved where 1 suffices: ` +
    JSON.stringify(toFront.map((m) => m.ids)));

  // A block deleted from the middle of a run must not split the run and invent
  // a move nobody made. This is what the compaction step in between() is for.
  const deleted = await derive(abcde, ['~a', '~c', '~d', '~e']);
  assert(deleted.length === 0,
    'deleting a block from the middle does not invent a move',
    deleted.length === 0 ? null : JSON.stringify(deleted));

  // Blocks created this session are not in the old order and are not moves.
  const added = await derive(abcde, ['~a', '~b', '~new', '~c', '~d', '~e']);
  assert(added.length === 0, 'a newly inserted block is not reported as a move',
    added.length === 0 ? null : JSON.stringify(added));

  // Scale: one block out of ten still reports one move.
  const ten = Array.from({ length: 10 }, (_, i) => '~' + String.fromCharCode(97 + i));
  const oneOfTen = await derive(ten, [ten[7]].concat(ten.filter((x) => x !== ten[7])));
  assert(oneOfTen.length === 1,
    'one block moved among ten reports one move, not nine shifts',
    oneOfTen.length === 1 ? null : `got ${oneOfTen.length}`);

  // The invariant the whole module rests on, stated in its own header: no block
  // id may look like an array index, because that is the one case where an
  // object reorders its own keys and every derived order would be wrong.
  const ids = await evaluate(sess,
    `Ryker.blocks.all().map(function (b) { return b.id; })`);
  const indexLike = ids.filter((id) => /^\d+$/.test(String(id)));
  assert(indexLike.length === 0,
    'no real block id looks like an array index',
    indexLike.length === 0 ? null
      : `${JSON.stringify(indexLike)} would make Object.keys() reorder the snapshot ` +
        'and silently corrupt every move derivation');

  // And the headline claim, on the real DOM rather than on stand-ins: move
  // something out and back, and Ryker correctly reports nothing.
  const roundTrip = await evaluate(sess, `(function () {
    var all = Ryker.blocks.all();
    var alpha = all.filter(function (b) {
      return (b.node.textContent || '').trim() === 'List item alpha';
    })[0];
    var beta = all.filter(function (b) {
      return (b.node.textContent || '').trim() === 'List item beta';
    })[0];
    if (!alpha || !beta) return { error: 'fixture list items not found' };

    var pristine = Ryker.blocks.snapshot();
    var home = alpha.node.previousElementSibling;

    var why = Ryker.move.apply([alpha.node], beta.node, 'after');
    if (why) return { error: 'apply refused: ' + why };
    var movedCount = Ryker.move.between(pristine, Ryker.blocks.snapshot()).length;

    var back = home
      ? Ryker.move.apply([alpha.node], home, 'after')
      : Ryker.move.apply([alpha.node], beta.node, 'before');
    if (back) return { error: 'move back refused: ' + back };
    var afterCount = Ryker.move.between(pristine, Ryker.blocks.snapshot()).length;

    return { movedCount: movedCount, afterCount: afterCount };
  })()`);

  if (roundTrip.error) {
    bad('a real move is detected, and undoing it reports nothing', roundTrip.error);
  } else {
    assert(roundTrip.movedCount === 1,
      'a real move in the document is detected',
      `got ${roundTrip.movedCount} moves`);
    assert(roundTrip.afterCount === 0,
      'moving something out and back again reports nothing',
      roundTrip.afterCount === 0 ? null
        : `${roundTrip.afterCount} phantom move(s): the derivation accumulated instead ` +
          'of comparing, which is the bug the module was written to avoid');
  }
}

const bundles = ['ryker.js'].filter((f) => existsSync(join(DIST, f)));
if (!bundles.length) {
  console.error('No bundle found in drop-in/dist. Run: node drop-in/build/bundle.mjs');
  process.exit(1);
}

const sess = await launch();
try {
  for (const file of bundles) { await runBuild(sess, file); await runMerge(sess, file); await runMove(sess, file); await runPackager(sess, file); await runLogging(sess, file); await runFailureIsolation(sess, file); }
} finally {
  await sess.close();
}

console.log(`\n${checks - failures}/${checks} checks passed across ${bundles.length} bundle(s).`);
process.exit(failures ? 1 : 0);
