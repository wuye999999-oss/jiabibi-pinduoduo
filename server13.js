// server13.js: Douyin lowercase-MD5 signature runtime test
// Keeps server7.js logic, but makes Douyin SK-based signatures output lowercase hex.
const fs = require('fs');
const path = require('path');
const Module = require('module');

if (!process.env.DOUYIN_SIGN_MODE) process.env.DOUYIN_SIGN_MODE = 'sorted';

const server7Path = path.join(__dirname, 'server7.js');
let source = fs.readFileSync(server7Path, 'utf8');

source = source.replace(/7\.7/g, '7.13');

const lower = "crypto.createHash('md5').update(String($1), 'utf8').digest('hex')";
source = source
  .replace(/md5Upper\((SK \+ inner \+ SK)\)/g, lower)
  .replace(/md5Upper\((inner \+ SK)\)/g, lower)
  .replace(/md5Upper\((SK \+ inner)\)/g, lower);

const patchedModule = new Module(server7Path, module.parent || module);
patchedModule.filename = server7Path;
patchedModule.paths = Module._nodeModulePaths(__dirname);
patchedModule._compile(source, server7Path);
