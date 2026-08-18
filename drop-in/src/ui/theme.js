// Canonical visual tokens shared by the drop-in, injected extension chrome and
// the extension-owned local-document workspace.
Ryker.theme = (function () {
  'use strict';

  var tokens = {
    bg: '#ffffff', bg2: '#f5f6f8', bg3: '#eceef2',
    fg: '#16181d', fg2: '#3f4551', muted: '#6b7280',
    line: '#e2e5ea', line2: '#cfd4dc', field: '#ffffff',
    accent: '#4f46e5', accentFg: '#ffffff', accentSoft: 'rgba(79,70,229,.10)',
    active: '#e1e5ea', activeLine: '#aeb5bf', onactive: '#20242b',
    warn: '#b45309', onwarn: '#ffffff', warnSoft: 'rgba(180,83,9,.10)',
    ok: '#15803d', onok: '#ffffff', okSoft: 'rgba(21,128,61,.10)',
    danger: '#be123c', dangerSoft: 'rgba(190,18,60,.09)',
    // The brand red is the primary action colour. brandInk is what reads on
    // top of it and brandStrong is its pressed and hovered shade, so a primary
    // button is the brand rather than an approximation of it.
    brand: '#e5383b', brandInk: '#ffffff', brandStrong: '#c42b2e',
    ring: 'rgba(79,70,229,.35)',
    shadowMd: '0 1px 2px rgba(16,20,30,.06),0 4px 12px rgba(16,20,30,.08)',
    shadowXl: '0 8px 24px rgba(16,20,30,.12),0 24px 56px rgba(16,20,30,.16)',
    font: 'system-ui,sans-serif', mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    // One corner language across every Ryker surface. Component names remain
    // for compatibility, but none of them is allowed to drift into a pill or
    // a softer modal radius.
    rSm: '4px', rMd: '4px', rLg: '4px', rXl: '4px',
    s1: '4px', s2: '8px', s3: '12px', s4: '16px', s5: '20px', s6: '24px'
  };

  var names = {
    bg: 'bg', bg2: 'bg2', bg3: 'bg3', fg: 'fg', fg2: 'fg2', muted: 'muted',
    line: 'line', line2: 'line2', field: 'field', accent: 'accent', accentFg: 'accent-fg',
    accentSoft: 'accent-soft', active: 'active', activeLine: 'active-line',
    onactive: 'onactive', warn: 'warn', onwarn: 'onwarn', warnSoft: 'warn-soft',
    ok: 'ok', onok: 'onok', okSoft: 'ok-soft', danger: 'danger', dangerSoft: 'danger-soft',
    brand: 'brand-color', brandInk: 'brand-ink', brandStrong: 'brand-strong',
    ring: 'ring', shadowMd: 'sh-md', shadowXl: 'sh-xl',
    font: 'font', mono: 'mono', rSm: 'r-sm', rMd: 'r-md', rLg: 'r-lg', rXl: 'r-xl',
    s1: 's1', s2: 's2', s3: 's3', s4: 's4', s5: 's5', s6: 's6'
  };

  var cssText = Object.keys(tokens).map(function (key) {
    // Custom-property declarations still need separators. Without the
    // semicolon the browser parses the entire token stream as the value of the
    // first property, so layout rules work while every var(--rk-*) paint rule
    // becomes invalid. The result is structurally present, transparent chrome
    // with inherited black text: particularly invisible on a dark host page.
    return '--rk-' + names[key] + ':' + tokens[key] + ';';
  }).join('');

  function apply(node) {
    node = node || document.documentElement;
    Object.keys(tokens).forEach(function (key) {
      node.style.setProperty('--rk-' + names[key], tokens[key]);
    });
    return node;
  }

  return { tokens: tokens, cssText: cssText, apply: apply };
})();
