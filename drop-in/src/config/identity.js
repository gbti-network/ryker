// Who is making the change.
//
// With GitHub verified, identity is GitHub's durable numeric user id plus the
// login, per spec section 33, because logins can change and the id cannot.
//
// Without GitHub, identity is a name the person typed. That is exactly what
// ordinary git is, where user.name is unverified in every repository, so it is
// not a weakness introduced here. It is labelled self-asserted everywhere it
// appears rather than presented as though it were checked.
Ryker.identity = (function () {
  'use strict';

  var KEY = 'ryker:selfname';
  var cached = null;

  function fromGitHub() {
    var gh = Ryker.storage.get('github');
    if (!gh || !gh.identity) return null;
    var id = gh.identity();
    if (!id || !gh.canWrite()) return null;
    return {
      github_user_id: id.id,
      github_login: id.login,
      name: id.name || id.login,
      source: 'github'
    };
  }

  function selfName() {
    if (cached) return cached;
    try { cached = localStorage.getItem(KEY) || null; } catch (e) { cached = null; }
    return cached;
  }

  function setSelfName(name) {
    cached = String(name || '').trim() || null;
    try {
      if (cached) localStorage.setItem(KEY, cached);
      else localStorage.removeItem(KEY);
    } catch (e) {}
    return cached;
  }

  function current() {
    var gh = fromGitHub();
    if (gh) return gh;
    return {
      github_user_id: null,
      github_login: null,
      name: selfName() || 'Unnamed author',
      source: 'self'
    };
  }

  function label() {
    var me = current();
    return me.source === 'github' ? me.github_login : me.name + ' (self-asserted)';
  }

  function needsName() {
    return !fromGitHub() && !selfName();
  }

  // Asked once, before the first save rather than at boot, so a reader is never
  // interrupted by a question about authorship.
  function promptForName(then) {
    var d = Ryker.dom;
    var input = d.el('input', {
      class: 'rk', type: 'text', placeholder: 'Your name', value: selfName() || ''
    });
    Ryker.dialog.open({
      title: 'Who is making this change?',
      body: d.el('div', {}, [
        d.el('p', {
          text: 'This report is not connected to GitHub, so Ryker cannot verify who you are. ' +
            'The name you give is recorded with your revisions and marked as self-asserted, ' +
            'which is the same footing as an ordinary local git commit.'
        }),
        d.el('label', { class: 'rk', text: 'Name' }),
        input
      ]),
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Continue', primary: true,
          action: function () {
            var v = input.value.trim();
            if (!v) return false;
            setSelfName(v);
            if (then) then(current());
          }
        }
      ]
    });
  }

  return {
    current: current, label: label, needsName: needsName,
    promptForName: promptForName, setSelfName: setSelfName, selfName: selfName
  };
})();
