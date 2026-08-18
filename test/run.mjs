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
const EXTENSION = join(HERE, '..', 'extension');
const FIXTURE = 'file://' + resolve(join(HERE, 'fixtures', 'report.html'));
const ARTICLE_FIXTURE = 'file://' + resolve(join(HERE, 'fixtures', 'article.html'));
const WORKSPACE_FIXTURE = 'file://' + resolve(join(EXTENSION, 'workspace.html'));

// Counted by hand against the fixture's comments, then confirmed by the first
// run. Asserted alongside the named inclusions and exclusions below, so a
// change to excluded() cannot pass by restoring the total through another route.
const EXPECTED_EDITABLE = 25;

const MUST_BE_EDITABLE = [
  'Fixture Report',                        // h1 in a header INSIDE main
  'The subtitle that sits in the title block.',
  'List item alpha',
  '22',                                    // sibling of a data-effort cell
  'The caption underneath the chart.',
  'A quoted paragraph inside a blockquote.',
  'The definition of term one.',
  'What the second table holds.',          // a <caption> is the table's prose
  'Task',                                  // cell of a <table data-sort>
  'Rename the export button'               // cell of a <tr data-effort>
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
    docCss: !!document.getElementById('ryker-document-css'),
    brand: (function () {
      var root = document.getElementById('ryker-root').shadowRoot;
      var mark = root.querySelector('.bar .brand-mark');
      var word = root.querySelector('.bar .brand');
      return {
        present: !!mark,
        beforeWord: !!(mark && word && mark.nextElementSibling === word),
        embedded: !!(mark && (mark.getAttribute('src') || '').indexOf('data:image/png;base64,') === 0),
        width: mark && getComputedStyle(mark).width,
        height: mark && getComputedStyle(mark).height
      };
    })(),
    collapsed: (function () {
      var root = document.getElementById('ryker-root').shadowRoot;
      var handle = root.querySelector('.handle');
      var mark = handle && handle.querySelector('.brand-mark');
      return {
        label: handle && handle.getAttribute('aria-label'),
        visibleText: handle && handle.textContent.trim(),
        children: handle && handle.children.length,
        markWidth: mark && getComputedStyle(mark).width,
        targetWidth: handle && getComputedStyle(handle).width,
        targetHeight: handle && getComputedStyle(handle).height
      };
    })(),
    sharedTheme: !!(Ryker.theme && Ryker.styles.LIGHT === Ryker.theme.cssText)
  })`);

  assert(info.hasShadow, `boots and mounts a shadow root (${info.build} ${info.version})`);
  assert(info.brand.present && info.brand.beforeWord && info.brand.embedded &&
    info.brand.width === '18px' && info.brand.height === '18px',
  'the approved Ryker mark appears immediately left of the toolbar wordmark',
  JSON.stringify(info.brand));
  assert(info.sharedTheme,
    'the drop-in chrome reads its design tokens from the shared Ryker theme');
  assert(info.collapsed.label === 'Open Ryker' && info.collapsed.visibleText === '' &&
    info.collapsed.children === 1 && info.collapsed.markWidth === '24px' &&
    info.collapsed.targetWidth === '40px' && info.collapsed.targetHeight === '40px',
  'the collapsed handle is an accessible logo-only control',
  JSON.stringify(info.collapsed));

  const paintedChrome = await evaluate(sess, `(function () {
    var sr = document.getElementById('ryker-root').shadowRoot;
    var bar = sr.querySelector('.bar');
    var layer = sr.querySelector('.layer');
    var dialog = Ryker.dialog.open({ title: 'Paint probe', body: '<p>Visible</p>' });
    var modal = sr.querySelector('.modal');
    var handle = sr.querySelector('.handle');
    var where = sr.querySelector('.where');
    var count = sr.querySelector('.count');
    var result = {
      barBackground: getComputedStyle(bar).backgroundColor,
      layerForeground: getComputedStyle(layer).color,
      modalBackground: getComputedStyle(modal).backgroundColor,
      modalWidth: modal.getBoundingClientRect().width,
      radii: {
        modal: getComputedStyle(modal).borderTopLeftRadius,
        handle: getComputedStyle(handle).borderBottomLeftRadius,
        where: getComputedStyle(where).borderTopLeftRadius,
        count: getComputedStyle(count).borderTopLeftRadius
      }
    };
    dialog.close();
    return result;
  })()`);
  assert(paintedChrome.barBackground === 'rgb(255, 255, 255)' &&
    paintedChrome.layerForeground === 'rgb(22, 24, 29)' &&
    paintedChrome.modalBackground === 'rgb(255, 255, 255)' &&
    paintedChrome.modalWidth > 300,
  'shared theme tokens resolve into visible toolbar and dialog paint',
  JSON.stringify(paintedChrome));
  assert(Object.keys(paintedChrome.radii).every(function (key) {
    return paintedChrome.radii[key] === '4px';
  }), 'all curved Ryker chrome uses the 4px corner radius',
  JSON.stringify(paintedChrome.radii));

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

  // A blank cell carries no text to be named by, so it is asserted directly
  // rather than through MUST_BE_EDITABLE. The three things that have to hold
  // are that it is armed, that it has an identity the grid supplies rather
  // than a running number, and that filling it records as an edit to that cell
  // rather than as an insertion somewhere near it.
  const blankCell = await evaluate(sess, `(function () {
    var cell = document.querySelector('#grid tbody tr:last-child td:last-child');
    if (!cell) return { error: 'fixture has no blank cell' };
    var id = Ryker.blocks.blockId(cell);
    var armed = cell.getAttribute('contenteditable') === 'true';
    cell.textContent = 'Unclaimed';
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    var change = Ryker.editable.changes().filter(function (c) { return c.id === id; })[0];
    Ryker.editable.revertAll();
    return {
      armed: armed, resolves: Ryker.blocks.byId(id) === cell,
      label: Ryker.blocks.label(id), kind: change && change.kind,
      before: change && change.before, after: change && change.after,
      settled: !Ryker.editable.isDirty(), text: cell.textContent
    };
  })()`);
  assert(!blankCell.error && blankCell.armed && blankCell.resolves &&
    blankCell.kind === 'changed' && blankCell.before === '' && blankCell.after === 'Unclaimed' &&
    /column 2 \(Owner\)/.test(blankCell.label) && blankCell.settled && blankCell.text === '',
  'a blank table cell is editable, named by its place in the grid and recorded as an edit',
  JSON.stringify(blankCell));

  // --- rows and columns -----------------------------------------------------
  //
  // Structure, which the rest of the editor deliberately refuses to touch. The
  // four things that have to hold are that each operation reshapes the grid,
  // that one undo puts it back, that the recorded changes replay into a fresh
  // copy of the document and land in the right row, and that each one reads as
  // a single instruction rather than one per cell.
  const gridOps = await evaluate(sess, `(function () {
    var shape = function () {
      return Array.prototype.map.call(document.querySelectorAll('#grid table tr'), function (r) {
        return Array.prototype.map.call(r.children, function (c) {
          return c.tagName + ':' + (c.textContent || '').trim();
        });
      });
    };
    var start = shape();
    var cell = document.querySelector('#grid tbody tr:first-child td:first-child');
    Ryker.table.insertRow(cell, 'below');
    var rowAdded = shape();
    var dirty = Ryker.editable.isDirty();
    Ryker.table.insertColumn(cell, 'right');
    var colAdded = shape();
    Ryker.table.removeRow(document.querySelector('#grid tbody tr:last-child td'));
    var rowGone = shape();
    Ryker.table.removeColumn(document.querySelector('#grid thead th'));
    var colGone = shape();
    Ryker.editable.revertAll();
    return { start: start, rowAdded: rowAdded, colAdded: colAdded, rowGone: rowGone,
      colGone: colGone, dirty: dirty, restored: shape(), settled: !Ryker.editable.isDirty() };
  })()`);
  assert(gridOps.rowAdded.length === gridOps.start.length + 1 &&
    gridOps.rowAdded[2].join('') === 'TD:TD:' &&
    gridOps.colAdded.every((r) => r.length === gridOps.start[0].length + 1) &&
    gridOps.rowGone.length === gridOps.colAdded.length - 1 &&
    gridOps.colGone.every((r) => r.length === gridOps.colAdded[0].length - 1) &&
    gridOps.dirty && gridOps.settled &&
    JSON.stringify(gridOps.restored) === JSON.stringify(gridOps.start),
  'rows and columns can be added and removed, and discard restores the authored grid',
  JSON.stringify(gridOps));

  // A locked cell protects its row and its column, and a table that merges
  // cells is declined outright rather than reshaped on a guess.
  const gridRefusals = await evaluate(sess, `(function () {
    var said = [];
    var realAlert = Ryker.dialog.alert;
    Ryker.dialog.alert = function (title, body) { said.push(String(body)); };
    var lockedRow = Ryker.table.removeRow(document.querySelector('#data td[data-effort]'));
    var merged = document.querySelector('#grid thead th');
    merged.setAttribute('colspan', '2');
    var spanned = Ryker.table.insertRow(merged, 'below');
    merged.removeAttribute('colspan');
    Ryker.dialog.alert = realAlert;
    return { lockedRow: lockedRow, spanned: spanned, said: said,
      rows: document.querySelectorAll('#grid table tr').length };
  })()`);
  assert(gridRefusals.lockedRow === false && gridRefusals.spanned === false &&
    /not editable/i.test(gridRefusals.said[0] || '') &&
    /colspan or rowspan/i.test(gridRefusals.said[1] || '') && gridRefusals.rows === 3,
  'a locked cell and a merged cell both stop a row or column change, with a reason',
  JSON.stringify(gridRefusals));

  // Enter inside a cell is a line break. Splitting one would add a cell and
  // change what the row means, and doing nothing at all read as the cell being
  // the one block that would not take an edit.
  const cellReturn = await evaluate(sess, `(function () {
    var cell = document.querySelector('#grid tbody tr:first-child td:first-child');
    if (!cell) return { error: 'fixture has no populated cell' };
    var cells = document.querySelectorAll('#grid tbody tr:first-child td').length;
    cell.focus();
    var range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    var broke = cell.querySelectorAll('br').length > 0;
    var grew = document.querySelectorAll('#grid tbody tr:first-child td').length !== cells;
    Ryker.editable.revertAll();
    cell.blur();
    return { broke: broke, grew: grew, settled: !Ryker.editable.isDirty() };
  })()`);
  assert(!cellReturn.error && cellReturn.broke && !cellReturn.grew && cellReturn.settled,
    'Enter inside a table cell inserts a line break without adding a cell',
    JSON.stringify(cellReturn));

  // An upward cross-block drag leaves focus in the paragraph where the drag
  // began. The focused editing-host rule is more specific than .ryker-pick, so
  // the anchor used to stay in the selected set while losing its purple visual
  // treatment. Backspace then removed a paragraph that did not look selected.
  const pickedVisuals = await evaluate(sess, `(function () {
    var prose = Ryker.blocks.sequence().filter(function (node) {
      return node.matches && node.matches('p');
    });
    var other = prose[0], anchor = prose[1];
    if (!other || !anchor) return { error: 'fixture needs two editable paragraphs' };
    anchor.focus();
    Ryker.pick.set([other, anchor]);
    var result = {
      anchorFocused: document.activeElement === anchor,
      anchorPicked: Ryker.pick.has(anchor),
      otherPicked: Ryker.pick.has(other),
      anchorShadow: getComputedStyle(anchor).boxShadow,
      otherShadow: getComputedStyle(other).boxShadow
    };
    Ryker.pick.clear();
    anchor.blur();
    return result;
  })()`);
  assert(!pickedVisuals.error && pickedVisuals.anchorFocused && pickedVisuals.anchorPicked &&
    pickedVisuals.otherPicked && pickedVisuals.anchorShadow === pickedVisuals.otherShadow,
  'the focused drag anchor displays the same picked outline as the rest of the range',
  JSON.stringify(pickedVisuals));

  const hidden = await evaluate(sess, `(function () {
    if (!Ryker.rail.isOpen()) Ryker.rail.toggle(true);
    if (!Ryker.pane.isOpen()) Ryker.pane.toggle();
    Ryker.dialog.alert('Temporary panel', 'This must close with Ryker.');
    Ryker.boot.expand(false);
    var root = document.getElementById('ryker-root').shadowRoot;
    var collapsed = {
      pane: Ryker.pane.isOpen(), rail: Ryker.rail.isOpen(), dialog: Ryker.dialog.isOpen(),
      editable: document.querySelectorAll('[contenteditable="true"]').length,
      pushed: document.body.hasAttribute('data-ryker-pushed'),
      railOffset: document.body.hasAttribute('data-ryker-rail'),
      bar: root.querySelector('.bar').style.display,
      handle: root.querySelector('.handle').style.display
    };
    Ryker.boot.expand(true);
    return {
      collapsed: collapsed,
      reopened: {
        pane: Ryker.pane.isOpen(), rail: Ryker.rail.isOpen(),
        editable: document.querySelectorAll('[contenteditable="true"]').length,
        bar: root.querySelector('.bar').style.display
      }
    };
  })()`);
  assert(!hidden.collapsed.pane && !hidden.collapsed.rail && !hidden.collapsed.dialog &&
    hidden.collapsed.editable === 0 && !hidden.collapsed.pushed && !hidden.collapsed.railOffset &&
    hidden.collapsed.bar === 'none' && hidden.collapsed.handle === 'flex',
  'Hide closes every panel, clears layout offsets and completely disables editing',
  JSON.stringify(hidden.collapsed));
  assert(hidden.reopened.pane && hidden.reopened.rail &&
    hidden.reopened.editable === EXPECTED_EDITABLE && hidden.reopened.bar === 'flex',
  'reopening Ryker deliberately restores editing and the previously open panels',
  JSON.stringify(hidden.reopened));

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

async function runBlockTypes(sess, file) {
  console.log(`\n${file} (block types)`);
  const code = readFileSync(join(DIST, file), 'utf8');
  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for block type conversion');

  const converted = await evaluate(sess, `(function () {
    var target = Ryker.blocks.all().map(function (b) { return b.node; })
      .filter(function (node) { return node.tagName === 'P'; })[0];
    if (!target) return { error: 'fixture has no editable paragraph' };
    var id = Ryker.blocks.blockId(target);
    var range = document.createRange();
    range.selectNodeContents(target);
    var selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range); target.focus();
    Ryker.formatbar.update();

    var root = document.getElementById('ryker-root').shadowRoot;
    var type = root.querySelector('.fb-type');
    if (!type) return { error: 'format toolbar has no block type control' };
    var initialLabel = type.textContent;
    type.click();
    var rows = Array.prototype.slice.call(root.querySelectorAll('.menu-item'));
    var labels = rows.map(function (row) { return row.textContent.trim(); });
    var h1 = rows.filter(function (row) { return row.textContent.trim() === 'Heading 1'; })[0];
    if (!h1) return { error: 'Heading 1 is absent from the block type menu', labels: labels };
    h1.click();

    var afterConvert = Ryker.blocks.byId(id);
    var changed = Ryker.editable.changes();
    var undoWorked = Ryker.history.undo();
    var afterUndo = Ryker.blocks.byId(id);
    var redoWorked = Ryker.history.redo();
    var afterRedo = Ryker.blocks.byId(id);
    Ryker.boot.save(false, 'Promote this line to the document title.');
    return {
      initialLabel: initialLabel, labels: labels,
      convertedTag: afterConvert && afterConvert.tagName,
      change: changed[0] || null,
      undoWorked: undoWorked, undoTag: afterUndo && afterUndo.tagName,
      redoWorked: redoWorked, redoTag: afterRedo && afterRedo.tagName,
      pane: Ryker.pane.value()
    };
  })()`);

  assert(!converted.error && converted.initialLabel === 'Paragraph' &&
    ['Paragraph', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5']
      .every((label) => converted.labels.includes(label)),
  'the single-block toolbar offers Paragraph and heading levels H1 through H5',
  JSON.stringify(converted));
  assert(converted.convertedTag === 'H1' && converted.change &&
    converted.change.beforeTag === 'P' && converted.change.afterTag === 'H1' &&
    converted.change.before === converted.change.after,
  'a paragraph-to-H1 conversion is recorded as one tag-only edit',
  JSON.stringify(converted.change));
  assert(converted.undoWorked && converted.undoTag === 'P' &&
    converted.redoWorked && converted.redoTag === 'H1',
  'block type conversion supports undo and redo without losing identity',
  JSON.stringify(converted));
  assert(/Change <p> to <h1>/.test(converted.pane) &&
    /Keep the element's contents and attributes unchanged/.test(converted.pane),
  'saved instructions describe the element-name change without inventing a text rewrite',
  converted.pane.slice(0, 700));

  const emptyBoundary = await evaluate(sess, `(function () {
    var intro = document.querySelector('#intro');
    var empty = intro && intro.querySelector('p');
    var next = empty && empty.nextElementSibling;
    var previous = empty && empty.previousElementSibling;
    if (!empty || !next || !previous) return { error: 'fixture lacks the heading/paragraph boundary' };
    Ryker.editable.convert(next, 'H3');
    next = empty.nextElementSibling;
    empty.innerHTML = '<br>';
    empty.dispatchEvent(new Event('input', { bubbles: true }));

    function press(node, edge, key) {
      var range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(edge === 'start');
      var selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range); node.focus();
      return !node.dispatchEvent(new KeyboardEvent('keydown', {
        key: key, bubbles: true, cancelable: true
      }));
    }

    var backspacePrevented = press(empty, 'start', 'Backspace');
    var afterBackspace = {
      removed: !empty.isConnected,
      previousTag: previous.tagName,
      nextTag: next.tagName
    };
    var restored = Ryker.history.undo();
    var restoredBeforeDelete = restored && empty.isConnected;
    var deletePrevented = press(empty, 'end', 'Delete');
    return {
      backspacePrevented: backspacePrevented,
      afterBackspace: afterBackspace,
      restored: restoredBeforeDelete,
      deletePrevented: deletePrevented,
      removedByDelete: !empty.isConnected,
      previousStillHeading: previous.isConnected && /^H[1-6]$/.test(previous.tagName),
      nextStillHeading: next.isConnected && next.tagName === 'H3'
    };
  })()`);

  assert(!emptyBoundary.error && emptyBoundary.backspacePrevented &&
    emptyBoundary.afterBackspace.removed && emptyBoundary.afterBackspace.previousTag === 'H2' &&
    emptyBoundary.afterBackspace.nextTag === 'H3' && emptyBoundary.restored,
  'Backspace removes an empty paragraph below a heading without consuming either heading',
  JSON.stringify(emptyBoundary));
  assert(emptyBoundary.deletePrevented && emptyBoundary.removedByDelete &&
    emptyBoundary.previousStillHeading && emptyBoundary.nextStillHeading,
  'Delete removes an empty paragraph before the next heading without consuming either heading',
  JSON.stringify(emptyBoundary));
}

async function runSanitizer(sess, file) {
  console.log(`\n${file} (non-destructive sanitizing)`);
  const code = readFileSync(join(DIST, file), 'utf8');
  const authored = 'Before <img class="chart" src="data:image/png;base64,AA==" alt="Chart"> ' +
    '<a id="appendix" href="appendix.html" download>appendix</a> ' +
    '<abbr title="Application programming interface">API</abbr> ' +
    '<time datetime="2026-08-17">today</time> <del>old</del> <ins>new</ins> ' +
    '<small>fine</small> <span class="highlight">span</span> <mark>mark</mark>.';

  await navigate(sess, FIXTURE);
  await evaluate(sess, `(function () {
    Object.keys(localStorage).filter(function (key) {
      return key.indexOf('ryker:draft:') === 0 || key.indexOf('ryker:recovery-seen:') === 0;
    }).forEach(function (key) { localStorage.removeItem(key); });
    document.querySelector('#intro p').innerHTML = ${JSON.stringify(authored)};
  })()`);
  const before = await evaluate(sess, `document.querySelector('#intro p').innerHTML`);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for sanitizer checks');

  const result = await evaluate(sess, `(function () {
    var target = document.querySelector('#intro p');
    target.focus(); target.blur();
    var cleaned = Ryker.sanitize.html(${JSON.stringify(authored)});
    var box = document.createElement('div'); box.innerHTML = cleaned;
    var unsafe = document.createElement('div');
    unsafe.innerHTML = Ryker.sanitize.html(
      '<a href="javascript:alert(1)" onclick="alert(2)" style="color:red" ping="https://bad">bad</a>' +
      '<img src="data:image/svg+xml,%3Csvg%3E" alt="kept">');
    var link = box.querySelector('a');
    var image = box.querySelector('img');
    return {
      afterBlur: target.innerHTML,
      dirtyAfterBlur: Ryker.editable.isDirty(),
      changesAfterBlur: Ryker.editable.changes().length,
      preserved: {
        image: !!image && image.getAttribute('src').indexOf('data:image/png') === 0 &&
          image.className === 'chart' && image.alt === 'Chart',
        link: !!link && link.getAttribute('href') === 'appendix.html' &&
          link.hasAttribute('download') && link.id === 'appendix',
        semantics: ['abbr', 'time', 'del', 'ins', 'small', 'span.highlight', 'mark']
          .every(function (selector) { return !!box.querySelector(selector); })
      },
      unsafe: {
        href: unsafe.querySelector('a').hasAttribute('href'),
        onclick: unsafe.querySelector('a').hasAttribute('onclick'),
        style: unsafe.querySelector('a').hasAttribute('style'),
        ping: unsafe.querySelector('a').hasAttribute('ping'),
        imageSrc: unsafe.querySelector('img').hasAttribute('src'),
        imageAlt: unsafe.querySelector('img').getAttribute('alt')
      },
      separated: Ryker.sanitize.html('<p>alpha</p><div>beta</div>'),
      urls: {
        sibling: Ryker.sanitize.safeUrl('appendix.html', 'link'),
        nested: Ryker.sanitize.safeUrl('data/results.csv', 'link'),
        script: Ryker.sanitize.safeUrl('java\\nscript:alert(1)', 'link')
      }
    };
  })()`);

  assert(result.afterBlur === before && !result.dirtyAfterBlur && result.changesAfterBlur === 0,
    'focusing and blurring authored markup neither rewrites it nor invents an edit',
    JSON.stringify({ before, result }));
  assert(result.preserved.image && result.preserved.link && result.preserved.semantics,
    'the sanitizer preserves inline images, relative downloads, semantic tags and safe attributes',
    JSON.stringify(result.preserved));
  assert(!result.unsafe.href && !result.unsafe.onclick && !result.unsafe.style &&
    !result.unsafe.ping && !result.unsafe.imageSrc && result.unsafe.imageAlt === 'kept',
  'the widened allowlist still strips executable, beacon and unsafe image attributes',
  JSON.stringify(result.unsafe));
  assert(result.separated === 'alpha<br>beta',
    'unwrapping pasted block elements keeps a visible boundary between their words', result.separated);
  assert(result.urls.sibling && result.urls.nested && !result.urls.script,
    'the shared URL policy accepts schemeless relatives and rejects an obfuscated script scheme',
    JSON.stringify(result.urls));
}

async function runEditorHardening(sess, file) {
  console.log(`\n${file} (editor hardening)`);
  const code = readFileSync(join(DIST, file), 'utf8');

  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for split history checks');

  const splitHistory = await evaluate(sess, `(function () {
    function paragraph(text) {
      return Ryker.blocks.all().map(function (b) { return b.node; }).filter(function (node) {
        return (node.textContent || '').trim() === text;
      })[0];
    }
    function split(node, offset) {
      var range = document.createRange();
      range.setStart(node.firstChild, offset); range.collapse(true);
      var selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range); node.focus();
      Ryker.editable.splitAt(node);
      return node.nextElementSibling;
    }
    var first = paragraph('First paragraph of the introduction.');
    var second = paragraph('Second paragraph of the introduction.');
    var firstTail = split(first, 6);
    var secondTail = split(second, 7);
    Ryker.history.undo();
    Ryker.history.undo();
    Ryker.history.redo();
    return {
      first: first.innerHTML,
      firstTail: first.nextElementSibling && first.nextElementSibling.innerHTML,
      second: second.innerHTML,
      secondTailConnected: secondTail.isConnected,
      firstTailReused: first.nextElementSibling === firstTail
    };
  })()`);

  assert(splitHistory.first === 'First ' &&
    splitHistory.firstTail === 'paragraph of the introduction.' &&
    splitHistory.second === 'Second paragraph of the introduction.' &&
    !splitHistory.secondTailConnected && splitHistory.firstTailReused,
  'redoing an older split restores that split instead of the most recent split HTML',
  JSON.stringify(splitHistory));

  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for discard checks');

  const discard = await evaluate(sess, `(function () {
    function paragraph(text) {
      return Ryker.blocks.all().map(function (b) { return b.node; }).filter(function (node) {
        return (node.textContent || '').trim() === text;
      })[0];
    }
    function caret(node, offset) {
      var range = document.createRange();
      range.setStart(node.firstChild, offset); range.collapse(true);
      var selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range); node.focus();
    }
    var baseline = JSON.stringify(Ryker.editable.baselineOf());
    var first = paragraph('First paragraph of the introduction.');
    var second = paragraph('Second paragraph of the introduction.');
    var removed = paragraph('List item beta');
    var table = document.querySelector('#data table');
    var heading = document.querySelector('#intro h2');
    var secondId = Ryker.blocks.blockId(second);
    caret(first, 5);
    Ryker.editable.splitAt(first);
    var added = first.nextElementSibling;
    Ryker.editable.convert(second, 'H2');
    var converted = Ryker.blocks.byId(secondId);
    Ryker.multi.removeNodes([removed]);
    Ryker.multi.removeNodes([table]);
    heading.parentNode.appendChild(heading);
    Ryker.editable.touch();
    var dirtyBefore = Ryker.editable.isDirty();
    Ryker.editable.revertAll();
    return {
      dirtyBefore: dirtyBefore,
      exactSnapshot: JSON.stringify(Ryker.blocks.snapshot()) === baseline,
      firstConnected: first.isConnected,
      secondConnected: second.isConnected,
      secondRestored: Ryker.blocks.byId(secondId) === second && second.tagName === 'P',
      convertedDetached: converted && !converted.isConnected,
      removedRestored: removed.isConnected,
      tableRestored: table.isConnected && document.querySelector('#data table') === table,
      addedDetached: !added.isConnected,
      headingFirst: document.querySelector('#intro').firstElementChild === heading,
      historyDepth: Ryker.history.depth()
    };
  })()`);

  assert(discard.dirtyBefore && discard.exactSnapshot && discard.firstConnected &&
    discard.secondConnected && discard.secondRestored && discard.convertedDetached &&
    discard.removedRestored && discard.tableRestored && discard.addedDetached && discard.headingFirst &&
    discard.historyDepth === 0,
  'discard restores split, converted, deleted-table and reordered authored structure exactly',
  JSON.stringify(discard));

  const reopen = await evaluate(sess, `(function () {
    var node = Ryker.blocks.all().map(function (b) { return b.node; }).filter(function (n) {
      return (n.textContent || '').trim() === 'First paragraph of the introduction.';
    })[0];
    var range = document.createRange(); range.selectNodeContents(node); range.collapse(false);
    var selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range); node.focus();
    Ryker.editable.splitAt(node);
    var empty = node.nextElementSibling;
    Ryker.boot.close();
    var off = !empty.hasAttribute('contenteditable');
    Ryker.boot.open();
    return {
      empty: empty.innerHTML,
      off: off,
      on: empty.getAttribute('contenteditable'),
      editing: empty.classList.contains('ryker-editing'),
      connected: empty.isConnected
    };
  })()`);

  assert(reopen.empty === '<br>' && reopen.off && reopen.on === 'true' &&
    reopen.editing && reopen.connected,
  'an emptied or newly split block is editable again after Hide and reopen',
  JSON.stringify(reopen));

  const nativeUndo = await evaluate(sess, `(function () {
    var input = Ryker.dom.el('input', { value: 'draft' });
    var select = Ryker.dom.el('select', {}, [Ryker.dom.el('option', { text: 'one' })]);
    var rich = Ryker.dom.el('div', { contenteditable: 'true', text: 'dialog draft' });
    Ryker.dialog.open({ title: 'Undo fields', body: Ryker.dom.el('div', {}, [input, select, rich]) });
    function native(node) {
      node.focus();
      return node.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', ctrlKey: true, bubbles: true, cancelable: true, composed: true
      }));
    }
    var page = document.querySelector('#intro p');
    var result = {
      input: native(input), select: native(select), rich: native(rich), page: native(page)
    };
    Ryker.dialog.closeTop();
    return result;
  })()`);

  assert(nativeUndo.input && nativeUndo.select && nativeUndo.rich && !nativeUndo.page,
    'global undo leaves form and dialog-editable controls native while owning page blocks',
    JSON.stringify(nativeUndo));

  await navigate(sess, FIXTURE);
  await evaluate(sess, `(function () {
    document.body.style.setProperty('padding-top', '13px', 'important');
    document.body.style.setProperty('padding-left', '17px', 'important');
    document.body.style.setProperty('padding-right', '21px', 'important');
    var collision = document.createElement('p');
    collision.setAttribute('data-ryker-host', 'authored');
    collision.textContent = 'Authored ownership-marker collision.';
    document.querySelector('main').appendChild(collision);
    var collisionStyle = document.createElement('style');
    collisionStyle.setAttribute('data-ryker-document-css', 'authored');
    collisionStyle.textContent = '.authored-marker-style{color:inherit}';
    document.head.appendChild(collisionStyle);
  })()`);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for host-style and batching checks');

  const batched = await evaluate(sess, `(async function () {
    var target = document.querySelector('#intro p');
    target.appendChild(document.createTextNode(' changed'));
    target.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(function (resolve) { requestAnimationFrame(resolve); });
    var original = Ryker.blocks.snapshot;
    var snapshots = 0;
    Ryker.blocks.snapshot = function () { snapshots += 1; return original(); };
    for (var i = 0; i < 3; i++) {
      target.appendChild(document.createTextNode(String(i)));
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var immediate = snapshots;
    await new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
    Ryker.blocks.snapshot = original;
    return { immediate: immediate, afterPaint: snapshots };
  })()`);

  assert(batched.immediate === 0 && batched.afterPaint === 1,
    'multiple typing events share one expensive document snapshot per animation frame',
    JSON.stringify(batched));

  const readFailure = await evaluate(sess, `(async function () {
    Ryker.logger.read = function () { return Promise.reject(new Error('disk denied <unsafe>')); };
    Ryker.browser.view({ name: 'revision.json' });
    await new Promise(function (resolve) { setTimeout(resolve, 0); });
    var root = document.getElementById('ryker-root').shadowRoot;
    var modal = root.querySelector('.modal');
    var result = {
      title: modal && modal.querySelector('h2').textContent,
      text: modal && modal.textContent,
      unsafeElement: !!(modal && modal.querySelector('unsafe'))
    };
    Ryker.dialog.closeTop();
    return result;
  })()`);

  assert(readFailure.title === 'Could not open change request' &&
    readFailure.text.includes('disk denied <unsafe>') && !readFailure.unsafeElement,
  'a failed revision read produces an escaped actionable dialog instead of an unhandled rejection',
  JSON.stringify(readFailure));

  const exportedPadding = await evaluate(sess, `(function () {
    var parsed = new DOMParser().parseFromString(Ryker.exportHtml.clean(), 'text/html');
    function value(prop) {
      return [parsed.body.style.getPropertyValue(prop),
        parsed.body.style.getPropertyPriority(prop)];
    }
    return {
      top: value('padding-top'), left: value('padding-left'), right: value('padding-right'),
      pushed: parsed.body.hasAttribute('data-ryker-pushed'),
      authoredMarker: !!parsed.querySelector('[data-ryker-host="authored"]') &&
        parsed.querySelector('[data-ryker-host="authored"]').textContent ===
          'Authored ownership-marker collision.',
      authoredStyle: !!parsed.querySelector('style[data-ryker-document-css="authored"]'),
      markerEditable: document.querySelector('[data-ryker-host="authored"]')
        .getAttribute('contenteditable'),
      ownedHost: !!(Ryker.shell.host() && Ryker.shell.host().shadowRoot)
    };
  })()`);

  assert(JSON.stringify(exportedPadding.top) === JSON.stringify(['13px', 'important']) &&
    JSON.stringify(exportedPadding.left) === JSON.stringify(['17px', 'important']) &&
    JSON.stringify(exportedPadding.right) === JSON.stringify(['21px', 'important']) &&
    !exportedPadding.pushed && exportedPadding.authoredMarker && exportedPadding.authoredStyle &&
    exportedPadding.markerEditable === 'true' && exportedPadding.ownedHost,
  'clean export restores host padding and preserves authored ownership-marker collisions',
  JSON.stringify(exportedPadding));

  const padding = await evaluate(sess, `(function () {
    Ryker.boot.close();
    function value(prop) {
      return [document.body.style.getPropertyValue(prop),
        document.body.style.getPropertyPriority(prop)];
    }
    return {
      top: value('padding-top'), left: value('padding-left'), right: value('padding-right'),
      pushed: document.body.hasAttribute('data-ryker-pushed')
    };
  })()`);

  assert(JSON.stringify(padding.top) === JSON.stringify(['13px', 'important']) &&
    JSON.stringify(padding.left) === JSON.stringify(['17px', 'important']) &&
    JSON.stringify(padding.right) === JSON.stringify(['21px', 'important']) &&
    !padding.pushed,
  'closing Ryker restores the host body padding values and priorities exactly',
  JSON.stringify(padding));
}

async function runRecovery(sess, file) {
  console.log(`\n${file} (refresh recovery)`);
  const code = readFileSync(join(DIST, file), 'utf8');
  await navigate(sess, FIXTURE);
  await evaluate(sess, `(function () {
    Object.keys(localStorage).filter(function (key) {
      return key.indexOf('ryker:draft:') === 0 || key.indexOf('ryker:recovery-seen:') === 0;
    }).forEach(function (key) { localStorage.removeItem(key); });
  })()`);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for recovery');

  const emptyRecovery = await evaluate(sess, `(function () {
    while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
    return Ryker.recover.present(null).then(function (shown) {
      var root = document.getElementById('ryker-root').shadowRoot;
      return { shown: shown, modal: !!root.querySelector('.modal') };
    });
  })()`);
  assert(emptyRecovery.shown === false && !emptyRecovery.modal,
    'a clean load with no recovery record stays silent', JSON.stringify(emptyRecovery));

  const malformedRecovery = await evaluate(sess, `(function () {
    return Ryker.recover.present({ kind: 'draft', baselineId: 'malformed', savedAt: '' })
      .then(function (shown) {
        var root = document.getElementById('ryker-root').shadowRoot;
        var title = root.querySelector('.modal h2');
        var out = { shown: shown, title: title && title.textContent };
        if (Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
        return out;
      });
  })()`);
  assert(malformedRecovery.shown === false && malformedRecovery.title === 'Saved changes need review',
    'a malformed recovery record is rejected for review without throwing',
    JSON.stringify(malformedRecovery));

  const checkpoint = await evaluate(sess, `(function () {
    var target = Ryker.blocks.all().filter(function (block) {
      return (block.node.textContent || '').trim() === 'First paragraph of the introduction.';
    })[0];
    if (!target) return Promise.resolve({ error: 'recovery target was not found' });
    target.node.textContent = 'First paragraph restored after refresh.';
    target.node.dispatchEvent(new Event('input', { bubbles: true }));
    return Ryker.recover.checkpoint().then(function () {
      var raw = localStorage.getItem(Ryker.recover.draftKey());
      var saved = raw && JSON.parse(raw);
      return { key: Ryker.recover.draftKey(), baselineId: saved && saved.baselineId,
        changes: saved && saved.changes && saved.changes.length };
    });
  })()`);
  assert(!checkpoint.error && checkpoint.baselineId && checkpoint.changes === 1,
    'editing checkpoints a replayable authored-to-current draft before Save',
    JSON.stringify(checkpoint));

  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `(function () {
    var root = document.getElementById('ryker-root');
    var title = root && root.shadowRoot.querySelector('.modal h2');
    return title && title.textContent === 'Restore earlier changes?';
  })()`, 10000, 'the refresh recovery offer');
  const restored = await evaluate(sess, `(function () {
    var root = document.getElementById('ryker-root').shadowRoot;
    var restore = Array.prototype.filter.call(root.querySelectorAll('.modal button'), function (button) {
      return button.textContent.trim() === 'Restore';
    })[0];
    restore.click();
    return {
      text: document.querySelector('#intro p').textContent,
      edits: Ryker.instructions.edits().length,
      alert: root.querySelector('.modal h2') && root.querySelector('.modal h2').textContent
    };
  })()`);
  assert(restored.text === 'First paragraph restored after refresh.' &&
    restored.edits === 1 && restored.alert === 'Changes restored',
  'refresh offers and restores the checkpoint into the document and instructions',
  JSON.stringify(restored));

  await evaluate(sess, `(function () {
    Ryker.dialog.closeTop();
    return Ryker.recover.draft().then(function (draft) {
      draft.baselineId = 'source-does-not-match';
      draft.savedAt = new Date(Date.now() + 1000).toISOString();
      return Ryker.recover.present(draft);
    });
  })()`);
  await waitInPage(sess, `(function () {
    var root = document.getElementById('ryker-root');
    var title = root && root.shadowRoot.querySelector('.modal h2');
    return title && title.textContent === 'Saved changes need review';
  })()`, 10000, 'the baseline mismatch warning');
  const mismatch = await evaluate(sess, `({
    text: document.querySelector('#intro p').textContent,
    edits: Ryker.instructions.edits().length
  })`);
  assert(mismatch.text === 'First paragraph restored after refresh.' && mismatch.edits === 1,
    'a changed source is warned about and never receives automatic replay',
    JSON.stringify(mismatch));

  await navigate(sess, FIXTURE);
  await evaluate(sess, `(function () {
    Object.keys(localStorage).filter(function (key) {
      return key.indexOf('ryker:draft:') === 0 || key.indexOf('ryker:recovery-seen:') === 0;
    }).forEach(function (key) { localStorage.removeItem(key); });
  })()`);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for structural recovery checks');

  const structural = await evaluate(sess, `(async function () {
    while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();

    var probe = document.createElement('div');
    probe.innerHTML = '<p data-ryker-id="order-a">Alpha</p>' +
      '<div data-host-widget>Host widget</div><p data-ryker-id="order-b">Beta</p>';
    document.querySelector('main').appendChild(probe);
    var orderOut = Ryker.blocks.applyOrder(['@order-a', '@order-b']);
    var orderTags = Array.prototype.map.call(probe.children, function (node) {
      return node.hasAttribute('data-host-widget') ? 'WIDGET' : node.textContent;
    });
    probe.remove();

    var source = Ryker.blocks.all().filter(function (block) {
      return (block.node.textContent || '').trim() === 'First paragraph of the introduction.';
    })[0].node;
    var sourceId = Ryker.blocks.blockId(source);
    Ryker.editable.convert(source, 'H4');
    var changed = Ryker.blocks.byId(sourceId);
    var target = document.querySelector('#media blockquote p');
    var moveError = Ryker.move.apply([changed], target, 'after');
    await Ryker.recover.checkpoint();
    var draft = await Ryker.recover.draft();
    Ryker.editable.revertAll();
    var baselineParent = Ryker.blocks.byId(sourceId).parentElement.id;
    var applied = Ryker.recover.apply(draft);
    var restored = Ryker.blocks.byId(sourceId);
    if (Ryker.dialog.isOpen()) Ryker.dialog.closeTop();

    var deleted = Ryker.blocks.all().filter(function (block) {
      return (block.node.textContent || '').trim() === 'Second paragraph of the introduction.';
    })[0].node;
    var deletedId = Ryker.blocks.blockId(deleted);
    Ryker.multi.removeNodes([deleted]);
    Ryker.instructions.record();
    var prompt = Ryker.instructions.build();
    var payload = Ryker.logger.buildPayload(prompt);
    var deletedEdit = payload.edits.filter(function (edit) { return edit.id === deletedId; })[0];
    return {
      orderMoved: orderOut.moved,
      orderTags: orderTags,
      moveError: moveError,
      recordedMoves: draft && draft.moves && draft.moves.length,
      baselineParent: baselineParent,
      applied: applied,
      restoredTag: restored && restored.tagName,
      restoredParent: restored && restored.parentElement && restored.parentElement.tagName,
      restoredPrevious: restored && restored.previousElementSibling && restored.previousElementSibling.textContent,
      deletePosition: deletedEdit && deletedEdit.position,
      deletePromptHasPosition: prompt.indexOf('Position: the 2nd <p> inside the section with id="intro"') !== -1
    };
  })()`);

  assert(structural.orderMoved === 0 &&
    JSON.stringify(structural.orderTags) === JSON.stringify(['Alpha', 'WIDGET', 'Beta']),
  'legacy order replay never pulls tracked blocks across untracked host widgets',
  JSON.stringify(structural));
  assert(!structural.moveError && structural.recordedMoves === 1 &&
    structural.baselineParent === 'intro' && structural.applied &&
    structural.restoredTag === 'H4' && structural.restoredParent === 'BLOCKQUOTE' &&
    /quoted paragraph/.test(structural.restoredPrevious || ''),
  'recovery restores a tag conversion and a cross-container move from the authored baseline',
  JSON.stringify(structural));
  assert(structural.deletePosition === 'the 2nd <p> inside the section with id="intro"' &&
    structural.deletePromptHasPosition,
  'deleted blocks keep their authored Position in JSON and prompt-facing change requests',
  JSON.stringify(structural));

  await navigate(sess, FIXTURE);
  await evaluate(sess, `(function () {
    Object.keys(localStorage).filter(function (key) {
      return key.indexOf('ryker:draft:') === 0 || key.indexOf('ryker:recovery-seen:') === 0;
    }).forEach(function (key) { localStorage.removeItem(key); });
  })()`);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for saved-move recovery checks');
  const savedMoveDraft = await evaluate(sess, `(async function () {
    while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
    var moved = Ryker.blocks.all().filter(function (block) {
      return (block.node.textContent || '').trim() === 'First paragraph of the introduction.';
    })[0].node;
    var movedId = Ryker.blocks.blockId(moved);
    var target = document.querySelector('#media blockquote p');
    var moveError = Ryker.move.apply([moved], target, 'after');
    var loggerRecord = Ryker.logger.record;
    Ryker.logger.record = function () { return Promise.resolve(true); };
    Ryker.boot.save(true);
    Ryker.logger.record = loggerRecord;
    var unsaved = Ryker.blocks.all().filter(function (block) {
      return (block.node.textContent || '').trim() === 'Second paragraph of the introduction.';
    })[0].node;
    unsaved.textContent = 'Unsaved text after the move was saved.';
    unsaved.dispatchEvent(new Event('input', { bubbles: true }));
    await Ryker.recover.checkpoint();
    var draft = await Ryker.recover.draft();
    return {
      movedId: movedId,
      moveError: moveError,
      moves: draft && draft.moves && draft.moves.length,
      changes: draft && draft.changes && draft.changes.length
    };
  })()`);
  assert(!savedMoveDraft.moveError && savedMoveDraft.moves === 1 && savedMoveDraft.changes === 1,
    'a draft after Save retains the authored-baseline move alongside later unsaved text',
    JSON.stringify(savedMoveDraft));

  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `(function () {
    var root = document.getElementById('ryker-root');
    var title = root && root.shadowRoot.querySelector('.modal h2');
    return title && title.textContent === 'Restore earlier changes?';
  })()`, 10000, 'the combined move and unsaved-text recovery offer');
  const combinedRestore = await evaluate(sess, `(function () {
    var root = document.getElementById('ryker-root').shadowRoot;
    var restore = Array.prototype.filter.call(root.querySelectorAll('.modal button'), function (button) {
      return button.textContent.trim() === 'Restore';
    })[0];
    restore.click();
    var moved = Ryker.blocks.byId(${JSON.stringify(savedMoveDraft.movedId)});
    return {
      movedParent: moved && moved.parentElement && moved.parentElement.tagName,
      movedPrevious: moved && moved.previousElementSibling && moved.previousElementSibling.textContent,
      unsaved: Array.prototype.some.call(document.querySelectorAll('#intro p'), function (node) {
        return node.textContent === 'Unsaved text after the move was saved.';
      })
    };
  })()`);
  assert(combinedRestore.movedParent === 'BLOCKQUOTE' &&
    /quoted paragraph/.test(combinedRestore.movedPrevious || '') && combinedRestore.unsaved,
  'refresh recovery preserves a saved cross-container move when a later draft adds unsaved text',
  JSON.stringify(combinedRestore));

  await navigate(sess, FIXTURE);
  await evaluate(sess, `(function () {
    Object.keys(localStorage).filter(function (key) {
      return key.indexOf('ryker:draft:') === 0 || key.indexOf('ryker:recovery-seen:') === 0;
    }).forEach(function (key) { localStorage.removeItem(key); });
  })()`);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for container recovery checks');
  const containers = await evaluate(sess, `(async function () {
    while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
    var paragraph = Ryker.blocks.all().filter(function (block) {
      return (block.node.textContent || '').trim() === 'First paragraph of the introduction.';
    })[0].node;
    var paragraphId = Ryker.blocks.blockId(paragraph);
    paragraph.textContent = '1.';
    paragraph.dispatchEvent(new Event('input', { bubbles: true }));
    var item = Ryker.blocks.byId(paragraphId);
    item.textContent = 'Recovered numbered item';
    item.dispatchEvent(new Event('input', { bubbles: true }));
    Ryker.multi.removeNodes([document.querySelector('#data table')]);
    Ryker.multi.removeNodes([document.querySelector('#media svg')]);
    await Ryker.recover.checkpoint();
    var draft = await Ryker.recover.draft();
    Ryker.instructions.record();
    var prompt = Ryker.instructions.build();
    Ryker.editable.revertAll();
    var baseline = {
      paragraph: Ryker.blocks.byId(paragraphId).tagName,
      table: !!document.querySelector('#data table'),
      svg: !!document.querySelector('#media svg')
    };
    var applied = Ryker.recover.apply(draft);
    var restored = Ryker.blocks.byId(paragraphId);
    var result = {
      draftListBox: draft.changes.some(function (change) {
        return change.id === paragraphId && change.afterTag === 'LI' && change.boxTag === 'OL';
      }),
      baseline: baseline,
      applied: applied,
      listTag: restored && restored.parentElement && restored.parentElement.tagName,
      itemTag: restored && restored.tagName,
      itemText: restored && restored.textContent,
      table: !!document.querySelector('#data table'),
      emptyTableShell: !!document.querySelector('#data table, #data tr'),
      svg: !!document.querySelector('#media svg'),
      tablePosition: /Delete a whole <table>[\\s\\S]*Position: the <table> containing the 1st <th> inside the section with id="data"/.test(prompt),
      svgPosition: /Delete the whole <svg>[\\s\\S]*Position: the 1st <svg> inside the section with id="media"/.test(prompt)
    };
    if (Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
    var missed = Ryker.recover.apply({
      kind: 'draft', baselineId: Ryker.instructions.baselineId(), savedAt: new Date().toISOString(),
      changes: [{ id: '@missing', kind: 'added', tag: 'SCRIPT', after: 'unsafe' }], moves: []
    });
    var root = document.getElementById('ryker-root').shadowRoot;
    result.missedApplied = missed;
    result.missedTitle = root.querySelector('.modal h2') && root.querySelector('.modal h2').textContent;
    return result;
  })()`);
  assert(containers.draftListBox && containers.baseline.paragraph === 'P' &&
    containers.baseline.table && containers.baseline.svg && containers.applied &&
    containers.listTag === 'OL' && containers.itemTag === 'LI' &&
    containers.itemText === 'Recovered numbered item',
  'recovery recreates the ordered-list wrapper instead of inserting a naked list item',
  JSON.stringify(containers));
  assert(!containers.table && !containers.emptyTableShell && !containers.svg,
    'recovery removes complete table and SVG structures without empty container shells',
    JSON.stringify(containers));
  assert(containers.tablePosition && containers.svgPosition,
    'grouped table and atomic SVG deletions include authored Positions',
    JSON.stringify(containers));
  assert(!containers.missedApplied && containers.missedTitle === 'Changes could not be restored',
    'an all-missed recovery record warns instead of claiming the edits were already present',
    JSON.stringify(containers));

  await evaluate(sess, `(function () {
    Object.keys(localStorage).filter(function (key) {
      return key.indexOf('ryker:draft:') === 0 || key.indexOf('ryker:recovery-seen:') === 0;
    }).forEach(function (key) { localStorage.removeItem(key); });
  })()`);
}

async function runAutoLists(sess, file) {
  console.log(`\n${file} (automatic lists)`);
  const code = readFileSync(join(DIST, file), 'utf8');

  async function openEmptyParagraph() {
    await navigate(sess, FIXTURE);
    await evaluate(sess, code);
    await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
      10000, 'Ryker to boot for automatic lists');
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    await evaluate(sess, `(function () {
      while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
      var paragraph = document.querySelector('#intro p');
      var range = document.createRange();
      range.selectNodeContents(paragraph); range.collapse(false);
      var selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range); paragraph.focus();
    })()`);
    await sess.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13
    });
    await sess.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13
    });
  }

  await openEmptyParagraph();
  await sess.send('Input.insertText', { text: '1' });
  await sess.send('Input.insertText', { text: '.' });
  const orderedAtMarker = await evaluate(sess, `(function () {
    var list = document.querySelector('#intro p').nextElementSibling;
    return { tag: list && list.tagName, active: document.activeElement && document.activeElement.tagName };
  })()`);
  assert(orderedAtMarker.tag === 'OL' && orderedAtMarker.active === 'LI',
  'typing "1." immediately starts an ordered list', JSON.stringify(orderedAtMarker));
  await sess.send('Input.insertText', { text: ' ' });
  const ordered = await evaluate(sess, `(function () {
    var first = document.querySelector('#intro p');
    var list = first.nextElementSibling;
    var item = list && list.querySelector('li');
    var made = {
      tag: list && list.tagName, item: item && item.tagName,
      empty: item && !(item.textContent || '').trim(), active: document.activeElement === item
    };
    var undo = Ryker.history.undo();
    var paragraph = first.nextElementSibling;
    var undone = { ok: undo, tag: paragraph && paragraph.tagName,
      empty: paragraph && !(paragraph.textContent || '').trim() };
    var redo = Ryker.history.redo();
    list = first.nextElementSibling;
    return { made: made, undone: undone, redone: redo && list && list.tagName };
  })()`);
  assert(ordered.made.tag === 'OL' && ordered.made.item === 'LI' &&
    ordered.made.empty && ordered.made.active,
  'the customary space after "1." is consumed and keeps the caret in the empty item',
  JSON.stringify(ordered));
  assert(ordered.undone.ok && ordered.undone.tag === 'P' && ordered.undone.empty &&
    ordered.redone === 'OL',
  'automatic ordered-list conversion supports undo and redo',
  JSON.stringify(ordered));

  await sess.send('Input.insertText', { text: 'First ordered item' });
  const orderedInstructions = await evaluate(sess, `(function () {
    Ryker.boot.save(false, 'Start a numbered procedure.');
    return Ryker.pane.value();
  })()`);
  assert(/Insert a new ordered list \(<ol>\) containing one <li>/.test(orderedInstructions) &&
    orderedInstructions.includes('<ol><li>First ordered item</li></ol>'),
  'saved instructions preserve the semantic ordered-list wrapper',
  orderedInstructions.slice(0, 700));

  await openEmptyParagraph();
  await sess.send('Input.insertText', { text: '*' });
  await sess.send('Input.insertText', { text: ' ' });
  const unordered = await evaluate(sess, `(function () {
    var first = document.querySelector('#intro p');
    var list = first.nextElementSibling;
    var item = list && list.querySelector('li');
    var made = { tag: list && list.tagName, item: item && item.tagName,
      empty: item && !(item.textContent || '').trim(), active: document.activeElement === item };
    Ryker.history.undo();
    return { made: made, paragraph: first.nextElementSibling && first.nextElementSibling.tagName };
  })()`);
  assert(unordered.made.tag === 'UL' && unordered.made.item === 'LI' &&
    unordered.made.empty && unordered.made.active && unordered.paragraph === 'P',
  'typing "* " in a new empty paragraph starts an unordered list and can be undone',
  JSON.stringify(unordered));

  await sess.send('Input.insertText', { text: 'Keep * as ordinary text. ' });
  const ordinary = await evaluate(sess, `(function () {
    var node = document.querySelector('#intro p').nextElementSibling;
    return { tag: node && node.tagName, text: node && node.textContent };
  })()`);
  assert(ordinary.tag === 'P' && ordinary.text.replace(/\u00a0/g, ' ') === 'Keep * as ordinary text. ',
    'list markers inside ordinary paragraph text do not trigger conversion',
    JSON.stringify(ordinary));
}

async function runAtomicSvg(sess, file) {
  console.log(`\n${file} (atomic SVG removal)`);
  const code = readFileSync(join(DIST, file), 'utf8');
  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for SVG removal');
  await new Promise((resolveWait) => setTimeout(resolveWait, 40));

  const target = await evaluate(sess, `(function () {
    while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
    var svg = document.querySelector('#media svg');
    svg.scrollIntoView({ block: 'center' });
    var r = svg.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2,
      editable: svg.hasAttribute('contenteditable') };
  })()`);
  await sess.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1
  });
  await sess.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 30));
  const selected = await evaluate(sess, `(function () {
    var svg = document.querySelector('#media svg');
    var sr = document.getElementById('ryker-root').shadowRoot;
    return { picked: Ryker.pick.has(svg), classed: svg.classList.contains('ryker-pick'),
      editable: svg.hasAttribute('contenteditable'),
      deleteVisible: !!sr.querySelector('.fb-kill') &&
        sr.querySelector('.fb-kill').style.display !== 'none' };
  })()`);
  assert(!target.editable && selected.picked && selected.classed && !selected.editable &&
    selected.deleteVisible,
  'clicking an SVG highlights it as one non-text-editable object with a Delete action',
  JSON.stringify(selected));

  await sess.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46
  });
  await sess.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46
  });
  const removed = await evaluate(sess, `(function () {
    var gone = !document.querySelector('#media svg');
    var dirty = Ryker.editable.isDirty();
    var undo = Ryker.history.undo();
    var restored = !!document.querySelector('#media svg');
    var redo = Ryker.history.redo();
    var removedAgain = !document.querySelector('#media svg');
    Ryker.boot.save(false, 'Remove the obsolete chart.');
    return { gone: gone, dirty: dirty, undo: undo, restored: restored,
      redo: redo, removedAgain: removedAgain, edits: Ryker.instructions.edits(),
      instructions: Ryker.pane.value() };
  })()`);
  assert(removed.gone && removed.dirty && removed.undo && removed.restored &&
    removed.redo && removed.removedAgain,
  'Delete removes the whole SVG and supports undo and redo', JSON.stringify(removed));
  assert(/Delete the whole <svg>/.test(removed.instructions) &&
    /including all paths, shapes, labels and attributes/.test(removed.instructions) &&
    /<svg[^>]+aria-label="A tiny chart"/.test(removed.instructions),
  'saved instructions identify the exact whole SVG removal',
  JSON.stringify(removed.edits) + '\n' + removed.instructions.slice(0, 900));
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

  await navigate(sess, FIXTURE);
  await evaluate(sess, `(function () {
    localStorage.clear();
    window.RYKER_CONFIG = {
      RYKER_DOCUMENT_ID: 'manifest-package',
      RYKER_DOCUMENT_PATH: 'report.html',
      RYKER_PACKAGE_MANIFEST: [{
        name: 'data/manifest-note.txt',
        href: 'data:text/plain,manifest-content'
      }]
    };
  })()`);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for manifest packaging');
  const manifestRows = await evaluate(sess, `(function () {
    window.__packageEntries = null;
    Ryker.zip.build = function (entries) {
      window.__packageEntries = entries;
      return Promise.resolve(new Uint8Array([80, 75]));
    };
    Ryker.zip.download = function () {};
    Ryker.packager.open();
    var sr = document.getElementById('ryker-root').shadowRoot;
    var rows = Array.prototype.map.call(sr.querySelectorAll('.filerow'), function (row) {
      return { name: row.querySelector('.nm').textContent, checked: row.querySelector('input').checked };
    });
    Array.prototype.filter.call(sr.querySelectorAll('.foot button'), function (button) {
      return button.textContent.trim() === 'Export as ZIP';
    })[0].click();
    return rows;
  })()`);
  await waitInPage(sess, `!!window.__packageEntries`, 10000, 'manifest package to build');
  const manifestPackage = await evaluate(sess, `window.__packageEntries.map(function (entry) {
    return {
      name: entry.name,
      text: entry.name === 'data/manifest-note.txt'
        ? new TextDecoder().decode(entry.data) : null
    };
  })`);
  assert(manifestRows.some((row) => row.name === 'data/manifest-note.txt' && row.checked),
    'build-manifest files appear selected in the package dialog', JSON.stringify(manifestRows));
  assert(manifestPackage.some((entry) => entry.name === 'data/manifest-note.txt' &&
    entry.text === 'manifest-content'),
  'a selected build-manifest file reaches the ZIP with its bytes', JSON.stringify(manifestPackage));

  await navigate(sess, FIXTURE);
  await evaluate(sess, `(function () {
    localStorage.clear();
    var marker = document.createElement('script');
    marker.type = 'application/json';
    marker.setAttribute('src', 'ryker/dist/ryker.js');
    marker.setAttribute('data-ryker', '');
    document.body.appendChild(marker);
  })()`);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for attached packaging');
  await evaluate(sess, `(function () {
    window.__folderReads = [];
    window.__packageEntries = null;
    var handle = { name: 'report' };
    Ryker.fs.isReady = function () { return true; };
    Ryker.fs.handle = function () { return handle; };
    Ryker.fs.walk = function (root, prefix, options) {
      window.__folderReads.push(prefix, 'ryker/revisions/');
      var revision = { name: 'revisions', kind: 'directory' };
      if (!options.skip(revision, 'ryker/revisions')) {
        throw new Error('revision directory was not excluded');
      }
      return Promise.resolve([{ name: 'ryker/dist/ryker.js', kind: 'file', size: 6 }]);
    };
    Ryker.fs.readBytes = function (root, path) {
      return Promise.resolve(new TextEncoder().encode(path === 'ryker/dist/ryker.js' ? 'bundle' : ''));
    };
    Ryker.zip.build = function (entries) {
      window.__packageEntries = entries;
      return Promise.resolve(new Uint8Array([80, 75]));
    };
    Ryker.zip.download = function () {};
    Ryker.packager.open();
  })()`);
  await waitInPage(sess,
    `document.getElementById('ryker-root').shadowRoot.querySelectorAll('.filerow').length === 3`,
    10000, 'folder package rows');
  const folderRows = await evaluate(sess, `(function () {
    var sr = document.getElementById('ryker-root').shadowRoot;
    var rows = Array.prototype.map.call(sr.querySelectorAll('.filerow'), function (row) {
      return { node: row, name: row.querySelector('.nm').textContent, input: row.querySelector('input') };
    });
    rows.forEach(function (row) {
      row.input.checked = /-ryker\.html$/.test(row.name);
    });
    Array.prototype.filter.call(sr.querySelectorAll('.foot button'), function (button) {
      return button.textContent.trim() === 'Export as ZIP';
    })[0].click();
    return rows.map(function (row) { return { name: row.name, checked: row.input.checked }; });
  })()`);
  await waitInPage(sess, `!!window.__packageEntries`, 10000, 'with-Ryker package to build');
  const folderPackage = await evaluate(sess, `({
    names: window.__packageEntries.map(function (entry) { return entry.name; }),
    reads: window.__folderReads.slice()
  })`);
  assert(folderRows.some((row) => row.name === 'ryker/dist/ryker.js' && !row.checked),
    'folder-sourced files begin unchecked', JSON.stringify(folderRows));
  assert(folderPackage.names.includes('report-ryker.html') &&
    folderPackage.names.includes('ryker/dist/ryker.js'),
  'the with-Ryker package automatically includes the bundle it loads', JSON.stringify(folderPackage));
  assert(folderPackage.reads.includes('ryker/revisions/'),
    'folder packaging rejects the revision corpus before descending into it',
  JSON.stringify(folderPackage.reads));
}

// Folding many saved records into one instruction set.
//
// The hard case is not deduplication. Records from one page load share a
// session id and are cumulative supersets, so the last supersedes the rest.
// Records from different loads quote different starting text and have to be
// composed. The fixtures reproduce the shape of the real corpus, including
// saveNumber restarting and a legacy session with no sessionId at all.
async function runMerge(sess, file) {
  console.log(`\n${file} (merge)`);
  const code = readFileSync(join(DIST, file), 'utf8');

  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && Ryker.merge)`, 10000, 'the merge module');

  const call = async (records) => evaluate(sess,
    `JSON.parse(JSON.stringify(Ryker.merge.fold(${JSON.stringify(records)})))`);

  // 1. Same explicit session: keep the last, drop the rest, change nothing else.
  const a = await call(RECORDS.SESSION_A);
  assert(a.superseded === 2, 'records sharing a session id collapse to the latest',
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

  // 5. A record with no sessionId still folds by matching content.
  const legacy = await call([].concat(RECORDS.SESSION_B, RECORDS.SESSION_C));
  assert(legacy.inferred === true,
    'a record with no session id is folded but flagged as inferred',
    `inferred was ${legacy.inferred}`);
  assert(legacy.warnings.some((w) => /predate session tracking/i.test(w)),
    'the inferred grouping says so rather than presenting itself as certain');

  // 6. Conservation. The one property that matters more than any individual
  //    rule: every structured edit that goes in has to come out somewhere. This
  //    is the assertion that would have caught the real bug, where a corpus
  //    with no baselineId on any record collapsed into one group and 16 of 17
  //    records were discarded while the fold reported success.
  const all = await call(RECORDS.ALL);
  const acc = all.accounted;
  const out = acc.kept + acc.refused + acc.duplicated + acc.composed +
    acc.cancelled + acc.supersededEdits;
  assert(out === acc.in,
    'every edit that goes into a fold comes out of it somewhere',
    out === acc.in
      ? null
      : `${acc.in} edits in, ${out} accounted for ` +
        `(kept ${acc.kept}, refused ${acc.refused}, duplicate ${acc.duplicated}, ` +
        `composed ${acc.composed}, cancelled ${acc.cancelled}, ` +
        `superseded ${acc.supersededEdits}). The difference is work that vanished.`);

  // 7. The real-corpus shape: many records, not one of them carrying a
  //    sessionId. Every record written before session tracking looks like this.
  const unkeyed = RECORDS.ALL.map(({ sessionId, ...rest }) => rest);
  const noKeys = await call(unkeyed);
  assert(noKeys.superseded === 0,
    'records with no session id are never discarded as superseded',
    noKeys.superseded === 0 ? null
      : `${noKeys.superseded} records dropped, which is the bug the real corpus exposed`);
  const na = noKeys.accounted;
  assert(na.kept + na.refused + na.duplicated + na.composed + na.cancelled +
    na.supersededEdits === na.in,
    'a fold with no session ids anywhere still loses nothing');

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

  const withNotes = await evaluate(sess, `(function () {
    var records = ${JSON.stringify(RECORDS.SESSION_A)};
    records[records.length - 1].saveNotes = [
      { saveNumber: 1, text: 'Match the terminology used by the operations team.' },
      { saveNumber: 3, text: 'The final wording is intentionally less absolute.' }
    ];
    var folded = Ryker.merge.fold(records);
    return { notes: folded.notes, text: Ryker.merge.render(folded) };
  })()`);
  assert(withNotes.notes.length === 2 &&
    withNotes.text.includes('Match the terminology used by the operations team.') &&
    withNotes.text.includes('The final wording is intentionally less absolute.'),
  'save-round context survives record folding and reaches the merged artifact',
  JSON.stringify(withNotes));

  const tagFold = await evaluate(sess, `(function () {
    var records = [
      { documentId: 'tag-doc', baselineId: 'tag-a', savedAt: '2026-08-17T10:00:00Z',
        edits: [{ kind: 'replace', tag: 'H1', beforeTag: 'P', afterTag: 'H1',
          before: 'Document title', after: 'Document title' }] },
      { documentId: 'tag-doc', baselineId: 'tag-b', savedAt: '2026-08-17T10:01:00Z',
        edits: [{ kind: 'replace', tag: 'H2', beforeTag: 'H1', afterTag: 'H2',
          before: 'Document title', after: 'Document title' }] }
    ];
    var folded = Ryker.merge.fold(records);
    return { steps: folded.steps, text: Ryker.merge.render(folded) };
  })()`);
  assert(tagFold.steps.length === 1 && tagFold.steps[0].beforeTag === 'P' &&
    tagFold.steps[0].afterTag === 'H2' && /Change <p> to <h2>/.test(tagFold.text),
  'successive heading-level changes compose without becoming text replacements',
  JSON.stringify(tagFold));

  const independent = await call([
    { documentId: 'same-doc', baselineId: 'same-source', sessionId: 'one',
      savedAt: '2026-08-17T11:00:00Z',
      edits: [{ id: '~one', kind: 'replace', tag: 'P', position: 'the 1st <p>',
        before: 'TBD', after: 'Q3' }] },
    { documentId: 'same-doc', baselineId: 'same-source', sessionId: 'two',
      savedAt: '2026-08-17T11:01:00Z',
      edits: [{ id: '~two', kind: 'replace', tag: 'P', position: 'the 2nd <p>',
        before: 'TBD', after: 'Q3' }] }
  ]);
  assert(independent.superseded === 0 && independent.steps.length === 2,
    'independent sessions on one baseline and identical text retain both targets',
    JSON.stringify(independent));

  const cancelled = await call([
    { documentId: 'same-doc', sessionId: 'insert-session',
      savedAt: '2026-08-17T12:00:00Z',
      edits: [{ id: '@new', kind: 'insert', tag: 'P', position: 'after title',
        before: null, after: 'Temporary paragraph' }] },
    { documentId: 'same-doc', sessionId: 'delete-session',
      savedAt: '2026-08-17T12:01:00Z',
      edits: [{ id: '@new', kind: 'delete', tag: 'P', position: 'after title',
        before: 'Temporary paragraph', after: null }] }
  ]);
  assert(cancelled.steps.length === 0 && cancelled.cancelled === 2,
    'an insert later deleted composes to no instruction instead of an empty insert',
    JSON.stringify(cancelled));
}

async function runSaveNotes(sess, file) {
  console.log(`\n${file} (save comments)`);
  const code = readFileSync(join(DIST, file), 'utf8');

  await navigate(sess, FIXTURE);
  await evaluate(sess, `localStorage.removeItem('ryker:save-notes')`);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && document.getElementById('ryker-root'))`,
    10000, 'Ryker to boot for save-comment checks');

  const prompted = await evaluate(sess, `(function () {
    Ryker.logger.record = function () { return Promise.resolve(true); };
    var root = document.getElementById('ryker-root').shadowRoot;
    var more = root.querySelector('button[aria-label="More actions"]');
    more.click();
    var menuLabels = Array.prototype.map.call(root.querySelectorAll('.menu-item'), function (n) {
      return n.textContent.trim();
    });
    Ryker.menu.close();

    var hit = Ryker.blocks.all()[3];
    hit.node.textContent = 'Save-comment first edit.';
    Ryker.editable.touch();
    Array.prototype.filter.call(root.querySelectorAll('.bar button'), function (b) {
      return b.textContent.trim() === 'Save';
    })[0].click();
    return {
      enabled: Ryker.boot.saveNotesEnabled(),
      menuLabels: menuLabels,
      title: root.querySelector('.modal header h2').textContent,
      textarea: !!root.querySelector('textarea.save-note'),
      buttons: Array.prototype.map.call(root.querySelectorAll('.modal .foot button'), function (b) {
        return b.textContent.trim();
      })
    };
  })()`);
  assert(prompted.enabled && prompted.menuLabels.includes('Disable save comments'),
    'save comments are enabled by default and can be disabled from the ellipsis menu',
    JSON.stringify(prompted));
  assert(prompted.title === 'Add context to this save' && prompted.textarea &&
    prompted.buttons.includes('Save without comment') && prompted.buttons.includes('Save with comment'),
  'Save offers an optional context field without making a comment mandatory',
  JSON.stringify(prompted));

  // With an empty field the two save buttons do exactly the same thing, and a
  // person choosing between them has to read both to discover that. The one
  // that needs a comment appears once there is one, and it wears the brand
  // rather than the grey a toggled toolbar button wears.
  const commentButton = await evaluate(sess, `(function () {
    var root = document.getElementById('ryker-root').shadowRoot;
    var button = Array.prototype.filter.call(root.querySelectorAll('.modal .foot button'), function (b) {
      return b.textContent.trim() === 'Save with comment';
    })[0];
    var field = root.querySelector('textarea.save-note');
    var hiddenWhenEmpty = button.hidden &&
      getComputedStyle(button).display === 'none';
    field.value = '   ';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    var hiddenOnSpaces = button.hidden;
    field.value = 'Worth saying.';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    var shown = !button.hidden && getComputedStyle(button).display !== 'none';
    var brand = getComputedStyle(button).backgroundColor;
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return { hiddenWhenEmpty: hiddenWhenEmpty, hiddenOnSpaces: hiddenOnSpaces,
      shown: shown, primary: button.classList.contains('primary'), brand: brand,
      again: button.hidden };
  })()`);
  assert(commentButton.hiddenWhenEmpty && commentButton.hiddenOnSpaces &&
    commentButton.shown && commentButton.again && commentButton.primary &&
    commentButton.brand === 'rgb(229, 56, 59)',
  'Save with comment is offered only once there is a comment, in the brand colour',
  JSON.stringify(commentButton));

  const saved = await evaluate(sess, `(function () {
    var root = document.getElementById('ryker-root').shadowRoot;
    root.querySelector('textarea.save-note').value =
      'Keep this concise because it appears in the customer-facing summary.';
    Array.prototype.filter.call(root.querySelectorAll('.modal .foot button'), function (b) {
      return b.textContent.trim() === 'Save with comment';
    })[0].click();
    return {
      saves: Ryker.instructions.saveCount(),
      notes: Ryker.instructions.saveNotes(),
      pane: Ryker.pane.value()
    };
  })()`);
  assert(saved.saves === 1 && saved.notes.length === 1 &&
    saved.notes[0].saveNumber === 1 &&
    saved.pane.includes('Keep this concise because it appears in the customer-facing summary.'),
  'the comment is attached to its save round and included in the instruction artifact',
  JSON.stringify(saved));

  const disabled = await evaluate(sess, `(function () {
    var root = document.getElementById('ryker-root').shadowRoot;
    Ryker.boot.setSaveNotesEnabled(false);
    var hit = Ryker.blocks.all()[4];
    hit.node.textContent = 'Save-comment second edit.';
    Ryker.editable.touch();
    Array.prototype.filter.call(root.querySelectorAll('.bar button'), function (b) {
      return b.textContent.trim() === 'Save';
    })[0].click();
    var dialog = Ryker.dialog.isOpen();
    var saves = Ryker.instructions.saveCount();
    var notes = Ryker.instructions.saveNotes();
    var more = root.querySelector('button[aria-label="More actions"]');
    more.click();
    var labels = Array.prototype.map.call(root.querySelectorAll('.menu-item'), function (n) {
      return n.textContent.trim();
    });
    Ryker.menu.close();
    Ryker.boot.setSaveNotesEnabled(true);
    return { dialog: dialog, saves: saves, notes: notes, labels: labels };
  })()`);
  assert(!disabled.dialog && disabled.saves === 2 && disabled.notes.length === 1 &&
    disabled.labels.includes('Enable save comments'),
  'disabling save comments makes Save immediate without inventing an empty note',
  JSON.stringify(disabled));
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
  // Extension-mode document ids are URLs. This reproduces the real path that
  // previously sent ':' and URL slashes into getDirectoryHandle().
  await evaluate(sess, `window.RYKER_CONFIG = {
    RYKER_DOCUMENT_ID: 'https://example.test/articles/report.html?preview=1'
  }`);
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
  assert(afterGrant.paths.every((p) =>
    /^ryker\/revisions\/[A-Za-z0-9._-]+\/[^/]+\.json$/.test(p)),
  'URL document ids become one filesystem-safe revision directory',
  'paths: ' + JSON.stringify(afterGrant.paths));

  // A second save must not re-prompt.
  const second = await evaluate(sess, `(function () {
    Ryker.dialog.closeTop();
    var hit = Ryker.blocks.all()[4];
    hit.node.textContent = 'Second edit for the log test.';
    Ryker.editable.touch();
    Ryker.boot.save(false, 'Keep terminology aligned with the source report.');
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
             changes: (rec.changes || []).length,
             replayIds: (rec.changes || []).every(function (change) { return !!change.id; }),
             hasPrompt: !!rec.prompt, saveNote: rec.saveNote || null,
             saveNotes: rec.saveNotes || [] };
  })()`, 8000, 'a record on the fake disk');

  assert(!!written.baselineId,
    'the written record carries a baselineId',
    'without it the merge cannot tell deduplication from composition');
  assert(written.hasPrompt && written.edits > 0,
    'the record carries both the prose prompt and the structured pairs',
    JSON.stringify(written));
  assert(written.changes > 0 && written.replayIds,
    'the record carries replayable block identities for refresh recovery',
    JSON.stringify(written));
  assert(written.saveNote === 'Keep terminology aligned with the source report.' &&
    written.saveNotes.some((n) => n.text === written.saveNote),
  'the record carries both this round comment and cumulative save context',
  JSON.stringify(written));

  // Opening the browser on the same click path as a slow write must wait for
  // createWritable().close(), rather than briefly and falsely showing no log.
  const immediateBrowse = await evaluate(sess, `(function () {
    Ryker.dialog.closeTop();
    window.__fakeFsWriteDelay = 120;
    var hit = Ryker.blocks.all()[5];
    hit.node.textContent = 'Third edit opened while its log record is closing.';
    Ryker.editable.touch();
    Ryker.boot.save(false, 'Race-check save.');
    Ryker.browser.open();
    return document.getElementById('ryker-root').shadowRoot.textContent;
  })()`);
  assert(immediateBrowse.includes('Reading the folder'),
    'the change-request browser shows a truthful loading state while a save is closing');
  const browsedAfterWrite = await waitInPage(sess, `(function () {
    var text = document.getElementById('ryker-root').shadowRoot.textContent;
    return text.indexOf('Reading the folder') === -1 ? text : null;
  })()`, 5000, 'the change-request browser to wait for the save write');
  assert(/change requests? logged for this document/.test(browsedAfterWrite) &&
    !browsedAfterWrite.includes('No change requests logged'),
    'the change-request browser waits for in-flight writes before listing records');
  await evaluate(sess, `window.__fakeFsWriteDelay = 0; Ryker.dialog.closeTop()`);

  // The status pill was a disabled label once logging was on, so it described
  // something and then refused to show it. It now opens the records it names.
  const pillOpens = await evaluate(sess, `(function () {
    while (Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
    var sr = document.getElementById('ryker-root').shadowRoot;
    var pill = sr.querySelector('.where');
    var label = pill.querySelector('.lbl').textContent;
    var disabled = pill.disabled;
    pill.click();
    var opened = sr.textContent.indexOf('Saved change requests') !== -1;
    while (Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
    return { label: label, disabled: disabled, opened: opened };
  })()`);
  assert(pillOpens.label === 'Saved changes' && !pillOpens.disabled && pillOpens.opened,
    'the saved-changes status pill opens the records it describes instead of sitting inert',
    JSON.stringify(pillOpens));

  // Phase 2 restores granted-folder packaging through the same fs boundary.
  // Put an ordinary source file beside the log, then prove the packager sees
  // that file and does not expose the ryker/ corpus it deliberately skips.
  await evaluate(sess,
    `Ryker.fs.write(Ryker.fs.handle(), 'source-note.txt', 'ordinary package content')`);
  await evaluate(sess, `Ryker.packager.open()`);
  const packageText = await waitInPage(sess, `(function () {
    if (!Ryker.dialog.isOpen()) return null;
    return document.getElementById('ryker-root').shadowRoot.textContent;
  })()`, 5000, 'the granted-folder package dialog');
  assert(packageText.includes('source-note.txt'),
    'the packager lists ordinary files through the shared filesystem',
    packageText.slice(0, 500));
  assert(!/save-\d+\.json/.test(packageText),
    'the packager does not expose change-request records from the granted folder',
    /save-\d+\.json/.test(packageText) ? packageText.slice(0, 500) : null);
  await evaluate(sess, `Ryker.dialog.closeTop()`);

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
       return { removed: n, left: Object.keys(window.__fakeFsDump()) };
     })`);
  assert(cleared.removed >= 1 && JSON.stringify(cleared.left) === JSON.stringify(['source-note.txt']),
    'clearing the log removes every record and leaves unrelated files alone',
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

  // The extension cannot use a content script's page-owned IndexedDB. Its
  // storage adapter must be injectable without changing the logger or any file
  // consumer, which is the seam sow-007 depends on.
  const adapter = await evaluate(sess, `(function () {
    var bag = {};
    Ryker.fs.usePersistence({
      get: function (key) { return Promise.resolve(bag[key] || null); },
      set: function (key, value) { bag[key] = value; return Promise.resolve(true); },
      remove: function (key) { delete bag[key]; return Promise.resolve(true); }
    });
    return Ryker.fs.remember('extension-probe', 'owned-by-extension')
      .then(function () { return Ryker.fs.recall('extension-probe'); })
      .then(function (remembered) {
        return Ryker.fs.forget('extension-probe').then(function () {
          return Ryker.fs.recall('extension-probe').then(function (forgotten) {
            return { remembered: remembered, forgotten: forgotten };
          });
        });
      });
  })()`);
  assert(adapter.remembered === 'owned-by-extension' && adapter.forgotten === null,
    'filesystem handle persistence can be replaced by an extension-owned adapter',
    JSON.stringify(adapter));

  const traversal = await evaluate(sess,
    `Ryker.fs.read(Ryker.fs.handle(), '../outside.txt')
      .then(function () { return false; }, function () { return true; })`);
  assert(traversal === true,
    'filesystem paths cannot escape the folder that was granted');
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

  // A heading moves past a whole unit, not past one element.
  //
  // This was live and reachable from the outline rail's own Move up and Move
  // down. In a document whose headings and paragraphs are flat siblings, which
  // is most exported HTML, the sibling above a heading is the previous
  // section's LAST paragraph. Landing there wedged the moved section between
  // the heading and body above it and left that body stranded at the end,
  // under a heading it had nothing to do with. Moving down did the mirror
  // image of it.
  const units = await evaluate(sess, `(function () {
    var host = document.createElement('div');
    var SEED = '<h3>Alpha head</h3><p>Alpha body</p>' +
      '<h3>Beta head</h3><p>Beta body</p>' +
      '<h3>Gamma head</h3><p>Gamma body</p>';
    host.innerHTML = SEED;
    document.body.appendChild(host);

    function shape() {
      return Array.prototype.map.call(host.children, function (e) {
        return e.textContent.replace(' ', '.');
      }).join(' ');
    }
    function unitFor(text) {
      var head = Array.prototype.filter.call(host.children, function (e) {
        return e.textContent === text;
      })[0];
      return head ? Ryker.outline.unitOf(head) : null;
    }

    var out = {};
    var gamma = unitFor('Gamma head');
    out.unit = gamma ? gamma.map(function (n) { return n.tagName; }).join(',') : 'none';
    out.upSaid = Ryker.move.nudge(gamma, 'up');
    out.up = shape();

    host.innerHTML = SEED;
    out.downSaid = Ryker.move.nudge(unitFor('Alpha head'), 'down');
    out.down = shape();

    // The first unit under its own parent heading still reports the edge
    // rather than silently doing nothing.
    host.innerHTML = SEED;
    out.firstSaid = Ryker.move.nudge(unitFor('Alpha head'), 'up');
    out.first = shape();

    host.parentNode.removeChild(host);
    return out;
  })()`);

  assert(units.unit === 'H3,P',
    'the outline treats a heading and the body under it as one unit',
    units.unit);
  assert(units.upSaid === null && units.up ===
    'Alpha.head Alpha.body Gamma.head Gamma.body Beta.head Beta.body',
  'moving a section up carries it over the whole section above, not over one paragraph',
  `${units.upSaid || 'moved'}: ${units.up}`);
  assert(units.downSaid === null && units.down ===
    'Beta.head Beta.body Alpha.head Alpha.body Gamma.head Gamma.body',
  'moving a section down carries it over the whole section below',
  `${units.downSaid || 'moved'}: ${units.down}`);
  assert(units.first ===
    'Alpha.head Alpha.body Beta.head Beta.body Gamma.head Gamma.body',
  'moving the first section up leaves the document alone',
  `${units.firstSaid || 'moved'}: ${units.first}`);
}

// A move is a change to the ELEMENT tree, and this is the module that says so.
//
// Every shape here was measured failing before units.js existed. Three of them
// damaged the document rather than merely failing to restore: a section move
// hoisted the section's children into the page header, a heading move put the
// <h2> inside the <ul>, and a table move relocated a different section's <h3>.
// All three were invisible to a flat block-order diff, which is why they
// survived so long.
async function runUnits(sess, file) {
  console.log(`\n${file} (the unit tree)`);
  const code = readFileSync(join(DIST, file), 'utf8');

  // Structure AND text, three levels deep. Two list items are identical as
  // tags, so a shape that only recorded tag names could not see them swap.
  const SHAPE = `(function () {
    var out = [];
    (function walk(el, depth) {
      Array.prototype.forEach.call(el.children, function (c) {
        if (c.id === 'ryker-root' || c.tagName === 'SCRIPT' || c.tagName === 'STYLE') return;
        out.push(depth + ':' + c.tagName + (c.id ? '#' + c.id : '') +
          '(' + (c.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 14) + ')');
        if (depth < 3) walk(c, depth + 1);
      });
    })(document.querySelector('main'), 0);
    return out.join(' | ');
  })()`;

  const SHAPES = [
    ['a section moved above another section', 'SECTION',
      `Ryker.move.apply([document.querySelector('#media')], document.querySelector('#intro'), 'before')`],
    ['a table moved into a different section', 'TABLE',
      `Ryker.move.apply([document.querySelector('#data table')], document.querySelector('#grid h3'), 'after')`],
    ['a list moved above the heading that introduces it', 'UL',
      `Ryker.move.apply([document.querySelector('#intro ul')], document.querySelector('#intro h2'), 'before')`],
    ['a heading moved below the list', 'H2',
      `Ryker.move.apply([document.querySelector('#intro h2')], document.querySelector('#intro ul'), 'after')`],
    ['a paragraph moved across a section boundary', 'P',
      `Ryker.move.apply([document.querySelector('#intro p')], document.querySelector('#media dl'), 'after')`],
    ['two list items swapped inside their list', 'LI',
      `Ryker.move.apply([document.querySelector('#intro ul li')], document.querySelector('#intro ul li:last-child'), 'after')`],
    ['a figure moved to the end of its section', 'FIGURE',
      `Ryker.move.apply([document.querySelector('#media figure')], document.querySelector('#media dl'), 'after')`]
  ];

  for (const [what, tag, mover] of SHAPES) {
    await navigate(sess, FIXTURE);
    await evaluate(sess, code);
    await waitInPage(sess, `!!(window.Ryker && Ryker.units && Ryker.editable.baselineOf())`, 10000, 'the unit baseline');
    const out = await evaluate(sess, `(function () {
      while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
      Ryker.units.capture();
      var authored = ${SHAPE};
      var refused = ${mover};
      var moved = ${SHAPE};
      var records = Ryker.units.moves();
      // Discard: the authored tree, exactly, comments and locked blocks included.
      Ryker.units.restore();
      var restored = ${SHAPE};
      var quiet = Ryker.units.moves().length;
      // Recovery: the records alone rebuild what was on screen.
      var replay = Ryker.units.replay(records);
      var replayed = ${SHAPE};
      // And out-and-back is not a move at all.
      Ryker.units.restore();
      return {
        refused: refused, changed: moved !== authored, records: records,
        restores: restored === authored, quiet: quiet, replay: replay,
        replays: replayed === moved, outAndBack: Ryker.units.moves().length
      };
    })()`);

    assert(!out.refused && out.changed && out.records.length === 1 &&
      out.records[0].tag === tag && out.restores && out.quiet === 0 &&
      out.replays && out.replay.applied === 1 && out.replay.missed === 0 &&
      out.outAndBack === 0,
    `${what} is one move: named by element, restored by Discard, replayed by recovery`,
    JSON.stringify(out));
  }

  // Two moves at once, and a move that is undone by hand, which is the property
  // that made deriving moves worth keeping over recording them.
  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && Ryker.units && Ryker.editable.baselineOf())`, 10000, 'the unit baseline');
  const several = await evaluate(sess, `(function () {
    while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
    Ryker.units.capture();
    var authored = ${SHAPE};
    Ryker.move.apply([document.querySelector('#media')], document.querySelector('#intro'), 'before');
    Ryker.move.apply([document.querySelector('#data table')], document.querySelector('#grid h3'), 'after');
    var both = Ryker.units.moves();
    var moved = ${SHAPE};
    Ryker.units.restore();
    Ryker.units.replay(both);
    var rebuilt = ${SHAPE} === moved;
    Ryker.units.restore();

    // Out and back by hand.
    var media = document.querySelector('#media');
    var home = media.nextSibling;
    document.querySelector('main').insertBefore(media, document.querySelector('#intro'));
    var away = Ryker.units.moves().length;
    document.querySelector('main').insertBefore(media, home);
    return { both: both.length, tags: both.map(function (r) { return r.tag; }),
      rebuilt: rebuilt, away: away, home: Ryker.units.moves().length,
      settled: ${SHAPE} === authored };
  })()`);
  assert(several.both === 2 && several.tags.join(',') === 'SECTION,TABLE' &&
    several.rebuilt && several.away === 1 && several.home === 0 && several.settled,
  'two moves are two records, and a unit moved out and back reports nothing at all',
  JSON.stringify(several));

  // The same shapes through the real toolbar path rather than through
  // units.restore() directly. Every one of these failed before: three left the
  // document changed and told the truth about it, and the table left the
  // document changed and reported clean, because moving it to the front of
  // another section leaves the flat block sequence untouched.
  for (const [what, mover] of [
    ['a section', `Ryker.move.apply([document.querySelector('#media')], document.querySelector('#intro'), 'before')`],
    ['a table', `Ryker.move.apply([document.querySelector('#data table')], document.querySelector('#grid h3'), 'after')`],
    ['a list', `Ryker.move.apply([document.querySelector('#intro ul')], document.querySelector('#intro h2'), 'before')`],
    ['a heading', `Ryker.move.apply([document.querySelector('#intro h2')], document.querySelector('#intro ul'), 'after')`],
    ['a list item', `Ryker.move.apply([document.querySelector('#intro ul li')], document.querySelector('#intro ul li:last-child'), 'after')`]
  ]) {
    await navigate(sess, FIXTURE);
    await evaluate(sess, code);
    await waitInPage(sess, `!!(window.Ryker && Ryker.units && Ryker.editable.baselineOf())`, 10000, 'the unit baseline');
    const discard = await evaluate(sess, `(function () {
      while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
      var authored = ${SHAPE};
      var refused = ${mover};
      var moved = ${SHAPE};
      var dirty = Ryker.editable.isDirty();
      Ryker.editable.revertAll();
      return { refused: refused, changed: moved !== authored, dirty: dirty,
        restored: ${SHAPE} === authored, settled: !Ryker.editable.isDirty(),
        after: ${SHAPE} };
    })()`);
    assert(!discard.refused && discard.changed && discard.dirty &&
      discard.restored && discard.settled,
    `moving ${what} marks the document dirty, and Discard puts it back`,
    JSON.stringify(discard));
  }

  // Save, refresh, confirm the restore. This is the path the owner asked about
  // and the one that was doing real damage: a restored section used to arrive
  // with its children hoisted into the page header, and a restored heading
  // arrived INSIDE the list it was moved past.
  for (const [what, mover] of [
    ['a section', `Ryker.move.apply([document.querySelector('#media')], document.querySelector('#intro'), 'before')`],
    ['a table', `Ryker.move.apply([document.querySelector('#data table')], document.querySelector('#grid h3'), 'after')`],
    ['a heading', `Ryker.move.apply([document.querySelector('#intro h2')], document.querySelector('#intro ul'), 'after')`],
    ['a list', `Ryker.move.apply([document.querySelector('#intro ul')], document.querySelector('#intro h2'), 'before')`],
    ['a paragraph across sections', `Ryker.move.apply([document.querySelector('#intro p')], document.querySelector('#media dl'), 'after')`]
  ]) {
    await navigate(sess, FIXTURE);
    await evaluate(sess, `(function () {
      Object.keys(localStorage).filter(function (key) {
        return key.indexOf('ryker:') === 0;
      }).forEach(function (key) { localStorage.removeItem(key); });
    })()`);
    await evaluate(sess, code);
    await waitInPage(sess, `!!(window.Ryker && Ryker.units && Ryker.editable.baselineOf())`,
      10000, 'the unit baseline');
    const drafted = await evaluate(sess, `(async function () {
      while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
      var refused = ${mover};
      var onScreen = ${SHAPE};
      var write = Ryker.logger.record;
      Ryker.logger.record = function () { return Promise.resolve(true); };
      Ryker.boot.save(true);
      Ryker.logger.record = write;
      while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
      await Ryker.recover.checkpoint();
      var draft = await Ryker.recover.draft();
      return { refused: refused, onScreen: onScreen,
        kinds: (draft && draft.moves || []).map(function (m) { return m.kind; }) };
    })()`);

    await navigate(sess, FIXTURE);
    await evaluate(sess, code);
    await waitInPage(sess, `!!(window.Ryker && Ryker.units && Ryker.editable.baselineOf())`,
      10000, 'the unit baseline');
    const restored = await evaluate(sess, `(async function () {
      while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
      var authored = ${SHAPE};
      var draft = await Ryker.recover.draft();
      var applied = draft ? Ryker.recover.apply(draft) : false;
      var alert = null;
      var root = document.getElementById('ryker-root').shadowRoot;
      var head = root.querySelector('.modal header h2');
      if (head) alert = head.textContent;
      while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
      return { found: !!draft, applied: applied, alert: alert,
        authored: authored, now: ${SHAPE} };
    })()`);

    assert(!drafted.refused && drafted.kinds.join(',') === 'unit' &&
      restored.found && restored.applied && restored.alert === 'Changes restored' &&
      restored.now === drafted.onScreen,
    `moving ${what}, saving and refreshing restores the position it was left in`,
    JSON.stringify({ drafted, restored }));
  }

  // The instructions, which are the product. A section move used to emit "Move
  // 3 elements ... Put it first inside the element with id=media", listing the
  // section's own children and telling the reader to put them where they
  // already were. A table move used to emit "Move a <h3>".
  for (const [what, mover, wants] of [
    ['a section', `Ryker.move.apply([document.querySelector('#media')], document.querySelector('#intro'), 'before')`,
      ['Move a <section>', 'It is the one with id="media"',
       'Put it immediately after the 1st <header> inside the document body',
       'as a sibling of it, not inside it']],
    ['a table out of its own scroller', `Ryker.move.apply([document.querySelector('#data table')], document.querySelector('#grid h3'), 'after')`,
      ['Move a <table>', 'Put it immediately after the 1st <h3> inside the section with id="grid"',
       'In the file it is currently the first thing inside the 1st <div> inside the section with id="data"']],
    // What the outline rail actually moves: a report wraps its tables in a
    // horizontal scroller, and taking the table out of it would break the
    // scrolling the report depends on.
    ['a table in the scroller the rail moves',
      `Ryker.move.apply(Ryker.outline.unitOf(document.querySelector('#data .scroll-x')), document.querySelector('#grid h3'), 'after')`,
      ['Move a <div>', 'Put it immediately after the 1st <h3> inside the section with id="grid"',
       'In the file it currently sits just after this text: "The table"']],
    ['a heading', `Ryker.move.apply([document.querySelector('#intro h2')], document.querySelector('#intro ul'), 'after')`,
      ['Move a <h2>', 'Put it immediately after the 1st <ul> inside the section with id="intro"',
       'In the file it is currently the first thing inside the element with id="intro"']]
  ]) {
    await navigate(sess, FIXTURE);
    await evaluate(sess, code);
    await waitInPage(sess, `!!(window.Ryker && Ryker.units && Ryker.editable.baselineOf())`,
      10000, 'the unit baseline');
    const prompt = await evaluate(sess, `(function () {
      while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
      var refused = ${mover};
      Ryker.instructions.record();
      return { refused: refused, text: Ryker.instructions.build() };
    })()`);
    const missing = wants.filter((line) => !prompt.text.includes(line));
    assert(!prompt.refused && !missing.length &&
      prompt.text.includes('1 move(s)') && !/Move \d+ elements/.test(prompt.text),
    `the instruction for moving ${what} names that element and where it ends up`,
    missing.length ? 'missing: ' + JSON.stringify(missing) : JSON.stringify(prompt.refused));
  }

  // The number the toolbar and the save dialog show. A table dragged into
  // another section used to count as no moves at all.
  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && Ryker.units && Ryker.editable.baselineOf())`,
    10000, 'the unit baseline');
  const counted = await evaluate(sess, `(function () {
    while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
    var idle = Ryker.move.count();
    Ryker.move.apply([document.querySelector('#data table')], document.querySelector('#grid h3'), 'after');
    var one = Ryker.move.count();
    Ryker.move.apply([document.querySelector('#media')], document.querySelector('#intro'), 'before');
    var two = Ryker.move.count();
    Ryker.editable.revertAll();
    return { idle: idle, one: one, two: two, back: Ryker.move.count() };
  })()`);
  assert(counted.idle === 0 && counted.one === 1 && counted.two === 2 && counted.back === 0,
    'the move count follows the element tree, so a relocated table is one move',
    JSON.stringify(counted));

  // A record naming something the document no longer has is a miss, not a
  // guess. Placing it anywhere is how a restore damages a document.
  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await waitInPage(sess, `!!(window.Ryker && Ryker.units && Ryker.editable.baselineOf())`, 10000, 'the unit baseline');
  const unresolved = await evaluate(sess, `(function () {
    while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
    Ryker.units.capture();
    var before = ${SHAPE};
    var out = Ryker.units.replay([
      { kind: 'unit', key: 'SECTION:~nothing', parent: null, prev: null, tag: 'SECTION', unit: 'section' },
      { kind: 'unit', key: '#media', parent: '#nowhere', prev: null, tag: 'SECTION', unit: 'section' },
      { kind: 'unit', key: '#media', parent: null, prev: 'H9:~gone', tag: 'SECTION', unit: 'section' }
    ]);
    return { out: out, untouched: ${SHAPE} === before };
  })()`);
  assert(unresolved.out.applied === 0 && unresolved.out.missed === 3 &&
    unresolved.out.skipped.length === 3 && unresolved.untouched,
  'a move whose element, container or anchor is missing is reported, never guessed',
  JSON.stringify(unresolved));
}

// The extension bundle shares every source module with the drop-in but has the
// opposite activation rule: loading the file must do nothing until a toolbar
// click explicitly calls start(). This exercises that boundary in real Chrome
// without granting the test browser standing extension access.
async function runExtension(sess) {
  console.log('\nextension/ryker.js (activation)');
  const code = readFileSync(join(EXTENSION, 'ryker.js'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(EXTENSION, 'manifest.json'), 'utf8'));
  const worker = readFileSync(join(EXTENSION, 'service-worker.js'), 'utf8');

  assert(manifest.manifest_version === 3,
    'the unpacked extension uses Manifest V3');
  assert(manifest.description ===
    'Inline editing for HTML and Markdown. Export your corrections as agent-ready instructions a model can learn from.' &&
    manifest.description.length <= 132,
  'the manifest carries the product description within Chrome\'s 132-character limit',
  `${manifest.description.length} characters: ${manifest.description}`);
  assert(JSON.stringify(manifest.permissions.slice().sort()) ===
    JSON.stringify(['activeTab', 'scripting'].sort()),
    'the manifest declares only the capabilities its activation path uses',
    JSON.stringify(manifest.permissions));
  const iconSizes = ['16', '32', '48', '128'];
  assert(iconSizes.every((size) => manifest.icons[size] === `icons/ryker-${size}.png` &&
    manifest.action.default_icon[size] === manifest.icons[size] &&
    existsSync(join(EXTENSION, manifest.icons[size]))),
  'the extension listing and toolbar action carry every required icon size',
  JSON.stringify({ icons: manifest.icons, action: manifest.action.default_icon }));
  assert(/chrome\.action\.onClicked\.addListener/.test(worker),
    'the service worker activates from the toolbar action');
  assert(/chrome\.tabs\.update/.test(worker) && /getURL\('workspace\.html'\)/.test(worker) &&
    ['workspace.html', 'workspace.css', 'workspace.js'].every((name) => existsSync(join(EXTENSION, name))),
  'protected tabs route to the packaged local-document workspace');
  assert(/Ryker\.boot\.toggle\(\)/.test(worker) && /indexOf\('closed'\)/.test(worker),
    'a second toolbar action closes Ryker and clears its ON state');
  assert(worker.indexOf("func: function () {") < worker.indexOf("files: ['ryker.js']") &&
    /closed-stale/.test(worker) && /Ryker\.shell\.teardown\(\)/.test(worker) &&
    /Ryker\.editable\.disable\(\)/.test(worker),
  'the action retires a stale injected bundle before loading the current one');
  assert(/indexedDB\.open\(STORAGE_DB/.test(worker) &&
    /ryker\.storage\.v1/.test(worker) && /validateKey/.test(worker) &&
    /sender\.id !== chrome\.runtime\.id/.test(worker),
  'the worker owns a validated extension-origin storage protocol');
  const extensionReadme = readFileSync(join(EXTENSION, 'README.md'), 'utf8');
  assert(/Kept in this browser only/.test(code) && /nothing is sent anywhere/.test(code),
    'the shipped bundle tells the reader where records live and that nothing is transmitted');
  assert(/## What Ryker stores/.test(extensionReadme) &&
    /## Clearing data from development builds/.test(extensionReadme) &&
    /GETHSEMANE LLC/.test(extensionReadme) && !/[\u2014\u2013]/.test(extensionReadme),
  'the extension README discloses retention and manual cleanup without an em-dash');
  assert(/runtime\.onConnect/.test(worker) && /workspacePorts\[tabId\]/.test(worker) &&
    !/tabs\.sendMessage\(tab\.id, \{ channel: 'ryker\.workspace\.v1'/.test(worker),
  'the extension-owned workspace toggles through its tab-scoped runtime port without a reload');

  await navigate(sess, FIXTURE + '?token=RYKER_QUERY_SECRET#RYKER_FRAGMENT_SECRET');
  await evaluate(sess, `(function () {
    localStorage.clear();
    window.__rykerDbOpens = [];
    var originalOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name) {
      window.__rykerDbOpens.push(String(name));
      return originalOpen.apply(this, arguments);
    };
  })()`);
  await evaluate(sess, code);
  const storageBoundary = await evaluate(sess, `(function () {
    Ryker.boot.start();
    Ryker.boot.setSaveNotesEnabled(false);
    Ryker.pane.applyWidth(412, true);
    Ryker.rail.applyWidth(332, true);
    return Ryker.extensionStorage.get('preference:save-notes').then(function () {
      return { rejected: false };
    }, function (error) {
      return new Promise(function (resolve) { setTimeout(function () {
        resolve({
          rejected: true,
          error: error.message,
          id: Ryker.config.load().RYKER_DOCUMENT_ID,
          localKeys: Object.keys(localStorage),
          dbOpens: window.__rykerDbOpens.slice()
        });
      }, 30); });
    });
  })()`);
  assert(storageBoundary.rejected && /storage is unavailable/i.test(storageBoundary.error),
    'the page-side extension store rejects visibly when its worker channel is unavailable',
    JSON.stringify(storageBoundary));
  assert(!/RYKER_QUERY_SECRET|RYKER_FRAGMENT_SECRET/.test(storageBoundary.id) &&
    /^web-/.test(storageBoundary.id),
  'extension document identity excludes raw query and fragment secrets', storageBoundary.id);
  assert(storageBoundary.localKeys.length === 0 &&
    !storageBoundary.dbOpens.includes('ryker'),
  'extension activation and preference changes leave host localStorage and IndexedDB untouched',
  JSON.stringify(storageBoundary));

  const ownedRecords = await evaluate(sess, `(function () {
    var bag = {};
    Ryker.extensionStorage = {
      get: function (key) { return Promise.resolve(bag[key] == null ? null : bag[key]); },
      set: function (key, value) { bag[key] = value; return Promise.resolve(true); },
      remove: function (key) { delete bag[key]; return Promise.resolve(true); },
      list: function (prefix) {
        return Promise.resolve(Object.keys(bag).filter(function (key) {
          return key.indexOf(prefix) === 0;
        }).map(function (key) { return { key: key, value: bag[key] }; }));
      }
    };
    var target = Ryker.blocks.all()[3].node;
    target.textContent = 'Extension-owned durable record.';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    Ryker.boot.save(false, 'Storage boundary test.');
    return Ryker.logger.settled().then(function () { return Ryker.recover.checkpoint(); })
      .then(function () { return Promise.all([Ryker.logger.list(), Ryker.recover.draft()]); })
      .then(function (values) {
        return Ryker.logger.read(values[0][0]).then(function (raw) {
          var record = JSON.parse(raw);
          var h = 2166136261;
          String(record.sessionId || 'session').split('').forEach(function (letter) {
            h ^= letter.charCodeAt(0);
            h = Math.imul(h, 16777619);
          });
          var sessionToken = (h >>> 0).toString(36).padStart(7, '0');
          return {
            records: values[0].length,
            draft: !!values[1],
            sessionId: record.sessionId,
            order: record.order && record.order.length,
            localKeys: Object.keys(localStorage),
            storageKeys: Object.keys(bag),
            revisionKey: values[0][0].storageKey,
            sessionScoped: values[0][0].storageKey.indexOf(sessionToken) !== -1
          };
        });
      });
  })()`);
  assert(ownedRecords.records === 1 && ownedRecords.draft && ownedRecords.sessionId &&
    ownedRecords.order > 0 && ownedRecords.localKeys.length === 0 &&
    ownedRecords.sessionScoped &&
    ownedRecords.storageKeys.some((key) => key.indexOf('revision:') === 0) &&
    ownedRecords.storageKeys.some((key) => key.indexOf('recovery:') === 0),
  'extension revisions and recovery drafts are durable through the owned backend without a folder',
  JSON.stringify(ownedRecords));
  assert(ownedRecords.sessionScoped,
  'extension revision keys include session identity so concurrent tabs cannot overwrite one another',
  ownedRecords.revisionKey);

  // Nothing prunes, so the only protection against a full store is telling the
  // person before it fills. Warned once, not once per save: the second and
  // third saves below must stay silent or the warning becomes wallpaper.
  const pressure = await evaluate(sess, `(function () {
    var flashes = [];
    var realFlash = Ryker.pane.flash;
    Ryker.pane.flash = function (message, kind) { flashes.push(String(message)); };
    Ryker.extensionStorage.usage = function () {
      return Promise.resolve({ usage: 95, quota: 100, records: 3 });
    };
    function save(text) {
      var target = Ryker.blocks.all()[3].node;
      target.textContent = text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      Ryker.boot.save(false, 'Pressure ' + text);
      return Ryker.logger.settled();
    }
    return save('one').then(function () { return save('two'); })
      .then(function () { return save('three'); })
      .then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 60); });
      })
      .then(function () {
        Ryker.pane.flash = realFlash;
        return { warnings: flashes.filter(function (m) { return /% full/.test(m); }) };
      });
  })()`);
  assert(pressure.warnings.length === 1 && /95% full/.test(pressure.warnings[0]) &&
    /Export/.test(pressure.warnings[0]),
  'a filling store warns once per session and names export rather than pruning silently',
  JSON.stringify(pressure));

  // Drive the shipped storage protocol in a context that has real IndexedDB.
  // The worker source runs against a stub chrome API and hand-built senders, so
  // what follows is the released code deciding, not a restatement of its rules.
  await navigate(sess, FIXTURE);
  const protocol = await evaluate(sess, `(function () {
    var received = [];
    var chromeStub = {
      runtime: {
        id: 'ryker-test',
        getURL: function (path) { return 'chrome-extension://ryker/' + path; },
        onMessage: { addListener: function (fn) { received.push(fn); } },
        onConnect: { addListener: function () {} }
      },
      action: {
        onClicked: { addListener: function () {} },
        setBadgeBackgroundColor: function () {}, setBadgeText: function () {},
        setTitle: function () {}
      },
      tabs: {}, scripting: {},
      storage: { local: { get: function () { return Promise.resolve({}); } } }
    };
    Function('chrome', ${JSON.stringify(worker)})(chromeStub);
    var listener = received[0];

    // The same derivation, written independently here, so a change to the
    // worker's idea of document identity fails this rather than agreeing with
    // itself.
    function hashPart(value, seed) {
      var h = seed >>> 0;
      for (var i = 0; i < value.length; i++) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(16).padStart(8, '0');
    }
    function docId(url) {
      var parsed = new URL(url);
      var canonical = parsed.origin + parsed.pathname;
      var host = (parsed.hostname || 'document').toLowerCase()
        .replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'document';
      return 'web-' + host + '-' + hashPart(canonical, 2166136261) +
        hashPart(canonical, 2246822519);
    }

    var alpha = { id: 'ryker-test', url: 'https://example.com/alpha?k=SECRET#FRAG',
      tab: { id: 11, url: 'https://example.com/alpha' } };
    var beta = { id: 'ryker-test', url: 'https://example.com/beta',
      tab: { id: 12, url: 'https://example.com/beta' } };
    var workspace = { id: 'ryker-test', url: 'chrome-extension://ryker/workspace.html' };
    var anonymous = { id: 'ryker-test' };
    var idA = docId(alpha.tab.url), idB = docId(beta.tab.url);
    var out = {};

    function send(operation, key, value, sender) {
      return new Promise(function (resolve) {
        var message = { channel: 'ryker.storage.v1', version: 1, operation: operation };
        if (operation !== 'usage') message.key = key;
        if (operation === 'set') message.value = value;
        listener(message, sender, resolve);
      });
    }
    function code(response) {
      return response && response.ok ? 'ok' : (response && response.error && response.error.code) || 'no-response';
    }

    return send('set', 'revision:' + idA + ':a1.json', 'alpha one', alpha)
      .then(function (r) { out.ownWrite = code(r); return send('set', 'revision:' + idB + ':b1.json', 'beta one', beta); })
      .then(function (r) { out.otherWrite = code(r); return send('list', 'revision:' + idA + ':', null, alpha); })
      .then(function (r) { out.ownList = r.ok ? r.value.length : code(r);
                           return send('list', 'revision:' + idB + ':', null, alpha); })
      .then(function (r) { out.crossList = code(r);
                           return send('set', 'revision:' + idB + ':evil.json', 'forged', alpha); })
      .then(function (r) { out.crossWrite = code(r);
                           return send('get', 'revision:' + idB + ':b1.json', null, alpha); })
      .then(function (r) { out.crossRead = code(r);
                           return send('set', 'preference:pane-width', 421, alpha); })
      .then(function (r) { out.globalWrite = code(r);
                           return send('get', 'preference:pane-width', null, beta); })
      .then(function (r) { out.globalShared = r.ok ? r.value : code(r);
                           return send('set', 'preference:rail-closed:' + idB + ':page', {}, alpha); })
      .then(function (r) { out.crossPreference = code(r);
                           return send('set', 'preference:rail-closed:' + idA + ':page', {}, alpha); })
      .then(function (r) { out.ownPreference = code(r);
                           return send('set', 'revision:upload-report-html-1a2b3c:w.json', 'workspace', workspace); })
      .then(function (r) { out.workspaceWrite = code(r);
                           return send('set', 'revision:' + idA + ':x.json', 'anon', anonymous); })
      .then(function (r) { out.anonymousWrite = code(r);
                           return send('usage', null, null, alpha); })
      .then(function (r) { out.usage = r.ok ? r.value : code(r);
                           return send('get', 'revision:' + idA + ':a1.json',
                             null, { id: 'somebody-else', url: alpha.url, tab: alpha.tab }); })
      .then(function (r) { out.untrustedSender = code(r); return out; })
      .then(function (result) {
        indexedDB.deleteDatabase('ryker-extension');
        return result;
      });
  })()`);
  assert(protocol.ownWrite === 'ok' && protocol.ownList === 1 && protocol.ownPreference === 'ok',
    'a sender can read, write and list the records of the document it is actually on',
    JSON.stringify(protocol));
  assert(protocol.crossList === 'key-scope-denied' && protocol.crossWrite === 'key-scope-denied' &&
    protocol.crossRead === 'key-scope-denied' && protocol.crossPreference === 'key-scope-denied',
  'the worker derives the document key from the sender and refuses another document\'s records',
  JSON.stringify(protocol));
  assert(protocol.globalWrite === 'ok' && protocol.globalShared === 421,
    'preferences that belong to the person stay global under the new key scoping',
    JSON.stringify(protocol));
  assert(protocol.workspaceWrite === 'ok' && protocol.anonymousWrite === 'key-scope-denied',
    'extension chrome keeps its own namespace while a sender with no page is refused',
    JSON.stringify(protocol));
  assert(protocol.untrustedSender === 'unauthorized',
    'a sender outside the extension is rejected before any key is considered',
    JSON.stringify(protocol));
  assert(protocol.usage && protocol.usage.records === 1 &&
    typeof protocol.usage.usage === 'number' && typeof protocol.usage.quota === 'number',
  'usage reports the sender\'s own record count and the browser allowance without taking a key',
  JSON.stringify(protocol.usage));

  await navigate(sess, FIXTURE);
  const pristine = await evaluate(sess,
    `'<!DOCTYPE html>\\n' + document.documentElement.outerHTML`);
  await evaluate(sess, code);

  const idle = await evaluate(sess, `({
    surface: Ryker.SURFACE,
    mounted: !!document.getElementById('ryker-root'),
    current: '<!DOCTYPE html>\\n' + document.documentElement.outerHTML
  })`);
  assert(idle.surface === 'extension',
    'the generated extension bundle identifies its surface');
  assert(idle.mounted === false && idle.current === pristine,
    'loading the extension bundle alone leaves the page character-identical');

  const mounted = await evaluate(sess, `(function () {
    Ryker.extensionConfig = { RYKER_DOCUMENT_ID: 'extension-fixture' };
    Ryker.boot.start();
    return {
      roots: document.querySelectorAll('#ryker-root').length,
      id: Ryker.config.load().RYKER_DOCUMENT_ID,
      build: Ryker.BUILD
    };
  })()`);
  assert(mounted.roots === 1 && mounted.id === 'extension-fixture',
    'explicit activation mounts one toolbar with extension-owned configuration',
    JSON.stringify(mounted));

  await evaluate(sess, code);
  const again = await evaluate(sess, `(function () {
    Ryker.boot.start();
    return document.querySelectorAll('#ryker-root').length;
  })()`);
  assert(again === 1,
    'repeated toolbar activation does not mount a second Ryker');

  const toggled = await evaluate(sess, `(function () {
    var target = document.querySelector('main p');
    target.textContent += ' Unsaved toggle check.';
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    var closeResult = Ryker.boot.toggle();
    var root = document.getElementById('ryker-root');
    var closed = {
      result: closeResult,
      active: Ryker.boot.isOpen(),
      display: root.style.display,
      editable: document.querySelectorAll('[contenteditable="true"]').length,
      pushed: document.body.hasAttribute('data-ryker-pushed'),
      text: target.textContent
    };
    var openResult = Ryker.boot.toggle();
    return {
      closed: closed,
      opened: {
        result: openResult,
        active: Ryker.boot.isOpen(),
        roots: document.querySelectorAll('#ryker-root').length,
        editable: document.querySelectorAll('[contenteditable="true"]').length,
        text: target.textContent
      }
    };
  })()`);
  assert(toggled.closed.result === false && toggled.closed.active === false &&
    toggled.closed.display === 'none' && toggled.closed.editable === 0 && !toggled.closed.pushed,
  'the second action hides Ryker, removes editability and restores page layout',
  JSON.stringify(toggled.closed));
  assert(toggled.opened.result === true && toggled.opened.active === true &&
    toggled.opened.roots === 1 && toggled.opened.editable === EXPECTED_EDITABLE,
  'the next action reopens the same single Ryker session', JSON.stringify(toggled.opened));
  assert(toggled.closed.text.endsWith('Unsaved toggle check.') &&
    toggled.opened.text === toggled.closed.text,
  'closing and reopening preserves unsaved page edits');

  await navigate(sess, ARTICLE_FIXTURE);
  await evaluate(sess, code);
  const article = await evaluate(sess, `(function () {
    Ryker.extensionConfig = { RYKER_DOCUMENT_ID: 'nested-article-fixture' };
    Ryker.boot.start();
    var tree = Ryker.outline.tree();
    var root = document.getElementById('ryker-root').shadowRoot;
    var active = root.querySelector('.rail-toggle.on');
    var count = root.querySelector('button.count-only');
    return {
      mode: Ryker.outline.mode(),
      labels: Ryker.outline.rows().map(function (h) { return h.textContent.trim(); }),
      tree: tree.map(function (n) {
        return { label: n.label, children: n.children.map(function (c) {
          return { label: c.label, children: c.children.map(function (g) { return g.label; }) };
        }) };
      }),
      scopeControls: root.querySelectorAll('.rail-scope .scope-choice').length,
      articlePressed: root.querySelector('.scope-choice').getAttribute('aria-pressed'),
      activeBackground: active && getComputedStyle(active).backgroundColor,
      countBackground: getComputedStyle(count).backgroundColor,
      countBorder: getComputedStyle(count).borderTopColor
    };
  })()`);
  assert(article.mode === 'article' && JSON.stringify(article.labels) === JSON.stringify([
    'How the migration worked', 'What was running', 'The smaller service', 'Where it stands now'
  ]), 'article scope finds the nested article and excludes page chrome and hidden duplicate titles',
  JSON.stringify(article));
  assert(article.tree.length === 1 && article.tree[0].children.length === 2 &&
    article.tree[0].children[0].children[0] === 'The smaller service',
  'article headings retain their h1/h2/h3 hierarchy', JSON.stringify(article.tree));
  assert(article.scopeControls === 2 && article.articlePressed === 'true',
    'the outline exposes Article and Full page as a visible scope choice');
  assert(article.activeBackground !== 'rgb(79, 70, 229)',
    'active controls use a neutral treatment instead of the former blue');
  assert(article.countBackground === 'rgba(0, 0, 0, 0)' &&
    article.countBorder === 'rgba(0, 0, 0, 0)',
  'the revision count has no visible outer button container', JSON.stringify(article));

  const page = await evaluate(sess, `(function () {
    Ryker.outline.setMode('page');
    return {
      mode: Ryker.outline.mode(),
      labels: Ryker.outline.rows().map(function (h) { return h.textContent.trim(); }),
      navigational: Ryker.outline.tree().filter(function (row) { return !row.editable; })
        .map(function (row) { return row.label; })
    };
  })()`);
  assert(page.mode === 'page' && page.labels.length === 8 &&
    page.labels.includes('Publisher name') && page.labels.includes('Related stories') &&
    page.labels.includes('About the publisher') && !page.labels.includes('Hidden responsive article title'),
  'Full page scope includes every visible page heading without responsive duplicates', JSON.stringify(page));
  assert(page.navigational.includes('Publisher name'),
    'headings outside editable content remain safe navigation-only outline rows',
  JSON.stringify(page.navigational));

  // Drive the actual service-worker listener with a small Chrome API adapter.
  // Deleting the new toggle method reproduces a tab injected before an unpacked
  // extension reload: the exact state that left the owner's toolbar, pane and
  // editable outlines behind after the badge was clicked off.
  async function clickThroughWorker() {
    let listener = null;
    let badge = null;
    let title = null;
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    const chrome = {
      action: {
        onClicked: { addListener(fn) { listener = fn; } },
        setBadgeBackgroundColor() {},
        setBadgeText(opts) { badge = opts.text; },
        setTitle(opts) { title = opts.title; finish(); }
      },
      runtime: { getURL(path) { return 'chrome-extension://ryker/' + path; } },
      storage: { local: { get() { return Promise.resolve({}); } } },
      scripting: {
        executeScript(opts) {
          if (opts.files) return evaluate(sess, code).then(() => []);
          const source = '(' + opts.func.toString() + ').apply(null,' +
            JSON.stringify(opts.args || []) + ')';
          return evaluate(sess, source).then((result) => [{ result }]);
        }
      }
    };
    Function('chrome', worker)(chrome);
    listener({ id: 7 });
    await Promise.race([
      done,
      new Promise((_, reject) => setTimeout(() => reject(new Error('worker click timed out')), 3000))
    ]);
    return { badge, title };
  }

  await navigate(sess, FIXTURE);
  await evaluate(sess, code);
  await evaluate(sess, `(function () {
    Ryker.extensionConfig = { RYKER_DOCUMENT_ID: 'stale-extension-fixture' };
    Ryker.boot.start();
    delete Ryker.boot.toggle;
  })()`);
  const staleClosedBadge = await clickThroughWorker();
  const staleClosed = await evaluate(sess, `({
    root: !!document.getElementById('ryker-root'),
    css: !!document.getElementById('ryker-document-css'),
    editable: document.querySelectorAll('[contenteditable="true"]').length,
    pushed: document.body.hasAttribute('data-ryker-pushed'),
    ryker: !!window.Ryker
  })`);
  assert(staleClosedBadge.badge === '' && !staleClosed.root && !staleClosed.css &&
    staleClosed.editable === 0 && !staleClosed.pushed && !staleClosed.ryker,
  'an action click fully retires a stale injected Ryker session',
  JSON.stringify({ badge: staleClosedBadge, page: staleClosed }));

  const upgradedBadge = await clickThroughWorker();
  const upgraded = await evaluate(sess, `({
    root: document.querySelectorAll('#ryker-root').length,
    editable: document.querySelectorAll('[contenteditable="true"]').length,
    toggle: !!(window.Ryker && Ryker.boot && Ryker.boot.toggle)
  })`);
  assert(upgradedBadge.badge === 'ON' && upgraded.root === 1 &&
    upgraded.editable === EXPECTED_EDITABLE && upgraded.toggle,
  'the next action loads the current bundle after retiring the stale one',
  JSON.stringify({ badge: upgradedBadge, page: upgraded }));
}

async function runWorkspace(sess) {
  console.log('\nextension/workspace.html (local documents)');

  await navigate(sess, WORKSPACE_FIXTURE);
  await waitInPage(sess, `!!window.RykerWorkspace`, 10000, 'Ryker workspace to initialise');
  const landing = await evaluate(sess, `({
    title: document.querySelector('#workspace-title').textContent,
    accept: document.querySelector('#workspace-file').getAttribute('accept'),
    brand: !!document.querySelector('.workspace-brand img'),
    mounted: !!document.getElementById('ryker-root'),
    theme: {
      shared: !!(Ryker.theme && Ryker.styles.LIGHT === Ryker.theme.cssText),
      rootBg: getComputedStyle(document.documentElement).getPropertyValue('--rk-bg').trim(),
      barBg: getComputedStyle(document.querySelector('.workspace-bar')).backgroundColor,
      muted: getComputedStyle(document.querySelector('.workspace-brand')).color
    }
  })`);
  assert(landing.title === 'Open an HTML or Markdown file' &&
    /\.html/.test(landing.accept) && /\.md/.test(landing.accept) && landing.brand && !landing.mounted,
  'the workspace opens with Ryker branding and an HTML/Markdown file control',
  JSON.stringify(landing));
  assert(landing.theme.shared && landing.theme.rootBg === '#ffffff' &&
    landing.theme.barBg === 'rgb(255, 255, 255)' && landing.theme.muted === 'rgb(107, 114, 128)',
  'the extension workspace and drop-in chrome use the same canonical theme tokens',
  JSON.stringify(landing.theme));

  const workspaceRadius = await evaluate(sess, `(function () {
    document.body.classList.add('workspace-dragging');
    var value = getComputedStyle(document.querySelector('.workspace-open')).borderTopLeftRadius;
    document.body.classList.remove('workspace-dragging');
    return value;
  })()`);
  assert(workspaceRadius === '4px', 'the extension workspace uses the same 4px corner radius',
  workspaceRadius);

  const workspacePreflight = await evaluate(sess, `(async function () {
    var emptyError = null;
    try { await RykerWorkspace.openText('empty.html', ''); }
    catch (error) { emptyError = error.message; }
    var nestedError = null;
    try { await RykerWorkspace.openText('nested.md', '- parent\\n  - child'); }
    catch (error) { nestedError = error.message; }

    var grid = document.createElement('div');
    grid.innerHTML = RykerWorkspace.markdown([
      'A sentence with a | pipe in it.', '',
      '| Item | Owner | Effort |',
      '|:-----|:-----:|-------:|',
      '| Fix the checkout | Ana | 3 |',
      '| Rewrite copy |',
      '| Too | many | cells | here |', '',
      'After the table.'
    ].join('\\n'));
    var body = grid.querySelectorAll('tbody tr');

    var inline = document.createElement('div');
    inline.innerHTML = RykerWorkspace.markdown(
      'Use \`src/__init__.py\` and f(*args, **kwargs). Keep **bold** text.');
    var safe = document.createElement('div');
    safe.innerHTML = RykerWorkspace.safeHtml(
      '<svg viewBox="0 0 10 10"><path id="shape" d="M0 0L10 10" stroke="red"></path>' +
      '<use href="#shape"></use><use href="https://bad.example/x.svg#shape"></use></svg>' +
      '<a href="javascript:alert(1)" ping="https://bad.example" onclick="alert(2)">bad</a>' +
      '<a href="docs/page.html" target="_blank">safe</a>' +
      '<img src="images/chart.png" srcset="evil 2x" onerror="alert(3)" alt="chart">');
    var svg = safe.querySelector('svg');
    var path = safe.querySelector('path');
    var uses = safe.querySelectorAll('use');
    var links = safe.querySelectorAll('a');
    var image = safe.querySelector('img');
    return {
      pickerVisible: !document.getElementById('workspace-open').hidden &&
        document.getElementById('workspace-file').isConnected &&
        !document.body.classList.contains('workspace-loaded'),
      emptyError: emptyError,
      nestedError: nestedError,
      grid: {
        tables: grid.querySelectorAll('table').length,
        headers: Array.prototype.map.call(grid.querySelectorAll('thead th'),
          function (n) { return n.textContent; }),
        align: Array.prototype.map.call(grid.querySelectorAll('thead th'),
          function (n) { return n.style.textAlign; }),
        widths: Array.prototype.map.call(body, function (r) { return r.children.length; }),
        padded: body[1] && body[1].children[2].textContent,
        prose: grid.querySelector('p').textContent,
        trailing: grid.querySelectorAll('p')[1].textContent
      },
      inlineText: inline.textContent,
      inlineCode: inline.querySelector('code') && inline.querySelector('code').textContent,
      inlineEmphasis: inline.querySelectorAll('em').length,
      inlineBold: inline.querySelector('strong') && inline.querySelector('strong').textContent,
      svg: {
        viewBox: svg && svg.getAttribute('viewBox'),
        path: path && path.getAttribute('d'),
        stroke: path && path.getAttribute('stroke'),
        internalUse: uses[0] && uses[0].getAttribute('href'),
        externalUse: uses[1] && uses[1].hasAttribute('href')
      },
      unsafeLink: links[0] && [links[0].hasAttribute('href'), links[0].hasAttribute('ping'),
        links[0].hasAttribute('onclick')],
      safeLink: links[1] && [links[1].getAttribute('href'), links[1].getAttribute('rel')],
      image: image && [image.getAttribute('src'), image.hasAttribute('srcset'),
        image.hasAttribute('onerror'), image.getAttribute('alt')]
    };
  })()`);

  assert(workspacePreflight.pickerVisible && /no displayable content/i.test(workspacePreflight.emptyError),
    'an empty upload fails visibly without removing its own file picker',
    JSON.stringify(workspacePreflight));
  assert(/nested lists/i.test(workspacePreflight.nestedError),
    'unsupported Markdown structures are rejected before they can be flattened',
    JSON.stringify(workspacePreflight));
  assert(workspacePreflight.grid.tables === 1 &&
    JSON.stringify(workspacePreflight.grid.headers) === JSON.stringify(['Item', 'Owner', 'Effort']) &&
    JSON.stringify(workspacePreflight.grid.align) === JSON.stringify(['left', 'center', 'right']) &&
    JSON.stringify(workspacePreflight.grid.widths) === JSON.stringify([3, 3, 3]) &&
    workspacePreflight.grid.padded === '' &&
    workspacePreflight.grid.prose === 'A sentence with a | pipe in it.' &&
    workspacePreflight.grid.trailing === 'After the table.',
  'a Markdown table renders as a real table, squared to its declared columns',
  JSON.stringify(workspacePreflight.grid));
  assert(workspacePreflight.inlineCode === 'src/__init__.py' &&
    workspacePreflight.inlineEmphasis === 0 && workspacePreflight.inlineBold === 'bold' &&
    workspacePreflight.inlineText.includes('f(*args, **kwargs)'),
  'Markdown preserves code spans and ordinary asterisk-prefixed identifiers',
  JSON.stringify(workspacePreflight));
  assert(workspacePreflight.svg.viewBox === '0 0 10 10' &&
    workspacePreflight.svg.path === 'M0 0L10 10' && workspacePreflight.svg.stroke === 'red' &&
    workspacePreflight.svg.internalUse === '#shape' && !workspacePreflight.svg.externalUse &&
    JSON.stringify(workspacePreflight.unsafeLink) === JSON.stringify([false, false, false]) &&
    JSON.stringify(workspacePreflight.safeLink) === JSON.stringify(['docs/page.html', 'noopener noreferrer']) &&
    JSON.stringify(workspacePreflight.image) === JSON.stringify(['images/chart.png', false, false, 'chart']),
  'workspace sanitizing preserves safe SVG/relative assets and strips active or beacon attributes',
  JSON.stringify(workspacePreflight));

  const concurrentWorkspace = await evaluate(sess, `(async function () {
    var first = RykerWorkspace.openText('first.html',
      '<!doctype html><html lang="en"><head><title>First</title></head>' +
      '<body><h1>First document</h1><p>Must not win.</p></body></html>');
    var latest = RykerWorkspace.openText('latest.html',
      '<!doctype html><html lang="fr"><head><title>Latest</title></head>' +
      '<body><h1>Latest document</h1><p>Must win.</p></body></html>');
    var settled = await Promise.all([first, latest]);
    return {
      first: settled[0],
      latest: settled[1],
      heading: document.querySelector('#workspace-document h1').textContent,
      id: Ryker.config.load().RYKER_DOCUMENT_ID,
      path: Ryker.config.load().RYKER_DOCUMENT_PATH,
      title: new DOMParser().parseFromString(Ryker.exportHtml.clean(), 'text/html').title
    };
  })()`);
  assert(concurrentWorkspace.first.superseded && !concurrentWorkspace.latest.superseded &&
    concurrentWorkspace.heading === 'Latest document' &&
    /^upload:latest\.html:/.test(concurrentWorkspace.id) &&
    concurrentWorkspace.path === 'latest.html' && concurrentWorkspace.title === 'Latest',
  'two unresolved workspace opens settle latest-wins without mixing DOM, identity or source shell',
  JSON.stringify(concurrentWorkspace));

  await navigate(sess, WORKSPACE_FIXTURE);
  await waitInPage(sess, `!!window.RykerWorkspace`, 10000,
    'Ryker workspace to reset after the concurrent-open regression');

  const markdown = await evaluate(sess, `RykerWorkspace.openText('notes.md',
    '# Project notes\\n\\nA **prompt-ready** paragraph.\\n\\n- First\\n- Second').then(function (opened) {
      var root = document.getElementById('ryker-root');
      return {
        opened: opened,
        mounted: !!root,
        heading: document.querySelector('#workspace-document h1').textContent,
        strong: document.querySelector('#workspace-document strong').textContent,
        items: document.querySelectorAll('#workspace-document li').length,
        loaded: document.body.classList.contains('workspace-loaded'),
        id: Ryker.config.load().RYKER_DOCUMENT_ID
      };
    })`);
  assert(markdown.mounted && markdown.loaded && markdown.heading === 'Project notes' &&
    markdown.strong === 'prompt-ready' && markdown.items === 2 &&
    /^upload:notes\.md:/.test(markdown.id) && markdown.opened.blocks > 0,
  'opening Markdown renders semantic content under the full Ryker toolbar',
  JSON.stringify(markdown));

  const workspaceExport = await evaluate(sess, `(function () {
    var clean = Ryker.exportHtml.clean();
    var parsed = new DOMParser().parseFromString(clean, 'text/html');
    var withError = null;
    try { Ryker.exportHtml.withRyker(); } catch (error) { withError = error.message; }
    return {
      canAttach: Ryker.exportHtml.canAttach(),
      withError: withError,
      heading: parsed.querySelector('h1') && parsed.querySelector('h1').textContent,
      workspaceChrome: !!parsed.querySelector('#workspace-open, #workspace-document, .workspace-bar'),
      scripts: parsed.querySelectorAll('script').length,
      editable: parsed.querySelectorAll('[contenteditable], .ryker-editing').length
    };
  })()`);
  assert(!workspaceExport.canAttach && /unavailable for extension workspace/i.test(workspaceExport.withError) &&
    workspaceExport.heading === 'Project notes' && !workspaceExport.workspaceChrome &&
    workspaceExport.scripts === 0 && workspaceExport.editable === 0,
  'workspace clean export contains only the uploaded document and never labels inert HTML as attached Ryker',
  JSON.stringify(workspaceExport));

  const firstWorkspaceId = markdown.id;
  const reloaded = sess.once('Page.loadEventFired');
  await sess.send('Runtime.evaluate', {
    expression: `sessionStorage.setItem('ryker:workspace-pending', JSON.stringify({
      name: 'second.html', text: '<h1>Second document</h1><p>Fresh baseline.</p>'
    })); location.reload();`,
    returnByValue: true,
    awaitPromise: false
  });
  await reloaded;
  await waitInPage(sess, `(function () {
    return window.Ryker && document.body.classList.contains('workspace-loaded') &&
      document.querySelector('#workspace-document h1') &&
      document.querySelector('#workspace-document h1').textContent === 'Second document';
  })()`, 10000, 'the second workspace document to boot from a fresh page lifecycle');
  const secondWorkspace = await evaluate(sess, `({
    id: Ryker.config.load().RYKER_DOCUMENT_ID,
    path: Ryker.config.load().RYKER_DOCUMENT_PATH,
    heading: document.querySelector('#workspace-document h1').textContent,
    pending: sessionStorage.getItem('ryker:workspace-pending')
  })`);
  assert(secondWorkspace.id !== firstWorkspaceId && /^upload:second\.html:/.test(secondWorkspace.id) &&
    secondWorkspace.path === 'second.html' && secondWorkspace.heading === 'Second document' &&
    secondWorkspace.pending === null,
  'a second workspace file receives a fresh identity, baseline lifecycle and consumed handoff state',
  JSON.stringify({ firstWorkspaceId, secondWorkspace }));

  await navigate(sess, WORKSPACE_FIXTURE);
  await waitInPage(sess, `!!window.RykerWorkspace`, 10000, 'Ryker workspace to reset');
  const html = await evaluate(sess, `RykerWorkspace.openText('page.html',
    '<!doctype html><html lang="fr-CA" dir="rtl" class="source-shell" data-theme="night" ' +
    'style="background:red" onload="window.__unsafe=true"><head>' +
    '<!-- preserved head note --><meta charset="iso-8859-1">' +
    '<meta name="description" content="Authored summary">' +
    '<meta property="og:title" content="Authored card">' +
    '<meta http-equiv="refresh" content="0;url=https://bad.example">' +
    '<title>Authored page title</title><script>window.__unsafe = true;<\\/script>' +
    '<style>body{display:none}</style><link rel="stylesheet" href="https://bad.example/x.css"></head>' +
    '<body id="source-body" class="report-body" data-audit="q3" aria-label="Audit report" ' +
    'style="position:fixed" onload="window.__unsafe=true"><!-- preserved body note -->' +
    '<script>window.__unsafe = true;<\\/script>' +
    '<h1 onclick="window.__unsafe=true" style="position:fixed">Safe title</h1>' +
    '<p id="ryker-root">Editable collision content.</p></body></html>').then(function (opened) {
      var heading = document.querySelector('#workspace-document h1');
      var collision = document.querySelector('#workspace-document p#ryker-root');
      var clean = new DOMParser().parseFromString(Ryker.exportHtml.clean(), 'text/html');
      return {
        mounted: !!document.querySelector('[data-ryker-host]'),
        unsafe: !!window.__unsafe,
        script: !!document.querySelector('#workspace-document script'),
        onclick: heading && heading.hasAttribute('onclick'),
        style: heading && heading.hasAttribute('style'),
        heading: heading && heading.textContent,
        collisionEditable: collision && collision.getAttribute('contenteditable'),
        collisionExported: !!clean.querySelector('p#ryker-root') &&
          clean.querySelector('p#ryker-root').textContent === 'Editable collision content.',
        shell: {
          title: clean.title,
          lang: clean.documentElement.getAttribute('lang'),
          dir: clean.documentElement.getAttribute('dir'),
          htmlClass: clean.documentElement.getAttribute('class'),
          theme: clean.documentElement.getAttribute('data-theme'),
          bodyId: clean.body.getAttribute('id'),
          bodyClass: clean.body.getAttribute('class'),
          audit: clean.body.getAttribute('data-audit'),
          aria: clean.body.getAttribute('aria-label'),
          charset: clean.querySelector('meta[charset]') &&
            clean.querySelector('meta[charset]').getAttribute('charset'),
          description: clean.querySelector('meta[name="description"]') &&
            clean.querySelector('meta[name="description"]').getAttribute('content'),
          card: clean.querySelector('meta[property="og:title"]') &&
            clean.querySelector('meta[property="og:title"]').getAttribute('content'),
          headComment: clean.head.innerHTML.indexOf('preserved head note') !== -1,
          bodyComment: clean.body.innerHTML.indexOf('preserved body note') !== -1
        },
        active: {
          script: clean.querySelectorAll('script').length,
          style: clean.querySelectorAll('style, link, base').length,
          refresh: clean.querySelectorAll('meta[http-equiv]').length,
          htmlOnload: clean.documentElement.hasAttribute('onload'),
          htmlStyle: clean.documentElement.hasAttribute('style'),
          bodyOnload: clean.body.hasAttribute('onload'),
          bodyStyle: clean.body.hasAttribute('style')
        },
        blocks: opened.blocks
      };
    })`);
  assert(html.mounted && !html.unsafe && !html.script && !html.onclick && !html.style &&
    html.heading === 'Safe title' && html.collisionEditable === 'true' &&
    html.collisionExported && html.blocks > 1,
  'opening HTML removes active content while reserved authored IDs remain editable and exportable',
  JSON.stringify(html));
  assert(html.shell.title === 'Authored page title' && html.shell.lang === 'fr-CA' &&
    html.shell.dir === 'rtl' && html.shell.htmlClass === 'source-shell' &&
    html.shell.theme === 'night' && html.shell.bodyId === 'source-body' &&
    html.shell.bodyClass === 'report-body' && html.shell.audit === 'q3' &&
    html.shell.aria === 'Audit report' && /^utf-?8$/i.test(html.shell.charset) &&
    html.shell.description === 'Authored summary' && html.shell.card === 'Authored card' &&
    html.shell.headComment && html.shell.bodyComment &&
    Object.values(html.active).every(function (value) { return value === 0 || value === false; }),
  'workspace clean export preserves the safe uploaded document shell and strips active shell content',
  JSON.stringify({ shell: html.shell, active: html.active }));

  const worker = readFileSync(join(EXTENSION, 'service-worker.js'), 'utf8');
  let listener = null;
  let redirect = null;
  const chrome = {
    action: { onClicked: { addListener(fn) { listener = fn; } } },
    runtime: { getURL(path) { return 'chrome-extension://ryker/' + path; } },
    tabs: { update(id, options) { redirect = { id, ...options }; } }
  };
  Function('chrome', worker)(chrome);
  listener({ id: 11, url: 'chrome://newtab/' });
  assert(redirect && redirect.id === 11 &&
    redirect.url === 'chrome-extension://ryker/workspace.html',
  'clicking Ryker on New Tab migrates that tab to the local-document workspace',
  JSON.stringify(redirect));
}

const bundles = ['ryker.js'].filter((f) => existsSync(join(DIST, f)));
if (!bundles.length) {
  console.error('No bundle found in drop-in/dist. Run: node drop-in/build/bundle.mjs');
  process.exit(1);
}

const sess = await launch();
try {
  for (const file of bundles) { await runBuild(sess, file); await runBlockTypes(sess, file); await runSanitizer(sess, file); await runEditorHardening(sess, file); await runAutoLists(sess, file); await runAtomicSvg(sess, file); await runRecovery(sess, file); await runMerge(sess, file); await runSaveNotes(sess, file); await runMove(sess, file); await runUnits(sess, file); await runPackager(sess, file); await runLogging(sess, file); await runFailureIsolation(sess, file); }
  await runExtension(sess);
  await runWorkspace(sess);
} finally {
  await sess.close();
}

console.log(`\n${checks - failures}/${checks} checks passed across ${bundles.length} bundle(s).`);
process.exit(failures ? 1 : 0);
