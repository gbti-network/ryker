// Inline SVG icons. Small, stroke-based, currentColor, so they take the
// button's own colour and need no font or network.
Ryker.icons = (function () {
  'use strict';

  // The approved 32px Chrome export, embedded because the same bundle also runs
  // as a drop-in and page-world extension script where no package-relative URL
  // is available. Keeping it here avoids a network request and another Chrome
  // web-accessible resource.
  var BRAND_MARK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAADLUlEQVRYw73WSYhcVRQG4K+G7oIouFAJGBrdiAFRFId2jOhKFKdV0I2CE4guRLMMuhPBTVyo4EaCigOCGyE7QUVwwAFRk4CIQxQ1QcUp6a7qcnHP6bq8dFmlpupAceu9d+75/zPc/73WgYsuNSdroYM+rsLn+L49J/BOrH3cgWfxO8yDwAIGGOJRPI2v8Bva3RlnPcQqtuB5bItnb8bankUF2uhG1mu4E/sD/Ej4vBrr8FhWoB1ZrwbwudiFy+P5EfTwLt5WhnJwLCqQGa8F+JLS5w8CvK+0IpN9qNrn/1SgHb9+gG/Gg7gvMh3G/S5WsIjd2BOVGvxXAk3gJdyPu3Bc+PQjdqcC/wS3xfNhBvs3BGohWcPpeCCC9irgjtEQDivws8PneKEB632YwroRrI8z8Az24u4Ar/ucfknkqQC/GC9FRTKhqQh0I+AmZar34taqDQm8Fr8cyvexjB14XJn8j4NAEp3YggS/JNhvaZQ6xSbbQxGZJ/EZbo7rRXytKKFozzrAJPDteCHurcb9el8Lh/AGXg+f7bihEe8eo+HsTyKQTtdX4ANF12s7qAzYNzgZO2NN/0FkvxOvNcHHEcjenoaXq2Cdhl8GuhBXVvdTbnuxZwceq+IelWnTWrHuCvarG2See0+K/yuxb8HoSH6kaMN7AT7cIMZRpyAV6oIo/1oDPNWtaYvhdwgvKhJ8Hr4LYsNxBJoVyOxvjzWPVf08A/6IL7FPmYOchS6uwRO4Fwf+qQLNae5HJlePqdCvylneh5+i9JtwFq5T1PGU8L1RORnruj+JQDscz8GpwbgmkBmcqajawpiY30b7PrTB1DetWV64LNZknWrXwgk4cQz4QTyCrdOCNyuQGW6rruv3+A/4GX8GmYEydPsVmd2DX8I3X1oTLYNnwJ4yvaosdysD9Sn+MGaYqngpQFNZTWAY5VuKe4dxU2RWW6v6366uB9NmvRGBtnLkzo/rFVyhfL8tGn1gZmvSps50EoG05VhvCfCekbTOxPIUZOmuxXN4RZmBmYIngSSxFX8p3/E1qbkRWMbDQWL9i2XWlscGvsA788w+CaTKvTUv0Nr+BovA15ZlANGUAAAAAElFTkSuQmCC';

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
