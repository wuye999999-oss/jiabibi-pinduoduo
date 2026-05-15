// server13.js: Douyin official common-parameter signature exhaustive runtime
// Render Start Command: node server13.js
// Official body: app_id, timestamp, version, sign_type, req_id, data(string), sign.
// Product search data string: page, page_size, title, user_id, role_id.

const fs = require('fs');
const path = require('path');
const Module = require('module');

process.env.DOUYIN_SIGN_MODE = 'official_exhaustive_auto';

const server7Path = path.join(__dirname, 'server7.js');
let source = fs.readFileSync(server7Path, 'utf8');

source = source.replace(/7\.7/g, '7.13-exhaustive');
source = source.replace(/version: '7\.5'/g, "version: '7.13-exhaustive'");
source = source.replace(/runtime: 'server7'/g, "runtime: 'server13-exhaustive'");
source = source.replace(
  "const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'values_wrap';",
  "const DOUYIN_SIGN_MODE = 'official_exhaustive_auto';"
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
  const formulaList = ['wrap_lower','wrap_upper','suffix_lower','suffix_upper','prefix_lower','prefix_upper','plain_lower','plain_upper'];
  const inputList = [];
  const commonAll = ['app_id','data','req_id','sign_type','timestamp','version'];
  const commonReq = ['app_id','data','req_id','timestamp'];
  const biz7 = ['app_id','page','page_size','role_id','timestamp','title','user_id'];
  const commonObj = () => ({ app_id: base.app_id, data: base.data, req_id: base.req_id, sign_type: base.sign_type, timestamp: base.timestamp, version: base.version });
  const bizObj = () => ({ app_id: base.app_id, page: dataObj.page, page_size: dataObj.page_size, role_id: dataObj.role_id, timestamp: base.timestamp, title: dataObj.title, user_id: dataObj.user_id });

  function pushInputs(name, keys, objFn) {
    inputList.push({ name: name + '_kv', keys, build: o => keys.map(k => k + String(o[k] ?? '')).join(''), objFn });
    inputList.push({ name: name + '_values', keys, build: o => keys.map(k => String(o[k] ?? '')).join(''), objFn });
    inputList.push({ name: name + '_eq_amp', keys, build: o => keys.map(k => k + '=' + String(o[k] ?? '')).join('&'), objFn });
  }
  pushInputs('common_all', commonAll, commonObj);
  pushInputs('common_required', commonReq, commonObj);
  pushInputs('business7', biz7, bizObj);

  let lastRaw = null;
  for (const inputCfg of inputList) {
    for (const formula of formulaList) {
      const payload = { ...base, req_id: newReqId() };
      const o = inputCfg.objFn();
      o.req_id = payload.req_id;
      const inner = inputCfg.build(o);
      const rawInput = formula.startsWith('wrap') ? DOUYIN_SECURITY_KEY + inner + DOUYIN_SECURITY_KEY
        : formula.startsWith('suffix') ? inner + DOUYIN_SECURITY_KEY
        : formula.startsWith('prefix') ? DOUYIN_SECURITY_KEY + inner
        : inner;
      const hex = crypto.createHash('md5').update(String(rawInput), 'utf8').digest('hex');
      payload.sign = formula.endsWith('upper') ? hex.toUpperCase() : hex;
      const raw = await postJson(DOUYIN_API_HOST + path, payload, 9000);
      const code = Number(raw && raw.code);
      attempts.push({ input: inputCfg.name, formula, code: raw && raw.code, desc: raw && raw.desc, sign_prefix: String(payload.sign).slice(0, 6), sign_length: String(payload.sign).length });
      raw.__request_meta = { path, sign_mode: 'official_exhaustive_auto', sign_debug: { input: inputCfg.name, formula, keys: inputCfg.keys, data_is_string: true, fields_sent: Object.keys(payload).filter(k => k !== 'sign') }, attempts };
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
