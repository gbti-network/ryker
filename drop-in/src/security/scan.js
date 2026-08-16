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
    { name: 'Generic bearer token assignment', re: /\b(client_secret|refresh_token|private_key)\s*[:=]\s*["'][^"']{16,}["']/ }
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
  function bytes(u8, label) {
    var s = '';
    var limit = Math.min(u8.length, 2 * 1024 * 1024);
    for (var i = 0; i < limit; i++) s += String.fromCharCode(u8[i]);
    return text(s, label);
  }

  return { text: text, bytes: bytes, patterns: PATTERNS };
})();
