(function () {
  'use strict';

  // The workspace is extension-owned DOM rather than shadow DOM, but it uses
  // the same canonical tokens as the injected and drop-in Ryker chrome.
  if (window.Ryker && Ryker.theme) Ryker.theme.apply(document.documentElement);

  var input = document.getElementById('workspace-file');
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
    function flushList() {
      if (!list) return;
      push('<' + list.tag + '>' + list.items.map(function (item) {
        return '<li' + srcAttr(item) + '>' + inlineMarkdown(item) + '</li>';
      }).join('') + '</' + list.tag + '>', list.from, list.to);
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
      var item = line.match(/^\s*[-*+]\s+(.+)$/);
      var numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (item || numbered) {
        flushParagraph(); flushQuote();
        var tag = numbered ? 'ol' : 'ul';
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag: tag, items: [], from: index, to: index };
        list.items.push((numbered || item)[1]);
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

  function markdownLimitation(text) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (/^\s{2,}(?:[-*+] |\d+[.)] )/.test(lines[i])) return 'nested lists';
    }
    return null;
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
    var unsupported = isMarkdown ? markdownLimitation(text) : null;
    if (unsupported) {
      throw new Error('This Markdown contains ' + unsupported +
        ', which Ryker cannot preserve yet. Convert it to HTML before editing.');
    }
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
      ranges: blocks
        ? blocks.map(function (block) { return { from: block.from, to: block.to }; })
        : null
    };
  }

  // Ranges go onto the elements rather than into an array held alongside them,
  // because the outline rail moves and deletes blocks and an index stops
  // meaning anything the moment it does. Done before boot.start(), so Ryker
  // sees a document that already carries its own provenance.
  function adoptMarkdown(source, ranges) {
    var children = main.children;
    for (var i = 0; i < ranges.length && i < children.length; i++) {
      children[i].setAttribute('data-ryker-md-from', String(ranges[i].from));
      children[i].setAttribute('data-ryker-md-to', String(ranges[i].to));
    }
    if (window.Ryker && Ryker.exportMarkdown) Ryker.exportMarkdown.adopt(source);
  }

  function reloadWith(name, text) {
    if (window.Ryker && Ryker.editable && Ryker.editable.isDirty() &&
        !window.confirm('Open another file and discard the current unsaved edits?')) {
      return Promise.reject(new Error('The current document remains open.'));
    }
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify({ name: name, text: text }));
    } catch (error) {
      return Promise.reject(new Error(
        'The next file is too large to carry across a safe workspace reload.'));
    }
    location.reload();
    return Promise.resolve({ name: name, reloading: true });
  }

  function superseded(name) {
    return { name: name, superseded: true };
  }

  function openTextAt(name, text, generation) {
    if (!allowed.test(name || '')) return Promise.reject(new Error('Choose an HTML or Markdown file.'));
    var output;
    try { output = rendered(name, text); }
    catch (error) { return Promise.reject(error); }
    // Boot and its listeners own one document lifecycle. Reload before a
    // second file so its identity and pristine baseline cannot inherit the
    // first file's state.
    if (document.body.classList.contains('workspace-loaded')) return reloadWith(name, text);
    return hash(text).then(function (fingerprint) {
      if (generation !== openGeneration) return superseded(name);
      main.innerHTML = output.html;
      if (output.markdown) adoptMarkdown(output.source, output.ranges);
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
      return { name: name, markdown: output.markdown, blocks: window.Ryker.blocks.all().length };
    }, function (error) {
      if (generation !== openGeneration) return superseded(name);
      throw error;
    });
  }

  function openText(name, text) {
    return openTextAt(name, text, ++openGeneration);
  }

  function openFile(file) {
    if (!file) return;
    var generation = ++openGeneration;
    status.classList.remove('error');
    status.textContent = 'Opening ' + file.name + '...';
    file.text().then(function (text) {
      if (generation !== openGeneration) return superseded(file.name);
      return openTextAt(file.name, text, generation);
    }).catch(function (error) {
      if (generation !== openGeneration) return;
      status.classList.add('error');
      status.textContent = error && error.message ? error.message : String(error);
      input.value = '';
    });
  }

  input.addEventListener('change', function () { openFile(input.files && input.files[0]); });
  document.addEventListener('dragover', function (event) {
    event.preventDefault(); document.body.classList.add('workspace-dragging');
  });
  document.addEventListener('dragleave', function (event) {
    if (!event.relatedTarget) document.body.classList.remove('workspace-dragging');
  });
  document.addEventListener('drop', function (event) {
    event.preventDefault(); document.body.classList.remove('workspace-dragging');
    openFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
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
        openText(pending.name, pending.text).catch(function (error) {
          status.classList.add('error');
          status.textContent = error && error.message ? error.message : String(error);
        });
      }, 0);
    }
  } catch (error) {
    status.classList.add('error');
    status.textContent = 'The selected file could not be restored after the workspace reload.';
  }
})();
