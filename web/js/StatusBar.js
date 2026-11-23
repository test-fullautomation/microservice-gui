/**
 * @fileoverview Window status bar (#appStatusbar) and the progress line
 * under the navbar (#appProgress).
 *
 * Kept quiet: a dot and a name per connection, a word only when something
 * is wrong (down, starting); the version at the right. What it shows is the
 * user's choice (right-click the bar, or Configuration → Status bar):
 *   connections  Bridge, Consul, Nomad: each mirrors its light in the ribbon
 *                (BridgeControl.js, InfraStatus.js keep polling as before);
 *                a click opens its controls
 *   context      what the current view shows (setContext; the bench sets it)
 *   version      the GUI version, and "dev" on a --dev run (Release.js)
 *
 * Exposes MM.statusBar: { setContext(html), busy(key, on), items(), show(key, on), ITEMS }.
 */
(function () {
  'use strict';

  var MM = window.MicroserviceManager = window.MicroserviceManager || {};
  var KEY = 'mm_statusbar';
  var DEFAULTS = { connections: true, context: false, version: true };
  // What the user can turn on and off, in the menu's order.
  var GROUPS = [
    { key: 'connections', label: 'Connections', hint: 'Bridge, Consul, Nomad' },
    { key: 'context', label: 'View summary', hint: 'e.g. the bench’s components' },
    { key: 'version', label: 'Version', hint: 'and "dev" on a --dev run' }
  ];

  // Ribbon light -> status bar item. `open` runs on a click.
  var LIGHTS = [
    { id: 'bridge', name: 'Bridge', led: 'bridgeLed', text: 'bridgeLabel',
      open: function () { if (MM.showRibbon) MM.showRibbon('user'); } },
    { id: 'consul', name: 'Consul', led: 'infraConsulLed',
      open: function () { click('infraConsulPill'); } },
    { id: 'nomad', name: 'Nomad', led: 'infraNomadLed',
      open: function () { click('infraNomadPill'); } }
  ];
  // Only states that need attention get a word; "up" is the dot alone.
  var STATE_WORD = { up: '', down: 'down', pending: 'starting', unknown: '' };

  var busyKeys = {};
  var menu = null;

  function $(id) { return document.getElementById(id); }
  function click(id) { var b = $(id); if (b) b.click(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ------------------------------------------------------------ what is shown

  function items() {
    var out = Object.assign({}, DEFAULTS);
    try { Object.assign(out, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* defaults */ }
    return out;
  }

  function show(key, on) {
    var now = items();
    if (!(key in DEFAULTS)) return;
    now[key] = !!on;
    try { localStorage.setItem(KEY, JSON.stringify(now)); } catch (e) { /* this session only */ }
    applyItems();
  }

  function applyItems() {
    var bar = $('appStatusbar');
    if (!bar) return;
    var on = items();
    Object.keys(DEFAULTS).forEach(function (k) { bar.classList.toggle('hide-' + k, !on[k]); });
  }

  // ------------------------------------------------------------ lights

  function ledState(led) {
    if (!led) return 'unknown';
    if (led.classList.contains('up')) return 'up';
    if (led.classList.contains('pending')) return 'pending';
    if (led.classList.contains('down')) return 'down';
    return 'unknown';
  }

  function sync(item) {
    var el = $('statusItem-' + item.id);
    var led = $(item.led);
    if (!el) return;
    var st = ledState(led);
    el.className = 'status-item ' + st;
    // The ribbon's own words when it has them ("Bridge running :1112"), else the state.
    var tip = (item.text && $(item.text) && $(item.text).textContent.trim()) ||
              (led && led.getAttribute('title')) || item.name;
    el.title = tip + ' — click for its controls';
    el.querySelector('.st').textContent = STATE_WORD[st];
  }

  // ------------------------------------------------------------ the menu

  function closeMenu() {
    if (menu) { menu.remove(); menu = null; }
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function outside(ev) { if (menu && !menu.contains(ev.target)) closeMenu(); }
  function onKey(ev) { if (ev.key === 'Escape') { ev.preventDefault(); closeMenu(); } }

  function openMenu(x, y) {
    closeMenu();
    var on = items();
    menu = document.createElement('div');
    menu.className = 'status-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = '<div class="status-menu-title">Show in the status bar</div>' +
      GROUPS.map(function (g) {
        return '<label role="menuitemcheckbox" aria-checked="' + !!on[g.key] + '">' +
          '<input type="checkbox" data-k="' + g.key + '"' + (on[g.key] ? ' checked' : '') + '>' +
          '<span><b>' + esc(g.label) + '</b><small>' + esc(g.hint) + '</small></span></label>';
      }).join('') +
      '<button type="button" class="status-menu-more">Configuration…</button>';
    document.body.appendChild(menu);
    // Above the click, inside the window.
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, y - r.height - 6) + 'px';
    menu.addEventListener('change', function (ev) {
      var k = ev.target.getAttribute('data-k');
      if (k) { show(k, ev.target.checked); ev.target.closest('label').setAttribute('aria-checked', String(ev.target.checked)); }
    });
    menu.querySelector('.status-menu-more').addEventListener('click', function () { closeMenu(); click('btnSettings'); });
    var first = menu.querySelector('input');
    if (first) first.focus();
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
  }

  // ------------------------------------------------------------ build

  function build() {
    var bar = $('appStatusbar');
    if (!bar) return;
    bar.innerHTML =
      '<div class="status-left status-connections">' +
      LIGHTS.map(function (it) {
        return '<button type="button" class="status-item unknown" id="statusItem-' + it.id + '">' +
          '<i class="dot" aria-hidden="true"></i><span class="n">' + it.name + '</span>' +
          '<span class="st"></span></button>';
      }).join('') +
      '</div>' +
      '<div class="status-context" id="statusContext"></div>' +
      '<div class="status-right status-version"><span id="statusVersion"></span></div>';

    LIGHTS.forEach(function (it) {
      $('statusItem-' + it.id).addEventListener('click', it.open);
      var watch = [$(it.led), it.text && $(it.text)].filter(Boolean);
      var obs = new MutationObserver(function () { sync(it); });
      watch.forEach(function (node) {
        obs.observe(node, { attributes: true, attributeFilter: ['class', 'title'],
                            childList: true, characterData: true, subtree: true });
      });
      sync(it);
    });

    bar.title = 'Right-click to choose what the status bar shows';
    bar.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      openMenu(ev.clientX, ev.clientY);
    });

    var dev = MM.release && MM.release.dev;
    fetch('version.json').then(function (r) { return r.json(); }).then(function (v) {
      $('statusVersion').innerHTML = esc(v && v.version ? 'v' + v.version : '') +
        (dev ? ' <span class="status-dev" title="Started with --dev: unreleased features are shown">dev</span>' : '');
    }).catch(function () {
      if (dev) $('statusVersion').innerHTML = '<span class="status-dev">dev</span>';
    });
    applyItems();
  }

  /** What the current view shows; '' or null clears it. Trusted HTML. */
  function setContext(html) {
    var el = $('statusContext');
    if (el) el.innerHTML = html || '';
  }

  /** Show the progress line while any key is busy. */
  function busy(key, on) {
    if (on) busyKeys[key] = true; else delete busyKeys[key];
    var line = $('appProgress');
    if (line) line.hidden = !Object.keys(busyKeys).length;
  }

  MM.statusBar = { setContext: setContext, busy: busy, items: items, show: show, ITEMS: GROUPS };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
