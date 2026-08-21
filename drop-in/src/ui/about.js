// About Ryker: what this build is, who maintains it, and the one thing we ask.
//
// LAST in the menu, after the divider that follows Clear document. An About
// entry is conventionally last, and putting it below the one destructive action
// means a mis-click at the very bottom of the menu opens a dialog rather than
// emptying somebody's document.
//
// Its own module rather than another block in boot.js, which is at 540 of its
// 600 line cap and is about starting Ryker rather than describing it. That cap
// already forced the export dialog out once.
Ryker.about = (function () {
  'use strict';

  // Named rather than inlined, so a link that moves is changed in one place.
  var LINKS = {
    home: 'https://gbti.network',
    membership: 'https://gbti.network/membership/',
    source: 'https://github.com/gbti-network/ryker',
    issues: 'https://github.com/gbti-network/ryker/issues',
    license: 'https://github.com/gbti-network/ryker/blob/main/LICENSE',
    privacy: 'https://github.com/gbti-network/ryker/blob/main/privacy.md'
  };

  // rel is not decoration. target=_blank without noopener hands the opened page
  // a live window.opener back into the document being edited, and on the drop-in
  // surface that document is somebody's report on their own disk.
  function link(href, text) {
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' +
      text + '</a>';
  }

  /** Which build this is, in the form a bug report needs. The surface matters
   *  more than it looks: the same version behaves differently as an extension
   *  and as a drop-in, and "Save Document is missing" is expected on one and a
   *  defect on the other. */
  function build() {
    var version = String(Ryker.VERSION || 'unversioned');
    var surface = Ryker.SURFACE === 'extension' ? 'extension' : 'drop-in';
    return Ryker.dom.escapeHtml(version + ' (' + surface + ' build)');
  }

  function row(label, value, cls) {
    var c = cls ? ' class="' + cls + '"' : '';
    return '<dt' + c + '>' + label + '</dt><dd' + c + '>' + value + '</dd>';
  }

  function open() {
    Ryker.dialog.open({
      title: 'About Ryker',
      // A label/value table rather than prose. Somebody opens About to look one
      // fact up, usually the version, and a paragraph makes them read for it.
      body: '<dl class="kv">' +
        row('Version', build()) +
        row('Maintainer', link(LINKS.home, 'GBTI Network')) +
        // The link and nothing else. Summarising a licence in a table cell
        // invites somebody to rely on the summary, and the terms that actually
        // bind them are the ones in the file.
        row('License', link(LINKS.license, 'Source-available')) +
        row('Source', link(LINKS.source, 'github.com/gbti-network/ryker')) +
        row('Report a bug', link(LINKS.issues, 'Open an issue')) +
        row('Privacy', link(LINKS.privacy, 'Nothing is tracked')) +
        // The ask, and the only one. Last row on purpose: a tool that promises
        // no telemetry and then leads with a pitch has spent the promise.
        // The only break point is before the ampersand, so the label reads
        // "Contributions" then "& Gratuity" rather than stranding the & at the
        // end of the first line.
        row('Contributions &amp;\u00a0Gratuity',
          'Join ' + link(LINKS.membership, 'our professional network') +
          ' to support Ryker and other projects developed and maintained by ' +
          'GBTI Network.', 'cta') +
        '</dl>'
    });
  }

  return { open: open, LINKS: LINKS, build: build };
})();
