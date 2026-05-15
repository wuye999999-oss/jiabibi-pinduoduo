// server13.js: Douyin fixed official signature runtime
// Render Start Command: node server13.js

const fs = require('fs');
const path = require('path');
const Module = require('module');

process.env.DOUYIN_SIGN_MODE = 'official_fixed';

const server7Path = path.join(__dirname, 'server7.js');
let source = fs.readFileSync(server7Path, 'utf8');

source = source.replace(/7\.7/g, '7.13-fixed');
source = source.replace(/version: '7\.5'/g, "version: '7.13-fixed'");
source = source.replace(/runtime: 'server7'/g, "runtime: 'server13-fixed'");
source = source.replace(
  "const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'values_wrap';",
  "const DOUYIN_SIGN_MODE = 'official_fixed';"
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

  const payload = {
    app_id: String(DOUYIN_APP_ID),
    timestamp: Math.floor(Date.now() / 1000),
    version: '1',
    sign_type: 'MD5',
    req_id: newReqId(),
    data: sortedJson(dataObj)
  };

  const inner = ['app_id','data','req_id','timestamp'].map(k => k + '=' + String(payload[k] || '')).join('&');
  payload.sign = crypto.createHash('md5').update(String(inner + DOUYIN_SECURITY_KEY), 'utf8').digest('hex');

  const raw = await postJson(DOUYIN_API_HOST + path, payload, 9000);
  raw.__request_meta = {
    path,
    sign_mode: 'official_fixed',
    sign_debug: {
      input: 'common_required_eq_amp',
      formula: 'suffix_lower',
      keys: ['app_id','data','req_id','timestamp'],
      data_is_string: true,
      fields_sent: Object.keys(payload).filter(k => k !== 'sign')
    }
  };
  return raw;
}`;

if (!source.includes(oldDouyinRequest)) throw new Error('patch target not found');
source = source.replace(oldDouyinRequest, newDouyinRequest);

const patchedModule = new Module(server7Path, module.parent || module);
patchedModule.filename = server7Path;
patchedModule.paths = Module._nodeModulePaths(__dirname);
patchedModule._compile(source, server7Path);
