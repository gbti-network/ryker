// Credential leakage scan, spec section 44, widened per sow-004 finding 6.
//
// The spec scans packages before download. It also ships a "with Ryker" export
// carrying configuration, and allows exporting a working copy while GitHub is
// unavailable. A token that reached the DOM would leave through either of those
// without the packager ever seeing it, so the scan belongs to the export
// pipeline rather than to the packager, and runs on every generated artifact.
//
// This is defence in depth. It is not a substitute for never putting a
// credential in the document in the first place.
Ryker.scan = (function () {
  'use strict';

  var PATTERNS = [
    { name: 'GitHub personal access token (classic)', re: /\bghp_[A-Za-z0-9]{36,}\b/ },
    { name: 'GitHub OAuth token', re: /\bgho_[A-Za-z0-9]{36,}\b/ },
    { name: 'GitHub user-to-server token', re: /\bghu_[A-Za-z0-9]{36,}\b/ },
    { name: 'GitHub server-to-server token', re: /\bghs_[A-Za-z0-9]{36,}\b/ },
    { name: 'GitHub refresh token', re: /\bghr_[A-Za-z0-9]{36,}\b/ },
    { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
    { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: 'Google OAuth client secret', re: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/ },
    { name: 'Google refresh token', re: /\b1\/\/[A-Za-z0-9_-]{30,}\b/ },
    { name: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{35}\b/ },
    { name: 'Service account credential', re: /"type"\s*:\s*"service_account"/ },
    { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'Generic bearer token assignment', re: /["']?\b(client_secret|refresh_token|private_key)\b["']?\s*[:=]\s*["'][^"'\r\n]{16,4096}["']/ }
  ];

  // Returns [] when clean. Each hit names the pattern and gives a short
  // redacted excerpt, never the credential itself, so a scan report can be
  // shown on screen without becoming a second leak.
  function text(content, label) {
    var hits = [];
    PATTERNS.forEach(function (p) {
      var m = p.re.exec(content);
      if (m) {
        hits.push({
          artifact: label || 'document',
          pattern: p.name,
          excerpt: redact(m[0])
        });
      }
    });
    return hits;
  }

  function redact(s) {
    if (s.length <= 12) return s.slice(0, 3) + '...';
    return s.slice(0, 6) + '...' + s.slice(-2) + ' (' + s.length + ' chars)';
  }

  // Binary members of a package are checked as latin1 so a key pasted into a
  // CSV or a text file inside the ZIP is still caught. Images will not match.
  //
  // Scan in bounded chunks rather than silently stopping after 2 MiB. The
  // overlap is larger than the longest bounded pattern above, so a credential
  // split across two chunks is still seen. Duplicate hits from the overlap are
  // collapsed before returning.
  function bytes(u8, label) {
    var chunkSize = 256 * 1024;
    var overlap = 8192;
    var tail = '';
    var hits = [];
    var seen = {};
    for (var offset = 0; offset < u8.length; offset += chunkSize) {
      var end = Math.min(offset + chunkSize, u8.length);
      var content = tail;
      for (var i = offset; i < end; i++) content += String.fromCharCode(u8[i]);
      text(content, label).forEach(function (hit) {
        var key = hit.artifact + '\n' + hit.pattern + '\n' + hit.excerpt;
        if (!seen[key]) { seen[key] = true; hits.push(hit); }
      });
      tail = content.slice(-overlap);
    }
    // Properties keep the array API compatible while making it impossible for
    // a caller to mistake a future partial scan for a clean one.
    hits.truncated = false;
    hits.scannedBytes = u8.length;
    hits.totalBytes = u8.length;
    return hits;
  }

  return { text: text, bytes: bytes, patterns: PATTERNS };
})();
