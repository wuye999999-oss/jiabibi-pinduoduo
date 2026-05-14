// server8.js v8.1 runtime patch
// Loads server7.js, applies Douyin fixed-order key-value signing, then starts existing runtime.
// Required sign order: app_id, page, page_size, role_id, timestamp, title, user_id
// Concatenate PARAM_NAME + VALUE directly, with no separators: no =, +, -, &, comma, or spaces.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const server7Path = path.join(__dirname, 'server7.js');
let source = fs.readFileSync(server7Path, 'utf8');

// Force deployment to use the fixed-order key-value mode. This intentionally overrides Render env DOUYIN_SIGN_MODE.
process.env.DOUYIN_SIGN_MODE = 'fixed_order_kv';

// Runtime marker bump only; keep the existing stable server7 implementation.
source = source.replace(/7\.7/g, '8.1');
source = source.replace(/version: '7\.5'/g, "version: '8.1'");
source = source.replace(/runtime: 'server7'/g, "runtime: 'server8'");
source = source.replace(
  "const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'values_wrap';",
  "const DOUYIN_SIGN_MODE = 'fixed_order_kv';"
);

const needle = "  // Value-only modes: no key names in sign string\n  if (DOUYIN_SIGN_MODE === 'values_wrap') {";
const fixedOrderBranch = `  // Douyin fixed-order key-value signing mode.
  // Order MUST be exactly: app_id, page, page_size, role_id, timestamp, title, user_id.
  // Concatenate PARAM_NAME + VALUE directly with no separators.
  if (DOUYIN_SIGN_MODE === 'fixed_order_kv') {
    const parsed = parseJsonMaybe(params.data) || {};
    const orderedPairs = [
      ['app_id', params.app_id || ''],
      ['page', parsed.page || ''],
      ['page_size', parsed.page_size || ''],
      ['role_id', parsed.role_id || ''],
      ['timestamp', params.timestamp || ''],
      ['title', parsed.title || ''],
      ['user_id', parsed.user_id || '']
    ];
    const inner = orderedPairs.map(([k, v]) => k + String(v)).join('');
    return {
      sign: md5Upper(SK + inner + SK),
      debug: {
        mode: 'fixed_order_kv',
        order: orderedPairs.map(([k]) => k),
        input_masked: maskSk + inner + maskSk
      }
    };
  }

`;

if (!source.includes("DOUYIN_SIGN_MODE === 'fixed_order_kv'")) {
  if (!source.includes(needle)) {
    throw new Error('Unable to patch Douyin signing: insertion point not found in server7.js');
  }
  source = source.replace(needle, fixedOrderBranch + needle);
}

const patchedModule = new Module(server7Path, module.parent || module);
patchedModule.filename = server7Path;
patchedModule.paths = Module._nodeModulePaths(__dirname);
patchedModule._compile(source, server7Path);
