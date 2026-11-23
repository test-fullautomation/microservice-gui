// Released features: without --dev the GUI shows only what web/js/Release.js
// marks released, whatever the view role says; with --dev it shows all.
// No bridge needed.
'use strict';

const { probe } = require('./harness');

probe('GUI probe: released features and --dev', async (t) => {
  // Released only (the normal icon): no Developer, no Administrator, even
  // with every role configured.
  process.env.DASGUI_DEV = '0';
  let g = await t.open({ query: { view: 'all' } });
  t.check('released: MM.release.dev is false', (await g.js('MicroserviceManager.release.dev')) === false);
  t.check('released: Services tab shown', await g.visible('#btnModeServices'));
  t.check('released: Developer tab hidden', !(await g.visible('#btnDevTools')));
  t.check('released: Administrator tab hidden', !(await g.visible('#btnAdminTools')));
  t.check('released: view capped to "user"', (await g.js('MicroserviceManager.getView()')) === 'user');
  await g.js("MicroserviceManager.switchMode('testproject'); true");
  t.check('released: test projects refused', !(await g.js("document.getElementById('sidebarTestProject').classList.contains('active')")));
  await g.js("MicroserviceManager.switchMode('fleet'); true");
  t.check('released: fleet refused', !(await g.js("document.getElementById('sidebarFleet').classList.contains('active')")));
  await g.js("MicroserviceManager.switchMode('bench'); true");
  t.check('released: bench allowed', await g.js("document.getElementById('sidebarBench').classList.contains('active')"));
  t.check('released: admin and developer listed as not released',
    (await g.js("MicroserviceManager.release.list().filter(function (f) { return !f.released; }).map(function (f) { return f.id; }).sort().join(',')")) === 'admin,developer');

  // --dev: everything, as configured.
  process.env.DASGUI_DEV = '1';
  g = await t.open({ query: { view: 'all' } });
  t.check('dev: MM.release.dev is true', (await g.js('MicroserviceManager.release.dev')) === true);
  t.check('dev: Developer tab shown', await g.visible('#btnDevTools'));
  t.check('dev: Administrator tab shown', await g.visible('#btnAdminTools'));
  t.check('dev: view is user+admin+developer',
    (await g.js('MicroserviceManager.getView()')) === 'user+admin+developer');
  // --dev does not override a narrower role.
  g = await t.open({ query: { view: 'user' } });
  t.check('dev + view=user: Developer tab still hidden', !(await g.visible('#btnDevTools')));
});
