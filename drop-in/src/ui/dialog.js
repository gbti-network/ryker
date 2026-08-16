// Modal dialogs, inside the shadow root. Escape closes the topmost one, and it
// stops propagation so the host report's own Escape handler does not also fire.
Ryker.dialog = (function () {
  'use strict';

  var stack = [];

  function open(opts) {
    var d = Ryker.dom;
    var backdrop = d.el('div', { class: 'backdrop', role: 'dialog', 'aria-modal': 'true' });
    var body = d.el('div', { class: 'body' });

    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);

    var foot = d.el('div', { class: 'foot' });
    var api = {
      close: function () { close(backdrop); },
      body: body,
      foot: foot,
      setBody: function (node) {
        body.innerHTML = '';
        if (typeof node === 'string') body.innerHTML = node;
        else if (node) body.appendChild(node);
      },
      setFoot: function (buttons) {
        foot.innerHTML = '';
        (buttons || []).forEach(function (b) { foot.appendChild(b); });
      }
    };

    (opts.buttons || []).forEach(function (b) {
      foot.appendChild(d.el('button', {
        class: 'rk' + (b.primary ? ' on' : '') + (b.danger ? ' danger' : ''),
        text: b.label,
        onclick: function () {
          if (!b.action) { api.close(); return; }
          var r = b.action(api);
          if (r !== false && !b.keepOpen) api.close();
        }
      }));
    });
    if (!opts.buttons || !opts.buttons.length) {
      foot.appendChild(d.el('button', { class: 'rk', text: 'Close', onclick: api.close }));
    }

    var modal = d.el('div', { class: 'modal' }, [
      d.el('header', {}, [d.el('h2', { text: opts.title || 'Ryker' })]),
      body,
      foot
    ]);
    backdrop.appendChild(modal);

    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop && opts.dismissable !== false) api.close();
    });

    Ryker.shell.add(backdrop);
    stack.push({ node: backdrop, api: api });

    var focusable = modal.querySelector('button.rk, input, textarea');
    if (focusable) focusable.focus();

    return api;
  }

  function close(node) {
    for (var i = stack.length - 1; i >= 0; i--) {
      if (!node || stack[i].node === node) {
        if (stack[i].node.parentNode) stack[i].node.parentNode.removeChild(stack[i].node);
        stack.splice(i, 1);
        if (!node) return;
      }
    }
  }

  function closeTop() {
    if (!stack.length) return false;
    close(stack[stack.length - 1].node);
    return true;
  }

  function isOpen() { return stack.length > 0; }

  function alert(title, bodyHtml, kind) {
    return open({
      title: title,
      body: '<div class="note ' + (kind || '') + '">' + bodyHtml + '</div>'
    });
  }

  function confirm(title, bodyHtml, confirmLabel, onConfirm) {
    return open({
      title: title,
      body: bodyHtml,
      buttons: [
        { label: 'Cancel' },
        { label: confirmLabel || 'Continue', primary: true, action: onConfirm }
      ]
    });
  }


  // Shown when the credential scan stops an export. Lives here rather than with
  // the save flow because the packager and the instruction pane both reach it and neither
  // has a save flow.
  function leak(hits) {
    var rows = (hits || []).map(function (h) {
      return '<li><b>' + Ryker.dom.escapeHtml(h.pattern) + '</b> in ' +
        Ryker.dom.escapeHtml(h.artifact) + ': <code>' + Ryker.dom.escapeHtml(h.excerpt) + '</code></li>';
    }).join('');
    return open({
      title: 'Stopped: this looks like a credential',
      body: '<div class="note bad">The scan found something matching a known credential pattern. ' +
        'The export was stopped rather than written.</div><ul>' + rows + '</ul>' +
        '<p>Remove it from the document and try again. If this is a false positive, the text ' +
        'still should not ship in a report.</p>'
    });
  }

  return { open: open, close: close, closeTop: closeTop, isOpen: isOpen,
           alert: alert, confirm: confirm, leak: leak };
})();
