const path = require('node:path');
const { smokePython } = require('./smoke-python.cjs');

module.exports = async function afterPack(context) {
  await smokePython(path.join(context.appOutDir, 'resources'));
};