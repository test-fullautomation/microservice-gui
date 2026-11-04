const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function smokePython(resources) {
  const executable = path.join(resources, 'python-runtime',
    process.platform === 'win32' ? 'python.exe' : 'bin/python3.12');
  if (!fs.existsSync(executable)) throw new Error(`Bundled Python missing: ${executable}`);
  const port = await availablePort();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-python-smoke-'));
  const config = path.join(temporary, 'config.json');
  fs.writeFileSync(config, '{}');
  const environment = { ...process.env, PATH: path.dirname(executable),
    PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
  delete environment.PYTHONHOME;
  delete environment.PYTHONPATH;
  delete environment.PYTHONUSERBASE;
  let logs = '';
  let failure;
  const child = spawn(executable, ['-I', path.join(resources, 'python', 'launcher.py'),
    '--config', config, '--bridge-host', '127.0.0.1', '--bridge-port', String(port),
    '--broker-host', '127.0.0.1', '--broker-port', '1'],
  { env: environment, cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', data => { logs = (logs + data).slice(-20000); });
  child.stderr.on('data', data => { logs = (logs + data).slice(-20000); });
  child.once('error', error => { failure = error; });
  child.once('exit', code => { failure ||= new Error(`Python bridge exited: ${code}`); });
  try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/openapi.json`,
          { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.json()).openapi) {
          console.log('Bundled Python bridge HTTP smoke test: OK (system Python absent from PATH)');
          return;
        }
      } catch (error) {
        if (failure) throw failure;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Bundled Python bridge did not become healthy within 90 seconds.');
  } catch (error) {
    throw new Error(`${error.message}\n${logs}`, { cause: error });
  } finally {
    if (child.exitCode === null && !failure) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    } else if (child.exitCode === null && child.pid) {
      child.kill();
    }
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
}

module.exports = { smokePython };