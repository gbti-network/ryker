// Styles, split by where they have to live.
//
// Everything Ryker draws goes in a shadow root, because the reports set bare
// element selectors for p, h2, a, code and table plus a dark-mode block and a
// print block, and a toolbar in the normal DOM inherits all of it. Shadow DOM
// also stops Ryker's own styles reaching the report and changing the PDF.
//
// The exception is documentCss below, which styles the REPORT's own elements
// and therefore cannot be scoped to a shadow root. Until 2026-08-16 the stated
// reason for it was ::highlight(), which comments used to mark quoted text.
// Comments are decommissioned and those rules are gone, but the sheet is still
// load-bearing for what remains: the contenteditable state treatments, the
// picked-block outline, the user-select lock during a cross-block drag, hiding
// the report's own contents list while the rail is open, and the print rules
// that keep Ryker out of the PDF.
//
// The scale below is deliberately Tailwind-shaped: a 4px spacing step, a small
// radius set, ring-style focus rather than outline-on-the-edge, and one shadow
// per elevation. Components then compose from tokens instead of each carrying
// its own numbers.
Ryker.styles = (function () {
  'use strict';

  var LIGHT = Ryker.theme.cssText;

  var documentCss = [
    // No resting outline. A dashed box around every paragraph turned the whole
    // report into a form the moment Edit Mode opened, which made it hard to read
    // the thing you were editing. The caret already says where you are, so the
    // only marks left are a soft tint on the block in focus and a slightly
    // warmer one on a block with unsaved changes.
    // No fills behind text. A tint sits UNDER the words and changes how the
    // prose itself reads, which is the wrong place to put a state marker in a
    // document whose whole job is being read. These are all edge treatments:
    // the block looks slightly recessed, and the words keep their own colour.
    '[contenteditable="true"].ryker-editing{outline:none;border-radius:4px}',
    '[contenteditable="true"].ryker-editing:focus{outline:none;',
    '  box-shadow:inset 0 0 0 1px rgba(15,18,25,.10),inset 0 1px 3px rgba(15,18,25,.07)}',
    // Unsaved changes get a bar down the leading edge rather than a wash. It
    // reads at a glance when scanning a column of blocks, which a pale tint
    // does not.
    '[contenteditable="true"].ryker-dirty{box-shadow:inset 3px 0 0 rgba(217,119,6,.8)}',
    '[contenteditable="true"].ryker-dirty:focus{',
    '  box-shadow:inset 3px 0 0 rgba(217,119,6,.95),inset 0 0 0 1px rgba(15,18,25,.10)}',
    // The picked set. These style the REPORT's own elements, so they live in the
    // document stylesheet; a shadow root cannot reach them.
    // Picked blocks are outlined, not filled. A 16 percent wash over several
    // paragraphs made the selected text harder to read than the text around it,
    // which is backwards.
    '.ryker-pick,.ryker-pick[contenteditable="true"]:focus{background:none;border-radius:4px;',
    '  box-shadow:inset 0 0 0 2px rgba(79,70,229,.55)}',
    // The unsaved bar sits in the margin, not against the prose.
    //
    // Drawn as an inset shadow it inherited the block's 4px radius, so a 3px
    // bar came to a point at each end and read as a smudge rather than as a
    // deliberate edge, and with no padding the first letter of every line
    // touched it. Square ends and a gutter of its own fix both.
    //
    // The negative margin pays for the padding, so a block does not jump
    // sideways the moment it becomes dirty. Carried past .ryker-pick on
    // specificity as well as on order, because a block that is picked AND
    // unsaved must not get its rounded ends back.
    '[contenteditable="true"].ryker-dirty,[contenteditable="true"].ryker-dirty:focus,',
    '[contenteditable="true"].ryker-dirty.ryker-pick,',
    '[contenteditable="true"].ryker-dirty.ryker-pick:focus{',
    '  border-radius:0;margin-left:-12px;padding-left:12px}',
    // While a cross-block drag is live, the browser must not also be painting a
    // text selection underneath it.
    'body.ryker-picking, body.ryker-picking *{-webkit-user-select:none;user-select:none}',
    // The rail lists everything the report's own contents list does and more, so
    // leaving the sticky original visible puts it underneath and unclickable.
    'body[data-ryker-rail] nav.toc{display:none}',
    // Ryker must leave no trace in print. The PDF is the regression check, so
    // this rule is load-bearing rather than cosmetic.
    '@media print{[contenteditable]{outline:none !important;background:none !important}' +
      '.ryker-pick{background:none !important;box-shadow:none !important}' +
      // Only ever matches padding Ryker itself applied, so a report with body
      // padding of its own keeps it.
      'body[data-ryker-pushed]{padding-top:0 !important;padding-right:0 !important;' +
      'padding-left:0 !important}}'
  ].join('\n');

  var shadowCss = [
    ':host{all:initial}',
    '@media print{:host{display:none !important}}',
    '*,*::before,*::after{box-sizing:border-box}',

    // One palette. Ryker is chrome around a document, and a toolbar that changes
    // colour independently of the page it sits on was a distraction rather than
    // a feature.
    ':host{' + LIGHT + '}',

    // Typography lives on the wrapper, not on :host.
    //
    // The host element carries an inline all:initial so the report's own CSS
    // cannot reach it, and an inline declaration beats any :host rule, so a
    // font set here could never apply: everything Ryker drew inherited the
    // browser default and rendered in Times. Custom properties survive
    // all:initial, which is why the tokens above still work from :host.
    '.layer{',
    // Plain sans-serif, deliberately not the report's font. The reports use the
    // platform UI stack, so borrowing it made Ryker's chrome read as part of the
    // document. The generic family is distinct from Segoe UI and San Francisco
    // on the platforms that have those, and resolves everywhere.
    '  font-family:var(--rk-font);',
    '  font-size:13px;line-height:1.55;color:var(--rk-fg);',
    '  -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;',
    '}',

    // ---- shared primitives ------------------------------------------------
    'button.rk{display:inline-flex;align-items:center;gap:6px;background:var(--rk-bg);',
    '  color:var(--rk-fg2);border:1px solid var(--rk-line2);border-radius:var(--rk-r-md);',
    '  padding:6px 11px;font:inherit;font-size:12px;font-weight:500;line-height:1.2;',
    '  cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,color .12s}',
    'button.rk:hover:not(:disabled){background:var(--rk-bg2);border-color:var(--rk-muted);color:var(--rk-fg)}',
    'button.rk:active:not(:disabled){background:var(--rk-bg3)}',
    'button.rk:disabled{opacity:.45;cursor:not-allowed}',
    // display:inline-flex on the base rule outranks the user agent's
    // [hidden]{display:none}, so a button hidden by the attribute stayed on
    // screen. Author display beats user agent display; this restores it.
    'button.rk[hidden]{display:none}',
    'button.rk.ghost{border-color:transparent;background:transparent}',
    'button.rk.ghost:hover:not(:disabled){background:var(--rk-bg2);border-color:var(--rk-line)}',
    'button.rk.danger:hover:not(:disabled){background:var(--rk-danger-soft);',
    '  border-color:var(--rk-danger);color:var(--rk-danger)}',
    'button.rk.icon{padding:6px 9px}',
    // The active state comes last on purpose. It shares specificity with
    // .ghost, so declaring it earlier let a ghost button that was also active
    // render transparent and disappear entirely.
    'button.rk.on{background:var(--rk-active);border-color:var(--rk-active-line);color:var(--rk-onactive);font-weight:600}',
    'button.rk.on:hover:not(:disabled){background:var(--rk-bg3);border-color:var(--rk-active-line);',
    '  color:var(--rk-onactive)}',
    // Primary is the brand, and it is not the same thing as active. A dialog's
    // confirming action used to borrow .on, which is the grey a toggled
    // toolbar button wears, so the one button meant to be reached for looked
    // like a switch that happened to be on. It comes after .on for the same
    // specificity reason .on comes after .ghost.
    'button.rk.primary{background:var(--rk-brand-color);border-color:var(--rk-brand-color);',
    '  color:var(--rk-brand-ink);font-weight:600}',
    'button.rk.primary:hover:not(:disabled),button.rk.primary:active:not(:disabled){',
    '  background:var(--rk-brand-strong);border-color:var(--rk-brand-strong);',
    '  color:var(--rk-brand-ink)}',
    // A destructive confirm is primary by weight and danger by meaning. Danger
    // wins the colour, because brand red on a Delete reads as encouragement.
    'button.rk.primary.danger,button.rk.primary.danger:hover:not(:disabled),',
    'button.rk.primary.danger:active:not(:disabled){background:var(--rk-danger);',
    '  border-color:var(--rk-danger);color:var(--rk-brand-ink)}',

    ':is(button.rk,.handle,input.rk,textarea.rk):focus-visible{',
    '  outline:2px solid transparent;box-shadow:0 0 0 3px var(--rk-ring);',
    '  border-color:var(--rk-accent)}',

    '.count{display:inline-block;min-width:18px;text-align:center;background:var(--rk-bg3);',
    '  color:var(--rk-fg2);border-radius:4px;padding:1px 6px;margin-left:2px;',
    '  font-size:11px;font-weight:600;line-height:1.4}',
    '.count.warn{background:var(--rk-warn);color:var(--rk-onwarn)}',
    'button.rk.on .count{background:var(--rk-bg);color:var(--rk-onactive)}',

    // ---- collapsed handle -------------------------------------------------
    '.handle{position:fixed;top:0;right:20px;z-index:2147483000;',
    '  background:var(--rk-bg);color:var(--rk-fg);border:1px solid var(--rk-line2);border-top:none;',
    '  border-radius:0 0 var(--rk-r-lg) var(--rk-r-lg);width:40px;height:40px;padding:8px;cursor:pointer;',
    '  font:inherit;display:flex;align-items:center;justify-content:center;box-shadow:var(--rk-sh-md)}',
    '.handle:hover{background:var(--rk-bg2)}',
    '.handle .brand-mark{width:24px;height:24px;margin:0}',

    // ---- toolbar ----------------------------------------------------------
    '.bar{position:fixed;top:0;left:0;right:0;z-index:2147483000;background:var(--rk-bg);',
    '  border-bottom:1px solid var(--rk-line);display:flex;align-items:center;gap:6px;',
    '  padding:8px 12px;flex-wrap:wrap;box-shadow:var(--rk-sh-md)}',
    '.brand{font-weight:700;letter-spacing:.09em;font-size:10px;text-transform:uppercase;',
    '  color:var(--rk-muted);margin-right:var(--rk-s1)}',
    '.brand-mark{display:block;width:18px;height:18px;object-fit:contain;flex:none;',
    '  margin-left:1px;margin-right:-1px}',
    '.sep{width:1px;height:22px;background:var(--rk-line);margin:0 var(--rk-s1)}',
    '.spacer{flex:1}',
    '.where{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--rk-muted);',
    '  background:var(--rk-bg2);border:1px solid var(--rk-line);border-radius:4px;padding:4px 11px;',
    '  font:inherit;font-size:11px;cursor:pointer}',
    // Disabled means there is nothing it can do about what it is reporting, so
    // it stops looking like a control and goes back to being a label.
    '.where:disabled{cursor:default}',
    '.where:not(:disabled):hover{background:var(--rk-bg3);border-color:var(--rk-line2);color:var(--rk-fg2)}',
    '.where:focus-visible{outline:2px solid transparent;box-shadow:0 0 0 3px var(--rk-ring)}',

    // ---- instant tooltip ---------------------------------------------------
    // White on black regardless of the palette, so it reads the same over the
    // toolbar and over report content, and shows with no delay.
    '.rk-tip{position:fixed;z-index:2147483200;background:#0d0f13;color:#fff;',
    '  border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:5px 9px;',
    '  font-size:11.5px;font-weight:500;line-height:1.35;max-width:280px;',
    '  pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.4)}',

    // The instruction count remains an accessible button, but its number is
    // the only visible object. A box around a count made it look like a second
    // action instead of the state of the instruction pane.
    'button.rk.count-only{padding:4px;min-width:26px;justify-content:center;',
    '  border-color:transparent;background:transparent}',
    'button.rk.count-only:hover:not(:disabled){border-color:transparent;background:var(--rk-bg2)}',
    'button.rk.count-only.on,button.rk.count-only.on:hover:not(:disabled){',
    '  border-color:transparent;background:transparent;color:var(--rk-fg)}',
    'button.rk.count-only .count{margin-left:0}',
    'button.rk.count-only.on .count{background:var(--rk-active);color:var(--rk-onactive)}',

    // ---- outline rail ------------------------------------------------------
    '.rail{position:fixed;left:0;top:var(--ryker-offset,0px);bottom:0;width:320px;',
    '  z-index:2147482900;display:flex;flex-direction:column;background:var(--rk-bg);',
    '  border-right:1px solid var(--rk-line);box-shadow:2px 0 18px rgba(15,18,25,.07)}',
    '.rail header{display:flex;align-items:center;gap:var(--rk-s2);flex:0 0 auto;',
    '  padding:var(--rk-s3) var(--rk-s4);border-bottom:1px solid var(--rk-line);',
    '  background:var(--rk-bg2)}',
    '.rail header h2{margin:0;font-size:12.5px;font-weight:600;letter-spacing:.02em}',
    '.rail .rail-count{font-size:11px;color:var(--rk-muted);font-variant-numeric:tabular-nums}',
    '.rail .spacer{flex:1 1 auto}',
    '.rail .rail-scope{padding:var(--rk-s2) var(--rk-s4);border-bottom:1px solid var(--rk-line);',
    '  background:var(--rk-bg)}',
    '.rail .scope-choices{display:flex;gap:var(--rk-s1)}',
    '.rail .scope-choice{flex:1 1 0;justify-content:center;padding:5px 8px}',
    '.rail .scope-label{margin-top:5px;color:var(--rk-muted);font-size:10.5px;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.rail .rail-body{flex:1 1 auto;overflow:auto;padding:var(--rk-s2) 0}',
    '.rail .rail-grip{position:absolute;top:0;bottom:0;right:-4px;width:9px;cursor:col-resize;',
    '  z-index:1;background:transparent}',
    '.rail .rail-grip:hover,.rail .rail-grip:focus-visible{background:var(--rk-accent-soft);outline:none}',
    '.rail .rail-row{display:flex;align-items:center;gap:6px;height:26px;padding-right:8px;',
    '  cursor:pointer;font-size:12.5px;color:var(--rk-fg);white-space:nowrap;overflow:hidden;',
    '  border-left:2px solid transparent}',
    '.rail .rail-row:hover{background:var(--rk-bg2)}',
    '.rail .rail-row.on{background:var(--rk-bg3);border-left-color:var(--rk-active-line)}',
    '.rail .rail-row.navigation-only{color:var(--rk-muted);cursor:pointer}',
    '.rail .rail-row.navigation-only .rail-ico{opacity:.65}',
    '.rail .rail-tw{flex:0 0 12px;width:12px;text-align:center;color:var(--rk-muted);font-size:9px}',
    '.rail .rail-tw.none{visibility:hidden}',
    '.rail .rail-ico{flex:0 0 14px;width:14px;text-align:center;color:var(--rk-muted);font-size:11px}',
    '.rail .rail-label{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}',
    '.rail .rail-row.k-heading .rail-label{font-weight:600}',
    '.rail .rail-row.r2 .rail-label{font-size:13px}',
    '.rail .rail-row.k-text .rail-label{color:var(--rk-muted)}',
    // Dragging a row. The row being carried fades rather than vanishes, so the
    // place it came from stays legible while the line shows where it lands.
    '.rail .rail-row.dragging{opacity:.42}',
    '.rail .rail-row:active{cursor:grabbing}',
    '.rail .rail-row.drop-before{box-shadow:inset 0 2px 0 var(--rk-accent)}',
    '.rail .rail-row.drop-after{box-shadow:inset 0 -2px 0 var(--rk-accent)}',
    '@media (max-width:820px){.rail{width:100%}}',

    // ---- floating format bar ----------------------------------------------
    // Dark on purpose. It sits over report content rather than over Ryker
    // chrome, so it has to read as an overlay rather than blend into the page.
    '.formatbar{position:fixed;z-index:2147483060;display:flex;align-items:center;gap:2px;',
    '  background:#16181d;border:1px solid rgba(255,255,255,.12);border-radius:var(--rk-r-md);',
    '  padding:4px;box-shadow:0 6px 22px rgba(0,0,0,.34)}',
    '.formatbar .fb-btn{background:transparent;border:none;color:#e9ecf2;border-radius:4px;',
    '  min-width:30px;height:28px;padding:0 8px;display:inline-flex;align-items:center;',
    '  justify-content:center;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;',
    '  transition:background .12s}',
    '.formatbar .fb-btn:hover{background:rgba(255,255,255,.14);color:#fff}',
    '.formatbar .fb-btn:focus-visible{outline:2px solid #8b93ff;outline-offset:-2px;box-shadow:none}',
    // Named rather than counted. nth-of-type counted every button in the bar,
    // so the italic face landed on B and the strikethrough on I, and adding any
    // control would have shifted them again.
    '.formatbar .fb-i{font-style:italic;font-family:Georgia,"Times New Roman",serif}',
    '.formatbar .fb-s{text-decoration:line-through}',
    '.formatbar .fb-kill{color:#ffb4b4}',
    '.formatbar .fb-kill:hover{background:#7f1d1d;color:#fff}',
    '.formatbar .fb-sep{width:1px;height:18px;background:rgba(255,255,255,.16);margin:0 3px}',
    '.formatbar .fb-type{min-width:74px;font-weight:500;font-size:12px;gap:5px}',
    '.formatbar .fb-type::after{content:"";width:0;height:0;border-left:3.5px solid transparent;',
    '  border-right:3.5px solid transparent;border-top:4px solid currentColor;opacity:.7;margin-left:2px}',
    '.formatbar .fb-type:disabled{opacity:.4;cursor:not-allowed}',

    // ---- icon buttons ------------------------------------------------------
    'button.rk.iconbtn{padding:6px;min-width:30px;justify-content:center;color:var(--rk-muted)}',
    'button.rk.iconbtn:hover:not(:disabled){color:var(--rk-fg)}',
    'button.rk.iconbtn svg{display:block}',

    // ---- dropdown menu -----------------------------------------------------
    '.menu{position:fixed;z-index:2147483110;min-width:200px;background:var(--rk-bg);',
    '  border:1px solid var(--rk-line);border-radius:var(--rk-r-lg);padding:5px;',
    '  box-shadow:var(--rk-sh-xl)}',
    '.menu-item{display:flex;align-items:center;gap:9px;width:100%;background:none;border:none;',
    '  border-radius:var(--rk-r-sm);padding:7px 9px;font:inherit;font-size:12.5px;',
    '  color:var(--rk-fg2);cursor:pointer;text-align:left}',
    '.menu-item:hover{background:var(--rk-bg2);color:var(--rk-fg)}',
    '.menu-item:focus-visible{outline:2px solid transparent;box-shadow:0 0 0 3px var(--rk-ring)}',
    '.menu-item.off{color:var(--rk-muted);cursor:default}',
    '.menu-item.off:hover{background:transparent}',
    '.menu-item.danger{color:var(--rk-danger)}',
    '.menu-item.danger:hover{background:var(--rk-danger-soft)}',
    '.menu-ico{display:inline-flex;flex:none;color:var(--rk-muted)}',
    '.menu-item.danger .menu-ico{color:var(--rk-danger)}',
    '.menu-sep{display:block;height:1px;background:var(--rk-line);margin:5px 3px}',
    '.where .dot{width:7px;height:7px;border-radius:4px;background:var(--rk-muted);flex:none}',
    '.where .dot.ok{background:var(--rk-ok)}.where .dot.warn{background:var(--rk-warn)}',

    // ---- instruction pane --------------------------------------
    '.pane{position:fixed;top:var(--ryker-offset,0px);right:0;bottom:0;width:430px;max-width:94vw;',
    '  z-index:2147482900;background:var(--rk-bg);border-left:1px solid var(--rk-line);',
    '  display:flex;flex-direction:column;box-shadow:var(--rk-sh-xl)}',
    // A wide grab area with a narrow visible line: easy to hit, quiet at rest.
    '.pane-grip{position:absolute;left:-4px;top:0;bottom:0;width:10px;cursor:col-resize;',
    '  z-index:2}',
    '.pane-grip::after{content:"";position:absolute;left:3px;top:0;bottom:0;width:2px;',
    '  background:transparent;transition:background .12s}',
    '.pane-grip:hover::after,.pane-grip:focus-visible::after{background:var(--rk-accent)}',
    '.pane-grip:focus-visible{outline:none}',
    '.pane.resizing{user-select:none}',
    '.pane.resizing .pane-grip::after{background:var(--rk-accent)}',
    '.pane header{padding:var(--rk-s3) var(--rk-s4);border-bottom:1px solid var(--rk-line);',
    '  display:flex;align-items:center;gap:var(--rk-s2);background:var(--rk-bg2)}',
    '.pane header h2{margin:0;font-size:13px;font-weight:700}',
    '.pane .pane-body{flex:1;display:flex;padding:var(--rk-s3) var(--rk-s4);min-height:0}',
    '.pane textarea.pane-text{flex:1;resize:none;font-family:var(--rk-mono);font-size:11.5px;',
    '  line-height:1.6;white-space:pre;overflow:auto}',
    '.pane .pane-status{padding:0 var(--rk-s4) var(--rk-s2);font-size:11px;color:var(--rk-muted)}',
    '.pane .pane-status.ok{color:var(--rk-ok)}',
    '.pane .pane-status button.linkish{background:none;border:none;padding:0;margin-left:2px;',
    '  color:var(--rk-accent);font:inherit;font-size:11px;text-decoration:underline;',
    '  text-underline-offset:2px;cursor:pointer}',
    '.pane .pane-status.warn{color:var(--rk-warn)}',
    // Clear lives in the header row now, beside rebuild, so an icon button has
    // to be able to read as destructive on its own.
    'button.rk.iconbtn.danger{color:var(--rk-danger);opacity:.75}',
    'button.rk.iconbtn.danger:hover:not(:disabled){color:var(--rk-danger);opacity:1;',
    '  background:var(--rk-danger-soft);border-color:transparent}',
    '@media (max-width:820px){.pane{width:100%}}',

    // A row of buttons. This was '.card .acts' until 2026-08-16, and .card was
    // a comment card, so when comments were decommissioned the descendant
    // qualifier stopped matching anything and both surviving .acts rows lost
    // their layout: the Copy and Download buttons in the reset-document
    // confirmation are built with dom.el, so no whitespace text node separates
    // them and they rendered flush against each other. Bare, because there is
    // no ancestor left to qualify by.
    '.acts{display:flex;gap:5px;flex-wrap:wrap}',

    // ---- fields -----------------------------------------------------------
    'textarea.rk,input.rk{display:block;width:100%;background:var(--rk-field);color:var(--rk-fg);',
    '  border:1px solid var(--rk-line2);border-radius:var(--rk-r-md);padding:9px 11px;',
    '  font:inherit;font-size:12.5px;line-height:1.55;resize:vertical;',
    '  transition:border-color .12s,box-shadow .12s}',
    'textarea.rk::placeholder,input.rk::placeholder{color:var(--rk-muted)}',
    'label.rk{display:block;font-size:10.5px;font-weight:600;color:var(--rk-muted);',
    '  margin:var(--rk-s3) 0 6px;text-transform:uppercase;letter-spacing:.07em}',
    'label.rk:first-child{margin-top:0}',

    // ---- modal ------------------------------------------------------------
    // Anchored middle right rather than centred. A dialog in the middle of the
    // page covers the very text being commented on, which is exactly what the
    // person needs to see while writing about it.
    '.backdrop{position:fixed;inset:0;z-index:2147483100;background:rgba(10,12,18,.5);',
    '  display:flex;align-items:center;justify-content:flex-end;',
    '  padding:var(--rk-s5) var(--rk-s5) var(--rk-s5) var(--rk-s4);overflow-y:auto}',
    '.modal{background:var(--rk-bg);border:1px solid var(--rk-line);border-radius:var(--rk-r-xl);',
    '  width:100%;max-width:460px;box-shadow:var(--rk-sh-xl);overflow:hidden}',
    '.modal header{padding:var(--rk-s4) var(--rk-s5);border-bottom:1px solid var(--rk-line);',
    '  background:var(--rk-bg2)}',
    '.modal header h2{margin:0;font-size:13.5px;font-weight:650;letter-spacing:.005em;color:var(--rk-fg)}',
    '.modal .body{padding:var(--rk-s4) var(--rk-s5);max-height:62vh;overflow-y:auto;color:var(--rk-fg2)}',
    '.modal .foot{padding:var(--rk-s3) var(--rk-s5);border-top:1px solid var(--rk-line);',
    '  display:flex;gap:var(--rk-s2);justify-content:flex-end;flex-wrap:wrap;background:var(--rk-bg2)}',
    '.modal p{margin:0 0 var(--rk-s3)}.modal p:last-child{margin-bottom:0}',
    '.modal ul{margin:0 0 var(--rk-s3);padding-left:var(--rk-s5)}.modal li{margin-bottom:var(--rk-s1)}',
    '.modal a{color:var(--rk-accent);text-underline-offset:2px}',
    '.modal b{color:var(--rk-fg)}',
    '.modal code,.modal pre{background:var(--rk-bg3);border-radius:var(--rk-r-sm);',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;',
    '  overflow-wrap:anywhere;color:var(--rk-fg)}',
    '.modal code{padding:2px 5px}',
    '.modal pre{padding:var(--rk-s3);overflow-x:auto;border:1px solid var(--rk-line);line-height:1.5}',
    // ---- callouts ---------------------------------------------------------
    // Square on the left. The accent stripe is the point of a notice, and a
    // rounded corner cutting across it reads as a rendering fault rather than a
    // detail. The right corners stay rounded, matching the quote blocks.
    '.note{border:1px solid var(--rk-line);border-left:3px solid var(--rk-accent);',
    '  border-radius:0 var(--rk-r-md) var(--rk-r-md) 0;padding:10px var(--rk-s3);margin:var(--rk-s3) 0;',
    '  background:var(--rk-accent-soft);font-size:11.5px;line-height:1.55;color:var(--rk-fg2)}',
    '.note:first-child{margin-top:0}.note:last-child{margin-bottom:0}',
    '.note.warn{border-left-color:var(--rk-warn);background:var(--rk-warn-soft)}',
    '.note.bad{border-left-color:var(--rk-danger);background:var(--rk-danger-soft)}',
    '.note.ok{border-left-color:var(--rk-ok);background:var(--rk-ok-soft)}',

    // ---- lists and rows ---------------------------------------------------
    '.filelist{border:1px solid var(--rk-line);border-radius:var(--rk-r-md);',
    '  max-height:240px;overflow-y:auto;background:var(--rk-bg2)}',
    '.filerow{display:flex;align-items:center;gap:var(--rk-s2);padding:7px 11px;',
    '  border-bottom:1px solid var(--rk-line);font-size:12px}',
    '.filerow:last-child{border-bottom:none}',
    '.filerow .sz{margin-left:auto;color:var(--rk-muted);font-size:11px;flex:none}',
    '.filerow .nm{overflow-wrap:anywhere}',

    // A label/value table, as a definition list rather than a <table>: these are
    // pairs and not a grid of data, and a dl says so to a screen reader. The
    // label column is sized to its longest label so every value starts on the
    // same edge, which is the whole point of reading it as a table.
    '.kv{display:grid;grid-template-columns:minmax(0,142px) minmax(0,1fr);',
    '  margin:0;border:1px solid var(--rk-line);border-radius:var(--rk-r-md);overflow:hidden}',
    '.kv dt{padding:8px 11px;font-size:10.5px;font-weight:600;color:var(--rk-muted);',
    '  text-transform:uppercase;letter-spacing:.06em;background:var(--rk-bg2);',
    '  border-bottom:1px solid var(--rk-line)}',
    '.kv dd{margin:0;padding:8px 11px;font-size:12px;line-height:1.5;color:var(--rk-fg2);',
    '  border-bottom:1px solid var(--rk-line);overflow-wrap:anywhere}',
    '.kv dt:last-of-type,.kv dd:last-of-type{border-bottom:none}',
    // The one row that asks for something rather than stating a fact.
    '.kv dt.cta,.kv dd.cta{background:var(--rk-accent-soft)}',
    '.kv dt.cta{color:var(--rk-accent)}',

    '.muted{color:var(--rk-muted)}',
    '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',

    '@media (max-width:720px){',
    '  .bar{padding:6px 8px}.brand{display:none}',
    '  .backdrop{justify-content:center;padding:var(--rk-s3)}',
    '  .modal{max-width:100%}',
    '}',
    '@media (prefers-reduced-motion: reduce){*{transition:none !important}}'
  ].join('\n');

  return { shadowCss: shadowCss, documentCss: documentCss, LIGHT: LIGHT };
})();
