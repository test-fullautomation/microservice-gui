const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { stageSources, packagingPlan } = require('../tools/build-portable.cjs');
const config = require('../package.json');

test('default Windows installer configuration is preserved alongside portable', () => {
  assert.equal(config.build.win.target, 'nsis');
  assert.equal(config.build.nsis.include, 'build-resources/installer.nsh');
  assert.equal(config.build.nsis.oneClick, false);
  assert.equal(config.build.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(config.build.portable.artifactName,
    'DevAtServGUI-${version}-portable-${arch}.${ext}');
  assert.deepEqual(config.build.linux.target, ['AppImage', 'deb']);
  assert.equal(config.build.deb.afterInstall, 'build-resources/postinst.sh');
});

for (const [platform, format, builderPlatform, target, configKey] of [
  ['win32', 'installer', 'WINDOWS', 'nsis', 'nsis'],
  ['win32', 'portable', 'WINDOWS', 'portable', 'portable'],
  ['linux', 'installer', 'LINUX', 'deb', 'deb'],
  ['linux', 'portable', 'LINUX', 'AppImage', 'appImage'],
]) {
  test(`${platform} ${format} selects an independent packaging target`, () => {
    assert.deepEqual(packagingPlan(platform, format), {
      platform: builderPlatform, target, configKey,
    });
  });
}

test('unsupported platforms and formats are rejected', () => {
  assert.throws(() => packagingPlan('darwin', 'portable'), /Unsupported build platform/);
  assert.throws(() => packagingPlan('linux', 'zip'), /Unsupported package format/);
});

test('packaged resources stay inside the standalone checkout', () => {
  const root = path.resolve(__dirname, '..');
  for (const resource of config.build.extraResources) {
    const source = path.resolve(root, resource.from);
    assert.ok(!path.relative(root, source).startsWith('..'), resource.from);
    assert.ok(fs.existsSync(source), resource.from);
  }
});

test('staging copies declared sources without modifying them', context => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-staging-test-'));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, 'source.js');
  const destination = path.join(temporary, 'staging');
  fs.writeFileSync(source, 'module.exports = 42;');
  stageSources([{ source, destination: 'electron/main.js' }], destination);
  assert.equal(fs.readFileSync(path.join(destination, 'electron/main.js'), 'utf8'),
    fs.readFileSync(source, 'utf8'));
  fs.writeFileSync(path.join(destination, 'electron/main.js'), 'changed');
  assert.equal(fs.readFileSync(source, 'utf8'), 'module.exports = 42;');
});

test('staging rejects paths outside its directory', () => {
  assert.throws(() => stageSources([
    { source: __filename, destination: '../outside.js' },
  ], path.join(os.tmpdir(), 'gui-staging-test')), /escapes staging directory/);
});