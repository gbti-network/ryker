// Instant tooltips for Ryker's own controls.
//
// The native title attribute waits about a second before showing, which is too
// slow to help someone scanning a row of icon buttons, and its styling cannot be
// matched to the rest of the interface. Elements carrying data-tip get this one
// instead, and their title is removed so the browser's version does not appear
// alongside it.
Ryker.tooltip = (function () {
  'use strict';

  var tip = null;
  var current = null;

  function ensure() {
    if (tip) return tip;
    tip = Ryker.dom.el('div', { class: 'rk-tip', role: 'tooltip' });
    tip.style.display = 'none';
    Ryker.shell.add(tip);
    return tip;
  }

  // The label becomes the accessible name too, so an icon-only button is still
  // announced. Losing that in exchange for a prettier tooltip would be a bad
  // trade.
  function attach(node, label) {
    if (!node || !label) return node;
    node.setAttribute('data-tip', label);
    node.removeAttribute('title');
    if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', label);
    return node;
  }

  function show(node) {
    var label = node.getAttribute('data-tip');
    if (!label) return;
    current = node;
    ensure();
    tip.textContent = label;
    tip.style.display = 'block';
    tip.style.left = '-9999px';

    var r = node.getBoundingClientRect();
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(document.documentElement.clientWidth - w - 6,
      Math.max(6, r.left + (r.width / 2) - (w / 2)));
    var top = r.bottom + 7;
    // Flip above when there is no room below, which is where a toolbar button
    // near the bottom of the window ends up.
    if (top + h > window.innerHeight - 6) top = Math.max(6, r.top - h - 7);
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  function hide() {
    current = null;
    if (tip) tip.style.display = 'none';
  }

  // Delegated from the shadow layer, so a control added later needs no wiring.
  function init() {
    var layer = Ryker.shell.root();
    ['mouseover', 'focusin'].forEach(function (type) {
      layer.addEventListener(type, function (e) {
        var n = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
        if (n && n !== current) show(n);
      }, true);
    });
    ['mouseout', 'focusout', 'mousedown', 'click'].forEach(function (type) {
      layer.addEventListener(type, function (e) {
        if (type === 'mouseout') {
          var to = e.relatedTarget;
          if (to && to.closest && to.closest('[data-tip]') === current) return;
        }
        hide();
      }, true);
    });
    document.addEventListener('scroll', hide, true);
  }

  return { init: init, attach: attach, show: show, hide: hide };
})();
