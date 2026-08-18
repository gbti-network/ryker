// The shadow root Ryker draws into, and the two places it touches host layout.
//
// The reports put nav.toc at position:sticky; top:0 and the toolbar is fixed to
// the same edge, so Ryker stays collapsed to a small handle by default and only
// claims space when someone opens it. The side panel prefers the layout's own
// right margin and takes width from the report only when the margin is short.
Ryker.shell = (function () {
  'use strict';

  var host = null, shadow = null, layer = null, documentStyle = null;
  var shifted = [];
  var bodyPadding = {};
  var owner = Ryker.dom.uid('owner');

  function owns(node) {
    if (!host || !node) return false;
    if (node === host) return true;
    return !!(shadow && node.getRootNode && node.getRootNode() === shadow);
  }

  function rememberBodyPadding(prop) {
    if (Object.prototype.hasOwnProperty.call(bodyPadding, prop)) return;
    bodyPadding[prop] = {
      value: document.body.style.getPropertyValue(prop),
      priority: document.body.style.getPropertyPriority(prop)
    };
  }

  function restoreBodyPadding(prop) {
    if (!Object.prototype.hasOwnProperty.call(bodyPadding, prop)) return;
    var was = bodyPadding[prop];
    if (was.value) document.body.style.setProperty(prop, was.value, was.priority || '');
    else document.body.style.removeProperty(prop);
    delete bodyPadding[prop];
  }

  // Export works from a clone while the live shell may still be claiming
  // space. Return a copy of the authored inline value so the clone can remove
  // Ryker's temporary padding without deleting the page's own declaration.
  function originalBodyPadding(prop) {
    if (!Object.prototype.hasOwnProperty.call(bodyPadding, prop)) return null;
    return {
      value: bodyPadding[prop].value,
      priority: bodyPadding[prop].priority
    };
  }

  function mount() {
    if (host) return shadow;

    host = document.createElement('div');
    host.id = 'ryker-root';
    host.setAttribute('data-ryker-host', '');
    host.setAttribute('data-ryker-owner', owner);
    // The host element itself must not affect layout at all.
    host.style.cssText = 'all:initial;position:static;display:block;width:0;height:0;overflow:visible';
    host.setAttribute('data-ryker-lock', '');
    document.body.appendChild(host);

    shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = Ryker.styles.shadowCss;
    shadow.appendChild(style);

    layer = document.createElement('div');
    layer.className = 'layer';
    shadow.appendChild(layer);

    // The only stylesheet Ryker adds to the host document. It styles the
    // report's own elements, which a shadow root cannot reach: the
    // contenteditable state treatments, the picked-block outline, and the print
    // rules that remove every trace of Ryker from the PDF. It used to carry the
    // comment highlight pseudo-elements too, and those were the reason it was
    // first justified; they went with comments on 2026-08-16 and the rest of it
    // is still load-bearing.
    documentStyle = document.createElement('style');
    documentStyle.id = 'ryker-document-css';
    documentStyle.setAttribute('data-ryker-document-css', '');
    documentStyle.setAttribute('data-ryker-owner', owner);
    documentStyle.textContent = Ryker.styles.documentCss;
    document.head.appendChild(documentStyle);

    return shadow;
  }

  function root() { return layer || (mount() && layer); }

  function add(node) { root().appendChild(node); return node; }

  // ---- vertical: keeping the toolbar off the top of the document ----------

  function stickyCandidates() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('body *'), function (n) {
      if (owns(n)) return;
      var cs = getComputedStyle(n);
      if ((cs.position === 'sticky' || cs.position === 'fixed') && cs.top === '0px') out.push(n);
    });
    return out;
  }

  function setOffset(px) {
    releaseOffset();
    document.documentElement.style.setProperty('--ryker-offset', px + 'px');
    if (!px) return;
    stickyCandidates().forEach(function (n) {
      n.setAttribute('data-ryker-offset', n.style.top || '');
      n.style.top = px + 'px';
      shifted.push(n);
    });
    // The bar is fixed, so without this the top of the document sits underneath
    // it. Recorded on an attribute as well as in the style, so the print rules
    // can undo it without having to guess whether the padding was Ryker's.
    rememberBodyPadding('padding-top');
    document.body.style.paddingTop = px + 'px';
    document.body.setAttribute('data-ryker-pushed', '');
    document.documentElement.style.scrollPaddingTop = px + 'px';
  }

  var spaces = { left: null, right: null };

  function releaseOffset() {
    shifted.forEach(function (n) {
      var prev = n.getAttribute('data-ryker-offset');
      if (prev) n.style.top = prev; else n.style.removeProperty('top');
      n.removeAttribute('data-ryker-offset');
      if (!n.getAttribute('style')) n.removeAttribute('style');
    });
    shifted = [];
    restoreBodyPadding('padding-top');
    if (!spaces.left && !spaces.right) document.body.removeAttribute('data-ryker-pushed');
    if (!document.body.getAttribute('style')) document.body.removeAttribute('style');
    document.documentElement.style.removeProperty('scroll-padding-top');
    // Cleared here, not only in teardown(). The rail is positioned from this
    // property, so leaving it behind hangs the rail below a toolbar that has
    // already gone.
    document.documentElement.style.removeProperty('--ryker-offset');
  }

  // ---- horizontal: fitting the side panel into the layout's margin --------

  var panelNode = null;

  // Takes the panel element rather than a width. Deriving the panel's left edge
  // from a viewport width means picking between innerWidth and clientWidth, and
  // both are wrong in one direction: fixed positioning excludes the scrollbar
  // while innerWidth includes it, which left the content overlapping the panel
  // by exactly the scrollbar's width. Two getBoundingClientRect calls are in the
  // same coordinate space by definition, so nothing has to be assumed.
  // Twelve passes, not eight. The reports centre their content with margin auto,
  // so each pass recovers only half of what is still missing; the left edge took
  // nine passes to converge at 1920px and would have stopped short at eight.
  //
  // The left deficit is measured against the content box, not against the
  // report's own sticky table of contents. Measured: main is the same width
  // either way, because the TOC simply ends up underneath the rail, and
  // measuring against it would surrender 250px for a list the rail duplicates.
  function setEdgeSpace(node, side) {
    var prop = side === 'left' ? 'padding-left' : 'padding-right';
    // Every reflow starts from the host page's real value, then measures the
    // additional room Ryker needs. Releasing the panel restores that exact
    // inline value, including its !important priority.
    restoreBodyPadding(prop);
    spaces[side] = node || null;
    if (!node) {
      if (!spaces.left && !spaces.right) document.body.removeAttribute('data-ryker-pushed');
      if (!document.body.getAttribute('style')) document.body.removeAttribute('style');
      return;
    }

    rememberBodyPadding(prop);
    document.body.style.removeProperty(prop);

    var ceiling = Math.floor(document.documentElement.clientWidth * 0.55);
    var applied = 0;
    for (var i = 0; i < 12; i++) {
      var content = Ryker.blocks.root().getBoundingClientRect();
      var box = node.getBoundingClientRect();
      var deficit = side === 'left'
        ? Math.ceil(box.right + 12 - content.left)
        : Math.ceil(content.right + 12 - box.left);
      if (deficit <= 0) break;
      applied = Math.min(ceiling, applied + deficit);
      document.body.style.setProperty(prop, applied + 'px');
      if (applied >= ceiling) break;
    }
    if (!applied) document.body.style.removeProperty(prop);
    if (applied) document.body.setAttribute('data-ryker-pushed', '');
    else if (!spaces.left && !spaces.right) document.body.removeAttribute('data-ryker-pushed');
    if (!document.body.getAttribute('style')) document.body.removeAttribute('style');
  }

  function setPanelSpace(node) {
    panelNode = node || null;
    setEdgeSpace(node, 'right');
  }

  function releasePanelSpace() {
    panelNode = null;
    setEdgeSpace(null, 'right');
  }

  function releaseEdgeSpace() {
    setEdgeSpace(null, 'left');
    setEdgeSpace(null, 'right');
    document.body.removeAttribute('data-ryker-rail');
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!spaces.left && !spaces.right) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      // Left first: it moves the content box that the right pass measures.
      if (spaces.left) setEdgeSpace(spaces.left, 'left');
      if (spaces.right) setEdgeSpace(spaces.right, 'right');
    }, 120);
  });

  function teardown() {
    releaseEdgeSpace();
    releasePanelSpace();
    releaseOffset();
    document.documentElement.style.removeProperty('--ryker-offset');
    if (documentStyle && documentStyle.parentNode) documentStyle.parentNode.removeChild(documentStyle);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = shadow = layer = documentStyle = null;
  }

  return {
    mount: mount, root: root, add: add, teardown: teardown,
    setOffset: setOffset, releaseOffset: releaseOffset,
    setPanelSpace: setPanelSpace, releasePanelSpace: releasePanelSpace,
    setEdgeSpace: setEdgeSpace, releaseEdgeSpace: releaseEdgeSpace,
    originalBodyPadding: originalBodyPadding,
    owns: owns, owner: function () { return owner; },
    shadow: function () { return shadow; },
    host: function () { return host; }
  };
})();
