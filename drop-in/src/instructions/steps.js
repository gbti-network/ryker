// One edit, written as one numbered step someone can follow.
//
// Split out of instructions.js, which was doing two jobs: working out what
// changed, and writing English about it. The second job is the one that grows,
// because every new kind of edit Ryker can make needs a paragraph here that
// says how to apply it, and the module had reached its line cap with no room
// for the next one.
//
// Everything this needs about the surrounding set arrives in ctx rather than
// through the namespace, so a step can be written and tested without a live
// document: where() resolves a block's position, text() flattens HTML to
// prose, pristine() returns a block as authored, and stepOf/editedAt map a
// block id to the step number that creates or rewrites it.
Ryker.steps = (function () {
  'use strict';

  function clip(s, n) {
    n = n || 80;
    return s.length > n ? s.slice(0, n - 3) + '...' : s;
  }

  // Where an inserted block goes. An insert chained off another insert refers
  // to the step that creates it, because the element it follows does not exist
  // in the file yet, and one chained off a rewrite refers to that step rather
  // than quoting wording it has already replaced.
  function afterLine(e, ctx, out) {
    if (e.prev && ctx.stepOf[e.prev]) {
      out.push('Position: immediately after the element added in step ' + ctx.stepOf[e.prev] + '.');
      return;
    }
    if (e.prev && ctx.editedAt[e.prev]) {
      out.push('Position: immediately after the element edited in step ' + ctx.editedAt[e.prev] + '.');
      return;
    }
    if (!e.prev) {
      out.push('Position: as the first block of the document body.');
      return;
    }
    var pw = ctx.where(e.prev);
    out.push('Position: immediately after ' + (pw || 'the preceding block') + '.');
    var ptext = ctx.text(ctx.pristine(e.prev) != null ? ctx.pristine(e.prev) : '');
    if (ptext) out.push('That element begins: "' + clip(ptext) + '"');
  }

  function replaceStep(e, n, ctx, out) {
    var changesTag = e.beforeTag && e.afterTag && e.beforeTag !== e.afterTag;
    var sameContents = e.before === e.after;
    var replacementList = e.afterTag === 'LI' && (e.boxTag === 'OL' || e.boxTag === 'UL');
    if (replacementList) {
      out.push('## ' + n + '. Change <' + e.beforeTag.toLowerCase() + '> to an ' +
        (e.boxTag === 'OL' ? 'ordered' : 'unordered') + ' list');
    } else if (changesTag) {
      out.push('## ' + n + '. Change <' + e.beforeTag.toLowerCase() + '> to <' +
        e.afterTag.toLowerCase() + '>' + (sameContents ? '' : ' and replace its contents'));
    } else {
      out.push('## ' + n + '. Replace the contents of ' +
        (e.tag ? '<' + e.tag.toLowerCase() + '>' : 'a block'));
    }
    out.push('');
    var w = ctx.where(e.id);
    if (w) out.push('Position: ' + w);
    out.push('');
    if (changesTag && sameContents) {
      out.push('Keep the element\'s contents and attributes unchanged. Its current contents are:');
      out.push('<<<'); out.push(e.before); out.push('>>>');
      return;
    }
    out.push('FROM:');
    out.push('<<<'); out.push(e.before); out.push('>>>');
    out.push('');
    out.push('TO:');
    out.push('<<<'); out.push(e.after); out.push('>>>');
    out.push('');
    out.push('Plain text of the new version, for confirmation:');
    out.push('  ' + ctx.text(e.after));
  }

  function insertStep(e, n, ctx, out) {
    var tag = (e.tag || 'p').toLowerCase();
    var insertedList = tag === 'li' && (e.boxTag === 'OL' || e.boxTag === 'UL');
    if (insertedList) {
      out.push('## ' + n + '. Insert a new ' + (e.boxTag === 'OL' ? 'ordered' : 'unordered') +
        ' list (<' + e.boxTag.toLowerCase() + '>) containing one <li>');
    } else {
      out.push('## ' + n + '. Insert a new <' + tag + '>');
    }
    out.push('');
    afterLine(e, ctx, out);
    out.push('');
    out.push('CONTENT:');
    out.push('<<<');
    out.push(insertedList ? '<' + e.boxTag.toLowerCase() + '><li>' + e.after + '</li></' +
      e.boxTag.toLowerCase() + '>' : e.after);
    out.push('>>>');
    out.push('');
    out.push('Plain text, for confirmation:');
    out.push('  ' + ctx.text(e.after));
  }

  function deleteBoxStep(e, n, ctx, out) {
    out.push('## ' + n + '. Delete a whole <table>');
    out.push('');
    if (e.position) {
      out.push('Position: the <table> containing ' + e.position + '.');
      out.push('');
    }
    out.push('Remove the entire <table> element, its rows and its cells. Leave any');
    out.push('caption, heading or paragraph around it alone unless another step names');
    out.push('it. The table is the one whose cells read, in order:');
    out.push('');
    e.cells.forEach(function (c, k) {
      out.push('  ' + (k + 1) + '. ' + clip(ctx.text(c), 90));
    });
  }

  function deleteAtomicStep(e, n, ctx, out) {
    out.push('## ' + n + '. Delete the whole <svg>');
    out.push('');
    var sw = ctx.where(e.id);
    if (sw) { out.push('Position: ' + sw); out.push(''); }
    out.push('Remove the entire SVG element, including all paths, shapes, labels and attributes.');
    out.push('Leave its surrounding container and adjacent content unchanged. Match this exact element:');
    out.push('<<<'); out.push(e.before); out.push('>>>');
  }

  function deleteStep(e, n, ctx, out) {
    out.push('## ' + n + '. Delete a block');
    out.push('');
    var dw = ctx.where(e.id);
    if (dw) {
      out.push('Position: ' + dw);
      out.push('');
    }
    out.push('Remove the element whose exact contents are:');
    out.push('<<<'); out.push(e.before); out.push('>>>');
    out.push('');
    out.push('Plain text, for confirmation:');
    out.push('  ' + ctx.text(e.before));
  }

  // ---- rows and columns ----------------------------------------------------
  //
  // A row and a column are not blocks, so a snapshot sees each of them as a
  // handful of cells appearing or disappearing at once. Written that way the
  // instructions were not merely verbose, they were wrong: "insert a <td>
  // after this one" puts the cell in the row above the one it belongs to, and
  // three of those rebuild a row nobody asked for. Grouped, the step says the
  // one thing that has to happen to the source.

  function rowOf(cells) {
    return cells.map(function (c) { return c.html; });
  }

  function markup(tag, cells) {
    return '<tr>' + cells.map(function (c) {
      return '<' + tag + '>' + c.html + '</' + tag + '>';
    }).join('') + '</tr>';
  }

  function addRowStep(e, n, ctx, out) {
    var tag = e.cellTag === 'TH' ? 'th' : 'td';
    out.push('## ' + n + '. Insert a new table row');
    out.push('');
    if (e.position) out.push('Position: in the <table> containing ' + e.position + '.');
    if (e.afterRow) out.push('Put it immediately after the row reading: ' + e.afterRow);
    else out.push('Put it as the first row of its row group.');
    out.push('');
    out.push('Insert one <tr> holding ' + e.cells.length + ' <' + tag + '> cell(s), in this order:');
    out.push('<<<');
    out.push(markup(tag, e.cells));
    out.push('>>>');
    out.push('');
    out.push('Plain text of the new row, for confirmation:');
    out.push('  ' + rowOf(e.cells).map(function (h) { return ctx.text(h) || '(blank)'; }).join(' | '));
  }

  function deleteRowStep(e, n, ctx, out) {
    out.push('## ' + n + '. Delete a table row');
    out.push('');
    if (e.position) out.push('Position: in the <table> containing ' + e.position + '.');
    out.push('');
    out.push('Remove one whole <tr> and every cell inside it. Change no other row.');
    out.push('It is the row whose cells read, in order:');
    out.push('');
    e.cells.forEach(function (c, k) {
      out.push('  ' + (k + 1) + '. ' + (clip(ctx.text(c.html), 90) || '(blank)'));
    });
  }

  function addColumnStep(e, n, ctx, out) {
    out.push('## ' + n + '. Insert a new table column');
    out.push('');
    if (e.position) out.push('Position: in the <table> containing ' + e.position + '.');
    out.push('Insert it as column ' + (e.col + 1) + ', counting from 1 at the left, in');
    out.push('every row of the table including the header.');
    out.push('');
    out.push('Add one cell to each row, in row order, using <th> in a header row and');
    out.push('<td> elsewhere:');
    out.push('');
    e.cells.forEach(function (c, k) {
      out.push('  ' + (k + 1) + '. <' + (c.tag === 'TH' ? 'th' : 'td') + '>' + c.html +
        '</' + (c.tag === 'TH' ? 'th' : 'td') + '>');
    });
  }

  function deleteColumnStep(e, n, ctx, out) {
    out.push('## ' + n + '. Delete a table column');
    out.push('');
    if (e.position) out.push('Position: in the <table> containing ' + e.position + '.');
    out.push('Remove column ' + (e.col + 1) + ', counting from 1 at the left, from every');
    out.push('row of the table including the header. Leave every other column alone.');
    out.push('');
    out.push('The cells being removed read, in row order:');
    out.push('');
    e.cells.forEach(function (c, k) {
      out.push('  ' + (k + 1) + '. ' + (clip(ctx.text(c.html), 90) || '(blank)'));
    });
  }

  // ---- collapsing cell edits back into the operation that made them --------
  //
  // A snapshot only ever sees blocks, so inserting one row of three cells
  // arrives as three unrelated insertions and deleting one arrives as three
  // deletions. Written out that way the set is not just long: it is wrong.
  // "Insert a <td> after this one" puts the cell in the row above the one it
  // belongs to, and three of those build a row nobody asked for. Here the
  // cells are put back together into the single operation a person performed,
  // which is also the single edit the source file needs.

  function rowsIn(snap) {
    var rows = {};
    Object.keys(snap || {}).forEach(function (id) {
      var e = snap[id];
      if (!e || typeof e !== 'object' || !e.row) return;
      (rows[e.row] = rows[e.row] || []).push(id);
    });
    Object.keys(rows).forEach(function (key) {
      rows[key].sort(function (a, b) { return (snap[a].col || 0) - (snap[b].col || 0); });
    });
    return rows;
  }

  function cellsFrom(ids, snap, held) {
    return ids.map(function (id) {
      var e = snap[id] || {};
      return { html: held[id] != null ? held[id] : (e.html || ''), tag: e.tag || 'TD', id: id };
    });
  }

  function rowLabel(ids, snap, ctx) {
    return ids.map(function (id) {
      return ctx.text((snap[id] || {}).html || '') || '(blank)';
    }).join(' | ');
  }

  // Rows whose every cell is in the change set, and which the other snapshot
  // does not know about at all. Both halves matter: a row that merely lost all
  // its text is not a row that was deleted.
  function wholeRows(kind, list, from, to) {
    var seen = {}, found = {};
    list.forEach(function (e, i) {
      if (e.kind !== kind || !e.row) return;
      (seen[e.row] = seen[e.row] || []).push(i);
    });
    var fromRows = rowsIn(from), toRows = rowsIn(to);
    Object.keys(seen).forEach(function (key) {
      if (toRows[key] || !fromRows[key]) return;
      if (fromRows[key].length !== seen[key].length) return;
      found[key] = seen[key];
    });
    return found;
  }

  // Cells at one column index across two or more rows that survive on both
  // sides. A column operation touches every row; one cell at that index is an
  // ordinary block edit and stays one.
  function wholeColumns(kind, list, taken, from, to) {
    var seen = {}, found = {};
    list.forEach(function (e, i) {
      if (e.kind !== kind || e.col == null || !e.row || taken[e.row]) return;
      (seen[e.col] = seen[e.col] || []).push(i);
    });
    var fromRows = rowsIn(from), toRows = rowsIn(to);
    Object.keys(seen).forEach(function (col) {
      var rows = seen[col].map(function (i) { return list[i].row; });
      var spread = rows.filter(function (r, k) { return rows.indexOf(r) === k; });
      if (spread.length < 2) return;
      if (!spread.every(function (r) { return fromRows[r] && toRows[r]; })) return;
      found[col] = seen[col];
    });
    return found;
  }

  function group(list, before, after, ctx) {
    var beforeRows = rowsIn(before), afterRows = rowsIn(after);
    var held = {};
    list.forEach(function (e) { if (e.kind === 'insert') held[e.id] = e.after; });

    var goneRows = wholeRows('delete', list, before, after);
    var newRows = wholeRows('insert', list, after, before);
    var goneCols = wholeColumns('delete', list, goneRows, before, after);
    var newCols = wholeColumns('insert', list, newRows, after, before);
    if (!Object.keys(goneRows).length && !Object.keys(newRows).length &&
        !Object.keys(goneCols).length && !Object.keys(newCols).length) return list;

    var out = [], done = {};
    list.forEach(function (e, i) {
      var rowKey = e.row;
      var colKey = e.col == null ? null : String(e.col);

      if (rowKey && goneRows[rowKey] && e.kind === 'delete') {
        if (done['r' + rowKey]) return;
        done['r' + rowKey] = true;
        out.push({ kind: 'deleterow', position: ctx.where(e.id),
          cells: cellsFrom(beforeRows[rowKey], before, held) });
        return;
      }
      if (rowKey && newRows[rowKey] && e.kind === 'insert') {
        if (done['a' + rowKey]) return;
        done['a' + rowKey] = true;
        var ids = afterRows[rowKey];
        var above = (after[ids[0]] || {}).prev;
        var aboveRow = above && after[above] ? after[above].row : null;
        out.push({ kind: 'addrow',
          position: above ? ctx.where(above) : ctx.where(e.id),
          afterRow: aboveRow && afterRows[aboveRow]
            ? '"' + rowLabel(afterRows[aboveRow], after, ctx) + '"' : null,
          cellTag: (after[ids[0]] || {}).tag || 'TD',
          cells: cellsFrom(ids, after, held) });
        return;
      }
      if (colKey !== null && goneCols[colKey] && e.kind === 'delete' && !goneRows[rowKey]) {
        if (done['dc' + colKey]) return;
        done['dc' + colKey] = true;
        out.push({ kind: 'delcol', col: e.col, position: ctx.where(e.id),
          cells: goneCols[colKey].map(function (j) {
            return { html: list[j].before, tag: list[j].tag || 'TD' };
          }) });
        return;
      }
      if (colKey !== null && newCols[colKey] && e.kind === 'insert' && !newRows[rowKey]) {
        if (done['ac' + colKey]) return;
        done['ac' + colKey] = true;
        // Positioned by the cell it follows, never by itself. A new cell has no
        // place in the file being edited, so "the 3rd <th>" counted a column
        // that only exists on screen and sent the reader looking for it.
        out.push({ kind: 'addcol', col: e.col,
          position: e.prev ? ctx.where(e.prev) : null,
          cells: newCols[colKey].map(function (j) {
            return { html: list[j].after, tag: list[j].tag || 'TD' };
          }) });
        return;
      }
      out.push(e);
    });
    return out;
  }

  function write(e, n, ctx, out) {
    if (e.kind === 'replace') return replaceStep(e, n, ctx, out);
    if (e.kind === 'insert') return insertStep(e, n, ctx, out);
    if (e.kind === 'deletebox') return deleteBoxStep(e, n, ctx, out);
    if (e.kind === 'addrow') return addRowStep(e, n, ctx, out);
    if (e.kind === 'deleterow') return deleteRowStep(e, n, ctx, out);
    if (e.kind === 'addcol') return addColumnStep(e, n, ctx, out);
    if (e.kind === 'delcol') return deleteColumnStep(e, n, ctx, out);
    if (e.kind === 'delete' && e.atomic && String(e.tag).toUpperCase() === 'SVG') {
      return deleteAtomicStep(e, n, ctx, out);
    }
    return deleteStep(e, n, ctx, out);
  }

  return { write: write, group: group, clip: clip };
})();
