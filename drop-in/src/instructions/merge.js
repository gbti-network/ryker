// Folding many saved records into one instruction set.
//
// This looks like deduplication and is two operations, only one of which is.
//
// Every record written from a single page load quotes the same pristine
// document, because instructions.js derives its edits against a snapshot taken
// once at boot. So those records are cumulative supersets of one another and
// the correct fold is to KEEP THE LAST and discard the rest. That half is
// deduplication and needs no judgement.
//
// A reload re-takes the snapshot against the document as it then stands, so the
// next record's FROM text is the previous record's TO text. Those have to be
// COMPOSED: FROM1 -> TO1 followed by FROM2 -> TO2 becomes FROM1 -> TO2, and only
// where TO1 and FROM2 match exactly. Anything else is reported unmerged rather
// than guessed, because a fold that silently drops an edit is worse than one
// that declines to fold.
//
// Records written before 2026-08-16 carry no baselineId, so they are grouped by
// testing whether one record's output is the next one's input. That is a guess
// and is labelled as one.
Ryker.merge = (function () {
  'use strict';

  // Two records belong to the same session if they agree on the document and on
  // the text their instructions quote.
  function groupKey(rec) {
    return (rec.documentId || '') + ' ' + (rec.baselineId || '');
  }

  function editsOf(rec) {
    return Array.isArray(rec && rec.edits) ? rec.edits : [];
  }

  function notesOf(rec) {
    if (Array.isArray(rec && rec.saveNotes)) return rec.saveNotes;
    if (rec && rec.saveNote) {
      return [{ saveNumber: rec.saveNumber || null, text: rec.saveNote }];
    }
    return [];
  }

  function norm(html) {
    if (html == null) return '';
    return String(html).replace(/\s+/g, ' ').trim();
  }

  function beforeTag(edit) {
    return String(edit.beforeTag || (edit.kind === 'insert' ? '' : edit.tag) || '').toUpperCase();
  }

  function afterTag(edit) {
    return String(edit.afterTag || edit.tag || '').toUpperCase();
  }

  function stateKey(html, tag) { return String(tag || '').toUpperCase() + '|' + norm(html); }

  function when(rec) {
    var t = Date.parse(rec && rec.savedAt);
    return isNaN(t) ? 0 : t;
  }

  // Oldest first. savedAt rather than saveNumber, because saveNumber restarts
  // on every reload and sorting by it interleaves sessions.
  function chronological(records) {
    return records.slice().sort(function (a, b) { return when(a) - when(b); });
  }

  // ---- grouping -----------------------------------------------------------

  // One entry per baseline, each holding the single record that supersedes the
  // others in its group. Groups keep the order their newest record arrived in.
  function collapse(records) {
    var groups = [];
    var byKey = {};

    chronological(records).forEach(function (rec) {
      // A record with no baselineId is not evidence that it shares a baseline
      // with the next one that also lacks it. Every record written before
      // 2026-08-16 lacks it, so keying on the empty value put an entire corpus
      // into one group and discarded all but the last of it. Each gets its own
      // group and compose() works the relationship out from the text, which is
      // what "inferred" has always meant here.
      var key = rec.baselineId ? groupKey(rec) : ('@unkeyed:' + groups.length);
      var g = byKey[key];
      if (!g) {
        g = byKey[key] = {
          key: key,
          baselineId: rec.baselineId || null,
          documentId: rec.documentId || null,
          winner: rec,
          superseded: [],
          inferred: !rec.baselineId
        };
        groups.push(g);
        return;
      }
      // Later record wins. Chronological order already decided that, so this
      // is a straight replacement rather than a comparison of saveNumber, which
      // cannot be compared across sessions.
      g.superseded.push(g.winner);
      g.winner = rec;
    });

    return groups;
  }

  // ---- composition --------------------------------------------------------

  // Fold one group's edits onto the accumulated set.
  //
  // An edit whose FROM matches something already produced is a continuation of
  // that earlier edit, so the earlier one's TO is advanced and no new step is
  // emitted. An edit that touches text nobody has produced is new and is
  // appended. An edit whose FROM matches nothing at all is where composition
  // fails, and it is handed back rather than dropped.
  function compose(acc, group) {
    var refused = [];

    editsOf(group.winner).forEach(function (e) {
      var fromText = norm(e.before);
      var from = stateKey(e.before, beforeTag(e));
      var to = stateKey(e.after, afterTag(e));

      // Already have this exact change, from a DIFFERENT record. Records from
      // one page load are cumulative supersets of each other, so the same pair
      // reappears in every save of that session. Dropping the repeat here
      // rather than relying on the baseline grouping is what lets a corpus with
      // no baselineId anywhere fold correctly instead of collapsing to its last
      // record, which is the bug the real corpus exposed.
      //
      // Different record is the whole condition. Two identical inserts inside
      // ONE record are the duplicate-paste case instructions.js deliberately
      // refuses to tidy away, because only the author knows which copy was
      // meant, and folding must not quietly decide that for them.
      var same = acc.some(function (a) {
        return a.origin !== group && a.step.kind === e.kind &&
               stateKey(a.step.before, beforeTag(a.step)) === from &&
               stateKey(a.step.after, afterTag(a.step)) === to;
      });
      if (same) { group.duplicated = (group.duplicated || 0) + 1; return; }

      if (e.kind === 'insert' || !fromText) {
        acc.push({ step: e, origin: group });
        return;
      }

      // Does this continue something already in the set?
      var chained = null;
      for (var i = acc.length - 1; i >= 0; i--) {
        if (stateKey(acc[i].step.after, afterTag(acc[i].step)) === from) {
          chained = acc[i]; break;
        }
      }
      if (chained) {
        chained.step = {
          kind: chained.step.kind === 'insert' ? 'insert' : e.kind,
          tag: e.tag || chained.step.tag,
          beforeTag: chained.step.beforeTag || beforeTag(chained.step) || null,
          afterTag: e.afterTag || afterTag(e) || null,
          before: chained.step.before,
          after: e.after,
          position: e.position || chained.step.position
        };
        chained.composedFrom = (chained.composedFrom || 1) + 1;
        group.composed = (group.composed || 0) + 1;
        return;
      }

      // First time this text has been touched in the fold. That is normal for
      // the first group, and for a later group it means the edit is against
      // text the earlier groups never changed, which is still fine.
      var seenBefore = acc.some(function (a) {
        return stateKey(a.step.before, beforeTag(a.step)) === from;
      });
      if (!seenBefore) {
        acc.push({ step: e, origin: group });
        return;
      }

      // Two groups edit the same original text in incompatible ways. Only the
      // author knows which was meant.
      refused.push({
        edit: e, group: group,
        why: 'Two sessions changed the same original text in different ways, and ' +
             'neither result contains the other.'
      });
    });

    return refused;
  }

  // ---- the public fold ----------------------------------------------------

  function fold(records) {
    var list = Array.isArray(records) ? records.filter(Boolean) : [];
    if (!list.length) {
      return { steps: [], groups: [], superseded: 0, refused: [], warnings: [], inferred: false };
    }

    var groups = collapse(list);
    var acc = [];
    var refused = [];

    groups.forEach(function (g) {
      refused = refused.concat(compose(acc, g));
    });

    var superseded = groups.reduce(function (n, g) { return n + g.superseded.length; }, 0);
    var inferred = groups.some(function (g) { return g.inferred; });
    var duplicated = groups.reduce(function (n, g) { return n + (g.duplicated || 0); }, 0);
    var composed = groups.reduce(function (n, g) { return n + (g.composed || 0); }, 0);

    // A record can carry the prose prompt and no structured pairs behind it.
    // Backfilled records are the case: 17 in the corpus, only 14 structured
    // edits between them. They cannot be folded and saying nothing about them
    // would present a partial result as a complete one.
    var promptOnly = list.filter(function (r) { return !editsOf(r).length; }).length;
    var notes = [];
    groups.forEach(function (g) {
      notesOf(g.winner).forEach(function (note) {
        var text = String(note && note.text || '').trim();
        if (!text) return;
        notes.push({ saveNumber: note.saveNumber || null, text: text });
      });
    });

    var warnings = [];
    if (promptOnly) {
      warnings.push(promptOnly + ' record(s) carry only a prose prompt with no structured ' +
        'before-and-after pairs, so nothing in them could be folded. They are unchanged ' +
        'and still in the log.');
    }
    if (duplicated) {
      warnings.push(duplicated + ' change(s) appeared in more than one record and were ' +
        'kept once.');
    }
    if (superseded) {
      warnings.push(superseded + ' record(s) were dropped because a later save from the ' +
        'same starting text already contained them.');
    }
    if (groups.length > 1) {
      warnings.push(groups.length + (inferred
        ? ' record group(s) were folded together, grouped by content because the '
          + 'records do not say which belong to the same session.'
        : ' separate editing sessions were folded together.'));
    }
    if (inferred) {
      warnings.push('Some records predate baseline tracking, so their grouping is inferred ' +
        'from content rather than recorded. Check the result before applying it.');
    }
    if (refused.length) {
      warnings.push(refused.length + ' change(s) could not be folded in and are listed ' +
        'separately below. Nothing was dropped silently.');
    }

    // Identical content inserted more than once stays reported rather than
    // removed, which is the rule instructions.js already applies within a single
    // record. Only the author knows which copy was meant, and that is no more
    // knowable across records than within one.
    var dupes = duplicateInserts(acc.map(function (a) { return a.step; }));

    // The conservation numbers. Every structured edit that went in is either a
    // step, a refusal, a duplicate of one already kept, or inside a record a
    // later save from the same baseline superseded. A fold where those do not
    // add up has lost somebody's work, which is the one outcome this module
    // exists to prevent, so the totals are returned rather than assumed.
    var accounted = {
      in: list.reduce(function (n, r) { return n + editsOf(r).length; }, 0),
      kept: acc.length,
      refused: refused.length,
      duplicated: duplicated,
      // Absorbed into a step already in the set, which is what composition IS:
      // the edit is not lost, it advanced an earlier one's TO text.
      composed: composed,
      supersededEdits: groups.reduce(function (n, g) {
        return n + g.superseded.reduce(function (m, r) { return m + editsOf(r).length; }, 0);
      }, 0)
    };

    return {
      steps: acc.map(function (a) { return a.step; }),
      groups: groups,
      superseded: superseded,
      duplicated: duplicated,
      promptOnly: promptOnly,
      notes: notes,
      accounted: accounted,
      refused: refused,
      warnings: warnings.concat(dupes),
      inferred: inferred
    };
  }

  function duplicateInserts(steps) {
    var byText = {}, out = [];
    steps.forEach(function (e, i) {
      if (e.kind !== 'insert') return;
      var k = norm(e.after);
      if (!k) return;
      (byText[k] = byText[k] || []).push(i + 1);
    });
    Object.keys(byText).forEach(function (k) {
      if (byText[k].length < 2) return;
      out.push('Steps ' + byText[k].join(', ') + ' insert identical content: "' +
        (k.length > 70 ? k.slice(0, 67) + '...' : k) + '". That is usually a duplicate ' +
        'paste. Keep one unless all of them are meant.');
    });
    return out;
  }

  function clip(html) {
    var t = document.createElement('div');
    t.innerHTML = html == null ? '' : html;
    var s = (t.textContent || '').replace(/\s+/g, ' ').trim();
    return s.length > 90 ? s.slice(0, 87) + '...' : s;
  }

  // The merged set as the same prose an agent already knows how to follow.
  function render(r) {
    var out = [];
    out.push('# Merged document edit instructions');
    out.push('');
    out.push('Folded from ' + r.groups.length + ' record group(s). Every FROM below is the');
    out.push('text as it stood before any of these edits, so the set applies to a clean copy.');
    out.push('');
    r.warnings.forEach(function (w) { out.push('NOTE: ' + w); });
    if (r.warnings.length) out.push('');
    if (r.notes && r.notes.length) {
      out.push('## Context supplied with saves');
      out.push('');
      r.notes.forEach(function (note) {
        out.push('Save' + (note.saveNumber ? ' ' + note.saveNumber : '') + ':');
        String(note.text).split(/\r?\n/).forEach(function (line) { out.push('> ' + line); });
        out.push('');
      });
    }
    out.push('---');
    out.push('');
    r.steps.forEach(function (s, i) {
      var changesTag = s.kind === 'replace' && beforeTag(s) && afterTag(s) &&
        beforeTag(s) !== afterTag(s);
      if (changesTag) {
        out.push('## ' + (i + 1) + '. Change <' + beforeTag(s).toLowerCase() + '> to <' +
          afterTag(s).toLowerCase() + '>');
      } else {
        out.push('## ' + (i + 1) + '. ' + (s.kind === 'insert' ? 'Insert' :
          s.kind === 'delete' ? 'Delete' : 'Replace') + ' <' + (s.tag || '?').toLowerCase() + '>');
      }
      if (s.position) out.push('');
      if (s.position) out.push('Position: ' + s.position);
      out.push('');
      if (s.before) { out.push('FROM:'); out.push('<<<'); out.push(s.before); out.push('>>>'); out.push(''); }
      if (s.after) { out.push('TO:'); out.push('<<<'); out.push(s.after); out.push('>>>'); out.push(''); }
    });
    if (r.refused.length) {
      out.push('---');
      out.push('');
      out.push('## Not merged');
      out.push('');
      out.push('These changes could not be folded into the set above and are listed');
      out.push('so that nothing is lost. Apply them by hand or discard them.');
      out.push('');
      r.refused.forEach(function (x, i) {
        out.push((i + 1) + '. ' + x.why);
        out.push('   was: ' + clip(x.edit && x.edit.before));
        out.push('   to:  ' + clip(x.edit && x.edit.after));
      });
    }
    return out.join('\n');
  }

  return {
    fold: fold, render: render, clip: clip,
    groupKey: groupKey, chronological: chronological
  };
})();
