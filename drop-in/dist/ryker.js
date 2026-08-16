/*!
 * Ryker 0.1.0
 * A drop-in editing layer for authored HTML reports.
 *
 * Generated bundle. Do not edit. Sources, in load order:
 *   utils/dom.js  (131 lines)
 *   config/config.js  (110 lines)
 *   config/identity.js  (102 lines)
 *   security/scan.js  (64 lines)
 *   editor/sanitize.js  (174 lines)
 *   editor/blocks.js  (305 lines)
 *   revisions/diff.js  (99 lines)
 *   revisions/journal.js  (149 lines)
 *   comments/anchor.js  (151 lines)
 *   comments/highlight.js  (87 lines)
 *   comments/comments.js  (177 lines)
 *   storage/adapter.js  (74 lines)
 *   storage/local.js  (73 lines)
 *   storage/fs.js  (132 lines)
 *   storage/github.js  (261 lines)
 *   export/zip.js  (142 lines)
 *   export/html.js  (141 lines)
 *   export/packager.js  (212 lines)
 *   ui/styles.js  (444 lines)
 *   ui/shell.js  (190 lines)
 *   ui/icons.js  (51 lines)
 *   ui/tooltip.js  (82 lines)
 *   ui/dialog.js  (124 lines)
 *   ui/menu.js  (104 lines)
 *   ui/panel.js  (248 lines)
 *   revisions/review.js  (99 lines)
 *   editor/editable.js  (473 lines)
 *   editor/history.js  (139 lines)
 *   editor/formatbar.js  (215 lines)
 *   editor/links.js  (174 lines)
 *   editor/pick.js  (220 lines)
 *   editor/multi.js  (172 lines)
 *   editor/save.js  (198 lines)
 *   github/onboard.js  (154 lines)
 *   comments/select.js  (142 lines)
 *   ui/toolbar.js  (212 lines)
 *   bootstrap/boot.js  (159 lines)
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
      RYKER_GOOGLE_ENABLED: false
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


  /* ---- config/identity.js ---------------------------------------- */
  // Who is making the change.
  //
  // With GitHub verified, identity is GitHub's durable numeric user id plus the
  // login, per spec section 33, because logins can change and the id cannot.
  //
  // Without GitHub, identity is a name the person typed. That is exactly what
  // ordinary git is, where user.name is unverified in every repository, so it is
  // not a weakness introduced here. It is labelled self-asserted everywhere it
  // appears rather than presented as though it were checked.
  Ryker.identity = (function () {
    'use strict';

    var KEY = 'ryker:selfname';
    var cached = null;

    function fromGitHub() {
      var gh = Ryker.storage.get('github');
      if (!gh || !gh.identity) return null;
      var id = gh.identity();
      if (!id || !gh.canWrite()) return null;
      return {
        github_user_id: id.id,
        github_login: id.login,
        name: id.name || id.login,
        source: 'github'
      };
    }

    function selfName() {
      if (cached) return cached;
      try { cached = localStorage.getItem(KEY) || null; } catch (e) { cached = null; }
      return cached;
    }

    function setSelfName(name) {
      cached = String(name || '').trim() || null;
      try {
        if (cached) localStorage.setItem(KEY, cached);
        else localStorage.removeItem(KEY);
      } catch (e) {}
      return cached;
    }

    function current() {
      var gh = fromGitHub();
      if (gh) return gh;
      return {
        github_user_id: null,
        github_login: null,
        name: selfName() || 'Unnamed author',
        source: 'self'
      };
    }

    function label() {
      var me = current();
      return me.source === 'github' ? me.github_login : me.name + ' (self-asserted)';
    }

    function needsName() {
      return !fromGitHub() && !selfName();
    }

    // Asked once, before the first save rather than at boot, so a reader is never
    // interrupted by a question about authorship.
    function promptForName(then) {
      var d = Ryker.dom;
      var input = d.el('input', {
        class: 'rk', type: 'text', placeholder: 'Your name', value: selfName() || ''
      });
      Ryker.dialog.open({
        title: 'Who is making this change?',
        body: d.el('div', {}, [
          d.el('p', {
            text: 'This report is not connected to GitHub, so Ryker cannot verify who you are. ' +
              'The name you give is recorded with your revisions and marked as self-asserted, ' +
              'which is the same footing as an ordinary local git commit.'
          }),
          d.el('label', { class: 'rk', text: 'Name' }),
          input
        ]),
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Continue', primary: true,
            action: function () {
              var v = input.value.trim();
              if (!v) return false;
              setSelfName(v);
              if (then) then(current());
            }
          }
        ]
      });
    }

    return {
      current: current, label: label, needsName: needsName,
      promptForName: promptForName, setSelfName: setSelfName, selfName: selfName
    };
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
      SELECTOR: SELECTOR, root: root, all: all, blockId: blockId, byId: byId,
      excluded: excluded, snapshot: snapshot, diffSnapshots: diffSnapshots, label: label,
      seedIds: seedIds, stamp: stamp, htmlOf: htmlOf, sequence: sequence,
      boxOf: boxOf, boxKey: boxKey,
      applyChange: applyChange, applyRecords: applyRecords
    };
  })();


  /* ---- revisions/diff.js ----------------------------------------- */
  // Word-level diff for a single changed block.
  //
  // The journal captures deltas at write time, so nothing here diffs whole
  // documents. All that remains is comparing two versions of one block, which is
  // a small LCS and about 150 lines rather than a vendored diff library that
  // would need splitting to meet the line cap.
  Ryker.diff = (function () {
    'use strict';

    function tokenize(html) {
      var tmp = document.createElement('div');
      tmp.innerHTML = html == null ? '' : html;
      var text = tmp.textContent || '';
      // Keep whitespace as its own token so rejoining reproduces the original
      // spacing rather than normalising it.
      return text.match(/\s+|[^\s]+/g) || [];
    }

    // Classic LCS table. Blocks are paragraphs, so the quadratic cost is fine;
    // a guard below falls back to a whole-block replace on anything pathological.
    function lcs(a, b) {
      var n = a.length, m = b.length;
      var table = new Array(n + 1);
      for (var i = 0; i <= n; i++) {
        table[i] = new Int32Array(m + 1);
      }
      for (i = n - 1; i >= 0; i--) {
        for (var j = m - 1; j >= 0; j--) {
          table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1]);
        }
      }
      return table;
    }

    function words(beforeHtml, afterHtml) {
      var a = tokenize(beforeHtml);
      var b = tokenize(afterHtml);

      if (a.length * b.length > 4000000) {
        return [{ op: 'del', text: a.join('') }, { op: 'ins', text: b.join('') }];
      }

      var table = lcs(a, b);
      var out = [];
      var i = 0, j = 0;
      while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { push(out, 'same', a[i]); i++; j++; }
        else if (table[i + 1][j] >= table[i][j + 1]) { push(out, 'del', a[i]); i++; }
        else { push(out, 'ins', b[j]); j++; }
      }
      while (i < a.length) { push(out, 'del', a[i]); i++; }
      while (j < b.length) { push(out, 'ins', b[j]); j++; }
      return out;
    }

    function push(out, op, text) {
      var last = out[out.length - 1];
      if (last && last.op === op) last.text += text;
      else out.push({ op: op, text: text });
    }

    // Counts for the revision panel. Whitespace-only runs are not changes anyone
    // wants counted, so they are excluded from the totals.
    function counts(parts) {
      var ins = 0, del = 0;
      parts.forEach(function (p) {
        if (!p.text.trim()) return;
        var n = (p.text.trim().match(/\S+/g) || []).length;
        if (p.op === 'ins') ins += n;
        else if (p.op === 'del') del += n;
      });
      return { additions: ins, removals: del };
    }

    function countChange(change) {
      if (change.kind === 'added') {
        return { additions: (tokenize(change.after).join('').trim().match(/\S+/g) || []).length, removals: 0 };
      }
      if (change.kind === 'removed') {
        return { additions: 0, removals: (tokenize(change.before).join('').trim().match(/\S+/g) || []).length };
      }
      return counts(words(change.before, change.after));
    }

    function renderInline(parts) {
      var d = Ryker.dom;
      var frag = document.createDocumentFragment();
      parts.forEach(function (p) {
        if (p.op === 'same') { frag.appendChild(document.createTextNode(p.text)); return; }
        var tag = p.op === 'ins' ? 'ins' : 'del';
        frag.appendChild(d.el(tag, { class: 'ryker-diff-' + p.op, text: p.text }));
      });
      return frag;
    }

    return { words: words, counts: counts, countChange: countChange, renderInline: renderInline, tokenize: tokenize };
  })();


  /* ---- revisions/journal.js -------------------------------------- */
  // The append-only revision journal. This is the centre of Ryker's design.
  //
  // Git is not the revision store. Ryker needs revision tracking across saves and
  // comments on record; it does not need branching, refs, actions or a CLI. So
  // every save appends one record holding the blocks that changed as before and
  // after pairs keyed by block id, plus the comment events of that save, plus
  // author, timestamp and message.
  //
  // Four things follow, and they are why the inversion is worth it:
  //   - The revision panel reads straight off a record. "12 additions, 4
  //     removals, 2 comments resolved" is the shape of a record, not something to
  //     compute by comparing two whole documents.
  //   - The inline diff needs no document differ. The delta was captured at write
  //     time; only a word-level compare inside one block remains.
  //   - Revision review works identically with no repository at all, so it does
  //     not degrade when the report is opened from a ZIP.
  //   - Write contention disappears. Appending a numbered record never conflicts
  //     with someone else appending theirs.
  //
  // Current comment state is a fold over the log, cached but always rebuildable.
  Ryker.journal = (function () {
    'use strict';

    var records = [];
    var loaded = false;

    function reset(list) {
      records = (list || []).slice().sort(function (a, b) { return a.seq - b.seq; });
      loaded = true;
    }

    function all() { return records.slice(); }
    function count() { return records.length; }
    function isLoaded() { return loaded; }
    function latest() { return records.length ? records[records.length - 1] : null; }

    function nextSeq() {
      return records.length ? records[records.length - 1].seq + 1 : 1;
    }

    function make(opts) {
      var prev = latest();
      return {
        seq: nextSeq(),
        id: Ryker.dom.uid('rev'),
        parent: prev ? prev.id : null,
        documentId: opts.documentId,
        author: opts.author,
        timestamp: Ryker.dom.now(),
        message: opts.message || '',
        changes: opts.changes || [],
        comments: {
          added: opts.commentsAdded || [],
          resolved: opts.commentsResolved || [],
          reopened: opts.commentsReopened || [],
          deleted: opts.commentsDeleted || []
        }
      };
    }

    function append(record) {
      records.push(record);
      return record;
    }

    // Totals for the revision list, computed once per record rather than on every
    // render, since a word diff over a long block is not free.
    function summarize(record) {
      if (record._summary) return record._summary;
      var add = 0, del = 0;
      (record.changes || []).forEach(function (c) {
        var n = Ryker.diff.countChange(c);
        add += n.additions;
        del += n.removals;
      });
      var s = {
        additions: add,
        removals: del,
        blocks: (record.changes || []).length,
        commentsAdded: (record.comments.added || []).length,
        commentsResolved: (record.comments.resolved || []).length
      };
      record._summary = s;
      return s;
    }

    // Folding the log gives current comment state. Deliberately derived rather
    // than stored as the truth, so a corrupted cache is repaired by replaying
    // rather than by asking someone what the comments used to be.
    function foldComments() {
      var map = {};
      records.forEach(function (r) {
        (r.comments.added || []).forEach(function (c) {
          map[c.id] = JSON.parse(JSON.stringify(c));
          map[c.id].status = 'open';
        });
        (r.comments.resolved || []).forEach(function (e) {
          if (!map[e.id]) return;
          map[e.id].status = 'resolved';
          map[e.id].resolvedAt = e.at;
          map[e.id].resolvedBy = e.by;
        });
        (r.comments.reopened || []).forEach(function (e) {
          if (!map[e.id]) return;
          map[e.id].status = 'open';
          delete map[e.id].resolvedAt;
          delete map[e.id].resolvedBy;
        });
        (r.comments.deleted || []).forEach(function (e) { delete map[e.id]; });
      });
      return map;
    }

    // The block content as of a given revision, walking backwards from now.
    // "now" is the live DOM, so replaying undoes each later change in turn.
    function blockAt(blockId, seq) {
      var node = Ryker.blocks.byId(blockId);
      var value = node ? node.innerHTML : null;
      for (var i = records.length - 1; i >= 0; i--) {
        var r = records[i];
        if (r.seq <= seq) break;
        var hit = (r.changes || []).filter(function (c) { return c.id === blockId; })[0];
        if (hit) value = hit.before;
      }
      return value;
    }

    function recordsTouching(blockId) {
      return records.filter(function (r) {
        return (r.changes || []).some(function (c) { return c.id === blockId; });
      });
    }

    function serialize() {
      return records.map(function (r) {
        var copy = {};
        Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') copy[k] = r[k]; });
        return copy;
      });
    }

    return {
      reset: reset, all: all, count: count, isLoaded: isLoaded, latest: latest,
      nextSeq: nextSeq, make: make, append: append, summarize: summarize,
      foldComments: foldComments, blockAt: blockAt, recordsTouching: recordsTouching,
      serialize: serialize
    };
  })();


  /* ---- comments/anchor.js ---------------------------------------- */
  // Layered comment anchoring, spec section 14.
  //
  // A comment must not rest on a DOM coordinate. Edit Mode exists so that people
  // will change the text above a comment, and an XPath plus character offset
  // breaks the first time they do. So an anchor records the quoted string, about
  // 32 characters of context each side, and the containing block as a hint rather
  // than as the anchor itself.
  //
  // Resolution tries five strategies in descending confidence. When none of them
  // lands, the comment becomes Unanchored rather than attaching itself to
  // plausible-looking but wrong content, which is the failure section 14 names.
  Ryker.anchor = (function () {
    'use strict';

    var CONTEXT = 32;

    function capture(range) {
      var root = Ryker.blocks.root();
      var flat = Ryker.dom.flatten(root);
      var bounds = offsetsOf(range, flat);
      if (!bounds) return null;

      var quote = flat.text.slice(bounds.start, bounds.end);
      if (!quote.trim()) return null;

      var container = range.commonAncestorContainer;
      if (container.nodeType === 3) container = container.parentNode;
      var block = container.closest ? container.closest(Ryker.blocks.SELECTOR) : null;

      return {
        quote: quote,
        prefix: flat.text.slice(Math.max(0, bounds.start - CONTEXT), bounds.start),
        suffix: flat.text.slice(bounds.end, Math.min(flat.text.length, bounds.end + CONTEXT)),
        blockId: block ? Ryker.blocks.blockId(block, root) : null,
        approxStart: bounds.start
      };
    }

    function offsetsOf(range, flat) {
      var start = null, end = null;
      for (var i = 0; i < flat.index.length; i++) {
        var e = flat.index[i];
        if (e.node === range.startContainer) start = e.start + range.startOffset;
        if (e.node === range.endContainer) end = e.start + range.endOffset;
      }
      if (start == null || end == null || end <= start) return null;
      return { start: start, end: end };
    }

    function norm(s) { return String(s || '').replace(/\s+/g, ' '); }

    // Returns { range, confidence } or null. Confidence is reported so the panel
    // can distinguish a comment that landed exactly from one that landed on a
    // best guess.
    function resolve(a) {
      var root = Ryker.blocks.root();
      var strategies = [];

      if (a.blockId) {
        var block = Ryker.blocks.byId(a.blockId);
        if (block) {
          strategies.push({ scope: block, withContext: true, conf: 'exact' });
          strategies.push({ scope: block, withContext: false, conf: 'block' });
        }
      }
      strategies.push({ scope: root, withContext: true, conf: 'context' });
      strategies.push({ scope: root, withContext: false, conf: 'quote' });
      strategies.push({ scope: root, withContext: false, conf: 'loose', loose: true });

      for (var i = 0; i < strategies.length; i++) {
        var hit = attempt(a, strategies[i]);
        if (hit) return { range: hit, confidence: strategies[i].conf };
      }
      return null;
    }

    function attempt(a, s) {
      var flat = Ryker.dom.flatten(s.scope);
      var hay = s.loose ? norm(flat.text) : flat.text;
      var needle = s.loose ? norm(a.quote) : a.quote;
      if (!needle) return null;

      var positions = [];
      var from = 0;
      while (true) {
        var at = hay.indexOf(needle, from);
        if (at === -1) break;
        positions.push(at);
        from = at + 1;
        if (positions.length > 200) break;
      }
      if (!positions.length) return null;

      var chosen;
      if (s.withContext) {
        var scored = positions.map(function (p) {
          var pre = hay.slice(Math.max(0, p - CONTEXT), p);
          var suf = hay.slice(p + needle.length, p + needle.length + CONTEXT);
          return { p: p, score: common(pre, s.loose ? norm(a.prefix) : a.prefix, true) +
                                common(suf, s.loose ? norm(a.suffix) : a.suffix, false) };
        }).sort(function (x, y) { return y.score - x.score; });
        // Ambiguity is a reason to fail this strategy, not to guess between two
        // equally good candidates.
        if (scored.length > 1 && scored[0].score === scored[1].score && scored[0].score === 0) return null;
        chosen = scored[0].p;
      } else {
        if (positions.length > 1) return null;
        chosen = positions[0];
      }

      if (s.loose) {
        // A loose match found an offset in normalised text, which does not map
        // back to the live nodes. Re-find the raw quote near that point instead.
        var raw = flat.text.indexOf(a.quote);
        if (raw === -1) {
          var collapsed = a.quote.replace(/\s+/g, ' ').trim();
          raw = flat.text.replace(/\s+/g, ' ').indexOf(collapsed);
          if (raw === -1) return null;
        }
        chosen = raw;
        needle = a.quote;
      }

      return buildRange(s.scope, chosen, chosen + needle.length);
    }

    function common(a, b, fromEnd) {
      var n = Math.min(a.length, b.length), c = 0;
      for (var i = 0; i < n; i++) {
        var x = fromEnd ? a[a.length - 1 - i] : a[i];
        var y = fromEnd ? b[b.length - 1 - i] : b[i];
        if (x !== y) break;
        c++;
      }
      return c;
    }

    function buildRange(scope, start, end) {
      var flat = Ryker.dom.flatten(scope);
      var a = Ryker.dom.locate(flat, start);
      var b = Ryker.dom.locate(flat, end);
      if (!a || !b) return null;
      var r = document.createRange();
      try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); }
      catch (e) { return null; }
      return r;
    }

    return { capture: capture, resolve: resolve, CONTEXT: CONTEXT };
  })();


  /* ---- comments/highlight.js ------------------------------------- */
  // Painting comment ranges without mutating the report.
  //
  // CSS.highlights is the primary path because it marks text without touching the
  // DOM, which matters when the same DOM is being edited, diffed and exported. A
  // <mark> wrapper would put Ryker's elements inside the report's own content,
  // where they would land in the saved HTML, shift the block ids that comments
  // anchor against, and appear in the PDF.
  //
  // Confirmed available from file:// on 2026-08-13. The wrapper fallback exists
  // for browsers without it and is removed cleanly on teardown.
  Ryker.highlight = (function () {
    'use strict';

    var supported = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
    var registry = {};
    var wrappers = [];

    var NAMES = { open: 'ryker-open', resolved: 'ryker-resolved', active: 'ryker-active' };

    function clear() {
      if (supported) {
        Object.keys(NAMES).forEach(function (k) { CSS.highlights.delete(NAMES[k]); });
      }
      wrappers.forEach(function (w) {
        if (!w.parentNode) return;
        while (w.firstChild) w.parentNode.insertBefore(w.firstChild, w);
        w.parentNode.removeChild(w);
      });
      wrappers = [];
      registry = {};
      if (!supported) Ryker.blocks.root().normalize();
    }

    // ranges: [{ id, range, status }]
    function paint(ranges, activeId) {
      clear();
      if (!ranges.length) return;

      if (supported) {
        var buckets = { open: [], resolved: [], active: [] };
        ranges.forEach(function (r) {
          registry[r.id] = r.range;
          var key = r.id === activeId ? 'active' : (r.status === 'resolved' ? 'resolved' : 'open');
          buckets[key].push(r.range);
        });
        Object.keys(buckets).forEach(function (k) {
          if (!buckets[k].length) return;
          var h = new Highlight();
          buckets[k].forEach(function (rg) { h.add(rg); });
          CSS.highlights.set(NAMES[k], h);
        });
        return;
      }

      ranges.forEach(function (r) {
        registry[r.id] = r.range;
        try {
          var mark = document.createElement('mark');
          mark.className = 'ryker-mark ryker-mark-' + (r.id === activeId ? 'active' : (r.status || 'open'));
          mark.setAttribute('data-ryker-comment', r.id);
          r.range.surroundContents(mark);
          wrappers.push(mark);
        } catch (e) {
          // surroundContents throws on a range crossing element boundaries.
          // Skipping is correct: the comment still exists in the panel and is
          // still anchored, it simply is not painted.
        }
      });
    }

    function scrollTo(id) {
      var range = registry[id];
      if (!range) return false;
      var node = range.startContainer;
      var el = node.nodeType === 3 ? node.parentNode : node;
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
      return false;
    }

    function isSupported() { return supported; }

    return { paint: paint, clear: clear, scrollTo: scrollTo, isSupported: isSupported, NAMES: NAMES };
  })();


  /* ---- comments/comments.js -------------------------------------- */
  // Comment state: creation, resolution, re-anchoring, and the counts the
  // toolbar shows. Comments are events in the revision journal rather than a
  // document that gets rewritten, so nothing here writes storage directly.
  Ryker.comments = (function () {
    'use strict';

    var committed = {};   // folded from the journal
    var pending = { added: [], resolved: [], reopened: [], deleted: [] };
    var anchors = {};     // id -> { range, confidence } or null when unanchored
    var activeId = null;
    var visible = true;
    var listeners = [];

    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

    function rebuild() {
      committed = Ryker.journal.foldComments();
      reanchor();
      emit();
    }

    // The current view is the folded journal plus anything not yet saved.
    function current() {
      var map = {};
      Object.keys(committed).forEach(function (id) { map[id] = committed[id]; });
      pending.added.forEach(function (c) { map[c.id] = c; });
      pending.resolved.forEach(function (e) {
        if (map[e.id]) {
          map[e.id] = clone(map[e.id]);
          map[e.id].status = 'resolved';
          map[e.id].resolvedAt = e.at;
          map[e.id].resolvedBy = e.by;
        }
      });
      pending.reopened.forEach(function (e) {
        if (map[e.id]) { map[e.id] = clone(map[e.id]); map[e.id].status = 'open'; }
      });
      pending.deleted.forEach(function (e) { delete map[e.id]; });
      return map;
    }

    function clone(o) { return JSON.parse(JSON.stringify(o)); }

    function list() {
      var map = current();
      return Object.keys(map).map(function (id) { return map[id]; })
        .sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
    }

    function counts() {
      var l = list();
      return {
        total: l.length,
        open: l.filter(function (c) { return c.status !== 'resolved'; }).length,
        resolved: l.filter(function (c) { return c.status === 'resolved'; }).length,
        unanchored: l.filter(function (c) { return !anchors[c.id]; }).length
      };
    }

    function add(range, body, author) {
      var a = Ryker.anchor.capture(range);
      if (!a) return null;
      var c = {
        id: Ryker.dom.uid('c'),
        documentId: Ryker.config.load().RYKER_DOCUMENT_ID,
        quote: a.quote,
        prefix: a.prefix,
        suffix: a.suffix,
        blockId: a.blockId,
        body: String(body || ''),
        author: author,
        createdAt: Ryker.dom.now(),
        status: 'open'
      };
      pending.added.push(c);
      reanchor();
      emit();
      return c;
    }

    function resolve(id, author) {
      if (!current()[id]) return false;
      pending.reopened = pending.reopened.filter(function (e) { return e.id !== id; });
      pending.resolved.push({ id: id, at: Ryker.dom.now(), by: author });
      emit();
      return true;
    }

    function reopen(id, author) {
      if (!current()[id]) return false;
      pending.resolved = pending.resolved.filter(function (e) { return e.id !== id; });
      pending.reopened.push({ id: id, at: Ryker.dom.now(), by: author });
      emit();
      return true;
    }

    function remove(id, author) {
      // An unsaved comment is discarded outright rather than recorded as a
      // deletion, so the journal never carries an event for something that never
      // existed in it.
      var wasPending = pending.added.some(function (c) { return c.id === id; });
      pending.added = pending.added.filter(function (c) { return c.id !== id; });
      if (!wasPending) pending.deleted.push({ id: id, at: Ryker.dom.now(), by: author });
      reanchor();
      emit();
      return true;
    }

    function reanchor() {
      var map = current();
      anchors = {};
      Object.keys(map).forEach(function (id) {
        var hit = null;
        try { hit = Ryker.anchor.resolve(map[id]); } catch (e) { hit = null; }
        anchors[id] = hit;
      });
      repaint();
    }

    function repaint() {
      if (!visible) { Ryker.highlight.clear(); return; }
      var map = current();
      var ranges = [];
      Object.keys(anchors).forEach(function (id) {
        if (!anchors[id] || !map[id]) return;
        ranges.push({ id: id, range: anchors[id].range, status: map[id].status });
      });
      Ryker.highlight.paint(ranges, activeId);
    }

    function setVisible(v) { visible = !!v; repaint(); emit(); }
    function isVisible() { return visible; }
    function setActive(id) { activeId = id; repaint(); emit(); }
    function getActive() { return activeId; }
    function anchorOf(id) { return anchors[id] || null; }
    function isUnanchored(id) { return !anchors[id]; }

    function hasPending() {
      return pending.added.length + pending.resolved.length +
        pending.reopened.length + pending.deleted.length > 0;
    }

    function drain() {
      var out = {
        added: pending.added.slice(),
        resolved: pending.resolved.slice(),
        reopened: pending.reopened.slice(),
        deleted: pending.deleted.slice()
      };
      pending = { added: [], resolved: [], reopened: [], deleted: [] };
      return out;
    }

    function pendingCounts() {
      return { added: pending.added.length, resolved: pending.resolved.length };
    }

    function nextOpen() {
      var l = list().filter(function (c) { return c.status !== 'resolved' && anchors[c.id]; });
      if (!l.length) return null;
      var i = l.findIndex(function (c) { return c.id === activeId; });
      return l[(i + 1) % l.length];
    }

    return {
      rebuild: rebuild, list: list, current: current, counts: counts,
      add: add, resolve: resolve, reopen: reopen, remove: remove,
      reanchor: reanchor, repaint: repaint,
      setVisible: setVisible, isVisible: isVisible,
      setActive: setActive, getActive: getActive,
      anchorOf: anchorOf, isUnanchored: isUnanchored,
      hasPending: hasPending, drain: drain, pendingCounts: pendingCounts,
      nextOpen: nextOpen, onChange: onChange
    };
  })();


  /* ---- storage/adapter.js ---------------------------------------- */
  // Storage adapter. Every backend implements the same four calls, so the editor,
  // the comment engine and the revision panel never know which one is live.
  //
  // The active backend is always named in the toolbar. A comment written to
  // localStorage by someone who believed they were committing is the worst
  // failure this tool can produce, so the destination is stated rather than
  // inferred.
  Ryker.storage = (function () {
    'use strict';

    var backends = {};
    var active = null;
    var listeners = [];

    function register(name, backend) { backends[name] = backend; }
    function get(name) { return backends[name]; }
    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

    // Order matters: the most durable available backend wins, and local storage
    // is the floor that is always present.
    function detect() {
      var cfg = Ryker.config.load();
      if (cfg.RYKER_GITHUB_ENABLED && cfg.RYKER_GITHUB_OWNER && cfg.RYKER_GITHUB_REPO &&
          backends.github && backends.github.isReady()) {
        return use('github');
      }
      if (backends.fs && backends.fs.isReady()) return use('fs');
      return use('local');
    }

    function use(name) {
      if (!backends[name]) return active;
      active = backends[name];
      active.name = name;
      emit();
      return active;
    }

    function current() { return active || use('local'); }

    function label() {
      var b = current();
      return b ? b.describe() : 'No storage';
    }

    function canWrite() {
      var b = current();
      return !!(b && b.canWrite());
    }

    function load() {
      var b = current();
      if (!b) return Promise.resolve({ records: [] });
      return b.load().catch(function (err) {
        // A backend that cannot load must not take the document down with it.
        Ryker.log('storage load failed on ' + b.name + ': ' + (err && err.message));
        return { records: [], error: err };
      });
    }

    function save(payload) {
      var b = current();
      if (!b) return Promise.reject(new Error('No storage backend'));
      return b.save(payload);
    }

    return {
      register: register, get: get, detect: detect, use: use, current: current,
      label: label, canWrite: canWrite, load: load, save: save, onChange: onChange,
      names: function () { return Object.keys(backends); }
    };
  })();


  /* ---- storage/local.js ------------------------------------------ */
  // localStorage backend. The floor: always available, needs nothing configured,
  // and works from a ZIP on a machine with no repository and no network.
  //
  // Keyed by document id rather than by filename, per spec section 34, so
  // renaming the report does not orphan its comments.
  Ryker.storage.register('local', (function () {
    'use strict';

    function key() {
      return 'ryker:' + Ryker.config.load().RYKER_DOCUMENT_ID + ':journal';
    }

    function available() {
      try {
        var k = 'ryker:probe';
        localStorage.setItem(k, '1');
        localStorage.removeItem(k);
        return true;
      } catch (e) { return false; }
    }

    return {
      // The file on disk is never rewritten, so the journal has to be replayed
      // into the document at boot or a reload silently loses every saved edit.
      ownsDocument: false,

      isReady: function () { return available(); },
      canWrite: function () { return available(); },

      describe: function () {
        return available() ? 'This browser only' : 'Memory only, nothing is being saved';
      },

      detail: function () {
        return 'Saved in this browser under ' + key() + '. Nothing leaves this machine, ' +
          'and clearing site data removes it. Use Export to hand the work to someone else.';
      },

      load: function () {
        if (!available()) return Promise.resolve({ records: [] });
        var raw = localStorage.getItem(key());
        if (!raw) return Promise.resolve({ records: [] });
        try {
          var parsed = JSON.parse(raw);
          return Promise.resolve({ records: parsed.records || [] });
        } catch (e) {
          return Promise.resolve({ records: [], error: e });
        }
      },

      save: function (payload) {
        if (!available()) {
          return Promise.reject(new Error('This browser is refusing local storage, so nothing can be saved here.'));
        }
        try {
          localStorage.setItem(key(), JSON.stringify({
            documentId: Ryker.config.load().RYKER_DOCUMENT_ID,
            savedAt: Ryker.dom.now(),
            records: payload.records
          }));
          return Promise.resolve({ ok: true, where: 'this browser' });
        } catch (e) {
          // Quota is the realistic failure, and losing the edit to it would be
          // the offline-behaviour violation section 36 forbids. The working copy
          // stays in memory; only persistence failed.
          return Promise.reject(new Error(
            'Local storage refused the write (' + e.name + '). Your edits are still ' +
            'here in the page. Export them before closing this tab.'));
        }
      }
    };
  })());


  /* ---- storage/fs.js --------------------------------------------- */
  // File System Access backend. Writes the report and the journal straight to the
  // folder the report lives in, once a person has granted access to it.
  //
  // A page cannot scan its own directory unasked, which is correct and is why
  // section 23 asks for a "Choose report folder" step. showDirectoryPicker was
  // confirmed exposed from file:// with isSecureContext true on 2026-08-13; the
  // grant itself still needs a click.
  Ryker.storage.register('fs', (function () {
    'use strict';

    var dir = null;
    var granted = false;

    function supported() { return typeof window.showDirectoryPicker === 'function'; }

    function pick() {
      if (!supported()) {
        return Promise.reject(new Error(
          'This browser has no directory picker. Use Export to download the edited file instead.'));
      }
      return window.showDirectoryPicker({ mode: 'readwrite' }).then(function (handle) {
        dir = handle;
        granted = true;
        Ryker.storage.detect();
        return handle;
      });
    }

    function handle() { return dir; }

    function getDir(path, create) {
      var parts = path.split('/').filter(Boolean);
      var p = Promise.resolve(dir);
      parts.forEach(function (part) {
        p = p.then(function (d) { return d.getDirectoryHandle(part, { create: !!create }); });
      });
      return p;
    }

    function readFile(d, name) {
      return d.getFileHandle(name).then(function (fh) { return fh.getFile(); })
        .then(function (f) { return f.text(); });
    }

    function writeFile(d, name, contents) {
      return d.getFileHandle(name, { create: true }).then(function (fh) {
        return fh.createWritable();
      }).then(function (w) {
        return w.write(contents).then(function () { return w.close(); });
      });
    }

    function pad(n) { return String(n).padStart(4, '0'); }

    return {
      ownsDocument: true,

      isReady: function () { return granted && !!dir; },
      canWrite: function () { return granted && !!dir; },
      supported: supported,
      pick: pick,
      handle: handle,
      readFile: readFile,
      writeFile: writeFile,
      getDir: getDir,

      describe: function () {
        return dir ? 'Folder: ' + dir.name : 'No folder chosen';
      },

      detail: function () {
        return dir
          ? 'Saving into ' + dir.name + '. The report is rewritten in place and each save appends a ' +
            'new file under .ryker/revisions/.'
          : 'Choose the folder the report sits in to save changes straight to disk.';
      },

      load: function () {
        if (!dir) return Promise.resolve({ records: [] });
        return getDir('.ryker/revisions', false).then(function (d) {
          var reads = [];
          var it = d.values();
          function step() {
            return it.next().then(function (res) {
              if (res.done) return null;
              var entry = res.value;
              if (entry.kind === 'file' && /\.json$/.test(entry.name)) {
                reads.push(readFile(d, entry.name).then(function (t) {
                  try { return JSON.parse(t); } catch (e) { return null; }
                }));
              }
              return step();
            });
          }
          return step().then(function () { return Promise.all(reads); });
        }).then(function (list) {
          return { records: (list || []).filter(Boolean) };
        }).catch(function () {
          // No .ryker directory yet is the ordinary first-run case, not an error.
          return { records: [] };
        });
      },

      // Only the newly appended records are written. Rewriting the whole log on
      // every save would defeat the point of an append-only journal.
      save: function (payload) {
        if (!dir) return Promise.reject(new Error('No folder chosen yet.'));
        var cfg = Ryker.config.load();
        return getDir('.ryker/revisions', true).then(function (d) {
          var writes = (payload.appended || []).map(function (rec) {
            return writeFile(d, pad(rec.seq) + '.json', JSON.stringify(rec, null, 2));
          });
          return Promise.all(writes);
        }).then(function () {
          return getDir('.ryker', true);
        }).then(function (d) {
          return writeFile(d, 'document.json', JSON.stringify({
            documentId: cfg.RYKER_DOCUMENT_ID,
            documentPath: cfg.RYKER_DOCUMENT_PATH,
            updatedAt: Ryker.dom.now(),
            revisions: payload.records.length
          }, null, 2));
        }).then(function () {
          if (!payload.documentHtml) return null;
          return writeFile(dir, cfg.RYKER_DOCUMENT_PATH, payload.documentHtml);
        }).then(function () {
          return { ok: true, where: dir.name };
        });
      }
    };
  })());


  /* ---- storage/github.js ----------------------------------------- */
  // GitHub backend, over the Contents API only.
  //
  // Measured 2026-08-13: api.github.com answers a CORS preflight for PUT
  // .../contents/... with access-control-allow-origin: *, PUT among the allowed
  // methods and Authorization among the allowed headers, and it answers the same
  // way to Origin: null. So a report opened from disk can commit, with no server
  // anywhere.
  //
  // Authentication is a fine-grained token, not the device flow. github.com's
  // login endpoints send no CORS headers at all, so the device flow cannot
  // complete in a page without a relay, and a relay would make Ryker
  // infrastructure mandatory. A fine-grained token also carries the repository
  // restriction natively: GitHub scopes it to selected repositories with
  // Contents: read and write as a permission in its own right, so the guarantee
  // is enforced by GitHub rather than promised by Ryker.
  //
  // The token lives in sessionStorage and nowhere else. Never in localStorage,
  // never in the document, never in an export, never in a commit.
  Ryker.storage.register('github', (function () {
    'use strict';

    var API = 'https://api.github.com';
    var SESSION_KEY = 'ryker:gh:token';
    var identity = null;
    var access = null;
    var docSha = null;

    function cfg() { return Ryker.config.load(); }
    function repo() { return cfg().RYKER_GITHUB_OWNER + '/' + cfg().RYKER_GITHUB_REPO; }

    function token() {
      try { return sessionStorage.getItem(SESSION_KEY) || null; } catch (e) { return null; }
    }

    function setToken(t) {
      try {
        if (t) sessionStorage.setItem(SESSION_KEY, t);
        else sessionStorage.removeItem(SESSION_KEY);
      } catch (e) {}
      identity = null; access = null;
    }

    function signOut() { setToken(null); Ryker.storage.detect(); }

    function req(path, opts) {
      opts = opts || {};
      var headers = {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      if (token()) headers.Authorization = 'Bearer ' + token();
      if (opts.body) headers['Content-Type'] = 'application/json';
      return fetch(API + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      }).then(function (res) {
        return res.text().then(function (t) {
          var json = null;
          try { json = t ? JSON.parse(t) : null; } catch (e) {}
          return { ok: res.ok, status: res.status, json: json, text: t };
        });
      });
    }

    function b64(str) {
      var bytes = new TextEncoder().encode(str);
      var bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }

    function unb64(str) {
      var bin = atob(String(str).replace(/\s/g, ''));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }

    // Verification calls the API and reports the access it found. The paste is
    // never trusted on its own, because a token that reads but cannot write
    // would otherwise let someone edit for an hour and fail at the save.
    function verify() {
      if (!token()) return Promise.resolve({ ok: false, reason: 'No token' });
      return req('/user').then(function (me) {
        if (!me.ok) {
          return { ok: false, reason: me.status === 401
            ? 'GitHub rejected this token.'
            : 'GitHub answered ' + me.status + ' for the account check.' };
        }
        identity = {
          id: me.json.id,
          login: me.json.login,
          name: me.json.name || me.json.login,
          source: 'github'
        };
        return req('/repos/' + repo()).then(function (r) {
          if (!r.ok) {
            return { ok: false, identity: identity, reason: r.status === 404
              ? 'This token cannot see ' + repo() + '. Either the repository name is wrong, ' +
                'or the token was not granted access to it.'
              : 'GitHub answered ' + r.status + ' for ' + repo() + '.' };
          }
          var perms = r.json.permissions || {};
          var wanted = cfg().RYKER_GITHUB_REPOSITORY_ID;
          if (wanted && String(r.json.id) !== String(wanted)) {
            return { ok: false, identity: identity, reason:
              'The repository at ' + repo() + ' has id ' + r.json.id + ', but this report is ' +
              'configured for id ' + wanted + '. Refusing to write to the wrong repository.' };
          }
          access = {
            push: !!perms.push,
            admin: !!perms.admin,
            repositoryId: r.json.id,
            private: !!r.json.private,
            defaultBranch: r.json.default_branch
          };
          if (!access.push) {
            return { ok: false, identity: identity, access: access, reason:
              identity.login + ' can read ' + repo() + ' but cannot write to it. ' +
              'Ryker stays read-only until the repository owner grants write access.' };
          }
          return { ok: true, identity: identity, access: access };
        });
      }).catch(function (e) {
        return { ok: false, reason: 'Could not reach GitHub: ' + e.message };
      });
    }

    function contentsPath(p) {
      return '/repos/' + repo() + '/contents/' + p.split('/').map(encodeURIComponent).join('/') +
        '?ref=' + encodeURIComponent(cfg().RYKER_GITHUB_BRANCH);
    }

    function putPath(p) {
      return '/repos/' + repo() + '/contents/' + p.split('/').map(encodeURIComponent).join('/');
    }

    function pad(n) { return String(n).padStart(4, '0'); }

    return {
      ownsDocument: true,

      isReady: function () { return !!token() && !!access && access.push; },
      canWrite: function () { return !!token() && !!access && access.push; },
      setToken: setToken,
      hasToken: function () { return !!token(); },
      signOut: signOut,
      verify: verify,
      identity: function () { return identity; },
      access: function () { return access; },
      documentSha: function () { return docSha; },

      describe: function () {
        if (!token()) return 'GitHub, not signed in';
        if (!access) return 'GitHub, not verified';
        if (!access.push) return 'GitHub, read-only';
        return repo();
      },

      detail: function () {
        return 'Saving to ' + repo() + ' on branch ' + cfg().RYKER_GITHUB_BRANCH +
          ', as ' + (identity ? identity.login : 'an unverified account') + '.';
      },

      load: function () {
        if (!token()) return Promise.resolve({ records: [] });
        return req(contentsPath('.ryker/revisions')).then(function (res) {
          if (!res.ok || !Array.isArray(res.json)) return { records: [] };
          var files = res.json.filter(function (f) {
            return f.type === 'file' && /\.json$/.test(f.name);
          });
          return Promise.all(files.map(function (f) {
            return req(contentsPath('.ryker/revisions/' + f.name)).then(function (r) {
              if (!r.ok || !r.json || !r.json.content) return null;
              try { return JSON.parse(unb64(r.json.content)); } catch (e) { return null; }
            });
          })).then(function (list) {
            return { records: list.filter(Boolean) };
          });
        }).then(function (out) {
          // The document's own sha is what makes conflict detection possible, so
          // it is fetched at load time and compared at save time.
          return req(contentsPath(cfg().RYKER_DOCUMENT_PATH)).then(function (r) {
            if (r.ok && r.json && r.json.sha) docSha = r.json.sha;
            return out;
          });
        });
      },

      // Spec section 18: never blindly overwrite a newer revision. The sha the
      // document carried at load is compared against the sha it carries now, and
      // a difference stops the save rather than resolving it.
      checkConflict: function () {
        if (!token()) return Promise.resolve({ conflict: false });
        return req(contentsPath(cfg().RYKER_DOCUMENT_PATH)).then(function (r) {
          if (!r.ok) return { conflict: false, unknown: true };
          var live = r.json && r.json.sha;
          if (docSha && live && live !== docSha) {
            return { conflict: true, loadedSha: docSha, liveSha: live };
          }
          return { conflict: false, liveSha: live };
        });
      },

      save: function (payload) {
        if (!this.canWrite()) {
          return Promise.reject(new Error('Not signed in with write access to ' + repo() + '.'));
        }
        var branch = cfg().RYKER_GITHUB_BRANCH;
        var docPath = cfg().RYKER_DOCUMENT_PATH;
        var summary = payload.summary || {};
        var message = (payload.message || 'Update ' + docPath) + '\n\n' +
          'Ryker-Document: ' + docPath + '\n' +
          'Ryker-Revision: ' + (payload.appended.length ? payload.appended[payload.appended.length - 1].seq : '') + '\n' +
          'Ryker-Comments-Added: ' + (summary.commentsAdded || 0) + '\n' +
          'Ryker-Comments-Resolved: ' + (summary.commentsResolved || 0);

        var chain = Promise.resolve();
        payload.appended.forEach(function (rec) {
          chain = chain.then(function () {
            return req(putPath('.ryker/revisions/' + pad(rec.seq) + '.json'), {
              method: 'PUT',
              body: {
                message: 'Ryker revision ' + rec.seq + ' for ' + docPath,
                content: b64(JSON.stringify(rec, null, 2)),
                branch: branch
              }
            }).then(function (r) {
              if (!r.ok) throw new Error('Could not write revision ' + rec.seq + ': ' +
                ((r.json && r.json.message) || r.status));
            });
          });
        });

        return chain.then(function () {
          if (!payload.documentHtml) return null;
          return req(putPath(docPath), {
            method: 'PUT',
            body: {
              message: message,
              content: b64(payload.documentHtml),
              sha: docSha || undefined,
              branch: branch
            }
          }).then(function (r) {
            if (!r.ok) {
              throw new Error(r.status === 409
                ? 'The document changed on GitHub since you began editing.'
                : 'Could not write the document: ' + ((r.json && r.json.message) || r.status));
            }
            if (r.json && r.json.content) docSha = r.json.content.sha;
            return r;
          });
        }).then(function () {
          return { ok: true, where: repo() };
        });
      }
    };
  })());


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
      // only on collapse. The full build starts collapsed and never set them, so
      // this shipped invisibly; Lite starts expanded, so EVERY Lite export
      // carried them. Found by the fixture harness, 2026-08-16.
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

    // The journal as a portable file, so someone holding only the ZIP can hand
    // their comments back to the author.
    function journalJson() {
      if (!Ryker.journal) return null;
      var cfg = Ryker.config.load();
      return JSON.stringify({
        documentId: cfg.RYKER_DOCUMENT_ID,
        documentPath: cfg.RYKER_DOCUMENT_PATH,
        exportedAt: Ryker.dom.now(),
        rykerVersion: Ryker.VERSION,
        records: Ryker.journal.serialize()
      }, null, 2);
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
      journalJson: journalJson, manifest: manifest
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
            if (e.name === '.ryker' || e.name.charAt(0) === '.') return step();
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

    // ryker-lite has no storage adapter at all, so the folder backend may simply
    // not exist in this build. Packaging still works from what the document
    // carries; only the folder-picking half is unavailable.
    function fsBackend() {
      return Ryker.storage ? Ryker.storage.get('fs') : null;
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
      if (Ryker.journal) {
        row('ryker-journal.json', Ryker.journal.count() > 0,
            Ryker.journal.count() + ' revisions', { kind: 'journal' });
      }

      files.forEach(function (f) {
        row(f.name, true, f.bytes ? kb(f.bytes) : f.source, { kind: 'asset', file: f });
      });

      var note = fromFolder
        ? '<div class="note ok">Listing the folder you granted access to, so anything added since ' +
          'the report was built appears here too.</div>'
        : '<div class="note">No folder access, so this lists what the document already carries ' +
          'plus anything named in the build manifest. Choose the report folder to see the rest.</div>';

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
        if (p.kind === 'journal') {
          return Promise.resolve({ name: 'ryker-journal.json', data: Ryker.exportHtml.journalJson() });
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
  // The exception is ::highlight(), which styles text in the host document and
  // therefore cannot be scoped to a shadow root. That rule set is deliberately
  // tiny and touches nothing but the highlight pseudo-elements and the print
  // stylesheet.
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
      '--rk-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
      '--rk-ins-bg:rgba(21,128,61,.14);--rk-ins-fg:#14532d;',
      '--rk-del-bg:rgba(190,18,60,.12);--rk-del-fg:#881337;'
    ].join('');

    var documentCss = [
      '::highlight(ryker-open){background:rgba(250,204,21,.36);color:inherit}',
      '::highlight(ryker-resolved){background:rgba(74,222,128,.22);color:inherit}',
      '::highlight(ryker-active){background:rgba(251,146,60,.55);color:inherit}',
      'mark.ryker-mark{background:rgba(250,204,21,.36);color:inherit;padding:0}',
      'mark.ryker-mark-resolved{background:rgba(74,222,128,.22)}',
      'mark.ryker-mark-active{background:rgba(251,146,60,.55)}',
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
        'mark.ryker-mark{background:none !important}' +
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

      ':is(button.rk,.handle,.floater,input.rk,textarea.rk,.revrow):focus-visible{',
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

      // ---- selection action -------------------------------------------------
      // Black on white. It sits over report content rather
      // than over Ryker chrome, so it has to read as an overlay in both light and
      // dark instead of blending into either.
      '.floater{position:fixed;z-index:2147483050;background:#000;color:#fff;',
      '  border:1px solid rgba(255,255,255,.14);border-radius:var(--rk-r-md);',
      '  padding:7px 13px;cursor:pointer;font:inherit;font-size:12px;font-weight:600;',
      '  letter-spacing:.01em;box-shadow:0 4px 16px rgba(0,0,0,.42);',
      '  display:flex;align-items:center;gap:7px;transition:background .12s}',
      '.floater:hover{background:#242424}',
      '.floater .fdot{width:6px;height:6px;border-radius:50%;background:#fbbf24;flex:none}',

      // ---- side panel -------------------------------------------------------
      // Sits below the toolbar rather than under it. Both are fixed to the top
      // edge and the bar has the higher z-index, so anchoring the panel at 0 hid
      // its own header. Custom properties inherit through the shadow boundary,
      // so the offset the shell already publishes is readable from in here.
      '.panel{position:fixed;top:var(--ryker-offset,0px);right:0;bottom:0;width:380px;max-width:92vw;z-index:2147482900;',
      '  background:var(--rk-bg);border-left:1px solid var(--rk-line);display:flex;flex-direction:column;',
      '  box-shadow:var(--rk-sh-xl)}',
      '.panel header{padding:var(--rk-s3) var(--rk-s4);border-bottom:1px solid var(--rk-line);',
      '  display:flex;align-items:center;gap:var(--rk-s2)}',
      '.panel header h2{margin:0;font-size:13px;font-weight:700;letter-spacing:.01em}',
      '.panel .body{flex:1;overflow-y:auto;padding:var(--rk-s3) var(--rk-s4)}',
      '.panel .foot{padding:var(--rk-s3) var(--rk-s4);border-top:1px solid var(--rk-line);',
      '  display:flex;gap:6px;flex-wrap:wrap;background:var(--rk-bg2)}',

      // ---- ryker-lite instruction pane --------------------------------------
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

      '.card{border:1px solid var(--rk-line);border-radius:var(--rk-r-lg);padding:var(--rk-s3);',
      '  margin-bottom:var(--rk-s2);background:var(--rk-bg2)}',
      '.card.active{border-color:var(--rk-accent);box-shadow:0 0 0 3px var(--rk-accent-soft)}',
      '.card.resolved{opacity:.65}',
      '.card.orphan{border-color:var(--rk-warn)}',
      '.card .quote{font-size:12px;color:var(--rk-fg2);border-left:2px solid var(--rk-line2);',
      '  padding-left:var(--rk-s2);margin:var(--rk-s2) 0;font-style:italic;overflow-wrap:anywhere}',
      '.card .who{font-size:11px;color:var(--rk-muted);margin-bottom:var(--rk-s2)}',
      '.card .who b{color:var(--rk-fg2);font-weight:600}',
      '.card .text{white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:var(--rk-s3);font-size:12.5px}',
      '.card .acts{display:flex;gap:5px;flex-wrap:wrap}',
      '.tag{display:inline-block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;',
      '  border-radius:var(--rk-r-sm);padding:2px 7px;font-weight:700}',
      '.tag.open{background:var(--rk-warn-soft);color:var(--rk-warn)}',
      '.tag.resolved{background:var(--rk-ok-soft);color:var(--rk-ok)}',
      '.tag.orphan{background:var(--rk-danger-soft);color:var(--rk-danger)}',

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
      '.modal .quote{font-size:12px;color:var(--rk-fg2);font-style:italic;',
      '  background:var(--rk-bg2);border-left:3px solid var(--rk-line2);',
      '  border-radius:0 var(--rk-r-md) var(--rk-r-md) 0;padding:var(--rk-s2) var(--rk-s3);',
      '  margin:0 0 var(--rk-s2);overflow-wrap:anywhere}',

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

      '.revrow{border:1px solid var(--rk-line);border-radius:var(--rk-r-lg);padding:var(--rk-s3);',
      '  margin-bottom:var(--rk-s2);cursor:pointer;background:var(--rk-bg2);',
      '  transition:border-color .12s,box-shadow .12s}',
      '.revrow:hover{border-color:var(--rk-line2)}',
      '.revrow.on{border-color:var(--rk-accent);box-shadow:0 0 0 3px var(--rk-accent-soft)}',
      '.revrow .seq{font-weight:700;font-size:12.5px}',
      '.revrow .meta{font-size:11px;color:var(--rk-muted);margin-top:3px}',
      '.revrow .stats{font-size:11px;margin-top:7px;display:flex;gap:var(--rk-s3);flex-wrap:wrap;font-weight:500}',
      '.stat-add{color:var(--rk-ok)}.stat-del{color:var(--rk-danger)}.stat-cm{color:var(--rk-muted)}',

      '.blockdiff{border:1px solid var(--rk-line);border-radius:var(--rk-r-lg);',
      '  padding:var(--rk-s3);margin-bottom:var(--rk-s2);background:var(--rk-bg2)}',
      '.blockdiff .lbl{font-size:10.5px;font-weight:600;color:var(--rk-muted);',
      '  margin-bottom:7px;overflow-wrap:anywhere;text-transform:uppercase;letter-spacing:.05em}',
      '.blockdiff .txt{font-size:12.5px;overflow-wrap:anywhere;color:var(--rk-fg)}',
      '.blockdiff ins{background:var(--rk-ins-bg);color:var(--rk-ins-fg);',
      '  text-decoration:none;border-radius:3px;padding:0 2px}',
      '.blockdiff del{background:var(--rk-del-bg);color:var(--rk-del-fg);border-radius:3px;padding:0 2px}',

      '.empty{color:var(--rk-muted);font-size:12px;padding:var(--rk-s6) var(--rk-s1);text-align:center}',
      '.muted{color:var(--rk-muted)}',
      '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',

      '@media (max-width:720px){',
      '  .panel{width:100%}.bar{padding:6px 8px}.brand{display:none}',
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

      // The only stylesheet Ryker adds to the host document. It carries the
      // highlight pseudo-elements, which cannot be scoped to a shadow root, and
      // the print rules that remove every trace of Ryker from the PDF.
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


    // Shown when the credential scan stops an export. Lives here rather than with
    // the save flow because the packager and ryker-lite both reach it and neither
    // has a save flow.
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


  /* ---- ui/panel.js ----------------------------------------------- */
  // The side panel. One surface, two views: comments and revisions.
  Ryker.panel = (function () {
    'use strict';

    var node = null, bodyEl = null, titleEl = null, footEl = null;
    var view = null;
    var filter = 'open';
    var activeRev = null;

    function d() { return Ryker.dom; }

    function ensure() {
      if (node) return node;
      titleEl = d().el('h2', { text: 'Comments' });
      bodyEl = d().el('div', { class: 'body' });
      footEl = d().el('div', { class: 'foot' });
      node = d().el('div', { class: 'panel', role: 'complementary' }, [
        d().el('header', {}, [
          titleEl,
          d().el('div', { class: 'spacer' }),
          d().el('button', { class: 'rk', text: 'Close', onclick: close })
        ]),
        bodyEl,
        footEl
      ]);
      Ryker.shell.add(node);
      return node;
    }

    function open(which) {
      ensure();
      view = which;
      node.style.display = 'flex';
      render();
      reflow();
      Ryker.toolbar.sync();
    }

    // The panel prefers to sit in the layout's own right margin. Only when the
    // margin is too narrow does the report give up any width, and only as much as
    // the shortfall.
    function reflow() {
      if (!node || node.style.display === 'none') return;
      Ryker.shell.setPanelSpace(node);
    }

    function close() {
      if (node) node.style.display = 'none';
      view = null;
      Ryker.shell.releasePanelSpace();
      if (activeRev) { Ryker.review.exit(); activeRev = null; }
      Ryker.toolbar.sync();
    }

    function toggle(which) {
      if (view === which) close(); else open(which);
    }

    function isOpen(which) { return view != null && (!which || view === which); }

    function render() {
      if (!view) return;
      if (view === 'comments') renderComments();
      else renderRevisions();
    }

    // ---- comments -----------------------------------------------------------

    function renderComments() {
      titleEl.textContent = 'Comments';
      bodyEl.innerHTML = '';
      footEl.innerHTML = '';

      var counts = Ryker.comments.counts();
      var all = Ryker.comments.list();
      var shown = all.filter(function (c) {
        if (filter === 'open') return c.status !== 'resolved';
        if (filter === 'resolved') return c.status === 'resolved';
        return true;
      });

      ['open', 'resolved', 'all'].forEach(function (f) {
        footEl.appendChild(d().el('button', {
          class: 'rk' + (filter === f ? ' on' : ''),
          text: f === 'open' ? 'Open (' + counts.open + ')'
            : f === 'resolved' ? 'Resolved (' + counts.resolved + ')'
            : 'All (' + counts.total + ')',
          onclick: function () { filter = f; render(); }
        }));
      });
      footEl.appendChild(d().el('button', {
        class: 'rk', text: 'Next open',
        onclick: function () {
          var n = Ryker.comments.nextOpen();
          if (!n) return;
          Ryker.comments.setActive(n.id);
          Ryker.highlight.scrollTo(n.id);
          render();
        }
      }));

      if (counts.unanchored) {
        bodyEl.appendChild(d().el('div', { class: 'note warn' }, [
          d().el('div', {
            text: counts.unanchored + (counts.unanchored === 1 ? ' comment is' : ' comments are') +
              ' unanchored. The text they were attached to is no longer findable, so they are ' +
              'listed here rather than pointed at content that may not be what was meant.'
          })
        ]));
      }

      if (!shown.length) {
        bodyEl.appendChild(d().el('div', {
          class: 'empty',
          text: filter === 'open' ? 'No open comments.' : 'Nothing here.'
        }));
        return;
      }

      shown.forEach(function (c) { bodyEl.appendChild(commentCard(c)); });
    }

    function commentCard(c) {
      var orphan = Ryker.comments.isUnanchored(c.id);
      var active = Ryker.comments.getActive() === c.id;
      var cls = 'card' + (active ? ' active' : '') +
        (c.status === 'resolved' ? ' resolved' : '') + (orphan ? ' orphan' : '');

      var tags = d().el('div', {}, [
        d().el('span', {
          class: 'tag ' + (c.status === 'resolved' ? 'resolved' : 'open'),
          text: c.status === 'resolved' ? 'Resolved' : 'Open'
        }),
        orphan ? d().el('span', { class: 'tag orphan', text: 'Unanchored' }) : null
      ]);

      var who = d().el('div', { class: 'who' });
      who.appendChild(d().el('b', { text: (c.author && c.author.name) || 'Unknown' }));
      who.appendChild(document.createTextNode(
        ' ' + d().fmtDate(c.createdAt) +
        (c.author && c.author.source === 'self' ? ' (self-asserted)' : '')));

      var acts = d().el('div', { class: 'acts' });
      if (!orphan) {
        acts.appendChild(d().el('button', {
          class: 'rk', text: 'Show',
          onclick: function () {
            Ryker.comments.setActive(c.id);
            Ryker.highlight.scrollTo(c.id);
            render();
          }
        }));
      }
      acts.appendChild(d().el('button', {
        class: 'rk',
        text: c.status === 'resolved' ? 'Reopen' : 'Resolve',
        onclick: function () {
          var me = Ryker.identity.current();
          if (c.status === 'resolved') Ryker.comments.reopen(c.id, me);
          else Ryker.comments.resolve(c.id, me);
          render();
        }
      }));
      acts.appendChild(d().el('button', {
        class: 'rk danger', text: 'Delete',
        onclick: function () {
          Ryker.dialog.confirm('Delete this comment?',
            '<p>The deletion is recorded in the next save, so the comment stays visible in ' +
            'the revision history. Nothing is erased from the record.</p>',
            'Delete', function () {
              Ryker.comments.remove(c.id, Ryker.identity.current());
              render();
            });
        }
      }));

      return d().el('div', { class: cls }, [
        tags,
        d().el('div', { class: 'quote', text: '"' + c.quote + '"' }),
        who,
        // textContent, never innerHTML. This is what closes the injection path
        // left open by writing the sanitiser rather than vendoring one.
        d().el('div', { class: 'text', text: c.body }),
        acts
      ]);
    }

    // ---- revisions ----------------------------------------------------------

    function renderRevisions() {
      titleEl.textContent = 'Revisions';
      bodyEl.innerHTML = '';
      footEl.innerHTML = '';

      var records = Ryker.journal.all().slice().reverse();
      if (!records.length) {
        bodyEl.appendChild(d().el('div', {
          class: 'empty',
          text: 'No revisions yet. The first save creates one.'
        }));
        return;
      }

      footEl.appendChild(d().el('button', {
        class: 'rk', text: 'Exit revision view',
        onclick: function () { Ryker.review.exit(); activeRev = null; render(); }
      }));

      records.forEach(function (r) {
        var s = Ryker.journal.summarize(r);
        var row = d().el('div', {
          class: 'revrow' + (activeRev === r.id ? ' on' : ''),
          role: 'button', tabindex: '0',
          onclick: function () { showRevision(r); }
        }, [
          d().el('div', { class: 'seq', text: 'Revision ' + r.seq }),
          d().el('div', {
            class: 'meta',
            text: ((r.author && r.author.name) || 'Unknown') + '  |  ' + d().fmtDate(r.timestamp) +
              (r.author && r.author.source === 'self' ? '  |  self-asserted' : '')
          }),
          d().el('div', { class: 'stats' }, [
            d().el('span', { class: 'stat-add', text: s.additions + ' additions' }),
            d().el('span', { class: 'stat-del', text: s.removals + ' removals' }),
            s.commentsAdded ? d().el('span', { class: 'stat-cm', text: s.commentsAdded + ' comments added' }) : null,
            s.commentsResolved ? d().el('span', { class: 'stat-cm', text: s.commentsResolved + ' comments resolved' }) : null
          ])
        ]);
        if (r.message) row.appendChild(d().el('div', { class: 'meta', text: r.message }));
        bodyEl.appendChild(row);
      });
    }

    function showRevision(r) {
      activeRev = r.id;
      render();
      Ryker.review.show(r);
    }

    function refresh() { if (view) render(); }

    return {
      open: open, close: close, toggle: toggle, isOpen: isOpen, reflow: reflow,
      render: render, refresh: refresh,
      view: function () { return view; }
    };
  })();


  /* ---- revisions/review.js --------------------------------------- */
  // Revision review. Answers what changed, who changed it and when, without
  // sending anyone to a raw commit listing.
  //
  // The panel lists revisions; this shows one. Because the journal captured each
  // delta at write time, a revision renders as a set of block-level prose diffs
  // rather than as a unified diff over the whole file.
  Ryker.review = (function () {
    'use strict';

    var current = null;

    function show(record) {
      current = record;
      var d = Ryker.dom;
      var s = Ryker.journal.summarize(record);

      var wrap = d.el('div');

      wrap.appendChild(d.el('div', { class: 'note' }, [
        d.el('div', {
          text: 'Revision ' + record.seq + ', by ' + ((record.author && record.author.name) || 'Unknown') +
            (record.author && record.author.source === 'self' ? ' (self-asserted)' : '') +
            ', ' + d.fmtDate(record.timestamp) + '. ' +
            s.additions + ' additions, ' + s.removals + ' removals across ' +
            s.blocks + (s.blocks === 1 ? ' block' : ' blocks') +
            (s.commentsAdded ? ', ' + s.commentsAdded + ' comments added' : '') +
            (s.commentsResolved ? ', ' + s.commentsResolved + ' comments resolved' : '') + '.'
        })
      ]));

      if (record.message) {
        wrap.appendChild(d.el('p', { class: 'muted', text: record.message }));
      }

      if (!record.changes.length) {
        wrap.appendChild(d.el('p', { class: 'muted', text: 'No text changed in this revision.' }));
      }

      record.changes.forEach(function (c) {
        var box = d.el('div', { class: 'blockdiff' });
        box.appendChild(d.el('div', { class: 'lbl', text: Ryker.blocks.label(c.id) }));

        var txt = d.el('div', { class: 'txt' });
        if (c.kind === 'added') {
          txt.appendChild(d.el('ins', { text: textOf(c.after) }));
        } else if (c.kind === 'removed') {
          txt.appendChild(d.el('del', { text: textOf(c.before) }));
        } else {
          txt.appendChild(Ryker.diff.renderInline(Ryker.diff.words(c.before, c.after)));
        }
        box.appendChild(txt);

        if (c.before != null) {
          box.appendChild(d.el('div', { class: 'acts', style: 'margin-top:7px' }, [
            d.el('button', {
              class: 'rk', text: 'Restore this block to the earlier text',
              onclick: function () {
                if (!Ryker.editable.isOn()) {
                  Ryker.dialog.alert('Edit Mode is off',
                    'Turn on Edit Mode before restoring, so the change is recorded as an edit ' +
                    'you made rather than applied silently.', 'warn');
                  return;
                }
                Ryker.editable.revertBlock(c.id, c.before);
                Ryker.dialog.closeTop();
                Ryker.toolbar.sync();
              }
            })
          ]));
        }
        wrap.appendChild(box);
      });

      (record.comments.added || []).forEach(function (cm) {
        wrap.appendChild(d.el('div', { class: 'blockdiff' }, [
          d.el('div', { class: 'lbl', text: 'Comment added on "' + trim(cm.quote) + '"' }),
          d.el('div', { class: 'txt', text: cm.body })
        ]));
      });

      Ryker.dialog.open({ title: 'Revision ' + record.seq, body: wrap });
    }

    function textOf(html) {
      var t = document.createElement('div');
      t.innerHTML = html == null ? '' : html;
      return t.textContent || '';
    }

    function trim(s) {
      s = String(s || '');
      return s.length > 48 ? s.slice(0, 45) + '...' : s;
    }

    function exit() { current = null; }

    return { show: show, exit: exit, current: function () { return current; } };
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
      if (Ryker.comments) Ryker.comments.reanchor();
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
      if (Ryker.comments) Ryker.comments.reanchor();
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
          if (Ryker.comments) Ryker.comments.reanchor();
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
      if (Ryker.comments) Ryker.comments.reanchor();
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
      if (Ryker.comments) Ryker.comments.reanchor();
      emit();
    }

    function revertBlock(id, html) {
      var node = Ryker.blocks.byId(id);
      if (!node || html == null) return false;
      node.innerHTML = Ryker.sanitize.html(html);
      if (baseline && Ryker.blocks.htmlOf(baseline[id]) !== node.innerHTML) node.classList.add('ryker-dirty');
      if (Ryker.comments) Ryker.comments.reanchor();
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
      if (Ryker.comments) Ryker.comments.reanchor();
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
      if (Ryker.select) {
        formatParts.push(d().el('span', { class: 'fb-sep' }));
        formatParts.push(act(null, 'Comment on this text', function () {
          Ryker.select.compose(lastRange);
        }, 'copy'));
      }

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
      if (Ryker.comments) Ryker.comments.reanchor();
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
      if (Ryker.comments) Ryker.comments.reanchor();
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


  /* ---- editor/save.js -------------------------------------------- */
  // The save flow. Edits accumulate in a working state and land as one revision,
  // after a confirmation that states exactly what is about to be written and
  // where.
  Ryker.save = (function () {
    'use strict';

    function pending() {
      var changes = Ryker.editable.changes();
      var cm = Ryker.comments.pendingCounts();
      return {
        changes: changes,
        commentsAdded: cm.added,
        commentsResolved: cm.resolved,
        any: changes.length > 0 || Ryker.comments.hasPending()
      };
    }

    function start() {
      var p = pending();
      if (!p.any) {
        Ryker.dialog.alert('Nothing to save', 'No text has changed and no comments are waiting.');
        return;
      }
      if (Ryker.identity.needsName()) {
        Ryker.identity.promptForName(function () { start(); });
        return;
      }

      var gh = Ryker.storage.current();
      if (gh && gh.name === 'github' && gh.checkConflict) {
        gh.checkConflict().then(function (res) {
          if (res.conflict) { conflictDialog(res); return; }
          confirmDialog(p);
        });
        return;
      }
      confirmDialog(p);
    }

    function conflictDialog(res) {
      var d = Ryker.dom;
      Ryker.dialog.open({
        title: 'The document changed on GitHub',
        body: d.el('div', {}, [
          d.el('div', { class: 'note bad' }, [
            d.el('div', {
              text: 'The document changed on GitHub since you began editing. Saving now would ' +
                'overwrite whatever that change was.'
            })
          ]),
          d.el('p', {
            text: 'Ryker will not merge two versions of a report automatically, because a wrong ' +
              'merge here loses someone\'s work silently. Export your version, reload the page to ' +
              'pick up theirs, and reapply your edits.'
          }),
          d.el('p', { class: 'muted', text: 'Loaded at ' + short(res.loadedSha) + ', now at ' + short(res.liveSha) + '.' })
        ]),
        buttons: [
          { label: 'Close' },
          {
            label: 'Export my version', primary: true,
            action: function () {
              var out = Ryker.exportHtml.scanned('clean');
              if (out.hits.length) { Ryker.dialog.leak(out.hits); return; }
              Ryker.exportHtml.download(out.html, Ryker.exportHtml.baseName() + '-mine.html');
            }
          }
        ]
      });
    }

    function short(sha) { return sha ? String(sha).slice(0, 8) : 'unknown'; }

    function confirmDialog(p) {
      var d = Ryker.dom;
      var cfg = Ryker.config.load();
      var backend = Ryker.storage.current();

      var msg = d.el('input', {
        class: 'rk', type: 'text',
        placeholder: 'What changed, in a few words',
        value: 'Update ' + cfg.RYKER_DOCUMENT_PATH
      });

      var list = d.el('div', { class: 'filelist' });
      p.changes.forEach(function (c) {
        var n = Ryker.diff.countChange(c);
        list.appendChild(d.el('div', { class: 'filerow' }, [
          d.el('span', { class: 'nm', text: Ryker.blocks.label(c.id) }),
          d.el('span', { class: 'sz', text: '+' + n.additions + ' / -' + n.removals })
        ]));
      });
      if (!p.changes.length) {
        list.appendChild(d.el('div', { class: 'filerow' }, [
          d.el('span', { class: 'nm muted', text: 'No text changes, comments only' })
        ]));
      }

      Ryker.dialog.open({
        title: 'Save changes',
        body: d.el('div', {}, [
          d.el('div', { class: 'note ' + (Ryker.storage.canWrite() ? 'ok' : 'warn') }, [
            d.el('div', {
              text: 'Saving to: ' + backend.describe() + '. ' + (backend.detail ? backend.detail() : '')
            })
          ]),
          d.el('label', { class: 'rk', text: 'Blocks changing' }),
          list,
          d.el('label', { class: 'rk', text: 'Comments' }),
          d.el('div', {
            text: p.commentsAdded + ' added, ' + p.commentsResolved + ' resolved'
          }),
          d.el('label', { class: 'rk', text: 'Author' }),
          d.el('div', { text: Ryker.identity.label() }),
          d.el('label', { class: 'rk', text: 'Message' }),
          msg
        ]),
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Save', primary: true,
            action: function (api) {
              commit(msg.value.trim(), api);
              return false;
            },
            keepOpen: true
          }
        ]
      });
    }

    function commit(message, api) {
      var p = pending();
      var cfg = Ryker.config.load();
      var drained = Ryker.comments.drain();

      var record = Ryker.journal.make({
        documentId: cfg.RYKER_DOCUMENT_ID,
        author: Ryker.identity.current(),
        message: message,
        changes: p.changes,
        commentsAdded: drained.added,
        commentsResolved: drained.resolved,
        commentsReopened: drained.reopened,
        commentsDeleted: drained.deleted
      });
      Ryker.journal.append(record);

      // The document written out is the clean copy, with Ryker's own chrome and
      // editing attributes removed, so what lands in storage is the report rather
      // than the report plus an editor session.
      var out = Ryker.exportHtml.scanned('ryker');
      if (out.hits.length) {
        Ryker.dialog.leak(out.hits);
        return;
      }

      Ryker.storage.save({
        records: Ryker.journal.serialize(),
        appended: [record],
        documentHtml: out.html,
        message: message,
        summary: Ryker.journal.summarize(record)
      }).then(function (res) {
        Ryker.editable.rebase();
        Ryker.comments.rebuild();
        if (api) api.close();
        Ryker.toolbar.sync();
        Ryker.panel.refresh();
        Ryker.dialog.alert('Saved',
          'Revision ' + record.seq + ' written to ' + Ryker.dom.escapeHtml(res.where || 'storage') + '.', 'ok');
      }).catch(function (err) {
        // The record stays in the journal and the working copy stays in the page.
        // Nothing is discarded because a write failed, per spec section 36.
        if (api) api.close();
        Ryker.dialog.open({
          title: 'Could not save',
          body: '<div class="note bad">' + Ryker.dom.escapeHtml(err.message) + '</div>' +
            '<p>Your edits and comments are still here. Nothing was discarded. ' +
            'Export them if you need to leave this page before the problem is fixed.</p>',
          buttons: [
            { label: 'Close' },
            {
              label: 'Export a copy', primary: true,
              action: function () {
                var o = Ryker.exportHtml.scanned('clean');
                if (o.hits.length) { Ryker.dialog.leak(o.hits); return; }
                Ryker.exportHtml.download(o.html, Ryker.exportHtml.baseName() + '-unsaved.html');
              }
            }
          ]
        });
      });
    }

    return { start: start, pending: pending };
  })();


  /* ---- github/onboard.js ----------------------------------------- */
  // Setup, driven by what is missing rather than by a documentation page.
  //
  // The important part is the last step: the token is verified by calling the API
  // and reporting the access actually found. A paste is never trusted on its own,
  // because a token that reads but cannot write would otherwise let someone edit
  // for an hour and discover it at the save.
  Ryker.onboard = (function () {
    'use strict';

    var TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

    function d() { return Ryker.dom; }

    function open() {
      var cfg = Ryker.config.load();
      switch (cfg._state) {
        case 'unconfigured': return unconfigured(cfg);
        case 'repo-missing': return repoMissing(cfg);
        case 'auth-missing': return authMissing(cfg);
        default: return signIn(cfg);
      }
    }

    function configBlock(cfg) {
      return 'window.RYKER_CONFIG = {\n' +
        '  RYKER_ENABLED: true,\n' +
        '  RYKER_DOCUMENT_ID: "' + (cfg.RYKER_DOCUMENT_ID || 'my-report') + '",\n' +
        '  RYKER_DOCUMENT_PATH: "' + (cfg.RYKER_DOCUMENT_PATH || 'report.html') + '",\n' +
        '  RYKER_GITHUB_ENABLED: true,\n' +
        '  RYKER_GITHUB_OWNER: "your-org",\n' +
        '  RYKER_GITHUB_REPO: "your-report-repo",\n' +
        '  RYKER_GITHUB_BRANCH: "main"\n' +
        '};';
    }

    function unconfigured(cfg) {
      Ryker.dialog.open({
        title: 'GitHub collaboration not configured',
        body: '<p>This report is not connected to a repository, so it saves into this browser ' +
          'and nowhere else. That is a working setup: you can edit, comment and export without ' +
          'configuring anything.</p>' +
          '<p>To collaborate through GitHub instead, put a <code>ryker.config.js</code> next to ' +
          'the report and load it before <code>ryker.js</code>:</p>' +
          '<pre><code>' + d().escapeHtml(configBlock(cfg)) + '</code></pre>' +
          '<div class="note"><b>A config file, not a fetch.</b> A page opened from disk cannot ' +
          'read a sibling <code>.json</code> at all, so the configuration ships as a script that ' +
          'assigns <code>window.RYKER_CONFIG</code>. That loads from a file:// URL; a fetched ' +
          'JSON file does not.</div>' +
          '<div class="note warn"><b>Nothing secret goes in that file.</b> It ships inside the ' +
          'report, so anyone who opens the report can read it. A repository name and a client id ' +
          'are public by design. A client secret, a private key or a token is not, and Ryker ' +
          'refuses to start with one present.</div>'
      });
    }

    function repoMissing(cfg) {
      Ryker.dialog.open({
        title: 'Repository not set',
        body: '<p>GitHub is enabled for this report but it does not know which repository holds ' +
          'the document. Add the owner and repository name to <code>ryker.config.js</code>:</p>' +
          '<pre><code>' + d().escapeHtml(configBlock(cfg)) + '</code></pre>'
      });
    }

    function authMissing(cfg) {
      Ryker.dialog.open({
        title: 'GitHub sign-in not enabled',
        body: '<p>The repository <code>' + d().escapeHtml(Ryker.config.repoSlug(cfg)) + '</code> is ' +
          'configured, but <code>RYKER_GITHUB_ENABLED</code> is not <code>true</code>, so Ryker will ' +
          'not attempt to authenticate anyone.</p>' +
          '<p>Set it to <code>true</code> in <code>ryker.config.js</code> to turn the sign-in step on.</p>'
      });
    }

    function signIn(cfg) {
      var gh = Ryker.storage.get('github');
      var input = d().el('input', {
        class: 'rk', type: 'password', placeholder: 'github_pat_...',
        autocomplete: 'off', spellcheck: 'false'
      });
      var result = d().el('div');

      var body = d().el('div', {}, [
        d().el('div', { class: 'note' }, [
          d().el('div', {
            text: 'This report commits to ' + Ryker.config.repoSlug(cfg) + ' on branch ' +
              cfg.RYKER_GITHUB_BRANCH + '. Nothing else is reachable with the token you paste.'
          })
        ]),
        html('<p>Create a <b>fine-grained personal access token</b> scoped to that one repository, ' +
          'with <b>Contents: Read and write</b> and no other permission. GitHub enforces the ' +
          'repository restriction itself, which is why Ryker asks for a fine-grained token rather ' +
          'than a classic one.</p>' +
          '<p><a href="' + TOKEN_URL + '" target="_blank" rel="noopener noreferrer">' +
          'Open the token page on GitHub</a>, then paste the result below.</p>'),
        html('<div class="note warn"><b>Ryker does not need your GitHub App private key or client ' +
          'secret for normal document editing. Do not place those credentials in this report.</b> ' +
          'The token you paste is held in this tab only. It is never written into the HTML, the ' +
          'configuration, an export, a commit, or localStorage, and it is gone when the tab ' +
          'closes.</div>'),
        d().el('label', { class: 'rk', text: 'Fine-grained token' }),
        input,
        result
      ]);

      var dlg = Ryker.dialog.open({
        title: 'Sign in to GitHub',
        body: body,
        buttons: [
          { label: 'Cancel' },
          gh && gh.hasToken() ? {
            label: 'Sign out', danger: true,
            action: function () { gh.signOut(); Ryker.toolbar.sync(); }
          } : null,
          {
            label: 'Verify and continue', primary: true, keepOpen: true,
            action: function () {
              var t = input.value.trim();
              if (!t) return false;
              result.innerHTML = '<div class="note">Checking with GitHub...</div>';
              gh.setToken(t);
              gh.verify().then(function (res) {
                if (!res.ok) {
                  gh.setToken(null);
                  result.innerHTML = '<div class="note bad">' + d().escapeHtml(res.reason) + '</div>';
                  return;
                }
                result.innerHTML = '<div class="note ok">Signed in as <b>' +
                  d().escapeHtml(res.identity.login) + '</b>, user id ' + res.identity.id +
                  '. Write access to ' + d().escapeHtml(Ryker.config.repoSlug(cfg)) +
                  ' confirmed by GitHub.</div>';
                Ryker.storage.detect();
                Ryker.boot.reload().then(function () {
                  Ryker.toolbar.sync();
                  Ryker.panel.refresh();
                  setTimeout(function () { dlg.close(); }, 900);
                });
              });
              return false;
            }
          }
        ].filter(Boolean)
      });
    }

    function html(s) {
      var n = document.createElement('div');
      n.innerHTML = s;
      return n;
    }

    return { open: open, signIn: signIn };
  })();


  /* ---- comments/select.js ---------------------------------------- */
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


  /* ---- ui/toolbar.js --------------------------------------------- */
  // The toolbar. Collapsed to a handle by default, because the reports put their
  // table of contents at position:sticky; top:0 and an idle editor should cost
  // the reader nothing.
  Ryker.toolbar = (function () {
    'use strict';

    var handle = null, bar = null, expanded = false;
    var els = {};

    function d() { return Ryker.dom; }

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

      els.mode = d().el('button', {
        class: 'rk', text: 'Edit', title: 'Turn Edit Mode on or off',
        onclick: toggleEdit
      });
      els.save = d().el('button', { class: 'rk', text: 'Save', onclick: function () { Ryker.save.start(); } });
      els.comments = d().el('button', {
        class: 'rk', onclick: function () { Ryker.panel.toggle('comments'); }
      });
      els.showHide = d().el('button', {
        class: 'rk', onclick: function () {
          Ryker.comments.setVisible(!Ryker.comments.isVisible());
          sync();
        }
      });
      els.revisions = d().el('button', {
        class: 'rk', onclick: function () { Ryker.panel.toggle('revisions'); }
      });
      els.exportBtn = d().el('button', { class: 'rk', text: 'Export', onclick: exportMenu });
      els.pkg = d().el('button', { class: 'rk', text: 'Package', onclick: function () { Ryker.packager.open(); } });
      els.auth = d().el('button', { class: 'rk', onclick: function () { Ryker.onboard.open(); } });
      els.where = d().el('span', { class: 'where' }, [
        d().el('span', { class: 'dot' }),
        d().el('span', { class: 'lbl' })
      ]);
      els.collapse = d().el('button', {
        class: 'rk', text: 'Hide', title: 'Collapse the toolbar',
        onclick: function () { expand(false); }
      });

      bar = d().el('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Ryker' }, [
        d().el('span', { class: 'brand', text: 'Ryker' }),
        els.mode, els.save,
        d().el('span', { class: 'sep' }),
        els.comments, els.showHide, els.revisions,
        d().el('span', { class: 'sep' }),
        els.exportBtn, els.pkg,
        d().el('span', { class: 'spacer' }),
        els.where, els.auth, els.collapse
      ]);
      bar.style.display = 'none';
      Ryker.shell.add(bar);
    }

    function expand(open) {
      expanded = !!open;
      bar.style.display = expanded ? 'flex' : 'none';
      handle.style.display = expanded ? 'none' : 'flex';
      handle.setAttribute('aria-expanded', String(expanded));
      if (expanded) {
        // Measured rather than assumed, because the bar wraps at narrow widths.
        Ryker.shell.setOffset(bar.getBoundingClientRect().height);
      } else {
        Ryker.formatbar.hide();
        Ryker.shell.releaseOffset();
        Ryker.panel.close();
      }
      sync();
    }

    function toggleEdit() {
      if (Ryker.editable.isOn()) {
        if (Ryker.editable.isDirty()) {
          Ryker.dialog.confirm('Leave Edit Mode?',
            '<p>You have unsaved changes. Leaving Edit Mode keeps them in the page; it does not ' +
            'discard them and it does not save them.</p>',
            'Leave Edit Mode', function () { Ryker.editable.disable(); sync(); });
          return;
        }
        Ryker.editable.disable();
        sync();
        return;
      }

      if (!Ryker.storage.canWrite()) {
        var cfg = Ryker.config.load();
        if (cfg._state === 'configured') {
          Ryker.dialog.confirm('Sign in before editing',
            '<p>This report saves to <code>' + d().escapeHtml(Ryker.config.repoSlug(cfg)) + '</code>, ' +
            'and Ryker has not confirmed you can write there yet.</p>' +
            '<p>You can edit anyway. Changes stay in this browser and are clearly marked as local ' +
            'and uncommitted until you sign in.</p>',
            'Edit locally', function () { Ryker.editable.enable(); sync(); });
          return;
        }
      }
      Ryker.editable.enable();
      sync();
    }

    function exportMenu() {
      var base = Ryker.exportHtml.baseName();
      Ryker.dialog.open({
        title: 'Export',
        body: '<p><b>Clean HTML</b> is the report on its own, with Ryker taken out. This is what ' +
          'you send to someone who should read it rather than edit it.</p>' +
          '<p><b>With Ryker</b> keeps the editor attached, so whoever opens it can carry on ' +
          'commenting and editing.</p>' +
          '<p><b>Journal</b> is the revision and comment record as JSON, for handing your work back ' +
          'to the author when you have no repository to commit to.</p>',
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Journal JSON',
            action: function () {
              Ryker.exportHtml.download(Ryker.exportHtml.journalJson(),
                base + '-ryker-journal.json', 'application/json');
            }
          },
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

    function sync() {
      if (!bar) return;
      var counts = Ryker.comments.counts();
      var editing = Ryker.editable.isOn();
      var dirty = Ryker.editable.isDirty() || Ryker.comments.hasPending();
      var cfg = Ryker.config.load();

      els.mode.textContent = editing ? 'Editing' : 'Edit';
      els.mode.classList.toggle('on', editing);
      els.save.disabled = !dirty;
      els.save.textContent = dirty ? 'Save changes' : 'Save';
      els.save.classList.toggle('on', dirty);

      els.comments.textContent = 'Comments';
      els.comments.appendChild(d().el('span', {
        class: 'count' + (counts.open ? ' warn' : ''),
        text: String(counts.open)
      }));
      els.comments.classList.toggle('on', Ryker.panel.isOpen('comments'));
      els.comments.title = counts.open + ' open, ' + counts.resolved + ' resolved' +
        (counts.unanchored ? ', ' + counts.unanchored + ' unanchored' : '');

      els.showHide.textContent = Ryker.comments.isVisible() ? 'Hide marks' : 'Show marks';

      els.revisions.textContent = 'Revisions';
      els.revisions.appendChild(d().el('span', { class: 'count', text: String(Ryker.journal.count()) }));
      els.revisions.classList.toggle('on', Ryker.panel.isOpen('revisions'));

      var backend = Ryker.storage.current();
      els.where.querySelector('.lbl').textContent = backend.describe();
      var dot = els.where.querySelector('.dot');
      dot.className = 'dot ' + (Ryker.storage.canWrite() ? 'ok' : 'warn');
      els.where.title = backend.detail ? backend.detail() : '';

      var gh = Ryker.storage.get('github');
      if (cfg._state === 'configured') {
        els.auth.textContent = gh && gh.canWrite() ? (gh.identity() ? gh.identity().login : 'Signed in') : 'Sign in';
        els.auth.classList.toggle('on', !!(gh && gh.canWrite()));
      } else {
        els.auth.textContent = 'Set up';
        els.auth.classList.remove('on');
      }

      var badge = handle.querySelector('.badge');
      badge.textContent = counts.open ? String(counts.open) : '';
      badge.style.display = counts.open ? '' : 'none';
      handle.querySelector('.dot').classList.toggle('on', editing);
      handle.title = 'Open Ryker' + (counts.open ? ' (' + counts.open + ' open comments)' : '');

      if (expanded) {
        Ryker.shell.setOffset(bar.getBoundingClientRect().height);
        if (Ryker.panel.isOpen()) Ryker.panel.reflow();
      }
    }

    function isExpanded() { return expanded; }

    return { build: build, sync: sync, expand: expand, isExpanded: isExpanded };
  })();


  /* ---- bootstrap/boot.js ----------------------------------------- */
  // Boot. Asynchronous and defensive: the report must remain fully usable if
  // Ryker fails to initialise, so every stage is wrapped and a failure downgrades
  // the toolbar rather than taking the document down.
  Ryker.boot = (function () {
    'use strict';

    var started = false;
    var problems = [];

    function log(msg) {
      problems.push(msg);
      if (window.console && console.warn) console.warn('[ryker] ' + msg);
    }

    function guard(label, fn) {
      try { return fn(); }
      catch (e) { log(label + ': ' + (e && e.message)); return null; }
    }

    function start() {
      if (started) return Promise.resolve();
      started = true;

      var cfg = guard('config', function () { return Ryker.config.load(); });
      if (!cfg) return Promise.resolve();
      if (cfg.RYKER_ENABLED === false) return Promise.resolve();

      // A secret in shipped configuration is a hard stop rather than a warning.
      // Ryker refuses to run rather than operate a report that is leaking one.
      if (cfg._leaked && cfg._leaked.length) {
        guard('shell', function () { Ryker.shell.mount(); });
        guard('leak', function () {
          Ryker.dialog.open({
            title: 'Ryker did not start',
            body: '<div class="note bad">This report ships configuration keys that must never ' +
              'leave a build machine: <b>' + Ryker.dom.escapeHtml(cfg._leaked.join(', ')) + '</b>.</div>' +
              '<p>Anything in Ryker configuration is readable by anyone who opens the report, so ' +
              'these are already exposed. Rotate them, remove them from the config, and rebuild.</p>',
            dismissable: false
          });
        });
        return Promise.resolve();
      }

      guard('shell', function () { Ryker.shell.mount(); });
      guard('toolbar', function () { Ryker.toolbar.build(); });
      guard('select', function () { Ryker.select.init(); });
      guard('formatbar', function () { Ryker.formatbar.init(); });
      guard('multi', function () { Ryker.multi.init(); });
      guard('history', function () { Ryker.history.bind(); });
      guard('tooltip', function () { Ryker.tooltip.init(); });
      guard('keys', bindKeys);

      guard('wire', function () {
        Ryker.comments.onChange(function () { Ryker.toolbar.sync(); Ryker.panel.refresh(); });
        Ryker.editable.onChange(function () { Ryker.toolbar.sync(); });
        Ryker.storage.onChange(function () { Ryker.toolbar.sync(); });
      });

      return reload().then(function () {
        guard('sync', function () { Ryker.toolbar.sync(); });
      });
    }

    // Picks the backend, loads its journal, folds comments, anchors them. Called
    // again after sign-in, when a better backend becomes available.
    function reload() {
      return Promise.resolve()
        .then(function () {
          var gh = Ryker.storage.get('github');
          if (gh && gh.hasToken() && !gh.access()) return gh.verify();
          return null;
        })
        .then(function () { Ryker.storage.detect(); })
        .then(function () { return Ryker.storage.load(); })
        .then(function (res) {
          Ryker.journal.reset(res.records || []);

          // Identity is derived from the document's own text, so it has to be
          // computed while the document still IS its own text, before any saved
          // edit is put back on top of it.
          Ryker.blocks.seedIds();

          // A backend that rewrites the document has already put the edits back;
          // one that only holds a journal has not, and the file on disk is still
          // the original. Replaying before the baseline is taken is what makes a
          // save survive a reload in browser-only mode.
          var backend = Ryker.storage.current();
          if (backend && !backend.ownsDocument && Ryker.journal.count()) {
            var out = Ryker.blocks.applyRecords(Ryker.journal.all());
            if (out.missed) {
              log('restored ' + out.applied + ' change(s), ' + out.missed +
                  ' could not be placed and were skipped');
            }
          }

          Ryker.editable.setBaseline(Ryker.blocks.snapshot());
          Ryker.comments.rebuild();
          if (res && res.error) log('journal load: ' + (res.error.message || res.error));
        })
        .catch(function (e) { log('reload: ' + (e && e.message)); });
    }

    function bindKeys() {
      document.addEventListener('keydown', function (e) {
        // Ctrl+S, or Cmd+S. Only while editing: a reader pressing it means "save
        // this page to disk" and should keep the browser's own behaviour.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
          if (!Ryker.editable.isOn()) return;
          e.preventDefault();
          e.stopPropagation();
          if (Ryker.editable.isDirty() || Ryker.comments.hasPending()) Ryker.save.start();
          return;
        }
        if (e.key !== 'Escape') return;
        // Ryker's own overlays close first, and the event stops here so the
        // report's Escape handler does not also fire and close its lightbox.
        if (Ryker.dialog.isOpen()) {
          Ryker.dialog.closeTop();
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        if (Ryker.panel.isOpen()) {
          Ryker.panel.close();
          e.stopPropagation();
        }
      }, true);
    }

    function status() {
      return { started: started, problems: problems.slice() };
    }

    return { start: start, reload: reload, status: status, log: log };
  })();

  Ryker.log = Ryker.boot.log;

  // Deferred so the report paints before Ryker does any work, per spec section
  // 41. requestAnimationFrame is the right signal when the page is visible and
  // the wrong one to depend on: it does not fire in a background tab, during a
  // headless render, or while printing, and Ryker would then never initialise at
  // all. So a timer races it and whichever arrives first wins, with start()
  // idempotent so the loser is harmless.
  (function () {
    'use strict';
    function go() { Ryker.boot.start(); }
    function schedule() {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
      setTimeout(go, 50);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', schedule);
    } else {
      schedule();
    }
  })();


})();
