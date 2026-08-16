// A small dropdown, for the actions that do not earn a permanent button.
Ryker.menu = (function () {
  'use strict';

  var open = null;

  function d() { return Ryker.dom; }

  // items: [{ label, icon, run, danger }] or null for a divider
  function attach(button, items) {
    button.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (open) { close(); return; }
      show(button, items);
    });
    return button;
  }

  function show(anchor, items) {
    var list = d().el('div', { class: 'menu', role: 'menu' });
    items.forEach(function (item) {
      if (!item) { list.appendChild(d().el('span', { class: 'menu-sep' })); return; }
      // A disabled row is a statement of fact, not an action. It carries no run
      // and must not be given one, since calling item.run() unconditionally is
      // how a state row turns into a thrown error.
      var row = d().el('button', {
        class: 'menu-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' off' : ''),
        role: 'menuitem', type: 'button',
        onclick: function () {
          if (item.disabled || typeof item.run !== 'function') return;
          close();
          item.run();
        }
      });
      if (item.disabled) row.setAttribute('aria-disabled', 'true');
      if (item.icon) {
        var ic = d().el('span', { class: 'menu-ico' });
        ic.innerHTML = Ryker.icons.svg(item.icon, 15);
        row.appendChild(ic);
      }
      row.appendChild(d().el('span', { text: item.label }));
      list.appendChild(row);
    });

    Ryker.shell.add(list);
    var w = list.offsetWidth || 190;
    var h = list.offsetHeight || 80;
    var top, left;
    if (anchor && anchor.nodeType === 1) {
      var r = anchor.getBoundingClientRect();
      top = r.bottom + 6;
      left = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
    } else {
      // A point, from a right-click. Flip rather than run off the edge.
      top = anchor.y + 2;
      left = anchor.x + 2;
      if (top + h > window.innerHeight - 8) top = Math.max(8, anchor.y - h - 2);
      if (left + w > window.innerWidth - 8) left = Math.max(8, anchor.x - w - 2);
    }
    list.style.top = Math.round(top) + 'px';
    list.style.left = Math.round(left) + 'px';

    open = { node: list, anchor: anchor };
    if (anchor && anchor.nodeType === 1) anchor.setAttribute('aria-expanded', 'true');
    setTimeout(function () {
      document.addEventListener('mousedown', onAway, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    var first = list.querySelector('.menu-item');
    if (first) first.focus();
  }

  function onAway(e) {
    if (!open) return;
    // The menu lives in a shadow root, so a click inside it reports the host as
    // its target in the light DOM. composedPath is the only reliable test.
    var path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(open.node) !== -1 || path.indexOf(open.anchor) !== -1) return;
    close();
  }

  function onKey(e) {
    if (e.key === 'Escape' && open) { close(); e.stopPropagation(); e.preventDefault(); }
  }

  function close() {
    if (!open) return;
    if (open.node.parentNode) open.node.parentNode.removeChild(open.node);
    if (open.anchor && open.anchor.nodeType === 1) {
      open.anchor.setAttribute('aria-expanded', 'false');
    }
    open = null;
    document.removeEventListener('mousedown', onAway, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function isOpen() { return !!open; }

  function at(x, y, items) { return show({ x: x, y: y }, items); }

  return { at: at, attach: attach, close: close, isOpen: isOpen };
})();
