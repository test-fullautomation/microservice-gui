/**
 * @fileoverview Released features: what the GUI shows without --dev.
 *
 * The GUI started normally (the "DevAtServGUI" icon) shows only the
 * features marked released below. Started with --dev (the "DevAtServGUI
 * (dev)" icon, `devatservgui --dev`, or DASGUI_DEV=1) it shows everything,
 * so features can be stabilized and reviewed before they are released.
 * A browser-hosted GUI takes ?dev=1 in its address instead.
 *
 * Releasing a feature = setting it to true here, in a reviewed PR.
 *
 * The view roles (Settings -> View: user, admin, developer) still apply on
 * top: a released feature is shown to the roles it belongs to. Without
 * --dev, an unreleased area stays hidden whatever the role says. Hiding is
 * not access control: the bridge still answers every endpoint.
 *
 * Exposes MM.release: { dev, released(id), allows(id), list() }.
 */
(function () {
  'use strict';

  var MM = window.MicroserviceManager = window.MicroserviceManager || {};

  // id -> { released, what }. Always shown, not listed: the Services view
  // (service list, each service's GUI, tiles / service window), the Bench,
  // Startup, Settings and Help.
  var FEATURES = {
    admin: {
      released: false,
      what: 'Administrator tab: Consul and Nomad dashboards, plugin allow-list, fleet'
    },
    developer: {
      released: false,
      what: 'Developer tab and inspector: Service Creator, API Explorer, code examples, ' +
            'test projects and the other plugin views'
    }
  };

  var dev = (function () {
    try {
      if (window.electronAPI && typeof window.electronAPI.isDevRun === 'function') {
        return !!window.electronAPI.isDevRun();
      }
      var q = new URLSearchParams(window.location.search).get('dev');
      return q === '1' || q === 'true';
    } catch (e) {
      return false;
    }
  })();

  MM.release = {
    /** True when started with --dev: every feature is shown. */
    dev: dev,
    /** Whether feature `id` is released (unknown ids are). */
    released: function (id) { return !FEATURES[id] || !!FEATURES[id].released; },
    /** Whether feature `id` may be shown in this run. */
    allows: function (id) { return dev || this.released(id); },
    /** [{ id, released, what }] for Help / About and the docs. */
    list: function () {
      return Object.keys(FEATURES).map(function (id) {
        return { id: id, released: FEATURES[id].released, what: FEATURES[id].what };
      });
    }
  };
})();
