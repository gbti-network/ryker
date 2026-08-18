// Rows and columns: the one piece of structure Ryker edits.
//
// Everything else in the editor treats a table as scenery, on the grounds that
// a rich-text surface over a report's own markup can break a sort handler that
// the reader will then blame on the report. A row and a column are the
// exception the owner asked for, and they are safe in a way that arbitrary
// structure editing is not: the shape stays rectangular, no attribute the host
// script reads is touched, and each operation has one obvious inverse.
//
// This module also owns the two table facts the rest of Ryker needs and should
// not have to know how to compute: what identifies a cell, and where a cell
// goes when a recorded change is replayed into a fresh copy of the document.
Ryker.table = (function () {
  'use strict';

  var CELL = { TD: 1, TH: 1 };

  // ---- reading the grid ----------------------------------------------------

  function cellOf(node) {
    if (!node || !node.closest) return null;
    var cell = node.closest('td, th');
    return cell && cell.closest('table') ? cell : null;
  }

  function tableOf(node) {
    var cell = cellOf(node);
    return cell ? cell.closest('table') : null;
  }

  // Rows of THIS table. querySelectorAll reaches into a nested one, and a table
  // inside a cell is somebody else's grid.
  function rowsOf(table) {
    return Array.prototype.filter.call(table.querySelectorAll('tr'), function (row) {
      return row.closest('table') === table;
    });
  }

  function cellsOf(row) {
    return Array.prototype.filter.call(row.children, function (n) { return CELL[n.tagName]; });
  }

  function indexOfCell(cell) {
    return cellsOf(cell.parentNode).indexOf(cell);
  }

  // A merged cell breaks the one assumption every operation here rests on:
  // that row N column M names exactly one cell. Rather than guess, the whole
  // feature steps aside and says so, which is the difference between declining
  // and quietly reshaping someone's table.
  function spanned(table) {
    return Array.prototype.some.call(table.querySelectorAll('td, th'), function (c) {
      return (parseInt(c.getAttribute('colspan'), 10) || 1) > 1 ||
             (parseInt(c.getAttribute('rowspan'), 10) || 1) > 1;
    });
  }

  // ---- cell identity -------------------------------------------------------
  //
  // Lives here rather than in blocks.js because it is a fact about grids. A
  // cell with words is identified by them, like every other block. A blank one
  // has none, and numbering the document's blank cells in order is the
  // positional id blocks.js rejected: filling one renumbers the rest, so the
  // next reload resolves a saved edit onto the wrong cell. A cell sits in a
  // grid, so it borrows an identity from the row it is in and the column it is
  // under. Both recompute identically from a freshly loaded file, and neither
  // moves when a different cell is filled in.

  // textContent on a row runs its cells together with no space between them, so
  // ["Beta", "7"] reads as "Beta7" and ["ab", "c"] cannot be told apart from
  // ["a", "bc"]. Both matter here: this text names a row and is part of a blank
  // cell's identity.
  function rowText(row) {
    return cellsOf(row).map(function (cell) {
      return Ryker.dom.textOf(cell);
    }).join(' | ').replace(/(?: \| )+$/, '');
  }

  function seatId(node) {
    if (!CELL[node.tagName]) return null;
    var row = node.closest('tr');
    var grid = node.closest('table');
    if (!row || !grid) return null;
    var col = indexOfCell(node);
    var line = rowText(row);
    if (line) return node.tagName + '|row:' + line.slice(0, 160) + '|col:' + col;
    // A wholly blank row has no text of its own, so the table speaks for it.
    var at = rowsOf(grid).indexOf(row);
    return node.tagName + '|grid:' + Ryker.dom.textOf(grid).slice(0, 160) +
      '|row:' + at + '|col:' + col;
  }

  // The same seat, written for a person rather than hashed.
  function seatLabel(node) {
    if (!CELL[node.tagName]) return null;
    var row = node.closest('tr');
    var grid = node.closest('table');
    if (!row || !grid) return null;
    var col = indexOfCell(node);
    var heads = rowsOf(grid)[0];
    var head = heads && heads !== row ? cellsOf(heads)[col] : null;
    var line = rowText(row);
    return 'cell in column ' + (col + 1) +
      (head && Ryker.dom.textOf(head) ? ' (' + Ryker.dom.textOf(head) + ')' : '') +
      (line ? ', row reading "' + line.slice(0, 40) + '"' : ', row ' + (rowsOf(grid).indexOf(row) + 1));
  }

  // ---- where a cell goes when a change is replayed -------------------------
  //
  // Keyed per node and assigned lazily, exactly like a box key, so it is the
  // same in every snapshot of one row and means nothing across documents.
  var rowKeys = new WeakMap();
  var rowSeq = 0;

  function rowKey(row) {
    if (!row) return null;
    var k = rowKeys.get(row);
    if (!k) { k = 'r' + (++rowSeq); rowKeys.set(row, k); }
    return k;
  }

  // What a snapshot records about a cell beyond its content: which row it is
  // in and which column it is under. Without these an added cell was replayed
  // by inserting it after the block before it, and the block before the first
  // cell of a new row is the LAST cell of the row above, so a restored row
  // arrived spliced onto the end of its predecessor.
  function seatOf(node) {
    if (!node || !CELL[node.tagName]) return null;
    var row = node.closest('tr');
    if (!row) return null;
    return { row: rowKey(row), col: indexOfCell(node) };
  }

  function rowIndex() {
    var rows = {};
    Array.prototype.forEach.call(document.querySelectorAll('tr'), function (row) {
      var k = rowKeys.get(row);
      if (k) rows[k] = row;
    });
    return rows;
  }

  function place(node, c, anchor, context) {
    if (!c.row || String(c.boxTag || '').toUpperCase() !== 'TABLE') return false;
    var grid = c.box && context.boxes[c.box];
    if (!grid) return false;
    context.rows = context.rows || rowIndex();
    var row = context.rows[c.row];
    if (!row) {
      row = document.createElement('tr');
      rowKeys.set(row, c.row);
      context.rows[c.row] = row;
      var beside = anchor && anchor.closest ? anchor.closest('tr') : null;
      if (beside && beside.parentNode && beside.closest('table') === grid) {
        beside.parentNode.insertBefore(row, beside.nextSibling);
      } else {
        (grid.tBodies[0] || grid).appendChild(row);
      }
    }
    var seats = cellsOf(row);
    row.insertBefore(node, (c.col == null ? null : seats[c.col]) || null);
    return true;
  }

  // Removing every cell of a row leaves the <tr> behind as an empty stripe.
  // Runs after the whole-table pass, so a deleted table is never taken apart
  // row by row on the way out.
  function completeRowDeletes(changes, context, tracked) {
    var groups = {}, handled = {};
    (changes || []).forEach(function (change) {
      if (change.kind === 'removed' && change.row) {
        (groups[change.row] = groups[change.row] || []).push(change.id);
      }
    });
    context.rows = context.rows || rowIndex();
    Object.keys(groups).forEach(function (key) {
      var row = context.rows[key];
      if (!row || !row.parentNode) return;
      var inside = tracked.filter(function (block) { return row.contains(block.node); })
        .map(function (block) { return block.id; });
      if (!inside.length || !inside.every(function (id) { return groups[key].indexOf(id) !== -1; })) return;
      row.parentNode.removeChild(row);
      groups[key].forEach(function (id) { handled[id] = true; });
      delete context.rows[key];
    });
    return handled;
  }

  // ---- the operations ------------------------------------------------------

  function refuse(why) {
    if (Ryker.dialog) Ryker.dialog.alert('Cannot change this table', why, 'warn');
    return false;
  }

  function usable(node) {
    var cell = cellOf(node);
    if (!cell) return null;
    var grid = cell.closest('table');
    if (Ryker.blocks.excluded(grid) || (grid.closest && grid.closest('[data-ryker-lock]'))) {
      refuse('This table is marked as not editable, so its rows and columns stay as ' +
        'the document author left them.');
      return null;
    }
    if (spanned(grid)) {
      refuse('This table merges cells with colspan or rowspan. Adding or removing a row ' +
        'or column there would change which cell sits where, so Ryker leaves it alone.');
      return null;
    }
    return cell;
  }

  function blank(tag) {
    var cell = document.createElement(tag.toLowerCase());
    Ryker.blocks.stamp(cell);
    return cell;
  }

  function arm(cells) {
    cells.forEach(function (cell) { if (Ryker.editable) Ryker.editable.rebind(cell); });
  }

  function caretIn(cell) {
    try {
      var r = document.createRange();
      r.selectNodeContents(cell);
      r.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      cell.focus();
    } catch (e) {}
  }

  function commit(label, made, undo, redo) {
    Ryker.history.record({ label: label, undo: undo, redo: redo });
    arm(made);
    if (Ryker.editable) Ryker.editable.touch();
    if (made.length) caretIn(made[0]);
    return true;
  }

  function insertRow(node, side) {
    var cell = usable(node);
    if (!cell) return false;
    var row = cell.parentNode;
    var made = cellsOf(row).map(function (c) { return blank(c.tagName); });
    var fresh = document.createElement('tr');
    made.forEach(function (c) { fresh.appendChild(c); });
    var at = side === 'above' ? row : row.nextSibling;
    var host = row.parentNode;
    host.insertBefore(fresh, at);
    return commit(side === 'above' ? 'insert row above' : 'insert row below', made,
      function () { if (fresh.parentNode) fresh.parentNode.removeChild(fresh); },
      function () { host.insertBefore(fresh, at); arm(made); });
  }

  function removeRow(node) {
    var cell = usable(node);
    if (!cell) return false;
    var row = cell.parentNode;
    var grid = cell.closest('table');
    if (rowsOf(grid).length < 2) {
      return refuse('This is the table\'s only row. Delete the whole table instead, from ' +
        'the toolbar that appears over it.');
    }
    var locked = cellsOf(row).filter(function (c) { return Ryker.blocks.excluded(c); });
    if (locked.length) {
      return refuse('A cell in this row is marked as not editable, so the row stays.');
    }
    var host = row.parentNode, at = row.nextSibling;
    host.removeChild(row);
    return commit('delete row', [],
      function () { host.insertBefore(row, at); arm(cellsOf(row)); },
      function () { if (row.parentNode) row.parentNode.removeChild(row); });
  }

  function insertColumn(node, side) {
    var cell = usable(node);
    if (!cell) return false;
    var grid = cell.closest('table');
    var col = indexOfCell(cell) + (side === 'left' ? 0 : 1);
    var made = [], placed = [];
    rowsOf(grid).forEach(function (row) {
      var seats = cellsOf(row);
      if (!seats.length) return;
      // A header row keeps header cells, so the new column has a heading to be
      // filled in rather than a body cell wearing the header's place.
      var like = seats[Math.min(col, seats.length - 1)];
      var fresh = blank(like.tagName);
      made.push(fresh);
      placed.push({ row: row, node: fresh, before: seats[col] || null });
      row.insertBefore(fresh, seats[col] || null);
    });
    if (!made.length) return false;
    return commit(side === 'left' ? 'insert column left' : 'insert column right', made,
      function () {
        placed.forEach(function (p) { if (p.node.parentNode) p.node.parentNode.removeChild(p.node); });
      },
      function () {
        placed.forEach(function (p) { p.row.insertBefore(p.node, p.before); });
        arm(made);
      });
  }

  function removeColumn(node) {
    var cell = usable(node);
    if (!cell) return false;
    var grid = cell.closest('table');
    var col = indexOfCell(cell);
    if (cellsOf(cell.parentNode).length < 2) {
      return refuse('This is the table\'s only column. Delete the whole table instead, from ' +
        'the toolbar that appears over it.');
    }
    var taken = [];
    var blocked = false;
    rowsOf(grid).forEach(function (row) {
      var seat = cellsOf(row)[col];
      if (!seat) return;
      if (Ryker.blocks.excluded(seat)) blocked = true;
      taken.push({ row: row, node: seat, before: seat.nextSibling });
    });
    if (blocked) {
      return refuse('A cell in this column is marked as not editable, so the column stays.');
    }
    taken.forEach(function (t) { t.row.removeChild(t.node); });
    return commit('delete column', [],
      function () {
        taken.forEach(function (t) { t.row.insertBefore(t.node, t.before); arm([t.node]); });
      },
      function () {
        taken.forEach(function (t) { if (t.node.parentNode) t.node.parentNode.removeChild(t.node); });
      });
  }

  return {
    cellOf: cellOf, tableOf: tableOf, rowsOf: rowsOf, cellsOf: cellsOf,
    rowText: rowText, seatId: seatId, seatLabel: seatLabel, seatOf: seatOf,
    rowKey: rowKey, rowIndex: rowIndex, place: place,
    completeRowDeletes: completeRowDeletes, spanned: spanned,
    insertRow: insertRow, removeRow: removeRow,
    insertColumn: insertColumn, removeColumn: removeColumn
  };
})();
