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

  // ---- the two vocabularies ------------------------------------------------
  //
  // Every step below used to name an HTML tag directly, which is right for a
  // document whose source is HTML and false for one whose source is Markdown:
  // "Change <p> to <h2>" tells an assistant to edit tags in a file that has
  // none. The fix is one writer reading one of two vocabularies, chosen by
  // Ryker.config.isMarkdown(), rather than a branch inside each writer. Eleven
  // `if (isMarkdown)` branches is the four scattered regexes this SOW was
  // written for, one level down: eleven places that can each be got wrong on
  // their own, instead of one decision expressed once.
  //
  // The rule for what a word says, which decides every entry below without a
  // second judgement call: NAME THE LITERAL MARKDOWN TOKEN WHERE THE PARSER
  // ACCEPTS ONLY ONE FORM, AND NAME THE STRUCTURE WHERE IT ACCEPTS SEVERAL.
  // Headings take the token, because the parser matches `#{1,6}` and nothing
  // else, so Setext headings do not exist here and `##` cannot contradict the
  // file. List items take the structure and never the marker, because the
  // parser accepts `-`, `*`, `+`, `1.` and `1)` and keeps only the text, so
  // the document's own convention is not recoverable and an instruction naming
  // one would silently convert every list it touched while claiming to change
  // a single line.
  //
  // A missing key throws rather than falling back. A vocabulary that quietly
  // returns an HTML word when Markdown is missing an entry is a table with
  // branches hiding in it, and the hole would surface as a wrong instruction
  // rather than as a failure.

  function tagWord(tag) { return '<' + String(tag || 'p').toLowerCase() + '>'; }

  function headingLevel(tag) {
    var m = /^H([1-6])$/.exec(String(tag || '').toUpperCase());
    return m ? Number(m[1]) : 0;
  }

  function hashes(level) { return new Array(level + 1).join('#'); }

  // Containers are here because move anchors are the one call site that hands
  // placeOf something that is not a leaf block. The `|| 'a block'` fallback
  // below stays deliberately: placeOf is handed the document root on a move to
  // the front, and instructions.build() has no try/catch above it, so a throw
  // for an unlisted tag would cost the whole prompt rather than one word.
  var PROSE = {
    P: 'a paragraph', LI: 'a list item', TD: 'a table cell',
    TH: 'a table header cell', CAPTION: 'a table caption',
    FIGCAPTION: 'a figure caption', DT: 'a definition term',
    DD: 'a definition', BLOCKQUOTE: 'a quoted paragraph',
    PRE: 'a code block', UL: 'a bulleted list', OL: 'a numbered list',
    TABLE: 'a table', FIGURE: 'a figure', SECTION: 'a section'
  };

  var WORDS = {
    html: {
      block: tagWord,
      bareBlock: tagWord,
      list: function (boxTag) {
        return boxTag === 'OL' ? 'an ordered list' : 'an unordered list';
      },
      insertedList: function (boxTag) {
        return (boxTag === 'OL' ? 'ordered' : 'unordered') + ' list (<' +
          String(boxTag || 'UL').toLowerCase() + '>) containing one <li>';
      },
      table: '<table>',
      removeTable: 'Remove the entire <table> element, its rows and its cells. Leave any',
      row: '<tr>',
      bareRow: '<tr>',
      cell: function (tag) { return tagWord(tag === 'TH' ? 'th' : 'td'); },
      cells: function (tag, count) {
        return count + ' ' + tagWord(tag === 'TH' ? 'th' : 'td') + ' cell(s)';
      },
      columnSeparator: null,
      rowPayload: function (tag, cells) {
        var name = tag === 'TH' ? 'th' : 'td';
        return '<tr>' + cells.map(function (c) {
          return '<' + name + '>' + c.html + '</' + name + '>';
        }).join('') + '</tr>';
      },
      cellPayload: function (tag, html) {
        var name = tag === 'TH' ? 'th' : 'td';
        return '<' + name + '>' + html + '</' + name + '>';
      },
      listPayload: function (boxTag, html) {
        var name = String(boxTag || 'UL').toLowerCase();
        return '<' + name + '><li>' + html + '</li></' + name + '>';
      },
      keepSame: 'Keep the element\'s contents and attributes unchanged. Its current contents are:',
      markerNote: function () { return null; }
    },
    markdown: {
      block: function (tag) {
        var level = headingLevel(tag);
        if (level) return 'a level ' + level + ' heading (`' + hashes(level) + ' `)';
        return PROSE[String(tag || 'P').toUpperCase()] || 'a block';
      },
      // "Insert a new " already carries the article, so the same word cannot
      // serve both positions. The test caught "Insert a new a paragraph".
      bareBlock: function (tag) {
        return String(WORDS.markdown.block(tag)).replace(/^an? /, '');
      },
      list: function (boxTag) {
        return boxTag === 'OL' ? 'a numbered list' : 'a bulleted list';
      },
      insertedList: function (boxTag) {
        return (boxTag === 'OL' ? 'numbered' : 'bulleted') + ' list with one item';
      },
      table: 'table',
      removeTable: 'Remove the entire table, every one of its rows and its separator line. Leave any',
      row: 'a table row',
      bareRow: 'table row',
      cell: function (tag) { return tag === 'TH' ? 'a header cell' : 'a cell'; },
      cells: function (tag, count) { return count + ' cell(s)'; },
      // A pipe table stops parsing the moment its delimiter row disagrees with
      // the number of columns, so a column step that does not mention it
      // produces a file that renders as paragraph text. The colons carry the
      // alignment and the exporter preserves them, so a reader who drops them
      // silently restyles the table.
      columnSeparator: 'Add one cell to the delimiter row underneath the header as well, ' +
        'keeping any alignment colons the other columns use.',
      rowPayload: function (tag, cells) {
        return '| ' + cells.map(function (c) { return c.md || ''; }).join(' | ') + ' |';
      },
      cellPayload: function (tag, html, md) {
        var value = md == null ? html : md;
        return value === '' ? '(blank)' : value;
      },
      listPayload: function (boxTag, html, md) {
        return (boxTag === 'OL' ? '1. ' : '- ') + (md == null ? html : md);
      },
      keepSame: 'Keep the text of the line unchanged. Only its prefix changes. The text is:',
      // A list being INSERTED has no existing marker to preserve, so a payload
      // has to pick one and `-` is what the exporter emits for the same reason.
      // Saying so out loud is the honest version: it keeps the rule that no
      // step dictates a marker for a line the file already has.
      //
      // Numbered lists get the opposite sentence rather than the same one. The
      // first version told a reader inserting an ordered list to swap in
      // whichever BULLET the file used, which would have turned it into a
      // bulleted one.
      markerNote: function (boxTag) {
        return boxTag === 'OL'
          ? 'The literal number does not matter: Markdown renumbers an ordered list from its first item.'
          : 'Use whichever bullet marker this file already uses, if it uses another.';
      }
    }
  };

  // Reading a word goes through here so a gap is loud. `format` arrives on ctx
  // rather than being read from the namespace, so a step stays testable with
  // no live document, which is the property the module was split out for.
  function word(ctx, key, a, b, c) {
    var book = WORDS[(ctx && ctx.format) || 'html'];
    if (!book) throw new Error('steps: no vocabulary for format ' + ctx.format);
    if (!Object.prototype.hasOwnProperty.call(book, key)) {
      throw new Error('steps: the ' + ctx.format + ' vocabulary has no entry for ' + key);
    }
    var value = book[key];
    return typeof value === 'function' ? value(a, b, c) : value;
  }

  // A FROM has to be findable in the file the assistant is holding. For a
  // Markdown document that is the authored Markdown carried on the block, not
  // the HTML it was rendered into: a block whose innerHTML is `<em>rate</em>`
  // reads `*rate*` in the file, and searching a `.md` for the former finds
  // nothing at all. This is the whole reason phase 1 stamps the source.
  function fromText(ctx, id, html) {
    if (!ctx || ctx.format !== 'markdown') return html;
    var src = ctx.source ? ctx.source(id) : null;
    return src == null ? toText(ctx, html) : src;
  }

  // A TO has no authored source, because nobody wrote it in the file yet. It
  // is serialised through the exporter's own inline writer rather than a second
  // one living here, so the instruction and the export cannot drift.
  function toText(ctx, html) {
    if (!ctx || ctx.format !== 'markdown') return html;
    return ctx.md ? ctx.md(html) : html;
  }

  // An inserted block needs its own prefix, or the reader adds a heading as a
  // plain line of text. Built by the exporter's block writer rather than by
  // counting hashes here, so an inserted H2 in a prompt and an inserted H2 in
  // an export cannot disagree about what a level 2 heading looks like.
  function blockPayload(ctx, tag, html) {
    if (!ctx || ctx.format !== 'markdown') return html;
    return ctx.mdBlock ? ctx.mdBlock(tag, html) : toText(ctx, html);
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
    // The conversion branch has to require that the tag ACTUALLY changed.
    // Without that, editing the text of a list item read "Change <li> to an
    // unordered list", describing a conversion nobody performed and telling
    // the reader to restructure a list that was already a list. Found while
    // reading real output rather than assertions, and it predates the Markdown
    // work: the committed bundle says the same thing.
    var replacementList = changesTag && e.afterTag === 'LI' &&
      (e.boxTag === 'OL' || e.boxTag === 'UL');
    if (replacementList) {
      out.push('## ' + n + '. Change ' + word(ctx, 'block', e.beforeTag) + ' to ' +
        word(ctx, 'list', e.boxTag));
    } else if (changesTag) {
      out.push('## ' + n + '. Change ' + word(ctx, 'block', e.beforeTag) + ' to ' +
        word(ctx, 'block', e.afterTag) + (sameContents ? '' : ' and replace its contents'));
    } else {
      out.push('## ' + n + '. Replace the contents of ' +
        (e.tag ? word(ctx, 'block', e.tag) : 'a block'));
    }
    out.push('');
    var w = ctx.where(e.id);
    if (w) out.push('Position: ' + w);
    out.push('');
    if (changesTag && sameContents) {
      out.push(word(ctx, 'keepSame'));
      out.push('<<<'); out.push(fromText(ctx, e.id, e.before)); out.push('>>>');
      return;
    }
    out.push('FROM:');
    out.push('<<<'); out.push(fromText(ctx, e.id, e.before)); out.push('>>>');
    out.push('');
    out.push('TO:');
    out.push('<<<'); out.push(toText(ctx, e.after)); out.push('>>>');
    out.push('');
    out.push('Plain text of the new version, for confirmation:');
    out.push('  ' + ctx.text(e.after));
  }

  function insertStep(e, n, ctx, out) {
    var tag = (e.tag || 'p').toLowerCase();
    var insertedList = tag === 'li' && (e.boxTag === 'OL' || e.boxTag === 'UL');
    if (insertedList) {
      out.push('## ' + n + '. Insert a new ' + word(ctx, 'insertedList', e.boxTag));
    } else {
      out.push('## ' + n + '. Insert a new ' + word(ctx, 'bareBlock', tag));
    }
    out.push('');
    afterLine(e, ctx, out);
    out.push('');
    out.push('CONTENT:');
    out.push('<<<');
    out.push(insertedList
      ? word(ctx, 'listPayload', e.boxTag, e.after, toText(ctx, e.after))
      : blockPayload(ctx, tag.toUpperCase(), e.after));
    out.push('>>>');
    var marker = insertedList && word(ctx, 'markerNote', e.boxTag);
    if (marker) out.push(marker);
    // Markdown separates blocks by blank lines, and a new one pasted against
    // its neighbour joins them into a single paragraph. A new item inside a
    // list is the exception: there the blank line would end the list.
    if (ctx && ctx.format === 'markdown' && tag !== 'li') {
      out.push('Leave one blank line before it and one after it.');
    }
    out.push('');
    out.push('Plain text, for confirmation:');
    out.push('  ' + ctx.text(e.after));
  }

  function deleteBoxStep(e, n, ctx, out) {
    out.push('## ' + n + '. Delete a whole ' + word(ctx, 'table'));
    out.push('');
    if (e.position) {
      out.push('Position: the ' + word(ctx, 'table') + ' containing ' + e.position + '.');
      out.push('');
    }
    out.push(word(ctx, 'removeTable'));
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
    out.push('<<<'); out.push(fromText(ctx, e.id, e.before)); out.push('>>>');
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

  function addRowStep(e, n, ctx, out) {
    out.push('## ' + n + '. Insert a new table row');
    out.push('');
    if (e.position) out.push('Position: in the ' + word(ctx, 'table') + ' containing ' + e.position + '.');
    if (e.afterRow) out.push('Put it immediately after the row reading: ' + e.afterRow);
    else out.push('Put it as the first row of its row group.');
    out.push('');
    out.push('Insert one ' + word(ctx, 'bareRow') + ' holding ' +
      word(ctx, 'cells', e.cellTag, e.cells.length) + ', in this order:');
    out.push('<<<');
    out.push(word(ctx, 'rowPayload', e.cellTag, e.cells.map(function (c) {
      return { html: c.html, md: toText(ctx, c.html) };
    })));
    out.push('>>>');
    out.push('');
    out.push('Plain text of the new row, for confirmation:');
    out.push('  ' + rowOf(e.cells).map(function (h) { return ctx.text(h) || '(blank)'; }).join(' | '));
  }

  function deleteRowStep(e, n, ctx, out) {
    out.push('## ' + n + '. Delete a table row');
    out.push('');
    if (e.position) out.push('Position: in the ' + word(ctx, 'table') + ' containing ' + e.position + '.');
    out.push('');
    out.push('Remove one whole ' + word(ctx, 'row') + ' and every cell inside it. Change no other row.');
    out.push('It is the row whose cells read, in order:');
    out.push('');
    e.cells.forEach(function (c, k) {
      out.push('  ' + (k + 1) + '. ' + (clip(ctx.text(c.html), 90) || '(blank)'));
    });
  }

  function addColumnStep(e, n, ctx, out) {
    out.push('## ' + n + '. Insert a new table column');
    out.push('');
    if (e.position) out.push('Position: in the ' + word(ctx, 'table') + ' containing ' + e.position + '.');
    out.push('Insert it as column ' + (e.col + 1) + ', counting from 1 at the left, in');
    out.push('every row of the table including the header.');
    out.push('');
    if (ctx && ctx.format === 'markdown') {
      out.push('Add one cell to each row, in row order. A Markdown table draws no');
      out.push('distinction between a header cell and a body cell:');
    } else {
      out.push('Add one cell to each row, in row order, using ' + word(ctx, 'cell', 'TH') +
        ' in a header row and');
      out.push(word(ctx, 'cell', 'TD') + ' elsewhere:');
    }
    out.push('');
    e.cells.forEach(function (c, k) {
      out.push('  ' + (k + 1) + '. ' + word(ctx, 'cellPayload', c.tag, c.html, toText(ctx, c.html)));
    });
    var sep = word(ctx, 'columnSeparator');
    if (sep) { out.push(''); out.push(sep); }
  }

  function deleteColumnStep(e, n, ctx, out) {
    out.push('## ' + n + '. Delete a table column');
    out.push('');
    if (e.position) out.push('Position: in the ' + word(ctx, 'table') + ' containing ' + e.position + '.');
    out.push('Remove column ' + (e.col + 1) + ', counting from 1 at the left, from every');
    out.push('row of the table including the header. Leave every other column alone.');
    out.push('');
    out.push('The cells being removed read, in row order:');
    out.push('');
    e.cells.forEach(function (c, k) {
      out.push('  ' + (k + 1) + '. ' + (clip(ctx.text(c.html), 90) || '(blank)'));
    });
    var gone = word(ctx, 'columnSeparator');
    if (gone) {
      out.push('');
      out.push('Remove that column\'s cell from the delimiter row underneath the header');
      out.push('as well, so the row still has one cell per column.');
    }
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

  return { write: write, group: group, clip: clip, word: word, fromText: fromText };
})();
