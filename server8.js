// server8.js v8.0 runtime patch
// Loads server7.js, applies Douyin fixed-order value-only signing, then starts existing runtime.
// Required sign order: app_id, page, page_size, role_id, timestamp, title, user_id
// Concatenate VALUES ONLY with no separators: no =, +, -, &, comma, or spaces.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const server7Path = path.join(__dirname, 'server7.js');
let source = fs.readFileSync(server7Path, 'utf8');

// Force deployment to use the fixed-order value-only mode.
process.env.DOUYIN_SIGN_MODE = 'fixed_order_values';

// Runtime marker bump only; keep the existing stable server7 implementation.
source = source.replace(/7\.7/g, '8.0');
source = source.replace(/version: '7\.5'/g, "version: '8.0'");
source = source.replace(/runtime: 'server7'/g, "runtime: 'server8'");
source = source.replace(
  "const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'values_wrap';",
  "const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'fixed_order_values';"
);

const needle = "  // Value-only modes: no key names in sign string\n  if (DOUYIN_SIGN_MODE === 'values_wrap') {";
const fixedOrderBranch = `  // Douyin fixed-order value-only signing mode.
  // Order MUST be exactly: app_id, page, page_size, role_id, timestamp, title, user_id.
  // Values are concatenated directly with no symbols or spaces.
  if (DOUYIN_SIGN_MODE === 'fixed_order_values') {
    const parsed = parseJsonMaybe(params.data) || {};
    const orderedValues = [
      String(params.app_id || ''),
      String(parsed.page || ''),
      String(parsed.page_size || ''),
      String(parsed.role_id || ''),
      String(params.timestamp || ''),
      String(parsed.title || ''),
      String(parsed.user_id || '')
    ];
    const inner = orderedValues.join('');
    return {
      sign: md5Upper(SK + inner + SK),
      debug: {
        mode: 'fixed_order_values',
        order: ['app_id','page','page_size','role_id','timestamp','title','user_id'],
        input_masked: maskSk + inner + maskSk
      }
    };
  }

`;

if (!source.includes("DOUYIN_SIGN_MODE === 'fixed_order_values'")) {
  if (!source.includes(needle)) {
    throw new Error('Unable to patch Douyin signing: insertion point not found in server7.js');
  }
  source = source.replace(needle, fixedOrderBranch + needle);
}

const patchedModule = new Module(server7Path, module.parent || module);
patchedModule.filename = server7Path;
patchedModule.paths = Module._nodeModulePaths(__dirname);
patchedModule._compile(source, server7Path);
