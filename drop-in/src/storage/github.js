// GitHub backend, over the Contents API only.
//
// Measured 2026-08-13: api.github.com answers a CORS preflight for PUT
// .../contents/... with access-control-allow-origin: *, PUT among the allowed
// methods and Authorization among the allowed headers, and it answers the same
// way to Origin: null. So a report opened from disk can commit, with no server
// anywhere.
//
// Authentication is a fine-grained token, not the device flow. github.com's
// login endpoints send no CORS headers at all, so the device flow cannot
// complete in a page without a relay, and a relay would make Ryker
// infrastructure mandatory. A fine-grained token also carries the repository
// restriction natively: GitHub scopes it to selected repositories with
// Contents: read and write as a permission in its own right, so the guarantee
// is enforced by GitHub rather than promised by Ryker.
//
// The token lives in sessionStorage and nowhere else. Never in localStorage,
// never in the document, never in an export, never in a commit.
Ryker.storage.register('github', (function () {
  'use strict';

  var API = 'https://api.github.com';
  var SESSION_KEY = 'ryker:gh:token';
  var identity = null;
  var access = null;
  var docSha = null;

  function cfg() { return Ryker.config.load(); }
  function repo() { return cfg().RYKER_GITHUB_OWNER + '/' + cfg().RYKER_GITHUB_REPO; }

  function token() {
    try { return sessionStorage.getItem(SESSION_KEY) || null; } catch (e) { return null; }
  }

  function setToken(t) {
    try {
      if (t) sessionStorage.setItem(SESSION_KEY, t);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
    identity = null; access = null;
  }

  function signOut() { setToken(null); Ryker.storage.detect(); }

  function req(path, opts) {
    opts = opts || {};
    var headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token()) headers.Authorization = 'Bearer ' + token();
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.text().then(function (t) {
        var json = null;
        try { json = t ? JSON.parse(t) : null; } catch (e) {}
        return { ok: res.ok, status: res.status, json: json, text: t };
      });
    });
  }

  function b64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function unb64(str) {
    var bin = atob(String(str).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // Verification calls the API and reports the access it found. The paste is
  // never trusted on its own, because a token that reads but cannot write
  // would otherwise let someone edit for an hour and fail at the save.
  function verify() {
    if (!token()) return Promise.resolve({ ok: false, reason: 'No token' });
    return req('/user').then(function (me) {
      if (!me.ok) {
        return { ok: false, reason: me.status === 401
          ? 'GitHub rejected this token.'
          : 'GitHub answered ' + me.status + ' for the account check.' };
      }
      identity = {
        id: me.json.id,
        login: me.json.login,
        name: me.json.name || me.json.login,
        source: 'github'
      };
      return req('/repos/' + repo()).then(function (r) {
        if (!r.ok) {
          return { ok: false, identity: identity, reason: r.status === 404
            ? 'This token cannot see ' + repo() + '. Either the repository name is wrong, ' +
              'or the token was not granted access to it.'
            : 'GitHub answered ' + r.status + ' for ' + repo() + '.' };
        }
        var perms = r.json.permissions || {};
        var wanted = cfg().RYKER_GITHUB_REPOSITORY_ID;
        if (wanted && String(r.json.id) !== String(wanted)) {
          return { ok: false, identity: identity, reason:
            'The repository at ' + repo() + ' has id ' + r.json.id + ', but this report is ' +
            'configured for id ' + wanted + '. Refusing to write to the wrong repository.' };
        }
        access = {
          push: !!perms.push,
          admin: !!perms.admin,
          repositoryId: r.json.id,
          private: !!r.json.private,
          defaultBranch: r.json.default_branch
        };
        if (!access.push) {
          return { ok: false, identity: identity, access: access, reason:
            identity.login + ' can read ' + repo() + ' but cannot write to it. ' +
            'Ryker stays read-only until the repository owner grants write access.' };
        }
        return { ok: true, identity: identity, access: access };
      });
    }).catch(function (e) {
      return { ok: false, reason: 'Could not reach GitHub: ' + e.message };
    });
  }

  function contentsPath(p) {
    return '/repos/' + repo() + '/contents/' + p.split('/').map(encodeURIComponent).join('/') +
      '?ref=' + encodeURIComponent(cfg().RYKER_GITHUB_BRANCH);
  }

  function putPath(p) {
    return '/repos/' + repo() + '/contents/' + p.split('/').map(encodeURIComponent).join('/');
  }

  function pad(n) { return String(n).padStart(4, '0'); }

  return {
    ownsDocument: true,

    isReady: function () { return !!token() && !!access && access.push; },
    canWrite: function () { return !!token() && !!access && access.push; },
    setToken: setToken,
    hasToken: function () { return !!token(); },
    signOut: signOut,
    verify: verify,
    identity: function () { return identity; },
    access: function () { return access; },
    documentSha: function () { return docSha; },

    describe: function () {
      if (!token()) return 'GitHub, not signed in';
      if (!access) return 'GitHub, not verified';
      if (!access.push) return 'GitHub, read-only';
      return repo();
    },

    detail: function () {
      return 'Saving to ' + repo() + ' on branch ' + cfg().RYKER_GITHUB_BRANCH +
        ', as ' + (identity ? identity.login : 'an unverified account') + '.';
    },

    load: function () {
      if (!token()) return Promise.resolve({ records: [] });
      return req(contentsPath('.ryker/revisions')).then(function (res) {
        if (!res.ok || !Array.isArray(res.json)) return { records: [] };
        var files = res.json.filter(function (f) {
          return f.type === 'file' && /\.json$/.test(f.name);
        });
        return Promise.all(files.map(function (f) {
          return req(contentsPath('.ryker/revisions/' + f.name)).then(function (r) {
            if (!r.ok || !r.json || !r.json.content) return null;
            try { return JSON.parse(unb64(r.json.content)); } catch (e) { return null; }
          });
        })).then(function (list) {
          return { records: list.filter(Boolean) };
        });
      }).then(function (out) {
        // The document's own sha is what makes conflict detection possible, so
        // it is fetched at load time and compared at save time.
        return req(contentsPath(cfg().RYKER_DOCUMENT_PATH)).then(function (r) {
          if (r.ok && r.json && r.json.sha) docSha = r.json.sha;
          return out;
        });
      });
    },

    // Spec section 18: never blindly overwrite a newer revision. The sha the
    // document carried at load is compared against the sha it carries now, and
    // a difference stops the save rather than resolving it.
    checkConflict: function () {
      if (!token()) return Promise.resolve({ conflict: false });
      return req(contentsPath(cfg().RYKER_DOCUMENT_PATH)).then(function (r) {
        if (!r.ok) return { conflict: false, unknown: true };
        var live = r.json && r.json.sha;
        if (docSha && live && live !== docSha) {
          return { conflict: true, loadedSha: docSha, liveSha: live };
        }
        return { conflict: false, liveSha: live };
      });
    },

    save: function (payload) {
      if (!this.canWrite()) {
        return Promise.reject(new Error('Not signed in with write access to ' + repo() + '.'));
      }
      var branch = cfg().RYKER_GITHUB_BRANCH;
      var docPath = cfg().RYKER_DOCUMENT_PATH;
      var summary = payload.summary || {};
      var message = (payload.message || 'Update ' + docPath) + '\n\n' +
        'Ryker-Document: ' + docPath + '\n' +
        'Ryker-Revision: ' + (payload.appended.length ? payload.appended[payload.appended.length - 1].seq : '') + '\n' +
        'Ryker-Comments-Added: ' + (summary.commentsAdded || 0) + '\n' +
        'Ryker-Comments-Resolved: ' + (summary.commentsResolved || 0);

      var chain = Promise.resolve();
      payload.appended.forEach(function (rec) {
        chain = chain.then(function () {
          return req(putPath('.ryker/revisions/' + pad(rec.seq) + '.json'), {
            method: 'PUT',
            body: {
              message: 'Ryker revision ' + rec.seq + ' for ' + docPath,
              content: b64(JSON.stringify(rec, null, 2)),
              branch: branch
            }
          }).then(function (r) {
            if (!r.ok) throw new Error('Could not write revision ' + rec.seq + ': ' +
              ((r.json && r.json.message) || r.status));
          });
        });
      });

      return chain.then(function () {
        if (!payload.documentHtml) return null;
        return req(putPath(docPath), {
          method: 'PUT',
          body: {
            message: message,
            content: b64(payload.documentHtml),
            sha: docSha || undefined,
            branch: branch
          }
        }).then(function (r) {
          if (!r.ok) {
            throw new Error(r.status === 409
              ? 'The document changed on GitHub since you began editing.'
              : 'Could not write the document: ' + ((r.json && r.json.message) || r.status));
          }
          if (r.json && r.json.content) docSha = r.json.content.sha;
          return r;
        });
      }).then(function () {
        return { ok: true, where: repo() };
      });
    }
  };
})());
