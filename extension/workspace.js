(function () {
  'use strict';

  // The workspace is extension-owned DOM rather than shadow DOM, but it uses
  // the same canonical tokens as the injected and drop-in Ryker chrome.
  if (window.Ryker && Ryker.theme) Ryker.theme.apply(document.documentElement);

  var input = document.getElementById('workspace-file');
  var main = document.getElementById('workspace-document');
  var status = document.getElementById('workspace-status');
  var allowed = /\.(html?|md|markdown)$/i;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function inlineMarkdown(value) {
    return escapeHtml(value)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|#[^\s)]+)\)/g,
        '<a href="$2">$1</a>');
  }

  function markdown(text) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var out = [], paragraph = [], list = null, quote = [], code = [], fenced = false;

    function flushParagraph() {
      if (!paragraph.length) return;
      out.push('<p>' + inlineMarkdown(paragraph.join(' ')) + '</p>');
      paragraph = [];
    }
    function flushList() {
      if (!list) return;
      out.push('<' + list.tag + '>' + list.items.map(function (item) {
        return '<li>' + inlineMarkdown(item) + '</li>';
      }).join('') + '</' + list.tag + '>');
      list = null;
    }
    function flushQuote() {
      if (!quote.length) return;
      out.push('<blockquote><p>' + inlineMarkdown(quote.join(' ')) + '</p></blockquote>');
      quote = [];
    }

    lines.forEach(function (line) {
      if (/^\s*```/.test(line)) {
        flushParagraph(); flushList(); flushQuote();
        if (fenced) { out.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>'); code = []; }
        fenced = !fenced;
        return;
      }
      if (fenced) { code.push(line); return; }
      var heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        flushParagraph(); flushList(); flushQuote();
        out.push('<h' + heading[1].length + '>' + inlineMarkdown(heading[2]) + '</h' + heading[1].length + '>');
        return;
      }
      var item = line.match(/^\s*[-*+]\s+(.+)$/);
      var numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (item || numbered) {
        flushParagraph(); flushQuote();
        var tag = numbered ? 'ol' : 'ul';
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag: tag, items: [] };
        list.items.push((numbered || item)[1]);
        return;
      }
      var quoted = line.match(/^\s*>\s?(.*)$/);
      if (quoted) {
        flushParagraph(); flushList(); quote.push(quoted[1]); return;
      }
      if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); return; }
      flushList(); flushQuote(); paragraph.push(line.trim());
    });
    if (fenced) out.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
    flushParagraph(); flushList(); flushQuote();
    return out.join('\n');
  }

  function safeHtml(text) {
    var parsed = new DOMParser().parseFromString(String(text), 'text/html');
    parsed.querySelectorAll('script,style,link,meta,base,iframe,object,embed').forEach(function (node) {
      node.remove();
    });
    parsed.querySelectorAll('*').forEach(function (node) {
      Array.prototype.slice.call(node.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        var value = String(attr.value || '').trim();
        if (name.indexOf('on') === 0 || name === 'srcdoc' || name === 'style') node.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src' || name === 'action') &&
            /^(javascript|vbscript|file|blob):/i.test(value)) node.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src') && /^data:/i.test(value) &&
            !/^data:image\/(png|jpe?g|gif|webp|avif)[;,]/i.test(value)) node.removeAttribute(attr.name);
      });
    });
    return parsed.body.innerHTML;
  }

  function hash(text) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve(String(text.length));
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buffer) {
      return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('').slice(0, 16);
    });
  }

  function storedConfig() {
    if (!window.chrome || !chrome.storage || !chrome.storage.local) return Promise.resolve({});
    return chrome.storage.local.get('rykerConfig').then(function (saved) {
      return saved.rykerConfig || {};
    }, function () { return {}; });
  }

  function openText(name, text) {
    if (!allowed.test(name || '')) return Promise.reject(new Error('Choose an HTML or Markdown file.'));
    var isMarkdown = /\.(md|markdown)$/i.test(name);
    return Promise.all([hash(text), storedConfig()]).then(function (values) {
      main.innerHTML = isMarkdown ? markdown(text) : safeHtml(text);
      if (!main.textContent.trim() && !main.querySelector('img')) {
        throw new Error('The selected file has no displayable content.');
      }
      document.title = name + ' - Ryker';
      document.body.classList.remove('workspace-dragging');
      document.body.classList.add('workspace-loaded');
      var config = values[1];
      config.RYKER_DOCUMENT_ID = 'upload:' + name + ':' + values[0];
      config.RYKER_DOCUMENT_PATH = name;
      window.Ryker.extensionConfig = config;
      window.Ryker.boot.start();
      return { name: name, markdown: isMarkdown, blocks: window.Ryker.blocks.all().length };
    });
  }

  function openFile(file) {
    if (!file) return;
    status.classList.remove('error');
    status.textContent = 'Opening ' + file.name + '…';
    file.text().then(function (text) {
      return openText(file.name, text);
    }).catch(function (error) {
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

  window.RykerWorkspace = { openText: openText, markdown: markdown, safeHtml: safeHtml };
})();
