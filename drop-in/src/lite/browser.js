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
      body: '<p>Ryker Lite can write a copy of the instructions to a folder every time you ' +
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
              Ryker.lite.sync();
              if (ok) open();
            });
          }
        }
      ]
    });
  }

  return { open: open, view: view };
})();
