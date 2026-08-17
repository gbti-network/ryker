/*!
 * Ryker 0.1.0
 * A drop-in editing layer for authored HTML reports.
 *
 * Generated bundle. Do not edit. Sources, in load order:
 *   utils/dom.js  (131 lines)
 *   config/config.js  (117 lines)
 *   security/scan.js  (64 lines)
 *   editor/sanitize.js  (174 lines)
 *   editor/blocks.js  (305 lines)
 *   export/zip.js  (142 lines)
 *   export/html.js  (128 lines)
 *   export/packager.js  (232 lines)
 *   ui/styles.js  (379 lines)
 *   ui/shell.js  (194 lines)
 *   ui/icons.js  (51 lines)
 *   ui/tooltip.js  (82 lines)
 *   ui/dialog.js  (132 lines)
 *   ui/menu.js  (104 lines)
 *   editor/editable.js  (467 lines)
 *   editor/history.js  (138 lines)
 *   editor/formatbar.js  (209 lines)
 *   editor/links.js  (173 lines)
 *   editor/pick.js  (220 lines)
 *   editor/multi.js  (171 lines)
 *   editor/outline.js  (182 lines)
 *   editor/move.js  (322 lines)
 *   ui/rail.js  (435 lines)
 *   instructions/instructions.js  (491 lines)
 *   instructions/merge.js  (326 lines)
 *   storage/logger.js  (336 lines)
 *   instructions/browser.js  (250 lines)
 *   ui/pane.js  (278 lines)
 *   storage/recover.js  (126 lines)
 *   bootstrap/boot.js  (445 lines)
 *
 * Classic script by design: module scripts do not load from file:// URLs,
 * and a report handed over as a ZIP is opened from disk.
 */
(function () {
  'use strict';
  if (window.Ryker && window.Ryker.VERSION) return;
  var Ryker = { VERSION: "0.1.0", BUILD: "Ryker" };
  window.Ryker = Ryker;

  /* ---- utils/dom.js ---------------------------------------------- */
  // DOM helpers shared across Ryker. No dependencies, no globals beyond Ryker.
  Ryker.dom = (function () {
    'use strict';

    function el(tag, attrs, kids) {
      var n = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          if (k === 'class') n.className = attrs[k];
          else if (k === 'text') n.textContent = attrs[k];
          else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
          else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
        });
      }
      (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
      return n;
    }

    // Deterministic id for a block that has none of its own. Position-based ids
    // would move when a block is inserted above, so the path is taken from the
    // nearest ancestor that carries a real id and stays stable under text edits.
    function pathId(node, root) {
      var parts = [];
      var cur = node;
      while (cur && cur !== root) {
        if (cur.id) { parts.unshift('#' + cur.id); break; }
        var p = cur.parentNode;
        if (!p) break;
        var same = [];
        for (var i = 0; i < p.children.length; i++) {
          if (p.children[i].tagName === cur.tagName) same.push(p.children[i]);
        }
        parts.unshift(cur.tagName.toLowerCase() + (same.length > 1 ? ':' + same.indexOf(cur) : ''));
        cur = p;
      }
      return parts.join('/');
    }

    function textOf(node) {
      return (node.textContent || '').replace(/\s+/g, ' ').trim();
    }

    // Walks text nodes in document order, skipping anything Ryker owns.
    function textNodes(root) {
      var out = [];
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          var p = n.parentNode;
          while (p && p !== root) {
            var t = p.tagName;
            if (p.id === 'ryker-root' || t === 'SCRIPT' || t === 'STYLE' || t === 'SVG' || t === 'svg') {
              return NodeFilter.FILTER_REJECT;
            }
            p = p.parentNode;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var n;
      while ((n = w.nextNode())) out.push(n);
      return out;
    }

    // Concatenated text of a root plus an index letting a global offset be
    // resolved back to a node and a local offset. Comment anchoring needs both.
    function flatten(root) {
      var nodes = textNodes(root);
      var text = '';
      var index = [];
      nodes.forEach(function (n) {
        index.push({ node: n, start: text.length, len: n.nodeValue.length });
        text += n.nodeValue;
      });
      return { text: text, index: index };
    }

    function locate(flat, offset) {
      for (var i = 0; i < flat.index.length; i++) {
        var e = flat.index[i];
        if (offset >= e.start && offset <= e.start + e.len) {
          return { node: e.node, offset: offset - e.start };
        }
      }
      return null;
    }

    function rangeFromOffsets(root, start, end) {
      var flat = flatten(root);
      var a = locate(flat, start);
      var b = locate(flat, end);
      if (!a || !b) return null;
      var r = document.createRange();
      try {
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
      } catch (e) { return null; }
      return r;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function uid(prefix) {
      var s = '';
      var bytes = new Uint8Array(8);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      for (var i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
      return (prefix || 'r') + '-' + s;
    }

    function now() { return new Date().toISOString(); }

    function fmtDate(iso) {
      try {
        var d = new Date(iso);
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) +
          ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      } catch (e) { return iso; }
    }

    return {
      el: el, pathId: pathId, textOf: textOf, textNodes: textNodes,
      flatten: flatten, locate: locate, rangeFromOffsets: rangeFromOffsets,
      escapeHtml: escapeHtml, uid: uid, now: now, fmtDate: fmtDate
    };
  })();


  /* ---- config/config.js ------------------------------------------ */
  // Configuration intake and the four detection states of spec section 6.
  //
  // Config never arrives by fetch. A file:// page cannot read a sibling file:
  // fetch() rejects and synchronous XHR throws NetworkError, measured 2026-08-13.
  // So config is either a classic script that assigned window.RYKER_CONFIG, or an
  // inline JSON block. Both load from disk; a fetched .json does not.
  Ryker.config = (function () {
    'use strict';

    var DEFAULTS = {
      RYKER_ENABLED: true,
      RYKER_DOCUMENT_ID: null,
      RYKER_DOCUMENT_PATH: null,
      RYKER_GITHUB_ENABLED: false,
      RYKER_GITHUB_OWNER: null,
      RYKER_GITHUB_REPO: null,
      RYKER_GITHUB_REPOSITORY_ID: null,
      RYKER_GITHUB_BRANCH: 'main',
      RYKER_GITHUB_CLIENT_ID: null,
      RYKER_GOOGLE_ENABLED: false,
      // Read by export/packager.js:37 to list files that belong with the report
      // but are not inside it. It was missing from this object, and load() below
      // copies only the keys named here, so the value was stripped out of every
      // configuration before the packager could see it and manifestAssets() could
      // never return a row. Nothing failed and nothing warned; the Package dialog
      // simply offered fewer files than it promised.
      RYKER_PACKAGE_MANIFEST: null
    };

    // Anything on this list is a secret and must never reach a shipped report.
    // Checked at boot so a misconfigured build fails loudly in the toolbar rather
    // than shipping a credential quietly.
    var FORBIDDEN = [
      'RYKER_GITHUB_CLIENT_SECRET', 'RYKER_GITHUB_PRIVATE_KEY',
      'RYKER_GITHUB_TOKEN', 'RYKER_GITHUB_INSTALLATION_TOKEN',
      'RYKER_GOOGLE_CLIENT_SECRET', 'RYKER_GOOGLE_REFRESH_TOKEN',
      'RYKER_SERVICE_ACCOUNT'
    ];

    var state = null;

    function readInline() {
      var tag = document.getElementById('ryker-config');
      if (!tag) return null;
      try { return JSON.parse(tag.textContent); } catch (e) { return null; }
    }

    function load() {
      if (state) return state;
      // window.RYKER_CONFIG is the shared base, typically one ryker.config.js
      // covering a whole set of reports. The inline block is the individual
      // document speaking for itself, so it wins: the document id and path differ
      // per report while everything else is common to the set.
      var raw = {};
      if (window.RYKER_CONFIG) {
        Object.keys(window.RYKER_CONFIG).forEach(function (k) { raw[k] = window.RYKER_CONFIG[k]; });
      }
      var inline = readInline();
      if (inline) Object.keys(inline).forEach(function (k) { raw[k] = inline[k]; });

      var leaked = FORBIDDEN.filter(function (k) { return raw[k] != null && raw[k] !== ''; });

      var cfg = {};
      Object.keys(DEFAULTS).forEach(function (k) {
        cfg[k] = raw[k] != null ? raw[k] : DEFAULTS[k];
      });

      // The document id must not depend on the filename, per spec section 34.
      // Falling back to the title is better than falling back to the path,
      // because a renamed file keeps its title and loses its path.
      if (!cfg.RYKER_DOCUMENT_ID) {
        cfg.RYKER_DOCUMENT_ID = slug(document.title || 'untitled');
      }
      if (!cfg.RYKER_DOCUMENT_PATH) {
        var last = location.pathname.split('/').pop();
        cfg.RYKER_DOCUMENT_PATH = last ? decodeURIComponent(last) : 'report.html';
      }

      cfg._leaked = leaked;
      cfg._state = detect(cfg);
      state = cfg;
      return state;
    }

    function slug(s) {
      return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
    }

    // Section 6's four states. Reported rather than inferred at each call site,
    // so the toolbar and the onboarding panel cannot disagree about which one
    // the document is in.
    function detect(cfg) {
      var hasRepo = !!(cfg.RYKER_GITHUB_OWNER && cfg.RYKER_GITHUB_REPO);
      var hasAuth = cfg.RYKER_GITHUB_ENABLED === true;
      if (!hasAuth && !hasRepo) return 'unconfigured';
      if (hasAuth && !hasRepo) return 'repo-missing';
      if (!hasAuth && hasRepo) return 'auth-missing';
      return 'configured';
    }

    function stateLabel(s) {
      return {
        'unconfigured': 'GitHub collaboration not configured',
        'repo-missing': 'GitHub ready, repository not set',
        'auth-missing': 'Repository set, GitHub sign-in not enabled',
        'configured': 'GitHub collaboration available'
      }[s] || s;
    }

    function repoSlug(cfg) {
      return cfg.RYKER_GITHUB_OWNER + '/' + cfg.RYKER_GITHUB_REPO;
    }

    return { load: load, detect: detect, stateLabel: stateLabel, repoSlug: repoSlug, slug: slug };
  })();


  /* ---- security/scan.js ------------------------------------------ */
  // Credential leakage scan, spec section 44, widened per sow-004 finding 6.
  //
  // The spec scans packages before download. It also ships a "with Ryker" export
  // carrying configuration, and allows exporting a working copy while GitHub is
  // unavailable. A token that reached the DOM would leave through either of those
  // without the packager ever seeing it, so the scan belongs to the export
  // pipeline rather than to the packager, and runs on every generated artifact.
  //
  // This is defence in depth. It is not a substitute for never putting a
  // credential in the document in the first place.
  Ryker.scan = (function () {
    'use strict';

    var PATTERNS = [
      { name: 'GitHub personal access token (classic)', re: /\bghp_[A-Za-z0-9]{36,}\b/ },
      { name: 'GitHub OAuth token', re: /\bgho_[A-Za-z0-9]{36,}\b/ },
      { name: 'GitHub user-to-server token', re: /\bghu_[A-Za-z0-9]{36,}\b/ },
      { name: 'GitHub server-to-server token', re: /\bghs_[A-Za-z0-9]{36,}\b/ },
      { name: 'GitHub refresh token', re: /\bghr_[A-Za-z0-9]{36,}\b/ },
      { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
      { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
      { name: 'Google OAuth client secret', re: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/ },
      { name: 'Google refresh token', re: /\b1\/\/[A-Za-z0-9_-]{30,}\b/ },
      { name: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{35}\b/ },
      { name: 'Service account credential', re: /"type"\s*:\s*"service_account"/ },
      { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
      { name: 'Generic bearer token assignment', re: /\b(client_secret|refresh_token|private_key)\s*[:=]\s*["'][^"']{16,}["']/ }
    ];

    // Returns [] when clean. Each hit names the pattern and gives a short
    // redacted excerpt, never the credential itself, so a scan report can be
    // shown on screen without becoming a second leak.
    function text(content, label) {
      var hits = [];
      PATTERNS.forEach(function (p) {
        var m = p.re.exec(content);
        if (m) {
          hits.push({
            artifact: label || 'document',
            pattern: p.name,
            excerpt: redact(m[0])
          });
        }
      });
      return hits;
    }

    function redact(s) {
      if (s.length <= 12) return s.slice(0, 3) + '...';
      return s.slice(0, 6) + '...' + s.slice(-2) + ' (' + s.length + ' chars)';
    }

    // Binary members of a package are checked as latin1 so a key pasted into a
    // CSV or a text file inside the ZIP is still caught. Images will not match.
    function bytes(u8, label) {
      var s = '';
      var limit = Math.min(u8.length, 2 * 1024 * 1024);
      for (var i = 0; i < limit; i++) s += String.fromCharCode(u8[i]);
      return text(s, label);
    }

    return { text: text, bytes: bytes, patterns: PATTERNS };
  })();


  /* ---- editor/sanitize.js ---------------------------------------- */
  // Allowlist sanitiser for edited and pasted content, spec section 11.
  //
  // Written rather than vendored. DOMPurify exists to sanitise HTML arriving from
  // arbitrary untrusted sources; Ryker's input is a contenteditable surface in a
  // page it controls, and the allowlist below is a dozen tags. Vendoring 2,700
  // lines that would need splitting across five files to meet the 600 line cap,
  // then maintaining it against upstream fixes no longer being received, is worse
  // than 200 lines that are understood.
  //
  // The residual risk that choice leaves is closed elsewhere: comment bodies are
  // rendered as text and never as HTML.
  Ryker.sanitize = (function () {
    'use strict';

    var ALLOWED = {
      A: ['href', 'title', 'target', 'download'],
      B: [], STRONG: [], I: [], EM: [], U: [], S: [],
      CODE: [], SUP: [], SUB: [], BR: [], SPAN: [], MARK: []
    };

    var URL_OK = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i;

    // A data: URI whose payload cannot execute. The self-contained reports embed
    // every dataset and image this way, so refusing data: outright destroyed them:
    // sanitising a paragraph that held a CSV download stripped its href and left a
    // dead link. SVG and HTML stay refused, because both can carry script.
    var SAFE_DATA = /^data:(text\/csv|text\/plain|application\/json|image\/(png|jpe?g|gif|webp|avif))\s*[;,]/i;

    function safeDataUri(v) { return SAFE_DATA.test(String(v || '').trim()); }

    function badUrl(v) {
      var s = String(v || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
      if (!s) return true;
      if (safeDataUri(s)) return false;
      // javascript:, vbscript: and any other data: payload are the executable
      // shapes, and blob: and file: point outside the document entirely.
      if (/^(javascript|vbscript|data|blob|file):/i.test(s)) return true;
      return !URL_OK.test(s);
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
        var allowed = ALLOWED[tag];
        for (var i = node.attributes.length - 1; i >= 0; i--) {
          var attr = node.attributes[i];
          var name = attr.name.toLowerCase();
          // Every on* handler goes, whether or not the tag is allowed.
          if (name.indexOf('on') === 0 || allowed.indexOf(name) === -1) {
            node.removeAttribute(attr.name);
            continue;
          }
          if (name === 'href' && badUrl(attr.value)) node.removeAttribute(attr.name);
        }
        if (tag === 'A' && (leavesPage(node.getAttribute('href')) ||
            node.getAttribute('target') === '_blank')) {
          node.setAttribute('rel', 'noopener noreferrer');
        }
        // A download attribute without an href is a link to nowhere wearing a
        // filename, which is worse than no attribute at all.
        if (tag === 'A' && node.hasAttribute('download') && !node.getAttribute('href')) {
          node.removeAttribute('download');
        }
        // A span that has lost every attribute carries nothing. Pasting from a
        // browser wraps everything in them, and left alone they pile up.
        if ((tag === 'SPAN' || tag === 'MARK') && !node.attributes.length) kill.push(node);
      }
      // Unwrap rather than delete, so pasted text survives when its wrapper does
      // not. A paste that silently loses its words is worse than one that loses
      // its formatting.
      kill.forEach(function (n) {
        if (!n.parentNode) return;
        if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'IFRAME' ||
            n.tagName === 'OBJECT' || n.tagName === 'EMBED' || n.tagName === 'FORM' ||
            n.tagName === 'INPUT' || n.tagName === 'BUTTON' || n.tagName === 'SELECT' ||
            n.tagName === 'TEXTAREA') {
          n.parentNode.removeChild(n);
          return;
        }
        while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
        n.parentNode.removeChild(n);
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

    // Called after an edit lands, to catch anything that arrived by a route the
    // paste handler did not see, such as a drag and drop.
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
             fromClipboard: fromClipboard, badUrl: badUrl, safeDataUri: safeDataUri };
  })();


  /* ---- editor/blocks.js ------------------------------------------ */
  // Which parts of the report are editable, and how a block is named.
  //
  // Editing is scoped to prose. The target reports carry a hand-authored inline
  // SVG chart, a filterable table whose behaviour lives in data-effort and
  // data-sort attributes read by the report's own script, and images inlined as
  // base64. A general rich-text surface over that would let a well-meaning edit
  // break the sort handler or delete the chart, and the breakage would be
  // indistinguishable from a report bug.
  Ryker.blocks = (function () {
    'use strict';

    var SELECTOR = 'h1, p, li, td, th, h2, h3, h4, h5, figcaption, blockquote p, dd, dt';

    function root() {
      return document.querySelector('main') || document.body;
    }

    function ownHeader(head) {
      var main = document.querySelector('main');
      return !!(main && main.contains(head));
    }

    function excluded(node) {
      // Anything Ryker owns.
      if (node.closest('#ryker-root')) return true;
      // The chart and any other vector content.
      if (node.closest('svg')) return true;
      // Navigation is not content. Editing the table of contents would desync it
      // from the headings it points at.
      if (node.closest('nav, footer')) return true;
      // A <header> is usually site chrome, but the document's own title block is
      // also a header, and that one IS content. The test is where it sits rather
      // than what it is called: a header inside <main> belongs to the document.
      // Without this the title was the one piece of prose Ryker could not touch.
      var head = node.closest('header');
      if (head && !ownHeader(head)) return true;
      // Elements the host page's own script reads. Their text may be the key the
      // script sorts or filters on.
      if (node.closest('[data-effort], [data-sort], [data-group], [data-impact]')) return true;
      if (node.hasAttribute && (node.hasAttribute('data-ryker-lock') || node.closest('[data-ryker-lock]'))) return true;
      return false;
    }

    // Block identity has to survive the file being closed and reopened.
    //
    // Two earlier attempts failed for opposite reasons. A positional id is stable
    // across a reload and wrong the moment a paragraph is split, because inserting
    // one <p> renumbers every <p> after it. A stamped attribute is stable under
    // splitting and useless across a reload, because the file on disk carries no
    // stamps: a saved edit could not find its block, so it was appended to the end
    // of the document as a duplicate while the original stayed untouched.
    //
    // What is stable in both directions is the document's own pristine content. An
    // id derived from a block's tag and opening text recomputes identically from a
    // freshly loaded file, and is cached per node the first time it is seen so it
    // does not drift as that block is edited. Blocks created during a session have
    // no pristine content, so those alone carry a stamped attribute, and replay
    // recreates them with the same stamp.
    var idCache = new WeakMap();

    function hash(s) {
      var h = 2166136261;
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return h.toString(36);
    }

    function candidates() {
      var out = [];
      Array.prototype.forEach.call(root().querySelectorAll(SELECTOR), function (n) {
        if (excluded(n)) return;
        // A list item holding only nested block content is a container, not prose.
        if (n.querySelector(SELECTOR)) return;
        if (!Ryker.dom.textOf(n)) return;
        out.push(n);
      });
      return out;
    }

    // Every editable element in document order, INCLUDING ones with no text.
    // all() drops empties on purpose, because an empty block has no content to
    // derive an identity from. That makes it the wrong list for finding a block's
    // neighbour: the block someone is trying to delete is precisely the one they
    // have just emptied, and it was invisible here.
    function sequence() {
      var out = [];
      Array.prototype.forEach.call(root().querySelectorAll(SELECTOR), function (n) {
        if (excluded(n)) return;
        if (n.querySelector(SELECTOR)) return;
        out.push(n);
      });
      return out;
    }

    function all() {
      var nodes = candidates();
      var counts = {};
      var seen = {};
      var out = [];
      nodes.forEach(function (n) {
        var id = identify(n, counts);
        if (seen[id]) return;
        seen[id] = true;
        out.push({ id: id, node: n });
      });
      return out;
    }

    function identify(node, counts) {
      if (node.id) return '#' + node.id;
      var stamped = node.getAttribute && node.getAttribute('data-ryker-id');
      if (stamped) return '@' + stamped;
      if (idCache.has(node)) return idCache.get(node);

      // Two identical paragraphs would hash the same, so occurrences are numbered
      // in document order. Only the opening text is used, which keeps the id
      // stable when a long block is edited near its end.
      var base = hash(node.tagName + '|' + Ryker.dom.textOf(node).slice(0, 160));
      var n = (counts[base] = (counts[base] || 0) + 1);
      var id = '~' + base + (n > 1 ? '.' + n : '');
      idCache.set(node, id);
      return id;
    }

    // A table is not a block, so deleting one removes a block per cell and the
    // change set reads as ten separate deletions of a word each. Recording which
    // container a block belongs to lets the instructions say "remove the table"
    // once. The key is per node and assigned lazily, so it is identical in every
    // snapshot of the same table and meaningless across documents, which is all
    // that is asked of it.
    var BOX = 'table, figure, ul, ol, dl';
    var boxKeys = new WeakMap();
    var boxSeq = 0;

    function boxOf(node) {
      var c = node.closest ? node.closest(BOX) : null;
      return c && !excluded(c) ? c : null;
    }

    function boxKey(node) {
      var c = boxOf(node);
      if (!c) return null;
      var k = boxKeys.get(c);
      if (!k) { k = 'x' + (++boxSeq); boxKeys.set(c, k); }
      return k;
    }

    function blockId(node) {
      if (node.id) return '#' + node.id;
      var stamped = node.getAttribute && node.getAttribute('data-ryker-id');
      if (stamped) return '@' + stamped;
      if (idCache.has(node)) return idCache.get(node);
      // Not seen yet: identify it in the context of the whole document so the
      // duplicate numbering matches what all() would have produced.
      var found = null;
      all().some(function (b) { if (b.node === node) { found = b.id; return true; } return false; });
      return found || identify(node, {});
    }

    // Called once at boot, before anything is replayed or edited, so every id is
    // computed from the document as it was authored.
    function seedIds() { return all().length; }

    function stamp(node) {
      if (node.id) return '#' + node.id;
      var v = node.getAttribute('data-ryker-id');
      if (!v) {
        v = Ryker.dom.uid('b').slice(0, 12);
        node.setAttribute('data-ryker-id', v);
      }
      return '@' + v;
    }

    function byId(id) {
      var r = root();
      if (id.charAt(0) === '#') {
        var direct = document.getElementById(id.slice(1));
        if (direct && !excluded(direct)) return direct;
      }
      if (id.charAt(0) === '@') {
        var q = r.querySelector('[data-ryker-id="' + id.slice(1).replace(/"/g, '') + '"]');
        if (q && !excluded(q)) return q;
      }
      // A content-derived id resolves by scanning, which also seeds the cache.
      var found = null;
      all().some(function (b) {
        if (b.id === id) { found = b.node; return true; }
        return false;
      });
      return found;
    }

    // A snapshot is the map used to compute a save's deltas. innerHTML rather
    // than textContent, because an edit that only changes a link target is still
    // an edit worth recording.
    //
    // Tag and preceding-block id travel with it because a change record has to be
    // replayable. Without them an added block could be recorded but never put
    // back: the id says what it is and not where it goes.
    function snapshot() {
      var snap = {};
      var list = all();
      list.forEach(function (b, i) {
        var box = boxOf(b.node);
        snap[b.id] = {
          html: b.node.innerHTML,
          tag: b.node.tagName,
          prev: i > 0 ? list[i - 1].id : null,
          box: box ? boxKey(b.node) : null,
          boxTag: box ? box.tagName : null
        };
      });
      return snap;
    }

    function htmlOf(entry) {
      // Journals written before snapshots carried structure hold a bare string.
      return entry && typeof entry === 'object' ? entry.html : entry;
    }

    function diffSnapshots(before, after) {
      var changes = [];
      Object.keys(after).forEach(function (id) {
        var a = after[id];
        if (!Object.prototype.hasOwnProperty.call(before, id)) {
          changes.push({
            id: id, before: null, after: htmlOf(a), kind: 'added',
            tag: a.tag, prev: a.prev
          });
        } else if (htmlOf(before[id]) !== htmlOf(a)) {
          changes.push({ id: id, before: htmlOf(before[id]), after: htmlOf(a),
                         kind: 'changed', tag: a.tag });
        }
      });
      Object.keys(before).forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(after, id)) {
          var was = before[id];
          var meta = was && typeof was === 'object' ? was : {};
          changes.push({ id: id, before: htmlOf(was), after: null, kind: 'removed',
                         box: meta.box || null, boxTag: meta.boxTag || null });
        }
      });
      return changes;
    }

    // Puts a recorded change back into the document. This is what makes a journal
    // held in browser storage worth anything: the file on disk is untouched, so
    // without replay a reload silently discarded every saved edit.
    function applyChange(c) {
      var node = byId(c.id);

      if (c.kind === 'removed') {
        if (node && node.parentNode) node.parentNode.removeChild(node);
        return !!node;
      }

      if (!node) {
        // Only an insert may create an element. A 'changed' record whose block
        // cannot be found means the document is not the one the edit was made
        // against, and appending it would silently corrupt the report, which is
        // exactly what happened before block identity survived a reload.
        if (c.kind !== 'added' || c.after == null) return false;
        node = document.createElement(c.tag || 'P');
        if (c.id.charAt(0) === '@') node.setAttribute('data-ryker-id', c.id.slice(1));
        else if (c.id.charAt(0) === '#') node.id = c.id.slice(1);
        var anchor = c.prev ? byId(c.prev) : null;
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(node, anchor.nextSibling);
        else root().appendChild(node);
      }

      node.innerHTML = Ryker.sanitize.html(c.after);
      return true;
    }

    function applyRecords(records) {
      var applied = 0, missed = 0;
      (records || []).forEach(function (r) {
        (r.changes || []).forEach(function (c) {
          if (applyChange(c)) applied += 1; else missed += 1;
        });
      });
      return { applied: applied, missed: missed };
    }

    function label(id) {
      var node = byId(id);
      if (!node) return id;
      var head = node.closest('section');
      var h = head ? head.querySelector('h2, h3') : null;
      var text = Ryker.dom.textOf(node);
      var short = text.length > 60 ? text.slice(0, 57) + '...' : text;
      return (h ? Ryker.dom.textOf(h) + ' / ' : '') + short;
    }

    return {
      SELECTOR: SELECTOR, root: root, all: all, blockId: blockId, byId: byId, hash: hash,
      excluded: excluded, snapshot: snapshot, diffSnapshots: diffSnapshots, label: label,
      seedIds: seedIds, stamp: stamp, htmlOf: htmlOf, sequence: sequence,
      boxOf: boxOf, boxKey: boxKey,
      applyChange: applyChange, applyRecords: applyRecords
    };
  })();


  /* ---- export/zip.js --------------------------------------------- */
  // ZIP writer. Container written here, compression done by the browser.
  //
  // CompressionStream('deflate-raw') is genuine deflate and is exactly the codec
  // a ZIP member needs, so no compression library is vendored at all. Confirmed
  // present from file:// on 2026-08-13. Members fall back to stored when it is
  // missing, which produces a larger but perfectly valid archive.
  Ryker.zip = (function () {
    'use strict';

    var CRC = (function () {
      var t = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();

    function crc32(u8) {
      var c = 0xFFFFFFFF;
      for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function deflate(u8) {
      if (typeof CompressionStream !== 'function' || !u8.length) {
        return Promise.resolve(null);
      }
      try {
        var cs = new CompressionStream('deflate-raw');
        var stream = new Blob([u8]).stream().pipeThrough(cs);
        return new Response(stream).arrayBuffer().then(function (buf) {
          var out = new Uint8Array(buf);
          // A member that grew under compression is stored instead.
          return out.length < u8.length ? out : null;
        }).catch(function () { return null; });
      } catch (e) {
        return Promise.resolve(null);
      }
    }

    function dosTime(d) {
      return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
    }
    function dosDate(d) {
      return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    }

    function W(size) {
      var b = new Uint8Array(size);
      var v = new DataView(b.buffer);
      var p = 0;
      return {
        u16: function (n) { v.setUint16(p, n, true); p += 2; return this; },
        u32: function (n) { v.setUint32(p, n >>> 0, true); p += 4; return this; },
        raw: function (u8) { b.set(u8, p); p += u8.length; return this; },
        done: function () { return b; }
      };
    }

    function toBytes(data) {
      if (typeof data === 'string') return new TextEncoder().encode(data);
      if (data instanceof Uint8Array) return data;
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      return new TextEncoder().encode(String(data));
    }

    // files: [{ name: 'a/b.csv', data: string | Uint8Array }]
    function build(files) {
      var when = new Date();
      var time = dosTime(when), date = dosDate(when);

      return Promise.all(files.map(function (f) {
        var raw = toBytes(f.data);
        return deflate(raw).then(function (comp) {
          return {
            nameBytes: new TextEncoder().encode(f.name),
            raw: raw,
            body: comp || raw,
            method: comp ? 8 : 0,
            crc: crc32(raw)
          };
        });
      })).then(function (entries) {
        var locals = [];
        var offset = 0;
        entries.forEach(function (e) {
          var head = W(30 + e.nameBytes.length);
          head.u32(0x04034b50).u16(20).u16(0x0800).u16(e.method)
            .u16(time).u16(date).u32(e.crc)
            .u32(e.body.length).u32(e.raw.length)
            .u16(e.nameBytes.length).u16(0).raw(e.nameBytes);
          e.offset = offset;
          var h = head.done();
          locals.push(h, e.body);
          offset += h.length + e.body.length;
        });

        var cdStart = offset;
        var central = [];
        entries.forEach(function (e) {
          var c = W(46 + e.nameBytes.length);
          c.u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(e.method)
            .u16(time).u16(date).u32(e.crc)
            .u32(e.body.length).u32(e.raw.length)
            .u16(e.nameBytes.length).u16(0).u16(0).u16(0).u16(0).u32(0)
            .u32(e.offset).raw(e.nameBytes);
          var cb = c.done();
          central.push(cb);
          offset += cb.length;
        });

        var end = W(22);
        end.u32(0x06054b50).u16(0).u16(0)
          .u16(entries.length).u16(entries.length)
          .u32(offset - cdStart).u32(cdStart).u16(0);

        var parts = locals.concat(central, [end.done()]);
        var total = parts.reduce(function (n, p) { return n + p.length; }, 0);
        var out = new Uint8Array(total);
        var at = 0;
        parts.forEach(function (p) { out.set(p, at); at += p.length; });
        return out;
      });
    }

    function download(u8, filename) {
      var blob = new Blob([u8], { type: 'application/zip' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    return { build: build, download: download, crc32: crc32 };
  })();


  /* ---- export/html.js -------------------------------------------- */
  // Producing the document as a file, in the two shapes section 21 asks for.
  //
  // Every artifact leaving here passes the credential scan first. The spec scans
  // packages; a with-Ryker export carries configuration and an offline working
  // copy can be exported while GitHub is unreachable, so both would otherwise
  // leave without the packager seeing them.
  Ryker.exportHtml = (function () {
    'use strict';

    // A clone of the live document with everything Ryker added taken back out.
    // Ryker's chrome lives in one element and its edits live in the report's own
    // markup, so removing the element and the attributes is the whole job.
    function snapshot(keepRyker) {
      var doc = document.documentElement.cloneNode(true);

      // Both of these are rebuilt at boot, so neither is kept in either export.
      // Leaving the stylesheet behind would put Ryker's highlight rules in a file
      // that carries no Ryker.
      ['#ryker-root', '#ryker-document-css'].forEach(function (sel) {
        var n = doc.querySelector(sel);
        if (n && n.parentNode) n.parentNode.removeChild(n);
      });

      Array.prototype.forEach.call(doc.querySelectorAll('[contenteditable]'), function (n) {
        n.removeAttribute('contenteditable');
        n.removeAttribute('spellcheck');
      });
      Array.prototype.forEach.call(doc.querySelectorAll('.ryker-editing, .ryker-dirty, .ryker-pick'), function (n) {
        n.classList.remove('ryker-editing');
        n.classList.remove('ryker-dirty');
        n.classList.remove('ryker-pick');
        if (!n.getAttribute('class')) n.removeAttribute('class');
      });
      // The <mark> fallback wraps report content, so it has to be unwrapped
      // rather than deleted or the words inside it would be lost.
      Array.prototype.forEach.call(doc.querySelectorAll('mark.ryker-mark'), function (n) {
        while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
        n.parentNode.removeChild(n);
      });
      // The reserved space is inline on body and would otherwise ship in the
      // export as a stray padding rule with no panel to justify it.
      var exportBody = doc.body || doc.querySelector('body');
      if (exportBody) {
        exportBody.style.removeProperty('padding-left');
        exportBody.style.removeProperty('padding-right');
        // Pre-existing leak: the toolbar's vertical offset shipped in every
        // export as a stray body padding with no toolbar to justify it.
        exportBody.style.removeProperty('padding-top');
        if (exportBody.className === '') exportBody.removeAttribute('class');
        exportBody.removeAttribute('data-ryker-rail');
        exportBody.removeAttribute('data-ryker-pushed');
        if (!exportBody.getAttribute('style')) exportBody.removeAttribute('style');
      }
      Array.prototype.forEach.call(doc.querySelectorAll('[data-ryker-offset]'), function (n) {
        n.removeAttribute('data-ryker-offset');
        n.style.removeProperty('top');
        if (!n.getAttribute('style')) n.removeAttribute('style');
      });
      // Same leak a third time, on the element the clone IS rather than one it
      // contains, so neither the body pass above nor the querySelectorAll below
      // could ever have reached it. shell.js sets both of these on
      // documentElement when the toolbar claims vertical space, and releases them
      // only on collapse. The build that has since been decommissioned started
      // collapsed and never set them, so this shipped invisibly for months; the
      // surviving build starts expanded, so every export carried them. Found by
      // the fixture harness on its first run, 2026-08-16.
      doc.style.removeProperty('--ryker-offset');
      doc.style.removeProperty('scroll-padding-top');
      if (!doc.getAttribute('style')) doc.removeAttribute('style');

      if (!keepRyker) {
        Array.prototype.forEach.call(doc.querySelectorAll('script[data-ryker], #ryker-config, script[src*="ryker"]'), function (n) {
          if (n.parentNode) n.parentNode.removeChild(n);
        });
      }

      return '<!DOCTYPE html>\n' + doc.outerHTML;
    }

    function clean() { return snapshot(false); }
    function withRyker() { return snapshot(true); }

    // Returns { html, hits }. A caller that ignores hits is a bug, so the scan
    // result travels with the content rather than being a separate call someone
    // can forget.
    function scanned(kind) {
      var html = kind === 'clean' ? clean() : withRyker();
      return { html: html, hits: Ryker.scan.text(html, kind === 'clean' ? 'clean HTML' : 'with Ryker') };
    }

    function download(text, filename, mime) {
      var blob = new Blob([text], { type: mime || 'text/html;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    function baseName() {
      var p = Ryker.config.load().RYKER_DOCUMENT_PATH || 'report.html';
      return p.replace(/\.html?$/i, '');
    }

    function manifest(files) {
      var cfg = Ryker.config.load();
      return JSON.stringify({
        packageVersion: 1,
        rykerVersion: Ryker.VERSION,
        sourceDocument: cfg.RYKER_DOCUMENT_PATH,
        documentId: cfg.RYKER_DOCUMENT_ID,
        createdAt: Ryker.dom.now(),
        files: files.map(function (f) {
          return { name: f.name, bytes: f.bytes, crc32: f.crc32 };
        })
      }, null, 2);
    }

    return {
      clean: clean, withRyker: withRyker, scanned: scanned,
      download: download, baseName: baseName,
      manifest: manifest
    };
  })();


  /* ---- export/packager.js ---------------------------------------- */
  // Package Report: choose what travels with the document, then write a ZIP.
  //
  // A page cannot scan the folder it sits in, and should not be able to. Three
  // sources fill the list, in descending order of what they know:
  //   1. a folder the person granted access to, which sees everything including
  //      files added after the report was built;
  //   2. a build-time manifest shipped in the config, for the served case;
  //   3. files already inlined in the document as data URIs, which cost nothing
  //      to include because their bytes are in the page already.
  Ryker.packager = (function () {
    'use strict';

    function d() { return Ryker.dom; }

    function inlinedAssets() {
      var out = [];
      var seen = {};
      Array.prototype.forEach.call(document.querySelectorAll('a[download][href^="data:"]'), function (a) {
        var name = a.getAttribute('download') || 'download.bin';
        if (seen[name]) return;
        seen[name] = true;
        out.push({ name: 'data/' + name, source: 'inline', href: a.getAttribute('href') });
      });
      var i = 0;
      Array.prototype.forEach.call(document.querySelectorAll('img[src^="data:"]'), function (img) {
        i++;
        var m = /^data:([^;,]+)/.exec(img.getAttribute('src') || '');
        var ext = (m && m[1].split('/')[1]) || 'png';
        var name = 'assets/image-' + i + '.' + ext.replace('jpeg', 'jpg');
        out.push({ name: name, source: 'inline', href: img.getAttribute('src') });
      });
      return out;
    }

    function manifestAssets() {
      var cfg = Ryker.config.load();
      var list = cfg.RYKER_PACKAGE_MANIFEST;
      if (!Array.isArray(list)) return [];
      return list.map(function (f) {
        return { name: f.name || f, source: 'manifest', bytes: f.bytes || null, path: f.name || f };
      });
    }

    function folderAssets(dirHandle) {
      var out = [];
      function walk(handle, prefix) {
        var it = handle.values();
        function step() {
          return it.next().then(function (res) {
            if (res.done) return null;
            var e = res.value;
            var name = prefix + e.name;
            // Skip dotfiles, and skip the change-request log wherever it lives.
            //
            // This said `e.name === '.ryker'`, which was the RETIRED build's path
            // and is redundant with the dot test on the same line anyway. The
            // surviving logger writes to `ryker/` with no dot (logger.js LIB), so
            // the log was not being skipped at all. It is dormant only because
            // fsBackend() returns null and no folder can currently be listed;
            // sow-006 Phase 2 turns listing back on, and the first "Package
            // report" against a granted folder would have put every logged prompt
            // into the ZIP, where the credential scan then reads all of them.
            //
            // Read from the logger rather than repeated here, so the two cannot
            // drift apart again the way they just did.
            var lib = (Ryker.logger && Ryker.logger.LIB) || 'ryker';
            if (e.name === lib || e.name.charAt(0) === '.') return step();
            if (e.kind === 'directory') {
              return walk(e, name + '/').then(step);
            }
            return e.getFile().then(function (f) {
              out.push({ name: name, source: 'folder', bytes: f.size, handle: e });
              return step();
            }).catch(step);
          });
        }
        return step();
      }
      return walk(dirHandle, '').then(function () { return out; });
    }

    // The storage adapter went with the full build, so there is no folder backend
    // left to ask and every caller below takes its no-folder path. This is one
    // function rather than a guard at each call site on purpose: sow-006 Phase 2
    // converges storage/fs.js with the handle persistence in logger.js into a
    // single file-system module, and returning that here is the whole of putting
    // folder access back.
    function fsBackend() {
      return null;
    }

    function open() {
      var fs = fsBackend();
      if (fs && fs.isReady()) {
        folderAssets(fs.handle()).then(function (files) { dialog(files, true); });
        return;
      }
      var files = manifestAssets().concat(inlinedAssets());
      dialog(files, false);
    }

    function dialog(files, fromFolder) {
      var base = Ryker.exportHtml.baseName();
      var rows = [];
      var list = d().el('div', { class: 'filelist' });

      function row(label, checked, meta, payload) {
        var cb = d().el('input', { type: 'checkbox' });
        cb.checked = checked;
        var r = d().el('div', { class: 'filerow' }, [
          cb,
          d().el('span', { class: 'nm', text: label }),
          d().el('span', { class: 'sz', text: meta || '' })
        ]);
        list.appendChild(r);
        rows.push({ cb: cb, payload: payload });
      }

      row(base + '.html', true, 'the report', { kind: 'report' });

      files.forEach(function (f) {
        row(f.name, true, f.bytes ? kb(f.bytes) : f.source, { kind: 'asset', file: f });
      });

      var chooseBtn = null;
      var fs = fsBackend();
      if (!fromFolder && fs && fs.supported()) {
        chooseBtn = { label: 'Choose report folder', keepOpen: true, action: function (api) {
          fs.pick().then(function (h) {
            api.close();
            folderAssets(h).then(function (fl) { dialog(fl, true); });
          }).catch(function () {});
          return false;
        } };
      }

      // Built after chooseBtn, and keyed to it rather than to fromFolder, because
      // it is the only text in this dialog and it was telling people to use a
      // control that is filtered out of the button list. fsBackend() has returned
      // null since the decommission, so chooseBtn is never constructed, so the
      // sentence "Choose the report folder to see the rest" named a button that
      // was not on screen and could not be made to appear. Now the sentence and
      // the button arrive together or not at all, which also means sow-006
      // Phase 2 restores both by changing fsBackend() alone.
      var note = fromFolder
        ? '<div class="note ok">Listing the folder you granted access to, so anything added since ' +
          'the report was built appears here too.</div>'
        : '<div class="note">This lists what the document already carries' +
          (files.some(function (f) { return f.source === 'manifest'; })
            ? ' plus anything named in the build manifest' : '') + '.' +
          (chooseBtn ? ' Choose the report folder to see the rest.' : '') + '</div>';

      Ryker.dialog.open({
        title: 'Package report',
        body: d().el('div', {}, [
          htmlNode(note),
          d().el('label', { class: 'rk', text: 'Include' }),
          list
        ]),
        buttons: [
          { label: 'Cancel' },
          chooseBtn,
          {
            label: 'Export as ZIP', primary: true, keepOpen: true,
            action: function (api) { build(rows, base, api); return false; }
          }
        ].filter(Boolean)
      });
    }

    function htmlNode(s) { var n = document.createElement('div'); n.innerHTML = s; return n; }
    function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

    function build(rows, base, api) {
      var chosen = rows.filter(function (r) { return r.cb.checked; });
      var jobs = chosen.map(function (r) {
        var p = r.payload;
        if (p.kind === 'report') {
          var out = Ryker.exportHtml.scanned('ryker');
          if (out.hits.length) return Promise.reject({ leak: out.hits });
          return Promise.resolve({ name: base + '.html', data: out.html });
        }
        var f = p.file;
        if (f.handle) {
          return f.handle.getFile()
            .then(function (file) { return file.arrayBuffer(); })
            .then(function (buf) { return { name: f.name, data: new Uint8Array(buf) }; });
        }
        if (f.href) {
          return fetch(f.href).then(function (r) { return r.arrayBuffer(); })
            .then(function (buf) { return { name: f.name, data: new Uint8Array(buf) }; });
        }
        return Promise.resolve(null);
      });

      Promise.all(jobs).then(function (entries) {
        var files = entries.filter(Boolean);

        // Section 44, widened: every member is scanned, not only the document,
        // so a token pasted into a CSV inside the package is caught too.
        var hits = [];
        files.forEach(function (f) {
          var found = typeof f.data === 'string'
            ? Ryker.scan.text(f.data, f.name)
            : Ryker.scan.bytes(f.data, f.name);
          hits = hits.concat(found);
        });
        if (hits.length) { Ryker.dialog.leak(hits); api.close(); return; }

        var withManifest = files.concat([{
          name: 'ryker-package.json',
          data: Ryker.exportHtml.manifest(files.map(function (f) {
            var bytes = typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data;
            return { name: f.name, bytes: bytes.length, crc32: Ryker.zip.crc32(bytes) };
          }))
        }]);

        return Ryker.zip.build(withManifest).then(function (u8) {
          Ryker.zip.download(u8, base + '.zip');
          api.close();
        });
      }).catch(function (err) {
        api.close();
        if (err && err.leak) { Ryker.dialog.leak(err.leak); return; }
        Ryker.dialog.alert('Could not build the package',
          Ryker.dom.escapeHtml((err && err.message) || String(err)), 'bad');
      });
    }

    return { open: open, inlinedAssets: inlinedAssets };
  })();


  /* ---- ui/styles.js ---------------------------------------------- */
  // Styles, split by where they have to live.
  //
  // Everything Ryker draws goes in a shadow root, because the reports set bare
  // element selectors for p, h2, a, code and table plus a dark-mode block and a
  // print block, and a toolbar in the normal DOM inherits all of it. Shadow DOM
  // also stops Ryker's own styles reaching the report and changing the PDF.
  //
  // The exception is documentCss below, which styles the REPORT's own elements
  // and therefore cannot be scoped to a shadow root. Until 2026-08-16 the stated
  // reason for it was ::highlight(), which comments used to mark quoted text.
  // Comments are decommissioned and those rules are gone, but the sheet is still
  // load-bearing for what remains: the contenteditable state treatments, the
  // picked-block outline, the user-select lock during a cross-block drag, hiding
  // the report's own contents list while the rail is open, and the print rules
  // that keep Ryker out of the PDF.
  //
  // The scale below is deliberately Tailwind-shaped: a 4px spacing step, a small
  // radius set, ring-style focus rather than outline-on-the-edge, and one shadow
  // per elevation. Components then compose from tokens instead of each carrying
  // its own numbers.
  Ryker.styles = (function () {
    'use strict';

    var LIGHT = [
      '--rk-bg:#ffffff;--rk-bg2:#f5f6f8;--rk-bg3:#eceef2;',
      '--rk-fg:#16181d;--rk-fg2:#3f4551;--rk-muted:#6b7280;',
      '--rk-line:#e2e5ea;--rk-line2:#cfd4dc;--rk-field:#ffffff;',
      '--rk-accent:#4f46e5;--rk-accent-fg:#ffffff;--rk-accent-soft:rgba(79,70,229,.10);',
      '--rk-warn:#b45309;--rk-onwarn:#ffffff;--rk-warn-soft:rgba(180,83,9,.10);',
      '--rk-ok:#15803d;--rk-onok:#ffffff;--rk-ok-soft:rgba(21,128,61,.10);',
      '--rk-danger:#be123c;--rk-danger-soft:rgba(190,18,60,.09);',
      '--rk-ring:rgba(79,70,229,.35);',
      '--rk-sh-md:0 1px 2px rgba(16,20,30,.06),0 4px 12px rgba(16,20,30,.08);',
      '--rk-sh-xl:0 8px 24px rgba(16,20,30,.12),0 24px 56px rgba(16,20,30,.16);',
      '--rk-font:system-ui,sans-serif;',
      '--rk-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;'
    ].join('');

    var documentCss = [
      // No resting outline. A dashed box around every paragraph turned the whole
      // report into a form the moment Edit Mode opened, which made it hard to read
      // the thing you were editing. The caret already says where you are, so the
      // only marks left are a soft tint on the block in focus and a slightly
      // warmer one on a block with unsaved changes.
      // No fills behind text. A tint sits UNDER the words and changes how the
      // prose itself reads, which is the wrong place to put a state marker in a
      // document whose whole job is being read. These are all edge treatments:
      // the block looks slightly recessed, and the words keep their own colour.
      '[contenteditable="true"].ryker-editing{outline:none;border-radius:4px}',
      '[contenteditable="true"].ryker-editing:focus{outline:none;',
      '  box-shadow:inset 0 0 0 1px rgba(15,18,25,.10),inset 0 1px 3px rgba(15,18,25,.07)}',
      // Unsaved changes get a bar down the leading edge rather than a wash. It
      // reads at a glance when scanning a column of blocks, which a pale tint
      // does not.
      '[contenteditable="true"].ryker-dirty{box-shadow:inset 3px 0 0 rgba(217,119,6,.8)}',
      '[contenteditable="true"].ryker-dirty:focus{',
      '  box-shadow:inset 3px 0 0 rgba(217,119,6,.95),inset 0 0 0 1px rgba(15,18,25,.10)}',
      // The picked set. These style the REPORT's own elements, so they live in the
      // document stylesheet; a shadow root cannot reach them.
      // Picked blocks are outlined, not filled. A 16 percent wash over several
      // paragraphs made the selected text harder to read than the text around it,
      // which is backwards.
      '.ryker-pick{background:none;border-radius:3px;',
      '  box-shadow:inset 0 0 0 2px rgba(79,70,229,.55)}',
      // While a cross-block drag is live, the browser must not also be painting a
      // text selection underneath it.
      'body.ryker-picking, body.ryker-picking *{-webkit-user-select:none;user-select:none}',
      // The rail lists everything the report's own contents list does and more, so
      // leaving the sticky original visible puts it underneath and unclickable.
      'body[data-ryker-rail] nav.toc{display:none}',
      // Ryker must leave no trace in print. The PDF is the regression check, so
      // this rule is load-bearing rather than cosmetic.
      '@media print{#ryker-root{display:none !important}' +
        '[contenteditable]{outline:none !important;background:none !important}' +
        '.ryker-pick{background:none !important;box-shadow:none !important}' +
        // Only ever matches padding Ryker itself applied, so a report with body
        // padding of its own keeps it.
        'body[data-ryker-pushed]{padding-top:0 !important;padding-right:0 !important;' +
        'padding-left:0 !important}}'
    ].join('\n');

    var shadowCss = [
      ':host{all:initial}',
      '*,*::before,*::after{box-sizing:border-box}',

      // One palette. Ryker is chrome around a document, and a toolbar that changes
      // colour independently of the page it sits on was a distraction rather than
      // a feature.
      ':host{' + LIGHT + '}',

      ':host{',
      '  --rk-r-sm:5px;--rk-r-md:7px;--rk-r-lg:10px;--rk-r-xl:14px;',
      '  --rk-s1:4px;--rk-s2:8px;--rk-s3:12px;--rk-s4:16px;--rk-s5:20px;--rk-s6:24px;',
      '}',

      // Typography lives on the wrapper, not on :host.
      //
      // The host element carries an inline all:initial so the report's own CSS
      // cannot reach it, and an inline declaration beats any :host rule, so a
      // font set here could never apply: everything Ryker drew inherited the
      // browser default and rendered in Times. Custom properties survive
      // all:initial, which is why the tokens above still work from :host.
      '.layer{',
      // Plain sans-serif, deliberately not the report's font. The reports use the
      // platform UI stack, so borrowing it made Ryker's chrome read as part of the
      // document. The generic family is distinct from Segoe UI and San Francisco
      // on the platforms that have those, and resolves everywhere.
      '  font-family:var(--rk-font);',
      '  font-size:13px;line-height:1.55;color:var(--rk-fg);',
      '  -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;',
      '}',

      // ---- shared primitives ------------------------------------------------
      'button.rk{display:inline-flex;align-items:center;gap:6px;background:var(--rk-bg);',
      '  color:var(--rk-fg2);border:1px solid var(--rk-line2);border-radius:var(--rk-r-md);',
      '  padding:6px 11px;font:inherit;font-size:12px;font-weight:500;line-height:1.2;',
      '  cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,color .12s}',
      'button.rk:hover:not(:disabled){background:var(--rk-bg2);border-color:var(--rk-muted);color:var(--rk-fg)}',
      'button.rk:active:not(:disabled){background:var(--rk-bg3)}',
      'button.rk:disabled{opacity:.45;cursor:not-allowed}',
      'button.rk.ghost{border-color:transparent;background:transparent}',
      'button.rk.ghost:hover:not(:disabled){background:var(--rk-bg2);border-color:var(--rk-line)}',
      'button.rk.danger:hover:not(:disabled){background:var(--rk-danger-soft);',
      '  border-color:var(--rk-danger);color:var(--rk-danger)}',
      'button.rk.icon{padding:6px 9px}',
      // The active state comes last on purpose. It shares specificity with
      // .ghost, so declaring it earlier let a ghost button that was also active
      // render transparent and disappear entirely.
      'button.rk.on{background:var(--rk-accent);border-color:var(--rk-accent);color:var(--rk-accent-fg);font-weight:600}',
      'button.rk.on:hover:not(:disabled){background:var(--rk-accent);border-color:var(--rk-accent);',
      '  color:var(--rk-accent-fg);filter:brightness(1.08)}',

      ':is(button.rk,.handle,input.rk,textarea.rk):focus-visible{',
      '  outline:2px solid transparent;box-shadow:0 0 0 3px var(--rk-ring);',
      '  border-color:var(--rk-accent)}',

      '.count{display:inline-block;min-width:18px;text-align:center;background:var(--rk-bg3);',
      '  color:var(--rk-fg2);border-radius:999px;padding:1px 6px;margin-left:2px;',
      '  font-size:11px;font-weight:600;line-height:1.4}',
      '.count.warn{background:var(--rk-warn);color:var(--rk-onwarn)}',
      'button.rk.on .count{background:rgba(255,255,255,.24);color:var(--rk-accent-fg)}',

      // ---- collapsed handle -------------------------------------------------
      '.handle{position:fixed;top:0;right:20px;z-index:2147483000;',
      '  background:var(--rk-bg);color:var(--rk-fg);border:1px solid var(--rk-line2);border-top:none;',
      '  border-radius:0 0 var(--rk-r-lg) var(--rk-r-lg);padding:7px 13px;cursor:pointer;',
      '  font:inherit;font-size:12px;font-weight:600;letter-spacing:.02em;',
      '  display:flex;gap:8px;align-items:center;box-shadow:var(--rk-sh-md)}',
      '.handle:hover{background:var(--rk-bg2)}',
      '.handle .dot{width:7px;height:7px;border-radius:50%;background:var(--rk-muted);flex:none}',
      '.handle .dot.on{background:var(--rk-ok)}',
      '.handle .badge{background:var(--rk-warn);color:var(--rk-onwarn);border-radius:999px;',
      '  padding:1px 7px;font-size:11px;font-weight:700}',

      // ---- toolbar ----------------------------------------------------------
      '.bar{position:fixed;top:0;left:0;right:0;z-index:2147483000;background:var(--rk-bg);',
      '  border-bottom:1px solid var(--rk-line);display:flex;align-items:center;gap:6px;',
      '  padding:8px 12px;flex-wrap:wrap;box-shadow:var(--rk-sh-md)}',
      '.brand{font-weight:700;letter-spacing:.09em;font-size:10px;text-transform:uppercase;',
      '  color:var(--rk-muted);margin-right:var(--rk-s1)}',
      '.sep{width:1px;height:22px;background:var(--rk-line);margin:0 var(--rk-s1)}',
      '.spacer{flex:1}',
      '.where{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--rk-muted);',
      '  background:var(--rk-bg2);border:1px solid var(--rk-line);border-radius:999px;padding:4px 11px;',
      '  font:inherit;font-size:11px;cursor:pointer}',
      // Disabled means there is nothing it can do about what it is reporting, so
      // it stops looking like a control and goes back to being a label.
      '.where:disabled{cursor:default}',
      '.where:not(:disabled):hover{background:var(--rk-bg3);border-color:var(--rk-line2);color:var(--rk-fg2)}',
      '.where:focus-visible{outline:2px solid transparent;box-shadow:0 0 0 3px var(--rk-ring)}',

      '.hint{font-size:11px;color:var(--rk-muted)}',

      // ---- instant tooltip ---------------------------------------------------
      // White on black regardless of the palette, so it reads the same over the
      // toolbar and over report content, and shows with no delay.
      '.rk-tip{position:fixed;z-index:2147483200;background:#0d0f13;color:#fff;',
      '  border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:5px 9px;',
      '  font-size:11.5px;font-weight:500;line-height:1.35;max-width:280px;',
      '  pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.4)}',

      // A button reduced to its number.
      'button.rk.count-only{padding:5px 8px;min-width:34px;justify-content:center}',
      'button.rk.count-only .count{margin-left:0}',

      // ---- outline rail ------------------------------------------------------
      '.rail{position:fixed;left:0;top:var(--ryker-offset,0px);bottom:0;width:320px;',
      '  z-index:2147482900;display:flex;flex-direction:column;background:var(--rk-bg);',
      '  border-right:1px solid var(--rk-line);box-shadow:2px 0 18px rgba(15,18,25,.07)}',
      '.rail header{display:flex;align-items:center;gap:var(--rk-s2);flex:0 0 auto;',
      '  padding:var(--rk-s3) var(--rk-s4);border-bottom:1px solid var(--rk-line);',
      '  background:var(--rk-bg2)}',
      '.rail header h2{margin:0;font-size:12.5px;font-weight:600;letter-spacing:.02em}',
      '.rail .rail-count{font-size:11px;color:var(--rk-muted);font-variant-numeric:tabular-nums}',
      '.rail .spacer{flex:1 1 auto}',
      '.rail .rail-body{flex:1 1 auto;overflow:auto;padding:var(--rk-s2) 0}',
      '.rail .rail-grip{position:absolute;top:0;bottom:0;right:-4px;width:9px;cursor:col-resize;',
      '  z-index:1;background:transparent}',
      '.rail .rail-grip:hover,.rail .rail-grip:focus-visible{background:var(--rk-accent-soft);outline:none}',
      '.rail .rail-row{display:flex;align-items:center;gap:6px;height:26px;padding-right:8px;',
      '  cursor:pointer;font-size:12.5px;color:var(--rk-fg);white-space:nowrap;overflow:hidden;',
      '  border-left:2px solid transparent}',
      '.rail .rail-row:hover{background:var(--rk-bg2)}',
      '.rail .rail-row.on{background:var(--rk-accent-soft);border-left-color:var(--rk-accent)}',
      '.rail .rail-tw{flex:0 0 12px;width:12px;text-align:center;color:var(--rk-muted);font-size:9px}',
      '.rail .rail-tw.none{visibility:hidden}',
      '.rail .rail-ico{flex:0 0 14px;width:14px;text-align:center;color:var(--rk-muted);font-size:11px}',
      '.rail .rail-label{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}',
      '.rail .rail-row.k-heading .rail-label{font-weight:600}',
      '.rail .rail-row.r2 .rail-label{font-size:13px}',
      '.rail .rail-row.k-text .rail-label{color:var(--rk-muted)}',
      // Dragging a row. The row being carried fades rather than vanishes, so the
      // place it came from stays legible while the line shows where it lands.
      '.rail .rail-row.dragging{opacity:.42}',
      '.rail .rail-row:active{cursor:grabbing}',
      '.rail .rail-row.drop-before{box-shadow:inset 0 2px 0 var(--rk-accent)}',
      '.rail .rail-row.drop-after{box-shadow:inset 0 -2px 0 var(--rk-accent)}',
      '@media (max-width:820px){.rail{width:100%}}',

      // ---- floating format bar ----------------------------------------------
      // Dark on purpose. It sits over report content rather than over Ryker
      // chrome, so it has to read as an overlay rather than blend into the page.
      '.formatbar{position:fixed;z-index:2147483060;display:flex;align-items:center;gap:2px;',
      '  background:#16181d;border:1px solid rgba(255,255,255,.12);border-radius:var(--rk-r-md);',
      '  padding:4px;box-shadow:0 6px 22px rgba(0,0,0,.34)}',
      '.formatbar .fb-btn{background:transparent;border:none;color:#e9ecf2;border-radius:5px;',
      '  min-width:30px;height:28px;padding:0 8px;display:inline-flex;align-items:center;',
      '  justify-content:center;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;',
      '  transition:background .12s}',
      '.formatbar .fb-btn:hover{background:rgba(255,255,255,.14);color:#fff}',
      '.formatbar .fb-btn:focus-visible{outline:2px solid #8b93ff;outline-offset:-2px;box-shadow:none}',
      // Named rather than counted. nth-of-type counted every button in the bar,
      // so the italic face landed on B and the strikethrough on I, and adding any
      // control would have shifted them again.
      '.formatbar .fb-i{font-style:italic;font-family:Georgia,"Times New Roman",serif}',
      '.formatbar .fb-s{text-decoration:line-through}',
      '.formatbar .fb-kill{color:#ffb4b4}',
      '.formatbar .fb-kill:hover{background:#7f1d1d;color:#fff}',
      '.formatbar .fb-sep{width:1px;height:18px;background:rgba(255,255,255,.16);margin:0 3px}',
      '.formatbar .fb-type{min-width:74px;font-weight:500;font-size:12px;gap:5px}',
      '.formatbar .fb-type::after{content:"";width:0;height:0;border-left:3.5px solid transparent;',
      '  border-right:3.5px solid transparent;border-top:4px solid currentColor;opacity:.7;margin-left:2px}',
      '.formatbar .fb-type:disabled{opacity:.4;cursor:not-allowed}',

      // ---- icon buttons ------------------------------------------------------
      'button.rk.iconbtn{padding:6px;min-width:30px;justify-content:center;color:var(--rk-muted)}',
      'button.rk.iconbtn:hover:not(:disabled){color:var(--rk-fg)}',
      'button.rk.iconbtn svg{display:block}',

      // ---- dropdown menu -----------------------------------------------------
      '.menu{position:fixed;z-index:2147483110;min-width:200px;background:var(--rk-bg);',
      '  border:1px solid var(--rk-line);border-radius:var(--rk-r-lg);padding:5px;',
      '  box-shadow:var(--rk-sh-xl)}',
      '.menu-item{display:flex;align-items:center;gap:9px;width:100%;background:none;border:none;',
      '  border-radius:var(--rk-r-sm);padding:7px 9px;font:inherit;font-size:12.5px;',
      '  color:var(--rk-fg2);cursor:pointer;text-align:left}',
      '.menu-item:hover{background:var(--rk-bg2);color:var(--rk-fg)}',
      '.menu-item:focus-visible{outline:2px solid transparent;box-shadow:0 0 0 3px var(--rk-ring)}',
      '.menu-item.off{color:var(--rk-muted);cursor:default}',
      '.menu-item.off:hover{background:transparent}',
      '.menu-item.danger{color:var(--rk-danger)}',
      '.menu-item.danger:hover{background:var(--rk-danger-soft)}',
      '.menu-ico{display:inline-flex;flex:none;color:var(--rk-muted)}',
      '.menu-item.danger .menu-ico{color:var(--rk-danger)}',
      '.menu-sep{display:block;height:1px;background:var(--rk-line);margin:5px 3px}',
      '.where .dot{width:7px;height:7px;border-radius:50%;background:var(--rk-muted);flex:none}',
      '.where .dot.ok{background:var(--rk-ok)}.where .dot.warn{background:var(--rk-warn)}',

      // ---- instruction pane --------------------------------------
      '.pane{position:fixed;top:var(--ryker-offset,0px);right:0;bottom:0;width:430px;max-width:94vw;',
      '  z-index:2147482900;background:var(--rk-bg);border-left:1px solid var(--rk-line);',
      '  display:flex;flex-direction:column;box-shadow:var(--rk-sh-xl)}',
      // A wide grab area with a narrow visible line: easy to hit, quiet at rest.
      '.pane-grip{position:absolute;left:-4px;top:0;bottom:0;width:10px;cursor:col-resize;',
      '  z-index:2}',
      '.pane-grip::after{content:"";position:absolute;left:3px;top:0;bottom:0;width:2px;',
      '  background:transparent;transition:background .12s}',
      '.pane-grip:hover::after,.pane-grip:focus-visible::after{background:var(--rk-accent)}',
      '.pane-grip:focus-visible{outline:none}',
      '.pane.resizing{user-select:none}',
      '.pane.resizing .pane-grip::after{background:var(--rk-accent)}',
      '.pane header{padding:var(--rk-s3) var(--rk-s4);border-bottom:1px solid var(--rk-line);',
      '  display:flex;align-items:center;gap:var(--rk-s2);background:var(--rk-bg2)}',
      '.pane header h2{margin:0;font-size:13px;font-weight:700}',
      '.pane .pane-body{flex:1;display:flex;padding:var(--rk-s3) var(--rk-s4);min-height:0}',
      '.pane textarea.pane-text{flex:1;resize:none;font-family:var(--rk-mono);font-size:11.5px;',
      '  line-height:1.6;white-space:pre;overflow:auto}',
      '.pane .pane-status{padding:0 var(--rk-s4) var(--rk-s2);font-size:11px;color:var(--rk-muted)}',
      '.pane .pane-status.ok{color:var(--rk-ok)}',
      '.pane .pane-status button.linkish{background:none;border:none;padding:0;margin-left:2px;',
      '  color:var(--rk-accent);font:inherit;font-size:11px;text-decoration:underline;',
      '  text-underline-offset:2px;cursor:pointer}',
      '.pane .pane-status.warn{color:var(--rk-warn)}',
      // Clear lives in the header row now, beside rebuild, so an icon button has
      // to be able to read as destructive on its own.
      'button.rk.iconbtn.danger{color:var(--rk-danger);opacity:.75}',
      'button.rk.iconbtn.danger:hover:not(:disabled){color:var(--rk-danger);opacity:1;',
      '  background:var(--rk-danger-soft);border-color:transparent}',
      '.danger-lead{font-size:12.5px;font-weight:600;border-left-width:4px}',
      '@media (max-width:820px){.pane{width:100%}}',

      // A row of buttons. This was '.card .acts' until 2026-08-16, and .card was
      // a comment card, so when comments were decommissioned the descendant
      // qualifier stopped matching anything and both surviving .acts rows lost
      // their layout: the Copy and Download buttons in the reset-document
      // confirmation are built with dom.el, so no whitespace text node separates
      // them and they rendered flush against each other. Bare, because there is
      // no ancestor left to qualify by.
      '.acts{display:flex;gap:5px;flex-wrap:wrap}',

      // ---- fields -----------------------------------------------------------
      'textarea.rk,input.rk{display:block;width:100%;background:var(--rk-field);color:var(--rk-fg);',
      '  border:1px solid var(--rk-line2);border-radius:var(--rk-r-md);padding:9px 11px;',
      '  font:inherit;font-size:12.5px;line-height:1.55;resize:vertical;',
      '  transition:border-color .12s,box-shadow .12s}',
      'textarea.rk::placeholder,input.rk::placeholder{color:var(--rk-muted)}',
      'label.rk{display:block;font-size:10.5px;font-weight:600;color:var(--rk-muted);',
      '  margin:var(--rk-s3) 0 6px;text-transform:uppercase;letter-spacing:.07em}',
      'label.rk:first-child{margin-top:0}',

      // ---- modal ------------------------------------------------------------
      // Anchored middle right rather than centred. A dialog in the middle of the
      // page covers the very text being commented on, which is exactly what the
      // person needs to see while writing about it.
      '.backdrop{position:fixed;inset:0;z-index:2147483100;background:rgba(10,12,18,.5);',
      '  display:flex;align-items:center;justify-content:flex-end;',
      '  padding:var(--rk-s5) var(--rk-s5) var(--rk-s5) var(--rk-s4);overflow-y:auto}',
      '.modal{background:var(--rk-bg);border:1px solid var(--rk-line);border-radius:var(--rk-r-xl);',
      '  width:100%;max-width:460px;box-shadow:var(--rk-sh-xl);overflow:hidden}',
      '.modal header{padding:var(--rk-s4) var(--rk-s5);border-bottom:1px solid var(--rk-line);',
      '  background:var(--rk-bg2)}',
      '.modal header h2{margin:0;font-size:13.5px;font-weight:650;letter-spacing:.005em;color:var(--rk-fg)}',
      '.modal .body{padding:var(--rk-s4) var(--rk-s5);max-height:62vh;overflow-y:auto;color:var(--rk-fg2)}',
      '.modal .foot{padding:var(--rk-s3) var(--rk-s5);border-top:1px solid var(--rk-line);',
      '  display:flex;gap:var(--rk-s2);justify-content:flex-end;flex-wrap:wrap;background:var(--rk-bg2)}',
      '.modal p{margin:0 0 var(--rk-s3)}.modal p:last-child{margin-bottom:0}',
      '.modal ul{margin:0 0 var(--rk-s3);padding-left:var(--rk-s5)}.modal li{margin-bottom:var(--rk-s1)}',
      '.modal a{color:var(--rk-accent);text-underline-offset:2px}',
      '.modal b{color:var(--rk-fg)}',
      '.modal code,.modal pre{background:var(--rk-bg3);border-radius:var(--rk-r-sm);',
      '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;',
      '  overflow-wrap:anywhere;color:var(--rk-fg)}',
      '.modal code{padding:2px 5px}',
      '.modal pre{padding:var(--rk-s3);overflow-x:auto;border:1px solid var(--rk-line);line-height:1.5}',
      // ---- callouts ---------------------------------------------------------
      // Square on the left. The accent stripe is the point of a notice, and a
      // rounded corner cutting across it reads as a rendering fault rather than a
      // detail. The right corners stay rounded, matching the quote blocks.
      '.note{border:1px solid var(--rk-line);border-left:3px solid var(--rk-accent);',
      '  border-radius:0 var(--rk-r-md) var(--rk-r-md) 0;padding:10px var(--rk-s3);margin:var(--rk-s3) 0;',
      '  background:var(--rk-accent-soft);font-size:11.5px;line-height:1.55;color:var(--rk-fg2)}',
      '.note:first-child{margin-top:0}.note:last-child{margin-bottom:0}',
      '.note.warn{border-left-color:var(--rk-warn);background:var(--rk-warn-soft)}',
      '.note.bad{border-left-color:var(--rk-danger);background:var(--rk-danger-soft)}',
      '.note.ok{border-left-color:var(--rk-ok);background:var(--rk-ok-soft)}',

      // ---- lists and rows ---------------------------------------------------
      '.filelist{border:1px solid var(--rk-line);border-radius:var(--rk-r-md);',
      '  max-height:240px;overflow-y:auto;background:var(--rk-bg2)}',
      '.filerow{display:flex;align-items:center;gap:var(--rk-s2);padding:7px 11px;',
      '  border-bottom:1px solid var(--rk-line);font-size:12px}',
      '.filerow:last-child{border-bottom:none}',
      '.filerow .sz{margin-left:auto;color:var(--rk-muted);font-size:11px;flex:none}',
      '.filerow .nm{overflow-wrap:anywhere}',

      '.muted{color:var(--rk-muted)}',
      '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',

      '@media (max-width:720px){',
      '  .bar{padding:6px 8px}.brand{display:none}',
      '  .backdrop{justify-content:center;padding:var(--rk-s3)}',
      '  .modal{max-width:100%}',
      '}',
      '@media (prefers-reduced-motion: reduce){*{transition:none !important}}'
    ].join('\n');

    return { shadowCss: shadowCss, documentCss: documentCss, LIGHT: LIGHT };
  })();


  /* ---- ui/shell.js ----------------------------------------------- */
  // The shadow root Ryker draws into, and the two places it touches host layout.
  //
  // The reports put nav.toc at position:sticky; top:0 and the toolbar is fixed to
  // the same edge, so Ryker stays collapsed to a small handle by default and only
  // claims space when someone opens it. The side panel prefers the layout's own
  // right margin and takes width from the report only when the margin is short.
  Ryker.shell = (function () {
    'use strict';

    var host = null, shadow = null, layer = null;
    var shifted = [];

    function mount() {
      if (host) return shadow;

      host = document.createElement('div');
      host.id = 'ryker-root';
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
      var doc = document.createElement('style');
      doc.id = 'ryker-document-css';
      doc.textContent = Ryker.styles.documentCss;
      document.head.appendChild(doc);

      return shadow;
    }

    function root() { return layer || (mount() && layer); }

    function add(node) { root().appendChild(node); return node; }

    // ---- vertical: keeping the toolbar off the top of the document ----------

    function stickyCandidates() {
      var out = [];
      Array.prototype.forEach.call(document.querySelectorAll('body *'), function (n) {
        if (n.id === 'ryker-root' || n.closest('#ryker-root')) return;
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
      document.body.style.removeProperty('padding-top');
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
      spaces[side] = node || null;
      document.body.style.removeProperty(prop);
      if (!node) {
        if (!spaces.left && !spaces.right) document.body.removeAttribute('data-ryker-pushed');
        if (!document.body.getAttribute('style')) document.body.removeAttribute('style');
        return;
      }

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
      var doc = document.getElementById('ryker-document-css');
      if (doc && doc.parentNode) doc.parentNode.removeChild(doc);
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = shadow = layer = null;
    }

    return {
      mount: mount, root: root, add: add, teardown: teardown,
      setOffset: setOffset, releaseOffset: releaseOffset,
      setPanelSpace: setPanelSpace, releasePanelSpace: releasePanelSpace,
      setEdgeSpace: setEdgeSpace, releaseEdgeSpace: releaseEdgeSpace,
      shadow: function () { return shadow; },
      host: function () { return host; }
    };
  })();


  /* ---- ui/icons.js ----------------------------------------------- */
  // Inline SVG icons. Small, stroke-based, currentColor, so they take the
  // button's own colour and need no font or network.
  Ryker.icons = (function () {
    'use strict';

    var PATHS = {
      copy: '<rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/>' +
            '<path d="M10.5 3.5h-6a1.5 1.5 0 0 0-1.5 1.5v7"/>',
      download: '<path d="M8 3v8"/><path d="M4.5 8.5 8 12l3.5-3.5"/><path d="M3 13.5h10"/>',
      rebuild: '<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 3v3h-3"/>',
      more: '<circle cx="4" cy="8" r="1.1" fill="currentColor" stroke="none"/>' +
            '<circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/>' +
            '<circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none"/>',
      close: '<path d="M4.5 4.5l7 7"/><path d="M11.5 4.5l-7 7"/>',
      link: '<path d="M7 9a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1"/>' +
            '<path d="M9 7a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1"/>',
      unlink: '<path d="M6.5 9.5 3.5 12.5"/><path d="M9.5 6.5 12.5 3.5"/>' +
              '<path d="M6 4V2"/><path d="M4 6H2"/><path d="M10 12v2"/><path d="M12 10h2"/>',
      trash: '<path d="M3.5 4.5h9"/><path d="M6.5 4.5V3h3v1.5"/>' +
             '<path d="M5 4.5l.6 8h4.8l.6-8"/>',
      outline: '<path d="M3 4.5h10"/><path d="M5.5 8h7.5"/><path d="M5.5 11.5h7.5"/>' +
        '<circle cx="3.2" cy="8" r=".8" fill="currentColor" stroke="none"/>' +
        '<circle cx="3.2" cy="11.5" r=".8" fill="currentColor" stroke="none"/>',
      package: '<path d="M8 2.5 13.5 5.5v5L8 13.5 2.5 10.5v-5z"/><path d="M2.5 5.5 8 8.5l5.5-3"/><path d="M8 8.5v5"/>',
      up: '<path d="M8 12.5V3.5"/><path d="M4.5 7 8 3.5 11.5 7"/>',
      down: '<path d="M8 3.5v9"/><path d="M4.5 9 8 12.5 11.5 9"/>'
    };

    function svg(name, size) {
      var s = size || 16;
      return '<svg viewBox="0 0 16 16" width="' + s + '" height="' + s + '" aria-hidden="true" ' +
        'fill="none" stroke="currentColor" stroke-width="1.4" ' +
        'stroke-linecap="round" stroke-linejoin="round">' + (PATHS[name] || '') + '</svg>';
    }

    // Icon-only buttons still need a name for anyone not looking at them, so the
    // label becomes both the tooltip and the accessible name rather than being
    // dropped along with the text.
    function button(name, label, onclick, extraClass) {
      var b = Ryker.dom.el('button', {
        class: 'rk iconbtn' + (extraClass ? ' ' + extraClass : ''),
        title: label, 'aria-label': label, type: 'button'
      });
      b.innerHTML = svg(name);
      if (onclick) b.addEventListener('click', onclick);
      return b;
    }

    return { svg: svg, button: button, PATHS: PATHS };
  })();


  /* ---- ui/tooltip.js --------------------------------------------- */
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


  /* ---- ui/dialog.js ---------------------------------------------- */
  // Modal dialogs, inside the shadow root. Escape closes the topmost one, and it
  // stops propagation so the host report's own Escape handler does not also fire.
  Ryker.dialog = (function () {
    'use strict';

    var stack = [];

    function open(opts) {
      var d = Ryker.dom;
      var backdrop = d.el('div', { class: 'backdrop', role: 'dialog', 'aria-modal': 'true' });
      var body = d.el('div', { class: 'body' });

      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else if (opts.body) body.appendChild(opts.body);

      var foot = d.el('div', { class: 'foot' });
      var api = {
        close: function () { close(backdrop); },
        body: body,
        foot: foot,
        setBody: function (node) {
          body.innerHTML = '';
          if (typeof node === 'string') body.innerHTML = node;
          else if (node) body.appendChild(node);
        },
        setFoot: function (buttons) {
          foot.innerHTML = '';
          (buttons || []).forEach(function (b) { foot.appendChild(b); });
        }
      };

      (opts.buttons || []).forEach(function (b) {
        foot.appendChild(d.el('button', {
          class: 'rk' + (b.primary ? ' on' : '') + (b.danger ? ' danger' : ''),
          text: b.label,
          onclick: function () {
            if (!b.action) { api.close(); return; }
            var r = b.action(api);
            if (r !== false && !b.keepOpen) api.close();
          }
        }));
      });
      if (!opts.buttons || !opts.buttons.length) {
        foot.appendChild(d.el('button', { class: 'rk', text: 'Close', onclick: api.close }));
      }

      var modal = d.el('div', { class: 'modal' }, [
        d.el('header', {}, [d.el('h2', { text: opts.title || 'Ryker' })]),
        body,
        foot
      ]);
      backdrop.appendChild(modal);

      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop && opts.dismissable !== false) api.close();
      });

      Ryker.shell.add(backdrop);
      stack.push({ node: backdrop, api: api });

      var focusable = modal.querySelector('button.rk, input, textarea');
      if (focusable) focusable.focus();

      return api;
    }

    function close(node) {
      for (var i = stack.length - 1; i >= 0; i--) {
        if (!node || stack[i].node === node) {
          if (stack[i].node.parentNode) stack[i].node.parentNode.removeChild(stack[i].node);
          stack.splice(i, 1);
          if (!node) return;
        }
      }
    }

    function closeTop() {
      if (!stack.length) return false;
      close(stack[stack.length - 1].node);
      return true;
    }

    function isOpen() { return stack.length > 0; }

    function alert(title, bodyHtml, kind) {
      return open({
        title: title,
        body: '<div class="note ' + (kind || '') + '">' + bodyHtml + '</div>'
      });
    }

    function confirm(title, bodyHtml, confirmLabel, onConfirm) {
      return open({
        title: title,
        body: bodyHtml,
        buttons: [
          { label: 'Cancel' },
          { label: confirmLabel || 'Continue', primary: true, action: onConfirm }
        ]
      });
    }


    // Shown when the credential scan stops an export. Its callers are the
    // packager (per-file and per-report) and the export menu in bootstrap/boot.js.
    //
    // It does NOT gate the instruction pane. pane.copy() and pane.download() take
    // the textarea's value straight to the clipboard or a Blob without passing
    // through Ryker.scan, and the instruction text quotes report content
    // verbatim, so that is the path a credential would actually ride out on.
    // Whether the pane should be scanned is an open question rather than an
    // oversight to fix silently: the pane's whole purpose is reproducing document
    // text, so a scan there would fire on any report that legitimately discusses
    // a token. Recorded here so the next reader does not assume it is covered.
    function leak(hits) {
      var rows = (hits || []).map(function (h) {
        return '<li><b>' + Ryker.dom.escapeHtml(h.pattern) + '</b> in ' +
          Ryker.dom.escapeHtml(h.artifact) + ': <code>' + Ryker.dom.escapeHtml(h.excerpt) + '</code></li>';
      }).join('');
      return open({
        title: 'Stopped: this looks like a credential',
        body: '<div class="note bad">The scan found something matching a known credential pattern. ' +
          'The export was stopped rather than written.</div><ul>' + rows + '</ul>' +
          '<p>Remove it from the document and try again. If this is a false positive, the text ' +
          'still should not ship in a report.</p>'
      });
    }

    return { open: open, close: close, closeTop: closeTop, isOpen: isOpen,
             alert: alert, confirm: confirm, leak: leak };
  })();


  /* ---- ui/menu.js ------------------------------------------------ */
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


  /* ---- editor/editable.js ---------------------------------------- */
  // Edit Mode. Per-block contenteditable over prose only, with sanitising on
  // paste and on input, and a baseline snapshot so a save knows exactly which
  // blocks moved.
  Ryker.editable = (function () {
    'use strict';

    var on = false;
    var baseline = null;
    var bound = [];
    var listeners = [];

    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

    function enable() {
      if (on) return;
      // No stamping here. Block ids come from the document's own content and are
      // already correct, so the baseline taken at boot stays valid.
      baseline = baseline || Ryker.blocks.snapshot();
      Ryker.blocks.all().forEach(function (b) {
        b.node.setAttribute('contenteditable', 'true');
        b.node.setAttribute('spellcheck', 'true');
        b.node.classList.add('ryker-editing');
        bindOne(b.node, b.id);
      });
      on = true;
      emit();
    }

    function bindOne(n, id) {
      var handlers = {
          paste: function (e) {
            var clean = Ryker.sanitize.fromClipboard(e);
            if (clean == null) return;
            e.preventDefault();
            insertHtml(clean);
            mark(n, id);
          },
          drop: function (e) {
            // A drop can carry arbitrary HTML and files. Refusing it outright is
            // simpler than sanitising every shape it can take, and dropping into
            // a paragraph is not a workflow anyone needs.
            e.preventDefault();
          },
          input: function () { Ryker.history.text(n); mark(n, id); },
          blur: function () {
            if (Ryker.sanitize.element(n)) mark(n, id);
          },
          keydown: function (e) {
            // Backspace at the very start of a block joins it to the one before,
            // which is what makes an emptied paragraph disappear when you keep
            // pressing it. Without this the block stayed as an empty shell and
            // there was no way to remove it at all.
            if (e.key === 'Backspace' && caretAtEdge(n, 'start')) {
              if (mergeWith(n, 'previous')) e.preventDefault();
              return;
            }
            // Delete at the very end pulls the next block up into this one.
            if (e.key === 'Delete' && caretAtEdge(n, 'end')) {
              if (mergeWith(n, 'next')) e.preventDefault();
              return;
            }
            if (e.key !== 'Enter') return;
            // Shift+Enter is a line break inside the block. Plain Enter splits it
            // into two, which is what someone breaking a paragraph in half means.
            if (e.shiftKey) return;
            if (n.tagName === 'TD' || n.tagName === 'TH') { e.preventDefault(); return; }
            e.preventDefault();
            splitAt(n);
          }
      };
      Object.keys(handlers).forEach(function (k) { n.addEventListener(k, handlers[k]); });
      bound.push({ node: n, handlers: handlers });
    }

    // Splits a block at the caret into two siblings of the same kind. The new
    // block gets its own stamped id, so the journal records it as an addition and
    // every other block keeps the identity it already had.
    function splitAt(node) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      if (!node.contains(range.startContainer)) return;

      var beforeSplit = node.innerHTML;
      range.deleteContents();
      var tail = range.cloneRange();
      tail.selectNodeContents(node);
      tail.setStart(range.endContainer, range.endOffset);
      var frag = tail.extractContents();

      var clone = document.createElement(node.tagName);
      // Ryker's own state classes must not be copied onto a brand new block.
      var keep = (node.getAttribute('class') || '').split(/\s+/)
        .filter(function (c) { return c && c.indexOf('ryker-') !== 0; });
      if (keep.length) clone.className = keep.join(' ');
      clone.appendChild(frag);
      if (!clone.textContent.trim()) clone.innerHTML = '<br>';
      if (!node.textContent.trim()) node.innerHTML = '<br>';

      var nodeBefore = beforeSplit;
      node.parentNode.insertBefore(clone, node.nextSibling);
      Ryker.history.record({
        label: 'split',
        undo: function () {
          if (clone.parentNode) clone.parentNode.removeChild(clone);
          node.innerHTML = nodeBefore;
          place(node, 'end');
        },
        redo: function () {
          node.innerHTML = nodeAfterSplit;
          node.parentNode.insertBefore(clone, node.nextSibling);
          rebind(clone);
          place(clone, 'start');
        }
      });
      // Only the new half is stamped. Stamping the original too renamed it, so a
      // split recorded as a delete plus two inserts rather than the edit and the
      // insert it actually is. Its content-derived id is cached and stays valid.
      Ryker.blocks.stamp(clone);

      bindOne(clone, Ryker.blocks.blockId(clone));
      clone.setAttribute('contenteditable', 'true');
      clone.setAttribute('spellcheck', 'true');
      clone.classList.add('ryker-editing', 'ryker-dirty');
      node.classList.add('ryker-dirty');

      var caret = document.createRange();
      caret.setStart(clone, 0);
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);
      clone.focus();

      nodeAfterSplit = node.innerHTML;
      emit();
    }

    var nodeAfterSplit = '';

    // A detached element keeps its listeners, classes and attributes, so putting
    // one back needs no rebinding in the ordinary case. This exists for the case
    // where Edit Mode was toggled in between, and is idempotent either way.
    function rebind(node) {
      if (!on) return;
      node.setAttribute('contenteditable', 'true');
      node.setAttribute('spellcheck', 'true');
      node.classList.add('ryker-editing');
      var already = bound.some(function (b) { return b.node === node; });
      if (!already) bindOne(node, Ryker.blocks.blockId(node));
    }

    function place(node, edge) {
      try {
        var r = document.createRange();
        r.selectNodeContents(node);
        r.collapse(edge === 'start');
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        node.focus();
      } catch (e) {}
    }

    var BLOCK_TYPES = ['P', 'H2', 'H3', 'H4', 'H5'];

    // Changes a block's element type, keeping its contents and its attributes.
    //
    // The id attribute travels with it deliberately: a heading's id is the anchor
    // the table of contents points at, and dropping it would break every link to
    // that section.
    function convert(node, tag) {
      tag = String(tag || '').toUpperCase();
      if (!node || BLOCK_TYPES.indexOf(tag) === -1) return false;
      if (node.tagName === tag) return false;
      if (node.tagName === 'TD' || node.tagName === 'TH' || node.tagName === 'LI') return false;

      var host = node.parentNode;
      var at = node.nextSibling;
      var made = document.createElement(tag.toLowerCase());
      Array.prototype.forEach.call(node.attributes, function (a) {
        if (a.name === 'contenteditable' || a.name === 'spellcheck') return;
        made.setAttribute(a.name, a.value);
      });
      made.className = (node.getAttribute('class') || '').split(/\s+/)
        .filter(function (c) { return c && c.indexOf('ryker-') !== 0; }).join(' ');
      if (!made.className) made.removeAttribute('class');
      while (node.firstChild) made.appendChild(node.firstChild);

      host.replaceChild(made, node);
      rebind(made);
      made.classList.add('ryker-dirty');

      Ryker.history.record({
        label: 'convert',
        undo: function () {
          while (made.firstChild) node.appendChild(made.firstChild);
          if (made.parentNode) made.parentNode.replaceChild(node, made);
          rebind(node);
          place(node, 'end');
        },
        redo: function () {
          while (node.firstChild) made.appendChild(node.firstChild);
          if (node.parentNode) node.parentNode.replaceChild(made, node);
          rebind(made);
          place(made, 'end');
        }
      });

      place(made, 'end');
      emit();
      return true;
    }

    function blockTypeOf(node) {
      return node && BLOCK_TYPES.indexOf(node.tagName) !== -1 ? node.tagName : null;
    }

    // True when the caret sits at the very start or end of a block with nothing
    // selected. Measured by asking how much text lies between the block edge and
    // the caret, which is the only reading that survives nested markup.
    function caretAtEdge(node, edge) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return false;
      var r = sel.getRangeAt(0);
      if (!r.collapsed) return false;
      if (!node.contains(r.startContainer)) return false;
      var probe = document.createRange();
      probe.selectNodeContents(node);
      try {
        if (edge === 'start') probe.setEnd(r.startContainer, r.startOffset);
        else probe.setStart(r.startContainer, r.startOffset);
      } catch (e) { return false; }
      return probe.toString().replace(/[​\s]/g, '') === '';
    }

    function neighbour(node, dir) {
      var list = Ryker.blocks.sequence();
      var i = list.indexOf(node);
      if (i === -1) return null;
      var j = dir === 'previous' ? i - 1 : i + 1;
      return list[j] || null;
    }

    // Joins two blocks into one. The earlier block survives and keeps its id, so
    // the change records as an edit to it plus a deletion of the later one, which
    // is exactly what someone applying the change needs to do.
    function mergeWith(node, dir) {
      var other = neighbour(node, dir);
      if (!other) return false;

      // Table cells are structure, not prose. Merging two of them would change
      // what the table means and break the row.
      var STRUCTURAL = { TD: 1, TH: 1 };
      if (STRUCTURAL[node.tagName] || STRUCTURAL[other.tagName]) return false;

      var keep = dir === 'previous' ? other : node;
      var drop = dir === 'previous' ? node : other;

      // Headings are structure. Merging one into a paragraph destroys a section
      // title and desyncs the table of contents, and merging a paragraph into a
      // heading silently promotes body text. The earlier guard only covered the
      // second case, so backspacing at the start of a heading, which makes the
      // paragraph above the survivor, quietly swallowed the heading.
      var HEADING = /^H[1-6]$/;
      var mixed = HEADING.test(keep.tagName) !== HEADING.test(drop.tagName) ||
                  (HEADING.test(keep.tagName) && keep.tagName !== drop.tagName);
      if (mixed) {
        // An empty heading is not structure worth keeping, so it goes on its own
        // rather than being merged into anything.
        if (HEADING.test(drop.tagName) && !Ryker.dom.textOf(drop)) {
          var gone = drop, at = drop.nextSibling, host = drop.parentNode;
          host.removeChild(drop);
          Ryker.history.record({
            label: 'delete heading',
            undo: function () { host.insertBefore(gone, at); rebind(gone); },
            redo: function () { if (gone.parentNode) gone.parentNode.removeChild(gone); }
          });
          place(keep, 'end');
          emit();
          return true;
        }
        return false;
      }

      var joinAt = keep.childNodes.length;
      var keepBefore = keep.innerHTML, dropBefore = drop.innerHTML;
      var dropAt = drop.nextSibling, dropHost = drop.parentNode;

      while (drop.firstChild) keep.appendChild(drop.firstChild);
      if (drop.parentNode) drop.parentNode.removeChild(drop);

      var keepAfter;
      Ryker.history.record({
        label: 'merge',
        undo: function () {
          keep.innerHTML = keepBefore;
          drop.innerHTML = dropBefore;
          dropHost.insertBefore(drop, dropAt);
          rebind(drop);
          place(drop, 'start');
        },
        redo: function () {
          keep.innerHTML = keepAfter;
          if (drop.parentNode) drop.parentNode.removeChild(drop);
          place(keep, 'end');
        }
      });

      // Collapse the <br> a freshly emptied block leaves behind.
      Array.prototype.slice.call(keep.querySelectorAll('br')).forEach(function (br) {
        if (!br.nextSibling || !Ryker.dom.textOf(keep)) br.parentNode.removeChild(br);
      });

      var caret = document.createRange();
      caret.setStart(keep, Math.min(joinAt, keep.childNodes.length));
      caret.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(caret);
      keep.focus();

      keepAfter = keep.innerHTML;
      mark(keep, Ryker.blocks.blockId(keep));
      emit();
      return true;
    }

    // Formatting, applied to the selection inside an editable block. execCommand
    // is deprecated and is still the only thing every browser implements for
    // contenteditable, so it is used and then the result is put through the
    // allowlist rather than trusted.
    function format(cmd, value) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return false;
      var node = sel.getRangeAt(0).commonAncestorContainer;
      if (node.nodeType === 3) node = node.parentNode;
      var block = node.closest ? node.closest('[contenteditable="true"]') : null;
      if (!block) return false;

      try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
      try { document.execCommand(cmd, false, value); } catch (e) { return false; }

      Ryker.sanitize.element(block);
      mark(block, Ryker.blocks.blockId(block));
      return true;
    }

    // Kept as the name the toolbar and the full build already call. The work
    // moved to Ryker.links, which handles editing an existing anchor as well as
    // making a new one, and which editable.js has no room left to host.
    function makeLink() {
      return Ryker.links.open();
    }

    function restore(range) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    function insertHtml(html) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      range.deleteContents();
      var tpl = document.createElement('template');
      tpl.innerHTML = html;
      var frag = tpl.content;
      var last = frag.lastChild;
      range.insertNode(frag);
      if (last) {
        range.setStartAfter(last);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }

    function mark(node, id) {
      var was = node.classList.contains('ryker-dirty');
      var changed = baseline && Ryker.blocks.htmlOf(baseline[id]) !== node.innerHTML;
      node.classList.toggle('ryker-dirty', !!changed);
      if (was !== !!changed) emit();
      else if (changed) emit();
    }

    function disable() {
      if (!on) return;
      bound.forEach(function (b) {
        Object.keys(b.handlers).forEach(function (k) {
          b.node.removeEventListener(k, b.handlers[k]);
        });
        b.node.removeAttribute('contenteditable');
        b.node.removeAttribute('spellcheck');
        b.node.classList.remove('ryker-editing');
      });
      bound = [];
      on = false;
      emit();
    }

    function isOn() { return on; }

    function changes() {
      if (!baseline) return [];
      return Ryker.blocks.diffSnapshots(baseline, Ryker.blocks.snapshot());
    }

    // Two questions, one walk of the document. A move changes no block's content,
    // so diffSnapshots is silent about it and asking changes() alone left Save
    // disabled after a reorder; and taking a second snapshot to ask about order
    // would double the cost of something that runs on every keystroke.
    function isDirty() {
      if (!baseline) return false;
      var now = Ryker.blocks.snapshot();
      if (Ryker.blocks.diffSnapshots(baseline, now).length) return true;
      return !!(Ryker.move && Ryker.move.between(baseline, now).length);
    }

    function baselineOf() { return baseline; }

    // Called after a successful save: the current state becomes the new baseline,
    // so the next save records deltas against what was committed rather than
    // against what was on screen when the tab opened.
    function rebase() {
      baseline = Ryker.blocks.snapshot();
      Array.prototype.forEach.call(document.querySelectorAll('.ryker-dirty'), function (n) {
        n.classList.remove('ryker-dirty');
      });
      emit();
    }

    function revertAll() {
      if (!baseline) return;
      Object.keys(baseline).forEach(function (id) {
        var node = Ryker.blocks.byId(id);
        var was = Ryker.blocks.htmlOf(baseline[id]);
        if (node && node.innerHTML !== was) node.innerHTML = was;
      });
      Array.prototype.forEach.call(document.querySelectorAll('.ryker-dirty'), function (n) {
        n.classList.remove('ryker-dirty');
      });
      emit();
    }

    function revertBlock(id, html) {
      var node = Ryker.blocks.byId(id);
      if (!node || html == null) return false;
      node.innerHTML = Ryker.sanitize.html(html);
      if (baseline && Ryker.blocks.htmlOf(baseline[id]) !== node.innerHTML) node.classList.add('ryker-dirty');
      emit();
      return true;
    }

    function setBaseline(snap) { baseline = snap; }

    return {
      enable: enable, disable: disable, isOn: isOn, changes: changes, isDirty: isDirty,
      baselineOf: baselineOf,
      rebase: rebase, revertAll: revertAll, revertBlock: revertBlock,
      setBaseline: setBaseline, onChange: onChange, rebind: rebind, touch: emit,
      format: format, makeLink: makeLink, splitAt: splitAt,
      convert: convert, blockTypeOf: blockTypeOf, BLOCK_TYPES: BLOCK_TYPES
    };
  })();


  /* ---- editor/history.js ----------------------------------------- */
  // Undo and redo for the things the browser cannot undo itself.
  //
  // Ryker performs structural edits directly on the DOM: splitting a block,
  // merging two, converting a paragraph into a heading. The browser's own undo
  // stack only knows about edits it made, so once Ryker moves nodes around,
  // Ctrl+Z does nothing and whatever was collapsed is simply gone. That is how a
  // heading got absorbed into the paragraph above it with no way back.
  //
  // Entries hold inverse operations rather than document snapshots. A report can
  // carry megabytes of inlined images inside the editable region, so snapshotting
  // its HTML per keystroke would cost hundreds of megabytes; an inverse closure
  // costs a few element references.
  Ryker.history = (function () {
    'use strict';

    var MAX = 80;
    var past = [];
    var future = [];
    var listeners = [];
    var applying = false;

    var pending = null;   // block being typed into
    var timer = null;
    var DEBOUNCE = 600;

    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

    function record(entry) {
      if (applying) return;
      flushText();
      push(entry);
    }

    function push(entry) {
      past.push(entry);
      if (past.length > MAX) past.shift();
      future.length = 0;
      emit();
    }

    // Typing is collected into one entry per block per pause, so undo steps back
    // by a phrase rather than by a character. Finer granularity is not worth
    // eighty entries for one sentence.
    function text(node) {
      if (applying) return;
      if (pending && pending.node !== node) flushText();
      if (!pending) pending = { node: node, before: node.innerHTML };
      clearTimeout(timer);
      timer = setTimeout(flushText, DEBOUNCE);
    }

    function flushText() {
      clearTimeout(timer);
      if (!pending) return;
      var node = pending.node, before = pending.before;
      var after = node.innerHTML;
      pending = null;
      if (before === after) return;
      push({
        label: 'edit',
        undo: function () { node.innerHTML = before; place(node); },
        redo: function () { node.innerHTML = after; place(node); }
      });
    }

    function place(node) {
      try {
        var r = document.createRange();
        r.selectNodeContents(node);
        r.collapse(false);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        node.focus();
      } catch (e) {}
    }

    function run(entry, dir) {
      applying = true;
      try { (dir === 'undo' ? entry.undo : entry.redo)(); }
      catch (e) { if (Ryker.log) Ryker.log('history ' + dir + ': ' + e.message); }
      applying = false;
      emit();
    }

    function undo() {
      flushText();
      var entry = past.pop();
      if (!entry) return false;
      run(entry, 'undo');
      future.push(entry);
      return true;
    }

    function redo() {
      var entry = future.pop();
      if (!entry) return false;
      run(entry, 'redo');
      past.push(entry);
      return true;
    }

    function clear() { past.length = 0; future.length = 0; pending = null; emit(); }
    function canUndo() { return past.length > 0 || !!pending; }
    function canRedo() { return future.length > 0; }
    function depth() { return past.length; }
    function isApplying() { return applying; }

    // Ctrl+Z and Ctrl+Shift+Z, plus Ctrl+Y. Taken over completely rather than
    // shared with the browser: a stack that sometimes handles an action and
    // sometimes defers is worse than one that always does, because nobody can
    // predict what a second press will do.
    function bind() {
      document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        var k = (e.key || '').toLowerCase();
        if (k !== 'z' && k !== 'y') return;
        if (!Ryker.editable.isOn()) return;
        // The instruction pane is an ordinary textarea and keeps its own undo.
        var path = e.composedPath ? e.composedPath() : [];
        for (var i = 0; i < path.length; i++) {
          var n = path[i];
          if (n && n.tagName === 'TEXTAREA') return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (k === 'y' || e.shiftKey) redo(); else undo();
      }, true);
    }

    return {
      record: record, text: text, flush: flushText, undo: undo, redo: redo,
      clear: clear, canUndo: canUndo, canRedo: canRedo, depth: depth,
      isApplying: isApplying, bind: bind, onChange: onChange
    };
  })();


  /* ---- editor/formatbar.js --------------------------------------- */
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
        { label: 'Heading 2', run: function () { retype('H2'); } },
        { label: 'Heading 3', run: function () { retype('H3'); } },
        { label: 'Heading 4', run: function () { retype('H4'); } },
        { label: 'Heading 5', run: function () { retype('H5'); } }
      ]);

      // Destructive, so it is last, separated, and says how much it will take.
      killBtn = act(null, 'Delete', function () {
        if (!Ryker.multi) return;
        if (Ryker.multi.covered().length > 1) Ryker.multi.removeSelection();
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

    var LABEL = { P: 'Paragraph', H2: 'H2', H3: 'H3', H4: 'H4', H5: 'H5' };

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
      var link = (!range && many.length < 2 && Ryker.links) ? Ryker.links.at(null) : null;
      if (!range && many.length < 2 && !link) { hide(); return; }
      build();

      if (range) lastRange = range.cloneRange();
      // getRangeAt(0) throws when rangeCount is 0, which is exactly the state a
      // pick leaves behind, so the picked set supplies its own box instead.
      var rect = range ? range.getBoundingClientRect()
               : (link ? link.getBoundingClientRect() : Ryker.pick.rect());
      if (!rect || (!rect.width && !rect.height)) { hide(); return; }

      var block = range ? currentBlock() : null;
      var table = Ryker.multi && block ? Ryker.multi.tableAt(block) : null;
      var wide = many.length > 1;

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
          wide ? 'Delete the ' + many.length + ' selected blocks' : 'Delete this whole table');
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


  /* ---- editor/links.js ------------------------------------------- */
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
      if (node.closest('#ryker-root')) return null;
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


  /* ---- editor/pick.js -------------------------------------------- */
  // Selecting across blocks, which the browser will not do.
  //
  // Every prose block is its own editing host, and that is what keeps an edit from
  // running away into the markup around it. The price is that Blink refuses to
  // extend a selection past an editing-host boundary: drag from paragraph one into
  // paragraph four and the anchor and the focus both stay in paragraph one. The
  // earlier attempt read the native selection and therefore saw nothing on every
  // real gesture, while a select-all with focus on the body handed it the entire
  // document and deleted the report.
  //
  // So Ryker owns the gesture instead. The set below is the only thing that counts
  // as picked, a selection Ryker did not make can never fill it, and the browser
  // keeps its own selection whenever the drag stays inside one block.
  Ryker.pick = (function () {
    'use strict';

    var picked = [];
    var origin = null;
    var pressed = false, engaged = false;
    var lastX = 0, lastY = 0;
    var seq = null, raf = 0;
    var listeners = [];

    // The scroll band at the window edge, and the most it moves in one frame.
    var EDGE = 90, CAP = 18;

    function inShell(n) { return !!(n && n.closest && n.closest('#ryker-root')); }
    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

    // elementFromPoint rather than the event target: the target is the node the
    // press began on and stops following the pointer once a drag is under way.
    // Shadow content retargets to its host, so a hit on the Ryker root means one
    // of our own surfaces is in the way and there is no block under the pointer.
    function blockAt(x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el || inShell(el)) return null;
      var b = el.closest ? el.closest(Ryker.blocks.SELECTOR) : null;
      if (!b || inShell(b)) return null;
      if (Ryker.blocks.excluded(b)) return null;
      if (b.querySelector(Ryker.blocks.SELECTOR)) return null;
      if (!Ryker.blocks.root().contains(b)) return null;
      return b;
    }

    // Dragging down the page margin resolves no element at all, and without this
    // the whole gesture picks nothing. The 200px clamp is load bearing: unbounded,
    // a pointer in the margin grabs a block from the far end of the document.
    function blockNear(x, y) {
      var hit = blockAt(x, y);
      if (hit) return hit;
      var rr = Ryker.blocks.root().getBoundingClientRect();
      if (x < rr.left - 40 || x > rr.right + 40) return null;
      var list = seq || Ryker.blocks.sequence();
      var best = null, bestD = 200, i, r, d;
      for (i = 0; i < list.length; i++) {
        r = list[i].getBoundingClientRect();
        if (!r.width && !r.height) continue;
        d = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
        if (d < bestD) { bestD = d; best = list[i]; }
      }
      return best;
    }

    // Drawn from the same sequence multi.collapse() filters, so the two agree
    // about what a block is by construction rather than by coincidence.
    function span(a, b) {
      var list = seq || (seq = Ryker.blocks.sequence());
      var i = list.indexOf(a), j = list.indexOf(b);
      if (i === -1 || j === -1) return [];
      return i <= j ? list.slice(i, j + 1) : list.slice(j, i + 1);
    }

    // A class diff, never a full repaint: the report can hold hundreds of blocks
    // and a drag repaints on every pointer move.
    function paint(next) {
      var was = picked;
      was.forEach(function (n) {
        if (next.indexOf(n) === -1) n.classList.remove('ryker-pick');
      });
      next.forEach(function (n) {
        if (was.indexOf(n) === -1) n.classList.add('ryker-pick');
      });
      picked = next;
      emit();
    }

    function clear() {
      if (!picked.length && !engaged) return;
      picked.forEach(function (n) { n.classList.remove('ryker-pick'); });
      picked = [];
      engaged = false;
      document.body.classList.remove('ryker-picking');
      emit();
    }

    function set(list) {
      paint((list || []).filter(function (n) { return n && !Ryker.blocks.excluded(n); }));
    }

    function extend(node) {
      if (!node) return;
      var from = origin || picked[0] || node;
      origin = from;
      paint(span(from, node));
    }

    function dropNative() {
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) sel.removeAllRanges();
    }

    // Engaging only when the pointer leaves the block it started in is what keeps
    // ordinary text selection intact. Up to that moment the browser is doing
    // something useful and nothing is taken away from it; past it the browser has
    // already given up.
    function track(x, y) {
      if (!pressed || !origin) return;
      var hit = blockNear(x, y);
      if (!hit) return;
      if (!engaged) {
        if (hit === origin) return;
        engaged = true;
        document.body.classList.add('ryker-picking');
      }
      dropNative();
      paint(span(origin, hit));
    }

    function step() {
      raf = 0;
      if (!pressed) return;
      var h = window.innerHeight;
      var dy = 0;
      if (lastY < EDGE) dy = -Math.ceil(CAP * (EDGE - lastY) / EDGE);
      else if (lastY > h - EDGE) dy = Math.ceil(CAP * (lastY - (h - EDGE)) / EDGE);
      if (dy) {
        // Instant, because both reports set scroll-behavior:smooth, and a smooth
        // scrollBy inside a frame loop animates every call and then reads back a
        // position that has not arrived yet.
        window.scrollBy({ top: dy, left: 0, behavior: 'instant' });
        track(lastX, lastY);
      }
      raf = window.requestAnimationFrame(step);
    }

    function down(e) {
      if (e.button !== 0) return;
      if (inShell(e.target)) return;
      if (!Ryker.editable.isOn()) return;

      if (e.shiftKey && picked.length) {
        var hit = blockNear(e.clientX, e.clientY);
        if (hit) { e.preventDefault(); dropNative(); extend(hit); }
        return;
      }

      clear();
      seq = Ryker.blocks.sequence();
      origin = blockNear(e.clientX, e.clientY);
      pressed = true;
      lastX = e.clientX;
      lastY = e.clientY;
      if (!raf) raf = window.requestAnimationFrame(step);
    }

    function move(e) {
      if (!pressed) return;
      lastX = e.clientX;
      lastY = e.clientY;
      track(lastX, lastY);
    }

    function up() {
      pressed = false;
      seq = null;
      if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    }

    // The union box of the picked blocks, for anything that needs to point at the
    // selection now that there is no Range to ask.
    function rect() {
      if (!picked.length) return null;
      var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      picked.forEach(function (n) {
        var k = n.getBoundingClientRect();
        if (!k.width && !k.height) return;
        l = Math.min(l, k.left); t = Math.min(t, k.top);
        r = Math.max(r, k.right); b = Math.max(b, k.bottom);
      });
      if (l === Infinity) return null;
      return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
    }

    function init() {
      document.addEventListener('mousedown', down, true);
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
      window.addEventListener('pointercancel', up, true);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && picked.length) clear();
      }, true);
      // Mandatory, not defensive. Chrome starts a native drag when a press lands
      // on already-selected text or on an image, and a native drag delivers no
      // mousemove at all, so without this the gesture is invisible to us and
      // picks nothing.
      document.addEventListener('dragstart', function (e) {
        if (pressed && !inShell(e.target)) e.preventDefault();
      }, true);
    }

    return {
      init: init, picked: function () { return picked.slice(); },
      rect: rect, set: set, extend: extend, clear: clear,
      isEngaged: function () { return engaged; },
      has: function (n) { return picked.indexOf(n) !== -1; },
      onChange: onChange
    };
  })();


  /* ---- editor/multi.js ------------------------------------------- */
  // Deleting more than one block at a time, and deleting whole tables.
  //
  // Each block is its own editing host, which is what keeps an edit from running
  // away into the markup around it. The cost is that a selection dragged across
  // several paragraphs is refused outright: Blink clamps it to the host the press
  // began in, so there is nothing to read. Ryker.pick tracks the gesture itself
  // and this module acts on what it collected.
  //
  // Two rules keep it predictable. Only blocks the selection covers ENTIRELY are
  // removed, so dragging from the middle of one paragraph to the middle of
  // another takes what is between them and leaves the two ends intact rather than
  // splicing their halves together. And a table is removed as a table: emptying
  // its cells one by one leaves a grid of blank rows behind, which is never what
  // anybody meant.
  Ryker.multi = (function () {
    'use strict';

    function inShell(node) {
      return !!(node && node.closest && node.closest('#ryker-root'));
    }

    // What is selected across blocks. Ryker.pick owns it now.
    //
    // This used to read the native selection, and was wrong in both directions.
    //
    // Reading the native selection here was wrong in both directions at once.
    // It never fired when it should: Blink refuses to extend a selection across
    // an editing-host boundary, and per-block contenteditable makes every
    // paragraph its own host, so a real drag clamps to the paragraph it started
    // in and this returned nothing. Measured on the live report: drag paragraph 1
    // to paragraph 4, anchor and focus both land in paragraph 1, covered() is 0.
    // The module's tests passed only because a Range built in script leaves
    // boundary points that a user gesture never produces.
    //
    // And it fired catastrophically when it should not. Click the page margin so
    // focus sits on BODY, press Ctrl+A, press Backspace: the selection spans the
    // whole document, every block is enclosed, and the report is deleted. 455
    // blocks to 0 on the shipped report, recoverable only by undo, and gone for
    // good if the next act is a save.
    //
    // The replacement is a Ryker-owned pick layer that tracks the drag itself, so
    // a selection Ryker did not make can never produce a target set. Until that
    // lands this returns nothing, which is exactly what it returned for every
    // real gesture anyway. Nothing is lost by the withdrawal except the hazard.
    function covered() {
      return Ryker.pick ? Ryker.pick.picked() : [];
    }

    // A table whose blocks are all going becomes one removal of the table itself.
    //
    // Deliberately limited to tables, and to tables holding more than one block.
    // The instruction set applies the same test when it decides whether to say
    // "remove the table" or to list the cells, and the two must agree: a figure
    // removed here but reported as a caption deletion would take an image out of
    // the document that no instruction ever mentioned.
    function promotable(node) {
      var box = Ryker.blocks.boxOf(node);
      if (!box || box.tagName !== 'TABLE') return null;
      return box;
    }

    function collapse(nodes) {
      var set = nodes.slice();
      var boxes = [];
      var out = [];
      var swallowed = [];

      set.forEach(function (n) {
        var box = promotable(n);
        if (!box || boxes.indexOf(box) !== -1) return;
        var inside = Ryker.blocks.sequence().filter(function (m) {
          return Ryker.blocks.boxOf(m) === box;
        });
        if (inside.length < 2) return;
        var whole = inside.every(function (m) { return set.indexOf(m) !== -1; });
        if (!whole) return;
        boxes.push(box);
        swallowed = swallowed.concat(inside);
      });

      set.forEach(function (n) {
        if (swallowed.indexOf(n) === -1 && out.indexOf(n) === -1) out.push(n);
      });
      return boxes.concat(out);
    }

    function removeNodes(targets) {
      if (!targets.length) return false;
      var undoData = targets.map(function (n) {
        return { node: n, host: n.parentNode, at: n.nextSibling };
      }).filter(function (d) { return d.host; });
      if (!undoData.length) return false;

      function pull() {
        undoData.forEach(function (d) {
          if (d.node.parentNode) d.node.parentNode.removeChild(d.node);
        });
      }
      function put() {
        // Reverse order, so a node's recorded next sibling is already back in the
        // document by the time it is used as the insertion point.
        undoData.slice().reverse().forEach(function (d) {
          var at = d.at && d.at.parentNode === d.host ? d.at : null;
          d.host.insertBefore(d.node, at);
          rebindTree(d.node);
        });
      }

      pull();
      Ryker.history.record({ label: 'delete', undo: put, redo: pull });

      if (Ryker.pick) Ryker.pick.clear();
      Ryker.editable.touch();
      return true;
    }

    function rebindTree(node) {
      if (!Ryker.editable.isOn()) return;
      var list = node.matches && node.matches(Ryker.blocks.SELECTOR)
        ? [node]
        : Array.prototype.slice.call(node.querySelectorAll(Ryker.blocks.SELECTOR));
      list.forEach(function (n) {
        if (!Ryker.blocks.excluded(n) && !n.querySelector(Ryker.blocks.SELECTOR)) {
          Ryker.editable.rebind(n);
        }
      });
    }

    // The selection route: what someone gets from dragging across blocks.
    function removeSelection() {
      var nodes = covered();
      if (nodes.length < 2) return false;
      return removeNodes(collapse(nodes));
    }

    // The caret route: standing anywhere in a table and asking for it to go.
    function removeTableAt(node) {
      var box = node ? promotable(node) : null;
      if (!box) return false;
      return removeNodes([box]);
    }

    function tableAt(node) {
      return node ? promotable(node) : null;
    }

    // Safe now, because the set it reads can only have been filled by a gesture
    // Ryker tracked itself. A select-all cannot reach it.
    function init() {
      document.addEventListener('keydown', function (e) {
        if (!Ryker.editable.isOn()) return;
        if (e.key !== 'Backspace' && e.key !== 'Delete') return;
        var path = e.composedPath ? e.composedPath() : [];
        for (var i = 0; i < path.length; i++) {
          if (path[i] && path[i].id === 'ryker-root') return;
          if (path[i] && path[i].tagName === 'TEXTAREA') return;
        }
        if (Ryker.pick.picked().length < 2) return;
        e.preventDefault();
        e.stopPropagation();
        removeSelection();
      }, true);
    }

    return {
      init: init, covered: covered, removeSelection: removeSelection,
      removeNodes: removeNodes,
      removeTableAt: removeTableAt, tableAt: tableAt, collapse: collapse
    };
  })();


  /* ---- editor/outline.js ----------------------------------------- */
  // The document as a tree of rows. No DOM of its own, no UI.
  //
  // A row is a direct child of a <section>, or a direct child of <main> that is
  // not chrome. Deliberately not a tag list: three of this report's tables and ten
  // of the other's sit inside a div.scroll-x that gives them their horizontal
  // scrolling, so a row keyed on tag name would offer to move a table out of its
  // own scroller. kindOf() reads what a row CONTAINS, so the wrapper still reads
  // as a table and carries the table glyph.
  //
  // Rows nest by heading rank rather than by DOM nesting, because an h3 does not
  // wrap the paragraphs that follow it. Every heading in both reports is a direct
  // child of its section, which is what makes the single-pass stack below correct;
  // tree() checks that and falls back rather than producing a wrong shape.
  Ryker.outline = (function () {
    'use strict';

    var CHROME = { HEADER: 1, FOOTER: 1, NAV: 1, SCRIPT: 1, STYLE: 1, TEMPLATE: 1 };
    var HEADING = /^H([1-6])$/;

    function root() { return Ryker.blocks.root(); }

    function rankOf(el) {
      var m = el.tagName.match(HEADING);
      return m ? parseInt(m[1], 10) : 0;
    }

    // Every element the outline is willing to show, in document order.
    function rows() {
      var out = [];
      var hosts = [];
      var main = root();
      Array.prototype.forEach.call(main.children, function (n) {
        if (n.tagName === 'SECTION') hosts.push(n);
      });
      if (!hosts.length) hosts = [main];

      Array.prototype.forEach.call(main.children, function (n) {
        if (n.tagName === 'SECTION' || CHROME[n.tagName]) return;
        if (Ryker.blocks.excluded(n)) return;
        out.push(n);
      });
      hosts.forEach(function (sec) {
        Array.prototype.forEach.call(sec.children, function (n) {
          if (CHROME[n.tagName]) return;
          if (Ryker.blocks.excluded(n)) return;
          out.push(n);
        });
      });

      // Document order, since sections were walked after any loose children.
      out.sort(function (a, b) {
        var p = a.compareDocumentPosition(b);
        if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      return out;
    }

    // Rows nested by heading rank. Content rows hang off the heading above them.
    function tree() {
      var flat = rows();
      var top = [];
      var stack = [];
      flat.forEach(function (el) {
        var rank = rankOf(el);
        var node = { el: el, rank: rank, kind: kindOf(el), label: label(el),
                     key: keyOf(el), children: [] };
        if (rank) {
          while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
          (stack.length ? stack[stack.length - 1].children : top).push(node);
          stack.push(node);
        } else {
          (stack.length ? stack[stack.length - 1].children : top).push(node);
        }
      });
      return top;
    }

    function kindOf(el) {
      if (rankOf(el)) return 'heading';
      if (el.tagName === 'SECTION') return 'section';
      if (el.querySelector && el.querySelector('table')) return 'table';
      if (el.tagName === 'TABLE') return 'table';
      if (el.tagName === 'FIGURE' || (el.querySelector && el.querySelector('figure'))) return 'figure';
      if (el.tagName === 'BLOCKQUOTE') return 'quote';
      if (el.tagName === 'UL' || el.tagName === 'OL') return 'list';
      if (el.tagName === 'DL') return 'list';
      return 'text';
    }

    function clip(s, n) {
      s = String(s || '').replace(/\s+/g, ' ').trim();
      n = n || 64;
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    // Not blocks.label(): that prefixes the section heading, which the tree
    // already shows structurally, so every row would repeat its own ancestor.
    function label(el) {
      var kind = kindOf(el);
      if (kind === 'table') {
        var t = el.tagName === 'TABLE' ? el : el.querySelector('table');
        var head = t ? t.querySelector('thead tr, tr') : null;
        var cells = head ? Array.prototype.map.call(head.children, function (c) {
          return Ryker.dom.textOf(c);
        }).filter(Boolean) : [];
        return clip('Table: ' + (cells.join(', ') || Ryker.dom.textOf(el)));
      }
      if (kind === 'figure') {
        var fig = el.tagName === 'FIGURE' ? el : el.querySelector('figure');
        var cap = fig ? fig.querySelector('figcaption') : null;
        return clip('Figure: ' + (cap ? Ryker.dom.textOf(cap) : (fig && fig.querySelector('img')
          ? fig.querySelector('img').getAttribute('alt') || '' : '')));
      }
      if (kind === 'quote') return clip('Quote: ' + Ryker.dom.textOf(el));
      if (kind === 'list') {
        return clip('List of ' + el.children.length + ': ' + Ryker.dom.textOf(el));
      }
      return clip(Ryker.dom.textOf(el)) || '(empty)';
    }

    // Stable across a reload, because it is derived from the element's own id or
    // from its content the same way block ids are.
    function keyOf(el) {
      if (el.id) return '#' + el.id;
      var lead = el.querySelector && el.querySelector(Ryker.blocks.SELECTOR);
      var probe = lead && !Ryker.blocks.excluded(lead) ? lead : el;
      try { return Ryker.blocks.blockId(probe); } catch (e) { return el.tagName + ':' + label(el); }
    }

    // What a row takes with it: the element itself, plus everything a heading
    // owns down to the next heading of equal or higher rank. An h2 that opens a
    // section owns the whole section.
    function unitOf(el) {
      var rank = rankOf(el);
      if (!rank) return [el];
      var host = el.parentElement;
      if (host && host.tagName === 'SECTION' && host.firstElementChild === el) return [host];

      var run = [el];
      var n = el.nextElementSibling;
      while (n) {
        var r = rankOf(n);
        if (r && r <= rank) break;
        if (!CHROME[n.tagName]) run.push(n);
        n = n.nextElementSibling;
      }
      return run;
    }

    // Maps a set of leaf blocks up to the rows that contain them.
    function rowsFor(nodes) {
      var all = rows();
      var out = [];
      (nodes || []).forEach(function (n) {
        for (var i = 0; i < all.length; i++) {
          if (all[i] === n || all[i].contains(n)) {
            if (out.indexOf(all[i]) === -1) out.push(all[i]);
            return;
          }
        }
      });
      return out;
    }

    // Every editable block a row covers, so a deletion can be reported block by
    // block by the instruction set even though the row is the thing removed.
    function blocksIn(el) {
      var out = [];
      Ryker.blocks.sequence().forEach(function (b) {
        if (el === b || el.contains(b)) out.push(b);
      });
      return out;
    }

    return {
      rows: rows, tree: tree, unitOf: unitOf, kindOf: kindOf, label: label,
      keyOf: keyOf, rowsFor: rowsFor, blocksIn: blocksIn, rankOf: rankOf
    };
  })();


  /* ---- editor/move.js -------------------------------------------- */
  // Moving whole units of the document, and knowing afterwards that they moved.
  //
  // A move was the one edit Ryker could not see. Block identity is derived from a
  // block's own content, so a paragraph dragged from the end of a section to the
  // start of it keeps its id and its markup: diffSnapshots compares the two
  // snapshots key by key, finds every key present in both with identical HTML,
  // and reports nothing at all. isDirty stayed false and Save would not open.
  //
  // What a move changes is ORDER, and a snapshot already records order. Its keys
  // are the block ids in document order, and every id begins with ~, # or @, so
  // none of them is an array index, which is the one case where an object
  // reorders its own keys. A move is therefore derived exactly the way an edit
  // is: compare the order the document was authored in against the order it is
  // in now. Nothing is accumulated, so moving a paragraph out and back again
  // registers as what it is, which is nothing.
  //
  // Reporting it needs one more step. Two orders differ in many ways at once and
  // most accounts of the difference are useless: saying that four hundred blocks
  // each shifted up by one is true and unfollowable. The smallest honest account
  // is the set that has to move for everything else to be left alone, which is
  // whatever falls outside the longest run of blocks that kept its relative
  // order. That is what longestRun() finds and what between() reports.
  Ryker.move = (function () {
    'use strict';

    // ---- what moved, derived from two snapshots -----------------------------

    // The longest subsequence that is already in ascending order. Everything
    // outside it is what has to be moved. O(n squared) on purpose: n is the
    // number of contiguous runs, not the number of blocks, and a session with
    // three moves in it produces about four runs.
    function longestRun(vals) {
      var n = vals.length, best = [], from = [], top = -1, i, j;
      for (i = 0; i < n; i++) {
        best[i] = 1; from[i] = -1;
        for (j = 0; j < i; j++) {
          if (vals[j] < vals[i] && best[j] + 1 > best[i]) { best[i] = best[j] + 1; from[i] = j; }
        }
        if (top === -1 || best[i] > best[top]) top = i;
      }
      var keep = {};
      while (top !== -1) { keep[top] = 1; top = from[top]; }
      return keep;
    }

    // Blocks that are contiguous in both orders travel together. Without this a
    // moved section of twenty paragraphs reads as twenty separate moves, each of
    // which is individually true and collectively unreadable.
    function between(before, after) {
      if (!before || !after) return [];
      var afterIds = Object.keys(after);
      var present = {};
      afterIds.forEach(function (id) { present[id] = 1; });

      // Compacted, so that a block deleted from the middle of a run does not
      // split the run in two and report a move nobody made.
      var order = {}, origin = [];
      Object.keys(before).forEach(function (id) {
        if (present[id]) { order[id] = origin.length; origin.push(id); }
      });

      var runs = [], cur = null;
      afterIds.forEach(function (id, i) {
        var p = order[id];
        if (p === undefined) return;
        if (cur && p === cur.end + 1) { cur.end = p; cur.ids.push(id); return; }
        cur = { start: p, end: p, ids: [id], at: i };
        runs.push(cur);
      });
      if (runs.length < 2) return [];

      var keep = longestRun(runs.map(function (r) { return r.start; }));
      var out = [];
      runs.forEach(function (r, i) {
        if (keep[i]) return;
        out.push({
          kind: 'move',
          ids: r.ids.slice(),
          // The block it now follows, named from the final order including any
          // block this session added, so applying the moves in the order given
          // always finds its anchor already in place.
          prev: r.at > 0 ? afterIds[r.at - 1] : null,
          wasAfter: r.start > 0 ? origin[r.start - 1] : null
        });
      });
      return out;
    }

    function count() {
      var base = Ryker.editable.baselineOf();
      if (!base) return 0;
      return between(base, Ryker.blocks.snapshot()).length;
    }

    // ---- what a run of blocks actually is, in the source file ---------------

    // The smallest set of elements holding every block of the run and nothing
    // else. A run covering every cell of a table is the table; a run covering
    // every child of a section is the section. The source HTML has tables and
    // sections in it and has never heard of a block, so this is the only form of
    // the answer anyone can act on.
    function cover(nodes) {
      var top = Ryker.blocks.root();
      var seq = Ryker.blocks.sequence();
      var out = [];

      function holds(el) {
        for (var i = 0; i < seq.length; i++) {
          if (el.contains(seq[i]) && nodes.indexOf(seq[i]) === -1) return false;
        }
        return true;
      }

      nodes.forEach(function (n) {
        var el = n;
        while (el.parentElement && el.parentElement !== top && holds(el.parentElement)) {
          el = el.parentElement;
        }
        if (out.indexOf(el) === -1 && !covered(out, el)) out.push(el);
      });
      return out.filter(function (el) {
        return !out.some(function (o) { return o !== el && o.contains(el); });
      });
    }

    function covered(list, el) {
      return list.some(function (o) { return o.contains(el); });
    }

    function nodesOf(rec) {
      var out = [];
      rec.ids.forEach(function (id) {
        var n = Ryker.blocks.byId(id);
        if (n) out.push(n);
      });
      return out;
    }

    // Everything a move step needs to be written down: what moved, what it is
    // called, and which contents entries have to travel with it.
    function describe(rec) {
      var nodes = nodesOf(rec);
      if (!nodes.length) return null;
      var els = cover(nodes);
      if (!els.length) return null;
      return {
        nodes: nodes, elements: els,
        tag: els.length === 1 ? els[0].tagName : null,
        kind: Ryker.outline.kindOf(els[0]),
        label: Ryker.outline.label(els[0]),
        blocks: nodes.length,
        nav: navLabels(els)
      };
    }

    // ---- the report's own table of contents ---------------------------------

    function navLinks() {
      var out = [];
      Array.prototype.forEach.call(document.querySelectorAll('nav'), function (nav) {
        Array.prototype.forEach.call(nav.querySelectorAll('a[href^="#"]'), function (a) {
          out.push(a);
        });
      });
      return out;
    }

    function navLabels(els) {
      var out = [];
      navLinks().forEach(function (a) {
        var t = document.getElementById(a.getAttribute('href').slice(1));
        if (!t) return;
        if (els.some(function (el) { return el === t || el.contains(t); })) {
          out.push(Ryker.dom.textOf(a));
        }
      });
      return out;
    }

    // The contents list is navigation, so it is not editable and no snapshot
    // covers it. A section that moves would leave it listing the old order, which
    // reads as a bug in the report rather than as an edit in progress. The links
    // are put back in document order here, and the instruction set says the same
    // thing has to happen in the file.
    function syncNav() {
      Array.prototype.forEach.call(document.querySelectorAll('nav'), function (nav) {
        var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
        if (links.length < 2) return;
        var host = links[0].parentNode;
        if (!links.every(function (a) { return a.parentNode === host; })) return;

        var ranked = [], ok = true;
        links.forEach(function (a, i) {
          var t = document.getElementById(a.getAttribute('href').slice(1));
          if (!t) { ok = false; return; }
          ranked.push({ a: a, i: i, t: t });
        });
        if (!ok) return;

        var sorted = ranked.slice().sort(function (x, y) {
          var p = x.t.compareDocumentPosition(y.t);
          if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return x.i - y.i;
        });
        if (!sorted.some(function (r, i) { return r !== ranked[i]; })) return;

        // The whitespace between two links is a text node, and appendChild moves
        // only the link. Collected before anything is moved, because reading a
        // sibling halfway through the reorder reads the new arrangement.
        var pairs = sorted.map(function (r) {
          var ws = r.a.nextSibling;
          return { a: r.a, ws: (ws && ws.nodeType === 3 && !ws.nodeValue.trim()) ? ws : null };
        });
        pairs.forEach(function (p) {
          host.appendChild(p.a);
          if (p.ws) host.appendChild(p.ws);
        });
      });
    }

    // ---- performing a move --------------------------------------------------

    var CHROME = { HEADER: 1, FOOTER: 1, NAV: 1, SCRIPT: 1, STYLE: 1, TEMPLATE: 1 };

    function movable(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.tagName === 'SECTION') return true;
      if (CHROME[el.tagName]) return false;
      return !Ryker.blocks.excluded(el);
    }

    // Where the unit is actually allowed to land. A <section> is a top-level unit
    // and nesting one inside another would produce a structure the report's own
    // stylesheet has never seen, so a dropped section climbs to the nearest
    // top-level element rather than being refused.
    function landing(nodes, target) {
      if (!target || !nodes.length) return null;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i] === target || nodes[i].contains(target)) return null;
      }
      var t = target;
      if (nodes.some(function (n) { return n.tagName === 'SECTION'; })) {
        var top = Ryker.blocks.root();
        while (t && t.parentElement !== top) t = t.parentElement;
      }
      if (!t || !t.parentNode || !movable(t)) return null;
      for (i = 0; i < nodes.length; i++) {
        if (nodes[i] === t || nodes[i].contains(t)) return null;
      }
      return t;
    }

    function check(nodes, target, where) {
      if (!nodes || !nodes.length) return 'There is nothing to move.';
      var t = landing(nodes, target);
      if (!t) return 'That would put it inside itself.';
      var last = nodes[nodes.length - 1];
      if (where === 'after' && t === nodes[0].previousElementSibling) return 'It is already there.';
      if (where === 'before' && t === last.nextElementSibling) return 'It is already there.';
      return null;
    }

    // Returns null when the move happened, and a sentence when it did not.
    function apply(nodes, target, where) {
      var why = check(nodes, target, where);
      if (why) return why;

      var t = landing(nodes, target);
      var host = t.parentNode;
      // Captured once, before anything moves. check() has already refused the two
      // arrangements in which the anchor could be one of the nodes being moved.
      var anchor = where === 'before' ? t : t.nextSibling;
      var was = nodes.map(function (n) {
        return { node: n, host: n.parentNode, at: n.nextSibling };
      });

      function put() {
        nodes.forEach(function (n) { host.insertBefore(n, anchor); });
        syncNav();
      }
      // Reverse order, so a node's recorded next sibling is back in the document
      // before it is used as an insertion point. Same reasoning as multi.js, and
      // the same failure without it: the run comes back inside out.
      function back() {
        was.slice().reverse().forEach(function (d) {
          var at = d.at && d.at.parentNode === d.host ? d.at : null;
          d.host.insertBefore(d.node, at);
        });
        syncNav();
      }

      put();
      // No rebinding. A move never detaches an element from the document, so its
      // listeners, its contenteditable attribute and its classes all travel with
      // it untouched.
      Ryker.history.record({ label: 'move', undo: back, redo: put });
      if (Ryker.pick) Ryker.pick.clear();
      Ryker.editable.touch();
      return null;
    }

    // One step up or down, for the keyboard and for the context menu. Drag is not
    // the only way to reorder a document and should not be the only way here.
    function nudge(nodes, dir) {
      if (!nodes || !nodes.length) return 'There is nothing to move.';
      var n = dir === 'up' ? nodes[0].previousElementSibling
                           : nodes[nodes.length - 1].nextElementSibling;
      while (n && !movable(n)) {
        n = dir === 'up' ? n.previousElementSibling : n.nextElementSibling;
      }
      if (!n) return dir === 'up' ? 'It is already first.' : 'It is already last.';
      return apply(nodes, n, dir === 'up' ? 'before' : 'after');
    }

    return {
      between: between, count: count, describe: describe, cover: cover,
      apply: apply, check: check, nudge: nudge, landing: landing,
      movable: movable, syncNav: syncNav
    };
  })();


  /* ---- ui/rail.js ------------------------------------------------ */
  // The outline rail: the document's own structure, down the left edge.
  //
  // The report already carries a table of contents, and it lists eight sections.
  // This lists all of them, every heading beneath them, and every table, figure,
  // quote and paragraph between, which is the difference between navigating a
  // document and being able to operate on it.
  //
  // It shares its selection with the drag layer rather than mirroring it. Clicking
  // a row picks the blocks that row covers, and a drag in the page marks the rows
  // those blocks belong to. One selection, two ways to reach it.
  Ryker.rail = (function () {
    'use strict';

    var node = null, body = null, countEl = null;
    var open = false, built = false;
    var closed = {};
    var rebuildTimer = 0;
    var MIN_W = 260, DEFAULT_W = 320;
    var toggleListeners = [];

    function d() { return Ryker.dom; }
    function docId() { return Ryker.config.load().RYKER_DOCUMENT_ID; }
    function closedKey() { return 'ryker:rail-closed:' + docId(); }
    function widthKey() { return 'ryker:rail-width'; }

    function loadClosed() {
      try {
        var raw = localStorage.getItem(closedKey());
        closed = raw ? JSON.parse(raw) : null;
      } catch (e) { closed = null; }
      // Default: the h2 rows open, everything below shut. That gives a list the
      // length of the report's own contents rather than a wall of 150 rows.
      if (!closed) {
        closed = {};
        Ryker.outline.tree().forEach(function (n) { shutBelow(n, 2); });
      }
    }

    function shutBelow(n, level) {
      if (n.rank && n.rank > level) closed[n.key] = 1;
      n.children.forEach(function (c) { shutBelow(c, level); });
    }

    function saveClosed() {
      try { localStorage.setItem(closedKey(), JSON.stringify(closed)); } catch (e) {}
    }

    function storedWidth() {
      var v = 0;
      try { v = parseInt(localStorage.getItem(widthKey()) || '0', 10); } catch (e) {}
      return v >= MIN_W ? v : DEFAULT_W;
    }

    // ---- building -----------------------------------------------------------

    function build() {
      if (built) return node;
      built = true;
      loadClosed();

      countEl = d().el('span', { class: 'rail-count' });
      body = d().el('div', { class: 'rail-body', role: 'tree', 'aria-label': 'Document outline' });

      node = d().el('aside', { class: 'rail', role: 'complementary', 'aria-label': 'Ryker outline' }, [
        d().el('div', { class: 'rail-grip', title: 'Drag to resize', tabindex: '0',
                        role: 'separator', 'aria-label': 'Resize the outline' }),
        d().el('header', {}, [
          d().el('h2', { text: 'Outline' }),
          countEl,
          d().el('span', { class: 'spacer' }),
          Ryker.icons.button('close', 'Hide the outline', function () { toggle(false); })
        ]),
        body
      ]);
      node.style.display = 'none';
      Ryker.shell.add(node);
      initResize();
      initDrag();
      applyWidth(storedWidth());
      render();
      return node;
    }

    function glyph(kind) {
      return { heading: 'H', section: 'S', table: '▦', figure: '▣',
               quote: '“', list: '≡', text: '¶' }[kind] || '¶';
    }

    function render() {
      if (!built) return;
      body.innerHTML = '';
      var n = 0;
      Ryker.outline.tree().forEach(function (row) { n += draw(row, 0, body); });
      countEl.textContent = String(n);
      sync();
    }

    function draw(row, depth, host) {
      var hasKids = row.children.length > 0;
      var shut = !!closed[row.key];

      var twisty = d().el('span', { class: 'rail-tw' + (hasKids ? '' : ' none'),
                                    text: hasKids ? (shut ? '▸' : '▾') : '' });
      if (hasKids) {
        twisty.addEventListener('click', function (e) {
          e.stopPropagation();
          if (closed[row.key]) delete closed[row.key]; else closed[row.key] = 1;
          saveClosed();
          render();
        });
      }

      var el = d().el('div', {
        class: 'rail-row k-' + row.kind + (row.rank ? ' r' + row.rank : ''),
        role: 'treeitem', tabindex: '-1', draggable: 'true',
        // A row that can be dragged has to say so somewhere, and the alternative
        // was a line of instructions in the header taking permanent room to
        // explain a gesture most people will try anyway.
        title: 'Drag to move it. Alt with the arrow keys moves it one place. ' +
               'Right-click for more.',
        'aria-level': String(row.rank || (depth + 1)),
        style: 'padding-left:' + (6 + depth * 13) + 'px'
      }, [
        twisty,
        d().el('span', { class: 'rail-ico', text: glyph(row.kind) }),
        d().el('span', { class: 'rail-label', text: row.label })
      ]);
      el.__row = row;

      el.addEventListener('click', function () { el.focus(); activate(row); });
      el.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        menuFor(row, e.clientX, e.clientY);
      });
      el.addEventListener('dragstart', function (e) {
        dragging = row;
        el.classList.add('dragging');
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', row.label);
        } catch (err) {}
      });
      el.addEventListener('dragend', function () {
        el.classList.remove('dragging');
        clearMark();
        dragging = null;
        stopScroll();
      });
      // Alt is deliberate. The arrows alone belong to whatever the rail grows
      // into next, and a bare arrow that silently rewrites the document is the
      // wrong default for a list someone is reading.
      el.addEventListener('keydown', function (e) {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        e.stopPropagation();
        report(Ryker.move.nudge(Ryker.outline.unitOf(row.el),
          e.key === 'ArrowUp' ? 'up' : 'down'), row);
      });

      host.appendChild(el);
      var count = 1;
      if (hasKids && !shut) {
        row.children.forEach(function (c) { count += draw(c, depth + 1, host); });
      }
      return count;
    }

    // ---- acting -------------------------------------------------------------

    function blocksOf(unit) {
      var blocks = [];
      unit.forEach(function (u) {
        Ryker.outline.blocksIn(u).forEach(function (b) {
          if (blocks.indexOf(b) === -1) blocks.push(b);
        });
      });
      return blocks;
    }

    function activate(row) {
      Ryker.pick.set(blocksOf(Ryker.outline.unitOf(row.el)));
      try { row.el.scrollIntoView({ block: 'start', behavior: 'instant' }); } catch (e) {
        row.el.scrollIntoView(true);
      }
    }

    // ---- moving -------------------------------------------------------------
    //
    // The browser's own drag and drop, which is the opposite of the choice made
    // for selecting in the page. There a native drag had to be suppressed,
    // because a press on selected text starts one and then delivers no mousemove
    // at all, leaving the gesture invisible. Here the rows are plain list items
    // with nothing selectable in them, the browser's drag image is exactly the
    // row being moved, and pick.js already ignores anything inside the shell, so
    // the two never meet.

    var dragging = null, over = null, edge = 'after';
    var scrollRaf = 0, scrollDy = 0;

    function mark(el, where) {
      if (over === el.__row && edge === where) return;
      clearMark();
      over = el.__row;
      edge = where;
      el.classList.add(where === 'before' ? 'drop-before' : 'drop-after');
    }

    function clearMark() {
      Array.prototype.forEach.call(body.querySelectorAll('.drop-before, .drop-after'),
        function (n) { n.classList.remove('drop-before', 'drop-after'); });
      over = null;
    }

    // The rail scrolls independently of the page, and a section being dragged to
    // the far end of a 150 row outline has to be able to get there.
    function autoScroll(y) {
      var box = body.getBoundingClientRect(), band = 48;
      scrollDy = 0;
      if (y < box.top + band) scrollDy = -Math.ceil(16 * (box.top + band - y) / band);
      else if (y > box.bottom - band) scrollDy = Math.ceil(16 * (y - (box.bottom - band)) / band);
      if (scrollDy && !scrollRaf) scrollRaf = requestAnimationFrame(stepScroll);
    }

    function stepScroll() {
      scrollRaf = 0;
      if (!dragging || !scrollDy) return;
      body.scrollTop += scrollDy;
      scrollRaf = requestAnimationFrame(stepScroll);
    }

    function stopScroll() {
      scrollDy = 0;
      if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
    }

    // Delegated to the scrolling body rather than bound per row. A row contains
    // three spans, and dragleave fires when the pointer crosses into one of them,
    // so per-row handlers spend the whole gesture clearing their own indicator.
    function initDrag() {
      body.addEventListener('dragover', function (e) {
        if (!dragging) return;
        autoScroll(e.clientY);
        var el = e.target && e.target.closest ? e.target.closest('.rail-row') : null;
        if (!el || !el.__row || el.__row === dragging) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
        var box = el.getBoundingClientRect();
        mark(el, (e.clientY - box.top) < box.height / 2 ? 'before' : 'after');
      });
      body.addEventListener('dragleave', function (e) {
        if (dragging && e.target === body) clearMark();
      });
      body.addEventListener('drop', function (e) {
        if (!dragging || !over) return;
        e.preventDefault();
        e.stopPropagation();
        drop();
      });
    }

    function drop() {
      var src = dragging, dst = over, where = edge;
      clearMark();
      stopScroll();
      dragging = null;
      if (!src || !dst || src === dst) return;

      var unit = Ryker.outline.unitOf(dst.el);
      // A heading owns everything under it, so landing after an h2 means after
      // the section it opens rather than between the heading and its first
      // paragraph, which is the only reading that makes dropping onto a
      // collapsed row mean anything.
      var target = where === 'before' ? unit[0] : unit[unit.length - 1];
      report(Ryker.move.apply(Ryker.outline.unitOf(src.el), target, where), src);
    }

    // One place where a refusal is spoken. Every move path can fail for the same
    // few reasons and each of them is a sentence, not a code.
    function report(why, row) {
      render();
      if (why) {
        if (Ryker.pane) Ryker.pane.flash(why, 'warn');
        return false;
      }
      if (row) {
        Ryker.pick.set(blocksOf(Ryker.outline.unitOf(row.el)));
        focusRow(row.el);
      }
      return true;
    }

    function focusRow(el) {
      var found = null;
      Array.prototype.forEach.call(body.querySelectorAll('.rail-row'), function (n) {
        if (n.__row && n.__row.el === el) found = n;
      });
      if (found) {
        found.focus();
        try { found.scrollIntoView({ block: 'nearest', behavior: 'instant' }); } catch (e) {}
      }
    }

    // Right-click deletes the row and everything under it. A heading takes its
    // run, an h2 opening a section takes the section, and a table takes the
    // wrapper that gives it its scrolling. Counting the blocks first is what makes
    // the confirmation honest: "delete 24 blocks" is a different decision from
    // "delete a paragraph", and only the row knows which this is.
    function menuFor(row, x, y) {
      var unit = Ryker.outline.unitOf(row.el);
      var blocks = blocksOf(unit);

      Ryker.menu.at(x, y, [
        { label: 'Select', icon: 'copy', run: function () { activate(row); } },
        { label: 'Move up', icon: 'up',
          run: function () { report(Ryker.move.nudge(unit, 'up'), row); } },
        { label: 'Move down', icon: 'down',
          run: function () { report(Ryker.move.nudge(unit, 'down'), row); } },
        null,
        { label: blocks.length > 1
            ? 'Delete this and its ' + (blocks.length - 1) + ' block(s)'
            : 'Delete this',
          icon: 'trash', danger: true,
          run: function () { confirmDelete(row, unit, blocks); } }
      ]);
    }

    function confirmDelete(row, unit, blocks) {
      var what = Ryker.outline.kindOf(row.el);
      var many = blocks.length > 1 || unit.length > 1;

      if (!many) {
        remove(unit);
        return;
      }
      Ryker.dialog.open({
        title: 'Delete this ' + (what === 'heading' ? 'heading and everything under it' : what) + '?',
        body: '<p>' + Ryker.dom.escapeHtml(row.label) + '</p>' +
          '<div class="note"><b>' + blocks.length + ' block(s)</b> go with it' +
          (unit.length > 1 ? ', across ' + unit.length + ' element(s)' : '') +
          '. Ctrl+Z brings all of it back as one step.</div>',
        buttons: [
          { label: 'Cancel' },
          { label: 'Delete', danger: true, primary: true,
            action: function () { remove(unit); } }
        ]
      });
    }

    function remove(unit) {
      Ryker.pick.clear();
      Ryker.multi.removeNodes(unit.slice());
      render();
    }

    // ---- state --------------------------------------------------------------

    function sync() {
      if (!built) return;
      var marked = Ryker.outline.rowsFor(Ryker.pick.picked());
      Array.prototype.forEach.call(body.querySelectorAll('.rail-row'), function (el) {
        var row = el.__row;
        el.classList.toggle('on', !!(row && marked.indexOf(row.el) !== -1));
      });
    }

    function scheduleRender() {
      clearTimeout(rebuildTimer);
      // blocks.sequence() is cheap but onChange fires on every keystroke, so an
      // undebounced rebuild would run hundreds of times while someone types.
      rebuildTimer = setTimeout(function () { if (open) render(); }, 200);
    }

    function toggle(want) {
      build();
      open = want === undefined ? !open : !!want;
      node.style.display = open ? 'flex' : 'none';
      document.body.toggleAttribute('data-ryker-rail', open);
      if (open) { render(); Ryker.shell.setEdgeSpace(node, 'left'); }
      else Ryker.shell.setEdgeSpace(null, 'left');
      toggleListeners.forEach(function (f) { try { f(open); } catch (e) {} });
      return open;
    }

    function onToggle(fn) { toggleListeners.push(fn); }

    function isOpen() { return open; }

    function reflow() { if (open) Ryker.shell.setEdgeSpace(node, 'left'); }

    // ---- resizing, mirrored from ui/pane.js -------------------------------

    function applyWidth(px) {
      var max = Math.max(MIN_W, document.documentElement.clientWidth - 320);
      var w = Math.min(Math.max(px, MIN_W), max);
      node.style.width = w + 'px';
      try { localStorage.setItem(widthKey(), String(w)); } catch (e) {}
      if (open) Ryker.shell.setEdgeSpace(node, 'left');
    }

    function initResize() {
      var grip = node.querySelector('.rail-grip');
      var startX = 0, startW = 0, dragging = false;

      grip.addEventListener('mousedown', function (e) {
        dragging = true;
        startX = e.clientX;
        startW = node.getBoundingClientRect().width;
        e.preventDefault();
      });
      document.addEventListener('mousemove', function (e) {
        // Mirrored: the rail grows to the RIGHT, so the delta is not negated.
        if (dragging) applyWidth(startW + (e.clientX - startX));
      });
      document.addEventListener('mouseup', function () { dragging = false; });
      grip.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') applyWidth(node.getBoundingClientRect().width + 24);
        else if (e.key === 'ArrowLeft') applyWidth(node.getBoundingClientRect().width - 24);
        else return;
        e.preventDefault();
      });
    }

    function init() {
      Ryker.pick.onChange(sync);
      Ryker.editable.onChange(scheduleRender);
    }

    return {
      build: build, init: init, render: render, toggle: toggle, isOpen: isOpen,
      onToggle: onToggle,
      reflow: reflow, sync: sync, applyWidth: applyWidth
    };
  })();


  /* ---- instructions/instructions.js ------------------------------ */
  // Turns a session's edits into a prompt an AI can act on.
  //
  // This is what Ryker exists for. Nothing durable is recorded anywhere; what is
  // produced instead is a description of the difference between the document as
  // authored and the document as it now stands, in terms someone can apply to the
  // source file. On a report with a known source that description can be applied
  // for you, and on a page whose source Ryker cannot reach it is the only output
  // there could be, which is why it is the product rather than a fallback.
  //
  // Two rules govern the output. Everything is expressed against the ORIGINAL
  // document, so five edits to one paragraph read as one change from the text
  // that is actually in the file. And nothing refers to Ryker's own machinery:
  // the source HTML has never heard of a block id, so an instruction that cites
  // one cannot be followed.
  Ryker.instructions = (function () {
    'use strict';

    var pristine = null; // blockId -> html as the document was authored
    var saved = null;    // blockId -> html as of the last save
    var saves = 0;
    var baseline = null;
    var listeners = [];

    function captureOrigin() {
      pristine = Ryker.blocks.snapshot();
      baseline = null;
      return Object.keys(pristine).length;
    }

    // What the instructions in this session are measured against.
    //
    // Every record written from one page load quotes the same pristine document,
    // so all of them are cumulative supersets of each other and only the last is
    // worth keeping. A reload re-runs captureOrigin() against the document as it
    // then stands, and from that point the records quote a different starting
    // text, so they have to be COMPOSED with the earlier ones rather than
    // deduplicated against them.
    //
    // Nothing written before 2026-08-16 recorded which of those two cases it was
    // in. saveNumber resets on reload and is not it: the 17 records in the corpus
    // run to 5, reset to 2, reset to 1, then continue at 6.
    //
    // Derived from the content rather than minted at random on purpose. Two loads
    // of an unmodified document produce the same id and their records correctly
    // deduplicate; a load after edits produces a different one and its records
    // correctly compose. The grouping falls out of what the document was instead
    // of being asserted by whoever happened to be running.
    function baselineId() {
      if (baseline) return baseline;
      if (!pristine) return null;
      var keys = Object.keys(pristine).sort();
      var parts = keys.map(function (k) {
        return k + '\u0000' + Ryker.blocks.htmlOf(pristine[k]);
      });
      baseline = Ryker.blocks.hash(parts.join('\u0001'));
      return baseline;
    }

    function pristineHtml(id) {
      if (!pristine || !Object.prototype.hasOwnProperty.call(pristine, id)) return undefined;
      return Ryker.blocks.htmlOf(pristine[id]);
    }

    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

    function reset() { saved = null; saves = 0; emit(); }
    function originalOf(id) { return pristineHtml(id); }
    function saveCount() { return saves; }

    // Recomputed from the document, not accumulated. Accumulating each save's
    // changes meant the set could describe blocks that no longer existed.
    function record() {
      saved = Ryker.blocks.snapshot();
      saves += 1;
      emit();
    }

    // Reordering, which no block-by-block comparison can see. Derived the same
    // way edits are, against the document as authored, so a section dragged out
    // and dragged back again reports nothing.
    function moves() {
      if (!pristine || !saved) return [];
      return Ryker.move.between(pristine, saved).map(function (m) {
        var d = Ryker.move.describe(m);
        return d ? { rec: m, at: d } : null;
      }).filter(Boolean);
    }

    function edits() {
      if (!pristine || !saved) return [];
      return Ryker.blocks.diffSnapshots(pristine, saved).map(function (c) {
        return {
          id: c.id,
          kind: c.kind === 'added' ? 'insert' : (c.kind === 'removed' ? 'delete' : 'replace'),
          before: c.before, after: c.after,
          tag: c.tag || null, prev: c.prev || null,
          box: c.box || null, boxTag: c.boxTag || null
        };
      });
    }

    // A table holds no blocks of its own: every cell is one. Deleting a table of
    // ten cells therefore reads as ten instructions to remove a word each, which
    // is both unfollowable and hides what actually happened. Where every block
    // inside a table is gone, say it once.
    //
    // The test matches the one the editor applies when it decides to remove a
    // table whole rather than cell by cell, and only tables qualify. A figure
    // reported this way would take an image out of the document on the strength
    // of a deleted caption.
    function groupBoxes(list) {
      var total = {};
      if (pristine) {
        Object.keys(pristine).forEach(function (id) {
          var e = pristine[id];
          var b = e && typeof e === 'object' ? e.box : null;
          if (b && e.boxTag === 'TABLE') total[b] = (total[b] || 0) + 1;
        });
      }

      var gone = {};
      list.forEach(function (e, i) {
        if (e.kind !== 'delete' || !e.box || e.boxTag !== 'TABLE') return;
        (gone[e.box] = gone[e.box] || []).push(i);
      });

      var whole = {};
      Object.keys(gone).forEach(function (b) {
        if (gone[b].length > 1 && gone[b].length === total[b]) whole[b] = gone[b];
      });
      if (!Object.keys(whole).length) return list;

      var out = [], done = {};
      list.forEach(function (e) {
        if (!e.box || !whole[e.box]) { out.push(e); return; }
        if (done[e.box]) return;
        done[e.box] = true;
        out.push({
          kind: 'deletebox', tag: 'TABLE',
          cells: whole[e.box].map(function (j) { return list[j].before; })
        });
      });
      return out;
    }

    function text(html) {
      var t = document.createElement('div');
      t.innerHTML = html == null ? '' : html;
      return (t.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function ordinal(n) {
      var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    // Where a block is, said in terms the source file actually contains.
    //
    // Ryker's own ids are derived from content or stamped at runtime, so neither
    // appears in the HTML being edited and neither can be used to find anything.
    // A real id attribute is used when the element has one; otherwise the block is
    // located by its position inside the nearest section that does.
    function where(id) { return placeOf(Ryker.blocks.byId(id)); }

    function placeOf(node) {
      if (!node) return null;
      if (node.id) return 'the element with id="' + node.id + '"';

      var scope = node.parentElement;
      while (scope && !scope.id && scope !== document.body) scope = scope.parentElement;
      var scopeName = scope && scope.id ? 'the section with id="' + scope.id + '"' : 'the document body';
      var within = (scope && scope.id) ? scope : Ryker.blocks.root();

      var tag = node.tagName.toLowerCase();
      var same = Array.prototype.filter.call(within.querySelectorAll(tag), function (n) {
        return !Ryker.blocks.excluded(n);
      });
      var idx = same.indexOf(node);
      if (idx === -1) return 'a <' + tag + '> inside ' + scopeName;
      return 'the ' + ordinal(idx + 1) + ' <' + tag + '> inside ' + scopeName;
    }

    // Identical content inserted more than once is almost always a slip, and an
    // instruction set that repeats it reads as deliberate unless something says
    // so. Named rather than silently deduplicated, because only the author knows
    // which copy was meant.
    function suspicious(list) {
      var out = [];
      var byText = {};
      list.forEach(function (e, i) {
        if (e.kind !== 'insert') return;
        var k = text(e.after);
        if (!k) return;
        (byText[k] = byText[k] || []).push(i + 1);
      });
      Object.keys(byText).forEach(function (k) {
        var steps = byText[k];
        if (steps.length < 2) return;
        out.push('Steps ' + steps.join(', ') + ' insert identical content: "' +
          (k.length > 70 ? k.slice(0, 67) + '...' : k) + '". ' +
          'That is usually a duplicate paste. Keep one unless all of them are meant.');
      });

      // Text removed from one block and inserted as another is a paragraph split,
      // which is fine, but the same text being both removed and inserted several
      // times is not.
      list.forEach(function (e, i) {
        if (e.kind !== 'replace') return;
        var lost = text(e.before).replace(text(e.after), '').trim();
        if (lost.length < 40) return;
        var echoes = [];
        list.forEach(function (o, j) {
          if (o.kind === 'insert' && text(o.after).indexOf(lost.slice(0, 40)) !== -1) echoes.push(j + 1);
        });
        if (echoes.length > 1) {
          out.push('Step ' + (i + 1) + ' removes a sentence that steps ' + echoes.join(', ') +
            ' then add back. Check the split was intended once, not ' + echoes.length + ' times.');
        }
      });
      return out;
    }

    // Where a moved element ends up, named at the level the element itself sits
    // at.
    //
    // The obvious answer, the block that precedes it in the finished order, is
    // the wrong one and reads as nonsense: a whole <section> came out as "move it
    // after the 101st <p> inside the section with id=rationale", and a <p> after
    // a <td>. Nothing can be placed after a cell.
    //
    // The move has already happened in the document, so the element's own
    // previous sibling IS the answer, exact and at the right level by
    // construction. Move steps are emitted in finished-document order, so where
    // one move lands against another the earlier step has already put its element
    // in place.
    function anchorOf(el) {
      var n = el.previousElementSibling;
      while (n && (n.tagName === 'SCRIPT' || n.tagName === 'STYLE')) n = n.previousElementSibling;
      return n;
    }

    // How to recognise the anchor, in one line.
    //
    // For a block that is its opening words, taken from the document as authored
    // rather than as edited: moves are applied before the rewrites, so quoting
    // the new wording would point at text the file does not contain yet.
    //
    // For a container it is the outline's own label, because textContent on a
    // table returns every cell run together with no spaces between them, which
    // came out as "#What changesWhereImpactEffortWhy R1Fix the Apple Pay hire
    // path" and identified nothing.
    function anchorLine(node) {
      var id = safeId(node);
      if (id != null) {
        var was = pristineHtml(id);
        var t = clipText(was !== undefined ? text(was) : Ryker.dom.textOf(node));
        return t ? 'That element begins: "' + t + '"' : null;
      }
      var label = Ryker.outline.label(node);
      return label ? 'That element is a ' + label.charAt(0).toLowerCase() + label.slice(1) : null;
    }

    // One move, written so it can be followed without knowing anything about
    // Ryker. What moves is identified by the exact opening markup of its first
    // block, which is text the file actually contains.
    function moveStep(m, n, stepOf, out) {
      var rec = m.rec, at = m.at;
      var el = at.elements[0];
      var tag = at.tag ? '<' + at.tag.toLowerCase() + '>' : null;

      out.push('## ' + n + '. Move ' + (tag ? 'a ' + tag : at.elements.length + ' elements'));
      out.push('');
      if (at.elements.length === 1) {
        out.push('Move this one ' + (tag || 'element') + ' and everything inside it. Change nothing');
        out.push('about its contents. It is the element whose first block reads, exactly:');
      } else {
        out.push('Move these ' + at.elements.length + ' consecutive elements together, keeping their');
        out.push('order and changing nothing inside them. The first of them contains:');
      }
      out.push('<<<'); out.push(pristineHtml(rec.ids[0]) != null
        ? pristineHtml(rec.ids[0]) : ''); out.push('>>>');
      out.push('');

      var anchor = anchorOf(el);
      if (!anchor) {
        var host = placeOf(el.parentElement);
        out.push('Put it first inside ' + (host || 'the document body') + ', before');
        out.push('everything else in there.');
      } else if (stepOf[safeId(anchor)]) {
        out.push('Put it immediately after the element added in step ' +
          stepOf[safeId(anchor)] + '.');
        out.push('Apply that step before this one.');
      } else {
        out.push('Put it immediately after ' + (placeOf(anchor) || 'the preceding element') + ',');
        out.push('as a sibling of it, not inside it.');
        var line = anchorLine(anchor);
        if (line) out.push(line);
      }
      out.push('');

      if (rec.wasAfter) {
        var w = text(pristineHtml(rec.wasAfter) != null ? pristineHtml(rec.wasAfter) : '');
        if (w) out.push('In the file it currently sits just after this text: "' +
          clipText(w) + '"');
      } else {
        out.push('In the file it is currently the first thing in the document body.');
      }
      out.push('');
      out.push('Blocks carried along: ' + at.blocks);

      if (at.nav.length) {
        out.push('');
        out.push('The contents list links into what moved. Move ' +
          (at.nav.length > 1 ? 'these entries' : 'the entry') + ' to match, so the list');
        out.push('stays in document order:');
        at.nav.forEach(function (t2) { out.push('  - "' + t2 + '"'); });
      }
    }

    // Only a block has a block id, and asking for one anywhere else costs a walk
    // of the whole document to answer null.
    function safeId(node) {
      if (!node || !node.matches || !node.matches(Ryker.blocks.SELECTOR)) return null;
      if (Ryker.blocks.excluded(node)) return null;
      try { return Ryker.blocks.blockId(node); } catch (e) { return null; }
    }

    function clipText(s) {
      return s.length > 80 ? s.slice(0, 77) + '...' : s;
    }

    function build() {
      var cfg = Ryker.config.load();
      var list = groupBoxes(edits());
      var mv = moves();
      var out = [];

      out.push('# Document edit instructions');
      out.push('');
      out.push('Document: ' + (document.title || cfg.RYKER_DOCUMENT_ID));
      out.push('File: ' + cfg.RYKER_DOCUMENT_PATH);
      out.push('Edits: ' + list.length + ' change(s)' +
        (mv.length ? ' and ' + mv.length + ' move(s)' : '') +
        ' across ' + saves + ' save(s) this session');
      out.push('');

      if (!list.length && !mv.length) {
        out.push('No edits have been made yet. Edit the document and press Save to');
        out.push('build a set of instructions here.');
        return out.join('\n');
      }

      var warnings = suspicious(list);
      if (warnings.length) {
        out.push('## Check these before applying');
        out.push('');
        warnings.forEach(function (w) { out.push('- ' + w); });
        out.push('');
        out.push('Everything below describes the document as it stands. Resolve anything');
        out.push('above first, or delete the steps you do not want, rather than applying a');
        out.push('set you already doubt.');
        out.push('');
      }

      out.push('Apply every edit below to the source HTML of this document as it was');
      out.push('authored. Every FROM below is the original text, so this applies cleanly');
      out.push('to a fresh copy of the file even where a block was edited several times.');
      out.push('');
      out.push('Locate each element by the quoted FROM text, which is exact and unique.');
      out.push('The position given alongside it is a cross-check, not a selector. Replace');
      out.push('only the inner HTML, leaving the tag and its attributes alone. Add no');
      out.push('attributes of your own. Text between <<< and >>> is literal and includes');
      out.push('markup. Change nothing that is not named here.');
      out.push('');
      if (mv.length) {
        out.push('The first ' + mv.length + ' step(s) move elements rather than rewrite them.');
        out.push('Do those first and in the order given: each one names where an element');
        out.push('ends up in the finished document, so an earlier move has already put the');
        out.push('anchor a later one refers to in place. Move the element itself, with');
        out.push('everything inside it. Nothing inside a moved element changes.');
        out.push('');
      }

      // Moves run first, and the content steps are numbered from where they end.
      // A move is described by where its element sits in the FINAL document, so
      // applying them in the order given always finds the anchor already in
      // place. Doing them before the content edits also means every position a
      // later step quotes is the position that step will actually find.
      var base = mv.length;
      // Inserts chained off other inserts refer to the step that creates them,
      // since the element they follow does not exist in the file yet.
      var stepOf = {};       // blocks this set creates
      var editedAt = {};     // blocks this set rewrites
      list.forEach(function (e, i) {
        if (e.kind === 'insert') stepOf[e.id] = base + i + 1;
        else if (e.kind === 'replace') editedAt[e.id] = base + i + 1;
      });

      mv.forEach(function (m, i) {
        out.push('---');
        out.push('');
        moveStep(m, i + 1, stepOf, out);
        out.push('');
      });

      list.forEach(function (e, i) {
        var n = base + i + 1;
        out.push('---');
        out.push('');

        if (e.kind === 'replace') {
          out.push('## ' + n + '. Replace the contents of ' + (e.tag ? '<' + e.tag.toLowerCase() + '>' : 'a block'));
          out.push('');
          var w = where(e.id);
          if (w) out.push('Position: ' + w);
          out.push('');
          out.push('FROM:');
          out.push('<<<'); out.push(e.before); out.push('>>>');
          out.push('');
          out.push('TO:');
          out.push('<<<'); out.push(e.after); out.push('>>>');
          out.push('');
          out.push('Plain text of the new version, for confirmation:');
          out.push('  ' + text(e.after));

        } else if (e.kind === 'insert') {
          var tag = (e.tag || 'p').toLowerCase();
          out.push('## ' + n + '. Insert a new <' + tag + '>');
          out.push('');
          if (e.prev && stepOf[e.prev]) {
            out.push('Position: immediately after the element added in step ' + stepOf[e.prev] + '.');
          } else if (e.prev && editedAt[e.prev]) {
            // Quoting the original text here would point at wording an earlier
            // step has already replaced.
            out.push('Position: immediately after the element edited in step ' + editedAt[e.prev] + '.');
          } else if (e.prev) {
            var pw = where(e.prev);
            out.push('Position: immediately after ' + (pw || 'the preceding block') + '.');
            var ptext = text(pristineHtml(e.prev) != null ? pristineHtml(e.prev) : '');
            if (ptext) {
              out.push('That element begins: "' + (ptext.length > 80 ? ptext.slice(0, 77) + '...' : ptext) + '"');
            }
          } else {
            out.push('Position: as the first block of the document body.');
          }
          out.push('');
          out.push('CONTENT:');
          out.push('<<<'); out.push(e.after); out.push('>>>');
          out.push('');
          out.push('Plain text, for confirmation:');
          out.push('  ' + text(e.after));

        } else if (e.kind === 'deletebox') {
          out.push('## ' + n + '. Delete a whole <table>');
          out.push('');
          out.push('Remove the entire <table> element, its rows and its cells. Leave any');
          out.push('caption, heading or paragraph around it alone unless another step names');
          out.push('it. The table is the one whose cells read, in order:');
          out.push('');
          e.cells.forEach(function (c, k) {
            var t = text(c);
            out.push('  ' + (k + 1) + '. ' + (t.length > 90 ? t.slice(0, 87) + '...' : t));
          });

        } else {
          out.push('## ' + n + '. Delete a block');
          out.push('');
          out.push('Remove the element whose exact contents are:');
          out.push('<<<'); out.push(e.before); out.push('>>>');
          out.push('');
          out.push('Plain text, for confirmation:');
          out.push('  ' + text(e.before));
        }
        out.push('');
      });

      out.push('---');
      out.push('');
      out.push('End of instructions. ' + list.length + ' edit(s)' +
        (mv.length ? ' and ' + mv.length + ' move(s)' : '') + '.');
      return out.join('\n');
    }

    return {
      record: record, build: build, edits: edits, moves: moves, reset: reset,
      captureOrigin: captureOrigin, originalOf: originalOf, baselineId: baselineId,
      saveCount: saveCount, onChange: onChange, where: where, suspicious: suspicious
    };
  })();


  /* ---- instructions/merge.js ------------------------------------- */
  // Folding many saved records into one instruction set.
  //
  // This looks like deduplication and is two operations, only one of which is.
  //
  // Every record written from a single page load quotes the same pristine
  // document, because instructions.js derives its edits against a snapshot taken
  // once at boot. So those records are cumulative supersets of one another and
  // the correct fold is to KEEP THE LAST and discard the rest. That half is
  // deduplication and needs no judgement.
  //
  // A reload re-takes the snapshot against the document as it then stands, so the
  // next record's FROM text is the previous record's TO text. Those have to be
  // COMPOSED: FROM1 -> TO1 followed by FROM2 -> TO2 becomes FROM1 -> TO2, and only
  // where TO1 and FROM2 match exactly. Anything else is reported unmerged rather
  // than guessed, because a fold that silently drops an edit is worse than one
  // that declines to fold.
  //
  // Records written before 2026-08-16 carry no baselineId, so they are grouped by
  // testing whether one record's output is the next one's input. That is a guess
  // and is labelled as one.
  Ryker.merge = (function () {
    'use strict';

    // Two records belong to the same session if they agree on the document and on
    // the text their instructions quote.
    function groupKey(rec) {
      return (rec.documentId || '') + ' ' + (rec.baselineId || '');
    }

    function editsOf(rec) {
      return Array.isArray(rec && rec.edits) ? rec.edits : [];
    }

    function norm(html) {
      if (html == null) return '';
      return String(html).replace(/\s+/g, ' ').trim();
    }

    function when(rec) {
      var t = Date.parse(rec && rec.savedAt);
      return isNaN(t) ? 0 : t;
    }

    // Oldest first. savedAt rather than saveNumber, because saveNumber restarts
    // on every reload and sorting by it interleaves sessions.
    function chronological(records) {
      return records.slice().sort(function (a, b) { return when(a) - when(b); });
    }

    // ---- grouping -----------------------------------------------------------

    // One entry per baseline, each holding the single record that supersedes the
    // others in its group. Groups keep the order their newest record arrived in.
    function collapse(records) {
      var groups = [];
      var byKey = {};

      chronological(records).forEach(function (rec) {
        // A record with no baselineId is not evidence that it shares a baseline
        // with the next one that also lacks it. Every record written before
        // 2026-08-16 lacks it, so keying on the empty value put an entire corpus
        // into one group and discarded all but the last of it. Each gets its own
        // group and compose() works the relationship out from the text, which is
        // what "inferred" has always meant here.
        var key = rec.baselineId ? groupKey(rec) : ('@unkeyed:' + groups.length);
        var g = byKey[key];
        if (!g) {
          g = byKey[key] = {
            key: key,
            baselineId: rec.baselineId || null,
            documentId: rec.documentId || null,
            winner: rec,
            superseded: [],
            inferred: !rec.baselineId
          };
          groups.push(g);
          return;
        }
        // Later record wins. Chronological order already decided that, so this
        // is a straight replacement rather than a comparison of saveNumber, which
        // cannot be compared across sessions.
        g.superseded.push(g.winner);
        g.winner = rec;
      });

      return groups;
    }

    // ---- composition --------------------------------------------------------

    // Fold one group's edits onto the accumulated set.
    //
    // An edit whose FROM matches something already produced is a continuation of
    // that earlier edit, so the earlier one's TO is advanced and no new step is
    // emitted. An edit that touches text nobody has produced is new and is
    // appended. An edit whose FROM matches nothing at all is where composition
    // fails, and it is handed back rather than dropped.
    function compose(acc, group) {
      var refused = [];

      editsOf(group.winner).forEach(function (e) {
        var from = norm(e.before);
        var to = norm(e.after);

        // Already have this exact change, from a DIFFERENT record. Records from
        // one page load are cumulative supersets of each other, so the same pair
        // reappears in every save of that session. Dropping the repeat here
        // rather than relying on the baseline grouping is what lets a corpus with
        // no baselineId anywhere fold correctly instead of collapsing to its last
        // record, which is the bug the real corpus exposed.
        //
        // Different record is the whole condition. Two identical inserts inside
        // ONE record are the duplicate-paste case instructions.js deliberately
        // refuses to tidy away, because only the author knows which copy was
        // meant, and folding must not quietly decide that for them.
        var same = acc.some(function (a) {
          return a.origin !== group && a.step.kind === e.kind &&
                 norm(a.step.before) === from && norm(a.step.after) === to;
        });
        if (same) { group.duplicated = (group.duplicated || 0) + 1; return; }

        if (e.kind === 'insert' || !from) {
          acc.push({ step: e, origin: group });
          return;
        }

        // Does this continue something already in the set?
        var chained = null;
        for (var i = acc.length - 1; i >= 0; i--) {
          if (norm(acc[i].step.after) === from) { chained = acc[i]; break; }
        }
        if (chained) {
          chained.step = {
            kind: chained.step.kind === 'insert' ? 'insert' : e.kind,
            tag: e.tag || chained.step.tag,
            before: chained.step.before,
            after: e.after,
            position: e.position || chained.step.position
          };
          chained.composedFrom = (chained.composedFrom || 1) + 1;
          group.composed = (group.composed || 0) + 1;
          return;
        }

        // First time this text has been touched in the fold. That is normal for
        // the first group, and for a later group it means the edit is against
        // text the earlier groups never changed, which is still fine.
        var seenBefore = acc.some(function (a) { return norm(a.step.before) === from; });
        if (!seenBefore) {
          acc.push({ step: e, origin: group });
          return;
        }

        // Two groups edit the same original text in incompatible ways. Only the
        // author knows which was meant.
        refused.push({
          edit: e, group: group,
          why: 'Two sessions changed the same original text in different ways, and ' +
               'neither result contains the other.'
        });
      });

      return refused;
    }

    // ---- the public fold ----------------------------------------------------

    function fold(records) {
      var list = Array.isArray(records) ? records.filter(Boolean) : [];
      if (!list.length) {
        return { steps: [], groups: [], superseded: 0, refused: [], warnings: [], inferred: false };
      }

      var groups = collapse(list);
      var acc = [];
      var refused = [];

      groups.forEach(function (g) {
        refused = refused.concat(compose(acc, g));
      });

      var superseded = groups.reduce(function (n, g) { return n + g.superseded.length; }, 0);
      var inferred = groups.some(function (g) { return g.inferred; });
      var duplicated = groups.reduce(function (n, g) { return n + (g.duplicated || 0); }, 0);
      var composed = groups.reduce(function (n, g) { return n + (g.composed || 0); }, 0);

      // A record can carry the prose prompt and no structured pairs behind it.
      // Backfilled records are the case: 17 in the corpus, only 14 structured
      // edits between them. They cannot be folded and saying nothing about them
      // would present a partial result as a complete one.
      var promptOnly = list.filter(function (r) { return !editsOf(r).length; }).length;

      var warnings = [];
      if (promptOnly) {
        warnings.push(promptOnly + ' record(s) carry only a prose prompt with no structured ' +
          'before-and-after pairs, so nothing in them could be folded. They are unchanged ' +
          'and still in the log.');
      }
      if (duplicated) {
        warnings.push(duplicated + ' change(s) appeared in more than one record and were ' +
          'kept once.');
      }
      if (superseded) {
        warnings.push(superseded + ' record(s) were dropped because a later save from the ' +
          'same starting text already contained them.');
      }
      if (groups.length > 1) {
        warnings.push(groups.length + (inferred
          ? ' record group(s) were folded together, grouped by content because the '
            + 'records do not say which belong to the same session.'
          : ' separate editing sessions were folded together.'));
      }
      if (inferred) {
        warnings.push('Some records predate baseline tracking, so their grouping is inferred ' +
          'from content rather than recorded. Check the result before applying it.');
      }
      if (refused.length) {
        warnings.push(refused.length + ' change(s) could not be folded in and are listed ' +
          'separately below. Nothing was dropped silently.');
      }

      // Identical content inserted more than once stays reported rather than
      // removed, which is the rule instructions.js already applies within a single
      // record. Only the author knows which copy was meant, and that is no more
      // knowable across records than within one.
      var dupes = duplicateInserts(acc.map(function (a) { return a.step; }));

      // The conservation numbers. Every structured edit that went in is either a
      // step, a refusal, a duplicate of one already kept, or inside a record a
      // later save from the same baseline superseded. A fold where those do not
      // add up has lost somebody's work, which is the one outcome this module
      // exists to prevent, so the totals are returned rather than assumed.
      var accounted = {
        in: list.reduce(function (n, r) { return n + editsOf(r).length; }, 0),
        kept: acc.length,
        refused: refused.length,
        duplicated: duplicated,
        // Absorbed into a step already in the set, which is what composition IS:
        // the edit is not lost, it advanced an earlier one's TO text.
        composed: composed,
        supersededEdits: groups.reduce(function (n, g) {
          return n + g.superseded.reduce(function (m, r) { return m + editsOf(r).length; }, 0);
        }, 0)
      };

      return {
        steps: acc.map(function (a) { return a.step; }),
        groups: groups,
        superseded: superseded,
        duplicated: duplicated,
        promptOnly: promptOnly,
        accounted: accounted,
        refused: refused,
        warnings: warnings.concat(dupes),
        inferred: inferred
      };
    }

    function duplicateInserts(steps) {
      var byText = {}, out = [];
      steps.forEach(function (e, i) {
        if (e.kind !== 'insert') return;
        var k = norm(e.after);
        if (!k) return;
        (byText[k] = byText[k] || []).push(i + 1);
      });
      Object.keys(byText).forEach(function (k) {
        if (byText[k].length < 2) return;
        out.push('Steps ' + byText[k].join(', ') + ' insert identical content: "' +
          (k.length > 70 ? k.slice(0, 67) + '...' : k) + '". That is usually a duplicate ' +
          'paste. Keep one unless all of them are meant.');
      });
      return out;
    }

    function clip(html) {
      var t = document.createElement('div');
      t.innerHTML = html == null ? '' : html;
      var s = (t.textContent || '').replace(/\s+/g, ' ').trim();
      return s.length > 90 ? s.slice(0, 87) + '...' : s;
    }

    // The merged set as the same prose an agent already knows how to follow.
    function render(r) {
      var out = [];
      out.push('# Merged document edit instructions');
      out.push('');
      out.push('Folded from ' + r.groups.length + ' record group(s). Every FROM below is the');
      out.push('text as it stood before any of these edits, so the set applies to a clean copy.');
      out.push('');
      r.warnings.forEach(function (w) { out.push('NOTE: ' + w); });
      if (r.warnings.length) out.push('');
      out.push('---');
      out.push('');
      r.steps.forEach(function (s, i) {
        out.push('## ' + (i + 1) + '. ' + (s.kind === 'insert' ? 'Insert' :
          s.kind === 'delete' ? 'Delete' : 'Replace') + ' <' + (s.tag || '?').toLowerCase() + '>');
        if (s.position) out.push('');
        if (s.position) out.push('Position: ' + s.position);
        out.push('');
        if (s.before) { out.push('FROM:'); out.push('<<<'); out.push(s.before); out.push('>>>'); out.push(''); }
        if (s.after) { out.push('TO:'); out.push('<<<'); out.push(s.after); out.push('>>>'); out.push(''); }
      });
      if (r.refused.length) {
        out.push('---');
        out.push('');
        out.push('## Not merged');
        out.push('');
        out.push('These changes could not be folded into the set above and are listed');
        out.push('so that nothing is lost. Apply them by hand or discard them.');
        out.push('');
        r.refused.forEach(function (x, i) {
          out.push((i + 1) + '. ' + x.why);
          out.push('   was: ' + clip(x.edit && x.edit.before));
          out.push('   to:  ' + clip(x.edit && x.edit.after));
        });
      }
      return out.join('\n');
    }

    return {
      fold: fold, render: render, clip: clip,
      groupKey: groupKey, chronological: chronological
    };
  })();


  /* ---- storage/logger.js ----------------------------------------- */
  // Writing a copy of the instructions to disk on every save, as training data.
  //
  // "Silently" is achievable, with one honest caveat stated up front: a browser
  // cannot write to a folder it has never been shown. Somebody grants access to
  // the report's folder once, and from then on every save writes without a prompt,
  // a dialog or a download. Chrome remembers the folder between visits, so the
  // most a reload costs is a single click to confirm it again.
  //
  // Each save writes one JSON file holding the prose prompt AND the structured
  // edits behind it. Training on the prompt alone would lose the before and after
  // pairs, which are the part with signal in them.
  Ryker.logger = (function () {
    'use strict';

    // Decided rather than asked. The only thing the browser insists on is being
    // shown a folder once; everything below that point is Ryker's choice, so it
    // is made here instead of being put to whoever is editing.
    var LIB = 'ryker';
    var DIR_NAME = 'revisions';
    var DB = 'ryker', STORE = 'handles', KEY = 'log-dir';

    var dir = null;
    var seq = 0;
    var lastError = null;
    var listeners = [];
    // Saves made before the folder was granted. Logging is not optional, so a
    // save that happens while the grant is still outstanding is held rather than
    // dropped, and written the moment the folder arrives. Without this, "always
    // on" would quietly mean "on from the second save onward".
    var pending = [];

    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

    function supported() { return typeof window.showDirectoryPicker === 'function'; }
    function isOn() { return !!dir; }
    function folderName() { return dir ? dir.name : null; }
    function error() { return lastError; }
    function count() { return seq; }

    // ---- remembering the folder across reloads ------------------------------

    function idb(mode, fn) {
      return new Promise(function (resolve) {
        var open;
        try { open = indexedDB.open(DB, 1); } catch (e) { resolve(null); return; }
        open.onupgradeneeded = function () {
          if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
        };
        open.onerror = function () { resolve(null); };
        open.onsuccess = function () {
          var db = open.result;
          var tx, req;
          // Guarded, and onabort handled, because neither was and the failure was
          // silent and total. put() throws DataCloneError on a handle the browser
          // will not structured-clone, and can throw if the store is gone. The
          // exception escaped this handler, the transaction aborted, no onabort
          // existed to catch it, and the promise never settled. choose() awaits
          // remember() before it emits, so granting a folder simply hung: no
          // error, no toolbar change, nothing.
          //
          // Resolving null is the right degradation. The folder still works for
          // this session; it is only forgotten on reload.
          try {
            tx = db.transaction(STORE, mode);
            req = fn(tx.objectStore(STORE));
          } catch (e) {
            try { db.close(); } catch (e2) { /* already closing */ }
            resolve(null);
            return;
          }
          tx.oncomplete = function () { db.close(); resolve(req ? req.result : null); };
          tx.onerror = function () { db.close(); resolve(null); };
          tx.onabort = function () { db.close(); resolve(null); };
        };
      });
    }

    function remember(handle) { return idb('readwrite', function (s) { return s.put(handle, KEY); }); }
    function forget() { return idb('readwrite', function (s) { return s.delete(KEY); }); }
    function recall() { return idb('readonly', function (s) { return s.get(KEY); }); }

    // ---- turning it on ------------------------------------------------------

    function choose() {
      if (!supported()) {
        lastError = 'This browser cannot write to a folder. Logging needs Chrome or Edge.';
        emit();
        return Promise.resolve(false);
      }
      return window.showDirectoryPicker({ mode: 'readwrite', id: 'ryker-log',
                                          startIn: 'documents' })
        .then(function (handle) {
          dir = handle;
          lastError = null;
          return remember(handle)
            .then(flush)
            .then(function () { emit(); return true; });
        })
        .catch(function (e) {
          // An abort is someone closing the picker, which is not an error.
          if (e && e.name !== 'AbortError') lastError = e.message;
          emit();
          return false;
        });
    }

    // Called at startup. Re-uses the remembered folder when permission is still
    // granted, and stays quiet when it is not: asking on load would be a prompt
    // nobody asked for.
    function resume() {
      if (!supported()) return Promise.resolve(false);
      return recall().then(function (handle) {
        if (!handle || !handle.queryPermission) return false;
        return handle.queryPermission({ mode: 'readwrite' }).then(function (state) {
          if (state !== 'granted') return false;
          dir = handle;
          return flush().then(function () { emit(); return true; });
        });
      }).catch(function () { return false; });
    }

    // There is deliberately no stop(). Logging is part of what this build is for,
    // and a switch that turns the record off is a switch that silently loses the
    // training data the record exists to collect. forget() survives only for the
    // revoked-permission path below, which re-asks rather than gives up.

    // ---- writing ------------------------------------------------------------

    function stamp() {
      var d = new Date();
      function p(n, w) { return String(n).padStart(w || 2, '0'); }
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
        p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    // The log belongs beside the library rather than beside the reports, so a
    // folder someone keeps documents in does not fill with machine output. When
    // the granted folder is already the library folder, it is used as-is instead
    // of nesting a second ryker inside itself.
    function libraryDir() {
      if (dir.name.toLowerCase() === LIB) return Promise.resolve(dir);
      return dir.getDirectoryHandle(LIB, { create: true });
    }

    function ensureDir() {
      return libraryDir()
        .then(function (lib) { return lib.getDirectoryHandle(DIR_NAME, { create: true }); })
        .then(function (logs) {
          var id = Ryker.config.load().RYKER_DOCUMENT_ID;
          return logs.getDirectoryHandle(id, { create: true });
        });
    }

    // The path as it will actually read on disk, for saying out loud.
    function where() {
      if (!dir) return LIB + '/' + DIR_NAME;
      return dir.name.toLowerCase() === LIB
        ? dir.name + '/' + DIR_NAME
        : dir.name + '/' + LIB + '/' + DIR_NAME;
    }

    function write(handle, name, contents) {
      return handle.getFileHandle(name, { create: true })
        .then(function (fh) { return fh.createWritable(); })
        .then(function (w) { return w.write(contents).then(function () { return w.close(); }); });
    }

    // Called after every save. Failures are recorded and surfaced in the pane
    // rather than thrown: a logging problem must never cost someone their edit.
    // Separated from the write so the shape of the training data can be checked
    // without a filesystem, which is the only part of this worth testing.
    function buildPayload(promptText) {
      var cfg = Ryker.config.load();
      var edits = Ryker.instructions.edits();
      return {
        rykerVersion: Ryker.VERSION,
        build: Ryker.BUILD || 'Ryker',
        documentId: cfg.RYKER_DOCUMENT_ID,
        documentPath: cfg.RYKER_DOCUMENT_PATH,
        documentTitle: document.title,
        savedAt: new Date().toISOString(),
        // Which document text every FROM in this record is quoting.
        //
        // Records sharing a baseline are cumulative supersets of one another, so
        // merging them means keeping the last. Records with different baselines
        // quote different starting text and have to be composed instead. Without
        // this field neither case can be told from the other: saveNumber below
        // resets on reload, so the 17 records written before this was added run
        // 1 to 5, reset to 2, reset to 1, then continue at 6.
        baselineId: Ryker.instructions.baselineId(),
        saveNumber: Ryker.instructions.saveCount(),
        editCount: edits.length,
        // The prose prompt, exactly as the pane shows it.
        prompt: promptText,
        // And the pairs behind it, which is the part worth training on.
        edits: edits.map(function (e) {
          return {
            kind: e.kind, tag: e.tag,
            before: e.before, after: e.after,
            position: Ryker.instructions.where(e.id) || null
          };
        })
      };
    }

    function record(promptText) {
      seq += 1;
      var payload = buildPayload(promptText);
      if (!dir) {
        pending.push({ name: stamp() + '-save-' + payload.saveNumber + '.json', payload: payload });
        emit();
        return Promise.resolve(false);
      }
      return put(stamp() + '-save-' + payload.saveNumber + '.json', payload);
    }

    // Everything held while the grant was outstanding, oldest first. A failure
    // part way through leaves the rest queued rather than discarding them.
    function flush() {
      if (!dir || !pending.length) return Promise.resolve(0);
      var queued = pending.slice();
      pending = [];
      var done = 0;
      return queued.reduce(function (chain, item) {
        return chain.then(function () {
          return put(item.name, item.payload).then(function (ok) {
            if (ok) done += 1; else pending.push(item);
          });
        });
      }, Promise.resolve()).then(function () { return done; });
    }

    function pendingCount() { return pending.length; }

    function put(name, payload) {
      return ensureDir()
        .then(function (docDir) {
          return write(docDir, name, JSON.stringify(payload, null, 2));
        })
        .then(function () { lastError = null; emit(); return true; })
        .catch(function (e) {
          lastError = e && e.message ? e.message : String(e);
          // A revoked permission is worth forgetting, so the next attempt offers
          // the picker again rather than failing the same way forever.
          if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) dir = null;
          emit();
          return false;
        });
    }

    // ---- reading the log back ------------------------------------------------

    // The folder handle can list its own contents, so the log is browsable from
    // inside the report without going anywhere near the file system dialog again.
    function list() {
      if (!dir) return Promise.resolve([]);
      return ensureDir().then(function (docDir) {
        var out = [];
        var it = docDir.values();
        function step() {
          return it.next().then(function (res) {
            if (res.done) return null;
            var entry = res.value;
            if (entry.kind !== 'file' || !/\.json$/.test(entry.name)) return step();
            return entry.getFile().then(function (f) {
              out.push({ name: entry.name, size: f.size, modified: f.lastModified, handle: entry });
              return step();
            }).catch(step);
          });
        }
        return step().then(function () {
          return out.sort(function (a, b) { return b.name.localeCompare(a.name); });
        });
      }).catch(function () { return []; });
    }

    function read(entry) {
      return entry.handle.getFile().then(function (f) { return f.text(); });
    }

    // Delete every logged record for this document.
    //
    // Only this document's directory, and only the .json files list() reports, so
    // a folder somebody granted for a report cannot lose anything else in it to a
    // button inside that report. Rejects on the first failure rather than
    // reporting success over a partial delete, because "cleared" that left half
    // the log behind is worse than an error.
    function clear() {
      if (!dir) return Promise.resolve(0);
      return ensureDir().then(function (docDir) {
        return list().then(function (files) {
          return files.reduce(function (chain, f) {
            return chain.then(function (n) {
              return docDir.removeEntry(f.name).then(function () { return n + 1; });
            });
          }, Promise.resolve(0));
        });
      }).then(function (n) {
        seq = 0;
        emit();
        return n;
      });
    }

    // A browser cannot open the operating system's file manager, and pretending
    // otherwise would be a button that does nothing. What it can do, when the
    // report is being read from disk, is open the folder as a directory listing
    // in a new tab, which is the closest thing available and is genuinely useful.
    function folderUrl() {
      if (location.protocol !== 'file:') return null;
      var base = location.href.replace(/[^/]*$/, '');
      return base + LIB + '/' + DIR_NAME + '/' +
        encodeURIComponent(Ryker.config.load().RYKER_DOCUMENT_ID) + '/';
    }

    function describe() {
      if (!supported()) return 'Logging needs Chrome or Edge';
      if (!dir) {
        return pending.length
          ? pending.length + ' save(s) waiting for a folder'
          : 'Waiting for a folder';
      }
      return 'Logging to ' + where();
    }

    return {
      supported: supported, isOn: isOn, choose: choose, resume: resume,
      record: record, buildPayload: buildPayload, describe: describe,
      flush: flush, pendingCount: pendingCount, where: where, LIB: LIB,
      list: list, read: read, clear: clear, folderUrl: folderUrl,
      folderName: folderName, error: error,
      count: count, onChange: onChange, DIR_NAME: DIR_NAME
    };
  })();


  /* ---- instructions/browser.js ----------------------------------- */
  // Browsing the change requests already written for this document.
  //
  // The log is a folder of JSON files. Somebody who wants to look at what they
  // have sent should not have to leave the report, hunt for the folder and open
  // files by hand, so this reads them back through the same directory handle the
  // logging uses.
  Ryker.browser = (function () {
    'use strict';

    function d() { return Ryker.dom; }

    function fmtSize(n) {
      return n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
    }

    function fmtWhen(ms) {
      try { return Ryker.dom.fmtDate(new Date(ms).toISOString()); } catch (e) { return ''; }
    }

    function open() {
      if (!Ryker.logger.isOn()) {
        offerToTurnOn();
        return;
      }
      var body = d().el('div', {}, [d().el('div', { class: 'pane-status', text: 'Reading the folder...' })]);
      var dlg = Ryker.dialog.open({ title: 'Change requests', body: body });

      Ryker.logger.list().then(function (files) {
        body.innerHTML = '';

        var url = Ryker.logger.folderUrl();
        body.appendChild(d().el('div', { class: 'note' }, [
          d().el('div', {
            text: files.length
              ? files.length + ' change request(s) logged for this document in ' +
                Ryker.logger.folderName() + '/' + Ryker.logger.DIR_NAME + '.'
              : 'No change requests logged yet. The next save writes the first one.'
          })
        ]));

        if (url) {
          body.appendChild(d().el('div', { class: 'acts', style: 'margin-bottom:12px' }, [
            d().el('button', {
              class: 'rk', text: 'Open the folder in a new tab',
              onclick: function () { window.open(url, '_blank', 'noopener'); }
            })
          ]));
        }

        if (!files.length) return;

        // Fold every logged record into one instruction set and hand it over.
        //
        // The owner asked for a download of all session changes, deduplicated.
        // Ryker.merge does the folding and reports what it could not fold; this
        // only ever writes the result out. Nothing is deleted by exporting.
        body.appendChild(d().el('div', { class: 'acts', style: 'margin-bottom:12px' }, [
          d().el('button', {
            class: 'rk', text: 'Download all changes, merged',
            onclick: function () { exportMerged(files); }
          }),
          d().el('button', {
            class: 'rk danger', text: 'Clear the log',
            onclick: function () { confirmClear(files); }
          })
        ]));

        var list = d().el('div', { class: 'filelist' });
        files.forEach(function (f) {
          var row = d().el('div', { class: 'filerow' }, [
            d().el('span', { class: 'nm', text: f.name }),
            d().el('span', { class: 'sz', text: fmtSize(f.size) })
          ]);
          row.appendChild(d().el('button', {
            class: 'rk', text: 'View',
            onclick: function () { view(f); }
          }));
          list.appendChild(row);
        });
        body.appendChild(list);
      }).catch(function (e) {
        body.innerHTML = '<div class="note bad">Could not read the folder: ' +
          Ryker.dom.escapeHtml(e.message) + '</div>';
      });

      return dlg;
    }

    // ---- merged export ------------------------------------------------------

    function readAll(files) {
      return Promise.all(files.map(function (f) {
        return Ryker.logger.read(f)
          .then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } })
          .catch(function () { return null; });
      })).then(function (list) { return list.filter(Boolean); });
    }

    // Read first, then open one dialog. The buttons depend on the merged text, so
    // opening a dialog and filling it in later would mean building its footer
    // twice, and dialog.open() takes its buttons up front.
    function exportMerged(files) {
      readAll(files).then(function (records) {
        var r = Ryker.merge.fold(records);
        var text = Ryker.merge.render(r);

        var body = d().el('div', {});
        body.appendChild(d().el('div', { class: 'note' + (r.refused.length ? ' warn' : ' ok') }, [
          d().el('div', {
            text: r.steps.length + ' change(s) folded from ' + records.length + ' record(s).'
          })
        ]));

        // Everything the fold could not do, said plainly. A merged set that
        // quietly omitted a change would be worse than one that refused to merge,
        // because the omission is invisible in the file it produces.
        r.warnings.forEach(function (w) {
          body.appendChild(d().el('div', { class: 'note warn', text: w }));
        });
        r.refused.forEach(function (x) {
          body.appendChild(d().el('div', { class: 'note bad' }, [
            d().el('div', { text: x.why }),
            d().el('div', { class: 'muted', text: Ryker.merge.clip(x.edit && x.edit.before) })
          ]));
        });

        var area = d().el('textarea', { class: 'rk', rows: '12', readonly: 'readonly' });
        area.value = text;
        body.appendChild(area);

        Ryker.dialog.open({
          title: 'Merged changes',
          body: body,
          buttons: [
            { label: 'Close' },
            { label: 'Copy', keepOpen: true, action: function () {
                if (navigator.clipboard) navigator.clipboard.writeText(text);
                return false;
              } },
            { label: 'Download', primary: true, action: function () {
                Ryker.exportHtml.download(text,
                  Ryker.exportHtml.baseName() + '-all-changes.txt', 'text/plain;charset=utf-8');
              } }
          ]
        });
      }).catch(function (e) {
        Ryker.dialog.alert('Could not read the records',
          Ryker.dom.escapeHtml(e.message), 'bad');
      });
    }

    // ---- clearing -----------------------------------------------------------

    // Leads with the consequence and puts the way out inside the warning, which
    // is the shape pane.js already uses for resetting the document. Telling
    // somebody to go and export first, then asking them to confirm, reliably
    // produces a confirmed deletion and no export.
    function confirmClear(files) {
      Ryker.dialog.open({
        title: 'Clear the change request log?',
        body: '<div class="note bad">This deletes all ' + files.length + ' logged change ' +
          'request(s) for this document. They are the only record of what was changed across ' +
          'sessions, and nothing else holds a copy.</div>' +
          '<p>Download the merged set first if you want to keep it.</p>',
        buttons: [
          { label: 'Cancel' },
          { label: 'Download merged first', keepOpen: true, action: function () {
              exportMerged(files);
              return false;
            } },
          { label: 'Clear the log', danger: true, action: function () {
              Ryker.logger.clear().then(function () {
                Ryker.pane.flash('Change request log cleared.', 'ok');
              }).catch(function (e) {
                Ryker.dialog.alert('Could not clear the log', Ryker.dom.escapeHtml(e.message), 'bad');
              });
            } }
        ]
      });
    }

    function view(entry) {
      Ryker.logger.read(entry).then(function (text) {
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (e) {}

        var area = d().el('textarea', { class: 'rk pane-text', spellcheck: 'false' });
        area.value = parsed && parsed.prompt ? parsed.prompt : text;
        area.style.minHeight = '46vh';

        var meta = parsed
          ? (parsed.editCount + ' edit(s), saved ' + (parsed.savedAt || 'at an unknown time') +
             (parsed.backfilled ? ', backfilled from an export' : '') +
             (parsed.applied ? ', applied to the source' : ''))
          : 'Raw file contents';

        Ryker.dialog.open({
          title: entry.name,
          body: d().el('div', {}, [
            d().el('div', { class: 'pane-status', text: meta }),
            area
          ]),
          buttons: [
            { label: 'Close' },
            {
              label: 'Download JSON',
              action: function () {
                Ryker.exportHtml.download(text, entry.name, 'application/json');
              }
            },
            {
              label: 'Copy prompt', primary: true,
              action: function () {
                area.focus();
                area.select();
                try { document.execCommand('copy'); } catch (e) {}
              }
            }
          ]
        });
      });
    }

    function offerToTurnOn() {
      Ryker.dialog.open({
        title: 'Change requests are not being logged',
        body: '<p>Ryker can write a copy of the instructions to a folder every time you ' +
          'save, so the change requests build into a record rather than living only in this ' +
          'tab.</p>' +
          '<div class="note"><b>The folder has to be granted once.</b> A browser cannot read or ' +
          'write a directory it has never been shown. After that, saving is silent and browsing ' +
          'them happens here.</div>',
        buttons: [
          { label: 'Not now' },
          {
            label: 'Choose folder', primary: true,
            action: function () {
              Ryker.logger.choose().then(function (ok) {
                Ryker.boot.sync();
                if (ok) open();
              });
            }
          }
        ]
      });
    }

    return { open: open, view: view };
  })();


  /* ---- ui/pane.js ------------------------------------------------ */
  // The instruction pane. Open by default, because it is the point of the tool
  // rather than a panel you go and find.
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
    // because Ryker keeps no revisions by design. So the warning leads with the
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
      Ryker.boot.sync();
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
      Ryker.boot.sync();
    }

    function isOpen() { return !!node && node.style.display !== 'none'; }
    function value() { return area ? area.value : ''; }

    return {
      build: build, refresh: refresh, toggle: toggle, isOpen: isOpen,
      reflow: reflow, copy: copy, value: value, confirmClear: confirmClear,
      download: download, applyWidth: applyWidth, flash: flash
    };
  })();


  /* ---- storage/recover.js ---------------------------------------- */
  // Finding work left behind by the build that was decommissioned.
  //
  // Until 2026-08-16 a second build saved a revision journal into browser storage
  // under this document's id. That build is gone and nothing reads the key any
  // more, so a report last edited with it would load pristine with previously
  // saved edits looking as though they had simply vanished, and nothing saying
  // why.
  //
  // Rather than pretend that cannot happen, this looks for the key directly, says
  // what it found, and offers to bring the work across as a starting point. It
  // reads and never writes, so declining leaves the stored journal exactly as it
  // was.
  //
  // This is a migration path with an expiry rather than a feature. Once no report
  // in circulation has a journal in browser storage, the module and its entry in
  // the bundle can go.
  Ryker.recover = (function () {
    'use strict';

    function key() {
      return 'ryker:' + Ryker.config.load().RYKER_DOCUMENT_ID + ':journal';
    }

    function seenKey() {
      return 'ryker:' + Ryker.config.load().RYKER_DOCUMENT_ID + ':journal-seen';
    }

    // Keyed on what the journal IS, not just that one was seen. Declining the
    // offer settles this journal; a later one, with more records or a newer
    // timestamp, is a different question and gets asked again.
    function fingerprint(found) {
      return (found.records.length + '@' + (found.savedAt || ''));
    }

    function settled(found) {
      try { return localStorage.getItem(seenKey()) === fingerprint(found); } catch (e) { return false; }
    }

    function settle(found) {
      try { localStorage.setItem(seenKey(), fingerprint(found)); } catch (e) {}
    }

    // Called when the document is cleared. Someone who has just thrown away every
    // edit this session does not want the same edits offered back on reload.
    function dismiss() {
      var found = stored();
      if (found) settle(found);
    }

    function stored() {
      var raw;
      try { raw = localStorage.getItem(key()); } catch (e) { return null; }
      if (!raw) return null;
      try {
        var parsed = JSON.parse(raw);
        var records = (parsed && parsed.records) || [];
        return records.length ? { records: records, savedAt: parsed.savedAt } : null;
      } catch (e) { return null; }
    }

    function countBlocks(records) {
      var ids = {};
      records.forEach(function (r) {
        (r.changes || []).forEach(function (c) { ids[c.id] = true; });
      });
      return Object.keys(ids).length;
    }

    function offer() {
      var found = stored();
      if (!found) return false;

      var blocks = countBlocks(found.records);
      if (!blocks) return false;
      if (settled(found)) return false;

      var d = Ryker.dom;
      Ryker.dialog.open({
        title: 'Bring in earlier edits?',
        body: d.el('div', {}, [
          d.el('p', {
            text: blocks + ' block(s) were edited here earlier' +
              (found.savedAt ? ', on ' + d.fmtDate(found.savedAt) : '') +
              ', and are still in this browser.'
          }),
          d.el('p', { class: 'muted', text: 'Nothing is deleted either way.' })
        ]),
        buttons: [
          { label: 'Cancel', action: function () { settle(found); } },
          { label: 'Restore', primary: true, action: function () {
              settle(found);
              apply(found.records);
            } }
        ]
      });
      return true;
    }

    // Applied on top of the pristine document, then recorded as one save, so every
    // instruction still quotes the document as authored.
    function apply(records) {
      var before = Ryker.blocks.snapshot();
      var out = Ryker.blocks.applyRecords(records);
      var changes = Ryker.blocks.diffSnapshots(before, Ryker.blocks.snapshot());

      if (!changes.length) {
        Ryker.dialog.alert('Nothing to bring in',
          'Those revisions are already reflected in this document.', 'ok');
        return;
      }

      Ryker.instructions.record();
      Ryker.editable.rebase();
      Ryker.pane.refresh(true);
      if (!Ryker.pane.isOpen()) Ryker.pane.toggle();
      Ryker.boot.sync();

      Ryker.dialog.alert('Edits restored',
        changes.length + ' block(s) applied and folded into the instructions.' +
        (out.missed ? ' ' + out.missed + ' change(s) could not be placed in this document and were skipped.' : ''),
        out.missed ? 'warn' : 'ok');
    }

    return { offer: offer, apply: apply, stored: stored, key: key, dismiss: dismiss };
  })();


  /* ---- bootstrap/boot.js ----------------------------------------- */
  // The entry point: boot sequence, failure isolation and the toolbar.
  //
  // Nothing here is durable, by design rather than by omission. No journal, no
  // revision browser, no comment engine, no storage backend. A save writes
  // nowhere. It folds the edit into a set of instructions in the pane, and that
  // text is the artifact the person leaves with.
  //
  // This was two files until the 2026-08-16 decommission: bootstrap/boot.js
  // booted the full build and ui/toolbar.js drew its bar, while the instruction
  // build carried its own smaller copy of both in lite/lite.js. That build is now
  // the only build, so its copy took this name. The two-build tree is at the
  // v0.1.0-two-builds tag if the older shape is ever needed.
  Ryker.boot = (function () {
    'use strict';

    var handle = null, bar = null, expanded = false;
    var els = {};
    var started = false;
    // Whether the folder grant has been offered in this session. One prompt, on
    // the first save that needs it; see the comment in save() for why not more.
    var askedForGrant = false;

    function d() { return Ryker.dom; }

    // Spec section 42: Ryker must not be able to destroy the report merely
    // because a module fails, and the document must stay readable either way.
    //
    // This lived in bootstrap/boot.js, which was the full build's entry point and
    // went with it in the decommission. Three of the five failure domains section
    // 42 names went too (GitHub, comments, revisions, authentication), but
    // packaging remains and so does the principle, and start() below calls eleven
    // initialisers in a row where any one throwing would leave a half-mounted
    // editor over someone's document. Ryker.log survived the deletion as a
    // reference in history.js with nothing defining it, so it is restored here.
    var problems = [];

    function log(msg) {
      problems.push(msg);
      if (window.console && console.warn) console.warn('[ryker] ' + msg);
    }

    function guard(label, fn) {
      try { return fn(); }
      catch (e) { log(label + ': ' + (e && e.message)); return null; }
    }

    function build() {
      if (bar) return;

      handle = d().el('button', {
        class: 'handle', title: 'Open Ryker', 'aria-expanded': 'false',
        onclick: function () { expand(true); }
      }, [
        d().el('span', { class: 'dot' }),
        d().el('span', { text: 'Ryker' }),
        d().el('span', { class: 'badge', text: '' })
      ]);
      Ryker.shell.add(handle);

      // No Edit toggle. Ryker exists to edit, and a mode switch that is always in
      // the same position is a control nobody ever needs to touch.
      els.save = d().el('button', { class: 'rk', text: 'Save', onclick: save });
      els.pane = d().el('button', { class: 'rk count-only',
        onclick: function () { Ryker.pane.toggle(); } });

      // Export is gone: the instruction pane is what someone leaves with. What
      // remains is occasional, so it sits behind the ellipsis rather than taking
      // permanent room in the bar.
      els.more = Ryker.icons.button('more', 'More actions');
      els.more.setAttribute('aria-haspopup', 'menu');
      els.more.setAttribute('aria-expanded', 'false');
      els.more.addEventListener('click', buildMenu);
      buildMenu();

      els.note = d().el('button', { class: 'where', type: 'button',
        onclick: function () { if (!Ryker.logger.isOn()) startLogging(); } }, [
        d().el('span', { class: 'dot' }),
        d().el('span', { class: 'lbl', text: 'Nothing is saved anywhere' })
      ]);
      els.collapse = d().el('button', { class: 'rk', text: 'Hide', onclick: function () { expand(false); } });

      // Left of the name, not among the actions on the right: the outline is a
      // view of the document rather than a thing done to it. Ghost, so it reads as
      // part of the name beside it. The active state still paints, because .on is
      // declared after .ghost at equal specificity.
      els.outline = Ryker.icons.button('outline', 'Show or hide the outline', function () {
        Ryker.rail.toggle();
      }, 'ghost rail-toggle');
      Ryker.rail.onToggle(sync);

      bar = d().el('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Ryker' }, [
        els.outline,
        d().el('span', { class: 'brand', text: 'Ryker' }),
        d().el('span', { class: 'spacer' }),
        els.note, els.more, els.pane, els.collapse, els.save
      ]);

      Ryker.tooltip.attach(els.save, 'Save the edits into the instructions (Ctrl+S)');
      Ryker.tooltip.attach(els.pane, 'Show or hide the instructions');
      Ryker.tooltip.attach(els.outline, 'Show or hide the outline');
      Ryker.tooltip.attach(els.more, 'More actions');
      Ryker.tooltip.attach(els.collapse, 'Collapse the toolbar');
      bar.style.display = 'none';
      Ryker.shell.add(bar);
    }

    // Rebuilt on open so the logging entry reflects whether it is currently on.
    function buildMenu() {
      Ryker.menu.attach(els.more, [
        { label: 'Export report...', icon: 'download', run: exportMenu },
        { label: 'Package report', icon: 'package', run: function () { Ryker.packager.open(); } },
        { label: 'Download instructions', icon: 'download', run: function () { Ryker.pane.download(); } },
        { label: 'Copy instructions', icon: 'copy', run: function () { Ryker.pane.copy(); } },
        null,
        { label: 'Change requests...', icon: 'package', run: function () { Ryker.browser.open(); } },
        Ryker.logger.isOn()
          ? { label: 'Logging to ' + Ryker.logger.where(), icon: 'download', disabled: true }
          : { label: 'Choose the folder to log to...', icon: 'download', run: startLogging },
        null,
        { label: 'Clear document', icon: 'trash', danger: true,
          run: function () { Ryker.pane.confirmClear(); } }
      ]);
    }

    // Spec section 21, restored 2026-08-16.
    //
    // exportHtml.clean() and withRyker() survived the decommission intact and the
    // test suite proves clean() round-trips a document character for character,
    // but the menu that reached them lived in ui/toolbar.js and was deleted with
    // the full build. So a required capability was fully implemented, fully
    // tested, documented in README and named in AGENT.md as the way to verify an
    // install, and reachable by nobody. sow-006 retired comments, revisions and
    // GitHub; it never retired export.
    //
    // Lifted from the deleted toolbar.js with the Journal button dropped, since
    // exportHtml.journalJson() went with the revision journal.
    function exportMenu() {
      var base = Ryker.exportHtml.baseName();
      Ryker.dialog.open({
        title: 'Export',
        body: '<p><b>Clean HTML</b> is the report on its own, with Ryker taken out. This is what ' +
          'you send to someone who should read it rather than edit it.</p>' +
          '<p><b>With Ryker</b> keeps the editor attached, so whoever opens it can carry on ' +
          'editing and leave with their own instruction set.</p>',
        buttons: [
          { label: 'Cancel' },
          {
            label: 'With Ryker',
            action: function () {
              var o = Ryker.exportHtml.scanned('ryker');
              if (o.hits.length) { Ryker.dialog.leak(o.hits); return; }
              Ryker.exportHtml.download(o.html, base + '-ryker.html');
            }
          },
          {
            label: 'Clean HTML', primary: true,
            action: function () {
              var o = Ryker.exportHtml.scanned('clean');
              if (o.hits.length) { Ryker.dialog.leak(o.hits); return; }
              Ryker.exportHtml.download(o.html, base + '.html');
            }
          }
        ]
      });
    }

    function startLogging() {
      if (!Ryker.logger.supported()) {
        Ryker.dialog.alert('Not available in this browser',
          'Writing to a folder needs the File System Access API, which Chrome and Edge ' +
          'have and other browsers do not. Use Download instructions instead.', 'warn');
        return;
      }
      var held = Ryker.logger.pendingCount();
      Ryker.dialog.open({
        title: 'Choose where change requests are written',
        body: '<p>Pick the folder this report is in. Every save is then written to ' +
          '<code>' + Ryker.logger.LIB + '/' + Ryker.logger.DIR_NAME + '/</code>.</p>' +
          (held ? '<p class="muted">' + held + ' save(s) are waiting and will be written ' +
            'straight away.</p>' : '') +
          '<p class="muted">A browser cannot write to a folder it has not been shown. ' +
          'This is asked once.</p>',
        buttons: [
          { label: 'Cancel' },
          { label: 'Choose folder', primary: true, action: function () {
              Ryker.logger.choose().then(function (ok) {
                sync();
                if (ok) Ryker.pane.flash('Logging to ' + Ryker.logger.where() +
                  (held ? '. ' + held + ' held save(s) written.' : '.'), 'ok');
                else if (Ryker.logger.error()) Ryker.dialog.alert('Could not use that folder',
                  Ryker.dom.escapeHtml(Ryker.logger.error()), 'bad');
              });
            } }
        ]
      });
    }

    // Polls rather than subscribes, because a dialog can be closed by Escape, by
    // the backdrop or by any of its own buttons, and one timer is cheaper than
    // teaching every one of those paths to notify.
    function askWhenClear() {
      var tries = 0;
      (function wait() {
        if (Ryker.logger.isOn()) return;
        if (!Ryker.dialog.isOpen()) { startLogging(); return; }
        if (++tries > 240) return;
        setTimeout(wait, 500);
      })();
    }

    function expand(open) {
      // build() runs under guard(), so there may be no toolbar. sync() has always
      // returned early on this; expand() dereferenced `bar` regardless, which is
      // how a cosmetic failure used to take editing down with it.
      if (!bar || !handle) return;
      expanded = !!open;
      if (!expanded && Ryker.rail && Ryker.rail.isOpen()) Ryker.rail.toggle(false);
      bar.style.display = expanded ? 'flex' : 'none';
      handle.style.display = expanded ? 'none' : 'flex';
      handle.setAttribute('aria-expanded', String(expanded));
      if (!expanded) {
        Ryker.formatbar.hide();
        Ryker.shell.releaseOffset();
      }
      sync();
    }

    // Only one row now that formatting floats over the selection, so the offset
    // is simply the bar's own height.
    function layout() {
      if (!expanded) return;
      Ryker.shell.setOffset(bar.getBoundingClientRect().height);
      Ryker.pane.reflow();
    }

    // A save writes nothing. It takes the edits made since the last one,
    // folds them into the instruction set, and rebases so the next save records
    // only what changed after this point. The instructions themselves still quote
    // the document as authored, not as it was at the previous save.
    function save(quiet) {
      var changes = Ryker.editable.changes();
      // A move rewrites no block, so changes() is empty after one and this used
      // to refuse the save that would have recorded it. Order is the other half
      // of what a save captures.
      var moves = Ryker.move.count();
      if (!changes.length && !moves) {
        // A keyboard save that found nothing should not put a dialog in the way.
        // Someone pressing Ctrl+S out of habit gets a note, not an interruption.
        if (quiet) {
          if (!Ryker.pane.isOpen()) Ryker.pane.toggle();
          Ryker.pane.flash('Nothing to save. The instructions are already current.');
          return;
        }
        Ryker.dialog.alert('Nothing to save', 'No text has changed since the last save.');
        return;
      }
      Ryker.instructions.record();
      Ryker.editable.rebase();
      Ryker.pane.refresh(true);
      if (!Ryker.pane.isOpen()) Ryker.pane.toggle();
      sync();
      // Fire and forget. A logging failure is reported in the pane and never
      // interrupts the save that produced it.
      Ryker.logger.record(Ryker.pane.value()).then(function (ok) {
        if (!ok && !Ryker.logger.isOn() && Ryker.logger.supported()) {
          // Ask once per session, then never again.
          //
          // This used to ask never, and the reasoning is worth keeping because it
          // is still true of the case it described: a modal over the report
          // "covered the document, swallowed clicks, and arrived at the moment
          // someone had just finished working". What made that intolerable was
          // that it arrived on EVERY save.
          //
          // The owner decided on 2026-08-16 that a save needing a grant should
          // prompt for one, since a browser cannot write to a folder it has not
          // been shown and silently holding the work teaches nobody that. Asking
          // on the first save only keeps that decision and keeps what the old one
          // was protecting against, because the chip and the held count still
          // carry every save after it.
          if (!askedForGrant) {
            askedForGrant = true;
            startLogging();
            sync();
            return;
          }
          Ryker.pane.flash(Ryker.logger.pendingCount() +
            ' save(s) held in this tab. Click "held in this tab only" to write them.', 'warn');
          sync();
          return;
        }
        if (ok) Ryker.pane.flash('Saved. Copy written to ' + Ryker.logger.where() + '.', 'ok');
        else if (Ryker.logger.error()) Ryker.pane.flash('Could not write the log copy: ' +
          Ryker.logger.error(), 'warn');
        sync();
      });
    }

    function sync() {
      if (!bar) return;
      var editing = Ryker.editable.isOn();
      var dirty = Ryker.editable.isDirty();
      var edits = Ryker.instructions.edits().length + Ryker.instructions.moves().length;

      // Save keeps the same plain treatment as Hide. It sits beside it and they
      // are both ordinary actions; colouring one of them made it read as a state.
      els.save.disabled = !dirty;
      els.save.textContent = 'Save';

      els.pane.textContent = '';
      els.pane.appendChild(d().el('span', {
        class: 'count' + (edits ? ' warn' : ''), text: String(edits)
      }));
      els.pane.classList.toggle('on', Ryker.pane.isOpen());
      if (els.outline) {
        els.outline.classList.toggle('on', Ryker.rail.isOpen());
        Ryker.tooltip.attach(els.outline,
          Ryker.rail.isOpen() ? 'Hide the outline' : 'Show the outline');
      }

      var held = Ryker.logger.pendingCount();
      els.note.querySelector('.lbl').textContent = Ryker.logger.isOn()
        ? 'Writing to ' + Ryker.logger.where()
        : (held
            ? held + ' save(s) held in this tab only'
            : (edits ? edits + ' edit(s) held in this tab only' : 'Nothing is saved anywhere'));
      els.note.disabled = Ryker.logger.isOn() || !Ryker.logger.supported();
      els.note.querySelector('.dot').className = 'dot ' + (edits ? 'warn' : '');
      Ryker.tooltip.attach(els.note, Ryker.logger.isOn()
        ? 'Every save also writes a copy to ' + Ryker.logger.where() + '.'
        : 'Nothing has been written to disk yet. Click to choose the folder, ' +
          'and every save held in this tab is written straight away.');
      els.note.querySelector('.dot').classList.toggle('ok', Ryker.logger.isOn());

      Ryker.tooltip.attach(els.pane,
        edits + ' edit(s) recorded. Show or hide the instructions.');

      var badge = handle.querySelector('.badge');
      badge.textContent = edits ? String(edits) : '';
      badge.style.display = edits ? '' : 'none';
      handle.querySelector('.dot').classList.toggle('on', editing);

      layout();
    }

    function start() {
      if (started) return;
      started = true;
      var cfg = guard('config', function () { return Ryker.config.load(); });
      if (!cfg) return;
      if (cfg.RYKER_ENABLED === false) return;
      if (cfg._leaked && cfg._leaked.length) {
        Ryker.shell.mount();
        Ryker.dialog.open({
          title: 'Ryker did not start',
          body: '<div class="note bad">This report ships configuration keys that must never ' +
            'leave a build machine: <b>' + Ryker.dom.escapeHtml(cfg._leaked.join(', ')) + '</b>.</div>',
          dismissable: false
        });
        return;
      }

      // The shell is the one stage with no fallback: everything below draws into
      // it, so a failure here stops the boot rather than degrading it.
      if (guard('shell', function () { Ryker.shell.mount(); return true; }) === null) return;
      // Taken before Edit Mode opens, so every instruction can quote the document
      // as authored rather than as it stood at the previous save.
      guard('origin', function () { Ryker.instructions.captureOrigin(); });
      guard('toolbar', build);
      guard('pane', function () { Ryker.pane.build(); });
      guard('formatbar', function () { Ryker.formatbar.init(); });
      guard('pick', function () { Ryker.pick.init(); });
      guard('multi', function () { Ryker.multi.init(); });
      guard('rail', function () { Ryker.rail.build(); Ryker.rail.init(); });
      guard('history', function () { Ryker.history.bind(); });
      guard('tooltip', function () { Ryker.tooltip.init(); });

      guard('wire', function () {
        Ryker.editable.onChange(sync);
        Ryker.instructions.onChange(function () { Ryker.pane.refresh(); sync(); });
      });

      document.addEventListener('keydown', function (e) {
        // Ctrl+S, or Cmd+S. Taken over because in a document with an editor
        // attached it plainly means "save my edits", not "write this page to
        // disk", and the browser's own dialog would do the wrong thing.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          e.stopPropagation();
          save(true);
          return;
        }
        if (e.key !== 'Escape') return;
        if (Ryker.menu.isOpen()) { Ryker.menu.close(); e.stopPropagation(); e.preventDefault(); return; }
        if (Ryker.dialog.isOpen()) { Ryker.dialog.closeTop(); e.stopPropagation(); e.preventDefault(); }
      }, true);

      // Ryker opens ready to work and stays that way: expanded, editing, pane
      // showing. Its whole purpose is the pane, so starting collapsed would hide
      // the point of it, and a mode switch would only ever be turned back on.
      //
      // Guarded stage by stage rather than as one block, and the order matters.
      // Editing is the capability worth protecting, so it must not sit behind
      // anything cosmetic: an earlier version of this ran the whole tail bare, and
      // a failure inside build() left `bar` null, expand() threw dereferencing it,
      // and the document was never made editable at all. Toolbar chrome failing
      // now costs the toolbar and nothing else.
      guard('expand', function () { expand(true); });
      guard('editable', function () { Ryker.editable.enable(); });
      guard('sync', sync);
      guard('recover', function () { Ryker.recover.offer(); });
      Ryker.logger.resume().then(function (ok) {
        sync();
        // Asking on load is the only honest reading of "always on": the picker
        // needs a click, so the click has to be offered rather than waited for.
        // Deliberately not asked here. A modal on load covers the report with a
        // backdrop that swallows every click before anyone has done anything,
        // which is a poor trade for a grant that is only needed once a save
        // exists to write. Saves are queued until it arrives, so nothing is lost
        // by waiting for the first one.
      });
      Ryker.logger.onChange(buildMenu);
    }

    return {
      start: start, sync: sync, save: save, expand: expand,
      log: log, problems: function () { return problems.slice(); }
    };
  })();

  // history.js calls this behind an `if (Ryker.log)` guard. bootstrap/boot.js used
  // to define it and no longer exists, so without this line the guard is
  // permanently false and the diagnostic silently does nothing.
  Ryker.log = Ryker.boot.log;

  (function () {
    'use strict';
    function go() { Ryker.boot.start(); }
    function schedule() {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
      setTimeout(go, 50);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
    else schedule();
  })();


})();
