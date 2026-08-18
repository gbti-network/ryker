// Nothing runs until the person clicks the extension action. activeTab grants
// access to that tab for this gesture only, so Ryker needs no standing access
// to browsing history or every site.
//
// Probe before injecting. Reloading an unpacked extension does not replace the
// bundle already living in an open tab; blindly injecting first lets that old
// bundle's version guard keep itself alive forever. The probe toggles a current
// session, retires a stale one, or asks the worker to load a fresh bundle.

// All durable extension data lives behind this worker. Programmatically
// injected scripts run in an isolated JavaScript world, but their Web Storage
// and IndexedDB still belong to the visited origin. Keeping the database here
// makes its owner chrome-extension://Ryker instead of whichever article is open.
var STORAGE_CHANNEL = 'ryker.storage.v1';
var STORAGE_DB = 'ryker-extension';
var STORAGE_STORE = 'records';
var STORAGE_MAX_VALUE = 8 * 1024 * 1024;
var STORAGE_KEY = /^(preference|recovery|revision):[A-Za-z0-9._:@/-]{1,480}$/;
// Preferences that belong to the person rather than to any one document. Every
// other key carries a document id, and that id is derived from the sender below
// rather than believed from the message.
var GLOBAL_PREFERENCES = ['preference:save-notes', 'preference:pane-width', 'preference:rail-width'];

function storageError(code, message) {
  var error = new Error(message);
  error.code = code;
  return error;
}

function validateKey(key, prefix) {
  if (typeof key !== 'string' || !STORAGE_KEY.test(key)) {
    throw storageError('invalid-key', 'Ryker refused an invalid storage key.');
  }
  if (prefix && key.indexOf('revision:') !== 0) {
    throw storageError('invalid-prefix', 'Ryker only permits prefix scans of revision records.');
  }
  return key;
}

function validateValue(value) {
  var encoded;
  try { encoded = JSON.stringify(value); }
  catch (e) { throw storageError('invalid-value', 'Ryker storage accepts serializable values only.'); }
  if (encoded === undefined) {
    throw storageError('invalid-value', 'Ryker storage cannot persist an undefined value.');
  }
  if (new TextEncoder().encode(encoded).length > STORAGE_MAX_VALUE) {
    throw storageError('value-too-large', 'This Ryker record is larger than the 8 MB safety limit.');
  }
  return value;
}

function openStorage() {
  return new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined') {
      reject(storageError('storage-unavailable', 'Extension storage is unavailable in this browser context.'));
      return;
    }
    var request;
    try { request = indexedDB.open(STORAGE_DB, 1); }
    catch (e) { reject(storageError('storage-unavailable', e.message)); return; }
    request.onupgradeneeded = function () {
      if (!request.result.objectStoreNames.contains(STORAGE_STORE)) {
        request.result.createObjectStore(STORAGE_STORE);
      }
    };
    request.onerror = function () {
      reject(storageError('storage-open-failed', request.error && request.error.message ||
        'Ryker could not open extension storage.'));
    };
    request.onsuccess = function () { resolve(request.result); };
  });
}

function storageTransaction(mode, run) {
  return openStorage().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx, request, result;
      try {
        tx = db.transaction(STORAGE_STORE, mode);
        request = run(tx.objectStore(STORAGE_STORE), function (value) { result = value; });
      } catch (e) {
        db.close();
        reject(storageError('storage-operation-failed', e.message));
        return;
      }
      if (request) {
        request.onerror = function () {
          reject(storageError('storage-operation-failed', request.error && request.error.message ||
            'Ryker storage rejected the operation.'));
        };
        request.onsuccess = function () { result = request.result; };
      }
      tx.oncomplete = function () { db.close(); resolve(result); };
      tx.onerror = tx.onabort = function () {
        var message = tx.error && tx.error.message || 'Ryker storage could not complete the operation.';
        db.close();
        reject(storageError('storage-transaction-failed', message));
      };
    });
  });
}

function storageGet(key) {
  validateKey(key);
  return storageTransaction('readonly', function (store) { return store.get(key); });
}

function storageSet(key, value) {
  validateKey(key);
  validateValue(value);
  return storageTransaction('readwrite', function (store) { return store.put(value, key); })
    .then(function () { return true; });
}

function storageRemove(key) {
  validateKey(key);
  return storageTransaction('readwrite', function (store) { return store.delete(key); })
    .then(function () { return true; });
}

// Every key under a prefix and nothing else. Cursoring the whole store and
// filtering in JavaScript made browsing one document walk every other
// document's records and every preference before returning.
function storageRange(prefix) {
  return IDBKeyRange.bound(prefix, prefix + '\uffff');
}

function storageList(prefix) {
  validateKey(prefix, true);
  return storageTransaction('readonly', function (store, done) {
    var rows = [];
    var request = store.openCursor(storageRange(prefix));
    request.onsuccess = function () {
      var cursor = request.result;
      if (!cursor) { done(rows); return; }
      rows.push({ key: cursor.key, value: cursor.value });
      cursor.continue();
    };
    return null;
  });
}

function storageCount(prefix) {
  return storageTransaction('readonly', function (store) {
    return store.count(storageRange(prefix));
  });
}

// The document a sender is entitled to touch, derived here rather than taken
// from the message. sender.url is the page a content script runs in and is
// populated without the tabs permission, which activeTab on its own does not
// grant, so it is the field to trust.
function expectedKeyScope(sender) {
  var own = chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('workspace.html') : '';
  var senderUrl = (sender && sender.url) || '';
  // The workspace is Ryker's own page holding an uploaded file whose identity
  // is a filename plus a content hash. There is no URL to derive that from, and
  // no visited origin to protect, so extension chrome keeps its own namespace.
  if (own && senderUrl.indexOf(own) === 0) return '*';
  var pageUrl = senderUrl || (sender && sender.tab && sender.tab.url) || '';
  return pageUrl ? extensionDocumentId(pageUrl) : null;
}

// One rewrite and check for every key entering the store. A content script is
// Ryker's own code in an isolated world and a page cannot reach this channel,
// so this is defence in depth rather than a live hole. It is also the SOW's
// stated guardrail: no caller supplies an arbitrary storage key.
function scopedStorageKey(key, sender) {
  if (typeof key !== 'string') return key;
  var tabId = sender && sender.tab && sender.tab.id;
  // Two tabs on one document each hold their own unsaved draft, so recovery is
  // scoped to the tab that owns it rather than to the document.
  if (key.indexOf('recovery:') === 0) {
    return Number.isInteger(tabId)
      ? 'recovery:tab-' + tabId + ':' + key.slice('recovery:'.length)
      : key;
  }
  if (GLOBAL_PREFERENCES.indexOf(key) !== -1) return key;

  var scope = expectedKeyScope(sender);
  if (!scope) {
    throw storageError('key-scope-denied',
      'Ryker could not establish which document this storage request belongs to.');
  }
  if (scope === '*') return key;

  var claimed = null;
  if (key.indexOf('revision:') === 0) {
    claimed = key.slice('revision:'.length).split(':')[0];
  } else if (key.indexOf('preference:rail-closed:') === 0) {
    claimed = key.slice('preference:rail-closed:'.length).split(':')[0];
  }
  if (claimed === null) {
    throw storageError('key-scope-denied', 'Ryker refused a storage key with no document scope.');
  }
  if (claimed !== scope) {
    throw storageError('key-scope-denied',
      'Ryker refused a storage key belonging to another document.');
  }
  return key;
}

// The page cannot measure the extension origin, so usage is reported from here.
// Records are counted over the sender's own scope and never over a key it
// supplied, so asking about usage cannot become a way to probe another
// document. Retention is deliberate: nothing here prunes, it only reports, so
// the corpus stays the durable copy the user chose to keep.
function storageUsage(sender) {
  var scope = expectedKeyScope(sender);
  var estimate = navigator.storage && navigator.storage.estimate
    ? navigator.storage.estimate() : Promise.resolve({});
  return Promise.resolve(estimate).catch(function () { return {}; }).then(function (space) {
    var out = {
      usage: typeof space.usage === 'number' ? space.usage : null,
      quota: typeof space.quota === 'number' ? space.quota : null,
      records: null
    };
    if (!scope || scope === '*') return out;
    return storageCount('revision:' + scope + ':').then(function (n) {
      out.records = n;
      return out;
    }, function () { return out; });
  });
}

function storageDispatch(message, sender) {
  if (!message || message.channel !== STORAGE_CHANNEL || message.version !== 1) {
    return Promise.reject(storageError('invalid-message', 'Ryker refused an unknown storage message.'));
  }
  if (message.operation === 'usage') return storageUsage(sender);
  var key;
  try { key = scopedStorageKey(message.key, sender); }
  catch (error) { return Promise.reject(error); }
  if (message.operation === 'get') return storageGet(key);
  if (message.operation === 'set') return storageSet(key, message.value);
  if (message.operation === 'remove') return storageRemove(key);
  if (message.operation === 'list') return storageList(key);
  return Promise.reject(storageError('invalid-operation', 'Ryker refused an unknown storage operation.'));
}

if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!sender || sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, error: { code: 'unauthorized', message: 'Untrusted storage sender.' } });
      return false;
    }
    storageDispatch(message, sender).then(function (value) {
      sendResponse({ ok: true, value: value === undefined ? null : value });
    }).catch(function (error) {
      sendResponse({ ok: false, error: {
        code: error && error.code || 'storage-failed',
        message: error && error.message || String(error)
      } });
    });
    return true;
  });
}

var workspacePorts = Object.create(null);
var workspaceRequest = 0;

if (chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener(function (port) {
    var sender = port && port.sender;
    var tabId = sender && sender.tab && sender.tab.id;
    if (!port || port.name !== 'ryker.workspace.v1' || !sender ||
        sender.id !== chrome.runtime.id || !Number.isInteger(tabId)) return;
    workspacePorts[tabId] = port;
    port.onDisconnect.addListener(function () {
      if (workspacePorts[tabId] === port) delete workspacePorts[tabId];
    });
  });
}

function toggleWorkspace(tabId) {
  return new Promise(function (resolve, reject) {
    var port = workspacePorts[tabId];
    if (!port) {
      reject(storageError('workspace-unavailable',
        'The Ryker workspace is still starting. Click the extension action again.'));
      return;
    }
    workspaceRequest += 1;
    var requestId = 'workspace-' + workspaceRequest;
    var finished = false;
    var timer = setTimeout(function () {
      finish(storageError('workspace-timeout', 'The Ryker workspace did not answer the action click.'));
    }, 1500);
    function finish(error, state) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      port.onMessage.removeListener(onMessage);
      if (error) reject(error); else resolve(state);
    }
    function onMessage(message) {
      if (!message || message.channel !== 'ryker.workspace.v1' || message.requestId !== requestId) return;
      finish(null, message.state || 'workspace-ready');
    }
    port.onMessage.addListener(onMessage);
    try {
      port.postMessage({ channel: 'ryker.workspace.v1', action: 'toggle', requestId: requestId });
    } catch (error) {
      finish(error);
    }
  });
}

function hashPart(value, seed) {
  var h = seed >>> 0;
  for (var i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function extensionDocumentId(pageUrl) {
  var canonical = String(pageUrl || '').split(/[?#]/)[0];
  var host = 'document';
  try {
    var parsed = new URL(pageUrl);
    canonical = parsed.origin + parsed.pathname;
    host = (parsed.hostname || parsed.protocol.replace(':', '') || 'document')
      .toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'document';
  } catch (e) { /* the query-free fallback above is still safe */ }
  return 'web-' + host + '-' + hashPart(canonical, 2166136261) + hashPart(canonical, 2246822519);
}

function loadBootState(pageUrl) {
  var documentId = extensionDocumentId(pageUrl);
  var keys = {
    saveNotes: 'preference:save-notes',
    paneWidth: 'preference:pane-width',
    railWidth: 'preference:rail-width',
    article: 'preference:rail-closed:' + documentId + ':article',
    page: 'preference:rail-closed:' + documentId + ':page'
  };
  return Promise.all(Object.keys(keys).map(function (name) {
    return storageGet(keys[name]).then(function (value) { return [name, value]; });
  })).then(function (pairs) {
    var preferences = {};
    pairs.forEach(function (pair) {
      if (pair[1] === undefined || pair[1] === null) return;
      if (pair[0] === 'article' || pair[0] === 'page') {
        preferences.railClosed = preferences.railClosed || {};
        preferences.railClosed[pair[0]] = pair[1];
      } else {
        preferences[pair[0]] = pair[1];
      }
    });
    return { config: { RYKER_DOCUMENT_ID: documentId }, preferences: preferences };
  }).catch(function (error) {
    // Storage must never prevent the editor from opening. The page-side adapter
    // will surface a later write failure next to the user's work.
    return { config: { RYKER_DOCUMENT_ID: documentId }, preferences: {},
      storageError: error && error.message || String(error) };
  });
}

function showActionState(tabId, state) {
  var on = state === 'mounted';
  var closed = String(state || '').indexOf('closed') === 0;
  chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: on ? '#2e7d5b' : '#6b7280' });
  chrome.action.setBadgeText({ tabId: tabId,
    text: state === 'not-mounted' ? '?' : (closed || state === 'workspace-ready' ? '' : 'ON') });
  chrome.action.setTitle({ tabId: tabId,
    title: on ? 'Close Ryker on this page' :
      (state === 'workspace-ready' ? 'Open an HTML or Markdown file in Ryker' : 'Open Ryker on this page') });
}

function showActionError(tabId, error) {
  chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#a33a3a' });
  chrome.action.setBadgeText({ tabId: tabId, text: 'ERR' });
  chrome.action.setTitle({ tabId: tabId,
    title: 'Ryker could not open here: ' + (error && error.message ? error.message : error) });
}

chrome.action.onClicked.addListener(function (tab) {
  if (!tab.id) return;

  // Chrome-owned pages (including chrome://newtab) reject script injection.
  // The action still has a useful meaning there: turn that tab into Ryker's
  // extension-owned local-document workspace instead of painting an ERR badge.
  var pageUrl = String(tab.url || '');
  var workspaceUrl = chrome.runtime.getURL('workspace.html');
  if (pageUrl.indexOf(workspaceUrl) === 0) {
    toggleWorkspace(tab.id)
      .then(function (state) { showActionState(tab.id, state); })
      .catch(function (error) { showActionError(tab.id, error); });
    return;
  }
  if (/^(chrome|edge|about|devtools|chrome-extension|file):/i.test(pageUrl)) {
    chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('workspace.html') });
    return;
  }

  var target = { tabId: tab.id };
  loadBootState(pageUrl).then(function (bootState) {
    return chrome.scripting.executeScript({
      target: target,
      func: function () {
        function rykerHost() {
          return Array.prototype.filter.call(
            document.querySelectorAll('[data-ryker-host], #ryker-root'), function (node) {
            return !!node.shadowRoot;
          })[0] || null;
        }
        var root = rykerHost();
        var current = window.Ryker && Ryker.boot && typeof Ryker.boot.toggle === 'function';

        if (root && current) return Ryker.boot.toggle() ? 'mounted' : 'closed';

        if (root) {
          // An older bundle survived an extension reload. Use every cleanup API
          // it has, then finish defensively so its missing toggle cannot leave
          // editable outlines or layout offsets behind.
          try { if (Ryker.boot && Ryker.boot.close) Ryker.boot.close(); } catch (e) {}
          try { if (Ryker.pick) Ryker.pick.clear(); } catch (e) {}
          try { if (Ryker.editable) Ryker.editable.disable(); } catch (e) {}
          try { if (Ryker.shell) Ryker.shell.teardown(); } catch (e) {}

          root = rykerHost();
          if (root && root.parentNode) root.parentNode.removeChild(root);
          var css = document.querySelector('style[data-ryker-document-css][data-ryker-owner]');
          if (!css) {
            css = Array.prototype.filter.call(document.querySelectorAll('style#ryker-document-css'),
              function (node) { return node.textContent.indexOf('.ryker-editing') !== -1; })[0] || null;
          }
          if (css && css.parentNode) css.parentNode.removeChild(css);
          Array.prototype.forEach.call(document.querySelectorAll(
            '[contenteditable].ryker-editing,.ryker-pick,.ryker-dirty'), function (node) {
            node.removeAttribute('contenteditable');
            node.removeAttribute('spellcheck');
            node.classList.remove('ryker-editing', 'ryker-pick', 'ryker-dirty');
          });
          function clearLayoutTrace() {
            document.body.classList.remove('ryker-picking');
            document.body.removeAttribute('data-ryker-rail');
            if (document.body.hasAttribute('data-ryker-pushed')) {
              document.body.style.removeProperty('padding-top');
              document.body.style.removeProperty('padding-left');
              document.body.style.removeProperty('padding-right');
            }
            document.body.removeAttribute('data-ryker-pushed');
            Array.prototype.forEach.call(document.querySelectorAll('[data-ryker-offset]'), function (node) {
              var previous = node.getAttribute('data-ryker-offset');
              if (previous) node.style.top = previous; else node.style.removeProperty('top');
              node.removeAttribute('data-ryker-offset');
            });
            document.documentElement.style.removeProperty('--ryker-offset');
            document.documentElement.style.removeProperty('scroll-padding-top');
          }
          clearLayoutTrace();
          try { delete window.Ryker; } catch (e) { window.Ryker = null; }
          return new Promise(function (resolve) {
            setTimeout(function () { clearLayoutTrace(); resolve('closed-stale'); }, 50);
          });
        }

        // A stale bundle with no host is safe to replace. A current inert bundle
        // can stay; the generated file is idempotent and start() below uses it.
        if (window.Ryker && !current) {
          try { delete window.Ryker; } catch (e) { window.Ryker = null; }
        }
        return 'load';
      }
    }).then(function (results) {
      var state = results && results[0] && results[0].result;
      if (state !== 'load') return state;
      return chrome.scripting.executeScript({ target: target, files: ['ryker.js'] })
        .then(function () {
          return chrome.scripting.executeScript({
            target: target,
            func: function (config, preferences) {
              if (!window.Ryker || !Ryker.boot) throw new Error('Ryker did not load.');
              Ryker.extensionConfig = config || {};
              Ryker.extensionPreferences = preferences || {};
              Ryker.boot.start();
              return Ryker.shell && Ryker.shell.host && Ryker.shell.host()
                ? 'mounted' : 'not-mounted';
            },
            args: [bootState.config || {}, bootState.preferences || {}]
          });
        }).then(function (started) {
          return started && started[0] && started[0].result;
        });
      });
  }).then(function (state) { showActionState(tab.id, state); })
    .catch(function (error) { showActionError(tab.id, error); });
});
