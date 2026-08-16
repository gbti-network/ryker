// ZIP writer. Container written here, compression done by the browser.
//
// CompressionStream('deflate-raw') is genuine deflate and is exactly the codec
// a ZIP member needs, so no compression library is vendored at all. Confirmed
// present from file:// on 2026-08-13. Members fall back to stored when it is
// missing, which produces a larger but perfectly valid archive.
Ryker.zip = (function () {
  'use strict';

  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function deflate(u8) {
    if (typeof CompressionStream !== 'function' || !u8.length) {
      return Promise.resolve(null);
    }
    try {
      var cs = new CompressionStream('deflate-raw');
      var stream = new Blob([u8]).stream().pipeThrough(cs);
      return new Response(stream).arrayBuffer().then(function (buf) {
        var out = new Uint8Array(buf);
        // A member that grew under compression is stored instead.
        return out.length < u8.length ? out : null;
      }).catch(function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }

  function W(size) {
    var b = new Uint8Array(size);
    var v = new DataView(b.buffer);
    var p = 0;
    return {
      u16: function (n) { v.setUint16(p, n, true); p += 2; return this; },
      u32: function (n) { v.setUint32(p, n >>> 0, true); p += 4; return this; },
      raw: function (u8) { b.set(u8, p); p += u8.length; return this; },
      done: function () { return b; }
    };
  }

  function toBytes(data) {
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new TextEncoder().encode(String(data));
  }

  // files: [{ name: 'a/b.csv', data: string | Uint8Array }]
  function build(files) {
    var when = new Date();
    var time = dosTime(when), date = dosDate(when);

    return Promise.all(files.map(function (f) {
      var raw = toBytes(f.data);
      return deflate(raw).then(function (comp) {
        return {
          nameBytes: new TextEncoder().encode(f.name),
          raw: raw,
          body: comp || raw,
          method: comp ? 8 : 0,
          crc: crc32(raw)
        };
      });
    })).then(function (entries) {
      var locals = [];
      var offset = 0;
      entries.forEach(function (e) {
        var head = W(30 + e.nameBytes.length);
        head.u32(0x04034b50).u16(20).u16(0x0800).u16(e.method)
          .u16(time).u16(date).u32(e.crc)
          .u32(e.body.length).u32(e.raw.length)
          .u16(e.nameBytes.length).u16(0).raw(e.nameBytes);
        e.offset = offset;
        var h = head.done();
        locals.push(h, e.body);
        offset += h.length + e.body.length;
      });

      var cdStart = offset;
      var central = [];
      entries.forEach(function (e) {
        var c = W(46 + e.nameBytes.length);
        c.u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(e.method)
          .u16(time).u16(date).u32(e.crc)
          .u32(e.body.length).u32(e.raw.length)
          .u16(e.nameBytes.length).u16(0).u16(0).u16(0).u16(0).u32(0)
          .u32(e.offset).raw(e.nameBytes);
        var cb = c.done();
        central.push(cb);
        offset += cb.length;
      });

      var end = W(22);
      end.u32(0x06054b50).u16(0).u16(0)
        .u16(entries.length).u16(entries.length)
        .u32(offset - cdStart).u32(cdStart).u16(0);

      var parts = locals.concat(central, [end.done()]);
      var total = parts.reduce(function (n, p) { return n + p.length; }, 0);
      var out = new Uint8Array(total);
      var at = 0;
      parts.forEach(function (p) { out.set(p, at); at += p.length; });
      return out;
    });
  }

  function download(u8, filename) {
    var blob = new Blob([u8], { type: 'application/zip' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  return { build: build, download: download, crc32: crc32 };
})();
