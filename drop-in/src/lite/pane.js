// The instruction pane. Open by default, because in ryker-lite it is the point
// of the tool rather than a panel you go and find.
Ryker.pane = (function () {
  'use strict';

  var node = null, area = null, countEl = null, statusEl = null;
  var dirtyText = false;

  function d() { return Ryker.dom; }

  function build() {
    if (node) return node;

    area = d().el('textarea', {
      class: 'rk pane-text', spellcheck: 'false',
      'aria-label': 'Edit instructions for an AI'
    });
    // Hand-editing is expected: the generated text is a starting point, and a
    // person will want to add context a diff cannot know. So a rebuild must not
    // silently discard what they wrote.
    area.addEventListener('input', function () { dirtyText = true; status(); });

    countEl = d().el('span', { class: 'count' });
    statusEl = d().el('div', { class: 'pane-status' });

    node = d().el('aside', { class: 'pane', role: 'complementary', 'aria-label': 'Ryker instructions' }, [
      d().el('div', { class: 'pane-grip', title: 'Drag to resize', 'aria-hidden': 'true' }),
      d().el('header', {}, [
        d().el('h2', { text: 'Instructions' }),
        countEl,
        d().el('span', { class: 'spacer' }),
        Ryker.icons.button('copy', 'Copy the instructions', copy),
        Ryker.icons.button('download', 'Download as a text file', download),
        Ryker.icons.button('rebuild', 'Rebuild from the edits made this session', function () {
          dirtyText = false;
          refresh(true);
        }),
        // Destructive, so it is last in the row and carries the danger colour
        // rather than sitting quietly among the others. Its confirmation is
        // what actually protects the work; the colour only sets expectations.
        Ryker.icons.button('trash', 'Clear the document and discard every edit',
          confirmClear, 'danger')
      ]),
      d().el('div', { class: 'pane-body' }, [area]),
      statusEl
    ]);
    Ryker.shell.add(node);
    initResize();
    applyWidth(storedWidth());
    refresh(true);
    return node;
  }

  // ---- resizing -----------------------------------------------------------
  //
  // The pane holds a prompt someone is going to read and edit, and how much room
  // that needs depends entirely on the document. Width persists per browser
  // rather than per document, because it is a preference about the tool.

  var WIDTH_KEY = 'ryker:pane-width';
  var MIN_W = 300;

  function storedWidth() {
    var v;
    try { v = parseInt(localStorage.getItem(WIDTH_KEY), 10); } catch (e) { v = NaN; }
    return isNaN(v) ? 430 : v;
  }

  function maxWidth() { return Math.max(MIN_W, document.documentElement.clientWidth - 240); }

  function applyWidth(px, persist) {
    var w = Math.max(MIN_W, Math.min(maxWidth(), Math.round(px)));
    node.style.width = w + 'px';
    if (persist) { try { localStorage.setItem(WIDTH_KEY, String(w)); } catch (e) {} }
    return w;
  }

  function initResize() {
    var grip = node.querySelector('.pane-grip');
    var startX = 0, startW = 0, dragging = false;

    grip.addEventListener('pointerdown', function (e) {
      dragging = true;
      startX = e.clientX;
      startW = node.getBoundingClientRect().width;
      grip.setPointerCapture(e.pointerId);
      node.classList.add('resizing');
      e.preventDefault();
    });
    grip.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      // The pane is anchored right, so dragging left widens it.
      applyWidth(startW + (startX - e.clientX));
      reflow();
    });
    function stop(e) {
      if (!dragging) return;
      dragging = false;
      node.classList.remove('resizing');
      try { grip.releasePointerCapture(e.pointerId); } catch (err) {}
      applyWidth(node.getBoundingClientRect().width, true);
      reflow();
    }
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);

    // Keyboard resizing, because a drag handle is unusable without a pointer.
    grip.setAttribute('tabindex', '0');
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-label', 'Resize the instructions pane');
    grip.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 60 : 20;
      if (e.key === 'ArrowLeft') { applyWidth(node.getBoundingClientRect().width + step, true); reflow(); e.preventDefault(); }
      if (e.key === 'ArrowRight') { applyWidth(node.getBoundingClientRect().width - step, true); reflow(); e.preventDefault(); }
    });
  }

  function status() {
    if (!statusEl) return;
    var n = Ryker.instructions.saveCount();
    statusEl.textContent = dirtyText
      ? 'Edited by hand. Rebuild will replace what you wrote.'
      : (n ? n + ' save(s) this session.' : 'Nothing saved yet this session.');
    statusEl.className = 'pane-status' + (dirtyText ? ' warn' : '');
  }

  function refresh(force) {
    if (!node) return;
    var edits = Ryker.instructions.edits().length;
    countEl.textContent = String(edits);
    countEl.className = 'count' + (edits ? ' warn' : '');
    if (force || !dirtyText) {
      // Rebuilding over hand-written text would throw away context a diff
      // cannot know, so the old version is kept and offered back rather than
      // just overwritten.
      var replaced = dirtyText ? area.value : null;
      area.value = Ryker.instructions.build();
      dirtyText = false;
      if (replaced) { offerUndo(replaced); return; }
    }
    status();
    reflow();
  }

  var undoTimer = null;

  function offerUndo(previous) {
    clearTimeout(undoTimer);
    statusEl.className = 'pane-status warn';
    statusEl.textContent = 'Rebuilt. Your hand-written version was replaced. ';
    statusEl.appendChild(d().el('button', {
      class: 'rk linkish', text: 'Put it back', type: 'button',
      onclick: function () {
        area.value = previous;
        dirtyText = true;
        clearTimeout(undoTimer);
        status();
      }
    }));
    undoTimer = setTimeout(status, 12000);
    reflow();
  }

  // A short-lived message in the status line, for actions with no dialog.
  function flash(message, kind) {
    if (!statusEl) return;
    clearTimeout(undoTimer);
    statusEl.textContent = message;
    statusEl.className = 'pane-status ' + (kind || '');
    undoTimer = setTimeout(status, 2600);
  }

  function copy() {
    var text = area.value;
    var done = function (ok) {
      statusEl.textContent = ok ? 'Copied to the clipboard.' : 'Could not copy. Select the text and copy it.';
      statusEl.className = 'pane-status' + (ok ? ' ok' : ' warn');
      setTimeout(status, 2600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(done); });
    } else {
      fallback(done);
    }
  }

  // Clipboard access is refused outright on some file:// origins, so selecting
  // the text and letting the browser's own copy run is the path that always
  // works.
  function fallback(done) {
    try {
      area.focus();
      area.select();
      done(document.execCommand('copy'));
    } catch (e) { done(false); }
  }

  function download() {
    Ryker.exportHtml.download(area.value,
      Ryker.exportHtml.baseName() + '-instructions.txt', 'text/plain;charset=utf-8');
  }

  // Clearing throws away every edit made this session and cannot be undone,
  // because lite keeps no revisions by design. So the warning leads with the
  // consequence and offers the copy button in the same breath, rather than
  // telling someone to go and do it first.
  function confirmClear() {
    var edits = Ryker.instructions.edits().length;
    if (!edits) {
      Ryker.dialog.alert('Nothing to clear', 'No edits have been made this session.');
      return;
    }
    var copied = d().el('div', { class: 'pane-status' });
    Ryker.dialog.open({
      title: 'Reset the document?',
      body: d().el('div', {}, [
        d().el('p', { text:
          edits + ' block(s) will be discarded. This cannot be undone.' }),
        d().el('p', { class: 'muted', text: 'Save a copy of the instructions first:' }),
        d().el('div', { class: 'acts' }, [
          d().el('button', {
            class: 'rk on', text: 'Copy',
            onclick: function () {
              var t = area.value;
              var ok = function (good) {
                copied.textContent = good
                  ? 'Copied.'
                  : 'Copy failed. Close this and copy from the pane.';
                copied.className = 'pane-status ' + (good ? 'ok' : 'warn');
              };
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(t).then(function () { ok(true); }, function () { ok(false); });
              } else { fallback(ok); }
            }
          }),
          d().el('button', { class: 'rk', text: 'Download', onclick: download })
        ]),
        copied
      ]),
      buttons: [
        { label: 'Cancel', primary: true },
        { label: 'Discard', danger: true, action: doClear }
      ]
    });
  }

  function doClear() {
    Ryker.editable.revertAll();
    Ryker.instructions.reset();
    if (Ryker.recover) Ryker.recover.dismiss();
    dirtyText = false;
    refresh(true);
    Ryker.lite.sync();
    Ryker.dialog.alert('Document reset', 'Every edit from this session has been discarded.', 'ok');
  }

  function reflow() {
    if (node && node.style.display !== 'none') Ryker.shell.setPanelSpace(node);
  }

  function toggle() {
    if (!node) return;
    var open = node.style.display === 'none';
    node.style.display = open ? 'flex' : 'none';
    if (open) reflow(); else Ryker.shell.releasePanelSpace();
    Ryker.lite.sync();
  }

  function isOpen() { return !!node && node.style.display !== 'none'; }
  function value() { return area ? area.value : ''; }

  return {
    build: build, refresh: refresh, toggle: toggle, isOpen: isOpen,
    reflow: reflow, copy: copy, value: value, confirmClear: confirmClear,
    download: download, applyWidth: applyWidth, flash: flash
  };
})();
