// The formatting toolbar, floating over the selection.
//
// It used to be a fixed row under the main toolbar, which cost vertical space
// permanently and sat a long way from the words being formatted. Hovering it
// over the selection puts the controls where the eye already is, and takes no
// room at all when nothing is selected.
Ryker.formatbar = (function () {
  'use strict';

  var node = null, typeBtn = null, killBtn = null, linkBtn = null;
  var lastRange = null;
  var formatParts = [];

  function d() { return Ryker.dom; }

  function init() {
    document.addEventListener('mouseup', function () { setTimeout(update, 10); });
    document.addEventListener('keyup', function (e) {
      if (e.shiftKey || e.key === 'Escape' || e.key.indexOf('Arrow') === 0) setTimeout(update, 10);
    });
    document.addEventListener('scroll', hide, true);
    document.addEventListener('selectionchange', function () { setTimeout(update, 30); });
    // selectionchange does not fire for a pick, so the pick announces itself.
    if (Ryker.pick) Ryker.pick.onChange(function () { setTimeout(update, 0); });
  }

  function build() {
    if (node) return node;

    // Mousedown is prevented on the bar itself so the selection survives the
    // press. Without it the browser moves focus first and collapses the range
    // being formatted.
    function act(label, title, run, icon) {
      var b = icon
        ? Ryker.icons.button(icon, title, null, 'fb-btn')
        : d().el('button', { class: 'rk fb-btn', text: label, title: title, type: 'button' });
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function (e) {
        e.preventDefault();
        restore();
        run();
        setTimeout(update, 10);
      });
      return b;
    }

    function face(btn, cls) { btn.classList.add(cls); return btn; }

    // Block type first, because changing what a block IS matters more than how
    // its words look, and because a heading collapsed by accident needs an
    // obvious way back.
    typeBtn = d().el('button', { class: 'rk fb-btn fb-type', type: 'button',
      title: 'Change the block type', 'aria-haspopup': 'menu' });
    typeBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    Ryker.menu.attach(typeBtn, [
      { label: 'Paragraph', run: function () { retype('P'); } },
      { label: 'Heading 1', run: function () { retype('H1'); } },
      { label: 'Heading 2', run: function () { retype('H2'); } },
      { label: 'Heading 3', run: function () { retype('H3'); } },
      { label: 'Heading 4', run: function () { retype('H4'); } },
      { label: 'Heading 5', run: function () { retype('H5'); } }
    ]);

    // Destructive, so it is last, separated, and says how much it will take.
    killBtn = act(null, 'Delete', function () {
      if (!Ryker.multi) return;
      if (Ryker.multi.covered().length) Ryker.multi.removeSelection();
      else Ryker.multi.removeTableAt(currentBlock());
      hide();
    }, 'trash');
    killBtn.classList.add('fb-kill');

    formatParts = [
      typeBtn,
      d().el('span', { class: 'fb-sep' }),
      act('B', 'Bold', function () { Ryker.editable.format('bold'); }),
      face(act('I', 'Italic', function () { Ryker.editable.format('italic'); }), 'fb-i'),
      face(act('S', 'Strikethrough', function () { Ryker.editable.format('strikeThrough'); }), 'fb-s'),
      d().el('span', { class: 'fb-sep' }),
      linkBtn = act(null, 'Link', function () { Ryker.links.open(lastRange); }, 'link'),
      act(null, 'Remove formatting', function () { Ryker.editable.format('removeFormat'); }, 'unlink')
    ];

    node = d().el('div', { class: 'formatbar', role: 'toolbar', 'aria-label': 'Formatting' },
      formatParts.concat([d().el('span', { class: 'fb-sep fb-kill-sep' }), killBtn]));
    node.style.display = 'none';
    node.addEventListener('mousedown', function (e) { e.preventDefault(); });
    Ryker.shell.add(node);
    return node;
  }

  function currentBlock() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var n = sel.getRangeAt(0).commonAncestorContainer;
    if (n.nodeType === 3) n = n.parentNode;
    return n && n.closest ? n.closest('[contenteditable="true"]') : null;
  }

  function retype(tag) {
    restore();
    var block = currentBlock();
    if (!block) return;
    if (!Ryker.editable.convert(block, tag)) {
      Ryker.dialog.alert('Cannot change this block',
        'Table cells and list items keep their type, because changing it would ' +
        'break the structure around them.', 'warn');
      return;
    }
    hide();
  }

  var LABEL = { P: 'Paragraph', H1: 'H1', H2: 'H2', H3: 'H3', H4: 'H4', H5: 'H5' };

  function editableSelection() {
    if (!Ryker.editable.isOn()) return null;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    if (!String(sel).trim()) return null;
    var n = sel.getRangeAt(0).commonAncestorContainer;
    if (n.nodeType === 3) n = n.parentNode;
    if (!n || !n.closest) return null;
    if (n.closest('#ryker-root')) return null;
    if (!n.closest('[contenteditable="true"]')) return null;
    return sel.getRangeAt(0);
  }

  // A selection spanning several blocks belongs to no editing host, so the
  // formatting controls have nothing to act on. The bar still appears, carrying
  // only the one action that makes sense at that scale.
  function spanning() {
    if (!Ryker.multi || !Ryker.editable.isOn()) return [];
    // No native-selection test. A pick leaves no Range at all, which is the
    // whole point, so requiring one hid this branch permanently.
    return Ryker.multi.covered();
  }

  function update() {
    // Not mid-drag: the bar would flash under the moving pointer.
    if (Ryker.pick && Ryker.pick.isEngaged()) { hide(); return; }
    var many = spanning();
    var range = editableSelection();
    var link = (!range && !many.length && Ryker.links) ? Ryker.links.at(null) : null;
    if (!range && !many.length && !link) { hide(); return; }
    build();

    if (range) lastRange = range.cloneRange();
    // getRangeAt(0) throws when rangeCount is 0, which is exactly the state a
    // pick leaves behind, so the picked set supplies its own box instead.
    var rect = range ? range.getBoundingClientRect()
             : (link ? link.getBoundingClientRect() : Ryker.pick.rect());
    if (!rect || (!rect.width && !rect.height)) { hide(); return; }

    var block = range ? currentBlock() : null;
    var table = Ryker.multi && block ? Ryker.multi.tableAt(block) : null;
    var atomic = many.length === 1 && Ryker.blocks.atomic(many[0]);
    var wide = many.length > 1 || atomic;

    // Three modes. A picked run of blocks gets only Delete, a caret resting in
    // a link gets only the link control, and ordinary selected text gets the
    // formatting set.
    formatParts.forEach(function (n) {
      n.style.display = wide ? 'none' : (link && n !== linkBtn ? 'none' : '');
    });
    if (link) Ryker.tooltip.attach(linkBtn, 'Edit this link');
    else Ryker.tooltip.attach(linkBtn, 'Link the selected text');
    var show = wide || !!table;
    killBtn.style.display = show ? '' : 'none';
    node.querySelector('.fb-kill-sep').style.display = (show && !wide) ? '' : 'none';
    if (show) {
      Ryker.tooltip.attach(killBtn,
        atomic ? 'Delete this whole SVG' :
          (many.length > 1 ? 'Delete the ' + many.length + ' selected blocks' : 'Delete this whole table'));
    }

    if (!wide && !link) {
      var type = Ryker.editable.blockTypeOf(block);
      typeBtn.textContent = type ? (LABEL[type] || type) : 'Block';
      typeBtn.disabled = !type;
    }

    node.style.display = 'flex';
    var w = node.offsetWidth || 210;
    var h = node.offsetHeight || 34;
    var left = Math.min(window.innerWidth - w - 8,
      Math.max(8, rect.left + (rect.width / 2) - (w / 2)));
    var top = rect.top - h - 9;
    // Flip below when the selection is near the top of the viewport, which is
    // also where the toolbar sits.
    var ceiling = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ryker-offset')) || 0;
    if (top < ceiling + 6) top = Math.min(window.innerHeight - h - 8, rect.bottom + 9);
    node.style.left = Math.round(left) + 'px';
    node.style.top = Math.round(top) + 'px';
  }

  function restore() {
    if (!lastRange) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(lastRange);
  }

  function hide() {
    if (node) node.style.display = 'none';
  }

  function isOpen() { return !!node && node.style.display !== 'none'; }

  return { init: init, update: update, hide: hide, isOpen: isOpen, build: build };
})();
