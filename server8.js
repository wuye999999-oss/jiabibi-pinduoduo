// server8.js v7.8 runtime patch
// Loads server7.js, applies the minimal Douyin official_kv signing patch, then starts the existing server runtime.
const fs = require('fs');
const path = require('path');
const Module = require('module');

const server7Path = path.join(__dirname, 'server7.js');
let source = fs.readFileSync(server7Path, 'utf8');

// Force the current deployment to use the new official key-value signature mode.
process.env.DOUYIN_SIGN_MODE = 'official_kv';

// Runtime marker bump only; keep the existing stable server7 implementation.
source = source.replace(/7\.7/g, '7.8');
source = source.replace(
  "const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'values_wrap';",
  "const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'official_kv';"
);

const needle = "  // Value-only modes: no key names in sign string\n  if (DOUYIN_SIGN_MODE === 'values_wrap') {";
const officialKvBranch = `  // Official Pangolin/CPS key-value signing mode: sign outer body fields only.
  if (DOUYIN_SIGN_MODE === 'official_kv') {
    const p = { ...params };
    delete p.sign;
    delete p.sign_type;
    const keys = Object.keys(p).filter(k => p[k] !== undefined && p[k] !== null).sort();
    const inner = keys.map(k => k + p[k]).join('');
    return {
      sign: md5Upper(SK + inner + SK),
      debug: {
        mode: 'official_kv',
        keys_signed: keys,
        input_masked: maskSk + inner + maskSk
      }
    };
  }

`;

if (!source.includes("DOUYIN_SIGN_MODE === 'official_kv'")) {
  if (!source.includes(needle)) {
    throw new Error('Unable to patch Douyin signing: insertion point not found in server7.js');
  }
  source = source.replace(needle, officialKvBranch + needle);
}

const patchedModule = new Module(server7Path, module.parent || module);
patchedModule.filename = server7Path;
patchedModule.paths = Module._nodeModulePaths(__dirname);
patchedModule._compile(source, server7Path);
