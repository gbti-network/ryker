// Nothing runs until the person clicks the extension action. activeTab grants
// access to that tab for this gesture only, so Ryker needs no standing access
// to browsing history or every site.
//
// Probe before injecting. Reloading an unpacked extension does not replace the
// bundle already living in an open tab; blindly injecting first lets that old
// bundle's version guard keep itself alive forever. The probe toggles a current
// session, retires a stale one, or asks the worker to load a fresh bundle.
chrome.action.onClicked.addListener(function (tab) {
  if (!tab.id) return;

  // Chrome-owned pages (including chrome://newtab) reject script injection.
  // The action still has a useful meaning there: turn that tab into Ryker's
  // extension-owned local-document workspace instead of painting an ERR badge.
  var pageUrl = String(tab.url || '');
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(pageUrl)) {
    chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('workspace.html') });
    return;
  }

  var target = { tabId: tab.id };
  chrome.storage.local.get('rykerConfig').then(function (stored) {
    return chrome.scripting.executeScript({
      target: target,
      func: function () {
        var root = document.getElementById('ryker-root');
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

          root = document.getElementById('ryker-root');
          if (root && root.parentNode) root.parentNode.removeChild(root);
          var css = document.getElementById('ryker-document-css');
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
            func: function (config) {
              if (!window.Ryker || !Ryker.boot) throw new Error('Ryker did not load.');
              Ryker.extensionConfig = config || {};
              Ryker.boot.start();
              return document.getElementById('ryker-root') ? 'mounted' : 'not-mounted';
            },
            args: [stored.rykerConfig || {}]
          });
        }).then(function (started) {
          return started && started[0] && started[0].result;
        });
      });
  }).then(function (state) {
    var on = state === 'mounted';
    var closed = String(state || '').indexOf('closed') === 0;
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: on ? '#2e7d5b' : '#6b7280' });
    chrome.action.setBadgeText({ tabId: tab.id,
      text: state === 'not-mounted' ? '?' : (closed ? '' : 'ON') });
    chrome.action.setTitle({ tabId: tab.id,
      title: on ? 'Close Ryker on this page' : 'Open Ryker on this page' });
  }).catch(function (error) {
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#a33a3a' });
    chrome.action.setBadgeText({ tabId: tab.id, text: 'ERR' });
    chrome.action.setTitle({ tabId: tab.id,
      title: 'Ryker could not open here: ' + (error && error.message ? error.message : error) });
  });
});
