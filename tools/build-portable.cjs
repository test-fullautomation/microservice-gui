const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function stageSources(manifest, destination) {
  for (const entry of manifest) {
    const target = path.resolve(destination, entry.destination);
    const relative = path.relative(destination, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Source escapes staging directory: ${entry.destination}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve(entry.source), target);
  }
}

function packagingPlan(platform, format) {
  if (!['installer', 'portable', 'unpacked'].includes(format)) {
    throw new Error(`Unsupported package format: ${format}`);
  }
  if (format === 'unpacked' && ['win32', 'linux'].includes(platform)) {
    return { platform: platform === 'win32' ? 'WINDOWS' : 'LINUX', target: 'dir', configKey: null };
  }
  if (platform === 'win32') {
    const target = format === 'installer' ? 'nsis' : 'portable';
    return { platform: 'WINDOWS', target, configKey: target };
  }
  if (platform === 'linux') {
    return format === 'installer'
      ? { platform: 'LINUX', target: 'deb', configKey: 'deb' }
      : { platform: 'LINUX', target: 'AppImage', configKey: 'appImage' };
  }
  throw new Error(`Unsupported build platform: ${platform}`);
}

async function build(manifestPath, npmPackagePath, outputPath, platform, format, runtimeMetadata) {
  const plan = packagingPlan(platform, format);
  if (process.platform !== platform || process.arch !== 'x64') {
    throw new Error(`The ${format} target requires a ${platform} x64 build host.`);
  }
  if (platform === 'win32') {
    process.env.USERPROFILE ||= os.homedir();
    process.env.LOCALAPPDATA ||= path.join(process.env.USERPROFILE, 'AppData', 'Local');
    process.env.APPDATA ||= path.join(process.env.USERPROFILE, 'AppData', 'Roaming');
  } else {
    process.env.HOME ||= os.homedir();
  }
  process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`;
  const output = path.resolve(outputPath);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-electron-'));
  try {
    const project = path.join(staging, 'app');
    fs.mkdirSync(project);
    stageSources(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), project);
    fs.cpSync(path.dirname(path.resolve(runtimeMetadata)), path.join(project, '.python-runtime'),
      { recursive: true, dereference: true });
    fs.cpSync(path.join(path.dirname(path.resolve(npmPackagePath)), 'node_modules'),
      path.join(project, 'node_modules'), { recursive: true, dereference: true });
    const builder = require(path.join(project, 'node_modules', 'electron-builder'));
    const electron = require(path.join(project, 'node_modules', 'electron', 'package.json'));
    const originalCwd = process.cwd();
    let artifacts;
    try {
      process.chdir(project);
      artifacts = await builder.build({
        projectDir: project,
        targets: builder.Platform[plan.platform].createTarget(plan.target, builder.Arch.x64),
        publish: 'never',
        config: {
          electronVersion: electron.version,
          directories: { output: path.join(staging, 'dist') },
          ...(plan.configKey ? { [plan.configKey]: { artifactName: path.basename(output) } } : {}),
        },
      });
    } finally {
      process.chdir(originalCwd);
    }
    if (format === 'unpacked') {
      const directory = platform === 'win32' ? 'win-unpacked' : 'linux-unpacked';
      fs.cpSync(path.join(staging, 'dist', directory), output, { recursive: true, dereference: true });
      return;
    }
    const artifact = artifacts.find(candidate => path.basename(candidate) === path.basename(output));
    if (!artifact) throw new Error(`${format} artifact not produced: ${artifacts.join(', ')}`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(artifact, output);
    if (platform === 'linux' && format === 'portable') fs.chmodSync(output, 0o755);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
  }
}

module.exports = { stageSources, packagingPlan };

if (require.main === module) {
  build(...process.argv.slice(2)).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}