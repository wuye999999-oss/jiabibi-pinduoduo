// server13.js: Douyin required-data fixed-order signature AUTO runtime
// Actual Render Start Command is: node server13.js
// Sign order: app_id, page, page_size, role_id, timestamp, title, user_id
// Transport requires req_id and data. Those may be sent but are NOT in the fixed 7-field sign string.
// Concatenate PARAM_NAME + VALUE directly, with no separators: no =, +, -, &, comma, or spaces.

const fs = require('fs');
const path = require('path');
const Module = require('module');

// Force correct mode regardless of Render env var.
process.env.DOUYIN_SIGN_MODE = 'data_required_fixed_order_auto';

const server7Path = path.join(__dirname, 'server7.js');
let source = fs.readFileSync(server7Path, 'utf8');

source = source.replace(/7\.7/g, '7.13-data-required');
source = source.replace(/version: '7\.5'/g, "version: '7.13-data-required'");
source = source.replace(/runtime: 'server7'/g, "runtime: 'server13-data-required'");
source = source.replace(
  "const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'values_wrap';",
  "const DOUYIN_SIGN_MODE = 'data_required_fixed_order_auto';"
);

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

  const dataObj = {
    page: data.page || 1,
    page_size: data.page_size || 20,
    role_id: douyinSafeNum(DOUYIN_ROLE_ID),
    title: data.title || data.keyword || data.q || '',
    user_id: douyinSafeNum(DOUYIN_USER_ID)
  };
  const timestamp = Math.floor(Date.now() / 1000);
  const signFields = { app_id: String(DOUYIN_APP_ID), ...dataObj, timestamp };
  const order = ['app_id','page','page_size','role_id','timestamp','title','user_id'];
  const inner = order.map(k => k + String(signFields[k] ?? '')).join('');
  const formulas = ['wrap_lower','wrap_upper','suffix_lower','suffix_upper','prefix_lower','prefix_upper','plain_lower','plain_upper'];
  const payloadVariants = [
    { name: 'data_string', make: (sign) => ({ app_id: String(DOUYIN_APP_ID), timestamp, version: '1', sign_type: 'MD5', req_id: newReqId(), data: sortedJson(dataObj), sign }) },
    { name: 'data_object', make: (sign) => ({ app_id: String(DOUYIN_APP_ID), timestamp, version: '1', sign_type: 'MD5', req_id: newReqId(), data: dataObj, sign }) },
    { name: 'flat_plus_data_string', make: (sign) => ({ app_id: String(DOUYIN_APP_ID), ...dataObj, timestamp, version: '1', sign_type: 'MD5', req_id: newReqId(), data: sortedJson(dataObj), sign }) }
  ];

  const attempts = [];
  let lastRaw = null;

  for (const variant of payloadVariants) {
    for (const formula of formulas) {
      const rawInput = formula === 'wrap_upper' || formula === 'wrap_lower' ? DOUYIN_SECURITY_KEY + inner + DOUYIN_SECURITY_KEY
        : formula === 'suffix_upper' || formula === 'suffix_lower' ? inner + DOUYIN_SECURITY_KEY
        : formula === 'prefix_upper' || formula === 'prefix_lower' ? DOUYIN_SECURITY_KEY + inner
        : inner;
      const hex = crypto.createHash('md5').update(String(rawInput), 'utf8').digest('hex');
      const sign = formula.endsWith('_upper') ? hex.toUpperCase() : hex;
      const payload = variant.make(sign);

      const raw = await postJson(DOUYIN_API_HOST + path, payload, 9000);
      const code = Number(raw && raw.code);
      attempts.push({ variant: variant.name, formula, code: raw && raw.code, desc: raw && raw.desc, sign_prefix: String(sign).slice(0, 6), sign_length: String(sign).length });
      raw.__request_meta = {
        path,
        sign_mode: 'data_required_fixed_order_auto',
        secret_sent_to_client: false,
        sign_debug: {
          mode: 'data_required_fixed_order_auto',
          variant: variant.name,
          formula,
          order,
          data_sent: true,
          req_id_sent: true,
          signed_fields_only: order,
          fields_sent: Object.keys(payload).filter(k => k !== 'sign'),
          input_masked: (formula.startsWith('wrap') || formula.startsWith('prefix') ? DOUYIN_SECURITY_KEY.slice(0,4) + '****' + DOUYIN_SECURITY_KEY.slice(-4) : '') + inner + (formula.startsWith('wrap') || formula.startsWith('suffix') ? DOUYIN_SECURITY_KEY.slice(0,4) + '****' + DOUYIN_SECURITY_KEY.slice(-4) : '')
        },
        attempts
      };
      lastRaw = raw;
      if (code !== 100004 && code !== 100002) return raw;
    }
  }
  return lastRaw;
}`;

if (!source.includes(oldDouyinRequest)) {
  throw new Error('Unable to patch Douyin request data-required payload: function body not found in server7.js');
}
source = source.replace(oldDouyinRequest, newDouyinRequest);

const patchedModule = new Module(server7Path, module.parent || module);
patchedModule.filename = server7Path;
patchedModule.paths = Module._nodeModulePaths(__dirname);
patchedModule._compile(source, server7Path);
