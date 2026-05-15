// server13.js: Douyin fixed-order key-value signature AUTO runtime
// Actual Render Start Command is: node server13.js
// Required sign order: app_id, page, page_size, role_id, timestamp, title, user_id
// Concatenate PARAM_NAME + VALUE directly, with no separators: no =, +, -, &, comma, or spaces.
// This runtime auto-tries common MD5 formulas until Douyin no longer returns sign check fail.

const fs = require('fs');
const path = require('path');
const Module = require('module');

// Force correct mode regardless of Render env var.
process.env.DOUYIN_SIGN_MODE = 'fixed_order_kv_auto';

const server7Path = path.join(__dirname, 'server7.js');
let source = fs.readFileSync(server7Path, 'utf8');

source = source.replace(/7\.7/g, '7.13-auto');
source = source.replace(/version: '7\.5'/g, "version: '7.13-auto'");
source = source.replace(/runtime: 'server7'/g, "runtime: 'server13-auto'");
source = source.replace(
  "const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'values_wrap';",
  "const DOUYIN_SIGN_MODE = 'fixed_order_kv_auto';"
);

const signNeedle = "  // Value-only modes: no key names in sign string\n  if (DOUYIN_SIGN_MODE === 'values_wrap') {";
const fixedOrderBranch = `  // Douyin fixed-order key-value signing mode.
  // Order MUST be exactly: app_id, page, page_size, role_id, timestamp, title, user_id.
  // Concatenate PARAM_NAME + VALUE directly with no separators.
  if (DOUYIN_SIGN_MODE === 'fixed_order_kv_auto') {
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
    const formula = process.env.DOUYIN_SIGN_FORMULA || 'wrap_lower';
    const rawInput = formula === 'wrap_upper' || formula === 'wrap_lower' ? SK + inner + SK
      : formula === 'suffix_upper' || formula === 'suffix_lower' ? inner + SK
      : formula === 'prefix_upper' || formula === 'prefix_lower' ? SK + inner
      : inner;
    const hex = crypto.createHash('md5').update(String(rawInput), 'utf8').digest('hex');
    return {
      sign: formula.endsWith('_upper') ? hex.toUpperCase() : hex,
      debug: {
        mode: 'fixed_order_kv_auto',
        formula,
        order: orderedPairs.map(([k]) => k),
        input_masked: (formula.startsWith('wrap') || formula.startsWith('prefix') ? maskSk : '') + inner + (formula.startsWith('wrap') || formula.startsWith('suffix') ? maskSk : '')
      }
    };
  }

`;

if (!source.includes("DOUYIN_SIGN_MODE === 'fixed_order_kv_auto'")) {
  if (!source.includes(signNeedle)) {
    throw new Error('Unable to patch Douyin signing: insertion point not found in server7.js');
  }
  source = source.replace(signNeedle, fixedOrderBranch + signNeedle);
}

const oldDouyinRequest = `async function douyinRequest(path, data = {}) {
  if (!DOUYIN_ENABLED) return { code: -1, desc: 'douyin_disabled', data: null };
  if (!DOUYIN_CONFIGURED) return { code: -1, desc: 'missing_douyin_env', data: douyinSelfCheck() };
  const dataObj = { user_id: douyinSafeNum(DOUYIN_USER_ID), role_id: douyinSafeNum(DOUYIN_ROLE_ID), ...data };
  const payload = { app_id: String(DOUYIN_APP_ID), timestamp: Math.floor(Date.now() / 1000), version: '1', sign_type: 'MD5', req_id: newReqId(), data: sortedJson(dataObj) };
  const { sign, debug: signDebug } = douyinSignWithDebug(payload);
  payload.sign = sign;
  const raw = await postJson(DOUYIN_API_HOST + path, payload, 9000);
  raw.__request_meta = { path, sign_mode: DOUYIN_SIGN_MODE, secret_sent_to_client: false, sign_debug: signDebug };
  return raw;
}`;

const newDouyinRequest = `async function douyinRequest(path, data = {}) {
  if (!DOUYIN_ENABLED) return { code: -1, desc: 'douyin_disabled', data: null };
  if (!DOUYIN_CONFIGURED) return { code: -1, desc: 'missing_douyin_env', data: douyinSelfCheck() };
  const dataObj = { user_id: douyinSafeNum(DOUYIN_USER_ID), role_id: douyinSafeNum(DOUYIN_ROLE_ID), ...data };
  const basePayload = { app_id: String(DOUYIN_APP_ID), timestamp: Math.floor(Date.now() / 1000), version: '1', sign_type: 'MD5', req_id: newReqId(), data: sortedJson(dataObj) };
  const formulas = ['wrap_lower','wrap_upper','suffix_lower','suffix_upper','prefix_lower','prefix_upper','plain_lower','plain_upper'];
  const attempts = [];
  let lastRaw = null;
  const previousFormula = process.env.DOUYIN_SIGN_FORMULA;
  for (const formula of formulas) {
    process.env.DOUYIN_SIGN_FORMULA = formula;
    const payload = { ...basePayload, req_id: newReqId() };
    const { sign, debug: signDebug } = douyinSignWithDebug(payload);
    payload.sign = sign;
    const raw = await postJson(DOUYIN_API_HOST + path, payload, 9000);
    const code = Number(raw && raw.code);
    attempts.push({ formula, code: raw && raw.code, desc: raw && raw.desc, sign_prefix: String(sign).slice(0, 6), sign_length: String(sign).length });
    raw.__request_meta = { path, sign_mode: DOUYIN_SIGN_MODE, secret_sent_to_client: false, sign_debug: signDebug, attempts };
    lastRaw = raw;
    if (code !== 100004) {
      if (previousFormula === undefined) delete process.env.DOUYIN_SIGN_FORMULA; else process.env.DOUYIN_SIGN_FORMULA = previousFormula;
      return raw;
    }
  }
  if (previousFormula === undefined) delete process.env.DOUYIN_SIGN_FORMULA; else process.env.DOUYIN_SIGN_FORMULA = previousFormula;
  return lastRaw;
}`;

if (!source.includes(oldDouyinRequest)) {
  throw new Error('Unable to patch Douyin request auto-retry: function body not found in server7.js');
}
source = source.replace(oldDouyinRequest, newDouyinRequest);

const patchedModule = new Module(server7Path, module.parent || module);
patchedModule.filename = server7Path;
patchedModule.paths = Module._nodeModulePaths(__dirname);
patchedModule._compile(source, server7Path);
