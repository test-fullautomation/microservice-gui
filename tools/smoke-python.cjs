const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
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

async function websocketHandshake(port) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const key = randomBytes(16).toString('base64');
    const expectedAccept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    const finish = error => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/signals/stream',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        Origin: 'file://',
      },
    });
    request.setTimeout(5000, () => request.destroy(new Error('WebSocket handshake timed out')));
    request.once('upgrade', (response, socket) => {
      socket.destroy();
      if (response.statusCode !== 101 || response.headers['sec-websocket-accept'] !== expectedAccept) {
        finish(new Error(`Invalid WebSocket handshake: HTTP ${response.statusCode}`));
      } else {
        finish();
      }
    });
    request.once('response', response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.once('end', () => finish(new Error(
        `WebSocket handshake rejected: HTTP ${response.statusCode} ${body}`)));
    });
    request.once('error', finish);
    request.end();
  });
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
          await websocketHandshake(port);
          console.log('Bundled Python bridge HTTP and WebSocket smoke tests: OK (system Python absent from PATH)');
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