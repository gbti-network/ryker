// Making a comment: highlight text, right click, Add comment.
//
// The context menu is overridden only when there is a selection inside the
// report, so right-clicking anything else keeps the browser's own menu. A
// floating action appears on selection as well, which is what covers touch and
// trackpad users, and holding Shift while right-clicking always gives the
// native menu back.
Ryker.select = (function () {
  'use strict';

  var floater = null;
  var pending = null;

  function d() { return Ryker.dom; }

  function init() {
    document.addEventListener('contextmenu', onContext, true);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('scroll', hideFloater, true);
  }

  function usableSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!String(sel).trim()) return null;
    var node = range.commonAncestorContainer;
    var el = node.nodeType === 3 ? node.parentNode : node;
    if (!el || !el.closest) return null;
    if (el.closest('#ryker-root')) return null;
    if (!Ryker.blocks.root().contains(el)) return null;
    return range;
  }

  function onContext(e) {
    if (e.shiftKey) return;
    var range = usableSelection();
    if (!range) return;
    e.preventDefault();
    e.stopPropagation();
    compose(range);
  }

  function onMouseUp() { setTimeout(showFloaterIfUseful, 10); }
  function onKeyUp(e) { if (e.shiftKey || e.key === 'Escape') setTimeout(showFloaterIfUseful, 10); }

  function showFloaterIfUseful() {
    var range = usableSelection();
    if (!range) { hideFloater(); return; }
    var rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { hideFloater(); return; }
    if (!floater) {
      floater = d().el('button', { class: 'floater', type: 'button',
        onclick: function () {
          var r = pending;
          hideFloater();
          if (r) compose(r);
        }
      }, [
        d().el('span', { class: 'fdot' }),
        d().el('span', { text: 'Comment' })
      ]);
      Ryker.shell.add(floater);
    }
    pending = range.cloneRange();
    floater.style.display = '';

    // Anchored to the top right of the selection. Measured after it is visible,
    // because the button's own width decides where its right edge can sit, and
    // clamped so a selection at the edge of the viewport does not push it off.
    var w = floater.offsetWidth || 108;
    var h = floater.offsetHeight || 30;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, rect.right - w));
    var top = rect.top - h - 8;
    if (top < 8) top = Math.min(window.innerHeight - h - 8, rect.bottom + 8);
    floater.style.left = left + 'px';
    floater.style.top = top + 'px';
  }

  function hideFloater() {
    if (floater) floater.style.display = 'none';
    pending = null;
  }

  function compose(range) {
    hideFloater();
    var quote = String(range).replace(/\s+/g, ' ').trim();
    var box = d().el('textarea', { class: 'rk', rows: '4', placeholder: 'Your comment' });

    Ryker.dialog.open({
      title: 'Add a comment',
      body: d().el('div', {}, [
        d().el('div', { class: 'quote', text: '“' + trim(quote) + '”' }),
        d().el('label', { class: 'rk', text: 'Comment' }),
        box,
        d().el('div', { class: 'note' }, [
          d().el('div', {
            text: 'Anchored to the quoted words plus the text around them, not to a position, ' +
              'so it survives edits elsewhere in the document. If the words themselves go, the ' +
              'comment is listed as unanchored rather than moved to something else.'
          })
        ])
      ]),
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Add comment', primary: true,
          action: function () {
            var body = box.value.trim();
            if (!body) return false;
            if (Ryker.identity.needsName()) {
              Ryker.identity.promptForName(function () { finish(range, body); });
              return;
            }
            finish(range, body);
          }
        }
      ]
    });
    setTimeout(function () { box.focus(); }, 30);
  }

  function finish(range, body) {
    var c = Ryker.comments.add(range, body, Ryker.identity.current());
    if (!c) {
      Ryker.dialog.alert('Could not anchor that',
        'The selection could not be turned into a stable anchor. Try selecting inside a single ' +
        'paragraph rather than across several.', 'warn');
      return;
    }
    Ryker.comments.setActive(c.id);
    Ryker.toolbar.sync();
    Ryker.panel.open('comments');
    window.getSelection().removeAllRanges();
  }

  function trim(s) { return s.length > 140 ? s.slice(0, 137) + '...' : s; }

  return { init: init, hideFloater: hideFloater, compose: compose };
})();
