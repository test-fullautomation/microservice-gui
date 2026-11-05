const fs = require('node:fs');
const path = require('node:path');

function bundledPython(resources, platform = process.platform) {
  const executable = path.join(resources, 'python-runtime',
    platform === 'win32' ? 'python.exe' : 'bin/python3.12');
  try {
    fs.accessSync(executable, fs.constants.X_OK);
  } catch (error) {
    throw new Error(`Bundled Python runtime is missing or cannot execute: ${executable}`, { cause: error });
  }
  return executable;
}

module.exports = { bundledPython };