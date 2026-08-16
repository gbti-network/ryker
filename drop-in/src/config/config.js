// Configuration intake and the four detection states of spec section 6.
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
    RYKER_GITHUB_ENABLED: false,
    RYKER_GITHUB_OWNER: null,
    RYKER_GITHUB_REPO: null,
    RYKER_GITHUB_REPOSITORY_ID: null,
    RYKER_GITHUB_BRANCH: 'main',
    RYKER_GITHUB_CLIENT_ID: null,
    RYKER_GOOGLE_ENABLED: false
  };

  // Anything on this list is a secret and must never reach a shipped report.
  // Checked at boot so a misconfigured build fails loudly in the toolbar rather
  // than shipping a credential quietly.
  var FORBIDDEN = [
    'RYKER_GITHUB_CLIENT_SECRET', 'RYKER_GITHUB_PRIVATE_KEY',
    'RYKER_GITHUB_TOKEN', 'RYKER_GITHUB_INSTALLATION_TOKEN',
    'RYKER_GOOGLE_CLIENT_SECRET', 'RYKER_GOOGLE_REFRESH_TOKEN',
    'RYKER_SERVICE_ACCOUNT'
  ];

  var state = null;

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
    if (window.RYKER_CONFIG) {
      Object.keys(window.RYKER_CONFIG).forEach(function (k) { raw[k] = window.RYKER_CONFIG[k]; });
    }
    var inline = readInline();
    if (inline) Object.keys(inline).forEach(function (k) { raw[k] = inline[k]; });

    var leaked = FORBIDDEN.filter(function (k) { return raw[k] != null && raw[k] !== ''; });

    var cfg = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      cfg[k] = raw[k] != null ? raw[k] : DEFAULTS[k];
    });

    // The document id must not depend on the filename, per spec section 34.
    // Falling back to the title is better than falling back to the path,
    // because a renamed file keeps its title and loses its path.
    if (!cfg.RYKER_DOCUMENT_ID) {
      cfg.RYKER_DOCUMENT_ID = slug(document.title || 'untitled');
    }
    if (!cfg.RYKER_DOCUMENT_PATH) {
      var last = location.pathname.split('/').pop();
      cfg.RYKER_DOCUMENT_PATH = last ? decodeURIComponent(last) : 'report.html';
    }

    cfg._leaked = leaked;
    cfg._state = detect(cfg);
    state = cfg;
    return state;
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
  }

  // Section 6's four states. Reported rather than inferred at each call site,
  // so the toolbar and the onboarding panel cannot disagree about which one
  // the document is in.
  function detect(cfg) {
    var hasRepo = !!(cfg.RYKER_GITHUB_OWNER && cfg.RYKER_GITHUB_REPO);
    var hasAuth = cfg.RYKER_GITHUB_ENABLED === true;
    if (!hasAuth && !hasRepo) return 'unconfigured';
    if (hasAuth && !hasRepo) return 'repo-missing';
    if (!hasAuth && hasRepo) return 'auth-missing';
    return 'configured';
  }

  function stateLabel(s) {
    return {
      'unconfigured': 'GitHub collaboration not configured',
      'repo-missing': 'GitHub ready, repository not set',
      'auth-missing': 'Repository set, GitHub sign-in not enabled',
      'configured': 'GitHub collaboration available'
    }[s] || s;
  }

  function repoSlug(cfg) {
    return cfg.RYKER_GITHUB_OWNER + '/' + cfg.RYKER_GITHUB_REPO;
  }

  return { load: load, detect: detect, stateLabel: stateLabel, repoSlug: repoSlug, slug: slug };
})();
