// Startup (AutoStart.js): the order of its steps, what it skips, where it
// stops, and the Settings section that drives it. The bridge, Consul and
// Nomad calls are answered in the page, so nothing is started on the
// machine: the real ports (8500, 4646) may belong to the user's agents.
// Job files are real files in a temporary folder.
'use strict';

const fs = require('fs');
const path = require('path');
const { probe } = require('./harness');

// Installed in the page: every bridge-side call AutoStart makes, recorded
// in window.__calls and answered from window.__up.
const FAKES = `(function () {
  var MM = window.MicroserviceManager;
  window.__calls = [];
  window.__up = { bridge: false, consul: false, nomad: false };
  window.__consulStart = { success: true, message: 'started' };
  var rec = function (c) { window.__calls.push(c); };
  MM.bridgeControl.isUp = function () { return Promise.resolve(window.__up.bridge); };
  MM.bridgeControl.start = function () { rec('bridge start'); window.__up.bridge = true; return Promise.resolve(true); };
  MM.consulClient.testConnection = function () { return Promise.resolve({ ok: window.__up.consul }); };
  MM.consulClient.configure = function () { return Promise.resolve({}); };
  MM.consulClient.startAgent = function (o) {
    rec('consul start ' + o.mode + ' ' + o.bind_addr + ':' + o.http_port);
    if (window.__consulStart.success) window.__up.consul = true;
    return Promise.resolve(window.__consulStart);
  };
  MM.nomadClient.configure = function (u) { rec('nomad at ' + u); return Promise.resolve({}); };
  MM.nomadClient.testConnection = function () { return Promise.resolve({ ok: window.__up.nomad }); };
  MM.nomadClient.startAgent = function (o) { rec('nomad start ' + o.mode + ' :' + o.http_port); window.__up.nomad = true; return Promise.resolve({ success: true }); };
  MM.nomadClient.submitJob = function (content, fmt) {
    rec('job ' + fmt + ' ' + content.split('\\n')[0]);
    return Promise.resolve({ success: true, job_id: 'x' });
  };
  MM.addConsulConnection = function (u) { rec('sidebar ' + u); return Promise.resolve(); };
  return true;
})()`;

function reset(up) {
  return `window.__calls = []; window.__up = ${JSON.stringify(up)}; ` +
         `window.__consulStart = { success: true, message: 'started' }; true`;
}

function run(settings) {
  return `MicroserviceManager.autoStart.run(${JSON.stringify(settings)})`;
}

probe('GUI probe: startup', async (t) => {
  const dir = t.tempDir('mm-autostart-');
  const folder = path.join(dir, 'jobs');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'b_relay.hcl'), 'job "b_relay" {}\n');
  fs.writeFileSync(path.join(folder, 'a_power.nomad'), 'job "a_power" {}\n');
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'not a job\n');
  const single = path.join(dir, 'c_single.hcl');
  fs.writeFileSync(single, 'job "c_single" {}\n');
  const asJson = path.join(dir, 'd.json.nomad');
  fs.writeFileSync(asJson, '{"Job": {"ID": "d"}}');
  const missing = path.join(dir, 'missing.hcl');
  const empty = t.tempDir('mm-autostart-empty-');

  const g = await t.open({});
  t.check('the probe opened the GUI without running its startup (DASGUI_NO_AUTOSTART)',
    (await g.js('window.electronAPI.autoStartDisabled()')) === true);
  await g.js(FAKES);

  // Nothing asked for
  await g.js(reset({ bridge: false, consul: false, nomad: false }));
  let r = await g.js(run({}));
  t.check('nothing turned on: nothing runs', r.ran === false && (await g.js('window.__calls.length')) === 0, r);

  // Everything, nothing running yet
  await g.js(reset({ bridge: false, consul: false, nomad: false }));
  r = await g.js(run({ autoStartBridge: true, autoStartConsul: true, autoStartNomad: true,
                       autoStartJobs: [folder, single, asJson] }));
  let calls = await g.js('window.__calls');
  const order = calls.filter((c) => !/^nomad at /.test(c));
  t.check('all on: bridge, Consul, sidebar, Nomad, then the jobs in order', JSON.stringify(order) === JSON.stringify([
    'bridge start',
    'consul start dev 127.0.0.1:8500',
    'sidebar http://127.0.0.1:8500',
    'nomad start dev :4646',
    'job hcl job "a_power" {}',
    'job hcl job "b_relay" {}',
    'job hcl job "c_single" {}',
    'job json {"Job": {"ID": "d"}}',
  ]), calls);
  t.check('all on: a folder takes only its .hcl and .nomad files', !calls.some((c) => /not a job/.test(c)), calls);
  t.check('all on: reports ready', r.ran && r.ok && /Nomad, 4 job\(s\)/.test(r.message), r);
  t.check('all on: jobs go to the Nomad it started', calls.filter((c) => /^nomad at /.test(c)).every((c) => c === 'nomad at http://127.0.0.1:4646'), calls);

  // Everything already up: nothing is started twice
  await g.js(reset({ bridge: true, consul: true, nomad: true }));
  r = await g.js(run({ autoStartBridge: true, autoStartConsul: true, autoStartNomad: true, autoStartJobs: [single] }));
  calls = await g.js('window.__calls');
  t.check('already up: no bridge, Consul or Nomad started', !calls.some((c) => / start/.test(c)), calls);
  t.check('already up: still listed in the sidebar and the job runs',
    calls.includes('sidebar http://127.0.0.1:8500') && calls.includes('job hcl job "c_single" {}') && r.ok, calls);

  // Consul cannot start: the rest does not run
  await g.js(reset({ bridge: true, consul: false, nomad: false }));
  await g.js("window.__consulStart = { success: false, message: 'Consul binary not found' }; true");
  r = await g.js(run({ autoStartConsul: true, autoStartNomad: true, autoStartJobs: [single] }));
  calls = await g.js('window.__calls');
  t.check('Consul fails: stops with its reason', !r.ok && /Consul binary not found/.test(r.message), r);
  t.check('Consul fails: no Nomad, no jobs', !calls.some((c) => /^nomad start|^job /.test(c)), calls);

  // Jobs only, and no Nomad to run them on
  await g.js(reset({ bridge: false, consul: false, nomad: false }));
  r = await g.js(run({ autoStartJobs: [single] }));
  calls = await g.js('window.__calls');
  t.check('jobs without Nomad: the bridge still starts first', calls[0] === 'bridge start', calls);
  t.check('jobs without Nomad: says no Nomad answers', !r.ok && /No Nomad answers/.test(r.message), r);
  t.check('jobs without Nomad: nothing submitted', !calls.some((c) => /^job /.test(c)), calls);

  // Jobs only, on the Nomad the Nomad tab last connected to
  await g.js(reset({ bridge: true, consul: false, nomad: true }));
  await g.js("localStorage.setItem('mm_nomad_url', 'http://10.0.0.5:4646'); true");
  r = await g.js(run({ autoStartJobs: [single] }));
  calls = await g.js('window.__calls');
  t.check('jobs only: run on the Nomad the Nomad tab last used', r.ok && calls.includes('nomad at http://10.0.0.5:4646'), calls);
  await g.js("localStorage.removeItem('mm_nomad_url'); true");

  // A missing file or an empty folder is reported, the other jobs still run
  await g.js(reset({ bridge: true, consul: false, nomad: true }));
  r = await g.js(run({ autoStartNomad: true, autoStartJobs: [missing, empty, single] }));
  calls = await g.js('window.__calls');
  t.check('bad entries: the good job still runs', calls.includes('job hcl job "c_single" {}'), calls);
  t.check('bad entries: both named in the report',
    !r.ok && r.message.includes('missing.hcl: not found') && r.message.includes('no .hcl or .nomad files'), r);

  // Settings: the Startup section shows what settings.json holds
  await g.js(`Object.assign(MicroserviceManager.getSettings(), { autoStartBridge: true, autoStartConsul: false,
    autoStartNomad: true, autoStartJobs: ${JSON.stringify([folder, single])} }); true`);
  await g.click('#btnSettings');
  t.check('settings: Startup section shown', await g.waitForSelector('#settingAutoJobs', 3000));
  t.check('settings: the boxes match the settings',
    (await g.js("[document.getElementById('settingAutoBridge').checked, document.getElementById('settingAutoConsul').checked, document.getElementById('settingAutoNomad').checked].join()")) === 'true,false,true');
  t.check('settings: one job entry per line',
    (await g.js("document.getElementById('settingAutoJobs').value")) === folder + '\n' + single);
  t.check('settings: Add file and Add folder offered', await g.visible('#btnAddJobFile') && await g.visible('#btnAddJobFolder'));
});
