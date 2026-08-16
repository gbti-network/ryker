// Comment state: creation, resolution, re-anchoring, and the counts the
// toolbar shows. Comments are events in the revision journal rather than a
// document that gets rewritten, so nothing here writes storage directly.
Ryker.comments = (function () {
  'use strict';

  var committed = {};   // folded from the journal
  var pending = { added: [], resolved: [], reopened: [], deleted: [] };
  var anchors = {};     // id -> { range, confidence } or null when unanchored
  var activeId = null;
  var visible = true;
  var listeners = [];

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  function rebuild() {
    committed = Ryker.journal.foldComments();
    reanchor();
    emit();
  }

  // The current view is the folded journal plus anything not yet saved.
  function current() {
    var map = {};
    Object.keys(committed).forEach(function (id) { map[id] = committed[id]; });
    pending.added.forEach(function (c) { map[c.id] = c; });
    pending.resolved.forEach(function (e) {
      if (map[e.id]) {
        map[e.id] = clone(map[e.id]);
        map[e.id].status = 'resolved';
        map[e.id].resolvedAt = e.at;
        map[e.id].resolvedBy = e.by;
      }
    });
    pending.reopened.forEach(function (e) {
      if (map[e.id]) { map[e.id] = clone(map[e.id]); map[e.id].status = 'open'; }
    });
    pending.deleted.forEach(function (e) { delete map[e.id]; });
    return map;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function list() {
    var map = current();
    return Object.keys(map).map(function (id) { return map[id]; })
      .sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
  }

  function counts() {
    var l = list();
    return {
      total: l.length,
      open: l.filter(function (c) { return c.status !== 'resolved'; }).length,
      resolved: l.filter(function (c) { return c.status === 'resolved'; }).length,
      unanchored: l.filter(function (c) { return !anchors[c.id]; }).length
    };
  }

  function add(range, body, author) {
    var a = Ryker.anchor.capture(range);
    if (!a) return null;
    var c = {
      id: Ryker.dom.uid('c'),
      documentId: Ryker.config.load().RYKER_DOCUMENT_ID,
      quote: a.quote,
      prefix: a.prefix,
      suffix: a.suffix,
      blockId: a.blockId,
      body: String(body || ''),
      author: author,
      createdAt: Ryker.dom.now(),
      status: 'open'
    };
    pending.added.push(c);
    reanchor();
    emit();
    return c;
  }

  function resolve(id, author) {
    if (!current()[id]) return false;
    pending.reopened = pending.reopened.filter(function (e) { return e.id !== id; });
    pending.resolved.push({ id: id, at: Ryker.dom.now(), by: author });
    emit();
    return true;
  }

  function reopen(id, author) {
    if (!current()[id]) return false;
    pending.resolved = pending.resolved.filter(function (e) { return e.id !== id; });
    pending.reopened.push({ id: id, at: Ryker.dom.now(), by: author });
    emit();
    return true;
  }

  function remove(id, author) {
    // An unsaved comment is discarded outright rather than recorded as a
    // deletion, so the journal never carries an event for something that never
    // existed in it.
    var wasPending = pending.added.some(function (c) { return c.id === id; });
    pending.added = pending.added.filter(function (c) { return c.id !== id; });
    if (!wasPending) pending.deleted.push({ id: id, at: Ryker.dom.now(), by: author });
    reanchor();
    emit();
    return true;
  }

  function reanchor() {
    var map = current();
    anchors = {};
    Object.keys(map).forEach(function (id) {
      var hit = null;
      try { hit = Ryker.anchor.resolve(map[id]); } catch (e) { hit = null; }
      anchors[id] = hit;
    });
    repaint();
  }

  function repaint() {
    if (!visible) { Ryker.highlight.clear(); return; }
    var map = current();
    var ranges = [];
    Object.keys(anchors).forEach(function (id) {
      if (!anchors[id] || !map[id]) return;
      ranges.push({ id: id, range: anchors[id].range, status: map[id].status });
    });
    Ryker.highlight.paint(ranges, activeId);
  }

  function setVisible(v) { visible = !!v; repaint(); emit(); }
  function isVisible() { return visible; }
  function setActive(id) { activeId = id; repaint(); emit(); }
  function getActive() { return activeId; }
  function anchorOf(id) { return anchors[id] || null; }
  function isUnanchored(id) { return !anchors[id]; }

  function hasPending() {
    return pending.added.length + pending.resolved.length +
      pending.reopened.length + pending.deleted.length > 0;
  }

  function drain() {
    var out = {
      added: pending.added.slice(),
      resolved: pending.resolved.slice(),
      reopened: pending.reopened.slice(),
      deleted: pending.deleted.slice()
    };
    pending = { added: [], resolved: [], reopened: [], deleted: [] };
    return out;
  }

  function pendingCounts() {
    return { added: pending.added.length, resolved: pending.resolved.length };
  }

  function nextOpen() {
    var l = list().filter(function (c) { return c.status !== 'resolved' && anchors[c.id]; });
    if (!l.length) return null;
    var i = l.findIndex(function (c) { return c.id === activeId; });
    return l[(i + 1) % l.length];
  }

  return {
    rebuild: rebuild, list: list, current: current, counts: counts,
    add: add, resolve: resolve, reopen: reopen, remove: remove,
    reanchor: reanchor, repaint: repaint,
    setVisible: setVisible, isVisible: isVisible,
    setActive: setActive, getActive: getActive,
    anchorOf: anchorOf, isUnanchored: isUnanchored,
    hasPending: hasPending, drain: drain, pendingCounts: pendingCounts,
    nextOpen: nextOpen, onChange: onChange
  };
})();
