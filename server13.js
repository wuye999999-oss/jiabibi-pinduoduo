// server13.js: Douyin fixed-order key-value signature runtime
// Actual Render Start Command is: node server13.js
// Required sign order: app_id, page, page_size, role_id, timestamp, title, user_id
// Concatenate PARAM_NAME + VALUE directly, with no separators: no =, +, -, &, comma, or spaces.
// Signature formula: MD5(SK + inner + SK), lowercase hex kept from server13 test.

const fs = require('fs');
const path = require('path');
const Module = require('module');

// Force correct mode regardless of Render env var.
process.env.DOUYIN_SIGN_MODE = 'fixed_order_kv_lower';

const server7Path = path.join(__dirname, 'server7.js');
let source = fs.readFileSync(server7Path, 'utf8');

source = source.replace(/7\.7/g, '7.13-fixed');
source = source.replace(/version: '7\.5'/g, "version: '7.13-fixed'");
source = source.replace(/runtime: 'server7'/g, "runtime: 'server13-fixed'");
source = source.replace(
  "const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'values_wrap';",
  "const DOUYIN_SIGN_MODE = 'fixed_order_kv_lower';"
);

const needle = "  // Value-only modes: no key names in sign string\n  if (DOUYIN_SIGN_MODE === 'values_wrap') {";
const fixedOrderBranch = `  // Douyin fixed-order key-value signing mode.
  // Order MUST be exactly: app_id, page, page_size, role_id, timestamp, title, user_id.
  // Concatenate PARAM_NAME + VALUE directly with no separators.
  // Keep lowercase MD5 because server13 was created as lowercase signature runtime test.
  if (DOUYIN_SIGN_MODE === 'fixed_order_kv_lower') {
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
      sign: crypto.createHash('md5').update(String(SK + inner + SK), 'utf8').digest('hex'),
      debug: {
        mode: 'fixed_order_kv_lower',
        order: orderedPairs.map(([k]) => k),
        input_masked: maskSk + inner + maskSk
      }
    };
  }

`;

if (!source.includes("DOUYIN_SIGN_MODE === 'fixed_order_kv_lower'")) {
  if (!source.includes(needle)) {
    throw new Error('Unable to patch Douyin signing: insertion point not found in server7.js');
  }
  source = source.replace(needle, fixedOrderBranch + needle);
}

const patchedModule = new Module(server7Path, module.parent || module);
patchedModule.filename = server7Path;
patchedModule.paths = Module._nodeModulePaths(__dirname);
patchedModule._compile(source, server7Path);
