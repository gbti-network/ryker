// Setup, driven by what is missing rather than by a documentation page.
//
// The important part is the last step: the token is verified by calling the API
// and reporting the access actually found. A paste is never trusted on its own,
// because a token that reads but cannot write would otherwise let someone edit
// for an hour and discover it at the save.
Ryker.onboard = (function () {
  'use strict';

  var TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

  function d() { return Ryker.dom; }

  function open() {
    var cfg = Ryker.config.load();
    switch (cfg._state) {
      case 'unconfigured': return unconfigured(cfg);
      case 'repo-missing': return repoMissing(cfg);
      case 'auth-missing': return authMissing(cfg);
      default: return signIn(cfg);
    }
  }

  function configBlock(cfg) {
    return 'window.RYKER_CONFIG = {\n' +
      '  RYKER_ENABLED: true,\n' +
      '  RYKER_DOCUMENT_ID: "' + (cfg.RYKER_DOCUMENT_ID || 'my-report') + '",\n' +
      '  RYKER_DOCUMENT_PATH: "' + (cfg.RYKER_DOCUMENT_PATH || 'report.html') + '",\n' +
      '  RYKER_GITHUB_ENABLED: true,\n' +
      '  RYKER_GITHUB_OWNER: "your-org",\n' +
      '  RYKER_GITHUB_REPO: "your-report-repo",\n' +
      '  RYKER_GITHUB_BRANCH: "main"\n' +
      '};';
  }

  function unconfigured(cfg) {
    Ryker.dialog.open({
      title: 'GitHub collaboration not configured',
      body: '<p>This report is not connected to a repository, so it saves into this browser ' +
        'and nowhere else. That is a working setup: you can edit, comment and export without ' +
        'configuring anything.</p>' +
        '<p>To collaborate through GitHub instead, put a <code>ryker.config.js</code> next to ' +
        'the report and load it before <code>ryker.js</code>:</p>' +
        '<pre><code>' + d().escapeHtml(configBlock(cfg)) + '</code></pre>' +
        '<div class="note"><b>A config file, not a fetch.</b> A page opened from disk cannot ' +
        'read a sibling <code>.json</code> at all, so the configuration ships as a script that ' +
        'assigns <code>window.RYKER_CONFIG</code>. That loads from a file:// URL; a fetched ' +
        'JSON file does not.</div>' +
        '<div class="note warn"><b>Nothing secret goes in that file.</b> It ships inside the ' +
        'report, so anyone who opens the report can read it. A repository name and a client id ' +
        'are public by design. A client secret, a private key or a token is not, and Ryker ' +
        'refuses to start with one present.</div>'
    });
  }

  function repoMissing(cfg) {
    Ryker.dialog.open({
      title: 'Repository not set',
      body: '<p>GitHub is enabled for this report but it does not know which repository holds ' +
        'the document. Add the owner and repository name to <code>ryker.config.js</code>:</p>' +
        '<pre><code>' + d().escapeHtml(configBlock(cfg)) + '</code></pre>'
    });
  }

  function authMissing(cfg) {
    Ryker.dialog.open({
      title: 'GitHub sign-in not enabled',
      body: '<p>The repository <code>' + d().escapeHtml(Ryker.config.repoSlug(cfg)) + '</code> is ' +
        'configured, but <code>RYKER_GITHUB_ENABLED</code> is not <code>true</code>, so Ryker will ' +
        'not attempt to authenticate anyone.</p>' +
        '<p>Set it to <code>true</code> in <code>ryker.config.js</code> to turn the sign-in step on.</p>'
    });
  }

  function signIn(cfg) {
    var gh = Ryker.storage.get('github');
    var input = d().el('input', {
      class: 'rk', type: 'password', placeholder: 'github_pat_...',
      autocomplete: 'off', spellcheck: 'false'
    });
    var result = d().el('div');

    var body = d().el('div', {}, [
      d().el('div', { class: 'note' }, [
        d().el('div', {
          text: 'This report commits to ' + Ryker.config.repoSlug(cfg) + ' on branch ' +
            cfg.RYKER_GITHUB_BRANCH + '. Nothing else is reachable with the token you paste.'
        })
      ]),
      html('<p>Create a <b>fine-grained personal access token</b> scoped to that one repository, ' +
        'with <b>Contents: Read and write</b> and no other permission. GitHub enforces the ' +
        'repository restriction itself, which is why Ryker asks for a fine-grained token rather ' +
        'than a classic one.</p>' +
        '<p><a href="' + TOKEN_URL + '" target="_blank" rel="noopener noreferrer">' +
        'Open the token page on GitHub</a>, then paste the result below.</p>'),
      html('<div class="note warn"><b>Ryker does not need your GitHub App private key or client ' +
        'secret for normal document editing. Do not place those credentials in this report.</b> ' +
        'The token you paste is held in this tab only. It is never written into the HTML, the ' +
        'configuration, an export, a commit, or localStorage, and it is gone when the tab ' +
        'closes.</div>'),
      d().el('label', { class: 'rk', text: 'Fine-grained token' }),
      input,
      result
    ]);

    var dlg = Ryker.dialog.open({
      title: 'Sign in to GitHub',
      body: body,
      buttons: [
        { label: 'Cancel' },
        gh && gh.hasToken() ? {
          label: 'Sign out', danger: true,
          action: function () { gh.signOut(); Ryker.toolbar.sync(); }
        } : null,
        {
          label: 'Verify and continue', primary: true, keepOpen: true,
          action: function () {
            var t = input.value.trim();
            if (!t) return false;
            result.innerHTML = '<div class="note">Checking with GitHub...</div>';
            gh.setToken(t);
            gh.verify().then(function (res) {
              if (!res.ok) {
                gh.setToken(null);
                result.innerHTML = '<div class="note bad">' + d().escapeHtml(res.reason) + '</div>';
                return;
              }
              result.innerHTML = '<div class="note ok">Signed in as <b>' +
                d().escapeHtml(res.identity.login) + '</b>, user id ' + res.identity.id +
                '. Write access to ' + d().escapeHtml(Ryker.config.repoSlug(cfg)) +
                ' confirmed by GitHub.</div>';
              Ryker.storage.detect();
              Ryker.boot.reload().then(function () {
                Ryker.toolbar.sync();
                Ryker.panel.refresh();
                setTimeout(function () { dlg.close(); }, 900);
              });
            });
            return false;
          }
        }
      ].filter(Boolean)
    });
  }

  function html(s) {
    var n = document.createElement('div');
    n.innerHTML = s;
    return n;
  }

  return { open: open, signIn: signIn };
})();
