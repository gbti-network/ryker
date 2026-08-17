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
