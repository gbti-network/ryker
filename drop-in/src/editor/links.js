// Making and editing links.
//
// Creating one was already possible. Editing one was not: the only route was to
// select the words, relink them, and hope the old anchor collapsed cleanly. That
// is a poor trade in a document whose whole subject is where links point, and it
// meant the one thing most likely to need correcting was the one thing the
// editor could not do.
//
// So both halves are editable, the text and the destination, and an existing
// link is changed in place rather than torn down and rebuilt. Editing in place
// keeps the anchor's other attributes, which matters here: these reports set
// target and rel on every outbound link, and a rebuilt anchor loses them.
Ryker.links = (function () {
  'use strict';

  function d() { return Ryker.dom; }

  // The anchor the caret sits in, if it is inside something editable.
  function at(node) {
    if (!node) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      node = sel.getRangeAt(0).commonAncestorContainer;
    }
    if (node.nodeType === 3) node = node.parentNode;
    if (!node || !node.closest) return null;
    if (Ryker.shell && Ryker.shell.owns(node)) return null;
    var a = node.closest('a');
    if (!a) return null;
    return a.closest('[contenteditable="true"]') ? a : null;
  }

  function blockOf(a) {
    return a && a.closest ? a.closest('[contenteditable="true"]') : null;
  }

  // ---- editing an existing link ------------------------------------------

  function edit(a) {
    var block = blockOf(a);
    if (!block) return false;

    var beforeHtml = block.innerHTML;
    var text = d().el('input', { class: 'rk', type: 'text' });
    var url = d().el('input', { class: 'rk', type: 'url', placeholder: 'https://' });
    text.value = Ryker.dom.textOf(a);
    url.value = a.getAttribute('href') || '';

    Ryker.dialog.open({
      title: 'Edit link',
      body: d().el('div', {}, [
        d().el('label', { class: 'rk', text: 'Text' }),
        text,
        d().el('label', { class: 'rk', text: 'Destination' }),
        url
      ]),
      buttons: [
        { label: 'Cancel' },
        { label: 'Remove link', action: function () { unwrap(a, block, beforeHtml); } },
        { label: 'Save', primary: true, action: function () {
            return commit(a, block, beforeHtml, text.value, url.value);
          } }
      ]
    });
    setTimeout(function () { text.focus(); text.select(); }, 30);
    return true;
  }

  function commit(a, block, beforeHtml, newText, newUrl) {
    var href = String(newUrl || '').trim();
    var label = String(newText || '').trim();

    if (!href) { refuse('A link needs a destination.'); return false; }
    if (!label) { refuse('A link needs text, or it cannot be clicked.'); return false; }
    if (Ryker.sanitize.badUrl(href)) {
      refuse('Only http, https, mailto, tel and in-page links are allowed.');
      return false;
    }

    a.setAttribute('href', href);
    // Only the text is replaced, so any markup inside the anchor goes with it.
    // That is the honest reading of "edit the text of this link", and anything
    // subtler would silently keep formatting the person just typed over.
    a.textContent = label;
    finish(block, beforeHtml);
    return true;
  }

  // Removing the link keeps the words. Deleting both is what Backspace is for,
  // and conflating the two loses a sentence to a mis-click.
  function unwrap(a, block, beforeHtml) {
    var host = a.parentNode;
    while (a.firstChild) host.insertBefore(a.firstChild, a);
    host.removeChild(a);
    if (host.normalize) host.normalize();
    finish(block, beforeHtml);
  }

  function finish(block, beforeHtml) {
    Ryker.sanitize.element(block);
    var afterHtml = block.innerHTML;
    Ryker.history.record({
      label: 'link',
      undo: function () { block.innerHTML = beforeHtml; },
      redo: function () { block.innerHTML = afterHtml; }
    });
    block.classList.add('ryker-dirty');
    Ryker.editable.touch();
  }

  function refuse(why) {
    Ryker.dialog.alert('That link was refused', why, 'bad');
  }

  // ---- creating a new one -------------------------------------------------

  function create(range) {
    var sel = window.getSelection();
    var saved = range || (sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null);
    if (!saved || saved.collapsed) return false;

    var node = saved.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    var block = node && node.closest ? node.closest('[contenteditable="true"]') : null;
    if (!block) return false;

    var beforeHtml = block.innerHTML;
    var text = d().el('input', { class: 'rk', type: 'text' });
    var url = d().el('input', { class: 'rk', type: 'url', placeholder: 'https://' });
    text.value = String(saved).trim();

    Ryker.dialog.open({
      title: 'Add link',
      body: d().el('div', {}, [
        d().el('label', { class: 'rk', text: 'Text' }),
        text,
        d().el('label', { class: 'rk', text: 'Destination' }),
        url
      ]),
      buttons: [
        { label: 'Cancel' },
        { label: 'Add', primary: true, action: function () {
            var href = String(url.value || '').trim();
            var label = String(text.value || '').trim();
            if (!href) { refuse('A link needs a destination.'); return false; }
            if (!label) { refuse('A link needs text.'); return false; }
            if (Ryker.sanitize.badUrl(href)) {
              refuse('Only http, https, mailto, tel and in-page links are allowed.');
              return false;
            }
            var made = document.createElement('a');
            made.setAttribute('href', href);
            made.textContent = label;
            saved.deleteContents();
            saved.insertNode(made);
            finish(block, beforeHtml);
            return true;
          } }
      ]
    });
    setTimeout(function () { url.focus(); }, 30);
    return true;
  }

  // What the toolbar button should do, given where the caret is.
  function open(range) {
    var a = at(null);
    return a ? edit(a) : create(range);
  }

  return { at: at, edit: edit, create: create, open: open };
})();
