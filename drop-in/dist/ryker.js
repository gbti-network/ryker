/*!
 * Ryker 0.2.0
 * A drop-in editing layer for authored HTML reports.
 *
 * Generated bundle. Do not edit. Sources, in load order:
 *   utils/dom.js  (51 lines)
 *   config/config.js  (116 lines)
 *   security/scan.js  (86 lines)
 *   editor/sanitize.js  (218 lines)
 *   editor/blocks.js  (547 lines)
 *   export/zip.js  (193 lines)
 *   export/html.js  (186 lines)
 *   export/packager.js  (277 lines)
 *   ui/theme.js  (61 lines)
 *   ui/styles.js  (405 lines)
 *   ui/shell.js  (241 lines)
 *   ui/icons.js  (68 lines)
 *   ui/tooltip.js  (82 lines)
 *   ui/dialog.js  (138 lines)
 *   ui/menu.js  (104 lines)
 *   editor/editable.js  (585 lines)
 *   editor/history.js  (243 lines)
 *   editor/formatbar.js  (252 lines)
 *   editor/links.js  (173 lines)
 *   editor/pick.js  (228 lines)
 *   editor/multi.js  (172 lines)
 *   editor/table.js  (345 lines)
 *   editor/outline.js  (289 lines)
 *   editor/move.js  (427 lines)
 *   ui/rail.js  (530 lines)
 *   instructions/steps.js  (375 lines)
 *   instructions/instructions.js  (501 lines)
 *   instructions/merge.js  (405 lines)
 *   storage/fs.js  (336 lines)
 *   storage/logger.js  (433 lines)
 *   instructions/browser.js  (296 lines)
 *   ui/pane.js  (292 lines)
 *   storage/recover.js  (298 lines)
 *   bootstrap/boot.js  (575 lines)
 *
 * Classic script by design: module scripts do not load from file:// URLs,
 * and a report handed over as a ZIP is opened from disk.
 */
(function () {
  'use strict';
  if (window.Ryker && window.Ryker.VERSION) return;
  var Ryker = { VERSION: "0.2.0", BUILD: "Ryker", SURFACE: "drop-in" };
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

    function textOf(node) {
      return (node.textContent || '').replace(/\s+/g, ' ').trim();
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
      el: el, textOf: textOf, escapeHtml: escapeHtml, uid: uid, now: now, fmtDate: fmtDate
    };
  })();


  /* ---- config/config.js ------------------------------------------ */
  // Configuration intake.
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
    //
    // These names outlive the GitHub and Google features they were written for.
    // The feature keys are gone from DEFAULTS above because nothing read them,
    // but a config file written for an older build can still carry the secrets,
    // and an inherited ryker.config.js is exactly where one would sit unnoticed.
    // This list is the check that catches it, so it stays whether or not Ryker
    // has anything left to do with either service.
    var FORBIDDEN = [
      'RYKER_GITHUB_CLIENT_SECRET', 'RYKER_GITHUB_PRIVATE_KEY',
      'RYKER_GITHUB_TOKEN', 'RYKER_GITHUB_INSTALLATION_TOKEN',
      'RYKER_GOOGLE_CLIENT_SECRET', 'RYKER_GOOGLE_REFRESH_TOKEN',
      'RYKER_SERVICE_ACCOUNT'
    ];

    var state = null;

    function extensionDocumentId() {
      var canonical = String(location.origin || '') + String(location.pathname || '/');
      var host = String(location.hostname || location.protocol.replace(':', '') || 'document')
        .toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'document';
      function part(seed) {
        var h = seed >>> 0;
        for (var i = 0; i < canonical.length; i++) {
          h ^= canonical.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
      }
      return 'web-' + host + '-' + part(2166136261) + part(2246822519);
    }

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
      // A content script runs in an isolated world, so page JavaScript cannot
      // provide its configuration. The extension worker supplies this object
      // immediately before it explicitly starts Ryker.
      if (Ryker.SURFACE === 'extension' && Ryker.extensionConfig) {
        Object.keys(Ryker.extensionConfig).forEach(function (k) {
          raw[k] = Ryker.extensionConfig[k];
        });
      } else if (window.RYKER_CONFIG) {
        Object.keys(window.RYKER_CONFIG).forEach(function (k) { raw[k] = window.RYKER_CONFIG[k]; });
      }
      var inline = Ryker.SURFACE === 'extension' ? null : readInline();
      if (inline) Object.keys(inline).forEach(function (k) { raw[k] = inline[k]; });

      var leaked = FORBIDDEN.filter(function (k) { return raw[k] != null && raw[k] !== ''; });

      var cfg = {};
      Object.keys(DEFAULTS).forEach(function (k) {
        cfg[k] = raw[k] != null ? raw[k] : DEFAULTS[k];
      });

      // Authored reports use their stable title rather than a filename. On the
      // extension surface origin + path are the stable identity. Query strings
      // and fragments commonly contain signed-preview or SSO secrets and must not
      // become storage keys, revision metadata or exported package manifests.
      if (!cfg.RYKER_DOCUMENT_ID) {
        cfg.RYKER_DOCUMENT_ID = Ryker.SURFACE === 'extension'
          ? extensionDocumentId()
          : slug(document.title || 'untitled');
      }
      if (!cfg.RYKER_DOCUMENT_PATH) {
        var last = location.pathname.split('/').pop();
        cfg.RYKER_DOCUMENT_PATH = last ? decodeURIComponent(last) : 'report.html';
      }

      cfg._leaked = leaked;
      state = cfg;
      return state;
    }

    function slug(s) {
      return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
    }

    return { load: load, slug: slug };
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
      { name: 'Generic bearer token assignment', re: /["']?\b(client_secret|refresh_token|private_key)\b["']?\s*[:=]\s*["'][^"'\r\n]{16,4096}["']/ }
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
    //
    // Scan in bounded chunks rather than silently stopping after 2 MiB. The
    // overlap is larger than the longest bounded pattern above, so a credential
    // split across two chunks is still seen. Duplicate hits from the overlap are
    // collapsed before returning.
    function bytes(u8, label) {
      var chunkSize = 256 * 1024;
      var overlap = 8192;
      var tail = '';
      var hits = [];
      var seen = {};
      for (var offset = 0; offset < u8.length; offset += chunkSize) {
        var end = Math.min(offset + chunkSize, u8.length);
        var content = tail;
        for (var i = offset; i < end; i++) content += String.fromCharCode(u8[i]);
        text(content, label).forEach(function (hit) {
          var key = hit.artifact + '\n' + hit.pattern + '\n' + hit.excerpt;
          if (!seen[key]) { seen[key] = true; hits.push(hit); }
        });
        tail = content.slice(-overlap);
      }
      // Properties keep the array API compatible while making it impossible for
      // a caller to mistake a future partial scan for a clean one.
      hits.truncated = false;
      hits.scannedBytes = u8.length;
      hits.totalBytes = u8.length;
      return hits;
    }

    return { text: text, bytes: bytes, patterns: PATTERNS };
  })();


  /* ---- editor/sanitize.js ---------------------------------------- */
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

    var SELECTOR = 'h1, p, li, td, th, h2, h3, h4, h5, figcaption, caption, blockquote p, dd, dt';
    var ATOMIC_SELECTOR = 'svg';
    var PICK_SELECTOR = SELECTOR + ', ' + ATOMIC_SELECTOR;

    function root() {
      return document.querySelector('main') || document.body;
    }

    function ownHeader(head) {
      var main = document.querySelector('main');
      return !!(main && main.contains(head));
    }

    // A marker attribute locks the element carrying it and everything inside it,
    // because that element's text may be the key. Table structure is the case
    // where that reading is wrong. A <table data-sort> or a <tr data-effort> is
    // declaring how the container behaves, and the key is the attribute itself,
    // not the prose in each cell beneath it. Reading those as locks took every
    // cell of a sortable table out of the editable set at a stroke, which is the
    // single most common shape a report's tables arrive in.
    var HOST_KEYS = '[data-effort], [data-sort], [data-group], [data-impact]';
    var GRID = { TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, COLGROUP: 1, COL: 1 };

    function hostLocked(node) {
      var marked = node.closest ? node.closest(HOST_KEYS) : null;
      while (marked && GRID[marked.tagName]) {
        marked = marked.parentElement ? marked.parentElement.closest(HOST_KEYS) : null;
      }
      return !!marked;
    }

    function excluded(node) {
      // Anything Ryker owns.
      if (Ryker.shell && Ryker.shell.owns(node)) return true;
      // SVG internals are never editable. The root SVG itself is an atomic
      // selectable object, however, so a person can highlight and remove the
      // whole chart without being allowed to damage paths, labels or geometry.
      var vector = node.closest('svg');
      if (vector && node !== vector) return true;
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
      if (hostLocked(node)) return true;
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

    var CELL = { TD: 1, TH: 1 };

    function candidates() {
      var out = [];
      Array.prototype.forEach.call(root().querySelectorAll(SELECTOR), function (n) {
        if (excluded(n)) return;
        // A list item holding only nested block content is a container, not prose.
        if (n.querySelector(SELECTOR)) return;
        // An empty block has nothing to derive an identity from, so it is not a
        // candidate. A table cell is the exception worth making: a blank cell in
        // a filled-in table is a hole someone opened the document to fill, and
        // leaving it out made the one edit that table needed the one edit Ryker
        // would not take. seatOf() gives it an identity the grid already holds.
        if (!Ryker.dom.textOf(n) && !CELL[n.tagName]) return;
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

    function atomic(node) {
      return !!(node && node.matches && node.matches(ATOMIC_SELECTOR) &&
        root().contains(node) && !excluded(node));
    }

    function atomicNodes() {
      return Array.prototype.filter.call(root().querySelectorAll(ATOMIC_SELECTOR), atomic);
    }

    function inDocumentOrder(nodes) {
      return nodes.sort(function (a, b) {
        var p = a.compareDocumentPosition(b);
        if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
    }

    // Pickable objects include editable prose plus atomic media. Keeping this
    // separate from sequence() is what prevents enable() from ever placing
    // contenteditable on an SVG.
    function pickSequence() {
      return inDocumentOrder(sequence().concat(atomicNodes()));
    }

    // Snapshots must include atomic media or removing it would produce no delta,
    // leave Save disabled and vanish from recovery and generated instructions.
    function tracked() {
      var nodes = inDocumentOrder(candidates().concat(atomicNodes()));
      var counts = {}, seen = {}, out = [];
      nodes.forEach(function (node) {
        var id = identify(node, counts);
        if (!seen[id]) { seen[id] = true; out.push({ id: id, node: node }); }
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
      var text = Ryker.dom.textOf(node);
      var base = hash(text ? node.tagName + '|' + text.slice(0, 160)
        : (Ryker.table.seatId(node) || node.tagName + '|'));
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

    // Replacing an element to change P -> H1 creates a new DOM node. Carry the
    // authored block identity across that replacement so the change is one tag
    // conversion, not a deletion plus an unrelated insertion.
    function transferId(from, to) {
      if (!from || !to) return null;
      var id = blockId(from);
      idCache.set(to, id);
      return id;
    }

    // Called once at boot, before anything is replayed or edited, so every id is
    // computed from the document as it was authored.
    function seedIds() { var editable = all().length; tracked(); return editable; }

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
      tracked().some(function (b) {
        if (b.id === id) { found = b.node; return true; }
        return false;
      });
      if (found) return found;

      // tracked() is built from candidates(), which drops a block with no text
      // because an empty block has nothing to derive an identity from. A block
      // that was GIVEN an identity is a different case: autoList() builds its
      // <li> empty and calls transferId() onto it, so the id is cached and real
      // while the node is invisible to the scan above. Recovery, moves and every
      // instruction resolve blocks through here, so without this the newly
      // converted list item cannot be found by the id it was just handed.
      // sequence() keeps empties on purpose, which is exactly what it is for.
      sequence().some(function (node) {
        if (idCache.get(node) === id) { found = node; return true; }
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
      var list = tracked();
      list.forEach(function (b, i) {
        var box = boxOf(b.node);
        var seat = Ryker.table.seatOf(b.node);
        snap[b.id] = {
          html: atomic(b.node) ? atomicHtml(b.node) : b.node.innerHTML,
          tag: b.node.tagName,
          prev: i > 0 ? list[i - 1].id : null,
          box: box ? boxKey(b.node) : null,
          boxTag: box ? box.tagName : null,
          atomic: atomic(b.node),
          row: seat ? seat.row : null, col: seat ? seat.col : null
        };
      });
      return snap;
    }

    function atomicHtml(node) {
      var copy = node.cloneNode(true);
      copy.classList.remove('ryker-pick', 'ryker-dirty', 'ryker-editing');
      if (!copy.getAttribute('class')) copy.removeAttribute('class');
      return copy.outerHTML;
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
            tag: a.tag, prev: a.prev, box: a.box || null, boxTag: a.boxTag || null,
            row: a.row || null, col: a.col == null ? null : a.col
          });
        } else if (htmlOf(before[id]) !== htmlOf(a) ||
                   (before[id] && before[id].tag) !== a.tag) {
          changes.push({ id: id, before: htmlOf(before[id]), after: htmlOf(a),
                         kind: 'changed', tag: a.tag,
                         beforeTag: before[id] && before[id].tag || null,
                         afterTag: a.tag || null, prev: a.prev || null,
                         box: a.box || null, boxTag: a.boxTag || null,
                         row: a.row || null, col: a.col == null ? null : a.col });
        }
      });
      Object.keys(before).forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(after, id)) {
          var was = before[id];
          var meta = was && typeof was === 'object' ? was : {};
          changes.push({ id: id, before: htmlOf(was), after: null, kind: 'removed',
                         tag: meta.tag || null, atomic: !!meta.atomic,
                         prev: meta.prev || null,
                         box: meta.box || null, boxTag: meta.boxTag || null,
                         row: meta.row || null, col: meta.col == null ? null : meta.col });
        }
      });
      return changes;
    }

    // Puts a recorded change back into the document. This is what makes a journal
    // held in browser storage worth anything: the file on disk is untouched, so
    // without replay a reload silently discarded every saved edit.
    function boxIndex() {
      var boxes = {};
      Array.prototype.forEach.call(root().querySelectorAll(BOX), function (box) {
        var key = boxKey(box);
        if (key) boxes[key] = box;
      });
      return boxes;
    }

    function insertNew(node, c, anchor, context) {
      if (Ryker.table.place(node, c, anchor, context)) return;
      var boxTag = String(c.boxTag || '').toUpperCase();
      var box = c.box && context.boxes[c.box];
      if (c.box && /^(OL|UL|DL|FIGURE)$/.test(boxTag)) {
        if (!box) {
          box = document.createElement(boxTag);
          boxKeys.set(box, c.box);
          context.boxes[c.box] = box;
          var unit = anchor && (boxOf(anchor) || anchor);
          if (unit && unit.parentNode) unit.parentNode.insertBefore(box, unit.nextSibling);
          else root().insertBefore(box, root().firstChild);
        }
        if (anchor && anchor.parentNode === box) box.insertBefore(node, anchor.nextSibling);
        else box.appendChild(node);
        return;
      }
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(node, anchor.nextSibling);
      else root().appendChild(node);
    }

    function applyChange(c, context) {
      context = context || { boxes: boxIndex(), rows: Ryker.table.rowIndex() };
      var node = byId(c.id);
      var tag = String(c.afterTag || c.tag || '').toUpperCase();
      var validTag = /^(H[1-5]|P|LI|TD|TH|FIGCAPTION|CAPTION|BLOCKQUOTE|DD|DT|SVG)$/.test(tag);

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
        if (!validTag) return false;
        node = document.createElement(tag);
        if (c.id.charAt(0) === '@') node.setAttribute('data-ryker-id', c.id.slice(1));
        else if (c.id.charAt(0) === '#') node.id = c.id.slice(1);
        var anchor = c.prev ? byId(c.prev) : null;
        insertNew(node, c, anchor, context);
      }

      if (c.kind === 'changed' && tag && node.tagName !== tag) {
        if (!validTag || tag === 'SVG') return false;
        var replacement = document.createElement(tag);
        Array.prototype.slice.call(node.attributes).forEach(function (attr) {
          replacement.setAttribute(attr.name, attr.value);
        });
        transferId(node, replacement);
        var boxTag = String(c.boxTag || '').toUpperCase();
        if (tag === 'LI' && /^(OL|UL)$/.test(boxTag) && node.parentNode.tagName !== boxTag) {
          var list = document.createElement(boxTag);
          if (c.box) { boxKeys.set(list, c.box); context.boxes[c.box] = list; }
          node.parentNode.replaceChild(list, node);
          list.appendChild(replacement);
        } else {
          node.parentNode.replaceChild(replacement, node);
        }
        node = replacement;
      }

      node.innerHTML = Ryker.sanitize.html(c.after);
      return true;
    }

    function completeBoxDeletes(changes, context) {
      var groups = {}, handled = {};
      (changes || []).forEach(function (change) {
        if (change.kind === 'removed' && change.box && change.boxTag === 'TABLE') {
          (groups[change.box] = groups[change.box] || []).push(change.id);
        }
      });
      Object.keys(groups).forEach(function (key) {
        var box = context.boxes[key];
        if (!box || !box.parentNode) return;
        var inside = tracked().filter(function (block) { return box.contains(block.node); })
          .map(function (block) { return block.id; });
        if (!inside.length || !inside.every(function (id) { return groups[key].indexOf(id) !== -1; })) return;
        box.parentNode.removeChild(box);
        groups[key].forEach(function (id) { handled[id] = true; });
        delete context.boxes[key];
      });
      return handled;
    }

    // Restore recorded order among blocks that share a parent. Moving across
    // different containers needs container-level metadata and is reported as a
    // miss by the recovery caller rather than guessed.
    function applyOrder(ids) {
      var groups = [];
      var parents = [];
      var missed = 0, moved = 0;
      (ids || []).forEach(function (id) {
        var node = byId(id);
        if (!node || !node.parentNode) { missed += 1; return; }
        var at = parents.indexOf(node.parentNode);
        if (at === -1) {
          parents.push(node.parentNode);
          groups.push([node]);
        } else {
          groups[at].push(node);
        }
      });
      groups.forEach(function (nodes) {
        var parent = nodes[0] && nodes[0].parentNode;
        if (!parent || nodes.length < 2) return;
        var current = Array.prototype.filter.call(parent.children, function (child) {
          return nodes.indexOf(child) !== -1;
        });
        var differs = nodes.some(function (node, i) { return current[i] !== node; });
        if (!differs) return;

        // A flat legacy order describes only tracked blocks. Preserve every
        // untracked widget, image wrapper and text node in its existing slot by
        // marking the tracked slots before moving anything into their new order.
        var markers = current.map(function (node) {
          var marker = document.createComment('ryker-order');
          parent.insertBefore(marker, node);
          return marker;
        });
        current.forEach(function (node) { parent.removeChild(node); });
        markers.forEach(function (marker, i) {
          parent.insertBefore(nodes[i], marker);
          parent.removeChild(marker);
        });
        moved += nodes.filter(function (node, i) { return current[i] !== node; }).length;
      });
      return { moved: moved, missed: missed };
    }

    function applyRecords(records) {
      var applied = 0, missed = 0, moved = 0, orderMissed = 0;
      (records || []).forEach(function (r) {
        var context = { boxes: boxIndex(), rows: Ryker.table.rowIndex() };
        var boxed = completeBoxDeletes(r.changes || [], context);
        var rowed = Ryker.table.completeRowDeletes(r.changes || [], context, tracked());
        (r.changes || []).forEach(function (c) {
          if (boxed[c.id] || rowed[c.id] || applyChange(c, context)) applied += 1; else missed += 1;
        });
        if (Array.isArray(r.order)) {
          var ordered = applyOrder(r.order);
          moved += ordered.moved;
          orderMissed += ordered.missed;
        }
      });
      return { applied: applied, missed: missed, moved: moved, orderMissed: orderMissed };
    }

    function label(id) {
      var node = byId(id);
      if (!node) return id;
      var head = node.closest('section');
      var h = head ? head.querySelector('h2, h3') : null;
      var text = Ryker.dom.textOf(node);
      // A blank cell has no words to name itself with, and a change list showing
      // an empty row for it says nothing about which hole is being filled.
      if (!text && CELL[node.tagName]) text = Ryker.table.seatLabel(node) || text;
      var short = text.length > 60 ? text.slice(0, 57) + '...' : text;
      return (h ? Ryker.dom.textOf(h) + ' / ' : '') + short;
    }

    return {
      SELECTOR: SELECTOR, PICK_SELECTOR: PICK_SELECTOR, root: root, all: all,
      atomic: atomic, pickSequence: pickSequence, blockId: blockId, transferId: transferId,
      byId: byId, hash: hash,
      excluded: excluded, snapshot: snapshot, diffSnapshots: diffSnapshots, label: label,
      seedIds: seedIds, stamp: stamp, htmlOf: htmlOf, sequence: sequence,
      boxOf: boxOf, boxKey: boxKey,
      applyChange: applyChange, applyRecords: applyRecords, applyOrder: applyOrder
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

    var MAX_ENTRIES = 65535;
    var MAX_U16 = 65535;
    var MAX_U32 = 4294967295;

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

    function safeName(value) {
      var name = String(value == null ? '' : value).replace(/\\/g, '/');
      if (!name) throw new Error('A ZIP entry has no filename.');
      if (name.charAt(0) === '/' || /^[a-z]:/i.test(name)) {
        throw new Error('ZIP entry names must be relative: ' + name);
      }
      if (name.indexOf('\0') >= 0) throw new Error('A ZIP entry name contains a null byte.');
      var parts = name.split('/');
      if (parts.some(function (part) { return !part || part === '.' || part === '..'; })) {
        throw new Error('ZIP entry names cannot contain empty, current, or parent path segments: ' + name);
      }
      return parts.join('/');
    }

    function checkedAdd(a, b, what) {
      var total = a + b;
      if (!Number.isSafeInteger(total) || total > MAX_U32) {
        throw new Error('The ZIP is too large for this exporter (' + what + ' exceeds 4 GiB).');
      }
      return total;
    }

    // files: [{ name: 'a/b.csv', data: string | Uint8Array }]
    function build(files) {
      if (!Array.isArray(files)) return Promise.reject(new Error('ZIP input must be a list of files.'));
      if (files.length > MAX_ENTRIES) {
        return Promise.reject(new Error('A ZIP can contain at most ' + MAX_ENTRIES + ' files in this exporter.'));
      }
      var when = new Date();
      var time = dosTime(when), date = dosDate(when);
      var names = {};
      var prepared;
      try {
        prepared = files.map(function (f) {
          var name = safeName(f.name);
          if (names[name]) throw new Error('The ZIP contains the same filename twice: ' + name);
          names[name] = true;
          return { name: name, data: f.data };
        });
      } catch (error) {
        return Promise.reject(error);
      }

      return Promise.all(prepared.map(function (f) {
        var raw = toBytes(f.data);
        if (raw.length > MAX_U32) throw new Error('A ZIP member exceeds 4 GiB: ' + f.name);
        var nameBytes = new TextEncoder().encode(f.name);
        if (nameBytes.length > MAX_U16) throw new Error('A ZIP filename is too long: ' + f.name);
        return deflate(raw).then(function (comp) {
          return {
            name: f.name,
            nameBytes: nameBytes,
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
          offset = checkedAdd(checkedAdd(offset, h.length, e.name), e.body.length, e.name);
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
          offset = checkedAdd(offset, cb.length, e.name);
        });

        var end = W(22);
        end.u32(0x06054b50).u16(0).u16(0)
          .u16(entries.length).u16(entries.length)
          .u32(offset - cdStart).u32(cdStart).u16(0);

        var parts = locals.concat(central, [end.done()]);
        var total = parts.reduce(function (n, p) {
          return checkedAdd(n, p.length, 'archive size');
        }, 0);
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

    return {
      build: build, download: download, crc32: crc32, safeName: safeName,
      limits: { entries: MAX_ENTRIES, bytes: MAX_U32 }
    };
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

    function isWorkspace() {
      return Ryker.SURFACE === 'extension' &&
        !!document.getElementById('workspace-document') &&
        document.body.classList.contains('workspace-loaded');
    }

    function sourceDocumentClone() {
      if (!isWorkspace()) return document.documentElement.cloneNode(true);

      // The workspace is extension chrome around an uploaded document. HTML
      // uploads retain a sanitised clone of their authored document shell so safe
      // title/meta/html/body metadata and comments survive; Markdown deliberately
      // uses the small default shell below.
      var supplied = window.RykerWorkspace &&
        typeof window.RykerWorkspace.sourceShell === 'function'
        ? window.RykerWorkspace.sourceShell() : null;
      if (supplied) {
        var suppliedBody = supplied.querySelector('body');
        if (!suppliedBody) throw new Error('The uploaded HTML document has no exportable body.');
        suppliedBody.innerHTML = document.getElementById('workspace-document').innerHTML;
        return supplied;
      }

      var clean = document.implementation.createHTMLDocument(
        Ryker.config.load().RYKER_DOCUMENT_PATH || document.title || 'Ryker document');
      clean.documentElement.setAttribute('lang', document.documentElement.lang || 'en');
      clean.head.insertBefore(clean.createElement('meta'), clean.head.firstChild);
      clean.head.firstChild.setAttribute('charset', 'utf-8');
      clean.body.innerHTML = document.getElementById('workspace-document').innerHTML;
      return clean.documentElement;
    }

    // A clone of the live document with everything Ryker added taken back out.
    // Ryker's chrome lives in one element and its edits live in the report's own
    // markup, so removing the element and the attributes is the whole job.
    function snapshot(keepRyker) {
      var doc = sourceDocumentClone();

      // Both of these are rebuilt at boot, so neither is kept in either export.
      // Leaving the stylesheet behind would put Ryker's highlight rules in a file
      // that carries no Ryker.
      var owner = Ryker.shell && Ryker.shell.owner ? Ryker.shell.owner() : null;
      var owned = owner ? '[data-ryker-owner="' + owner.replace(/"/g, '') + '"]' : null;
      [owned].forEach(function (sel) {
        if (!sel) return;
        var n = doc.querySelector(sel);
        while (n) {
          if (n.parentNode) n.parentNode.removeChild(n);
          n = doc.querySelector(sel);
        }
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
      // export as a stray padding rule with no panel to justify it. Restore the
      // authored inline declaration, including !important, when the live shell
      // remembers one instead of erasing it with Ryker's temporary value.
      var exportBody = doc.body || doc.querySelector('body');
      if (exportBody) {
        ['padding-left', 'padding-right', 'padding-top'].forEach(function (prop) {
          var authored = Ryker.shell && Ryker.shell.originalBodyPadding
            ? Ryker.shell.originalBodyPadding(prop) : null;
          // Remembering a property is the ONLY evidence Ryker claimed it. The
          // data-ryker-pushed attribute is one flag on body covering all three
          // sides, so consulting it per property made an open pane on the right
          // erase an authored padding-left the rail never touched. A property
          // Ryker did not claim is the page's own and must ship untouched.
          if (!authored) return;
          if (authored.value) {
            exportBody.style.setProperty(prop, authored.value, authored.priority || '');
          } else {
            exportBody.style.removeProperty(prop);
          }
        });
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
    function canAttach() { return !isWorkspace(); }
    function withRyker() {
      if (!canAttach()) {
        throw new Error('With Ryker export is unavailable for extension workspace uploads. ' +
          'Install the drop-in in the source file to create a portable editable copy.');
      }
      return snapshot(true);
    }

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
      canAttach: canAttach,
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

    var MAX_FOLDER_ENTRIES = 5000;

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
        if (!f) return null;
        var item = typeof f === 'string' ? { name: f } : f;
        var path = item.path || item.href || item.name;
        if (!path) return null;
        return {
          name: item.name || path,
          source: 'manifest',
          bytes: typeof item.bytes === 'number' ? item.bytes : null,
          href: item.href || path,
          data: item.data == null ? null : item.data
        };
      }).filter(Boolean);
    }

    function folderAssets(dirHandle) {
      var lib = (Ryker.logger && Ryker.logger.LIB) || 'ryker';
      var logPrefix = dirHandle && String(dirHandle.name || '').toLowerCase() === lib
        ? 'revisions'
        : lib + '/revisions';

      function isLogPath(name) {
        var normalized = String(name).replace(/\/$/, '').toLowerCase();
        return normalized === logPrefix || normalized.indexOf(logPrefix + '/') === 0;
      }
      return Ryker.fs.walk(dirHandle, '', {
        maxEntries: MAX_FOLDER_ENTRIES,
        // Skip dot trees and only the revision corpus. The rest of `ryker/` can
        // include the distributable bundle that a with-Ryker report needs.
        skip: function (entry, name) {
          return entry.name.charAt(0) === '.' || isLogPath(name);
        }
      }).then(function (entries) {
        return entries.map(function (entry) {
          return { name: entry.name, source: 'folder', bytes: entry.size,
            root: dirHandle, path: entry.name };
        });
      });
    }

    // One seam keeps the dialog independent of the concrete folder adapter.
    function fsBackend() {
      return Ryker.fs;
    }

    function showError(title, error) {
      if (error && error.name === 'AbortError') return;
      Ryker.dialog.alert(title,
        Ryker.dom.escapeHtml((error && error.message) || String(error)), 'bad');
    }

    function open() {
      var fs = fsBackend();
      if (fs && fs.isReady()) {
        folderAssets(fs.handle()).then(function (files) { dialog(files, true); })
          .catch(function (error) { showError('Could not read the report folder', error); });
        return;
      }
      var files = manifestAssets().concat(inlinedAssets());
      dialog(files, false);
    }

    function dialog(files, fromFolder) {
      var base = Ryker.exportHtml.baseName();
      var attachedBundle = bundlePath();
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

      row(base + '.html', true, 'clean report', { kind: 'report', mode: 'clean' });
      if (attachedBundle) {
        row(base + '-ryker.html', false, 'report with Ryker attached',
          { kind: 'report', mode: 'ryker', bundle: attachedBundle });
      }

      files.forEach(function (f) {
        row(f.name, !fromFolder, f.bytes ? kb(f.bytes) : f.source, { kind: 'asset', file: f });
      });

      var chooseBtn = null;
      var fs = fsBackend();
      if (!fromFolder && fs && fs.supported()) {
        chooseBtn = { label: 'Choose report folder', keepOpen: true, action: function (api) {
          fs.pick().then(function (h) {
            api.close();
            return folderAssets(h).then(function (fl) { dialog(fl, true); });
          }).catch(function (error) { showError('Could not read the report folder', error); });
          return false;
        } };
      }

      var note = fromFolder
        ? '<div class="note ok">Listing the folder you granted access to, so anything added since ' +
          'the report was built appears here too. Folder files start unchecked.</div>'
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

    function bundlePath() {
      var script = document.querySelector('script[data-ryker][src]');
      if (!script) return null;
      var path = String(script.getAttribute('src') || '').split(/[?#]/)[0].replace(/\\/g, '/');
      try { path = decodeURIComponent(path); } catch (error) {}
      return path.replace(/^\.\//, '').replace(/^\//, '') || null;
    }

    function samePath(a, b) {
      return String(a || '').replace(/\\/g, '/').replace(/^\.\//, '') ===
        String(b || '').replace(/\\/g, '/').replace(/^\.\//, '');
    }

    function assetJob(f) {
      if (f.data != null) return Promise.resolve({ name: f.name, data: f.data });
      if (f.root && f.path) {
        return Ryker.fs.readBytes(f.root, f.path)
          .then(function (bytes) { return { name: f.name, data: bytes }; });
      }
      if (f.href) {
        return fetch(f.href).then(function (response) {
          if (!response.ok && !/^data:/i.test(f.href)) {
            throw new Error('Could not read ' + f.name + ' (' + response.status + ').');
          }
          return response.arrayBuffer();
        }).then(function (buf) { return { name: f.name, data: new Uint8Array(buf) }; });
      }
      return Promise.reject(new Error('No readable source was supplied for ' + f.name + '.'));
    }

    function asBytes(data) {
      if (data instanceof Uint8Array) return data;
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      return new TextEncoder().encode(String(data));
    }

    function build(rows, base, api) {
      var chosen = rows.filter(function (r) { return r.cb.checked; });
      var withRyker = chosen.filter(function (r) {
        return r.payload.kind === 'report' && r.payload.mode === 'ryker';
      })[0];
      if (withRyker) {
        var bundleRow = rows.filter(function (r) {
          return r.payload.kind === 'asset' && samePath(r.payload.file.name, withRyker.payload.bundle);
        })[0];
        if (!bundleRow) {
          api.close();
          showError('Could not build the package', new Error(
            'The with-Ryker copy needs ' + withRyker.payload.bundle +
            '. Choose the report folder so Ryker can include that bundle.'));
          return;
        }
        if (chosen.indexOf(bundleRow) < 0) chosen.push(bundleRow);
      }
      var jobs = chosen.map(function (r) {
        var p = r.payload;
        if (p.kind === 'report') {
          var out = Ryker.exportHtml.scanned(p.mode);
          if (out.hits.length) return Promise.reject({ leak: out.hits });
          return Promise.resolve({
            name: p.mode === 'clean' ? base + '.html' : base + '-ryker.html',
            data: out.html
          });
        }
        return assetJob(p.file);
      });

      Promise.all(jobs).then(function (entries) {
        var files = entries.filter(Boolean);

        // Section 44, widened: every member is scanned, not only the document,
        // so a token pasted into a CSV inside the package is caught too.
        var hits = [];
        files.forEach(function (f) {
          var found = typeof f.data === 'string'
            ? Ryker.scan.text(f.data, f.name)
            : Ryker.scan.bytes(asBytes(f.data), f.name);
          if (found.truncated) {
            throw new Error('The credential scan could not inspect all of ' + f.name + '.');
          }
          hits = hits.concat(found);
        });
        if (hits.length) { Ryker.dialog.leak(hits); api.close(); return; }

        var withManifest = files.concat([{
          name: 'ryker-package.json',
          data: Ryker.exportHtml.manifest(files.map(function (f) {
            var bytes = asBytes(f.data);
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
        showError('Could not build the package', err);
      });
    }

    return { open: open, inlinedAssets: inlinedAssets };
  })();


  /* ---- ui/theme.js ----------------------------------------------- */
  // Canonical visual tokens shared by the drop-in, injected extension chrome and
  // the extension-owned local-document workspace.
  Ryker.theme = (function () {
    'use strict';

    var tokens = {
      bg: '#ffffff', bg2: '#f5f6f8', bg3: '#eceef2',
      fg: '#16181d', fg2: '#3f4551', muted: '#6b7280',
      line: '#e2e5ea', line2: '#cfd4dc', field: '#ffffff',
      accent: '#4f46e5', accentFg: '#ffffff', accentSoft: 'rgba(79,70,229,.10)',
      active: '#e1e5ea', activeLine: '#aeb5bf', onactive: '#20242b',
      warn: '#b45309', onwarn: '#ffffff', warnSoft: 'rgba(180,83,9,.10)',
      ok: '#15803d', onok: '#ffffff', okSoft: 'rgba(21,128,61,.10)',
      danger: '#be123c', dangerSoft: 'rgba(190,18,60,.09)',
      // The brand red is the primary action colour. brandInk is what reads on
      // top of it and brandStrong is its pressed and hovered shade, so a primary
      // button is the brand rather than an approximation of it.
      brand: '#e5383b', brandInk: '#ffffff', brandStrong: '#c42b2e',
      ring: 'rgba(79,70,229,.35)',
      shadowMd: '0 1px 2px rgba(16,20,30,.06),0 4px 12px rgba(16,20,30,.08)',
      shadowXl: '0 8px 24px rgba(16,20,30,.12),0 24px 56px rgba(16,20,30,.16)',
      font: 'system-ui,sans-serif', mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      // One corner language across every Ryker surface. Component names remain
      // for compatibility, but none of them is allowed to drift into a pill or
      // a softer modal radius.
      rSm: '4px', rMd: '4px', rLg: '4px', rXl: '4px',
      s1: '4px', s2: '8px', s3: '12px', s4: '16px', s5: '20px', s6: '24px'
    };

    var names = {
      bg: 'bg', bg2: 'bg2', bg3: 'bg3', fg: 'fg', fg2: 'fg2', muted: 'muted',
      line: 'line', line2: 'line2', field: 'field', accent: 'accent', accentFg: 'accent-fg',
      accentSoft: 'accent-soft', active: 'active', activeLine: 'active-line',
      onactive: 'onactive', warn: 'warn', onwarn: 'onwarn', warnSoft: 'warn-soft',
      ok: 'ok', onok: 'onok', okSoft: 'ok-soft', danger: 'danger', dangerSoft: 'danger-soft',
      brand: 'brand-color', brandInk: 'brand-ink', brandStrong: 'brand-strong',
      ring: 'ring', shadowMd: 'sh-md', shadowXl: 'sh-xl',
      font: 'font', mono: 'mono', rSm: 'r-sm', rMd: 'r-md', rLg: 'r-lg', rXl: 'r-xl',
      s1: 's1', s2: 's2', s3: 's3', s4: 's4', s5: 's5', s6: 's6'
    };

    var cssText = Object.keys(tokens).map(function (key) {
      // Custom-property declarations still need separators. Without the
      // semicolon the browser parses the entire token stream as the value of the
      // first property, so layout rules work while every var(--rk-*) paint rule
      // becomes invalid. The result is structurally present, transparent chrome
      // with inherited black text: particularly invisible on a dark host page.
      return '--rk-' + names[key] + ':' + tokens[key] + ';';
    }).join('');

    function apply(node) {
      node = node || document.documentElement;
      Object.keys(tokens).forEach(function (key) {
        node.style.setProperty('--rk-' + names[key], tokens[key]);
      });
      return node;
    }

    return { tokens: tokens, cssText: cssText, apply: apply };
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

    var LIGHT = Ryker.theme.cssText;

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
      '.ryker-pick,.ryker-pick[contenteditable="true"]:focus{background:none;border-radius:4px;',
      '  box-shadow:inset 0 0 0 2px rgba(79,70,229,.55)}',
      // The unsaved bar sits in the margin, not against the prose.
      //
      // Drawn as an inset shadow it inherited the block's 4px radius, so a 3px
      // bar came to a point at each end and read as a smudge rather than as a
      // deliberate edge, and with no padding the first letter of every line
      // touched it. Square ends and a gutter of its own fix both.
      //
      // The negative margin pays for the padding, so a block does not jump
      // sideways the moment it becomes dirty. Carried past .ryker-pick on
      // specificity as well as on order, because a block that is picked AND
      // unsaved must not get its rounded ends back.
      '[contenteditable="true"].ryker-dirty,[contenteditable="true"].ryker-dirty:focus,',
      '[contenteditable="true"].ryker-dirty.ryker-pick,',
      '[contenteditable="true"].ryker-dirty.ryker-pick:focus{',
      '  border-radius:0;margin-left:-12px;padding-left:12px}',
      // While a cross-block drag is live, the browser must not also be painting a
      // text selection underneath it.
      'body.ryker-picking, body.ryker-picking *{-webkit-user-select:none;user-select:none}',
      // The rail lists everything the report's own contents list does and more, so
      // leaving the sticky original visible puts it underneath and unclickable.
      'body[data-ryker-rail] nav.toc{display:none}',
      // Ryker must leave no trace in print. The PDF is the regression check, so
      // this rule is load-bearing rather than cosmetic.
      '@media print{[contenteditable]{outline:none !important;background:none !important}' +
        '.ryker-pick{background:none !important;box-shadow:none !important}' +
        // Only ever matches padding Ryker itself applied, so a report with body
        // padding of its own keeps it.
        'body[data-ryker-pushed]{padding-top:0 !important;padding-right:0 !important;' +
        'padding-left:0 !important}}'
    ].join('\n');

    var shadowCss = [
      ':host{all:initial}',
      '@media print{:host{display:none !important}}',
      '*,*::before,*::after{box-sizing:border-box}',

      // One palette. Ryker is chrome around a document, and a toolbar that changes
      // colour independently of the page it sits on was a distraction rather than
      // a feature.
      ':host{' + LIGHT + '}',

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
      // display:inline-flex on the base rule outranks the user agent's
      // [hidden]{display:none}, so a button hidden by the attribute stayed on
      // screen. Author display beats user agent display; this restores it.
      'button.rk[hidden]{display:none}',
      'button.rk.ghost{border-color:transparent;background:transparent}',
      'button.rk.ghost:hover:not(:disabled){background:var(--rk-bg2);border-color:var(--rk-line)}',
      'button.rk.danger:hover:not(:disabled){background:var(--rk-danger-soft);',
      '  border-color:var(--rk-danger);color:var(--rk-danger)}',
      'button.rk.icon{padding:6px 9px}',
      // The active state comes last on purpose. It shares specificity with
      // .ghost, so declaring it earlier let a ghost button that was also active
      // render transparent and disappear entirely.
      'button.rk.on{background:var(--rk-active);border-color:var(--rk-active-line);color:var(--rk-onactive);font-weight:600}',
      'button.rk.on:hover:not(:disabled){background:var(--rk-bg3);border-color:var(--rk-active-line);',
      '  color:var(--rk-onactive)}',
      // Primary is the brand, and it is not the same thing as active. A dialog's
      // confirming action used to borrow .on, which is the grey a toggled
      // toolbar button wears, so the one button meant to be reached for looked
      // like a switch that happened to be on. It comes after .on for the same
      // specificity reason .on comes after .ghost.
      'button.rk.primary{background:var(--rk-brand-color);border-color:var(--rk-brand-color);',
      '  color:var(--rk-brand-ink);font-weight:600}',
      'button.rk.primary:hover:not(:disabled),button.rk.primary:active:not(:disabled){',
      '  background:var(--rk-brand-strong);border-color:var(--rk-brand-strong);',
      '  color:var(--rk-brand-ink)}',
      // A destructive confirm is primary by weight and danger by meaning. Danger
      // wins the colour, because brand red on a Delete reads as encouragement.
      'button.rk.primary.danger,button.rk.primary.danger:hover:not(:disabled),',
      'button.rk.primary.danger:active:not(:disabled){background:var(--rk-danger);',
      '  border-color:var(--rk-danger);color:var(--rk-brand-ink)}',

      ':is(button.rk,.handle,input.rk,textarea.rk):focus-visible{',
      '  outline:2px solid transparent;box-shadow:0 0 0 3px var(--rk-ring);',
      '  border-color:var(--rk-accent)}',

      '.count{display:inline-block;min-width:18px;text-align:center;background:var(--rk-bg3);',
      '  color:var(--rk-fg2);border-radius:4px;padding:1px 6px;margin-left:2px;',
      '  font-size:11px;font-weight:600;line-height:1.4}',
      '.count.warn{background:var(--rk-warn);color:var(--rk-onwarn)}',
      'button.rk.on .count{background:var(--rk-bg);color:var(--rk-onactive)}',

      // ---- collapsed handle -------------------------------------------------
      '.handle{position:fixed;top:0;right:20px;z-index:2147483000;',
      '  background:var(--rk-bg);color:var(--rk-fg);border:1px solid var(--rk-line2);border-top:none;',
      '  border-radius:0 0 var(--rk-r-lg) var(--rk-r-lg);width:40px;height:40px;padding:8px;cursor:pointer;',
      '  font:inherit;display:flex;align-items:center;justify-content:center;box-shadow:var(--rk-sh-md)}',
      '.handle:hover{background:var(--rk-bg2)}',
      '.handle .brand-mark{width:24px;height:24px;margin:0}',

      // ---- toolbar ----------------------------------------------------------
      '.bar{position:fixed;top:0;left:0;right:0;z-index:2147483000;background:var(--rk-bg);',
      '  border-bottom:1px solid var(--rk-line);display:flex;align-items:center;gap:6px;',
      '  padding:8px 12px;flex-wrap:wrap;box-shadow:var(--rk-sh-md)}',
      '.brand{font-weight:700;letter-spacing:.09em;font-size:10px;text-transform:uppercase;',
      '  color:var(--rk-muted);margin-right:var(--rk-s1)}',
      '.brand-mark{display:block;width:18px;height:18px;object-fit:contain;flex:none;',
      '  margin-left:1px;margin-right:-1px}',
      '.sep{width:1px;height:22px;background:var(--rk-line);margin:0 var(--rk-s1)}',
      '.spacer{flex:1}',
      '.where{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--rk-muted);',
      '  background:var(--rk-bg2);border:1px solid var(--rk-line);border-radius:4px;padding:4px 11px;',
      '  font:inherit;font-size:11px;cursor:pointer}',
      // Disabled means there is nothing it can do about what it is reporting, so
      // it stops looking like a control and goes back to being a label.
      '.where:disabled{cursor:default}',
      '.where:not(:disabled):hover{background:var(--rk-bg3);border-color:var(--rk-line2);color:var(--rk-fg2)}',
      '.where:focus-visible{outline:2px solid transparent;box-shadow:0 0 0 3px var(--rk-ring)}',

      // ---- instant tooltip ---------------------------------------------------
      // White on black regardless of the palette, so it reads the same over the
      // toolbar and over report content, and shows with no delay.
      '.rk-tip{position:fixed;z-index:2147483200;background:#0d0f13;color:#fff;',
      '  border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:5px 9px;',
      '  font-size:11.5px;font-weight:500;line-height:1.35;max-width:280px;',
      '  pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.4)}',

      // The instruction count remains an accessible button, but its number is
      // the only visible object. A box around a count made it look like a second
      // action instead of the state of the instruction pane.
      'button.rk.count-only{padding:4px;min-width:26px;justify-content:center;',
      '  border-color:transparent;background:transparent}',
      'button.rk.count-only:hover:not(:disabled){border-color:transparent;background:var(--rk-bg2)}',
      'button.rk.count-only.on,button.rk.count-only.on:hover:not(:disabled){',
      '  border-color:transparent;background:transparent;color:var(--rk-fg)}',
      'button.rk.count-only .count{margin-left:0}',
      'button.rk.count-only.on .count{background:var(--rk-active);color:var(--rk-onactive)}',

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
      '.rail .rail-scope{padding:var(--rk-s2) var(--rk-s4);border-bottom:1px solid var(--rk-line);',
      '  background:var(--rk-bg)}',
      '.rail .scope-choices{display:flex;gap:var(--rk-s1)}',
      '.rail .scope-choice{flex:1 1 0;justify-content:center;padding:5px 8px}',
      '.rail .scope-label{margin-top:5px;color:var(--rk-muted);font-size:10.5px;',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.rail .rail-body{flex:1 1 auto;overflow:auto;padding:var(--rk-s2) 0}',
      '.rail .rail-grip{position:absolute;top:0;bottom:0;right:-4px;width:9px;cursor:col-resize;',
      '  z-index:1;background:transparent}',
      '.rail .rail-grip:hover,.rail .rail-grip:focus-visible{background:var(--rk-accent-soft);outline:none}',
      '.rail .rail-row{display:flex;align-items:center;gap:6px;height:26px;padding-right:8px;',
      '  cursor:pointer;font-size:12.5px;color:var(--rk-fg);white-space:nowrap;overflow:hidden;',
      '  border-left:2px solid transparent}',
      '.rail .rail-row:hover{background:var(--rk-bg2)}',
      '.rail .rail-row.on{background:var(--rk-bg3);border-left-color:var(--rk-active-line)}',
      '.rail .rail-row.navigation-only{color:var(--rk-muted);cursor:pointer}',
      '.rail .rail-row.navigation-only .rail-ico{opacity:.65}',
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
      '.formatbar .fb-btn{background:transparent;border:none;color:#e9ecf2;border-radius:4px;',
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
      '.where .dot{width:7px;height:7px;border-radius:4px;background:var(--rk-muted);flex:none}',
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


  /* ---- ui/icons.js ----------------------------------------------- */
  // Inline SVG icons. Small, stroke-based, currentColor, so they take the
  // button's own colour and need no font or network.
  Ryker.icons = (function () {
    'use strict';

    // The approved 32px Chrome export, embedded because the same bundle also runs
    // as a drop-in and page-world extension script where no package-relative URL
    // is available. Keeping it here avoids a network request and another Chrome
    // web-accessible resource.
    var BRAND_MARK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAADLUlEQVRYw73WSYhcVRQG4K+G7oIouFAJGBrdiAFRFId2jOhKFKdV0I2CE4guRLMMuhPBTVyo4EaCigOCGyE7QUVwwAFRk4CIQxQ1QcUp6a7qcnHP6bq8dFmlpupAceu9d+75/zPc/73WgYsuNSdroYM+rsLn+L49J/BOrH3cgWfxO8yDwAIGGOJRPI2v8Bva3RlnPcQqtuB5bItnb8bankUF2uhG1mu4E/sD/Ej4vBrr8FhWoB1ZrwbwudiFy+P5EfTwLt5WhnJwLCqQGa8F+JLS5w8CvK+0IpN9qNrn/1SgHb9+gG/Gg7gvMh3G/S5WsIjd2BOVGvxXAk3gJdyPu3Bc+PQjdqcC/wS3xfNhBvs3BGohWcPpeCCC9irgjtEQDivws8PneKEB632YwroRrI8z8Az24u4Ar/ucfknkqQC/GC9FRTKhqQh0I+AmZar34taqDQm8Fr8cyvexjB14XJn8j4NAEp3YggS/JNhvaZQ6xSbbQxGZJ/EZbo7rRXytKKFozzrAJPDteCHurcb9el8Lh/AGXg+f7bihEe8eo+HsTyKQTtdX4ANF12s7qAzYNzgZO2NN/0FkvxOvNcHHEcjenoaXq2Cdhl8GuhBXVvdTbnuxZwceq+IelWnTWrHuCvarG2See0+K/yuxb8HoSH6kaMN7AT7cIMZRpyAV6oIo/1oDPNWtaYvhdwgvKhJ8Hr4LYsNxBJoVyOxvjzWPVf08A/6IL7FPmYOchS6uwRO4Fwf+qQLNae5HJlePqdCvylneh5+i9JtwFq5T1PGU8L1RORnruj+JQDscz8GpwbgmkBmcqajawpiY30b7PrTB1DetWV64LNZknWrXwgk4cQz4QTyCrdOCNyuQGW6rruv3+A/4GX8GmYEydPsVmd2DX8I3X1oTLYNnwJ4yvaosdysD9Sn+MGaYqngpQFNZTWAY5VuKe4dxU2RWW6v6366uB9NmvRGBtnLkzo/rFVyhfL8tGn1gZmvSps50EoG05VhvCfCekbTOxPIUZOmuxXN4RZmBmYIngSSxFX8p3/E1qbkRWMbDQWL9i2XWlscGvsA788w+CaTKvTUv0Nr+BovA15ZlANGUAAAAAElFTkSuQmCC';

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
      grid: '<path d="M2.5 3.5h11v9h-11z"/><path d="M2.5 6.5h11"/><path d="M6.5 3.5v9"/>',
      note: '<path d="M3.5 2.5h9v11h-9z"/><path d="M5.5 5.5h5"/>' +
            '<path d="M5.5 8h5"/><path d="M5.5 10.5h3.5"/>',
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

    function brandMark(size) {
      var s = size || 18;
      return Ryker.dom.el('img', {
        class: 'brand-mark', src: BRAND_MARK, width: s, height: s,
        alt: '', 'aria-hidden': 'true', draggable: 'false'
      });
    }

    return { svg: svg, button: button, brandMark: brandMark, PATHS: PATHS };
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

      // Handed back in the order they were declared, so a caller can enable,
      // disable or hide one as the dialog's own fields change. Without this the
      // only way to reach a button was to guess at its position in the footer.
      api.buttons = [];
      (opts.buttons || []).forEach(function (b) {
        var node = d.el('button', {
          class: 'rk' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
          text: b.label,
          onclick: function () {
            if (!b.action) { api.close(); return; }
            var r = b.action(api);
            if (r !== false && !b.keepOpen) api.close();
          }
        });
        api.buttons.push(node);
        foot.appendChild(node);
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
        show(button, typeof items === 'function' ? items() : items);
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
  // Edit Mode. Per-block contenteditable over prose only, with sanitising at
  // explicit markup-entry boundaries and a baseline snapshot so a save knows
  // exactly which blocks moved.
  Ryker.editable = (function () {
    'use strict';

    var on = false;
    var baseline = null;
    var bound = [];
    var resumable = [];
    var listeners = [];
    var pendingListSpace = new WeakSet();

    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

    function arm(node, id) {
      if (!node || !node.isConnected || Ryker.blocks.excluded(node)) return;
      if (bound.some(function (b) { return b.node === node; })) return;
      node.setAttribute('contenteditable', 'true');
      node.setAttribute('spellcheck', 'true');
      node.classList.add('ryker-editing');
      bindOne(node, id || Ryker.blocks.blockId(node));
    }

    function enable() {
      if (on) return;
      // No stamping here. Block ids come from the document's own content and are
      // already correct, so the baseline taken at boot stays valid.
      if (!baseline) {
        baseline = Ryker.blocks.snapshot();
        Ryker.history.captureBaseline(baseline);
      }
      Ryker.blocks.all().forEach(function (b) { arm(b.node, b.id); });
      // Apart from table cells, all() omits empty authored blocks because they
      // have no stable content identity. A block that Ryker already armed can
      // later become empty, though, and Hide must not make it permanently inert
      // when Ryker reopens.
      resumable.forEach(function (node) { arm(node); });
      resumable = [];
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
          input: function () {
            if (consumeListSpace(n)) return;
            if (autoList(n, id)) return;
            Ryker.history.text(n); mark(n, id);
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
            // Splitting a cell in two would add a cell and change what the row
            // means, so Enter inside one is a line break rather than a split.
            // Swallowing the key outright was the older behaviour, and to anyone
            // who pressed it the cell read as the one block that would not take
            // an edit.
            if (n.tagName === 'TD' || n.tagName === 'TH') {
              e.preventDefault();
              try { document.execCommand('insertLineBreak'); } catch (err) {}
              return;
            }
            e.preventDefault();
            splitAt(n);
          }
      };
      Object.keys(handlers).forEach(function (k) { n.addEventListener(k, handlers[k]); });
      bound.push({ node: n, handlers: handlers });
    }

    // Turns a list marker typed into an otherwise empty paragraph into semantic
    // list markup. Conversion happens as soon as the marker is complete. If the
    // customary space follows, consume it from the new empty item rather than
    // leaving invisible leading whitespace. Matching the whole block keeps
    // ordinary prose such as "Step 1. review" untouched.
    function autoList(node, id) {
      if (!node || node.tagName !== 'P' || !node.parentNode) return false;
      var raw = (node.textContent || '').replace(/\u00a0/g, ' ');
      var tag = raw === '1.' || raw === '1. ' ? 'OL' :
        (raw === '*' || raw === '* ' ? 'UL' : null);
      if (!tag) return false;
      var awaitsSpace = raw === '1.' || raw === '*';

      var host = node.parentNode;
      var list = document.createElement(tag.toLowerCase());
      var item = document.createElement('li');
      Array.prototype.forEach.call(node.attributes, function (attribute) {
        if (attribute.name === 'contenteditable' || attribute.name === 'spellcheck' ||
            attribute.name === 'class') return;
        item.setAttribute(attribute.name, attribute.value);
      });
      var keep = (node.getAttribute('class') || '').split(/\s+/)
        .filter(function (name) { return name && name.indexOf('ryker-') !== 0; });
      if (keep.length) item.className = keep.join(' ');
      item.innerHTML = '<br>';
      list.appendChild(item);
      node.innerHTML = '<br>';
      Ryker.blocks.transferId(node, item);
      host.replaceChild(list, node);
      rebind(item);
      item.classList.add('ryker-dirty');
      if (awaitsSpace) pendingListSpace.add(item);

      Ryker.history.record({
        label: tag === 'OL' ? 'start ordered list' : 'start unordered list',
        undo: function () {
          pendingListSpace.delete(item);
          if (list.parentNode) list.parentNode.replaceChild(node, list);
          rebind(node);
          place(node, 'start');
        },
        redo: function () {
          if (node.parentNode) node.parentNode.replaceChild(list, node);
          rebind(item);
          if (awaitsSpace) pendingListSpace.add(item);
          place(item, 'start');
        }
      });

      place(item, 'start');
      mark(item, id);
      emit();
      return true;
    }

    function consumeListSpace(node) {
      if (!pendingListSpace.has(node)) return false;
      pendingListSpace.delete(node);
      var raw = (node.textContent || '').replace(/\u00a0/g, ' ');
      if (!/^\s+$/.test(raw)) return false;
      node.innerHTML = '<br>';
      place(node, 'start');
      return true;
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
      // Per history entry. A module-level value made an older split's redo read
      // the most recent split's HTML and silently transplant the wrong paragraph.
      var nodeAfter = node.innerHTML;
      node.parentNode.insertBefore(clone, node.nextSibling);
      Ryker.history.record({
        label: 'split',
        undo: function () {
          if (clone.parentNode) clone.parentNode.removeChild(clone);
          node.innerHTML = nodeBefore;
          place(node, 'end');
        },
        redo: function () {
          node.innerHTML = nodeAfter;
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

      emit();
    }

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

    var BLOCK_TYPES = ['P', 'H1', 'H2', 'H3', 'H4', 'H5'];

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
      Ryker.blocks.transferId(node, made);

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
        // An empty paragraph between headings has nothing to merge. Treating the
        // structural guard as a blanket refusal stranded that paragraph: neither
        // Backspace toward the heading above nor Delete toward the heading below
        // could remove it. Remove only the empty paragraph and leave the heading
        // intact, regardless of which side of the paragraph the caret is on.
        if (node.tagName === 'P' && !Ryker.dom.textOf(node)) {
          var empty = node, emptyAt = node.nextSibling, emptyHost = node.parentNode;
          emptyHost.removeChild(empty);
          Ryker.history.record({
            label: 'delete empty paragraph',
            undo: function () { emptyHost.insertBefore(empty, emptyAt); rebind(empty); },
            redo: function () { if (empty.parentNode) empty.parentNode.removeChild(empty); }
          });
          place(other, dir === 'previous' ? 'end' : 'start');
          emit();
          return true;
        }
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
      resumable = bound.map(function (b) { return b.node; });
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

    function forgetDetachedBindings() {
      bound = bound.filter(function (b) {
        if (b.node.isConnected) return true;
        Object.keys(b.handlers).forEach(function (k) {
          b.node.removeEventListener(k, b.handlers[k]);
        });
        return false;
      });
      resumable = resumable.filter(function (node) { return node.isConnected; });
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
      Ryker.history.captureBaseline(baseline);
      Array.prototype.forEach.call(document.querySelectorAll('.ryker-dirty'), function (n) {
        n.classList.remove('ryker-dirty');
      });
      emit();
    }

    function revertAll() {
      if (!baseline) return;
      Ryker.history.restoreBaseline(baseline, bound.map(function (b) { return b.node; }));
      forgetDetachedBindings();
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
    var baselineNodes = {};
    var baselineBoxes = {};
    var baselineRows = {};

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

    // Discard restores the actual authored nodes rather than reconstructing them
    // from text. These references retain attributes, namespaces, host listeners
    // and removable containers without cloning the whole report per edit.
    function captureBaseline(snapshot) {
      baselineNodes = {};
      baselineBoxes = {};
      baselineRows = {};
      Object.keys(snapshot || {}).forEach(function (id) {
        var node = Ryker.blocks.byId(id);
        if (!node) return;
        baselineNodes[id] = { node: node, parent: node.parentNode, next: node.nextSibling };
        var boxId = snapshot[id] && snapshot[id].box;
        var box = boxId && node.closest ? node.closest('table, figure, ul, ol, dl') : null;
        if (box && !baselineBoxes[boxId]) {
          baselineBoxes[boxId] = { node: box, parent: box.parentNode, next: box.nextSibling };
        }
        // A row is a container in exactly the way a table is, and Discard has to
        // put one back for the same reason. Deleting a row detaches the <tr>, so
        // its cells were restored into an element no longer in the document and
        // disappeared from the report while Discard reported success.
        var rowId = snapshot[id] && snapshot[id].row;
        var row = rowId && node.closest ? node.closest('tr') : null;
        if (row && !baselineRows[rowId]) {
          baselineRows[rowId] = { node: row, parent: row.parentNode, next: row.nextSibling };
        }
      });
    }

    function restoreBaseline(snapshot, armed) {
      flushText();

      // Containers come back before anything is measured. A cell added inside a
      // row and then deleted along with that row is invisible to a snapshot for
      // as long as the row is detached, so it was never counted as an extra and
      // rode back into the document when the row returned. Tables before rows,
      // because a row cannot be restored into a <tbody> that is not in the
      // document yet.
      Object.keys(baselineBoxes).reverse().forEach(function (id) {
        if (!baselineBoxes[id].node.isConnected) restore(baselineBoxes[id]);
      });
      Object.keys(baselineRows).reverse().forEach(function (id) {
        if (!baselineRows[id].node.isConnected) restore(baselineRows[id]);
      });

      var current = Ryker.blocks.snapshot();
      var extras = [];

      Object.keys(current).forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(snapshot, id)) {
          var node = Ryker.blocks.byId(id);
          if (node) extras.push(node);
        }
      });
      (armed || []).forEach(function (node) {
        var id = Ryker.blocks.blockId(node);
        if (node.isConnected && !Object.prototype.hasOwnProperty.call(snapshot, id) &&
            extras.indexOf(node) === -1) extras.push(node);
      });

      function removeExtra(node) {
        var parent = node.parentNode;
        if (!parent) return;
        parent.removeChild(node);
        // An added row's cells are extras; the <tr> holding them is not a block
        // and nothing else would ever remove it, so Discard left an empty stripe
        // across the table.
        if (parent.matches && parent.matches('tr') && !parent.children.length &&
            parent.parentNode && !baselineRows[Ryker.table.rowKey(parent)]) {
          parent.parentNode.removeChild(parent);
          return;
        }
        if (parent.matches && parent.matches('ul, ol, dl') &&
            !parent.querySelector(Ryker.blocks.SELECTOR) && parent.parentNode) {
          parent.parentNode.removeChild(parent);
        }
      }
      function restore(ref) {
        if (!ref || !ref.parent) return;
        var at = ref.next && ref.next.parentNode === ref.parent ? ref.next : null;
        ref.parent.insertBefore(ref.node, at);
      }

      extras.forEach(removeExtra);
      Object.keys(snapshot).reverse().forEach(function (id) {
        var ref = baselineNodes[id];
        if (!ref) return;
        var currentNode = Ryker.blocks.byId(id);
        if (currentNode && currentNode !== ref.node) removeExtra(currentNode);
        if (!snapshot[id].atomic) ref.node.innerHTML = Ryker.blocks.htmlOf(snapshot[id]);
        restore(ref);
        ref.node.classList.remove('ryker-dirty', 'ryker-pick');
        if (!snapshot[id].atomic) Ryker.editable.rebind(ref.node);
      });
      if (Ryker.pick) Ryker.pick.clear();
      clear();
    }

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
        // Form fields and independent editable controls keep their own native undo.
        // Ryker takes over only inside one of the document blocks it armed; doing
        // otherwise makes Ctrl+Z in a link/save dialog mutate the page behind it.
        var path = e.composedPath ? e.composedPath() : [];
        for (var i = 0; i < path.length; i++) {
          var n = path[i];
          if (!n || !n.tagName) continue;
          if (n.tagName === 'TEXTAREA' || n.tagName === 'INPUT' || n.tagName === 'SELECT') return;
          if (n.isContentEditable && !(n.closest && n.closest('.ryker-editing'))) return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (k === 'y' || e.shiftKey) redo(); else undo();
      }, true);
    }

    return {
      record: record, text: text, flush: flushText, undo: undo, redo: redo,
      clear: clear, canUndo: canUndo, canRedo: canRedo, depth: depth,
      isApplying: isApplying, bind: bind, onChange: onChange,
      captureBaseline: captureBaseline, restoreBaseline: restoreBaseline
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

    var node = null, typeBtn = null, killBtn = null, linkBtn = null, gridBtn = null;
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

      // Rows and columns. A menu rather than six buttons, because the bar sits
      // over the words being edited and six more controls would cover them.
      gridBtn = Ryker.icons.button('grid', 'Rows and columns', null, 'fb-btn');
      gridBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      Ryker.menu.attach(gridBtn, function () {
        var cell = tableCell();
        return [
          { label: 'Insert row above', run: function () { Ryker.table.insertRow(cell, 'above'); } },
          { label: 'Insert row below', run: function () { Ryker.table.insertRow(cell, 'below'); } },
          { label: 'Delete row', danger: true, run: function () { Ryker.table.removeRow(cell); } },
          null,
          { label: 'Insert column left', run: function () { Ryker.table.insertColumn(cell, 'left'); } },
          { label: 'Insert column right', run: function () { Ryker.table.insertColumn(cell, 'right'); } },
          { label: 'Delete column', danger: true, run: function () { Ryker.table.removeColumn(cell); } }
        ];
      });

      // Destructive, so it is last, separated, and says how much it will take.
      killBtn = act(null, 'Delete', function () {
        if (!Ryker.multi) return;
        if (Ryker.multi.covered().length) Ryker.multi.removeSelection();
        else Ryker.multi.removeTableAt(currentBlock() || tableCell());
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
        formatParts.concat([gridBtn, d().el('span', { class: 'fb-sep fb-kill-sep' }), killBtn]));
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

    // The cell the caret rests in. Read from the selection rather than from the
    // block, so it is found with nothing selected: reaching for "insert a row"
    // means putting the caret in the table, not highlighting a word first.
    function tableCell() {
      if (!Ryker.editable.isOn() || !Ryker.table) return null;
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      var n = sel.getRangeAt(0).commonAncestorContainer;
      if (n.nodeType === 3) n = n.parentNode;
      if (!n || !n.closest || (Ryker.shell && Ryker.shell.owns(n))) return null;
      var cell = Ryker.table.cellOf(n);
      return cell && Ryker.blocks.root().contains(cell) ? cell : null;
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
      if (Ryker.shell && Ryker.shell.owns(n)) return null;
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
      // A caret parked in a cell with nothing selected is the state someone is in
      // when they want another row. Requiring a selection first made the row and
      // column controls reachable only by highlighting a word one did not intend
      // to change.
      var cell = (!range && !many.length && !link) ? tableCell() : null;
      if (!range && !many.length && !link && !cell) { hide(); return; }
      build();

      if (range) lastRange = range.cloneRange();
      // getRangeAt(0) throws when rangeCount is 0, which is exactly the state a
      // pick leaves behind, so the picked set supplies its own box instead.
      var rect = range ? range.getBoundingClientRect()
               : (link ? link.getBoundingClientRect()
                       : (cell ? cell.getBoundingClientRect() : Ryker.pick.rect()));
      if (!rect || (!rect.width && !rect.height)) { hide(); return; }

      var block = range ? currentBlock() : null;
      var table = Ryker.multi && block ? Ryker.multi.tableAt(block) : null;
      var atomic = many.length === 1 && Ryker.blocks.atomic(many[0]);
      var wide = many.length > 1 || atomic;

      // Four modes. A picked run of blocks gets only Delete, a caret resting in
      // a link gets only the link control, a caret resting in a cell gets only
      // the grid controls, and ordinary selected text gets the formatting set.
      formatParts.forEach(function (n) {
        n.style.display = (wide || cell) ? 'none' : (link && n !== linkBtn ? 'none' : '');
      });
      var grid = cell || (range ? tableCell() : null);
      gridBtn.style.display = grid ? '' : 'none';
      if (link) Ryker.tooltip.attach(linkBtn, 'Edit this link');
      else Ryker.tooltip.attach(linkBtn, 'Link the selected text');
      var show = wide || !!table || !!cell;
      killBtn.style.display = show ? '' : 'none';
      node.querySelector('.fb-kill-sep').style.display = (show && !wide) ? '' : 'none';
      if (show) {
        Ryker.tooltip.attach(killBtn,
          atomic ? 'Delete this whole SVG' :
            (many.length > 1 ? 'Delete the ' + many.length + ' selected blocks' : 'Delete this whole table'));
        Ryker.tooltip.attach(gridBtn, 'Add or remove a row or column');
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

    function inShell(n) { return !!(n && Ryker.shell && Ryker.shell.owns(n)); }
    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

    // elementFromPoint rather than the event target: the target is the node the
    // press began on and stops following the pointer once a drag is under way.
    // Shadow content retargets to its host, so a hit on the Ryker root means one
    // of our own surfaces is in the way and there is no block under the pointer.
    function blockAt(x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el || inShell(el)) return null;
      var b = el.closest ? el.closest(Ryker.blocks.PICK_SELECTOR) : null;
      if (!b || inShell(b)) return null;
      if (Ryker.blocks.excluded(b)) return null;
      if (!Ryker.blocks.atomic(b) && b.querySelector(Ryker.blocks.SELECTOR)) return null;
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
      var list = seq || Ryker.blocks.pickSequence();
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
      var list = seq || (seq = Ryker.blocks.pickSequence());
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
      seq = Ryker.blocks.pickSequence();
      origin = blockNear(e.clientX, e.clientY);
      if (Ryker.blocks.atomic(origin)) {
        e.preventDefault();
        dropNative();
        paint([origin]);
        origin = null;
        pressed = false;
        return;
      }
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
      return !!(node && Ryker.shell && Ryker.shell.owns(node));
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
      if (nodes.length < 2 && !(nodes.length === 1 && Ryker.blocks.atomic(nodes[0]))) return false;
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
          if (path[i] && Ryker.shell && Ryker.shell.owns(path[i])) return;
          if (path[i] && path[i].tagName === 'TEXTAREA') return;
        }
        var picked = Ryker.pick.picked();
        if (picked.length < 2 && !(picked.length === 1 && Ryker.blocks.atomic(picked[0]))) return;
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


  /* ---- editor/table.js ------------------------------------------- */
  // Rows and columns: the one piece of structure Ryker edits.
  //
  // Everything else in the editor treats a table as scenery, on the grounds that
  // a rich-text surface over a report's own markup can break a sort handler that
  // the reader will then blame on the report. A row and a column are the
  // exception the owner asked for, and they are safe in a way that arbitrary
  // structure editing is not: the shape stays rectangular, no attribute the host
  // script reads is touched, and each operation has one obvious inverse.
  //
  // This module also owns the two table facts the rest of Ryker needs and should
  // not have to know how to compute: what identifies a cell, and where a cell
  // goes when a recorded change is replayed into a fresh copy of the document.
  Ryker.table = (function () {
    'use strict';

    var CELL = { TD: 1, TH: 1 };

    // ---- reading the grid ----------------------------------------------------

    function cellOf(node) {
      if (!node || !node.closest) return null;
      var cell = node.closest('td, th');
      return cell && cell.closest('table') ? cell : null;
    }

    function tableOf(node) {
      var cell = cellOf(node);
      return cell ? cell.closest('table') : null;
    }

    // Rows of THIS table. querySelectorAll reaches into a nested one, and a table
    // inside a cell is somebody else's grid.
    function rowsOf(table) {
      return Array.prototype.filter.call(table.querySelectorAll('tr'), function (row) {
        return row.closest('table') === table;
      });
    }

    function cellsOf(row) {
      return Array.prototype.filter.call(row.children, function (n) { return CELL[n.tagName]; });
    }

    function indexOfCell(cell) {
      return cellsOf(cell.parentNode).indexOf(cell);
    }

    // A merged cell breaks the one assumption every operation here rests on:
    // that row N column M names exactly one cell. Rather than guess, the whole
    // feature steps aside and says so, which is the difference between declining
    // and quietly reshaping someone's table.
    function spanned(table) {
      return Array.prototype.some.call(table.querySelectorAll('td, th'), function (c) {
        return (parseInt(c.getAttribute('colspan'), 10) || 1) > 1 ||
               (parseInt(c.getAttribute('rowspan'), 10) || 1) > 1;
      });
    }

    // ---- cell identity -------------------------------------------------------
    //
    // Lives here rather than in blocks.js because it is a fact about grids. A
    // cell with words is identified by them, like every other block. A blank one
    // has none, and numbering the document's blank cells in order is the
    // positional id blocks.js rejected: filling one renumbers the rest, so the
    // next reload resolves a saved edit onto the wrong cell. A cell sits in a
    // grid, so it borrows an identity from the row it is in and the column it is
    // under. Both recompute identically from a freshly loaded file, and neither
    // moves when a different cell is filled in.

    // textContent on a row runs its cells together with no space between them, so
    // ["Beta", "7"] reads as "Beta7" and ["ab", "c"] cannot be told apart from
    // ["a", "bc"]. Both matter here: this text names a row and is part of a blank
    // cell's identity.
    function rowText(row) {
      return cellsOf(row).map(function (cell) {
        return Ryker.dom.textOf(cell);
      }).join(' | ').replace(/(?: \| )+$/, '');
    }

    function seatId(node) {
      if (!CELL[node.tagName]) return null;
      var row = node.closest('tr');
      var grid = node.closest('table');
      if (!row || !grid) return null;
      var col = indexOfCell(node);
      var line = rowText(row);
      if (line) return node.tagName + '|row:' + line.slice(0, 160) + '|col:' + col;
      // A wholly blank row has no text of its own, so the table speaks for it.
      var at = rowsOf(grid).indexOf(row);
      return node.tagName + '|grid:' + Ryker.dom.textOf(grid).slice(0, 160) +
        '|row:' + at + '|col:' + col;
    }

    // The same seat, written for a person rather than hashed.
    function seatLabel(node) {
      if (!CELL[node.tagName]) return null;
      var row = node.closest('tr');
      var grid = node.closest('table');
      if (!row || !grid) return null;
      var col = indexOfCell(node);
      var heads = rowsOf(grid)[0];
      var head = heads && heads !== row ? cellsOf(heads)[col] : null;
      var line = rowText(row);
      return 'cell in column ' + (col + 1) +
        (head && Ryker.dom.textOf(head) ? ' (' + Ryker.dom.textOf(head) + ')' : '') +
        (line ? ', row reading "' + line.slice(0, 40) + '"' : ', row ' + (rowsOf(grid).indexOf(row) + 1));
    }

    // ---- where a cell goes when a change is replayed -------------------------
    //
    // Keyed per node and assigned lazily, exactly like a box key, so it is the
    // same in every snapshot of one row and means nothing across documents.
    var rowKeys = new WeakMap();
    var rowSeq = 0;

    function rowKey(row) {
      if (!row) return null;
      var k = rowKeys.get(row);
      if (!k) { k = 'r' + (++rowSeq); rowKeys.set(row, k); }
      return k;
    }

    // What a snapshot records about a cell beyond its content: which row it is
    // in and which column it is under. Without these an added cell was replayed
    // by inserting it after the block before it, and the block before the first
    // cell of a new row is the LAST cell of the row above, so a restored row
    // arrived spliced onto the end of its predecessor.
    function seatOf(node) {
      if (!node || !CELL[node.tagName]) return null;
      var row = node.closest('tr');
      if (!row) return null;
      return { row: rowKey(row), col: indexOfCell(node) };
    }

    function rowIndex() {
      var rows = {};
      Array.prototype.forEach.call(document.querySelectorAll('tr'), function (row) {
        var k = rowKeys.get(row);
        if (k) rows[k] = row;
      });
      return rows;
    }

    function place(node, c, anchor, context) {
      if (!c.row || String(c.boxTag || '').toUpperCase() !== 'TABLE') return false;
      var grid = c.box && context.boxes[c.box];
      if (!grid) return false;
      context.rows = context.rows || rowIndex();
      var row = context.rows[c.row];
      if (!row) {
        row = document.createElement('tr');
        rowKeys.set(row, c.row);
        context.rows[c.row] = row;
        var beside = anchor && anchor.closest ? anchor.closest('tr') : null;
        if (beside && beside.parentNode && beside.closest('table') === grid) {
          beside.parentNode.insertBefore(row, beside.nextSibling);
        } else {
          (grid.tBodies[0] || grid).appendChild(row);
        }
      }
      var seats = cellsOf(row);
      row.insertBefore(node, (c.col == null ? null : seats[c.col]) || null);
      return true;
    }

    // Removing every cell of a row leaves the <tr> behind as an empty stripe.
    // Runs after the whole-table pass, so a deleted table is never taken apart
    // row by row on the way out.
    function completeRowDeletes(changes, context, tracked) {
      var groups = {}, handled = {};
      (changes || []).forEach(function (change) {
        if (change.kind === 'removed' && change.row) {
          (groups[change.row] = groups[change.row] || []).push(change.id);
        }
      });
      context.rows = context.rows || rowIndex();
      Object.keys(groups).forEach(function (key) {
        var row = context.rows[key];
        if (!row || !row.parentNode) return;
        var inside = tracked.filter(function (block) { return row.contains(block.node); })
          .map(function (block) { return block.id; });
        if (!inside.length || !inside.every(function (id) { return groups[key].indexOf(id) !== -1; })) return;
        row.parentNode.removeChild(row);
        groups[key].forEach(function (id) { handled[id] = true; });
        delete context.rows[key];
      });
      return handled;
    }

    // ---- the operations ------------------------------------------------------

    function refuse(why) {
      if (Ryker.dialog) Ryker.dialog.alert('Cannot change this table', why, 'warn');
      return false;
    }

    function usable(node) {
      var cell = cellOf(node);
      if (!cell) return null;
      var grid = cell.closest('table');
      if (Ryker.blocks.excluded(grid) || (grid.closest && grid.closest('[data-ryker-lock]'))) {
        refuse('This table is marked as not editable, so its rows and columns stay as ' +
          'the document author left them.');
        return null;
      }
      if (spanned(grid)) {
        refuse('This table merges cells with colspan or rowspan. Adding or removing a row ' +
          'or column there would change which cell sits where, so Ryker leaves it alone.');
        return null;
      }
      return cell;
    }

    function blank(tag) {
      var cell = document.createElement(tag.toLowerCase());
      Ryker.blocks.stamp(cell);
      return cell;
    }

    function arm(cells) {
      cells.forEach(function (cell) { if (Ryker.editable) Ryker.editable.rebind(cell); });
    }

    function caretIn(cell) {
      try {
        var r = document.createRange();
        r.selectNodeContents(cell);
        r.collapse(true);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        cell.focus();
      } catch (e) {}
    }

    function commit(label, made, undo, redo) {
      Ryker.history.record({ label: label, undo: undo, redo: redo });
      arm(made);
      if (Ryker.editable) Ryker.editable.touch();
      if (made.length) caretIn(made[0]);
      return true;
    }

    function insertRow(node, side) {
      var cell = usable(node);
      if (!cell) return false;
      var row = cell.parentNode;
      var made = cellsOf(row).map(function (c) { return blank(c.tagName); });
      var fresh = document.createElement('tr');
      made.forEach(function (c) { fresh.appendChild(c); });
      var at = side === 'above' ? row : row.nextSibling;
      var host = row.parentNode;
      host.insertBefore(fresh, at);
      return commit(side === 'above' ? 'insert row above' : 'insert row below', made,
        function () { if (fresh.parentNode) fresh.parentNode.removeChild(fresh); },
        function () { host.insertBefore(fresh, at); arm(made); });
    }

    function removeRow(node) {
      var cell = usable(node);
      if (!cell) return false;
      var row = cell.parentNode;
      var grid = cell.closest('table');
      if (rowsOf(grid).length < 2) {
        return refuse('This is the table\'s only row. Delete the whole table instead, from ' +
          'the toolbar that appears over it.');
      }
      var locked = cellsOf(row).filter(function (c) { return Ryker.blocks.excluded(c); });
      if (locked.length) {
        return refuse('A cell in this row is marked as not editable, so the row stays.');
      }
      var host = row.parentNode, at = row.nextSibling;
      host.removeChild(row);
      return commit('delete row', [],
        function () { host.insertBefore(row, at); arm(cellsOf(row)); },
        function () { if (row.parentNode) row.parentNode.removeChild(row); });
    }

    function insertColumn(node, side) {
      var cell = usable(node);
      if (!cell) return false;
      var grid = cell.closest('table');
      var col = indexOfCell(cell) + (side === 'left' ? 0 : 1);
      var made = [], placed = [];
      rowsOf(grid).forEach(function (row) {
        var seats = cellsOf(row);
        if (!seats.length) return;
        // A header row keeps header cells, so the new column has a heading to be
        // filled in rather than a body cell wearing the header's place.
        var like = seats[Math.min(col, seats.length - 1)];
        var fresh = blank(like.tagName);
        made.push(fresh);
        placed.push({ row: row, node: fresh, before: seats[col] || null });
        row.insertBefore(fresh, seats[col] || null);
      });
      if (!made.length) return false;
      return commit(side === 'left' ? 'insert column left' : 'insert column right', made,
        function () {
          placed.forEach(function (p) { if (p.node.parentNode) p.node.parentNode.removeChild(p.node); });
        },
        function () {
          placed.forEach(function (p) { p.row.insertBefore(p.node, p.before); });
          arm(made);
        });
    }

    function removeColumn(node) {
      var cell = usable(node);
      if (!cell) return false;
      var grid = cell.closest('table');
      var col = indexOfCell(cell);
      if (cellsOf(cell.parentNode).length < 2) {
        return refuse('This is the table\'s only column. Delete the whole table instead, from ' +
          'the toolbar that appears over it.');
      }
      var taken = [];
      var blocked = false;
      rowsOf(grid).forEach(function (row) {
        var seat = cellsOf(row)[col];
        if (!seat) return;
        if (Ryker.blocks.excluded(seat)) blocked = true;
        taken.push({ row: row, node: seat, before: seat.nextSibling });
      });
      if (blocked) {
        return refuse('A cell in this column is marked as not editable, so the column stays.');
      }
      taken.forEach(function (t) { t.row.removeChild(t.node); });
      return commit('delete column', [],
        function () {
          taken.forEach(function (t) { t.row.insertBefore(t.node, t.before); arm([t.node]); });
        },
        function () {
          taken.forEach(function (t) { if (t.node.parentNode) t.node.parentNode.removeChild(t.node); });
        });
    }

    return {
      cellOf: cellOf, tableOf: tableOf, rowsOf: rowsOf, cellsOf: cellsOf,
      rowText: rowText, seatId: seatId, seatLabel: seatLabel, seatOf: seatOf,
      rowKey: rowKey, rowIndex: rowIndex, place: place,
      completeRowDeletes: completeRowDeletes, spanned: spanned,
      insertRow: insertRow, removeRow: removeRow,
      insertColumn: insertColumn, removeColumn: removeColumn
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
  // On the extension surface the page was not authored for Ryker, so the outline
  // is deliberately heading-first. Article scope finds one likely reading region
  // and Full Page shows every visible heading. The drop-in keeps the report row
  // model below: its authored structure is known and every row is operable.
  //
  // Rows nest by heading rank rather than by DOM nesting, because an h3 does not
  // wrap the paragraphs that follow it. Every heading in both reports is a direct
  // child of its section, which is what makes the single-pass stack below correct;
  // tree() checks that and falls back rather than producing a wrong shape.
  Ryker.outline = (function () {
    'use strict';

    var CHROME = { HEADER: 1, FOOTER: 1, NAV: 1, SCRIPT: 1, STYLE: 1, TEMPLATE: 1 };
    var HEADING = /^H([1-6])$/;
    var HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6';
    var scopeMode = null;
    var articleRoot = null;
    var scopeListeners = [];

    function root() { return Ryker.blocks.root(); }

    function rankOf(el) {
      var m = el.tagName.match(HEADING);
      return m ? parseInt(m[1], 10) : 0;
    }

    function visible(el) {
      if (!el || !el.isConnected || (Ryker.shell && Ryker.shell.owns(el)) ||
          el.closest('[hidden],[aria-hidden="true"],template')) return false;
      var n = el;
      while (n && n.nodeType === 1) {
        var s = window.getComputedStyle ? window.getComputedStyle(n) : null;
        if (s && (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse')) return false;
        n = n.parentElement;
      }
      return !el.getClientRects || el.getClientRects().length > 0;
    }

    function visibleHeadings(host) {
      var out = [];
      if (!host) return out;
      if (HEADING.test(host.tagName || '') && visible(host)) out.push(host);
      Array.prototype.forEach.call(host.querySelectorAll(HEADING_SELECTOR), function (h) {
        if (visible(h)) out.push(h);
      });
      return out;
    }

    function articleScore(el) {
      var headings = visibleHeadings(el).length;
      var paragraphs = el.querySelectorAll('p').length;
      var text = Ryker.dom.textOf(el).length;
      var links = el.querySelectorAll('a').length;
      return Math.min(text, 12000) + headings * 700 + paragraphs * 90 - links * 18;
    }

    // Choose the strongest semantic article, then widen just far enough to take
    // in its visible h1. Many publishing systems place the title beside rather
    // than inside <article>; stopping at the first title-bearing ancestor handles
    // that shape without admitting the page header, recommendations or footer.
    function detectArticle() {
      var seen = [], candidates = [];
      Array.prototype.forEach.call(document.querySelectorAll(
        'article,[role="article"],[itemprop~="articleBody"]'), function (el) {
        if (seen.indexOf(el) !== -1 || !visible(el)) return;
        seen.push(el);
        if (visibleHeadings(el).length || el.querySelectorAll('p').length > 1) candidates.push(el);
      });
      candidates.sort(function (a, b) { return articleScore(b) - articleScore(a); });
      var chosen = candidates[0] || null;
      if (!chosen) return null;

      var boundary = document.querySelector('main') || document.body;
      var p = chosen.parentElement;
      while (p && p !== boundary && p !== document.body) {
        var ownsOneArticle = p.querySelectorAll('article,[role="article"]').length <= 1;
        var hasTitle = visibleHeadings(p).some(function (h) { return h.tagName === 'H1'; });
        if (ownsOneArticle && hasTitle) { chosen = p; break; }
        p = p.parentElement;
      }
      return chosen;
    }

    function ensureScope() {
      if (scopeMode) return;
      if (Ryker.SURFACE !== 'extension') { scopeMode = 'document'; return; }
      articleRoot = detectArticle();
      scopeMode = articleRoot && visibleHeadings(articleRoot).length > 1 ? 'article' : 'page';
    }

    function mode() { ensureScope(); return scopeMode; }

    function setMode(next) {
      ensureScope();
      if (Ryker.SURFACE !== 'extension' || (next !== 'article' && next !== 'page')) return false;
      if (next === 'article') articleRoot = detectArticle();
      if (next === 'article' && !articleRoot) return false;
      if (scopeMode === next) return true;
      scopeMode = next;
      scopeListeners.forEach(function (fn) { try { fn(next); } catch (e) {} });
      return true;
    }

    function onScopeChange(fn) { scopeListeners.push(fn); }

    function scopeRoot() {
      ensureScope();
      if (scopeMode === 'article') return articleRoot || detectArticle() || root();
      if (scopeMode === 'page') return document.body;
      return root();
    }

    function scopeLabel() {
      var r = scopeRoot();
      var h = visibleHeadings(r).filter(function (n) { return n.tagName === 'H1'; })[0];
      var label = h ? Ryker.dom.textOf(h) : (r.getAttribute && (r.getAttribute('aria-label') || r.id));
      return clip(label || document.title || (mode() === 'article' ? 'Article' : 'Full page'), 44);
    }

    // Every element the outline is willing to show, in document order.
    function rows() {
      ensureScope();
      if (Ryker.SURFACE === 'extension') return visibleHeadings(scopeRoot());

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
                     key: keyOf(el), editable: blocksIn(el).length > 0, children: [] };
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
      keyOf: keyOf, rowsFor: rowsFor, blocksIn: blocksIn, rankOf: rankOf,
      mode: mode, setMode: setMode, scopeRoot: scopeRoot, scopeLabel: scopeLabel,
      onScopeChange: onScopeChange
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
    // The longest increasing subsequence of runs, weighted by how many BLOCKS each
    // run holds rather than by how many runs are kept.
    //
    // Unweighted this counted runs, and the two are not the same answer. Moving
    // one paragraph from the end of five to the front leaves runs [e] and
    // [a,b,c,d]: one run either way, so the tie fell to whichever came first and
    // the report was "move a, b, c and d after e" instead of "move e to the
    // front". Both produce the same document and only one is readable, and this
    // module exists to give the smallest honest account rather than any true one.
    //
    // Weighting also makes the tie-break meaningful where it used to be arbitrary:
    // the set left alone is the one covering the most of the document.
    function longestRun(vals, weights) {
      var n = vals.length, best = [], from = [], top = -1, i, j;
      for (i = 0; i < n; i++) {
        var w = weights ? weights[i] : 1;
        best[i] = w; from[i] = -1;
        for (j = 0; j < i; j++) {
          if (vals[j] < vals[i] && best[j] + w > best[i]) { best[i] = best[j] + w; from[i] = j; }
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

      var keep = longestRun(
        runs.map(function (r) { return r.start; }),
        runs.map(function (r) { return r.ids.length; }));
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

    // Reapply recorded structural moves without adding them to the current
    // tab's undo stack. Recovery starts from the authored DOM, resolves block
    // ids back to their smallest complete units, then uses the saved predecessor
    // to place those units even when the move crossed container boundaries.
    function replay(records) {
      var applied = 0, missed = 0, unchanged = 0;
      (records || []).forEach(function (record) {
        var ids = Array.isArray(record && record.ids) ? record.ids : [];
        var nodes = nodesOf({ ids: ids });
        if (!ids.length || nodes.length !== ids.length) { missed += 1; return; }
        var elements = cover(nodes);
        if (!elements.length) { missed += 1; return; }

        var target = record.prev ? Ryker.blocks.byId(record.prev) : null;
        var where = record.prev ? 'after' : 'before';
        if (!target) {
          target = Ryker.blocks.sequence().filter(function (candidate) {
            return !elements.some(function (element) {
              return element === candidate || element.contains(candidate);
            });
          })[0] || null;
        }
        if (!target) { missed += 1; return; }

        var why = check(elements, target, where);
        if (why === 'It is already there.') { unchanged += 1; return; }
        if (why) { missed += 1; return; }

        var landingTarget = landing(elements, target);
        var host = landingTarget.parentNode;
        var anchor = where === 'before' ? landingTarget : landingTarget.nextSibling;
        elements.forEach(function (element) { host.insertBefore(element, anchor); });
        applied += 1;
      });
      if (applied) syncNav();
      return { applied: applied, missed: missed, unchanged: unchanged };
    }

    // One step up or down, for the keyboard and for the context menu. Drag is not
    // the only way to reorder a document and should not be the only way here.
    // A heading unit moves past a whole SECTION of the document, not past one
    // element.
    //
    // The sibling immediately above a heading is the LAST paragraph of the
    // section above it, and the sibling immediately below a unit is the NEXT
    // section's heading. Landing against either of those stranded a paragraph:
    // moving "Stop blocking on verification" up put it between the heading and
    // the body of the section above, and left that section's paragraph at the
    // end of the document under someone else's heading. Reproduced on a flat
    // heading-and-paragraph document, 2026-08-18. This is the outline rail's own
    // Move up and Move down, so it was reachable in any document that does not
    // wrap every subsection in its own container.
    //
    // So a move has to land against the far edge of the neighbouring unit: the
    // FIRST element of the unit above going up, the LAST element of the unit
    // below going down.

    // Where one unit stops and the next begins. A SECTION is a unit on its own,
    // and so is a heading at or above the rank being moved. A deeper heading is
    // part of the unit it sits inside and does not open a new one.
    function opensUnit(el, rank) {
      if (!el) return true;
      if (el.tagName === 'SECTION') return true;
      var r = Ryker.outline.rankOf(el);
      return !!r && r <= rank;
    }

    function unitEdge(from, dir, rank) {
      if (!rank) return from;
      var edge = from, n;

      if (dir === 'up') {
        n = from;
        while (n && !opensUnit(n, rank)) {
          if (movable(n)) edge = n;
          n = n.previousElementSibling;
        }
        // A heading opens the unit, so it IS the landing point. A SECTION or the
        // top of the container does not, and the earliest block seen is.
        if (n && n.tagName !== 'SECTION') return n;
        return edge;
      }

      n = from.nextElementSibling;
      while (n && !opensUnit(n, rank)) {
        if (movable(n)) edge = n;
        n = n.nextElementSibling;
      }
      return edge;
    }

    function nudge(nodes, dir) {
      if (!nodes || !nodes.length) return 'There is nothing to move.';
      var n = dir === 'up' ? nodes[0].previousElementSibling
                           : nodes[nodes.length - 1].nextElementSibling;
      while (n && !movable(n)) {
        n = dir === 'up' ? n.previousElementSibling : n.nextElementSibling;
      }
      if (!n) return dir === 'up' ? 'It is already first.' : 'It is already last.';
      n = unitEdge(n, dir, Ryker.outline.rankOf(nodes[0]));
      return apply(nodes, n, dir === 'up' ? 'before' : 'after');
    }

    return {
      between: between, count: count, describe: describe, cover: cover,
      apply: apply, replay: replay, check: check, nudge: nudge, landing: landing,
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

    var node = null, body = null, countEl = null, scopeLabelEl = null;
    var scopeButtons = {};
    var open = false, built = false;
    var closed = {};
    var rebuildTimer = 0;
    var MIN_W = 260, DEFAULT_W = 320;
    var toggleListeners = [];

    function d() { return Ryker.dom; }
    function docId() { return Ryker.config.load().RYKER_DOCUMENT_ID; }
    function closedKey() { return 'ryker:rail-closed:' + docId() + ':' + Ryker.outline.mode(); }
    function extensionClosedKey(mode) {
      return 'preference:rail-closed:' + docId() + ':' + (mode || Ryker.outline.mode());
    }
    function widthKey() { return 'ryker:rail-width'; }

    function loadClosed() {
      var raw = null;
      if (Ryker.SURFACE === 'extension') {
        var mode = Ryker.outline.mode();
        var preferences = Ryker.extensionPreferences || {};
        var saved = preferences.railClosed && preferences.railClosed[mode];
        closed = saved && typeof saved === 'object' ? saved : null;
        if (!closed && Ryker.extensionStorage) {
          Ryker.extensionStorage.get(extensionClosedKey(mode)).then(function (value) {
            if (!value || typeof value !== 'object') return;
            Ryker.extensionPreferences = Ryker.extensionPreferences || {};
            Ryker.extensionPreferences.railClosed = Ryker.extensionPreferences.railClosed || {};
            Ryker.extensionPreferences.railClosed[mode] = value;
            if (Ryker.outline.mode() === mode) {
              closed = value;
              if (built) render();
            }
          }).catch(function (error) {
            if (Ryker.pane) Ryker.pane.flash('Outline state could not be read: ' + error.message, 'warn');
          });
        }
      } else {
        try {
          raw = localStorage.getItem(closedKey());
          closed = raw ? JSON.parse(raw) : null;
        } catch (e) { closed = null; }
      }
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
      if (Ryker.SURFACE === 'extension') {
        Ryker.extensionPreferences = Ryker.extensionPreferences || {};
        Ryker.extensionPreferences.railClosed = Ryker.extensionPreferences.railClosed || {};
        Ryker.extensionPreferences.railClosed[Ryker.outline.mode()] = closed;
        if (Ryker.extensionStorage) {
          Ryker.extensionStorage.set(extensionClosedKey(), closed).catch(function (error) {
            if (Ryker.pane) Ryker.pane.flash('Outline state could not be stored: ' + error.message, 'warn');
          });
        }
        return;
      }
      try { localStorage.setItem(closedKey(), JSON.stringify(closed)); } catch (e) {}
    }

    function storedWidth() {
      var v = 0;
      if (Ryker.SURFACE === 'extension') {
        v = parseInt((Ryker.extensionPreferences || {}).railWidth || '0', 10);
        return v >= MIN_W ? v : DEFAULT_W;
      }
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

      var parts = [
        d().el('div', { class: 'rail-grip', title: 'Drag to resize', tabindex: '0',
                        role: 'separator', 'aria-label': 'Resize the outline' }),
        d().el('header', {}, [
          d().el('h2', { text: 'Outline' }),
          countEl,
          d().el('span', { class: 'spacer' }),
          Ryker.icons.button('close', 'Hide the outline', function () { toggle(false); })
        ])
      ];
      if (Ryker.SURFACE === 'extension') parts.push(buildScope());
      parts.push(body);

      node = d().el('aside', { class: 'rail', role: 'complementary', 'aria-label': 'Ryker outline' }, parts);
      node.style.display = 'none';
      Ryker.shell.add(node);
      initResize();
      initDrag();
      applyWidth(storedWidth());
      render();
      return node;
    }

    function buildScope() {
      scopeButtons.article = d().el('button', { class: 'rk scope-choice', type: 'button', text: 'Article',
        onclick: function () { changeScope('article'); } });
      scopeButtons.page = d().el('button', { class: 'rk scope-choice', type: 'button', text: 'Full page',
        onclick: function () { changeScope('page'); } });
      scopeLabelEl = d().el('div', { class: 'scope-label' });
      return d().el('div', { class: 'rail-scope', role: 'group', 'aria-label': 'Outline scope' }, [
        d().el('div', { class: 'scope-choices' }, [scopeButtons.article, scopeButtons.page]),
        scopeLabelEl
      ]);
    }

    function changeScope(next) {
      if (!Ryker.outline.setMode(next)) {
        if (Ryker.pane) Ryker.pane.flash('No article region was found on this page.', 'warn');
      }
    }

    function syncScope() {
      if (!scopeLabelEl) return;
      var mode = Ryker.outline.mode();
      Object.keys(scopeButtons).forEach(function (name) {
        var button = scopeButtons[name];
        var on = name === mode;
        button.classList.toggle('on', on);
        button.setAttribute('aria-pressed', String(on));
      });
      scopeLabelEl.textContent = (mode === 'article' ? 'Article: ' : 'Page: ') + Ryker.outline.scopeLabel();
    }

    function glyph(kind) {
      return { heading: 'H', section: 'S', table: '▦', figure: '▣',
               quote: '“', list: '≡', text: '¶' }[kind] || '¶';
    }

    function render() {
      if (!built) return;
      body.innerHTML = '';
      syncScope();
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
        role: 'treeitem', tabindex: '-1', draggable: row.editable ? 'true' : 'false',
        // A row that can be dragged has to say so somewhere, and the alternative
        // was a line of instructions in the header taking permanent room to
        // explain a gesture most people will try anyway.
        title: row.editable
          ? 'Drag to move it. Alt with the arrow keys moves it one place. Right-click for more.'
          : 'Navigate to this heading. This area is outside Ryker\'s editable content.',
        'aria-level': String(row.rank || (depth + 1)),
        style: 'padding-left:' + (6 + depth * 13) + 'px'
      }, [
        twisty,
        d().el('span', { class: 'rail-ico', text: glyph(row.kind) }),
        d().el('span', { class: 'rail-label', text: row.label })
      ]);
      el.__row = row;

      el.addEventListener('click', function () { el.focus(); activate(row); });
      if (!row.editable) el.classList.add('navigation-only');
      el.addEventListener('contextmenu', function (e) {
        if (!row.editable) return;
        e.preventDefault();
        e.stopPropagation();
        menuFor(row, e.clientX, e.clientY);
      });
      el.addEventListener('dragstart', function (e) {
        if (!row.editable) { e.preventDefault(); return; }
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
        if (!row.editable) return;
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
      if (row.editable) Ryker.pick.set(blocksOf(Ryker.outline.unitOf(row.el)));
      else Ryker.pick.clear();
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
        if (!el || !el.__row || !el.__row.editable || el.__row === dragging) return;
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

    function applyWidth(px, persist) {
      var max = Math.max(MIN_W, document.documentElement.clientWidth - 320);
      var w = Math.min(Math.max(px, MIN_W), max);
      node.style.width = w + 'px';
      if (persist && Ryker.SURFACE === 'extension') {
        Ryker.extensionPreferences = Ryker.extensionPreferences || {};
        Ryker.extensionPreferences.railWidth = w;
        if (Ryker.extensionStorage) {
          Ryker.extensionStorage.set('preference:rail-width', w).catch(function (error) {
            if (Ryker.pane) Ryker.pane.flash('Outline width could not be stored: ' + error.message, 'warn');
          });
        }
      } else if (persist) {
        try { localStorage.setItem(widthKey(), String(w)); } catch (e) {}
      }
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
      document.addEventListener('mouseup', function () {
        if (dragging) applyWidth(node.getBoundingClientRect().width, true);
        dragging = false;
      });
      grip.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') applyWidth(node.getBoundingClientRect().width + 24, true);
        else if (e.key === 'ArrowLeft') applyWidth(node.getBoundingClientRect().width - 24, true);
        else return;
        e.preventDefault();
      });
    }

    function init() {
      Ryker.pick.onChange(sync);
      Ryker.editable.onChange(scheduleRender);
      Ryker.outline.onScopeChange(function () { loadClosed(); render(); });
    }

    return {
      build: build, init: init, render: render, toggle: toggle, isOpen: isOpen,
      onToggle: onToggle,
      reflow: reflow, sync: sync, applyWidth: applyWidth
    };
  })();


  /* ---- instructions/steps.js ------------------------------------- */
  // One edit, written as one numbered step someone can follow.
  //
  // Split out of instructions.js, which was doing two jobs: working out what
  // changed, and writing English about it. The second job is the one that grows,
  // because every new kind of edit Ryker can make needs a paragraph here that
  // says how to apply it, and the module had reached its line cap with no room
  // for the next one.
  //
  // Everything this needs about the surrounding set arrives in ctx rather than
  // through the namespace, so a step can be written and tested without a live
  // document: where() resolves a block's position, text() flattens HTML to
  // prose, pristine() returns a block as authored, and stepOf/editedAt map a
  // block id to the step number that creates or rewrites it.
  Ryker.steps = (function () {
    'use strict';

    function clip(s, n) {
      n = n || 80;
      return s.length > n ? s.slice(0, n - 3) + '...' : s;
    }

    // Where an inserted block goes. An insert chained off another insert refers
    // to the step that creates it, because the element it follows does not exist
    // in the file yet, and one chained off a rewrite refers to that step rather
    // than quoting wording it has already replaced.
    function afterLine(e, ctx, out) {
      if (e.prev && ctx.stepOf[e.prev]) {
        out.push('Position: immediately after the element added in step ' + ctx.stepOf[e.prev] + '.');
        return;
      }
      if (e.prev && ctx.editedAt[e.prev]) {
        out.push('Position: immediately after the element edited in step ' + ctx.editedAt[e.prev] + '.');
        return;
      }
      if (!e.prev) {
        out.push('Position: as the first block of the document body.');
        return;
      }
      var pw = ctx.where(e.prev);
      out.push('Position: immediately after ' + (pw || 'the preceding block') + '.');
      var ptext = ctx.text(ctx.pristine(e.prev) != null ? ctx.pristine(e.prev) : '');
      if (ptext) out.push('That element begins: "' + clip(ptext) + '"');
    }

    function replaceStep(e, n, ctx, out) {
      var changesTag = e.beforeTag && e.afterTag && e.beforeTag !== e.afterTag;
      var sameContents = e.before === e.after;
      var replacementList = e.afterTag === 'LI' && (e.boxTag === 'OL' || e.boxTag === 'UL');
      if (replacementList) {
        out.push('## ' + n + '. Change <' + e.beforeTag.toLowerCase() + '> to an ' +
          (e.boxTag === 'OL' ? 'ordered' : 'unordered') + ' list');
      } else if (changesTag) {
        out.push('## ' + n + '. Change <' + e.beforeTag.toLowerCase() + '> to <' +
          e.afterTag.toLowerCase() + '>' + (sameContents ? '' : ' and replace its contents'));
      } else {
        out.push('## ' + n + '. Replace the contents of ' +
          (e.tag ? '<' + e.tag.toLowerCase() + '>' : 'a block'));
      }
      out.push('');
      var w = ctx.where(e.id);
      if (w) out.push('Position: ' + w);
      out.push('');
      if (changesTag && sameContents) {
        out.push('Keep the element\'s contents and attributes unchanged. Its current contents are:');
        out.push('<<<'); out.push(e.before); out.push('>>>');
        return;
      }
      out.push('FROM:');
      out.push('<<<'); out.push(e.before); out.push('>>>');
      out.push('');
      out.push('TO:');
      out.push('<<<'); out.push(e.after); out.push('>>>');
      out.push('');
      out.push('Plain text of the new version, for confirmation:');
      out.push('  ' + ctx.text(e.after));
    }

    function insertStep(e, n, ctx, out) {
      var tag = (e.tag || 'p').toLowerCase();
      var insertedList = tag === 'li' && (e.boxTag === 'OL' || e.boxTag === 'UL');
      if (insertedList) {
        out.push('## ' + n + '. Insert a new ' + (e.boxTag === 'OL' ? 'ordered' : 'unordered') +
          ' list (<' + e.boxTag.toLowerCase() + '>) containing one <li>');
      } else {
        out.push('## ' + n + '. Insert a new <' + tag + '>');
      }
      out.push('');
      afterLine(e, ctx, out);
      out.push('');
      out.push('CONTENT:');
      out.push('<<<');
      out.push(insertedList ? '<' + e.boxTag.toLowerCase() + '><li>' + e.after + '</li></' +
        e.boxTag.toLowerCase() + '>' : e.after);
      out.push('>>>');
      out.push('');
      out.push('Plain text, for confirmation:');
      out.push('  ' + ctx.text(e.after));
    }

    function deleteBoxStep(e, n, ctx, out) {
      out.push('## ' + n + '. Delete a whole <table>');
      out.push('');
      if (e.position) {
        out.push('Position: the <table> containing ' + e.position + '.');
        out.push('');
      }
      out.push('Remove the entire <table> element, its rows and its cells. Leave any');
      out.push('caption, heading or paragraph around it alone unless another step names');
      out.push('it. The table is the one whose cells read, in order:');
      out.push('');
      e.cells.forEach(function (c, k) {
        out.push('  ' + (k + 1) + '. ' + clip(ctx.text(c), 90));
      });
    }

    function deleteAtomicStep(e, n, ctx, out) {
      out.push('## ' + n + '. Delete the whole <svg>');
      out.push('');
      var sw = ctx.where(e.id);
      if (sw) { out.push('Position: ' + sw); out.push(''); }
      out.push('Remove the entire SVG element, including all paths, shapes, labels and attributes.');
      out.push('Leave its surrounding container and adjacent content unchanged. Match this exact element:');
      out.push('<<<'); out.push(e.before); out.push('>>>');
    }

    function deleteStep(e, n, ctx, out) {
      out.push('## ' + n + '. Delete a block');
      out.push('');
      var dw = ctx.where(e.id);
      if (dw) {
        out.push('Position: ' + dw);
        out.push('');
      }
      out.push('Remove the element whose exact contents are:');
      out.push('<<<'); out.push(e.before); out.push('>>>');
      out.push('');
      out.push('Plain text, for confirmation:');
      out.push('  ' + ctx.text(e.before));
    }

    // ---- rows and columns ----------------------------------------------------
    //
    // A row and a column are not blocks, so a snapshot sees each of them as a
    // handful of cells appearing or disappearing at once. Written that way the
    // instructions were not merely verbose, they were wrong: "insert a <td>
    // after this one" puts the cell in the row above the one it belongs to, and
    // three of those rebuild a row nobody asked for. Grouped, the step says the
    // one thing that has to happen to the source.

    function rowOf(cells) {
      return cells.map(function (c) { return c.html; });
    }

    function markup(tag, cells) {
      return '<tr>' + cells.map(function (c) {
        return '<' + tag + '>' + c.html + '</' + tag + '>';
      }).join('') + '</tr>';
    }

    function addRowStep(e, n, ctx, out) {
      var tag = e.cellTag === 'TH' ? 'th' : 'td';
      out.push('## ' + n + '. Insert a new table row');
      out.push('');
      if (e.position) out.push('Position: in the <table> containing ' + e.position + '.');
      if (e.afterRow) out.push('Put it immediately after the row reading: ' + e.afterRow);
      else out.push('Put it as the first row of its row group.');
      out.push('');
      out.push('Insert one <tr> holding ' + e.cells.length + ' <' + tag + '> cell(s), in this order:');
      out.push('<<<');
      out.push(markup(tag, e.cells));
      out.push('>>>');
      out.push('');
      out.push('Plain text of the new row, for confirmation:');
      out.push('  ' + rowOf(e.cells).map(function (h) { return ctx.text(h) || '(blank)'; }).join(' | '));
    }

    function deleteRowStep(e, n, ctx, out) {
      out.push('## ' + n + '. Delete a table row');
      out.push('');
      if (e.position) out.push('Position: in the <table> containing ' + e.position + '.');
      out.push('');
      out.push('Remove one whole <tr> and every cell inside it. Change no other row.');
      out.push('It is the row whose cells read, in order:');
      out.push('');
      e.cells.forEach(function (c, k) {
        out.push('  ' + (k + 1) + '. ' + (clip(ctx.text(c.html), 90) || '(blank)'));
      });
    }

    function addColumnStep(e, n, ctx, out) {
      out.push('## ' + n + '. Insert a new table column');
      out.push('');
      if (e.position) out.push('Position: in the <table> containing ' + e.position + '.');
      out.push('Insert it as column ' + (e.col + 1) + ', counting from 1 at the left, in');
      out.push('every row of the table including the header.');
      out.push('');
      out.push('Add one cell to each row, in row order, using <th> in a header row and');
      out.push('<td> elsewhere:');
      out.push('');
      e.cells.forEach(function (c, k) {
        out.push('  ' + (k + 1) + '. <' + (c.tag === 'TH' ? 'th' : 'td') + '>' + c.html +
          '</' + (c.tag === 'TH' ? 'th' : 'td') + '>');
      });
    }

    function deleteColumnStep(e, n, ctx, out) {
      out.push('## ' + n + '. Delete a table column');
      out.push('');
      if (e.position) out.push('Position: in the <table> containing ' + e.position + '.');
      out.push('Remove column ' + (e.col + 1) + ', counting from 1 at the left, from every');
      out.push('row of the table including the header. Leave every other column alone.');
      out.push('');
      out.push('The cells being removed read, in row order:');
      out.push('');
      e.cells.forEach(function (c, k) {
        out.push('  ' + (k + 1) + '. ' + (clip(ctx.text(c.html), 90) || '(blank)'));
      });
    }

    // ---- collapsing cell edits back into the operation that made them --------
    //
    // A snapshot only ever sees blocks, so inserting one row of three cells
    // arrives as three unrelated insertions and deleting one arrives as three
    // deletions. Written out that way the set is not just long: it is wrong.
    // "Insert a <td> after this one" puts the cell in the row above the one it
    // belongs to, and three of those build a row nobody asked for. Here the
    // cells are put back together into the single operation a person performed,
    // which is also the single edit the source file needs.

    function rowsIn(snap) {
      var rows = {};
      Object.keys(snap || {}).forEach(function (id) {
        var e = snap[id];
        if (!e || typeof e !== 'object' || !e.row) return;
        (rows[e.row] = rows[e.row] || []).push(id);
      });
      Object.keys(rows).forEach(function (key) {
        rows[key].sort(function (a, b) { return (snap[a].col || 0) - (snap[b].col || 0); });
      });
      return rows;
    }

    function cellsFrom(ids, snap, held) {
      return ids.map(function (id) {
        var e = snap[id] || {};
        return { html: held[id] != null ? held[id] : (e.html || ''), tag: e.tag || 'TD', id: id };
      });
    }

    function rowLabel(ids, snap, ctx) {
      return ids.map(function (id) {
        return ctx.text((snap[id] || {}).html || '') || '(blank)';
      }).join(' | ');
    }

    // Rows whose every cell is in the change set, and which the other snapshot
    // does not know about at all. Both halves matter: a row that merely lost all
    // its text is not a row that was deleted.
    function wholeRows(kind, list, from, to) {
      var seen = {}, found = {};
      list.forEach(function (e, i) {
        if (e.kind !== kind || !e.row) return;
        (seen[e.row] = seen[e.row] || []).push(i);
      });
      var fromRows = rowsIn(from), toRows = rowsIn(to);
      Object.keys(seen).forEach(function (key) {
        if (toRows[key] || !fromRows[key]) return;
        if (fromRows[key].length !== seen[key].length) return;
        found[key] = seen[key];
      });
      return found;
    }

    // Cells at one column index across two or more rows that survive on both
    // sides. A column operation touches every row; one cell at that index is an
    // ordinary block edit and stays one.
    function wholeColumns(kind, list, taken, from, to) {
      var seen = {}, found = {};
      list.forEach(function (e, i) {
        if (e.kind !== kind || e.col == null || !e.row || taken[e.row]) return;
        (seen[e.col] = seen[e.col] || []).push(i);
      });
      var fromRows = rowsIn(from), toRows = rowsIn(to);
      Object.keys(seen).forEach(function (col) {
        var rows = seen[col].map(function (i) { return list[i].row; });
        var spread = rows.filter(function (r, k) { return rows.indexOf(r) === k; });
        if (spread.length < 2) return;
        if (!spread.every(function (r) { return fromRows[r] && toRows[r]; })) return;
        found[col] = seen[col];
      });
      return found;
    }

    function group(list, before, after, ctx) {
      var beforeRows = rowsIn(before), afterRows = rowsIn(after);
      var held = {};
      list.forEach(function (e) { if (e.kind === 'insert') held[e.id] = e.after; });

      var goneRows = wholeRows('delete', list, before, after);
      var newRows = wholeRows('insert', list, after, before);
      var goneCols = wholeColumns('delete', list, goneRows, before, after);
      var newCols = wholeColumns('insert', list, newRows, after, before);
      if (!Object.keys(goneRows).length && !Object.keys(newRows).length &&
          !Object.keys(goneCols).length && !Object.keys(newCols).length) return list;

      var out = [], done = {};
      list.forEach(function (e, i) {
        var rowKey = e.row;
        var colKey = e.col == null ? null : String(e.col);

        if (rowKey && goneRows[rowKey] && e.kind === 'delete') {
          if (done['r' + rowKey]) return;
          done['r' + rowKey] = true;
          out.push({ kind: 'deleterow', position: ctx.where(e.id),
            cells: cellsFrom(beforeRows[rowKey], before, held) });
          return;
        }
        if (rowKey && newRows[rowKey] && e.kind === 'insert') {
          if (done['a' + rowKey]) return;
          done['a' + rowKey] = true;
          var ids = afterRows[rowKey];
          var above = (after[ids[0]] || {}).prev;
          var aboveRow = above && after[above] ? after[above].row : null;
          out.push({ kind: 'addrow',
            position: above ? ctx.where(above) : ctx.where(e.id),
            afterRow: aboveRow && afterRows[aboveRow]
              ? '"' + rowLabel(afterRows[aboveRow], after, ctx) + '"' : null,
            cellTag: (after[ids[0]] || {}).tag || 'TD',
            cells: cellsFrom(ids, after, held) });
          return;
        }
        if (colKey !== null && goneCols[colKey] && e.kind === 'delete' && !goneRows[rowKey]) {
          if (done['dc' + colKey]) return;
          done['dc' + colKey] = true;
          out.push({ kind: 'delcol', col: e.col, position: ctx.where(e.id),
            cells: goneCols[colKey].map(function (j) {
              return { html: list[j].before, tag: list[j].tag || 'TD' };
            }) });
          return;
        }
        if (colKey !== null && newCols[colKey] && e.kind === 'insert' && !newRows[rowKey]) {
          if (done['ac' + colKey]) return;
          done['ac' + colKey] = true;
          // Positioned by the cell it follows, never by itself. A new cell has no
          // place in the file being edited, so "the 3rd <th>" counted a column
          // that only exists on screen and sent the reader looking for it.
          out.push({ kind: 'addcol', col: e.col,
            position: e.prev ? ctx.where(e.prev) : null,
            cells: newCols[colKey].map(function (j) {
              return { html: list[j].after, tag: list[j].tag || 'TD' };
            }) });
          return;
        }
        out.push(e);
      });
      return out;
    }

    function write(e, n, ctx, out) {
      if (e.kind === 'replace') return replaceStep(e, n, ctx, out);
      if (e.kind === 'insert') return insertStep(e, n, ctx, out);
      if (e.kind === 'deletebox') return deleteBoxStep(e, n, ctx, out);
      if (e.kind === 'addrow') return addRowStep(e, n, ctx, out);
      if (e.kind === 'deleterow') return deleteRowStep(e, n, ctx, out);
      if (e.kind === 'addcol') return addColumnStep(e, n, ctx, out);
      if (e.kind === 'delcol') return deleteColumnStep(e, n, ctx, out);
      if (e.kind === 'delete' && e.atomic && String(e.tag).toUpperCase() === 'SVG') {
        return deleteAtomicStep(e, n, ctx, out);
      }
      return deleteStep(e, n, ctx, out);
    }

    return { write: write, group: group, clip: clip };
  })();


  /* ---- instructions/instructions.js ------------------------------ */
  // Turns a session's edits into a prompt an AI can act on.
  //
  // The prompt describes authored-to-current differences in source terms. Saved
  // rounds may also persist the same data for recovery and explicit export, but
  // instructions never rely on Ryker's runtime-only block ids as user locators.
  Ryker.instructions = (function () {
    'use strict';

    var pristine = null; // blockId -> html as the document was authored
    var saved = null;    // blockId -> html as of the last save
    var saves = 0;
    var saveNotes = [];
    var baseline = null;
    var session = null;  // one page load; scopes cumulative revision records
    var recovery = null; // stable in one tab so a refresh can find its draft
    var pristinePositions = {};
    var listeners = [];

    function tabSession() {
      var fresh = Ryker.dom.uid('session');
      if (Ryker.SURFACE === 'extension') return fresh;
      var key = 'ryker:session:' + Ryker.config.load().RYKER_DOCUMENT_ID;
      try {
        var saved = sessionStorage.getItem(key);
        if (saved) return saved;
        sessionStorage.setItem(key, fresh);
      } catch (e) { /* an in-memory id still keeps this page load safe */ }
      return fresh;
    }

    function captureOrigin() {
      pristine = Ryker.blocks.snapshot();
      baseline = null;
      pristinePositions = {};
      Object.keys(pristine).forEach(function (id) {
        pristinePositions[id] = placeOf(Ryker.blocks.byId(id));
      });
      recovery = tabSession();
      session = Ryker.dom.uid('edit');
      return Object.keys(pristine).length;
    }

    // Content-derived identity for the authored FROM state. Session identity is
    // separate because independent tabs can start from identical content.
    function baselineId() {
      if (baseline) return baseline;
      if (!pristine) return null;
      var keys = Object.keys(pristine);
      var parts = keys.map(function (k, i) {
        var p = pristine[k] || {};
        return [i, k, String(p.tag || '').toUpperCase(), p.prev || '',
          String(p.boxTag || '').toUpperCase(), p.atomic ? '1' : '0',
          Ryker.blocks.htmlOf(p)].join('\u0000');
      });
      baseline = Ryker.blocks.hash(parts.join('\u0001'));
      return baseline;
    }

    function sessionId() { return recovery; }
    function editingSessionId() { return session; }

    function pristineHtml(id) {
      if (!pristine || !Object.prototype.hasOwnProperty.call(pristine, id)) return undefined;
      return Ryker.blocks.htmlOf(pristine[id]);
    }

    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

    function reset() { saved = null; saves = 0; saveNotes = []; emit(); }
    function originalOf(id) { return pristineHtml(id); }
    function saveCount() { return saves; }

    // Recomputed from the document, not accumulated. Accumulating each save's
    // changes meant the set could describe blocks that no longer existed.
    function record(note) {
      saved = Ryker.blocks.snapshot();
      saves += 1;
      note = String(note || '').trim();
      if (note) saveNotes.push({ saveNumber: saves, text: note });
      emit();
    }

    function notes() {
      return saveNotes.map(function (n) { return { saveNumber: n.saveNumber, text: n.text }; });
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
          tag: c.tag || null, beforeTag: c.beforeTag || null,
          afterTag: c.afterTag || c.tag || null, prev: c.prev || null,
          atomic: !!c.atomic, box: c.box || null, boxTag: c.boxTag || null,
          row: c.row || null, col: c.col == null ? null : c.col
        };
      });
    }

    // The complete replayable delta from the authored document to what is on
    // screen now. Unlike edits(), this does not stop at the last Save boundary,
    // so it can checkpoint both saved rounds and typing still in progress for
    // recovery after a refresh.
    function recoveryChanges() {
      if (!pristine) return [];
      return Ryker.blocks.diffSnapshots(pristine, Ryker.blocks.snapshot());
    }

    function recoveryMoves() {
      if (!pristine) return [];
      return Ryker.move.between(pristine, Ryker.blocks.snapshot()).map(function (move) {
        return {
          kind: 'move', ids: move.ids.slice(),
          prev: move.prev || null, wasAfter: move.wasAfter || null
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
        var first = list[whole[e.box][0]];
        out.push({
          kind: 'deletebox', tag: 'TABLE',
          position: first && first.id && where(first.id),
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

    // Host-authored metadata lives outside the literal FROM/TO fences. Keep it
    // on one line and JSON-quote it so an id, title or path containing Markdown
    // cannot manufacture a new instruction section.
    function oneLine(value) {
      return String(value == null ? '' : value).replace(/[\r\n\u2028\u2029]+/g, ' ')
        .replace(/\s+/g, ' ').trim();
    }

    function quoted(value) { return JSON.stringify(oneLine(value)); }

    // Where a block is, said in terms the source file actually contains.
    //
    // Ryker's own ids are derived from content or stamped at runtime, so neither
    // appears in the HTML being edited and neither can be used to find anything.
    // A real id attribute is used when the element has one; otherwise the block is
    // located by its position inside the nearest section that does.
    function where(id) {
      if (Object.prototype.hasOwnProperty.call(pristinePositions, id)) {
        return pristinePositions[id];
      }
      return placeOf(Ryker.blocks.byId(id));
    }

    function placeOf(node) {
      if (!node) return null;
      if (node.id) return 'the element with id=' + quoted(node.id);

      var scope = node.parentElement;
      while (scope && !scope.id && scope !== document.body) scope = scope.parentElement;
      var scopeName = scope && scope.id ? 'the section with id=' + quoted(scope.id) : 'the document body';
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
      return label ? 'That element is described as ' + quoted(label) + '.' : null;
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
        at.nav.forEach(function (t2) { out.push('  - ' + quoted(t2)); });
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
      // Whole tables first, then the rows and columns inside the ones that
      // survived. Reversing the two would take a deleted table apart row by row.
      var list = Ryker.steps.group(groupBoxes(edits()), pristine, saved,
        { where: where, text: text });
      var mv = moves();
      var out = [];

      out.push('# Document edit instructions');
      out.push('');
      out.push('Document: ' + quoted(document.title || cfg.RYKER_DOCUMENT_ID));
      out.push('File: ' + quoted(cfg.RYKER_DOCUMENT_PATH));
      out.push('Edits: ' + list.length + ' change(s)' +
        (mv.length ? ' and ' + mv.length + ' move(s)' : '') +
        ' across ' + saves + ' save(s) this session');
      out.push('');

      if (saveNotes.length) {
        out.push('## Context supplied with saves');
        out.push('');
        out.push('These optional notes explain the intent behind individual save rounds.');
        out.push('');
        saveNotes.forEach(function (note) {
          out.push('### Save ' + note.saveNumber);
          out.push('');
          String(note.text).split(/\r?\n/).forEach(function (line) {
            out.push('> ' + line);
          });
          out.push('');
        });
      }

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
      out.push('Locate each element using both its quoted FROM text and its Position.');
      out.push('The FROM text is exact but may also occur in another element. Position is');
      out.push('therefore part of the selector, not merely a cross-check. Replace');
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

      // Every function a step needs to describe the set it belongs to. Passed in
      // rather than reached for, so instructions/steps.js can be read, changed
      // and reasoned about without a live document behind it.
      var ctx = { where: where, text: text, pristine: pristineHtml,
                  stepOf: stepOf, editedAt: editedAt };
      list.forEach(function (e, i) {
        out.push('---');
        out.push('');
        Ryker.steps.write(e, base + i + 1, ctx, out);
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
      sessionId: sessionId, editingSessionId: editingSessionId,
      recoveryChanges: recoveryChanges, recoveryMoves: recoveryMoves,
      saveCount: saveCount, saveNotes: notes,
      onChange: onChange, where: where, suspicious: suspicious
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

    // A baseline identifies the source text, not the browser session. Two tabs
    // opened over the same unchanged source share a baseline and may contain
    // unrelated edits. Only an explicitly recorded session id permits one saved
    // round to supersede another.
    function groupKey(rec) {
      return (rec.documentId || '') + ' ' + (rec.sessionId || '') + ' ' + (rec.baselineId || '');
    }

    function editsOf(rec) {
      return Array.isArray(rec && rec.edits) ? rec.edits : [];
    }

    function notesOf(rec) {
      if (Array.isArray(rec && rec.saveNotes)) return rec.saveNotes;
      if (rec && rec.saveNote) {
        return [{ saveNumber: rec.saveNumber || null, text: rec.saveNote }];
      }
      return [];
    }

    function norm(html) {
      if (html == null) return '';
      return String(html).replace(/\s+/g, ' ').trim();
    }

    function beforeTag(edit) {
      return String(edit.beforeTag || (edit.kind === 'insert' ? '' : edit.tag) || '').toUpperCase();
    }

    function afterTag(edit) {
      return String(edit.afterTag || edit.tag || '').toUpperCase();
    }

    function stateKey(html, tag) { return String(tag || '').toUpperCase() + '|' + norm(html); }

    function sameTarget(a, b) {
      var ap = a && a.position ? norm(a.position) : '';
      var bp = b && b.position ? norm(b.position) : '';
      var ai = a && a.id ? String(a.id) : '';
      var bi = b && b.id ? String(b.id) : '';
      // Legacy records can carry no target metadata. Preserve their old
      // content-only composition, but never equate one known target with another
      // known or unknown target.
      if (!ap && !bp && !ai && !bi) return true;
      if (ap && bp && ap === bp) return true;
      if (ai && bi && ai === bi) return true;
      return false;
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

    // One entry per explicit session, each holding the latest cumulative record
    // for that session. Legacy records without a session id remain independent;
    // content composition below can still relate them without discarding one.
    function collapse(records) {
      var groups = [];
      var byKey = {};

      chronological(records).forEach(function (rec) {
        var scoped = !!rec.sessionId;
        var key = scoped ? groupKey(rec) : ('@unscoped:' + groups.length);
        var g = byKey[key];
        if (!g) {
          g = byKey[key] = {
            key: key,
            baselineId: rec.baselineId || null,
            documentId: rec.documentId || null,
            winner: rec,
            superseded: [],
            sessionId: rec.sessionId || null,
            inferred: !scoped
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
        var fromText = norm(e.before);
        var from = stateKey(e.before, beforeTag(e));
        var to = stateKey(e.after, afterTag(e));

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
                 sameTarget(a.step, e) &&
                 stateKey(a.step.before, beforeTag(a.step)) === from &&
                 stateKey(a.step.after, afterTag(a.step)) === to;
        });
        if (same) { group.duplicated = (group.duplicated || 0) + 1; return; }

        if (e.kind === 'insert' || !fromText) {
          acc.push({ step: e, origin: group });
          return;
        }

        // Does this continue something already in the set?
        var chained = null;
        for (var i = acc.length - 1; i >= 0; i--) {
          if (sameTarget(acc[i].step, e) &&
              stateKey(acc[i].step.after, afterTag(acc[i].step)) === from) {
            chained = acc[i]; break;
          }
        }
        if (chained) {
          // An element inserted in one record and deleted in a later record has
          // no net instruction. Remove the earlier insert instead of emitting an
          // empty Insert step.
          if (chained.step.kind === 'insert' && e.kind === 'delete' && !norm(e.after)) {
            acc.splice(acc.indexOf(chained), 1);
            group.cancelled = (group.cancelled || 0) + 2;
            return;
          }
          chained.step = {
            kind: chained.step.kind === 'insert' ? 'insert' : e.kind,
            tag: e.tag || chained.step.tag,
            beforeTag: chained.step.beforeTag || beforeTag(chained.step) || null,
            afterTag: e.afterTag || afterTag(e) || null,
            before: chained.step.before,
            after: e.after,
            id: e.id || chained.step.id || null,
            position: e.position || chained.step.position
          };
          chained.composedFrom = (chained.composedFrom || 1) + 1;
          group.composed = (group.composed || 0) + 1;
          return;
        }

        // First time this text has been touched in the fold. That is normal for
        // the first group, and for a later group it means the edit is against
        // text the earlier groups never changed, which is still fine.
        var seenBefore = acc.some(function (a) {
          return sameTarget(a.step, e) &&
            stateKey(a.step.before, beforeTag(a.step)) === from;
        });
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
      var cancelled = groups.reduce(function (n, g) { return n + (g.cancelled || 0); }, 0);

      // A record can carry the prose prompt and no structured pairs behind it.
      // Backfilled records are the case: 17 in the corpus, only 14 structured
      // edits between them. They cannot be folded and saying nothing about them
      // would present a partial result as a complete one.
      var promptOnly = list.filter(function (r) { return !editsOf(r).length; }).length;
      var notes = [];
      groups.forEach(function (g) {
        notesOf(g.winner).forEach(function (note) {
          var text = String(note && note.text || '').trim();
          if (!text) return;
          notes.push({ saveNumber: note.saveNumber || null, text: text });
        });
      });

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
          'same recorded editing session superseded them.');
      }
      if (groups.length > 1) {
        warnings.push(groups.length + (inferred
          ? ' record group(s) were folded together, with relationships inferred from content '
            + 'because the records do not say which belong to the same session.'
          : ' separate editing sessions were folded together.'));
      }
      if (inferred) {
        warnings.push('Some records predate session tracking, so relationships between them are ' +
          'inferred from content rather than recorded. Check the result before applying it.');
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
        cancelled: cancelled,
        supersededEdits: groups.reduce(function (n, g) {
          return n + g.superseded.reduce(function (m, r) { return m + editsOf(r).length; }, 0);
        }, 0)
      };

      return {
        steps: acc.map(function (a) { return a.step; }),
        groups: groups,
        superseded: superseded,
        duplicated: duplicated,
        cancelled: cancelled,
        promptOnly: promptOnly,
        notes: notes,
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
      if (r.notes && r.notes.length) {
        out.push('## Context supplied with saves');
        out.push('');
        r.notes.forEach(function (note) {
          out.push('Save' + (note.saveNumber ? ' ' + note.saveNumber : '') + ':');
          String(note.text).split(/\r?\n/).forEach(function (line) { out.push('> ' + line); });
          out.push('');
        });
      }
      out.push('---');
      out.push('');
      r.steps.forEach(function (s, i) {
        var changesTag = s.kind === 'replace' && beforeTag(s) && afterTag(s) &&
          beforeTag(s) !== afterTag(s);
        if (changesTag) {
          out.push('## ' + (i + 1) + '. Change <' + beforeTag(s).toLowerCase() + '> to <' +
            afterTag(s).toLowerCase() + '>');
        } else {
          out.push('## ' + (i + 1) + '. ' + (s.kind === 'insert' ? 'Insert' :
            s.kind === 'delete' ? 'Delete' : 'Replace') + ' <' + (s.tag || '?').toLowerCase() + '>');
        }
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


  /* ---- storage/fs.js --------------------------------------------- */
  // The one boundary around browser file access and persisted handles.
  //
  // The logger used to own a second copy of the picker, IndexedDB transaction,
  // directory traversal, read, write, list and remove code. Besides drifting, that
  // made the extension impossible: a content script's IndexedDB belongs to the
  // host page. The persistence adapter below can be replaced by an
  // extension-owned store while every filesystem consumer keeps the same API.
  Ryker.fs = (function () {
    'use strict';

    var DB = 'ryker', STORE = 'handles';
    var root = null;

    // Extension records cross the isolated-world boundary as validated messages
    // to the service worker. Values here are JSON data, never filesystem handles:
    // Chrome versions using JSON extension messaging would turn a handle into an
    // empty object. A granted folder therefore remains useful for this tab while
    // revisions, recovery and preferences live durably in the extension store.
    function extensionRequest(operation, key, value) {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        return Promise.reject(new Error('Ryker extension storage is unavailable.'));
      }
      var message = { channel: 'ryker.storage.v1', version: 1, operation: operation };
      // usage asks about the sender's own document, so it deliberately carries no
      // key for the worker to have to second-guess.
      if (operation !== 'usage') message.key = key;
      if (operation === 'set') message.value = value;
      return chrome.runtime.sendMessage(message).then(function (response) {
        if (!response || response.ok !== true) {
          var detail = response && response.error || {};
          var error = new Error(detail.message || 'Ryker extension storage rejected the operation.');
          error.code = detail.code || 'storage-failed';
          throw error;
        }
        return response.value;
      });
    }

    function installExtensionStorage() {
      if (Ryker.SURFACE !== 'extension') return null;
      var api = {
        get: function (key) { return extensionRequest('get', key); },
        set: function (key, value) { return extensionRequest('set', key, value); },
        remove: function (key) { return extensionRequest('remove', key); },
        list: function (prefix) { return extensionRequest('list', prefix); },
        usage: function () { return extensionRequest('usage'); }
      };
      Ryker.extensionStorage = api;
      Ryker.extensionPreferences = Ryker.extensionPreferences || {};
      connectWorkspacePort();
      [
        ['saveNotes', 'preference:save-notes'],
        ['paneWidth', 'preference:pane-width'],
        ['railWidth', 'preference:rail-width']
      ].forEach(function (pair) {
        api.get(pair[1]).then(function (value) {
          if (value !== null && value !== undefined) {
            Ryker.extensionPreferences = Ryker.extensionPreferences || {};
            Ryker.extensionPreferences[pair[0]] = value;
          }
        }).catch(function () { /* boot remains usable; writes surface their own error */ });
      });
      return api;
    }

    // tabs.sendMessage only reaches content scripts, not an extension-owned tab.
    // The workspace therefore opens a named runtime Port. Its sender carries the
    // owning tab id, allowing the worker to toggle exactly the clicked workspace
    // without reloading the HTML/Markdown document held in that tab.
    function connectWorkspacePort() {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connect ||
          !chrome.runtime.getURL || location.href.indexOf(chrome.runtime.getURL('workspace.html')) !== 0) return;
      var stopped = false;
      function connect() {
        if (stopped) return;
        var port;
        try { port = chrome.runtime.connect({ name: 'ryker.workspace.v1' }); }
        catch (error) { return; }
        port.onMessage.addListener(function (message) {
          if (!message || message.channel !== 'ryker.workspace.v1' || message.action !== 'toggle') return;
          var state = 'workspace-ready';
          if (Ryker.boot && Ryker.boot.isOpen && Ryker.boot.isOpen()) {
            state = Ryker.boot.toggle() ? 'mounted' : 'closed';
          } else if (Ryker.boot && Ryker.boot.toggle && Ryker.shell && Ryker.shell.host()) {
            state = Ryker.boot.toggle() ? 'mounted' : 'closed';
          }
          port.postMessage({ channel: 'ryker.workspace.v1', requestId: message.requestId, state: state });
        });
        port.onDisconnect.addListener(function () {
          if (!stopped) setTimeout(connect, 250);
        });
      }
      window.addEventListener('pagehide', function () { stopped = true; }, { once: true });
      connect();
    }

    var extensionStorage = installExtensionStorage();

    function supported() { return typeof window.showDirectoryPicker === 'function'; }
    function isReady() { return !!root; }
    function handle() { return root; }
    function setHandle(next) { root = next || null; return root; }

    // ---- persisted handles --------------------------------------------------

    function idb(mode, fn) {
      return new Promise(function (resolve) {
        var open;
        try { open = window.indexedDB.open(DB, 1); } catch (e) { resolve(null); return; }
        open.onupgradeneeded = function () {
          if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
        };
        open.onerror = function () { resolve(null); };
        open.onsuccess = function () {
          var db = open.result;
          var tx, req;
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

    function defaultPersistence() {
      return {
        get: function (key) { return idb('readonly', function (s) { return s.get(key); }); },
        set: function (key, value) {
          return idb('readwrite', function (s) { return s.put(value, key); });
        },
        remove: function (key) {
          return idb('readwrite', function (s) { return s.delete(key); });
        }
      };
    }

    // Never fall back to a visited website's IndexedDB on the extension surface.
    // Directory-handle persistence is deliberately session-only until the
    // extension requires structured-clone messaging or owns the picker itself.
    var persistence = extensionStorage ? {
      get: function () { return Promise.resolve(null); },
      set: function () { return Promise.resolve(false); },
      remove: function () { return Promise.resolve(true); }
    } : defaultPersistence();

    // An extension supplies an adapter whose storage belongs to the extension,
    // not to whichever page its content script happens to be editing.
    function usePersistence(next) {
      if (!next || typeof next.get !== 'function' || typeof next.set !== 'function' ||
          typeof next.remove !== 'function') {
        throw new Error('A persistence adapter needs get, set and remove methods.');
      }
      persistence = next;
    }

    // Persistence failure is a degradation, not a grant failure. In private
    // browsing, under policy or at quota, the handle still works for this session.
    function callPersistence(method, args) {
      var result;
      try { result = persistence[method].apply(persistence, args); }
      catch (e) { return Promise.resolve(null); }
      return Promise.resolve(result).catch(function () { return null; });
    }

    function remember(key, value) { return callPersistence('set', [key, value]); }
    function recall(key) { return callPersistence('get', [key]); }
    function forget(key) { return callPersistence('remove', [key]); }

    // ---- grant and permission ----------------------------------------------

    function grant(options) {
      if (!supported()) {
        return Promise.reject(new Error(
          'This browser has no directory picker. Use Export to download the edited file instead.'));
      }
      return window.showDirectoryPicker(options || { mode: 'readwrite' }).then(function (next) {
        root = next;
        return next;
      });
    }

    function permission(target, request) {
      if (!target || typeof target.queryPermission !== 'function') return Promise.resolve('denied');
      return target.queryPermission({ mode: 'readwrite' }).then(function (state) {
        if (state === 'prompt' && request && typeof target.requestPermission === 'function') {
          return target.requestPermission({ mode: 'readwrite' });
        }
        return state;
      });
    }

    // ---- paths --------------------------------------------------------------

    function parts(path) {
      var out = String(path || '').split('/').filter(Boolean);
      if (out.some(function (part) { return part === '.' || part === '..'; })) {
        throw new Error('File paths must stay inside the granted folder.');
      }
      return out;
    }

    function directory(base, path, create) {
      var names;
      try { names = parts(path); } catch (e) { return Promise.reject(e); }
      var p = Promise.resolve(base || root);
      names.forEach(function (name) {
        p = p.then(function (dir) {
          if (!dir) throw new Error('No folder has been granted.');
          return dir.getDirectoryHandle(name, { create: !!create });
        });
      });
      return p;
    }

    function file(base, path, create) {
      var names;
      try { names = parts(path); } catch (e) { return Promise.reject(e); }
      var name = names.pop();
      if (!name) return Promise.reject(new Error('A file path is required.'));
      return directory(base, names.join('/'), create).then(function (dir) {
        return dir.getFileHandle(name, { create: !!create });
      });
    }

    function readFile(base, path) {
      return file(base, path, false).then(function (fh) { return fh.getFile(); });
    }

    function read(base, path) {
      return readFile(base, path).then(function (f) { return f.text(); });
    }

    function readBytes(base, path) {
      return readFile(base, path).then(function (f) { return f.arrayBuffer(); })
        .then(function (buf) { return new Uint8Array(buf); });
    }

    function write(base, path, contents) {
      return file(base, path, true).then(function (fh) { return fh.createWritable(); })
        .then(function (w) {
          return w.write(contents).then(function () { return w.close(); })
            .catch(function (e) {
              if (!w.abort) throw e;
              return w.abort().catch(function () {}).then(function () { throw e; });
            });
        });
    }

    function list(base, path) {
      return directory(base, path, false).then(function (dir) {
        var out = [];
        var it = dir.values();
        function step() {
          return it.next().then(function (res) {
            if (res.done) return out;
            var entry = res.value;
            if (entry.kind !== 'file') {
              out.push({ name: entry.name, kind: entry.kind, handle: entry });
              return step();
            }
            return entry.getFile().then(function (f) {
              out.push({ name: entry.name, kind: entry.kind, size: f.size,
                         modified: f.lastModified, handle: entry });
              return step();
            }).catch(step);
          });
        }
        return step();
      });
    }

    // A bounded recursive traversal for packaging. list() intentionally returns
    // one complete directory, which is useful for the revision browser but lets
    // a single huge directory allocate without limit. walk() counts every entry
    // as it is yielded and stops before descending farther.
    function walk(base, path, options) {
      options = options || {};
      var max = Math.max(1, Number(options.maxEntries) || 5000);
      var seen = 0, out = [];

      function visit(dir, prefix) {
        var it = dir.values();
        function step() {
          return it.next().then(function (res) {
            if (res.done) return null;
            var entry = res.value;
            var full = prefix + entry.name;
            seen += 1;
            if (seen > max) {
              throw new Error('The selected folder contains more than ' + max +
                ' entries. Choose a narrower report folder.');
            }
            if (options.skip && options.skip(entry, full)) return step();
            if (entry.kind === 'directory') {
              return visit(entry, full + '/').then(step);
            }
            return entry.getFile().then(function (f) {
              out.push({ name: full, kind: 'file', size: f.size,
                modified: f.lastModified, handle: entry });
            }).then(step);
          });
        }
        return step();
      }

      return directory(base, path, false).then(function (dir) {
        return visit(dir, '').then(function () { return out; });
      });
    }

    function remove(base, path) {
      var names;
      try { names = parts(path); } catch (e) { return Promise.reject(e); }
      var name = names.pop();
      if (!name) return Promise.reject(new Error('A path to remove is required.'));
      return directory(base, names.join('/'), false).then(function (dir) {
        return dir.removeEntry(name);
      });
    }

    return {
      supported: supported, isReady: isReady, handle: handle, setHandle: setHandle,
      grant: grant, pick: grant, permission: permission,
      usePersistence: usePersistence, remember: remember, recall: recall, forget: forget,
      directory: directory, read: read, readBytes: readBytes, write: write,
      list: list, walk: walk, remove: remove
    };
  })();


  /* ---- storage/logger.js ----------------------------------------- */
  // Writing a copy of the instructions to disk on every save, as training data.
  //
  // The extension writes records into its own local IndexedDB through the service
  // worker, so saving never requires a folder grant. The drop-in cannot own a
  // browser origin of its own; there the honest caveat remains that a browser
  // cannot write to a folder it has never been shown. Once granted, later saves
  // write without another dialog or download.
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
    var KEY = 'log-dir';

    var dir = null;
    var seq = 0;
    var lastError = null;
    var listeners = [];
    // Saves made before the folder was granted. Logging is not optional, so a
    // save that happens while the grant is still outstanding is held rather than
    // dropped, and written the moment the folder arrives. Without this, "always
    // on" would quietly mean "on from the second save onward".
    var pending = [];
    // Serialises writes and gives the browser a completion boundary. Opening the
    // Change requests dialog immediately after Save used to list the directory
    // while createWritable().close() was still pending and report an empty log.
    var writeTail = Promise.resolve();
    // Nothing here ever prunes. The corpus is the only durable copy of what
    // changed across sessions, so the answer to a filling store is to say so and
    // offer the export, not to delete the oldest thing the user still has.
    var PRESSURE = 0.8;
    var pressureReported = false;

    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

    function ownedStore() {
      return Ryker.SURFACE === 'extension' && Ryker.extensionStorage;
    }

    function supported() { return !!ownedStore() || Ryker.fs.supported(); }
    function isOn() { return !!dir || !!ownedStore(); }
    function folderName() { return dir ? dir.name : (ownedStore() ? 'Ryker local storage' : null); }
    function error() { return lastError; }
    function count() { return seq; }

    // ---- turning it on ------------------------------------------------------

    function choose() {
      if (!supported()) {
        lastError = 'This browser cannot write to a folder. Logging needs Chrome or Edge.';
        emit();
        return Promise.resolve(false);
      }
      return Ryker.fs.grant({ mode: 'readwrite', id: 'ryker-log', startIn: 'documents' })
        .then(function (handle) {
          dir = handle;
          lastError = null;
          return Ryker.fs.remember(KEY, handle)
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
      if (ownedStore()) return Promise.resolve(true);
      if (!supported()) return Promise.resolve(false);
      return Ryker.fs.recall(KEY).then(function (handle) {
        if (!handle) return false;
        return Ryker.fs.permission(handle, false).then(function (state) {
          if (state !== 'granted') return false;
          dir = handle;
          Ryker.fs.setHandle(handle);
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

    function sessionToken(value) {
      var raw = String(value || 'session');
      var h = 2166136261;
      for (var i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(36).padStart(7, '0');
    }

    // The log belongs beside the library rather than beside the reports, so a
    // folder someone keeps documents in does not fill with machine output. When
    // the granted folder is already the library folder, it is used as-is instead
    // of nesting a second ryker inside itself.
    function documentKey(value) {
      var raw = String(value || 'untitled');
      if (/^[A-Za-z0-9._-]{1,80}$/.test(raw)) return raw;
      var label = raw.replace(/^https?:\/\//i, '').toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || 'document';
      var h = 2166136261;
      for (var i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return label + '-' + (h >>> 0).toString(16).padStart(8, '0');
    }

    function documentDir() {
      var prefix = dir && dir.name.toLowerCase() === LIB ? '' : LIB + '/';
      return prefix + DIR_NAME + '/' + documentKey(Ryker.config.load().RYKER_DOCUMENT_ID);
    }

    // The path as it will actually read on disk, for saying out loud.
    function where() {
      if (!dir) return ownedStore() ? 'Ryker local storage' : LIB + '/' + DIR_NAME;
      return dir.name.toLowerCase() === LIB
        ? dir.name + '/' + DIR_NAME
        : dir.name + '/' + LIB + '/' + DIR_NAME;
    }

    // Called after every save. Failures are recorded and surfaced in the pane
    // rather than thrown: a logging problem must never cost someone their edit.
    // Separated from the write so the shape of the training data can be checked
    // without a filesystem, which is the only part of this worth testing.
    function buildPayload(promptText, saveNote) {
      var cfg = Ryker.config.load();
      var edits = Ryker.instructions.edits();
      return {
        rykerVersion: Ryker.VERSION,
        build: Ryker.BUILD || 'Ryker',
        documentId: cfg.RYKER_DOCUMENT_ID,
        documentPath: cfg.RYKER_DOCUMENT_PATH,
        documentTitle: document.title,
        savedAt: new Date().toISOString(),
        sessionId: Ryker.instructions.sessionId ? Ryker.instructions.sessionId() : null,
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
        saveNote: String(saveNote || '').trim() || null,
        saveNotes: Ryker.instructions.saveNotes(),
        editCount: edits.length,
        // The prose prompt, exactly as the pane shows it.
        prompt: promptText,
        // Machine replay data is deliberately separate from the prompt-facing
        // edits below. Earlier records omitted block ids and could be reviewed
        // but not safely restored after refresh; guessing by position risks
        // applying text to a different element when the source has changed.
        changes: Ryker.instructions.recoveryChanges(),
        // Block order is structural state: a move changes no block's HTML and is
        // otherwise invisible to recovery after a browser restart.
        order: Object.keys(Ryker.blocks.snapshot()),
        // Move records retain the container-crossing intent that a flat order
        // cannot express when a paragraph or section changes parent.
        moves: Ryker.instructions.recoveryMoves ? Ryker.instructions.recoveryMoves() : [],
        // And the pairs behind it, which is the part worth training on.
        edits: edits.map(function (e) {
          return {
            id: e.id, kind: e.kind, tag: e.tag,
            beforeTag: e.beforeTag || null,
            afterTag: e.afterTag || e.tag || null,
            before: e.before, after: e.after,
            position: Ryker.instructions.where(e.id) || null
          };
        })
      };
    }

    function record(promptText, saveNote) {
      seq += 1;
      var payload = buildPayload(promptText, saveNote);
      // The readable timestamp has second precision and saveNumber restarts in
      // every tab. Milliseconds, session identity and the local queue sequence
      // prevent both extension records and shared-folder files from overwriting
      // one another when editors save concurrently.
      var name = stamp() + '-' + Date.now().toString(36) + '-' +
        sessionToken(payload.sessionId) + '-' + seq + '-save-' + payload.saveNumber + '.json';
      if (ownedStore()) return queueOwnedPut(name, payload);
      if (!dir) {
        pending.push({ name: name, payload: payload });
        emit();
        return Promise.resolve(false);
      }
      return queuePut(name, payload);
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
          return queuePut(item.name, item.payload).then(function (ok) {
            if (ok) done += 1; else pending.push(item);
          });
        });
      }, Promise.resolve()).then(function () { return done; });
    }

    function pendingCount() { return pending.length; }

    function queuePut(name, payload) {
      var job = writeTail.then(function () { return put(name, payload); });
      writeTail = job.catch(function () { return false; });
      return job;
    }

    function ownedPrefix() {
      return 'revision:' + documentKey(Ryker.config.load().RYKER_DOCUMENT_ID) + ':';
    }

    function storageFailure(error) {
      lastError = error && error.message ? error.message : String(error);
      emit();
      return false;
    }

    function queueOwnedPut(name, payload) {
      var job = writeTail.then(function () {
        return ownedStore().set(ownedPrefix() + name, JSON.stringify(payload, null, 2))
          .then(function () { lastError = null; emit(); checkPressure(); return true; })
          .catch(storageFailure);
      });
      writeTail = job.catch(function () { return false; });
      return job;
    }

    // Warned once per session rather than on every save. Somebody who is told
    // the same thing after each of forty saves stops reading it, which is how a
    // real quota failure arrives as a surprise.
    function checkPressure() {
      if (pressureReported) return;
      usage().then(function (space) {
        if (!space || !space.quota || !space.usage) return;
        if (space.usage / space.quota < PRESSURE) return;
        pressureReported = true;
        if (Ryker.pane && Ryker.pane.flash) {
          Ryker.pane.flash('Ryker local storage is ' + Math.round(space.usage / space.quota * 100) +
            '% full. Export the saved change requests you want to keep, then clear them.', 'warn');
        }
      }).catch(function () { /* usage is a courtesy; a save must not fail on it */ });
    }

    // Null on the drop-in surface, where records are files in a folder the person
    // chose and the browser has no allowance to report.
    function usage() {
      var store = ownedStore();
      if (!store || typeof store.usage !== 'function') return Promise.resolve(null);
      return store.usage();
    }

    function settled() { return writeTail.then(function () { return true; }); }

    function put(name, payload) {
      return Ryker.fs.write(dir, documentDir() + '/' + name, JSON.stringify(payload, null, 2))
        .then(function () { lastError = null; emit(); return true; })
        .catch(function (e) {
          lastError = e && e.message ? e.message : String(e);
          // A revoked permission is worth forgetting, so the next attempt offers
          // the picker again rather than failing the same way forever.
          if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
            dir = null;
            Ryker.fs.setHandle(null);
            Ryker.fs.forget(KEY);
          }
          emit();
          return false;
        });
    }

    // ---- reading the log back ------------------------------------------------

    // The folder handle can list its own contents, so the log is browsable from
    // inside the report without going anywhere near the file system dialog again.
    function list() {
      if (ownedStore()) {
        var prefix = ownedPrefix();
        return settled().then(function () { return ownedStore().list(prefix); }).then(function (rows) {
          lastError = null;
          return (rows || []).map(function (row) {
            var text = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
            var parsed = null;
            try { parsed = JSON.parse(text); } catch (e) {}
            return {
              name: row.key.slice(prefix.length), storageKey: row.key,
              size: new TextEncoder().encode(text).length,
              modified: parsed && parsed.savedAt ? Date.parse(parsed.savedAt) : 0
            };
          }).sort(function (a, b) { return b.name.localeCompare(a.name); });
        }).catch(function (error) { storageFailure(error); throw error; });
      }
      if (!dir) return Promise.resolve([]);
      return settled().then(function () { return Ryker.fs.list(dir, documentDir()); }).then(function (out) {
        lastError = null;
        return out.filter(function (entry) {
          return entry.kind === 'file' && /\.json$/.test(entry.name);
        }).map(function (entry) {
          entry.path = documentDir() + '/' + entry.name;
          return entry;
        }).sort(function (a, b) { return b.name.localeCompare(a.name); });
      }).catch(function (e) {
        // A granted folder with no per-document directory is a genuinely empty
        // log. Every other failure must be visible; treating permission and path
        // errors as an empty array produced the misleading popup this fixes.
        if (e && (e.name === 'NotFoundError' || /no such directory/i.test(e.message || ''))) return [];
        lastError = e && e.message ? e.message : String(e);
        emit();
        throw e;
      });
    }

    function read(entry) {
      if (entry && entry.storageKey && ownedStore()) {
        return ownedStore().get(entry.storageKey).then(function (value) {
          if (value == null) throw new Error('That saved change request no longer exists.');
          return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        });
      }
      return Ryker.fs.read(dir, entry.path);
    }

    // Delete every logged record for this document.
    //
    // Only this document's directory, and only the .json files list() reports, so
    // a folder somebody granted for a report cannot lose anything else in it to a
    // button inside that report. Rejects on the first failure rather than
    // reporting success over a partial delete, because "cleared" that left half
    // the log behind is worse than an error.
    function clear() {
      if (ownedStore()) {
        return list().then(function (files) {
          return files.reduce(function (chain, file) {
            return chain.then(function (n) {
              return ownedStore().remove(file.storageKey).then(function () { return n + 1; });
            });
          }, Promise.resolve(0));
        }).then(function (n) {
          seq = 0;
          lastError = null;
          emit();
          return n;
        }).catch(function (error) { storageFailure(error); throw error; });
      }
      if (!dir) return Promise.resolve(0);
      return list().then(function (files) {
        return files.reduce(function (chain, f) {
          return chain.then(function (n) {
            return Ryker.fs.remove(dir, f.path).then(function () { return n + 1; });
          });
        }, Promise.resolve(0));
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
      // There is no folder when the records live in extension storage, so there
      // is nothing to open. Without this the browser offered "Open the folder in
      // a new tab" on the extension surface whenever the page happened to be a
      // file:// one, pointing at a directory that was never created.
      if (ownedStore()) return null;
      if (location.protocol !== 'file:') return null;
      var base = location.href.replace(/[^/]*$/, '');
      return base + LIB + '/' + DIR_NAME + '/' +
        encodeURIComponent(Ryker.config.load().RYKER_DOCUMENT_ID) + '/';
    }

    function describe() {
      if (ownedStore()) {
        return lastError ? 'Local Ryker storage needs attention' : 'Saved in local Ryker storage';
      }
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
      flush: flush, settled: settled, pendingCount: pendingCount, where: where, LIB: LIB,
      list: list, read: read, clear: clear, usage: usage, folderUrl: folderUrl,
      folderName: folderName, error: error,
      count: count, onChange: onChange, DIR_NAME: DIR_NAME, documentKey: documentKey
    };
  })();


  /* ---- instructions/browser.js ----------------------------------- */
  // Browsing the durable change requests already written for this document.
  Ryker.browser = (function () {
    'use strict';

    function d() { return Ryker.dom; }

    function fmtSize(n) {
      return n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
    }

    function fmtWhen(ms) {
      try { return Ryker.dom.fmtDate(new Date(ms).toISOString()); } catch (e) { return ''; }
    }

    function extensionOwned() { return Ryker.SURFACE === 'extension'; }

    function storageNote() {
      if (!extensionOwned()) {
        return 'Records are JSON files in the folder you granted Ryker.';
      }
      return 'Kept in this browser only. The page cannot read them and nothing is sent anywhere. ' +
        'They stay until you clear them.';
    }

    function mb(bytes) {
      if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // Reported, never enforced. Ryker prunes nothing, so this number exists to
    // let somebody choose what to export and clear before the browser runs out of
    // room and chooses for them.
    function describeUsage(space) {
      if (!space || typeof space.usage !== 'number') return '';
      var text = 'Using ' + mb(space.usage);
      if (typeof space.quota === 'number' && space.quota > 0) {
        var share = space.usage / space.quota * 100;
        text += share < 1 ? ', under 1% of this browser\'s allowance'
          : ', ' + Math.round(share) + '% of this browser\'s allowance';
      }
      return text + '. Nothing is removed automatically.';
    }

    function open() {
      if (!Ryker.logger.isOn()) {
        offerToTurnOn();
        return;
      }
      var body = d().el('div', {}, [d().el('div', { class: 'pane-status', text: 'Reading the folder...' })]);
      var dlg = Ryker.dialog.open({ title: 'Saved change requests', body: body });

      Ryker.logger.list().then(function (files) {
        body.innerHTML = '';

        body.appendChild(d().el('div', { class: 'note' }, [
          d().el('div', { text: 'Each save writes a record of what changed, so work can be ' +
            'reviewed, merged or exported across sessions.' }),
          d().el('div', { class: 'muted', text: storageNote() })
        ]));

        var url = Ryker.logger.folderUrl();
        var countNote = d().el('div', { class: 'note' }, [
          d().el('div', {
            text: files.length
              ? files.length + (files.length === 1 ? ' change request' : ' change requests') +
                ' logged for this document' +
                (extensionOwned() ? '.'
                  : ' in ' + Ryker.logger.folderName() + '/' + Ryker.logger.DIR_NAME + '.')
              : 'No change requests logged for this document yet.'
          })
        ]);
        body.appendChild(countNote);
        if (extensionOwned()) {
          var usageLine = d().el('div', { class: 'muted', text: '' });
          countNote.appendChild(usageLine);
          Ryker.logger.usage().then(function (space) {
            usageLine.textContent = describeUsage(space);
          }).catch(function (e) {
            usageLine.textContent = 'Storage use could not be read: ' +
              (e && e.message ? e.message : String(e));
          });
        }

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
        body.innerHTML = '<div class="note bad">Could not read saved change requests: ' +
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
      }).catch(function (e) {
        Ryker.dialog.alert('Could not open change request',
          Ryker.dom.escapeHtml(e && e.message ? e.message : String(e)), 'bad');
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
      if (Ryker.SURFACE === 'extension') {
        v = parseInt((Ryker.extensionPreferences || {}).paneWidth, 10);
        return isNaN(v) ? 430 : v;
      }
      try { v = parseInt(localStorage.getItem(WIDTH_KEY), 10); } catch (e) { v = NaN; }
      return isNaN(v) ? 430 : v;
    }

    function maxWidth() { return Math.max(MIN_W, document.documentElement.clientWidth - 240); }

    function applyWidth(px, persist) {
      var w = Math.max(MIN_W, Math.min(maxWidth(), Math.round(px)));
      node.style.width = w + 'px';
      if (persist && Ryker.SURFACE === 'extension') {
        Ryker.extensionPreferences = Ryker.extensionPreferences || {};
        Ryker.extensionPreferences.paneWidth = w;
        if (Ryker.extensionStorage) {
          Ryker.extensionStorage.set('preference:pane-width', w).catch(function (error) {
            flash('Pane width could not be stored: ' + error.message, 'warn');
          });
        }
      } else if (persist) {
        try { localStorage.setItem(WIDTH_KEY, String(w)); } catch (e) {}
      }
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
  // Refresh recovery for the current editor, plus import of the retired journal.
  Ryker.recover = (function () {
    'use strict';

    var timer = null;
    var applying = false;
    var offered = false;
    var lastStorageError = null;

    function documentKey() {
      return Ryker.logger.documentKey(Ryker.config.load().RYKER_DOCUMENT_ID);
    }

    function baseDraftKey() { return 'ryker:draft:' + documentKey(); }
    function baseSeenKey() { return 'ryker:recovery-seen:' + documentKey(); }
    function sessionSuffix() {
      var id = Ryker.instructions.sessionId && Ryker.instructions.sessionId();
      return id ? ':' + String(id).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 96) : '';
    }
    // The worker scopes extension recovery by sender.tab.id. The drop-in uses a
    // tab-scoped sessionStorage token so two tabs sharing one file origin cannot
    // overwrite or consume each other's draft.
    function draftKey() {
      return baseDraftKey() + (Ryker.SURFACE === 'extension' ? '' : sessionSuffix());
    }
    function seenKey() {
      return baseSeenKey() + (Ryker.SURFACE === 'extension' ? '' : sessionSuffix());
    }
    function legacyKey() { return 'ryker:' + Ryker.config.load().RYKER_DOCUMENT_ID + ':journal'; }

    function extensionStore() {
      return Ryker.SURFACE === 'extension' && Ryker.extensionStorage;
    }

    function extensionKey(key) { return 'recovery:' + key; }

    function storageFailure(action, error) {
      var message = error && error.message ? error.message : String(error);
      var signature = action + ':' + message;
      if (signature === lastStorageError) return;
      lastStorageError = signature;
      if (Ryker.log) Ryker.log('recovery storage ' + action + ': ' + message);
      if (Ryker.pane && Ryker.pane.flash) {
        Ryker.pane.flash('Recovery could not be ' + action + ' in local Ryker storage: ' + message, 'warn');
      }
    }

    function get(key) {
      if (extensionStore()) {
        return Ryker.extensionStorage.get(extensionKey(key)).then(function (out) {
          lastStorageError = null;
          return out == null ? null : out;
        }).catch(function (error) { storageFailure('read', error); return null; });
      }
      try { return Promise.resolve(localStorage.getItem(key)); }
      catch (e) { return Promise.resolve(null); }
    }

    function set(key, value) {
      if (extensionStore()) {
        return Ryker.extensionStorage.set(extensionKey(key), value).then(function () {
          lastStorageError = null;
          return true;
        }).catch(function (error) { storageFailure('saved', error); return false; });
      }
      try { localStorage.setItem(key, value); return Promise.resolve(true); }
      catch (e) { return Promise.resolve(false); }
    }

    function remove(key) {
      if (extensionStore()) {
        return Ryker.extensionStorage.remove(extensionKey(key)).then(function () {
          lastStorageError = null;
          return true;
        }).catch(function (error) { storageFailure('removed', error); return false; });
      }
      try { localStorage.removeItem(key); return Promise.resolve(true); }
      catch (e) { return Promise.resolve(false); }
    }

    function parse(raw) {
      if (!raw) return null;
      try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch (e) { return null; }
    }

    function fingerprint(found) {
      if (!found) return 'none';
      var count = Array.isArray(found.changes) ? found.changes.length : 0;
      var moves = Array.isArray(found.moves) ? found.moves.length : 0;
      return found.kind + '@' + found.baselineId + '@' + found.savedAt + '@' + count + '@' + moves;
    }

    function checkpoint() {
      if (applying) return Promise.resolve(false);
      var changes = Ryker.instructions.recoveryChanges();
      var snapshot = Ryker.blocks.snapshot();
      // Changes and moves must share the authored baseline. editable.baselineOf()
      // is rebased after Save, which would otherwise drop a saved move whenever
      // a later unsaved text edit caused the draft to win recovery selection.
      var moves = Ryker.instructions.recoveryMoves ? Ryker.instructions.recoveryMoves() : [];
      if (!changes.length && !moves.length) return remove(draftKey());
      var draft = {
        version: 1, kind: 'draft',
        documentId: Ryker.config.load().RYKER_DOCUMENT_ID,
        sessionId: Ryker.instructions.sessionId ? Ryker.instructions.sessionId() : null,
        baselineId: Ryker.instructions.baselineId(),
        savedAt: new Date().toISOString(), changes: changes,
        order: Object.keys(snapshot), moves: moves
      };
      return set(draftKey(), JSON.stringify(draft));
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(checkpoint, 180);
    }

    function init() {
      Ryker.editable.onChange(schedule);
      Ryker.instructions.onChange(schedule);
      window.addEventListener('pagehide', checkpoint);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') checkpoint();
      });
    }

    function compatible(found) {
      return found && found.baselineId &&
        found.baselineId === Ryker.instructions.baselineId() &&
        Array.isArray(found.changes) &&
        (found.changes.length || (Array.isArray(found.moves) && found.moves.length) ||
          (Array.isArray(found.order) && found.order.length));
    }

    function draft() {
      return get(draftKey()).then(function (raw) {
        if (!raw && Ryker.SURFACE !== 'extension' && draftKey() !== baseDraftKey()) {
          return get(baseDraftKey()).then(function (legacyRaw) {
            var legacyFound = parse(legacyRaw);
            if (!legacyFound) return null;
            legacyFound.kind = 'draft';
            return legacyFound;
          });
        }
        var found = parse(raw);
        if (!found) return null;
        found.kind = 'draft';
        return found;
      });
    }

    function savedRound() {
      if (!Ryker.logger.isOn()) return Promise.resolve(null);
      return Ryker.logger.list().then(function (entries) {
        function next(i) {
          if (i >= entries.length) return null;
          return Ryker.logger.read(entries[i]).then(function (raw) {
            var found = parse(raw);
            if (!found || !Array.isArray(found.changes) ||
                (!found.changes.length && !(Array.isArray(found.moves) && found.moves.length) &&
                  !(Array.isArray(found.order) && found.order.length))) {
              return next(i + 1);
            }
            found.kind = 'saved';
            return found;
          }).catch(function () { return next(i + 1); });
        }
        return next(0);
      });
    }

    function legacy() {
      // The retired drop-in journal belonged to the authored page. Reading it
      // from an injected extension would cross back into the visited origin and
      // let page-controlled storage impersonate extension recovery state.
      if (Ryker.SURFACE === 'extension') return null;
      var raw;
      try { raw = localStorage.getItem(legacyKey()); } catch (e) { return null; }
      var old = parse(raw);
      var records = old && old.records || [];
      if (!records.length) return null;
      var changes = [];
      records.forEach(function (record) {
        (record.changes || []).forEach(function (change) { changes.push(change); });
      });
      return changes.length ? {
        kind: 'legacy', baselineId: Ryker.instructions.baselineId(),
        savedAt: old.savedAt || '', changes: changes
      } : null;
    }

    function settle(found) { return set(seenKey(), fingerprint(found)); }

    function alreadySettled(found) {
      return get(seenKey()).then(function (value) { return value === fingerprint(found); });
    }

    function apply(found) {
      applying = true;
      var before = Ryker.blocks.snapshot();
      var out, moveOut, changes;
      try {
        // New records carry explicit moves so parent changes can be replayed.
        // Flat order remains the compatibility path for records written during
        // the short-lived order-only format.
        out = Ryker.blocks.applyRecords([{
          changes: found.changes,
          order: Array.isArray(found.moves) ? null : found.order
        }]);
        moveOut = Array.isArray(found.moves) && Ryker.move && Ryker.move.replay
          ? Ryker.move.replay(found.moves)
          : { applied: out.moved || 0, missed: out.orderMissed || 0, unchanged: 0 };
        changes = Ryker.blocks.diffSnapshots(before, Ryker.blocks.snapshot());
      } finally {
        applying = false;
      }
      settle(found);
      if (!changes.length && !moveOut.applied) {
        if (out.missed + moveOut.missed) {
          Ryker.dialog.alert('Changes could not be restored',
            (out.missed + moveOut.missed) +
            ' saved change(s) did not match a safe element or position in this document.', 'warn');
        } else {
          Ryker.dialog.alert('Nothing to restore',
            'Those changes are already reflected in this document.', 'ok');
        }
        return false;
      }
      Ryker.instructions.record();
      Ryker.editable.rebase();
      Ryker.pane.refresh(true);
      if (!Ryker.pane.isOpen()) Ryker.pane.toggle();
      Ryker.boot.sync();
      checkpoint();
      Ryker.dialog.alert('Changes restored',
        changes.length + ' block(s) and ' + moveOut.applied + ' move(s) were restored.' +
        (out.missed + moveOut.missed ? ' ' + (out.missed + moveOut.missed) +
          ' change(s) could not be placed and were skipped.' : ''),
        out.missed + moveOut.missed ? 'warn' : 'ok');
      return true;
    }

    function present(found) {
      if (!found) return Promise.resolve(false);
      return alreadySettled(found).then(function (settled) {
        if (settled) return false;
        if (!compatible(found)) {
          settle(found);
          Ryker.dialog.alert('Saved changes need review',
            'Ryker found changes from an earlier version of this document, but the source has changed. They were not applied automatically. Open Saved change requests to review them.',
            'warn');
          return false;
        }
        var when = found.savedAt ? ', saved ' + Ryker.dom.fmtDate(found.savedAt) : '';
        Ryker.dialog.open({
          title: 'Restore earlier changes?',
          body: Ryker.dom.el('div', {}, [
            Ryker.dom.el('p', { text: found.changes.length + ' content change(s)' +
              (found.moves && found.moves.length ? ' plus ' + found.moves.length + ' move(s)' :
                (found.order ? ' plus saved block order' : '')) + ' were found' + when + '.' }),
            Ryker.dom.el('p', { class: 'muted', text: 'The source matches their baseline. Nothing is applied unless you choose Restore.' })
          ]),
          buttons: [
            { label: 'Not now', action: function () { settle(found); } },
            { label: 'Restore', primary: true, action: function () { apply(found); } }
          ]
        });
        return true;
      });
    }

    function offer() {
      if (offered) return Promise.resolve(false);
      offered = true;
      return draft().then(function (found) {
        if (found) return found;
        return savedRound();
      }).then(function (found) {
        return present(found || legacy());
      }).catch(function (e) {
        if (Ryker.log) Ryker.log('recovery: ' + e.message);
        return false;
      });
    }

    function dismiss() {
      clearTimeout(timer);
      return remove(draftKey());
    }

    return {
      init: init, offer: offer, apply: apply, checkpoint: checkpoint,
      draft: draft, savedRound: savedRound, present: present, dismiss: dismiss,
      draftKey: draftKey, seenKey: seenKey
    };
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
    var started = false, active = false;
    var reopenPane = true, reopenRail = false;
    var saveNotesPreference = null;
    var syncQueued = false;
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
        class: 'handle', title: 'Open Ryker', 'aria-label': 'Open Ryker',
        'aria-expanded': 'false',
        onclick: function () { expand(true); }
      }, [Ryker.icons.brandMark(24)]);
      Ryker.shell.add(handle);

      // No Edit toggle. Ryker exists to edit, and a mode switch that is always in
      // the same position is a control nobody ever needs to touch.
      els.save = d().el('button', { class: 'rk', text: 'Save', onclick: requestSave });
      els.pane = d().el('button', { class: 'rk count-only',
        onclick: function () { Ryker.pane.toggle(); } });

      // Export is gone: the instruction pane is what someone leaves with. What
      // remains is occasional, so it sits behind the ellipsis rather than taking
      // permanent room in the bar.
      els.more = Ryker.icons.button('more', 'More actions');
      els.more.setAttribute('aria-haspopup', 'menu');
      els.more.setAttribute('aria-expanded', 'false');
      Ryker.menu.attach(els.more, buildMenu);

      els.note = d().el('button', { class: 'where', type: 'button',
        onclick: function () {
          if (Ryker.logger.isOn()) Ryker.browser.open();
          else startLogging();
        } }, [
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
        Ryker.icons.brandMark(18),
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

    // Resolved on every open so both logging and the save-note preference are
    // current without attaching another click listener each time state changes.
    function buildMenu() {
      return [
        { label: 'Export report...', icon: 'download', run: exportMenu },
        { label: 'Package report', icon: 'package', run: function () { Ryker.packager.open(); } },
        { label: 'Download instructions', icon: 'download', run: function () { Ryker.pane.download(); } },
        { label: 'Copy instructions', icon: 'copy', run: function () { Ryker.pane.copy(); } },
        null,
        { label: 'Saved change requests...', icon: 'package', run: function () { Ryker.browser.open(); } },
        Ryker.logger.isOn()
          ? { label: 'Logging to ' + Ryker.logger.where(), icon: 'download', disabled: true }
          : { label: 'Choose the folder to log to...', icon: 'download', run: startLogging },
        null,
        { label: saveNotesEnabled() ? 'Disable save comments' : 'Enable save comments',
          icon: 'note', run: function () { setSaveNotesEnabled(!saveNotesEnabled()); } },
        null,
        { label: 'Clear document', icon: 'trash', danger: true,
          run: function () { Ryker.pane.confirmClear(); } }
      ];
    }

    function saveNotesEnabled() {
      if (saveNotesPreference !== null) return saveNotesPreference;
      if (Ryker.SURFACE === 'extension') {
        var preferences = Ryker.extensionPreferences || {};
        return typeof preferences.saveNotes === 'boolean' ? preferences.saveNotes : true;
      }
      try { return localStorage.getItem('ryker:save-notes') !== 'off'; } catch (e) { return true; }
    }

    function setSaveNotesEnabled(on) {
      saveNotesPreference = !!on;
      if (Ryker.SURFACE === 'extension') {
        Ryker.extensionPreferences = Ryker.extensionPreferences || {};
        Ryker.extensionPreferences.saveNotes = !!on;
        if (Ryker.extensionStorage) {
          Ryker.extensionStorage.set('preference:save-notes', !!on).catch(function (error) {
            if (Ryker.log) Ryker.log('preference storage: ' + error.message);
            if (Ryker.pane) Ryker.pane.flash('Save-comment preference could not be stored: ' +
              error.message, 'warn');
          });
        }
      } else {
        try { localStorage.setItem('ryker:save-notes', on ? 'on' : 'off'); } catch (e) {}
      }
      if (Ryker.pane) Ryker.pane.flash('Save comments ' + (on ? 'enabled.' : 'disabled.'));
      return saveNotesPreference;
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
      var attach = !Ryker.exportHtml.canAttach || Ryker.exportHtml.canAttach();
      var body = '<p><b>Clean HTML</b> is the report on its own, with Ryker taken out. This is what ' +
        'you send to someone who should read it rather than edit it.</p>';
      if (attach) {
        body += '<p><b>With Ryker</b> keeps the editor attached, so whoever opens it can carry on ' +
          'editing and leave with their own instruction set.</p>';
      } else {
        body += '<p>This extension workspace can export clean HTML only. Install the Ryker drop-in ' +
          'in the source file when you need a portable editable copy.</p>';
      }
      var buttons = [{ label: 'Cancel' }];
      if (attach) {
        buttons.push({
          label: 'With Ryker',
          action: function () {
            var o = Ryker.exportHtml.scanned('ryker');
            if (o.hits.length) { Ryker.dialog.leak(o.hits); return; }
            Ryker.exportHtml.download(o.html, base + '-ryker.html');
          }
        });
      }
      buttons.push({
        label: 'Clean HTML', primary: true,
        action: function () {
          var o = Ryker.exportHtml.scanned('clean');
          if (o.hits.length) { Ryker.dialog.leak(o.hits); return; }
          Ryker.exportHtml.download(o.html, base + '.html');
        }
      });
      Ryker.dialog.open({
        title: 'Export',
        body: body,
        buttons: buttons
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

    function expand(open) {
      // build() runs under guard(), so there may be no toolbar. sync() has always
      // returned early on this; expand() dereferenced `bar` regardless, which is
      // how a cosmetic failure used to take editing down with it.
      if (!bar || !handle) return;
      open = !!open;
      if (!open && expanded) {
        reopenPane = Ryker.pane && Ryker.pane.isOpen();
        reopenRail = Ryker.rail && Ryker.rail.isOpen();
      }
      expanded = open;
      if (!expanded) {
        if (Ryker.menu && Ryker.menu.isOpen()) Ryker.menu.close();
        while (Ryker.dialog && Ryker.dialog.isOpen()) Ryker.dialog.closeTop();
        if (Ryker.rail && Ryker.rail.isOpen()) Ryker.rail.toggle(false);
        if (Ryker.pane && Ryker.pane.isOpen()) Ryker.pane.toggle();
        if (Ryker.pick) Ryker.pick.clear();
        if (Ryker.formatbar) Ryker.formatbar.hide();
        if (Ryker.editable) Ryker.editable.disable();
        Ryker.shell.releaseEdgeSpace();
        Ryker.shell.releasePanelSpace();
        Ryker.shell.releaseOffset();
      } else {
        if (Ryker.editable) Ryker.editable.enable();
        if (reopenPane && Ryker.pane && !Ryker.pane.isOpen()) Ryker.pane.toggle();
        if (reopenRail && Ryker.rail && !Ryker.rail.isOpen()) Ryker.rail.toggle(true);
      }
      bar.style.display = expanded ? 'flex' : 'none';
      handle.style.display = expanded ? 'none' : 'flex';
      handle.setAttribute('aria-expanded', String(expanded));
      sync();
    }

    // Only one row now that formatting floats over the selection, so the offset
    // is simply the bar's own height.
    function layout() {
      if (!active || !expanded) return;
      Ryker.shell.setOffset(bar.getBoundingClientRect().height);
      Ryker.pane.reflow();
    }

    function requestSave(quiet) {
      var hasChanges = Ryker.editable.changes().length || Ryker.move.count();
      if (!hasChanges || !saveNotesEnabled()) { save(quiet, ''); return; }

      var field = d().el('textarea', {
        class: 'rk save-note', rows: '5',
        'aria-label': 'Optional context for this save',
        placeholder: 'Why was this change made? What should the person applying it know?'
      });
      var body = d().el('div', {}, [
        d().el('p', { text: 'Add optional context for this round of changes. It will travel with the instructions and revision record.' }),
        field
      ]);
      var dialog = Ryker.dialog.open({
        title: 'Add context to this save', body: body,
        buttons: [
          { label: 'Cancel' },
          { label: 'Save without comment', action: function () { save(quiet, ''); } },
          { label: 'Save with comment', primary: true,
            action: function () { save(quiet, field.value); } }
        ]
      });

      // Offered only once there is a comment to save. An empty field makes the
      // two save buttons do exactly the same thing, and a person choosing
      // between them has to read both to discover that.
      var withComment = dialog.buttons[2];
      function offerComment() { withComment.hidden = !field.value.trim(); }
      field.addEventListener('input', offerComment);
      offerComment();
    }

    // A save writes nothing. It takes the edits made since the last one,
    // folds them into the instruction set, and rebases so the next save records
    // only what changed after this point. The instructions themselves still quote
    // the document as authored, not as it was at the previous save.
    function save(quiet, saveNote) {
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
      saveNote = String(saveNote || '').trim();
      Ryker.instructions.record(saveNote);
      Ryker.editable.rebase();
      Ryker.pane.refresh(true);
      if (!Ryker.pane.isOpen()) Ryker.pane.toggle();
      sync();
      // Fire and forget. A logging failure is reported in the pane and never
      // interrupts the save that produced it.
      Ryker.logger.record(Ryker.pane.value(), saveNote).then(function (ok) {
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
      if (!bar || !active) return;
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
        ? 'Saved changes'
        : (held
            ? held + ' save(s) held in this tab only'
            : (edits ? edits + ' edit(s) held in this tab only' : 'Nothing is saved anywhere'));
      els.note.disabled = !Ryker.logger.isOn() && !Ryker.logger.supported();
      els.note.querySelector('.dot').className = 'dot ' + (edits ? 'warn' : '');
      Ryker.tooltip.attach(els.note, Ryker.logger.isOn()
        ? 'Every save writes a copy here. Click to browse them.'
        : 'Nothing has been written to disk yet. Click to choose the folder, ' +
          'and every save held in this tab is written straight away.');
      els.note.querySelector('.dot').classList.toggle('ok', Ryker.logger.isOn());

      Ryker.tooltip.attach(els.pane,
        edits + ' edit(s) recorded. Show or hide the instructions.');

      layout();
    }

    // Typing can emit several changes before the browser paints. The status and
    // layout are visual work, so one refresh per frame is both current enough for
    // the eye and prevents a full document snapshot/style walk per character.
    function scheduleSync() {
      // The first dirty transition enables Save immediately. Further keystrokes
      // arrive while it is already enabled and can share the next paint.
      if (els.save && els.save.disabled) { sync(); return; }
      if (syncQueued) return;
      syncQueued = true;
      var run = function () {
        syncQueued = false;
        sync();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else setTimeout(run, 0);
    }

    function start() {
      if (started) return active;
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
        Ryker.editable.onChange(scheduleSync);
        Ryker.instructions.onChange(function () { Ryker.pane.refresh(); sync(); });
        Ryker.recover.init();
      });

      document.addEventListener('keydown', function (e) {
        if (!active || !expanded) return;
        // Ctrl+S, or Cmd+S. Taken over because in a document with an editor
        // attached it plainly means "save my edits", not "write this page to
        // disk", and the browser's own dialog would do the wrong thing.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          e.stopPropagation();
          requestSave(true);
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
      active = true;
      guard('expand', function () { expand(true); });
      guard('editable', function () { Ryker.editable.enable(); });
      guard('sync', sync);
      Ryker.logger.resume().then(function (ok) {
        sync();
        Ryker.recover.offer();
        // Asking on load is the only honest reading of "always on": the picker
        // needs a click, so the click has to be offered rather than waited for.
        // Deliberately not asked here. A modal on load covers the report with a
        // backdrop that swallows every click before anyone has done anything,
        // which is a poor trade for a grant that is only needed once a save
        // exists to write. Saves are queued until it arrives, so nothing is lost
        // by waiting for the first one.
      });
      return active;
    }

    // Extension action clicks are a reversible session toggle. Closing removes
    // every visible and editable trace from the host page but keeps Ryker's
    // in-memory baseline, instructions and unsaved DOM changes, so reopening the
    // same tab continues the session instead of silently starting over.
    function close() {
      if (!started || !active) return false;
      active = false;
      expand(false);
      Ryker.shell.releaseEdgeSpace();
      Ryker.shell.releaseOffset();
      var host = Ryker.shell.host();
      if (host) host.style.display = 'none';
      return false;
    }

    function open() {
      if (!started) return !!start();
      if (active) return true;
      var host = Ryker.shell.host();
      if (!host) return false;
      active = true;
      host.style.display = 'block';
      Ryker.editable.enable();
      expand(true);
      if (reopenPane && !Ryker.pane.isOpen()) Ryker.pane.toggle();
      if (reopenRail && !Ryker.rail.isOpen()) Ryker.rail.toggle(true);
      sync();
      return true;
    }

    function toggle() { return active ? close() : open(); }

    return {
      start: start, sync: sync, save: save, requestSave: requestSave, expand: expand,
      saveNotesEnabled: saveNotesEnabled, setSaveNotesEnabled: setSaveNotesEnabled,
      open: open, close: close, toggle: toggle, isOpen: function () { return active; },
      log: log, problems: function () { return problems.slice(); }
    };
  })();

  // history.js calls this behind an `if (Ryker.log)` guard. bootstrap/boot.js used
  // to define it and no longer exists, so without this line the guard is
  // permanently false and the diagnostic silently does nothing.
  Ryker.log = Ryker.boot.log;

  (function () {
    'use strict';
    // The extension is inert until its toolbar action calls start(). The drop-in
    // keeps the automatic boot required by reports that carry the script tag.
    if (Ryker.SURFACE === 'extension') return;
    function go() { Ryker.boot.start(); }
    function schedule() {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
      setTimeout(go, 50);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
    else schedule();
  })();


})();
