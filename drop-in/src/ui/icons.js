// Inline SVG icons. Small, stroke-based, currentColor, so they take the
// button's own colour and need no font or network.
Ryker.icons = (function () {
  'use strict';

  // The approved 32px Chrome export, embedded because the same bundle also runs
  // as a drop-in and page-world extension script where no package-relative URL
  // is available. Keeping it here avoids a network request and another Chrome
  // web-accessible resource.
  var BRAND_MARK = 'data:image/png;base64,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';

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
