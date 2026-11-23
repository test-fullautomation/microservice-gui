/**
 * @fileoverview Light / dark theme. Loaded in <head>, before the page
 * paints, so it never flashes the other theme.
 *
 * Sets on <html>:
 *   data-theme="light|dark"     the tokens in css/theme.css; sandboxed
 *                               frames get the new tokens (frame-host.js)
 *   data-bs-theme="light|dark"  Bootstrap 5.3's own colour mode
 *
 * The choice (light, dark or system) is per user, in localStorage;
 * "system" follows the OS and changes with it. The chrome (navbar, sidebar,
 * ribbon, status bar) is dark in both themes.
 *
 * Exposes MM.theme: { get(), set(mode), resolved(), toggle(), onChange(fn) }.
 */
(function () {
  'use strict';

  var MM = window.MicroserviceManager = window.MicroserviceManager || {};
  var KEY = 'mm_theme';
  var MODES = ['light', 'dark', 'system'];
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var listeners = [];

  function get() {
    try {
      var v = localStorage.getItem(KEY);
      if (MODES.indexOf(v) >= 0) return v;
    } catch (e) { /* storage unavailable */ }
    return 'light';
  }

  function resolved() {
    var m = get();
    if (m === 'system') return mq && mq.matches ? 'dark' : 'light';
    return m;
  }

  function apply() {
    var t = resolved();
    var root = document.documentElement;
    if (root.getAttribute('data-theme') === t) return;
    root.setAttribute('data-theme', t);
    root.setAttribute('data-bs-theme', t);
    listeners.forEach(function (fn) { try { fn(t); } catch (e) { /* a listener's problem */ } });
  }

  function set(mode) {
    if (MODES.indexOf(mode) < 0) return;
    try { localStorage.setItem(KEY, mode); } catch (e) { /* this session only */ }
    apply();
  }

  /** Light <-> dark (leaves "system" for an explicit choice). */
  function toggle() { set(resolved() === 'dark' ? 'light' : 'dark'); }

  function onChange(fn) { listeners.push(fn); }

  if (mq) {
    var follow = function () { if (get() === 'system') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', follow);
    else if (mq.addListener) mq.addListener(follow);
  }

  MM.theme = { get: get, set: set, resolved: resolved, toggle: toggle, onChange: onChange };
  apply();

  // The sun/moon at the foot of the nav rail.
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('railTheme');
    if (!btn) return;
    var show = function () {
      var dark = resolved() === 'dark';
      var icon = btn.querySelector('i');
      if (icon) icon.className = 'bi ' + (dark ? 'bi-sun' : 'bi-moon');
      btn.title = dark ? 'Light theme' : 'Dark theme';
      btn.setAttribute('aria-label', btn.title);
    };
    btn.addEventListener('click', toggle);
    onChange(show);
    show();
  });
})();
