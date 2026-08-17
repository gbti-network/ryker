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
  assert(/change request\(s\) logged for this document/.test(browsedAfterWrite) &&
    !browsedAfterWrite.includes('No durable change-request records'),
    'the change-request browser waits for in-flight writes before listing records');
  await evaluate(sess, `window.__fakeFsWriteDelay = 0; Ryker.dialog.closeTop()`);

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
    'Ryker adds inline editing to HTML and Markdown, saving changes directly or exporting prompt-ready machine-readable change requests.' &&
    manifest.description.length <= 132,
  'the manifest carries the product description within Chrome\'s 132-character limit',
  `${manifest.description.length} characters: ${manifest.description}`);
  assert(['activeTab', 'scripting', 'storage'].every((p) => manifest.permissions.includes(p)),
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
  'the extension workspace and Ryker Lite chrome use the same canonical theme tokens',
  JSON.stringify(landing.theme));

  const workspaceRadius = await evaluate(sess, `(function () {
    document.body.classList.add('workspace-dragging');
    var value = getComputedStyle(document.querySelector('.workspace-open')).borderTopLeftRadius;
    document.body.classList.remove('workspace-dragging');
    return value;
  })()`);
  assert(workspaceRadius === '4px', 'the extension workspace uses the same 4px corner radius',
  workspaceRadius);

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

  await navigate(sess, WORKSPACE_FIXTURE);
  await waitInPage(sess, `!!window.RykerWorkspace`, 10000, 'Ryker workspace to reset');
  const html = await evaluate(sess, `RykerWorkspace.openText('page.html',
    '<!doctype html><html><body><script>window.__unsafe = true;<\\/script>' +
    '<h1 onclick="window.__unsafe=true" style="position:fixed">Safe title</h1>' +
    '<p>Editable body.</p></body></html>').then(function (opened) {
      var heading = document.querySelector('#workspace-document h1');
      return {
        mounted: !!document.getElementById('ryker-root'),
        unsafe: !!window.__unsafe,
        script: !!document.querySelector('#workspace-document script'),
        onclick: heading && heading.hasAttribute('onclick'),
        style: heading && heading.hasAttribute('style'),
        heading: heading && heading.textContent,
        blocks: opened.blocks
      };
    })`);
  assert(html.mounted && !html.unsafe && !html.script && !html.onclick && !html.style &&
    html.heading === 'Safe title' && html.blocks > 0,
  'opening HTML removes active content before enabling inline editing',
  JSON.stringify(html));

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
  for (const file of bundles) { await runBuild(sess, file); await runBlockTypes(sess, file); await runAutoLists(sess, file); await runAtomicSvg(sess, file); await runRecovery(sess, file); await runMerge(sess, file); await runSaveNotes(sess, file); await runMove(sess, file); await runPackager(sess, file); await runLogging(sess, file); await runFailureIsolation(sess, file); }
  await runExtension(sess);
  await runWorkspace(sess);
} finally {
  await sess.close();
}

console.log(`\n${checks - failures}/${checks} checks passed across ${bundles.length} bundle(s).`);
process.exit(failures ? 1 : 0);
