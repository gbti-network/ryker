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
