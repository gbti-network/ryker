// One move, written so it can be followed without knowing anything about Ryker.
//
// Split out of instructions.js for the same reason steps.js was: that module
// does two jobs, working out what changed and writing English about it, and the
// second one grows. Giving moves the Markdown vocabulary pushed it past the 600
// line cap, and the cap was right. A move is its own kind of step, with its own
// anchoring problem, and it now sits beside the other step writers rather than
// inside the module that decides what changed.
//
// Everything it needs about the surrounding set arrives in ctx and in the small
// set of accessors instructions.js passes in, so nothing here reads back into
// that module.
Ryker.moveStep = (function () {
  'use strict';

  // The obvious answer, the block that precedes it in the finished order, is
  // the wrong one and reads as nonsense: a whole <section> came out as "move it
  // after the 101st <p> inside the section with id=rationale", and a <p> after
  // a <td>. Nothing can be placed after a cell.
  //
  // The move has already happened in the document, so the element's own
  // previous sibling IS the answer, exact and at the right level by
  // construction. Move steps are emitted in finished-document order, so where
  // one move lands against another the earlier step has already put its element
  // in place.
  function anchorOf(el) {
    var n = el.previousElementSibling;
    while (n && (n.tagName === 'SCRIPT' || n.tagName === 'STYLE')) n = n.previousElementSibling;
    return n;
  }

  // How to recognise the anchor, in one line.
  //
  // For a block that is its opening words, taken from the document as authored
  // rather than as edited: moves are applied before the rewrites, so quoting
  // the new wording would point at text the file does not contain yet.
  //
  // For a container it is the outline's own label, because textContent on a
  // table returns every cell run together with no spaces between them, which
  // came out as "#What changesWhereImpactEffortWhy R1Fix the Apple Pay hire
  // path" and identified nothing.
  function anchorLine(node, ctx) {
    var id = safeId(node);
    if (id != null) {
      var was = ctx.pristine(id);
      // Quoting stripped text against a Markdown file is the same defect as a
      // stripped FROM: the reader searches for "with stress here" in a file
      // that says "with _stress_ here".
      var raw = was !== undefined
        ? (ctx && ctx.format === 'markdown'
            ? Ryker.steps.fromText(ctx, id, was) : ctx.text(was))
        : Ryker.dom.textOf(node);
      var t = clipText(raw);
      return t ? 'That element begins: "' + t + '"' : null;
    }
    var label = Ryker.outline.label(node);
    return label ? 'That element is described as ' + ctx.quote(label) + '.' : null;
  }

  // One move, written so it can be followed without knowing anything about
  // Ryker. What moves is identified by the exact opening markup of its first
  // block, which is text the file actually contains.
  // A unit move deals in containers as often as in leaves, so the noun cannot
  // come from bareBlock alone: that answers "block" for UL, OL and TABLE, which
  // are most of what actually moves. This was the one writer the Markdown
  // vocabulary never reached, because it lives here rather than in steps.js and
  // steps.write() has no move branch to extend.
  function moveNoun(ctx, tag) {
    var upper = String(tag || '').toUpperCase();
    if (!upper) return 'an element';
    if (ctx.format !== 'markdown') return 'a <' + upper.toLowerCase() + '>';
    if (upper === 'UL' || upper === 'OL') return Ryker.steps.word(ctx, 'list', upper);
    if (upper === 'TABLE') return 'a ' + Ryker.steps.word(ctx, 'table');
    return Ryker.steps.word(ctx, 'block', upper);
  }

  function moveStep(m, n, stepOf, out, ctx) {
    var rec = m.rec, at = m.at;
    var el = at.elements[0];
    var noun = moveNoun(ctx, at.tag);
    var bare = noun.replace(/^an? /, '');

    out.push('## ' + n + '. Move ' + noun);
    out.push('');
    out.push('Move this one ' + bare + ' and everything inside it. Change nothing');
    if (el.id) {
      out.push('about its contents. It is the one with id=' + ctx.quote(el.id) + '.');
    } else {
      out.push('about its contents. It is the element whose first block reads, exactly:');
      // A FROM, so it quotes the file rather than being re-serialised. Sending
      // it through the TO path would respell `_stress_` as `*stress*` and the
      // reader would search a file that does not contain it.
      out.push('<<<');
      out.push(Ryker.steps.fromText(ctx, rec.lead,
        ctx.pristine(rec.lead) != null ? ctx.pristine(rec.lead) : ''));
      out.push('>>>');
    }
    out.push('');

    var anchor = anchorOf(el);
    if (!anchor) {
      var host = ctx.place(el.parentElement);
      out.push('Put it first inside ' + (host || 'the document body') + ', before');
      out.push('everything else in there.');
    } else if (stepOf[safeId(anchor)]) {
      out.push('Put it immediately after the element added in step ' +
        stepOf[safeId(anchor)] + '.');
      out.push('Apply that step before this one.');
    } else {
      out.push('Put it immediately after ' + (ctx.place(anchor) || 'the preceding element') + ',');
      out.push('as a sibling of it, not inside it.');
      var line = anchorLine(anchor, ctx);
      if (line) out.push(line);
    }
    out.push('');

    var wasAfter = rec.was ? Ryker.units.index()[rec.was] : null;
    if (wasAfter && wasAfter.id) {
      out.push('In the file it currently sits just after the element with id=' +
        ctx.quote(wasAfter.id) + '.');
    } else if (rec.wasLead) {
      var was = ctx.pristine(rec.wasLead) != null ? ctx.pristine(rec.wasLead) : '';
      var w = ctx.format === 'markdown'
        ? Ryker.steps.fromText(ctx, rec.wasLead, was) : ctx.text(was);
      if (w) out.push('In the file it currently sits just after this text: "' +
        clipText(w) + '"');
    } else {
      var from = rec.wasParent ? Ryker.units.index()[rec.wasParent] : null;
      out.push('In the file it is currently the first thing inside ' +
        (from ? (ctx.place(from) || 'its container') : 'the document body') + '.');
    }
    out.push('');
    out.push('Blocks carried along: ' + at.blocks);

    if (at.nav.length) {
      out.push('');
      out.push('The contents list links into what moved. Move ' +
        (at.nav.length > 1 ? 'these entries' : 'the entry') + ' to match, so the list');
      out.push('stays in document order:');
      at.nav.forEach(function (t2) { out.push('  - ' + ctx.quote(t2)); });
    }
  }

  // Only a block has a block id, and asking for one anywhere else costs a walk
  // of the whole document to answer null.
  function safeId(node) {
    if (!node || !node.matches || !node.matches(Ryker.blocks.SELECTOR)) return null;
    if (Ryker.blocks.excluded(node)) return null;
    try { return Ryker.blocks.blockId(node); } catch (e) { return null; }
  }

  function clipText(s) {
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  }

  return { write: moveStep, anchorOf: anchorOf, safeId: safeId, clipText: clipText };
})();
