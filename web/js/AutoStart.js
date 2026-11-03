/**
 * @fileoverview Startup: bring up what the GUI needs when it opens, so the
 * services are ready to use without clicking through Bridge, Consul and
 * Nomad first.
 *
 * Settings (settings.json, the Startup section of the Settings dialog):
 *   autoStartBridge  - start the bridge
 *   autoStartConsul  - start a local Consul dev agent (127.0.0.1:8500)
 *   autoStartNomad   - start a local Nomad dev agent (127.0.0.1:4646)
 *   autoStartJobs    - Nomad job files, or folders of them, to run
 *
 * Steps run in that order, and each one that is already up (an agent left
 * running by the last session, or started some other way) is used as it
 * is. Consul, Nomad and the jobs all go through the bridge, so any of them
 * also starts it. The first step that fails stops the rest, with the same
 * error the manual button would show. Nothing is stopped when the GUI
 * closes, as with the bridge today.
 *
 * Electron only: in a browser the bridge serves the page and has no
 * settings file to read. DASGUI_NO_AUTOSTART=1 opens the GUI without
 * running it.
 *
 * IIFE attaching to MM.autoStart.
 *
 * @version 1.0.0
 */

(function () {
  'use strict';

  var MM = window.MicroserviceManager;

  var CONSUL_URL = 'http://127.0.0.1:8500';
  var NOMAD_URL  = 'http://127.0.0.1:4646';

  var _running = null;   // the run in progress, so a second call joins it

  function _isElectron() {
    return typeof window.electronAPI === 'object' && window.electronAPI !== null;
  }

  function _toast(text, level) {
    MM.showToast('Startup', text, level || 'info');
  }

  function _sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Ask check() every 2 s until it resolves true, for up to timeoutMs.
  function _waitFor(check, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    function tick() {
      return Promise.resolve()
        .then(check)
        .catch(function () { return false; })
        .then(function (ok) {
          if (ok) return true;
          if (Date.now() >= deadline) return false;
          return _sleep(2000).then(tick);
        });
    }
    return tick();
  }

  // A step that fails stops the run; its message is what the user sees.
  function _stop(message) {
    var e = new Error(message);
    e.startupStep = true;
    throw e;
  }

  // ---- Steps ---------------------------------------------------------------

  function _bridge() {
    return MM.bridgeControl.isUp().then(function (up) {
      if (up) return;
      _toast('Starting the bridge...');
      // A failure has its own dialog with launcher.log already.
      return MM.bridgeControl.start().then(function (ok) {
        if (!ok) _stop('The bridge did not start.');
      });
    });
  }

  function _consulUp() {
    return MM.consulClient.testConnection(CONSUL_URL)
      .then(function (data) { return !!(data && data.ok); });
  }

  function _consul(settings) {
    return _consulUp().then(function (up) {
      if (up) return false;
      _toast('Starting Consul...');
      return MM.consulClient.startAgent({
        mode: 'dev',
        consul_path: settings.consulPath || 'consul',
        http_port: 8500,
        bind_addr: '127.0.0.1',
        datacenter: 'dc1'
      }).then(function (data) {
        if (!data || !data.success) {
          _stop('Consul did not start: ' + ((data && data.message) || 'no answer'));
        }
        return _waitFor(_consulUp, 20000).then(function (ok) {
          if (!ok) _stop('Consul started but does not answer at ' + CONSUL_URL + '.');
          return true;
        });
      });
    }).then(function (started) {
      MM.consulClient.configure(CONSUL_URL).catch(function () {});
      if (MM.consulDashboard && MM.consulDashboard.adopt) {
        MM.consulDashboard.adopt(CONSUL_URL, started);
      }
      // The Services sidebar lists what this Consul knows; the jobs'
      // services appear there as they register.
      if (MM.addConsulConnection) {
        return MM.addConsulConnection(CONSUL_URL).catch(function () {});
      }
    });
  }

  function _nomadUp(url) {
    return MM.nomadClient.configure(url)
      .then(function () { return MM.nomadClient.testConnection(); })
      .then(function (data) { return !!(data && data.ok); });
  }

  function _nomad(settings) {
    return _nomadUp(NOMAD_URL).then(function (up) {
      if (up) return false;
      _toast('Starting Nomad...');
      return MM.nomadClient.startAgent({
        mode: 'dev',
        nomad_path: settings.nomadPath || 'nomad',
        http_port: 4646
      }).then(function (data) {
        if (!data || !data.success) {
          _stop('Nomad did not start: ' + ((data && data.message) || 'no answer'));
        }
        return _waitFor(function () { return _nomadUp(NOMAD_URL); }, 30000).then(function (ok) {
          if (!ok) _stop('Nomad started but does not answer at ' + NOMAD_URL + '.');
          return true;
        });
      });
    }).then(function (started) {
      if (MM.nomadDashboard && MM.nomadDashboard.adopt) {
        MM.nomadDashboard.adopt(NOMAD_URL, started);
      }
    });
  }

  // Nomad must be up: the one started above, or else the one the Nomad tab
  // last connected to.
  function _jobs(entries, nomadStarted) {
    var url = NOMAD_URL;
    if (!nomadStarted) {
      try { url = localStorage.getItem('mm_nomad_url') || NOMAD_URL; } catch (e) {}
    }
    return _nomadUp(url)
      .catch(function () { return false; })
      .then(function (up) {
        if (!up) _stop('No Nomad answers at ' + url + ' to run the jobs. Turn on "Start Nomad" in Settings, or start it on the Nomad tab.');
        return window.electronAPI.readJobFiles(entries);
      })
      .then(function (files) {
        var failed = [];
        var done = 0;
        // One at a time, in the order given: a later job may need an
        // earlier one's service.
        return files.reduce(function (chain, f) {
          return chain.then(function () {
            if (f.error) { failed.push(f.path + ': ' + f.error); return; }
            var fmt = /^\s*\{/.test(f.content) ? 'json' : 'hcl';
            return MM.nomadClient.submitJob(f.content, fmt)
              .then(function (data) {
                if (data && data.success) { done++; return; }
                failed.push(f.path + ': ' + ((data && data.message) || 'not accepted'));
              })
              .catch(function (err) { failed.push(f.path + ': ' + (err.message || err)); });
          });
        }, Promise.resolve()).then(function () {
          return { done: done, failed: failed };
        });
      });
  }

  // ---- Run -----------------------------------------------------------------

  function _wanted(settings) {
    var jobs = (settings.autoStartJobs || []).filter(function (j) { return String(j || '').trim(); });
    return {
      bridge: !!settings.autoStartBridge,
      consul: !!settings.autoStartConsul,
      nomad:  !!settings.autoStartNomad,
      jobs:   jobs
    };
  }

  /**
   * Run the startup steps the settings ask for. Resolves to
   * { ran: boolean, ok: boolean, message?: string }.
   */
  function run(settings) {
    if (_running) return _running;
    if (!_isElectron()) return Promise.resolve({ ran: false, ok: true });

    var load = settings
      ? Promise.resolve(settings)
      : Promise.resolve(window.electronAPI.loadSettings()).catch(function () { return {}; });

    _running = load.then(function (s) {
      s = s || {};
      var want = _wanted(s);
      if (!want.bridge && !want.consul && !want.nomad && !want.jobs.length) {
        return { ran: false, ok: true };
      }
      var nomadStarted = false;
      return _bridge()
        .then(function () { if (want.consul) return _consul(s); })
        .then(function () {
          if (!want.nomad) return;
          return _nomad(s).then(function () { nomadStarted = true; });
        })
        .then(function () {
          if (!want.jobs.length) return null;
          _toast('Running ' + want.jobs.length + ' job entr' + (want.jobs.length === 1 ? 'y' : 'ies') + '...');
          return _jobs(want.jobs, nomadStarted);
        })
        .then(function (jobs) {
          if (jobs && jobs.failed.length) {
            var msg = jobs.done + ' job(s) running, ' + jobs.failed.length + ' failed: ' + jobs.failed.join('; ');
            _toast(msg, 'danger');
            return { ran: true, ok: false, message: msg };
          }
          var parts = ['bridge'];
          if (want.consul) parts.push('Consul');
          if (want.nomad) parts.push('Nomad');
          if (jobs) parts.push(jobs.done + ' job(s)');
          var done = 'Ready: ' + parts.join(', ') + '.';
          _toast(done, 'success');
          return { ran: true, ok: true, message: done };
        })
        .catch(function (err) {
          var msg = (err && err.message) || String(err);
          // The bridge reports its own failure in a dialog.
          if (!(err && err.startupStep && /^The bridge/.test(msg))) _toast(msg, 'danger');
          return { ran: true, ok: false, message: msg };
        });
    }).then(function (result) {
      _running = null;
      return result;
    });
    return _running;
  }

  MM.autoStart = { run: run };

  function _init() {
    if (!_isElectron()) return;
    // DASGUI_NO_AUTOSTART=1 opens the GUI without it.
    if (window.electronAPI.autoStartDisabled && window.electronAPI.autoStartDisabled()) return;
    // Let the page settle (bridge LED, saved Consul reconnects) first.
    setTimeout(function () { run(); }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
