(function () {
  'use strict';

  // The workspace is extension-owned DOM rather than shadow DOM, but it uses
  // the same canonical tokens as the injected and drop-in Ryker chrome.
  if (window.Ryker && Ryker.theme) Ryker.theme.apply(document.documentElement);

  var input = document.getElementById('workspace-file');
  var choose = document.getElementById('workspace-choose');
  var main = document.getElementById('workspace-document');
  var open = document.getElementById('workspace-open');
  var status = document.getElementById('workspace-status');
  var allowed = /\.(html?|md|markdown)$/i;
  var pendingKey = 'ryker:workspace-pending';
  var openGeneration = 0;
  var sourceShell = null;

  function escapeHtml(value) {
    return Ryker.dom.escapeHtml(value);
  }

  function inlineMarkdown(value) {
    var code = [];
    var escaped = escapeHtml(value).replace(/`([^`]+)`/g, function (_, contents) {
      var token = '\uE000' + code.length + '\uE001';
      code.push('<code>' + contents + '</code>');
      return token;
    });
    escaped = escaped
      .replace(/(^|[^*])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*(?!\*)/g,
        '$1<strong>$2</strong>')
      .replace(/(^|[^\w_])__([^_\s](?:[^_]*[^_\s])?)__(?![\w_])/g,
        '$1<strong>$2</strong>')
      .replace(/(^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*(?!\*)/g,
        '$1<em>$2</em>')
      .replace(/(^|[^\w_])_([^_\s](?:[^_]*[^_\s])?)_(?![\w_])/g,
        '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|#[^\s)]+)\)/g,
        '<a href="$2">$1</a>');
    return escaped.replace(/\uE000(\d+)\uE001/g, function (_, index) {
      return code[Number(index)] || '';
    });
  }

  // A GFM table is a header row, a rule made of dashes, then body rows. The
  // rule is what tells a row of pipes apart from a sentence containing one, so
  // it is matched on its own: pipes, dashes, colons and space, with at least
  // one pipe and one dash. A horizontal rule carries no pipe and cannot collide.
  function isTableRule(line) {
    return /\|/.test(line) && /-/.test(line) && /^[\s|:-]*$/.test(line);
  }

  function splitRow(line) {
    var trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [], cell = '';
    for (var i = 0; i < trimmed.length; i++) {
      var ch = trimmed.charAt(i);
      if (ch === '\\' && trimmed.charAt(i + 1) === '|') { cell += '|'; i += 1; continue; }
      if (ch === '|') { cells.push(cell.trim()); cell = ''; continue; }
      cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  }

  function alignOf(spec) {
    var left = spec.charAt(0) === ':';
    var right = spec.charAt(spec.length - 1) === ':';
    if (left && right) return 'center';
    if (right) return 'right';
    return left ? 'left' : '';
  }

  // Every block records the line range it was built from, so an export can put
  // back the original bytes for anything nobody touched. Without the range a
  // Markdown export has to regenerate the whole file from the DOM, which
  // reformats every untouched line and makes each save an unreviewable diff.
  // sow-006 Phase 4 settled this: rewrite ranges, do not serialise documents.
  //
  // Ranges are line indexes into the normalised text, inclusive at both ends,
  // and every source line belongs to at most one block. The gaps between
  // blocks are blank lines and the fence markers, which are reproduced from the
  // A tab advances to the next multiple of four, which is what CommonMark says
  // and what decides whether a line is a child of the one above it.
  function indentWidth(white) {
    var width = 0;
    for (var i = 0; i < white.length; i += 1) {
      width += white.charAt(i) === '\t' ? 4 - (width % 4) : 1;
    }
    return width;
  }

  function newList(tag, indent, index) {
    var root = { tag: tag, items: [] };
    return { root: root, stack: [{ indent: indent, node: root }], from: index, to: index };
  }

  function openSub(stack, parent, tag, indent, replaceTop) {
    var sub = { tag: tag, items: [] };
    parent.children.push(sub);
    var frame = { indent: indent, node: sub };
    if (replaceTop) stack[stack.length - 1] = frame;
    else stack.push(frame);
    return frame;
  }

  // source rather than invented, so a round trip with no edits is byte-exact.
  function markdownBlocks(text) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var out = [], paragraph = [], list = null, quote = [], code = [], fenced = false;
    var table = null, skip = 0;
    var pFrom = -1, pTo = -1, qFrom = -1, qTo = -1, cFrom = -1;

    function push(html, from, to) { out.push({ html: html, from: from, to: to }); }

    // The authored Markdown for one editable block, carried on the element it
    // became. An instruction's FROM has to be findable in the file the reader
    // actually holds, and after inlineMarkdown() a block that was written
    // `*rate*` reads `<em>rate</em>`, which appears nowhere in that file. The
    // parser is the only place that still has both, so it stamps the source
    // here rather than leaving instructions.js to reconstruct it.
    //
    // Stamped per EDITABLE block, not per top-level block, because blocks.js
    // counts every li, th and td as its own: one list is one range and several
    // blocks. exportHtml.snapshot() strips these, so they reach no file.
    function srcAttr(value) {
      return ' data-ryker-md-src="' + escapeHtml(value) + '"';
    }

    function flushParagraph() {
      if (!paragraph.length) return;
      var text = paragraph.join(' ');
      push('<p' + srcAttr(text) + '>' + inlineMarkdown(text) + '</p>', pFrom, pTo);
      paragraph = []; pFrom = -1; pTo = -1;
    }
    // A list is one block however deep it goes, so its range covers every line
    // from the first marker to the last. That keeps the round trip honest: an
    // untouched nested list is copied out of the source byte for byte, indents,
    // bullet characters and all, and only a list somebody edited is rewritten.
    function renderList(node) {
      return '<' + node.tag + '>' + node.items.map(function (item) {
        if (!item.children.length) {
          return '<li' + srcAttr(item.text) + '>' + inlineMarkdown(item.text) + '</li>';
        }
        // An item that owns a sublist is a CONTAINER, and blocks.js skips any
        // block containing another block (blocks.js:105). Left as bare text the
        // parent item would render but could never be edited, so its own text
        // gets an element of its own. A <p> is the only wrapper in the block
        // SELECTOR that fits inside an <li>; workspace.css takes the paragraph
        // margins back off so the list still looks like a list.
        return '<li><p' + srcAttr(item.text) + '>' + inlineMarkdown(item.text) + '</p>' +
          item.children.map(renderList).join('') + '</li>';
      }).join('') + '</' + node.tag + '>';
    }

    function flushList() {
      if (!list) return;
      push(renderList(list.root), list.from, list.to);
      list = null;
    }
    function flushQuote() {
      if (!quote.length) return;
      var text = quote.join(' ');
      push('<blockquote><p' + srcAttr(text) + '>' + inlineMarkdown(text) + '</p></blockquote>',
        qFrom, qTo);
      quote = []; qFrom = -1; qTo = -1;
    }
    // The header row fixes the column count. A short row is padded with empty
    // cells rather than left ragged, which is what GFM renders and what Ryker
    // then lets someone fill in; a long one is cut to the columns declared.
    function flushTable() {
      if (!table) return;
      var cell = function (tag, value, i) {
        var align = table.align[i];
        return '<' + tag + (align ? ' style="text-align:' + align + '"' : '') +
          srcAttr(value || '') + '>' + inlineMarkdown(value || '') + '</' + tag + '>';
      };
      var html = '<table><thead><tr>' + table.head.map(function (value, i) {
        return cell('th', value, i);
      }).join('') + '</tr></thead>';
      if (table.rows.length) {
        html += '<tbody>' + table.rows.map(function (row) {
          var cells = '';
          for (var i = 0; i < table.head.length; i++) cells += cell('td', row[i], i);
          return '<tr>' + cells + '</tr>';
        }).join('') + '</tbody>';
      }
      push(html + '</table>', table.from, table.to);
      table = null;
    }

    lines.forEach(function (line, index) {
      if (skip) { skip -= 1; return; }
      if (/^\s*```/.test(line)) {
        flushParagraph(); flushList(); flushQuote(); flushTable();
        if (fenced) {
          push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>', cFrom, index);
          code = []; cFrom = -1;
        } else { cFrom = index; }
        fenced = !fenced;
        return;
      }
      if (fenced) { code.push(line); return; }
      if (table) {
        if (line.trim() && /\|/.test(line)) {
          table.rows.push(splitRow(line)); table.to = index; return;
        }
        flushTable();
      }
      if (/\|/.test(line) && line.trim() && isTableRule(lines[index + 1] || '')) {
        flushParagraph(); flushList(); flushQuote();
        // from is the header row and to is the alignment rule, which `skip`
        // consumes next. Body rows push `to` forward as they arrive.
        table = { head: splitRow(line), align: splitRow(lines[index + 1]).map(alignOf), rows: [],
          from: index, to: index + 1 };
        skip = 1;
        return;
      }
      var heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        flushParagraph(); flushList(); flushQuote();
        push('<h' + heading[1].length + srcAttr(heading[2]) + '>' + inlineMarkdown(heading[2]) +
          '</h' + heading[1].length + '>', index, index);
        return;
      }
      var item = line.match(/^(\s*)[-*+]\s+(.+)$/);
      var numbered = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
      if (item || numbered) {
        flushParagraph(); flushQuote();
        var marker = numbered || item;
        var tag = numbered ? 'ol' : 'ul';
        var width = indentWidth(marker[1]);
        var text = marker[2];
        if (!list) list = newList(tag, width, index);
        var stack = list.stack;
        // Anything indented further than this line has ended.
        while (stack.length > 1 && width < stack[stack.length - 1].indent) stack.pop();
        var top = stack[stack.length - 1];
        if (width > top.indent && top.node.items.length) {
          // Deeper, and there is an item above to hang it on. A first line
          // that is already indented has no parent, so it opens the list at
          // its own depth instead of dangling.
          var parent = top.node.items[top.node.items.length - 1];
          top = openSub(stack, parent, tag, width);
        } else if (top.node.tag !== tag) {
          // The marker changed without the indent changing. At the top level a
          // reader sees two lists, which is what the flat parser always did.
          // Deeper down it is a second list on the same parent item.
          if (stack.length === 1) {
            flushList();
            list = newList(tag, width, index);
            stack = list.stack;
            top = stack[0];
          } else {
            var owner = stack[stack.length - 2].node;
            top = openSub(stack, owner.items[owner.items.length - 1], tag, width, true);
          }
        }
        top.node.items.push({ text: text, children: [] });
        list.to = index;
        return;
      }
      var quoted = line.match(/^\s*>\s?(.*)$/);
      if (quoted) {
        flushParagraph(); flushList();
        if (!quote.length) qFrom = index;
        qTo = index;
        quote.push(quoted[1]);
        return;
      }
      if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); return; }
      flushList(); flushQuote();
      if (!paragraph.length) pFrom = index;
      pTo = index;
      paragraph.push(line.trim());
    });
    // An unclosed fence runs to the end of the file, so its range does too.
    if (fenced) {
      push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>', cFrom, lines.length - 1);
    }
    flushParagraph(); flushList(); flushQuote(); flushTable();
    return out;
  }

  function markdown(text) {
    return markdownBlocks(text).map(function (block) { return block.html; }).join('\n');
  }

  var TAG_ATTRS = {
    A: ['href', 'target', 'rel', 'download'],
    ABBR: ['title'], TIME: ['datetime'], DEL: ['datetime'], INS: ['datetime'],
    IMG: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    VIDEO: ['src', 'poster', 'controls', 'preload', 'width', 'height', 'muted', 'loop'],
    AUDIO: ['src', 'controls', 'preload', 'muted', 'loop'],
    SOURCE: ['src', 'type', 'media'], TRACK: ['src', 'kind', 'srclang', 'label', 'default'],
    OL: ['start', 'reversed', 'type'], LI: ['value'],
    TD: ['colspan', 'rowspan', 'headers'], TH: ['colspan', 'rowspan', 'headers', 'scope'],
    COL: ['span'], COLGROUP: ['span'],
    SVG: ['viewbox', 'width', 'height', 'x', 'y', 'preserveaspectratio', 'xmlns'],
    PATH: ['d', 'fill', 'stroke', 'stroke-width', 'transform'],
    G: ['fill', 'stroke', 'stroke-width', 'transform'],
    CIRCLE: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'transform'],
    ELLIPSE: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'transform'],
    RECT: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'transform'],
    LINE: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'transform'],
    POLYLINE: ['points', 'fill', 'stroke', 'stroke-width', 'transform'],
    POLYGON: ['points', 'fill', 'stroke', 'stroke-width', 'transform'],
    TEXT: ['x', 'y', 'dx', 'dy', 'fill', 'stroke', 'text-anchor', 'transform'],
    USE: ['href', 'xlink:href', 'x', 'y', 'width', 'height']
  };

  function unwrap(node) {
    if (!node.parentNode) return;
    while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
    node.parentNode.removeChild(node);
  }

  function shellAttributes(node, extra) {
    extra = extra || [];
    for (var i = node.attributes.length - 1; i >= 0; i--) {
      var attr = node.attributes[i];
      var name = attr.name.toLowerCase();
      var named = extra.indexOf(name) !== -1 ||
        /^(id|class|lang|dir|title|role)$/.test(name) ||
        /^(aria|data)-[a-z0-9_.:-]+$/i.test(name);
      if (!named || !Ryker.sanitize.safeAttribute(node.tagName, name, attr.value)) {
        node.removeAttribute(attr.name);
      }
    }
  }

  function safeDocument(text) {
    var parsed = new DOMParser().parseFromString(String(text), 'text/html');
    parsed.querySelectorAll(
      'script,style,link,base,iframe,object,embed,template,foreignObject,' +
      'animate,animateMotion,animateTransform,set,portal,fencedframe'
    ).forEach(function (node) { node.remove(); });

    // Preserve inert document metadata, but never the head elements that can
    // execute, fetch, navigate or restyle the exported document. A charset is
    // normalised because every Ryker export is encoded as UTF-8.
    Array.prototype.slice.call(parsed.head.childNodes).forEach(function (node) {
      if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) return;
      if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); return; }
      if (node.tagName === 'TITLE') {
        while (node.attributes.length) node.removeAttribute(node.attributes[0].name);
        return;
      }
      if (node.tagName === 'META' && !node.hasAttribute('http-equiv')) {
        shellAttributes(node, ['charset', 'name', 'content', 'property', 'itemprop']);
        if (node.hasAttribute('charset')) node.setAttribute('charset', 'utf-8');
        if (node.hasAttribute('charset') || node.hasAttribute('name') ||
            node.hasAttribute('property') || node.hasAttribute('itemprop')) return;
      }
      node.remove();
    });
    if (!parsed.head.querySelector('meta[charset]')) {
      var charset = parsed.createElement('meta');
      charset.setAttribute('charset', 'utf-8');
      parsed.head.insertBefore(charset, parsed.head.firstChild);
    }

    shellAttributes(parsed.documentElement, ['xmlns']);
    if (parsed.documentElement.hasAttribute('xmlns') &&
        parsed.documentElement.getAttribute('xmlns') !== 'http://www.w3.org/1999/xhtml') {
      parsed.documentElement.removeAttribute('xmlns');
    }
    shellAttributes(parsed.body);
    parsed.body.querySelectorAll('form,input,button,select,textarea,option').forEach(unwrap);
    parsed.body.querySelectorAll('*').forEach(function (node) {
      var tag = String(node.tagName || '').toUpperCase();
      Ryker.sanitize.attributes(node, TAG_ATTRS[tag] || []);
      if (tag === 'USE') {
        ['href', 'xlink:href'].forEach(function (name) {
          var value = node.getAttribute(name);
          if (value && !/^#[^\s]+$/.test(value)) node.removeAttribute(name);
        });
      }
      ['fill', 'stroke'].forEach(function (name) {
        var value = node.getAttribute(name);
        if (value && /url\((?!\s*#)/i.test(value)) node.removeAttribute(name);
      });
      if (tag === 'A' && node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    return parsed;
  }

  function safeHtml(text) {
    return safeDocument(text).body.innerHTML;
  }

  function sourceShellClone() {
    return sourceShell ? sourceShell.cloneNode(true) : null;
  }

  function hash(text) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve(String(text.length));
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buffer) {
      return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('').slice(0, 16);
    });
  }

  function rendered(name, text) {
    var isMarkdown = /\.(md|markdown)$/i.test(name);
    var parsed = isMarkdown ? null : safeDocument(text);
    var blocks = isMarkdown ? markdownBlocks(text) : null;
    var html = isMarkdown
      ? blocks.map(function (block) { return block.html; }).join('\n')
      : parsed.body.innerHTML;
    var template = document.createElement('template');
    template.innerHTML = html;
    var displayable = (template.content.textContent || '').trim() ||
      template.content.querySelector('img,svg,video,audio,canvas,table,hr');
    if (!displayable) throw new Error('The selected file has no displayable content.');
    return {
      html: html,
      markdown: isMarkdown,
      shell: parsed ? parsed.documentElement.cloneNode(true) : null,
      // The authored text, kept so an export can hand back the bytes nobody
      // edited. This used to be dropped here and the only other copy, the
      // sessionStorage reload handoff, is deleted the moment it is read, so
      // after boot the Markdown a user opened existed nowhere in the page.
      source: isMarkdown ? String(text).replace(/\r\n?/g, '\n') : null,
      // Recorded before normalisation, because Save Document writes over the
      // authored file: rewriting a CRLF document with LF changes every line and
      // breaks the one promise the Markdown path makes, that untouched lines
      // come back exactly as written.
      eol: /\r\n/.test(String(text)) ? '\r\n' : '\n',
      finalNewline: /\n$|\r$/.test(String(text)),
      ranges: blocks
        ? blocks.map(function (block) { return { from: block.from, to: block.to }; })
        : null
    };
  }

  // Ranges go onto the elements rather than into an array held alongside them,
  // because the outline rail moves and deletes blocks and an index stops
  // meaning anything the moment it does. Done before boot.start(), so Ryker
  // sees a document that already carries its own provenance.
  function adoptMarkdown(source, ranges, endings) {
    var children = main.children;
    for (var i = 0; i < ranges.length && i < children.length; i++) {
      children[i].setAttribute('data-ryker-md-from', String(ranges[i].from));
      children[i].setAttribute('data-ryker-md-to', String(ranges[i].to));
    }
    // The ranges go over as well as onto the elements. The elements say what
    // each surviving block owns; the list says what every block owned, which
    // is the only way the exporter can tell a gap from a deleted block.
    if (window.Ryker && Ryker.exportMarkdown) {
      Ryker.exportMarkdown.adopt(source, ranges, endings);
    }
  }

  // WRITABLE DOCUMENTS. A <input type=file> and a drop event both hand over a
  // File, which is a read-only snapshot with no route back to the bytes it came
  // from. Save Document needs a FileSystemFileHandle instead, so the picker is
  // opened by script and the drop path asks the item for its handle. When
  // neither yields one the document still opens; only Save Document is absent.
  var HANDLE_DB = 'ryker-workspace';
  var HANDLE_STORE = 'handles';
  var HANDLE_PREFIX = 'pending-open:';

  // The handle is keyed by a token minted per reload, NOT by a fixed name.
  // IndexedDB is shared by every workspace tab while the pending text lives in
  // sessionStorage, which is not. Under one fixed key, two tabs reloading at the
  // same moment would each collect whichever handle landed last, and a tab could
  // finish holding another tab's file. Save Document would then overwrite the
  // wrong document with this one's contents, which is the one failure this
  // feature must not have. The token travels in sessionStorage beside the text,
  // so a handle can only ever be claimed by the reload that parked it.
  function mintToken() {
    return String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  }

  /** The workspace's own IndexedDB, on the extension origin. Never a visited
   *  site's: this page is chrome-extension://, so the handle belongs to Ryker.
   *  Resolves null on every failure, because losing the handle costs Save
   *  Document and must never cost the open. */
  function handleDb() {
    return new Promise(function (resolve) {
      var request;
      try { request = indexedDB.open(HANDLE_DB, 1); }
      catch (error) { resolve(null); return; }
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
          request.result.createObjectStore(HANDLE_STORE);
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { resolve(null); };
    });
  }

  /** Park a handle across the reload openTextAt performs for a second file. A
   *  handle cannot be JSON-stringified into sessionStorage beside the text, but
   *  it is structured-cloneable, so IndexedDB is the only way across. */
  function stashHandle(handle, token) {
    if (!handle || !token) return Promise.resolve(false);
    return handleDb().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        var tx;
        try { tx = db.transaction(HANDLE_STORE, 'readwrite'); }
        catch (error) { resolve(false); return; }
        try { tx.objectStore(HANDLE_STORE).put(handle, HANDLE_PREFIX + token); }
        catch (error) { resolve(false); return; }
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
        tx.onabort = function () { resolve(false); };
      });
    });
  }

  /** Read the parked handle and remove it in the same breath, so a reload that
   *  fails halfway cannot leave a stale handle pointing at a different file. */
  function takeHandle(token) {
    if (!token) return Promise.resolve(null);
    return handleDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx, request;
        try { tx = db.transaction(HANDLE_STORE, 'readwrite'); }
        catch (error) { resolve(null); return; }
        try {
          var store = tx.objectStore(HANDLE_STORE);
          request = store.get(HANDLE_PREFIX + token);
          store.delete(HANDLE_PREFIX + token);
        } catch (error) { resolve(null); return; }
        tx.oncomplete = function () { resolve(request.result || null); };
        tx.onerror = function () { resolve(null); };
        tx.onabort = function () { resolve(null); };
      });
    });
  }

  // A reload claims its handle within a few hundred milliseconds. A minute is
  // far beyond that and far below any human's second visit.
  var STALE_AFTER = 60000;

  /** Drop parked handles nobody is coming back for, on a cold start.
   *
   *  Age-based rather than a clear(), because ANOTHER TAB may be mid-reload at
   *  this exact moment and its handle is not ours to delete. Wiping the store
   *  wholesale would cost that tab its Save Document. The token carries the
   *  time it was minted, so only handles too old to be owed are removed. */
  function sweepHandles() {
    return handleDb().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        var tx, request;
        try { tx = db.transaction(HANDLE_STORE, 'readwrite'); }
        catch (error) { resolve(false); return; }
        try {
          var store = tx.objectStore(HANDLE_STORE);
          request = store.getAllKeys();
          request.onsuccess = function () {
            var now = Date.now();
            (request.result || []).forEach(function (key) {
              var minted = Number(String(key).slice(HANDLE_PREFIX.length).split('-')[0]);
              // An unparseable key is from an older shape and cannot be claimed.
              if (!minted || now - minted > STALE_AFTER) store.delete(key);
            });
          };
        } catch (error) { resolve(false); return; }
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
        tx.onabort = function () { resolve(false); };
      });
    });
  }

  /** Raise a handle to readwrite. Deliberately NOT done at open: the owner
   *  chose that opening stays read-only and the write grant is asked for the
   *  first time someone actually saves, so browsing a file costs no prompt. */
  // Resolves the PermissionState itself rather than a boolean. 'prompt' and
  // 'denied' are different answers and must not collapse: dismissing Chrome's
  // write dialog with Escape or a click away leaves the grant in 'prompt', and
  // reading that as a refusal would retire the save target over a stray
  // keystroke, with no way back but reopening the file.
  function ensureWritable(handle) {
    if (!handle) return Promise.resolve('denied');
    if (typeof handle.queryPermission !== 'function') return Promise.resolve('granted');
    return Promise.resolve(handle.queryPermission({ mode: 'readwrite' })).then(function (state) {
      if (state === 'granted') return 'granted';
      if (typeof handle.requestPermission !== 'function') return 'denied';
      return Promise.resolve(handle.requestPermission({ mode: 'readwrite' }))
        .then(function (next) { return next === 'granted' ? 'granted' : (next || 'prompt'); });
    });
  }

  /** Overwrite the file the handle points at. Aborts the writable on failure so
   *  a half-written document is never left where the original was. */
  function writeHandle(handle, text) {
    return Promise.resolve(handle.createWritable()).then(function (writable) {
      return Promise.resolve(writable.write(text)).then(function () {
        return writable.close();
      }, function (error) {
        try { writable.abort(); } catch (ignored) {}
        throw error;
      });
    });
  }

  /** Tell Ryker what Save Document may overwrite, or that there is nothing.
   *
   *  MARKDOWN ONLY, and this is a correctness boundary rather than a policy.
   *  Ryker holds a byte-faithful writer for exactly one format: exportMarkdown
   *  replays the authored source and rewrites only the blocks that changed. An
   *  HTML document has no such writer. What it has is exportHtml.clean(), which
   *  serialises `sourceShell`, and sourceShell is the SANITISED parse: no
   *  script, no style, no link, no inline style attribute, no data-* on any
   *  descendant. That is correct for a document being sent to a reader and
   *  correct for Save Document As, which writes a new file beside the original.
   *  Aimed at the original it is destruction: one typo fix would return an
   *  authored report with its stylesheet gone and no copy kept.
   *
   *  So HTML gets no target, Save Document does not appear for it, and
   *  exportDialog.save() explains the absence if it is reached another way.
   *  Lifting this needs an HTML source map, not a change here. */
  function registerSaveTarget(handle, name, markdown) {
    if (!window.Ryker || !Ryker.saveTarget) return;
    if (!markdown) { Ryker.saveTarget.clear(); return; }
    if (!handle || typeof handle.createWritable !== 'function') { Ryker.saveTarget.clear(); return; }
    Ryker.saveTarget.set({
      name: name,
      ensureWritable: function () { return ensureWritable(handle); },
      write: function (text) { return writeHandle(handle, text); }
    });
  }

  function reloadWith(name, text, handle) {
    if (window.Ryker && Ryker.editable && Ryker.editable.isDirty() &&
        !window.confirm('Open another file and discard the current unsaved edits?')) {
      return Promise.reject(new Error('The current document remains open.'));
    }
    var token = mintToken();
    try {
      sessionStorage.setItem(pendingKey,
        JSON.stringify({ name: name, text: text, token: token }));
    } catch (error) {
      return Promise.reject(new Error(
        'The next file is too large to carry across a safe workspace reload.'));
    }
    // The text goes through sessionStorage and the handle through IndexedDB,
    // because only one of them survives JSON. The token is the thread between
    // them. The reload waits for the handle to land so the reopened document
    // knows it is writable.
    return stashHandle(handle, token).then(function () {
      location.reload();
      return { name: name, reloading: true };
    });
  }

  function superseded(name) {
    return { name: name, superseded: true };
  }

  function openTextAt(name, text, generation, handle) {
    if (!allowed.test(name || '')) return Promise.reject(new Error('Choose an HTML or Markdown file.'));
    var output;
    try { output = rendered(name, text); }
    catch (error) { return Promise.reject(error); }
    // Boot and its listeners own one document lifecycle. Reload before a
    // second file so its identity and pristine baseline cannot inherit the
    // first file's state.
    if (document.body.classList.contains('workspace-loaded')) return reloadWith(name, text, handle);
    return hash(text).then(function (fingerprint) {
      if (generation !== openGeneration) return superseded(name);
      main.innerHTML = output.html;
      if (output.markdown) {
        adoptMarkdown(output.source, output.ranges,
          { eol: output.eol, finalNewline: output.finalNewline });
      }
      sourceShell = output.shell;
      main.hidden = false;
      open.hidden = true;
      document.title = name + ' - Ryker';
      document.body.classList.remove('workspace-dragging');
      document.body.classList.add('workspace-loaded');
      // A workspace upload owns only its per-document identity. Preferences
      // arrive through the extension-owned storage adapter; no global config
      // object is read from chrome.storage or polluted with file-specific data.
      window.Ryker.extensionConfig = {
        RYKER_DOCUMENT_ID: 'upload:' + name + ':' + fingerprint,
        RYKER_DOCUMENT_PATH: name
      };
      window.Ryker.boot.start();
      // After boot, so the menu that reads canSave() is built with the answer
      // rather than before it. A file opened without a handle clears any target
      // the previous document left behind.
      registerSaveTarget(handle, name, output.markdown);
      // Said here rather than on the landing page. Before the file is chosen
      // it is a warning about a situation nobody is in yet; after it opens it
      // is a fact about the document on screen, and it names the one menu item
      // that is missing because of it.
      if (output.markdown && !handle) noticeUnwritable(name);
      return {
        name: name, markdown: output.markdown, writable: !!handle,
        blocks: window.Ryker.blocks.all().length
      };
    }, function (error) {
      if (generation !== openGeneration) return superseded(name);
      throw error;
    });
  }

  // Markdown only. An HTML document never registers a save target, by design:
  // the rendered shell is sanitised and writing it back would strip the styles
  // and scripts the original carried. Saying this for every HTML file would be
  // noise about a decision, not news about a permission.
  function noticeUnwritable(name) {
    if (!window.Ryker || !Ryker.dialog || typeof Ryker.dialog.open !== 'function') return;
    Ryker.dialog.open({
      title: 'Saving over this file is unavailable',
      body: '<div class="note">Ryker cannot write back to <b>' + escapeHtml(name) + '</b>.</div>' +
        '<p>Chrome hands over write access only through its own file picker, and it refuses ' +
        'that picker for some folders, including WSL and network drives. This file arrived ' +
        'another way, so there is no permission attached to it.</p>' +
        '<p>Nothing else changes. Edit as usual, then use <b>Save Document As</b> to write a ' +
        'new file. Your original is left exactly where it is.</p>'
    });
  }

  function openText(name, text, handle) {
    return openTextAt(name, text, ++openGeneration, handle);
  }

  function openFile(file, handle) {
    if (!file) return;
    var generation = ++openGeneration;
    status.classList.remove('error');
    status.textContent = 'Opening ' + file.name + '...';
    file.text().then(function (text) {
      if (generation !== openGeneration) return superseded(file.name);
      return openTextAt(file.name, text, generation, handle);
    }).catch(function (error) {
      if (generation !== openGeneration) return;
      status.classList.add('error');
      status.textContent = error && error.message ? error.message : String(error);
      input.value = '';
    });
  }

  // ONE file control. The picker is the only route to a writable document, so
  // it is what the button does, and the hidden <input> is the fallback.
  //
  // The fallback cannot be automatic, for two independent reasons.
  //
  // Chrome keeps a blocklist of directories it will not hand out a handle for,
  // and a folder that trips it is refused with "can't open files in this
  // folder because it contains system files". Dismissing that refusal rejects
  // with AbortError, the same rejection an ordinary cancel produces, so no
  // catch can tell a blocked folder from a change of mind.
  //
  // And showOpenFilePicker() consumes the transient user activation, so
  // input.click() after it rejects is blocked by Chrome as a file dialog
  // without a gesture. The fallback needs a click of its own whatever we do.
  //
  // So the abort offers the fallback inside the status line, where it appears
  // only once Chrome has actually refused something. The landing page keeps a
  // single button, and what Ryker cannot do to the file is said after it
  // opens, by noticeUnwritable(), rather than as a warning label nobody has a
  // reason to read yet.
  function chooseFile() {
    if (typeof window.showOpenFilePicker !== 'function') { input.value = ''; input.click(); return; }
    window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: 'HTML or Markdown',
        accept: {
          'text/html': ['.html', '.htm'],
          'text/markdown': ['.md', '.markdown']
        }
      }]
    }).then(function (handles) {
      var handle = handles && handles[0];
      if (!handle) return null;
      return handle.getFile().then(function (file) { openFile(file, handle); });
    }).catch(function (error) {
      // Cancelling a picker is an answer, not a failure, so this is a hint and
      // not an error. It is worded to read sensibly after a deliberate cancel
      // as well, because it cannot tell the two apart.
      if (error && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
        offerFallback();
        return;
      }
      status.classList.add('error');
      status.textContent = error && error.message ? error.message : String(error);
    });
  }

  // Built as nodes rather than innerHTML: the status element is a live region
  // that every other path writes with textContent, so this stays a sibling of
  // those writes and is wiped by the next one.
  function offerFallback() {
    status.classList.remove('error');
    status.textContent = 'Nothing opened. Chrome refuses some folders, including WSL and ' +
      'network drives. You can ';
    var link = document.createElement('button');
    link.type = 'button';
    link.className = 'workspace-inline-link';
    link.id = 'workspace-fallback';
    link.textContent = 'browse for it without saving over it';
    // The value is cleared first so choosing the same file twice still fires a
    // change event. <input type=file> yields a File and no handle, so
    // registerSaveTarget clears the target and Save Document leaves the menu.
    link.addEventListener('click', function () { input.value = ''; input.click(); });
    status.appendChild(link);
    status.appendChild(document.createTextNode('.'));
  }

  if (choose) choose.addEventListener('click', chooseFile);
  input.addEventListener('change', function () { openFile(input.files && input.files[0]); });
  document.addEventListener('dragover', function (event) {
    event.preventDefault(); document.body.classList.add('workspace-dragging');
  });
  document.addEventListener('dragleave', function (event) {
    if (!event.relatedTarget) document.body.classList.remove('workspace-dragging');
  });
  document.addEventListener('drop', function (event) {
    event.preventDefault(); document.body.classList.remove('workspace-dragging');
    // Both reads happen NOW: a DataTransfer is emptied when the event handler
    // returns, so nothing about it can be read from inside the then().
    var transfer = event.dataTransfer;
    var file = transfer && transfer.files && transfer.files[0];
    var item = transfer && transfer.items && transfer.items[0];
    if (item && typeof item.getAsFileSystemHandle === 'function') {
      // The fallback is a trailing .catch, not a second argument to .then: an
      // onRejected passed alongside a fulfilment handler cannot catch what that
      // handler itself rejects with, so a failing getFile() would open nothing
      // and report nothing. openFile swallows its own errors and returns
      // undefined, so a success can never fall through and double-open.
      Promise.resolve(item.getAsFileSystemHandle()).then(function (handle) {
        if (handle && handle.kind === 'file') {
          return handle.getFile().then(function (dropped) { openFile(dropped, handle); });
        }
        openFile(file);
      }).catch(function () { openFile(file); });
      return;
    }
    openFile(file);
  });

  window.RykerWorkspace = {
    openText: openText,
    markdown: markdown,
    markdownBlocks: markdownBlocks,
    safeHtml: safeHtml,
    sourceShell: sourceShellClone
  };

  try {
    var pending = sessionStorage.getItem(pendingKey);
    if (pending) {
      sessionStorage.removeItem(pendingKey);
      pending = JSON.parse(pending);
      setTimeout(function () {
        // The handle is collected whether or not one was parked, so a stale one
        // never outlives the reload that carried it.
        takeHandle(pending.token).then(function (handle) {
          return openText(pending.name, pending.text, handle);
        }).catch(function (error) {
          status.classList.add('error');
          status.textContent = error && error.message ? error.message : String(error);
        });
      }, 0);
    } else {
      // Nothing pending in THIS tab, so anything parked is either from a reload
      // that was abandoned or from another tab reloading right now. Only the
      // ones too old to still be owed are removed.
      sweepHandles();
    }
  } catch (error) {
    status.classList.add('error');
    status.textContent = 'The selected file could not be restored after the workspace reload.';
  }
})();
