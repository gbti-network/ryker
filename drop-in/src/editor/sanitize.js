// Allowlist sanitiser for edited and pasted content, spec section 11.
//
// Written rather than vendored. DOMPurify exists to sanitise HTML arriving from
// arbitrary untrusted sources; Ryker's input is a contenteditable surface in a
// page it controls, and the allowlist below is a small explicit set. Vendoring 2,700
// lines that would need splitting across five files to meet the 600 line cap,
// then maintaining it against upstream fixes no longer being received, is worse
// than 200 lines that are understood.
//
// The residual risk that choice leaves is closed elsewhere: comment bodies are
// rendered as text and never as HTML.
Ryker.sanitize = (function () {
  'use strict';

  var ALLOWED = {
    A: ['href', 'target', 'download', 'rel'],
    IMG: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    B: [], STRONG: [], I: [], EM: [], U: [], S: [], DEL: ['cite', 'datetime'],
    INS: ['cite', 'datetime'], SMALL: [], ABBR: [], TIME: ['datetime'],
    CODE: [], KBD: [], SAMP: [], VAR: [], CITE: [], Q: ['cite'],
    SUP: [], SUB: [], BR: [], SPAN: [], MARK: []
  };

  // Shared safe attributes preserve authored identity, language and accessible
  // names without carrying executable or layout-bearing markup into the page.
  var GLOBAL_ATTRS = ['id', 'class', 'lang', 'dir', 'title', 'role'];
  var URL_ATTRS = {
    href: 'link', cite: 'link', src: 'image', poster: 'image', background: 'image',
    action: 'action', formaction: 'action', 'xlink:href': 'image'
  };

  // A data: URI whose payload cannot execute. The self-contained reports embed
  // every dataset and image this way, so refusing data: outright destroyed them:
  // sanitising a paragraph that held a CSV download stripped its href and left a
  // dead link. SVG and HTML stay refused, because both can carry script.
  var SAFE_DATA = /^data:(text\/csv|text\/plain|application\/json|image\/(png|jpe?g|gif|webp|avif))\s*[;,]/i;

  function safeDataUri(v) { return SAFE_DATA.test(String(v || '').trim()); }

  function safeUrl(v, kind) {
    var s = String(v || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
    if (!s) return false;
    if (/^data:/i.test(s)) {
      return kind === 'image'
        ? /^data:image\/(png|jpe?g|gif|webp|avif)\s*[;,]/i.test(s)
        : (kind !== 'action' && safeDataUri(s));
    }

    // A URL with no scheme is relative, including bare sibling paths such as
    // appendix.html and data/results.csv. Those are the ordinary authored form
    // in a portable report and must not be mistaken for an unsafe protocol.
    var scheme = s.match(/^([a-z][a-z0-9+.-]*):/i);
    if (!scheme) return true;
    scheme = scheme[1].toLowerCase();
    if (kind === 'image' || kind === 'action') return scheme === 'http' || scheme === 'https';
    return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel';
  }

  function badUrl(v) { return !safeUrl(v, 'link'); }

  // This is a safety screen, not a document-wide allowlist. A caller decides
  // which attributes make sense for its tag, then uses this to reject event,
  // layout and dangerous URL forms consistently across Ryker surfaces.
  function safeAttribute(tag, name, value) {
    name = String(name || '').toLowerCase();
    if (!name || name.indexOf('on') === 0 || name === 'style' || name === 'srcdoc' ||
        name === 'ping' || name === 'srcset') return false;
    var kind = URL_ATTRS[name];
    return kind ? safeUrl(value, kind) : true;
  }

  // Mutates one element using a caller-supplied tag allowlist plus the shared
  // safe attributes above. The workspace can reuse this with its own per-tag
  // schema instead of growing a second URL policy.
  function attributes(node, allowed) {
    for (var i = node.attributes.length - 1; i >= 0; i--) {
      var attr = node.attributes[i];
      var name = attr.name.toLowerCase();
      var named = allowed.indexOf(name) !== -1 || GLOBAL_ATTRS.indexOf(name) !== -1 ||
        /^aria-[a-z0-9_.:-]+$/i.test(name);
      if (!named || !safeAttribute(node.tagName, name, attr.value)) node.removeAttribute(attr.name);
    }
    return node;
  }

  // Only a link that leaves the page needs rel. Adding it to an in-page
  // fragment, a mailto or a relative link is noise, and worse than noise here:
  // it rewrites markup nobody touched, so a paragraph reads as edited when all
  // that happened was the caret passing through it.
  function leavesPage(href) {
    return /^(https?:)?\/\//i.test(String(href || '').trim());
  }

  // Cleans a detached fragment in place and returns it.
  function fragment(frag) {
    // Comments first. The tree walker below only visits elements, so the
    // StartFragment and EndFragment markers a browser clipboard wraps around
    // copied HTML travelled straight through the sanitiser, into the document,
    // and from there into the edit instructions.
    var comments = document.createTreeWalker(frag, NodeFilter.SHOW_COMMENT, null);
    var stale = [];
    var c;
    while ((c = comments.nextNode())) stale.push(c);
    stale.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });

    var kill = [];
    var walk = document.createTreeWalker(frag, NodeFilter.SHOW_ELEMENT, null);
    var node;
    while ((node = walk.nextNode())) {
      var tag = node.tagName;
      if (!Object.prototype.hasOwnProperty.call(ALLOWED, tag)) { kill.push(node); continue; }
      attributes(node, ALLOWED[tag]);
      if (tag === 'A' && (leavesPage(node.getAttribute('href')) ||
          node.getAttribute('target') === '_blank')) {
        node.setAttribute('rel', 'noopener noreferrer');
      }
      // A download attribute without an href is a link to nowhere wearing a
      // filename, which is worse than no attribute at all.
      if (tag === 'A' && node.hasAttribute('download') && !node.getAttribute('href')) {
        node.removeAttribute('download');
      }
    }
    // Unwrap rather than delete, so pasted text survives when its wrapper does
    // not. A paste that silently loses its words is worse than one that loses
    // its formatting.
    var BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|CAPTION|DIV|DL|DT|DD|FIELDSET|FIGCAPTION|FIGURE|FOOTER|HEADER|H[1-6]|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TBODY|TD|TFOOT|TH|THEAD|TR|UL)$/;
    function isBreak(n) { return n && n.nodeType === 1 && n.tagName === 'BR'; }

    kill.forEach(function (n) {
      if (!n.parentNode) return;
      if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'IFRAME' ||
          n.tagName === 'OBJECT' || n.tagName === 'EMBED' || n.tagName === 'FORM' ||
          n.tagName === 'INPUT' || n.tagName === 'BUTTON' || n.tagName === 'SELECT' ||
          n.tagName === 'TEXTAREA') {
        n.parentNode.removeChild(n);
        return;
      }
      var parent = n.parentNode;
      var separate = BLOCK.test(n.tagName);
      var before = n.previousSibling;
      var after = n.nextSibling;
      if (separate && before && !isBreak(before)) parent.insertBefore(document.createElement('br'), n);
      while (n.firstChild) parent.insertBefore(n.firstChild, n);
      if (separate && after && !isBreak(n.previousSibling) && !isBreak(after)) {
        parent.insertBefore(document.createElement('br'), n);
      }
      parent.removeChild(n);
    });
    return frag;
  }

  // Tidies the edges of a block's content. Clipboard HTML arrives padded with
  // blank lines, a trailing <br> and non-breaking spaces, and all of it ends up
  // quoted verbatim in the edit instructions where it is pure distraction.
  function tidy(root) {
    function blank(n) {
      if (n.nodeType === 3) return !n.nodeValue.replace(/[\s ]/g, '');
      return n.nodeType === 1 && n.tagName === 'BR';
    }
    var hasText = !!(root.textContent || '').replace(/[\s ]/g, '');
    // Only trim edges once there is real content; an empty block keeps the <br>
    // that gives it height and a place to put the caret.
    if (hasText) {
      while (root.firstChild && blank(root.firstChild)) root.removeChild(root.firstChild);
      while (root.lastChild && blank(root.lastChild)) root.removeChild(root.lastChild);
    }
    // A non-breaking space that came from a paste is not a typographic choice.
    var texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var t;
    while ((t = texts.nextNode())) {
      if (t.nodeValue.indexOf(' ') !== -1) {
        t.nodeValue = t.nodeValue.replace(/ /g, ' ');
      }
    }
    return root;
  }

  function html(dirty) {
    var tpl = document.createElement('template');
    tpl.innerHTML = String(dirty == null ? '' : dirty);
    fragment(tpl.content);
    tidy(tpl.content);
    return tpl.innerHTML;
  }

  // Paste defaults to sanitised content, per section 11.
  function fromClipboard(e) {
    var dt = e.clipboardData;
    if (!dt) return null;
    var h = dt.getData('text/html');
    if (h) return html(h);
    var t = dt.getData('text/plain') || '';
    return Ryker.dom.escapeHtml(t).replace(/\r?\n/g, '<br>');
  }

  // Called after an explicit markup command such as link creation or inline
  // formatting. Ordinary focus/blur must never rewrite an authored block.
  function element(node) {
    var tpl = document.createElement('template');
    tpl.innerHTML = node.innerHTML;
    var before = tpl.innerHTML;
    fragment(tpl.content);
    // tidy() used to run only on paste, so the non-breaking space a browser
    // leaves behind when you type a trailing space survived into the document
    // and was then quoted verbatim in every instruction.
    tidy(tpl.content);
    if (tpl.innerHTML !== before) {
      node.innerHTML = tpl.innerHTML;
      return true;
    }
    return false;
  }

  return { html: html, fragment: fragment, element: element,
           fromClipboard: fromClipboard, badUrl: badUrl, safeUrl: safeUrl,
           safeAttribute: safeAttribute, attributes: attributes, safeDataUri: safeDataUri };
})();
