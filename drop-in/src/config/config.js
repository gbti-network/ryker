// Configuration intake.
//
// Config never arrives by fetch. A file:// page cannot read a sibling file:
// fetch() rejects and synchronous XHR throws NetworkError, measured 2026-08-13.
// So config is either a classic script that assigned window.RYKER_CONFIG, or an
// inline JSON block. Both load from disk; a fetched .json does not.
Ryker.config = (function () {
  'use strict';

  var DEFAULTS = {
    RYKER_ENABLED: true,
    RYKER_DOCUMENT_ID: null,
    RYKER_DOCUMENT_PATH: null,
    // Read by export/packager.js:37 to list files that belong with the report
    // but are not inside it. It was missing from this object, and load() below
    // copies only the keys named here, so the value was stripped out of every
    // configuration before the packager could see it and manifestAssets() could
    // never return a row. Nothing failed and nothing warned; the Package dialog
    // simply offered fewer files than it promised.
    RYKER_PACKAGE_MANIFEST: null
  };

  // Anything on this list is a secret and must never reach a shipped report.
  // Checked at boot so a misconfigured build fails loudly in the toolbar rather
  // than shipping a credential quietly.
  //
  // These names outlive the GitHub and Google features they were written for.
  // The feature keys are gone from DEFAULTS above because nothing read them,
  // but a config file written for an older build can still carry the secrets,
  // and an inherited ryker.config.js is exactly where one would sit unnoticed.
  // This list is the check that catches it, so it stays whether or not Ryker
  // has anything left to do with either service.
  var FORBIDDEN = [
    'RYKER_GITHUB_CLIENT_SECRET', 'RYKER_GITHUB_PRIVATE_KEY',
    'RYKER_GITHUB_TOKEN', 'RYKER_GITHUB_INSTALLATION_TOKEN',
    'RYKER_GOOGLE_CLIENT_SECRET', 'RYKER_GOOGLE_REFRESH_TOKEN',
    'RYKER_SERVICE_ACCOUNT'
  ];

  var state = null;

  function extensionDocumentId() {
    var canonical = String(location.origin || '') + String(location.pathname || '/');
    var host = String(location.hostname || location.protocol.replace(':', '') || 'document')
      .toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'document';
    function part(seed) {
      var h = seed >>> 0;
      for (var i = 0; i < canonical.length; i++) {
        h ^= canonical.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(16).padStart(8, '0');
    }
    return 'web-' + host + '-' + part(2166136261) + part(2246822519);
  }

  function readInline() {
    var tag = document.getElementById('ryker-config');
    if (!tag) return null;
    try { return JSON.parse(tag.textContent); } catch (e) { return null; }
  }

  function load() {
    if (state) return state;
    // window.RYKER_CONFIG is the shared base, typically one ryker.config.js
    // covering a whole set of reports. The inline block is the individual
    // document speaking for itself, so it wins: the document id and path differ
    // per report while everything else is common to the set.
    var raw = {};
    // A content script runs in an isolated world, so page JavaScript cannot
    // provide its configuration. The extension worker supplies this object
    // immediately before it explicitly starts Ryker.
    if (Ryker.SURFACE === 'extension' && Ryker.extensionConfig) {
      Object.keys(Ryker.extensionConfig).forEach(function (k) {
        raw[k] = Ryker.extensionConfig[k];
      });
    } else if (window.RYKER_CONFIG) {
      Object.keys(window.RYKER_CONFIG).forEach(function (k) { raw[k] = window.RYKER_CONFIG[k]; });
    }
    var inline = Ryker.SURFACE === 'extension' ? null : readInline();
    if (inline) Object.keys(inline).forEach(function (k) { raw[k] = inline[k]; });

    var leaked = FORBIDDEN.filter(function (k) { return raw[k] != null && raw[k] !== ''; });

    var cfg = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      cfg[k] = raw[k] != null ? raw[k] : DEFAULTS[k];
    });

    // Authored reports use their stable title rather than a filename. On the
    // extension surface origin + path are the stable identity. Query strings
    // and fragments commonly contain signed-preview or SSO secrets and must not
    // become storage keys, revision metadata or exported package manifests.
    if (!cfg.RYKER_DOCUMENT_ID) {
      cfg.RYKER_DOCUMENT_ID = Ryker.SURFACE === 'extension'
        ? extensionDocumentId()
        : slug(document.title || 'untitled');
    }
    if (!cfg.RYKER_DOCUMENT_PATH) {
      var last = location.pathname.split('/').pop();
      cfg.RYKER_DOCUMENT_PATH = last ? decodeURIComponent(last) : 'report.html';
    }

    cfg._leaked = leaked;
    state = cfg;
    return state;
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
  }

  return { load: load, slug: slug };
})();
