/**
 * @fileoverview Command palette (Ctrl+K) and the window's keyboard shortcuts.
 *
 * The palette lists what the window can do right now, read from the page
 * each time it opens, so it never drifts from the buttons:
 *   views        the left pane's view switch (Services, Bench)
 *   ribbon       every enabled ribbon button of the tabs this user sees,
 *                including the groups components add
 *   window       settings, user guide, report issue, pin the ribbon
 *   theme        light, dark, system (js/Theme.js)
 *   services     the services in the sidebar
 *   bench        the components on the shown bench
 * Running a command clicks the same button a mouse would.
 *
 * Shortcuts: Ctrl+K / Ctrl+Shift+P palette, Ctrl+1 Services, Ctrl+2 Bench,
 * Ctrl+, Settings, F1 user guide. Keys pressed inside a component's
 * sandboxed frame stay in that frame.
 *
 * Exposes MM.commandPalette: { open(), close(), commands() }.
 */
(function () {
  'use strict';

  var MM = window.MicroserviceManager = window.MicroserviceManager || {};
  var RECENT_KEY = 'mm_cmdk_recent';
  var MAX_SHOWN = 60;

  var els = null;
  var shown = [];      // the commands in the list, in order
  var active = 0;
  var lastFocus = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function isMac() { return /Mac/.test(navigator.platform || ''); }
  function modKey() { return isMac() ? '⌘' : 'Ctrl'; }

  function visible(el) {
    return !!el && getComputedStyle(el).display !== 'none' && !el.closest('[hidden]');
  }
  function click(id) { var b = $(id); if (b) b.click(); }
  /** A button's name: its first span with text (not a status light), else its label or title. */
  function textOf(el) {
    var t = '';
    Array.prototype.some.call(el.querySelectorAll('span'), function (s) {
      t = s.textContent.trim();
      return !!t;
    });
    t = t || el.getAttribute('aria-label') || el.title || el.textContent || '';
    return t.replace(/\s+/g, ' ').trim();
  }

  // ------------------------------------------------------------ commands

  function goView(mode) {
    var tab = document.querySelector('#sidebarSwitch .sidebar-switch-tab[data-mode="' + mode + '"]');
    if (tab) tab.click();
  }

  function viewCommands() {
    var keys = { services: '1', bench: '2' };
    return Array.prototype.map.call(document.querySelectorAll('#sidebarSwitch .sidebar-switch-tab[data-mode]'), function (tab) {
      var mode = tab.getAttribute('data-mode');
      if (!visible(tab)) return null;
      return { section: 'View', label: 'Go to ' + textOf(tab), icon: (tab.querySelector('i') || {}).className,
               kbd: keys[mode] ? modKey() + ' ' + keys[mode] : '', run: function () { goView(mode); } };
    }).filter(Boolean);
  }

  function ribbonCommands() {
    var out = [];
    document.querySelectorAll('#ribbon .ribbon-panel').forEach(function (panel) {
      var tab = $(panel.getAttribute('aria-labelledby'));
      // The User tab is always there; the others only for the roles this user has.
      if (panel.id !== 'ribbonUser' && (!tab || getComputedStyle(tab).display === 'none')) return;
      var tabName = tab ? tab.textContent.replace(/\s+/g, ' ').trim() : 'User';
      panel.querySelectorAll('button').forEach(function (btn) {
        if (btn.disabled || getComputedStyle(btn).display === 'none') return;
        var label = textOf(btn);
        if (!label) return;
        if (btn.classList.contains('infra-pill')) label = 'Open ' + label;
        var group = btn.closest('.ribbon-group');
        var groupLabel = group && group.querySelector('.ribbon-group-label');
        out.push({ section: tabName, label: label,
                   hint: groupLabel ? groupLabel.textContent.trim() : '',
                   icon: (btn.querySelector('i') || {}).className,
                   run: function () { btn.click(); } });
      });
    });
    return out;
  }

  function windowCommands() {
    var list = [
      { id: 'btnSettings', label: 'Configuration (settings)', icon: 'bi bi-gear', kbd: modKey() + ' ,' },
      { id: 'btnHelp', label: 'User guide', icon: 'bi bi-question-circle', kbd: 'F1' },
      { id: 'btnReportIssue', label: 'Report an issue', icon: 'bi bi-bug' },
      { id: 'btnRibbonToggle', label: null, icon: 'bi bi-pin-angle' }
    ];
    return list.filter(function (c) { return visible($(c.id)); }).map(function (c) {
      return { section: 'Window', label: c.label || $(c.id).title || 'Pin the ribbon', icon: c.icon,
               kbd: c.kbd || '', run: function () { click(c.id); } };
    });
  }

  function themeCommands() {
    if (!MM.theme) return [];
    var now = MM.theme.get();
    return [['light', 'Light', 'bi bi-sun'], ['dark', 'Dark', 'bi bi-moon'], ['system', 'Follow the system', 'bi bi-circle-half']]
      .map(function (t) {
        return { section: 'Theme', label: 'Theme: ' + t[1], icon: t[2], hint: now === t[0] ? 'current' : '',
                 run: function () { MM.theme.set(t[0]); } };
      });
  }

  function serviceCommands() {
    var seen = {};
    return Array.prototype.map.call(document.querySelectorAll('#servicesList .list-group-item[data-service-name]'), function (item) {
      var name = item.getAttribute('data-service-name');
      if (!name || seen[name]) return null;
      seen[name] = true;
      return { section: 'Services', label: 'Open ' + name, icon: 'bi bi-box-seam',
               run: function () { goView('services'); item.click(); } };
    }).filter(Boolean);
  }

  function benchCommands() {
    var b = MM.endo && MM.endo.bench;
    if (!b || !b.components || !b.focus) return [];
    return b.components().map(function (m) {
      return { section: 'Bench', label: 'Show ' + (m.title || m.id), hint: m.state === 'ok' ? m.service || '' : m.state,
               icon: 'bi bi-grid-1x2', run: function () { goView('bench'); b.focus(m.id); } };
    });
  }

  function commands() {
    var all = [].concat(viewCommands(), ribbonCommands(), benchCommands(), serviceCommands(),
                        windowCommands(), themeCommands());
    all.forEach(function (c) { c.key = c.section + ': ' + c.label; });
    return all;
  }

  // ------------------------------------------------------------ matching

  /** Higher is better; -1 = no match. Every word must match, as a substring or in order. */
  function score(query, c) {
    var hay = (c.label + ' ' + (c.hint || '') + ' ' + c.section).toLowerCase();
    var words = query.toLowerCase().split(/\s+/).filter(Boolean);
    var total = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var at = hay.indexOf(w);
      if (at >= 0) {
        total += 10 + (at === 0 || /[\s:(]/.test(hay[at - 1]) ? 8 : 0) - Math.min(at, 30) / 10;
        continue;
      }
      var j = 0, k = 0;
      while (j < hay.length && k < w.length) { if (hay[j] === w[k]) k++; j++; }
      if (k < w.length) return -1;
      total += 2;
    }
    return total;
  }

  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; }
  }
  function remember(key) {
    try {
      var r = recent().filter(function (k) { return k !== key; });
      r.unshift(key);
      localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 8)));
    } catch (e) { /* storage unavailable */ }
  }

  // ------------------------------------------------------------ the dialog

  function build() {
    if (els) return els;
    var wrap = document.createElement('div');
    wrap.className = 'cmdk-backdrop';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="cmdk" role="dialog" aria-modal="true" aria-label="Commands">' +
      '  <div class="cmdk-search"><i class="bi bi-search" aria-hidden="true"></i>' +
      '    <input type="text" id="cmdkInput" autocomplete="off" spellcheck="false" role="combobox"' +
      '           aria-expanded="true" aria-controls="cmdkList" placeholder="Search commands, views, services…">' +
      '    <kbd>Esc</kbd></div>' +
      '  <ul class="cmdk-list" id="cmdkList" role="listbox"></ul>' +
      '  <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span>' +
      '    <span><kbd>Esc</kbd> close</span></div>' +
      '</div>';
    document.body.appendChild(wrap);
    els = { wrap: wrap, input: wrap.querySelector('#cmdkInput'), list: wrap.querySelector('#cmdkList') };

    wrap.addEventListener('mousedown', function (ev) { if (ev.target === wrap) close(); });
    els.input.addEventListener('input', function () { active = 0; render(); });
    els.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); }
      else if (ev.key === 'PageDown') { ev.preventDefault(); move(8); }
      else if (ev.key === 'PageUp') { ev.preventDefault(); move(-8); }
      else if (ev.key === 'Enter') { ev.preventDefault(); runAt(active); }
      else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
      else if (ev.key === 'Tab') { ev.preventDefault(); }   // focus stays in the dialog
    });
    els.list.addEventListener('mousemove', function (ev) {
      var li = ev.target.closest('li[data-i]');
      if (li && +li.getAttribute('data-i') !== active) { active = +li.getAttribute('data-i'); paintActive(); }
    });
    els.list.addEventListener('click', function (ev) {
      var li = ev.target.closest('li[data-i]');
      if (li) runAt(+li.getAttribute('data-i'));
    });
    return els;
  }

  var all = [];

  function render() {
    var q = els.input.value.trim();
    if (!q) {
      var r = recent();
      var byKey = {};
      all.forEach(function (c) { byKey[c.key] = c; });
      var first = r.map(function (k) { return byKey[k]; }).filter(Boolean)
        .map(function (c) { return Object.assign({}, c, { section: 'Recent' }); });
      shown = first.concat(all.filter(function (c) { return r.indexOf(c.key) < 0; }));
    } else {
      shown = all.map(function (c) { return { c: c, s: score(q, c) }; })
        .filter(function (x) { return x.s >= 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .map(function (x) { return x.c; });
    }
    shown = shown.slice(0, MAX_SHOWN);
    if (active >= shown.length) active = Math.max(0, shown.length - 1);

    if (!shown.length) {
      els.list.innerHTML = '<li class="cmdk-empty">Nothing matches “' + esc(q) + '”.</li>';
      return;
    }
    var html = '';
    var lastSection = null;
    shown.forEach(function (c, i) {
      if (!q && c.section !== lastSection) {
        html += '<li class="cmdk-section" role="presentation">' + esc(c.section) + '</li>';
        lastSection = c.section;
      }
      html += '<li role="option" id="cmdk-opt-' + i + '" data-i="' + i + '">' +
        '<i class="' + esc(c.icon || 'bi bi-dot') + '" aria-hidden="true"></i>' +
        '<span class="l">' + esc(c.label) + '</span>' +
        (c.hint ? '<span class="h">' + esc(c.hint) + '</span>' : '') +
        (q ? '<span class="s">' + esc(c.section) + '</span>' : '') +
        (c.kbd ? '<kbd>' + esc(c.kbd) + '</kbd>' : '') +
        '</li>';
    });
    els.list.innerHTML = html;
    paintActive();
  }

  function paintActive() {
    els.list.querySelectorAll('li[data-i]').forEach(function (li) {
      var on = +li.getAttribute('data-i') === active;
      li.classList.toggle('active', on);
      li.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        els.input.setAttribute('aria-activedescendant', li.id);
        li.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function move(d) {
    if (!shown.length) return;
    active = Math.max(0, Math.min(shown.length - 1, active + d));
    paintActive();
  }

  function runAt(i) {
    var c = shown[i];
    if (!c) return;
    close();
    remember(c.key);
    // After the dialog is gone, so a command that opens a modal gets the focus.
    setTimeout(function () {
      try { c.run(); } catch (e) {
        if (MM.showToast) MM.showToast('Command failed', c.label + ': ' + e.message, 'error');
      }
    }, 0);
  }

  function open() {
    build();
    all = commands();
    lastFocus = document.activeElement;
    els.input.value = '';
    active = 0;
    els.wrap.hidden = false;
    document.body.classList.add('cmdk-open');
    render();
    els.input.focus();
  }

  function close() {
    if (!els || els.wrap.hidden) return;
    els.wrap.hidden = true;
    document.body.classList.remove('cmdk-open');
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) {
      try { lastFocus.focus(); } catch (e) { /* gone */ }
    }
  }

  function isOpen() { return !!els && !els.wrap.hidden; }

  // ------------------------------------------------------------ shortcuts

  document.addEventListener('keydown', function (ev) {
    var mod = ev.ctrlKey || ev.metaKey;
    var key = ev.key;
    if (mod && !ev.altKey && ((key === 'k' || key === 'K') && !ev.shiftKey || (key === 'P' || key === 'p') && ev.shiftKey)) {
      ev.preventDefault();
      if (isOpen()) close(); else if (!document.body.classList.contains('modal-open')) open();
      return;
    }
    // The others: not over a dialog, and not while the palette is open.
    if (isOpen() || document.body.classList.contains('modal-open')) return;
    if (mod && !ev.shiftKey && !ev.altKey && (key === '1' || key === '2')) {
      ev.preventDefault();
      goView(key === '1' ? 'services' : 'bench');
    } else if (mod && key === ',') {
      ev.preventDefault();
      click('btnSettings');
    } else if (key === 'F1' && !mod) {
      ev.preventDefault();
      click('btnHelp');
    }
  }, true);

  document.addEventListener('DOMContentLoaded', function () {
    var btn = $('btnCommandPalette');
    if (btn) {
      btn.addEventListener('click', open);
      var k = btn.querySelector('kbd');
      if (k) k.textContent = modKey() + ' K';
    }
  });

  MM.commandPalette = { open: open, close: close, commands: commands };
})();
