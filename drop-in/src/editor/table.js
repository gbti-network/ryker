// What identifies a table cell, and how to read the grid it sits in.
//
// Lives in its own module rather than in blocks.js because it is a fact about
// grids, not about blocks. Everywhere else in the editor a table is scenery:
// the cells are prose and the structure around them belongs to the report. The
// one thing the rest of Ryker cannot work out for itself is what to call a
// cell that has no words in it yet, which is what this answers.
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

  return {
    cellOf: cellOf, tableOf: tableOf, rowsOf: rowsOf, cellsOf: cellsOf,
    rowText: rowText, seatId: seatId, seatLabel: seatLabel
  };
})();
