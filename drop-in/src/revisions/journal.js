// The append-only revision journal. This is the centre of Ryker's design.
//
// Git is not the revision store. Ryker needs revision tracking across saves and
// comments on record; it does not need branching, refs, actions or a CLI. So
// every save appends one record holding the blocks that changed as before and
// after pairs keyed by block id, plus the comment events of that save, plus
// author, timestamp and message.
//
// Four things follow, and they are why the inversion is worth it:
//   - The revision panel reads straight off a record. "12 additions, 4
//     removals, 2 comments resolved" is the shape of a record, not something to
//     compute by comparing two whole documents.
//   - The inline diff needs no document differ. The delta was captured at write
//     time; only a word-level compare inside one block remains.
//   - Revision review works identically with no repository at all, so it does
//     not degrade when the report is opened from a ZIP.
//   - Write contention disappears. Appending a numbered record never conflicts
//     with someone else appending theirs.
//
// Current comment state is a fold over the log, cached but always rebuildable.
Ryker.journal = (function () {
  'use strict';

  var records = [];
  var loaded = false;

  function reset(list) {
    records = (list || []).slice().sort(function (a, b) { return a.seq - b.seq; });
    loaded = true;
  }

  function all() { return records.slice(); }
  function count() { return records.length; }
  function isLoaded() { return loaded; }
  function latest() { return records.length ? records[records.length - 1] : null; }

  function nextSeq() {
    return records.length ? records[records.length - 1].seq + 1 : 1;
  }

  function make(opts) {
    var prev = latest();
    return {
      seq: nextSeq(),
      id: Ryker.dom.uid('rev'),
      parent: prev ? prev.id : null,
      documentId: opts.documentId,
      author: opts.author,
      timestamp: Ryker.dom.now(),
      message: opts.message || '',
      changes: opts.changes || [],
      comments: {
        added: opts.commentsAdded || [],
        resolved: opts.commentsResolved || [],
        reopened: opts.commentsReopened || [],
        deleted: opts.commentsDeleted || []
      }
    };
  }

  function append(record) {
    records.push(record);
    return record;
  }

  // Totals for the revision list, computed once per record rather than on every
  // render, since a word diff over a long block is not free.
  function summarize(record) {
    if (record._summary) return record._summary;
    var add = 0, del = 0;
    (record.changes || []).forEach(function (c) {
      var n = Ryker.diff.countChange(c);
      add += n.additions;
      del += n.removals;
    });
    var s = {
      additions: add,
      removals: del,
      blocks: (record.changes || []).length,
      commentsAdded: (record.comments.added || []).length,
      commentsResolved: (record.comments.resolved || []).length
    };
    record._summary = s;
    return s;
  }

  // Folding the log gives current comment state. Deliberately derived rather
  // than stored as the truth, so a corrupted cache is repaired by replaying
  // rather than by asking someone what the comments used to be.
  function foldComments() {
    var map = {};
    records.forEach(function (r) {
      (r.comments.added || []).forEach(function (c) {
        map[c.id] = JSON.parse(JSON.stringify(c));
        map[c.id].status = 'open';
      });
      (r.comments.resolved || []).forEach(function (e) {
        if (!map[e.id]) return;
        map[e.id].status = 'resolved';
        map[e.id].resolvedAt = e.at;
        map[e.id].resolvedBy = e.by;
      });
      (r.comments.reopened || []).forEach(function (e) {
        if (!map[e.id]) return;
        map[e.id].status = 'open';
        delete map[e.id].resolvedAt;
        delete map[e.id].resolvedBy;
      });
      (r.comments.deleted || []).forEach(function (e) { delete map[e.id]; });
    });
    return map;
  }

  // The block content as of a given revision, walking backwards from now.
  // "now" is the live DOM, so replaying undoes each later change in turn.
  function blockAt(blockId, seq) {
    var node = Ryker.blocks.byId(blockId);
    var value = node ? node.innerHTML : null;
    for (var i = records.length - 1; i >= 0; i--) {
      var r = records[i];
      if (r.seq <= seq) break;
      var hit = (r.changes || []).filter(function (c) { return c.id === blockId; })[0];
      if (hit) value = hit.before;
    }
    return value;
  }

  function recordsTouching(blockId) {
    return records.filter(function (r) {
      return (r.changes || []).some(function (c) { return c.id === blockId; });
    });
  }

  function serialize() {
    return records.map(function (r) {
      var copy = {};
      Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') copy[k] = r[k]; });
      return copy;
    });
  }

  return {
    reset: reset, all: all, count: count, isLoaded: isLoaded, latest: latest,
    nextSeq: nextSeq, make: make, append: append, summarize: summarize,
    foldComments: foldComments, blockAt: blockAt, recordsTouching: recordsTouching,
    serialize: serialize
  };
})();
