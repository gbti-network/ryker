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
