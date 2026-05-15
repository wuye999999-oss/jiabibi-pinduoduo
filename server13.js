// server13.js: Douyin official common-parameter signature runtime
// Render Start Command: node server13.js
// Official body: app_id, timestamp, version, sign_type, req_id, data(string), sign.
// Product search data string: page, page_size, title, user_id, role_id.

const fs = require('fs');
const path = require('path');
const Module = require('module');

process.env.DOUYIN_SIGN_MODE = 'official_common_auto';

const server7Path = path.join(__dirname, 'server7.js');
let source = fs.readFileSync(server7Path, 'utf8');

source = source.replace(/7\.7/g, '7.13-official-common');
source = source.replace(/version: '7\.5'/g, "version: '7.13-official-common'");
source = source.replace(/runtime: 'server7'/g, "runtime: 'server13-official-common'");
source = source.replace(
  "const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'values_wrap';",
  "const DOUYIN_SIGN_MODE = 'official_common_auto';"
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
    title: data.title || data.keyword || data.q || '',
    user_id: douyinSafeNum(DOUYIN_USER_ID),
    role_id: douyinSafeNum(DOUYIN_ROLE_ID)
  };

  const base = {
    app_id: String(DOUYIN_APP_ID),
    timestamp: Math.floor(Date.now() / 1000),
    version: '1',
    sign_type: 'MD5',
    req_id: newReqId(),
    data: sortedJson(dataObj)
  };

  const attempts = [];
  const formulaList = ['wrap_lower','wrap_upper','suffix_lower','suffix_upper','prefix_lower','prefix_upper'];
  const inputList = [
    { name: 'common_all_sorted', keys: ['app_id','data','req_id','sign_type','timestamp','version'] },
    { name: 'common_no_signtype', keys: ['app_id','data','req_id','timestamp','version'] },
    { name: 'common_no_version', keys: ['app_id','data','req_id','sign_type','timestamp'] },
    { name: 'common_required_only', keys: ['app_id','data','req_id','timestamp'] }
  ];

  let lastRaw = null;
  for (const inputCfg of inputList) {
    for (const formula of formulaList) {
      const payload = { ...base, req_id: newReqId() };
      const inner = inputCfg.keys.map(k => k + String(payload[k] ?? '')).join('');
      const rawInput = formula.startsWith('wrap') ? DOUYIN_SECURITY_KEY + inner + DOUYIN_SECURITY_KEY
        : formula.startsWith('suffix') ? inner + DOUYIN_SECURITY_KEY
        : DOUYIN_SECURITY_KEY + inner;
      const hex = crypto.createHash('md5').update(String(rawInput), 'utf8').digest('hex');
      payload.sign = formula.endsWith('upper') ? hex.toUpperCase() : hex;
      const raw = await postJson(DOUYIN_API_HOST + path, payload, 9000);
      const code = Number(raw && raw.code);
      attempts.push({ input: inputCfg.name, formula, code: raw && raw.code, desc: raw && raw.desc, sign_prefix: String(payload.sign).slice(0, 6), sign_length: String(payload.sign).length });
      raw.__request_meta = { path, sign_mode: 'official_common_auto', sign_debug: { input: inputCfg.name, formula, keys: inputCfg.keys, data_is_string: true, fields_sent: Object.keys(payload).filter(k => k !== 'sign') }, attempts };
      lastRaw = raw;
      if (code !== 100004 && code !== 100002) return raw;
    }
  }
  return lastRaw;
}`;

if (!source.includes(oldDouyinRequest)) throw new Error('patch target not found');
source = source.replace(oldDouyinRequest, newDouyinRequest);

const patchedModule = new Module(server7Path, module.parent || module);
patchedModule.filename = server7Path;
patchedModule.paths = Module._nodeModulePaths(__dirname);
patchedModule._compile(source, server7Path);
