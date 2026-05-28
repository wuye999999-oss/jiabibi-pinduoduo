// server.js v9.4
// Entry point: PDD / JD / Taobao active. Douyin: OAuth2 精选联盟 framework.
// JD: auto-fallback goods.query → jingfen.query → Playwright on permission error.
// PDD: URL input (yangkeduo.com / pinduoduo.com) → goods.detail direct lookup.
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const sandboxMod = (() => { try { return require('./sandbox/routes'); } catch (_) { return null; } })();
const jdPlaywrightMod = (() => { try { return require('./sandbox/jd-playwright-search'); } catch (_) { return null; } })();
const PORT = process.env.PORT || 3000;

function envFirst(...names) {
  for (const name of names) { const v = process.env[name]; if (v && String(v).trim()) return String(v).trim(); }
  return '';
}
function md5Upper(s) { return crypto.createHash('md5').update(String(s), 'utf8').digest('hex').toUpperCase(); }
function cleanParams(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) { if (v !== undefined && v !== null && v !== '') out[k] = String(v); }
  return out;
}
function asArray(v) { return !v ? [] : (Array.isArray(v) ? v : [v]); }
function yuanFromFen(v) { return Math.round(Number(v || 0)) / 100; }
function httpsUrl(u) {
  if (!u) return ''; const s = String(u).trim(); if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://' + s.replace(/^\/\//, '');
}
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE' });
  res.end(JSON.stringify(body, null, 2));
}
function sendRedirect(res, location) {
  res.writeHead(302, { Location: location }); res.end();
}
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 2_000_000) req.destroy(); });
    req.on('end', () => resolve(data)); req.on('error', () => resolve(''));
  });
}
function postForm(endpoint, params, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    let u; try { u = new URL(endpoint); } catch (e) { return reject(e); }
    const cli = u.protocol === 'http:' ? http : https;
    const req = cli.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, port: u.port || (u.protocol === 'http:' ? 80 : 443), timeout: timeoutMs, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'Jiabibi/9.2' } }, res => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('non_json ' + data.slice(0, 200))); } });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('request_timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject); req.write(body); req.end();
  });
}
function postJson(endpoint, payload, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    let u; try { u = new URL(endpoint); } catch (e) { return reject(e); }
    const cli = u.protocol === 'http:' ? http : https;
    const req = cli.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, port: u.port || (u.protocol === 'http:' ? 80 : 443), timeout: timeoutMs, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'Jiabibi/9.2' } }, res => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('non_json ' + data.slice(0, 200))); } });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('request_timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject); req.write(body); req.end();
  });
}
function sortByPrice(goods) { return (goods || []).slice().sort((a, b) => Number(a.coupon_price_yuan || a.min_group_price_yuan || 0) - Number(b.coupon_price_yuan || b.min_group_price_yuan || 0)); }
function cheapest(goods) { return sortByPrice(goods).find(x => Number(x.coupon_price_yuan || x.min_group_price_yuan || 0) > 0) || null; }
function parseJsonMaybe(v) { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(String(v)); } catch { return null; } }
function findDeep(obj, pred, limit = 5000) {
  const seen = new Set(); const out = [];
  function walk(v) { if (!v || typeof v !== 'object' || seen.has(v) || out.length >= limit) return; seen.add(v); if (pred(v)) out.push(v); if (Array.isArray(v)) v.forEach(walk); else Object.values(v).forEach(walk); }
  walk(obj); return out;
}

// ---------- PDD ----------
const PDD_API_URL = process.env.PDD_API_URL || 'https://gw-api.pinduoduo.com/api/router';
const PDD_CLIENT_ID = envFirst('PDD_CLIENT_ID', 'PDD_APP_KEY');
const PDD_CLIENT_SECRET = envFirst('PDD_CLIENT_SECRET', 'PDD_APP_SECRET');
const PDD_PID = envFirst('PDD_PID');
const PDD_CUSTOM_PARAMETERS = envFirst('PDD_CUSTOM_PARAMETERS');
function pddSign(p) { let s = PDD_CLIENT_SECRET; Object.keys(p).sort().forEach(k => { s += k + p[k]; }); return md5Upper(s + PDD_CLIENT_SECRET); }
async function pddRequest(type, biz = {}) {
  if (!PDD_CLIENT_ID || !PDD_CLIENT_SECRET || !PDD_PID) return { error: 'missing_pdd_env' };
  const params = cleanParams({ type, client_id: PDD_CLIENT_ID, timestamp: Math.floor(Date.now() / 1000), data_type: 'JSON', ...biz });
  params.sign = pddSign(params);
  return postForm(PDD_API_URL, params);
}
function normalizePdd(item, source = 'pdd.ddk.goods.search') {
  const price = Number(item.min_group_price || item.min_normal_price || 0);
  const coupon = Number(item.coupon_discount || item.extra_coupon_amount || 0);
  const final = Math.max(0, price - coupon);
  return { platform: 'pdd', source, goods_name: item.goods_name || '', goods_desc: item.goods_desc || item.goods_name || '', brand_name: item.brand_name || '', shop_name: item.mall_name || '', goods_image_url: item.goods_image_url || '', goods_thumbnail_url: item.goods_thumbnail_url || item.goods_image_url || '', goods_id: String(item.goods_id || ''), goods_sign: item.goods_sign || '', sales_tip: item.sales_tip || '', min_group_price_yuan: yuanFromFen(price), coupon_discount_yuan: yuanFromFen(coupon), coupon_price_yuan: yuanFromFen(final || price), has_coupon: coupon > 0, unified_tags: ['拼多多'], material_url: item.goods_url || '', url: item.goods_url || '', raw: item };
}
// 检测是否是拼多多/杨可多商品 URL，返回 { goodsId, goodsSign, ps } 或 null
function parsePddUrl(q) {
  const PDD_HOSTS = ['yangkeduo.com', 'pinduoduo.com', 'mobile.pdd.com'];
  try {
    const raw = String(q || '').trim();
    if (!raw.includes('.')) return null;
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    if (!PDD_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) return null;
    const goodsId = u.searchParams.get('goods_id') || u.searchParams.get('goodsId') || '';
    const goodsSign = u.searchParams.get('goods_sign') || u.searchParams.get('goodsSign') || '';
    const ps = u.searchParams.get('ps') || '';
    return { goodsId, goodsSign, ps };
  } catch {
    return null;
  }
}

// 按 goods_id 或 goods_sign 直查商品详情（铁律1：真实接口，不造假）
async function pddGoodsDetail(goodsId, goodsSign) {
  const biz = { pid: PDD_PID, custom_parameters: PDD_CUSTOM_PARAMETERS };
  if (goodsSign) biz.goods_sign_list = JSON.stringify([goodsSign]);
  else if (goodsId) biz.goods_id_list = JSON.stringify([Number(goodsId)]);
  else return { ok: false, platform: 'pdd', error: 'missing_goods_id_or_sign', goods_list: [], total_count: 0 };
  const raw = await pddRequest('pdd.ddk.goods.detail', biz);
  if (raw.error || raw.error_response) return { ok: false, platform: 'pdd', error: raw.error || raw.error_response, goods_list: [], total_count: 0, raw };
  const list = asArray((raw.goods_detail_response && raw.goods_detail_response.goods_list) || raw.goods_list || []);
  return { ok: list.length > 0, platform: 'pdd', source: 'pdd.ddk.goods.detail', mode: 'url_lookup',
    total_count: list.length, goods_list: list.map(x => normalizePdd(x, 'pdd.ddk.goods.detail')), raw };
}

// ps-only 分享链接：跟随 HTTP 302 重定向，从落地 URL 提取 goods_id（5 秒超时，不保存任何 cookie）
function followPddRedirect(psUrl) {
  return new Promise(resolve => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    function doReq(url, hops) {
      if (hops > 5) return resolve('');
      try {
        const u = new URL(url);
        const cli = u.protocol === 'http:' ? http : https;
        const req = cli.request({ method: 'GET', hostname: u.hostname, path: u.pathname + u.search, port: u.port || (u.protocol === 'http:' ? 80 : 443), timeout: 5000, headers: { 'User-Agent': ua, 'Accept': 'text/html' } }, res => {
          res.resume();
          const loc = res.headers.location || '';
          if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && loc) {
            try {
              const next = new URL(loc.startsWith('/') ? `${u.protocol}//${u.hostname}${loc}` : loc);
              const gid = next.searchParams.get('goods_id') || next.searchParams.get('goodsId') || '';
              if (gid) return resolve(gid);
              doReq(next.href, hops + 1);
            } catch { resolve(''); }
          } else { resolve(''); }
        });
        req.on('timeout', () => { req.destroy(); resolve(''); });
        req.on('error', () => resolve(''));
        req.end();
      } catch { resolve(''); }
    }
    doReq(psUrl, 0);
  });
}

async function searchPdd(q, pageSize = 20) {
  const pddUrl = parsePddUrl(q);
  if (pddUrl) {
    if (pddUrl.goodsId || pddUrl.goodsSign) return pddGoodsDetail(pddUrl.goodsId, pddUrl.goodsSign);
    if (pddUrl.ps) {
      console.log('[PDD] ps-only link, following redirect to resolve goods_id');
      const goodsId = await followPddRedirect(q);
      if (goodsId) return pddGoodsDetail(goodsId, '');
      return { ok: false, platform: 'pdd', error: 'ps_link_unresolvable', mode: 'url_lookup',
        hint: '该分享链接无法从服务器侧解析商品 ID，请在手机浏览器打开后复制含 goods_id 的完整链接',
        goods_list: [], total_count: 0 };
    }
  }
  const size = Math.min(Math.max(1, Number(pageSize) || 20), 100);
  const raw = await pddRequest('pdd.ddk.goods.search', { keyword: q, pid: PDD_PID, page: 1, page_size: size, custom_parameters: PDD_CUSTOM_PARAMETERS });
  if (raw.error || raw.error_response) return { ok: false, platform: 'pdd', keyword: q, total_count: 0, goods_list: [], raw };
  const list = raw.goods_search_response && raw.goods_search_response.goods_list ? asArray(raw.goods_search_response.goods_list) : [];
  return { ok: true, platform: 'pdd', source: 'pdd.ddk.goods.search', keyword: q, total_count: list.length, goods_list: list.map(x => normalizePdd(x)), raw };
}
async function pddLink(body) {
  const goodsSign = body.goods_sign || body.goodsSign || '', goodsId = body.goods_id || body.goodsId || '';
  const biz = { p_id: PDD_PID, generate_short_url: 'true', custom_parameters: PDD_CUSTOM_PARAMETERS };
  if (goodsSign) biz.goods_sign_list = JSON.stringify([goodsSign]); else if (goodsId) biz.goods_id_list = JSON.stringify([Number(goodsId)]); else return { ok: false, platform: 'pdd', error: 'missing_goods_sign_or_id' };
  const raw = await pddRequest('pdd.ddk.goods.promotion.url.generate', biz);
  const list = raw.goods_promotion_url_generate_response && raw.goods_promotion_url_generate_response.goods_promotion_url_list ? asArray(raw.goods_promotion_url_generate_response.goods_promotion_url_list) : [];
  const first = list[0] || {};
  const url = first.short_url || first.mobile_short_url || first.url || first.mobile_url || '';
  return { ok: !!url, platform: 'pdd', url, material_url: url, raw };
}

// ---------- JD ----------
// JD_POSITION_ID and JD_PID must be set via Render env vars — no hardcoded defaults.
// Auto-fallback: if goods.query returns a permission error, retries with jingfen.query.
const JD_API_URL = envFirst('JD_API_URL') || 'https://api.jd.com/routerjson';
const JD_APP_KEY = envFirst('JD_APP_KEY', 'JD_APPKEY', 'APP_KEY');
const JD_APP_SECRET = envFirst('JD_APP_SECRET', 'JD_APPSECRET', 'APP_SECRET');
const JD_ACCESS_TOKEN = envFirst('JD_ACCESS_TOKEN', 'JD_TOKEN');
const JD_POSITION_ID = envFirst('JD_POSITION_ID', 'JD_POSITIONID');
const JD_PID = envFirst('JD_PID');
const JD_SITE_ID = envFirst('JD_SITE_ID', 'JD_SITEID') || (JD_PID ? JD_PID.split('_')[1] || '' : '');
const JD_SEARCH_METHOD = envFirst('JD_SEARCH_METHOD') || 'jd.union.open.goods.query';
const JD_PROMOTION_METHOD = envFirst('JD_PROMOTION_METHOD') || 'jd.union.open.promotion.common.get';
const JD_JINGFEN_METHOD = 'jd.union.open.goods.jingfen.query';
const JD_PLAYWRIGHT_ENABLED = String(process.env.JD_PLAYWRIGHT_ENABLED || 'true').toLowerCase() !== 'false';
function jdTimestamp() { const d = new Date(Date.now() + 8 * 3600000); const p = n => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; }
function jdSign(params) { let s = JD_APP_SECRET; Object.keys(params).sort().forEach(k => { s += k + params[k]; }); return md5Upper(s + JD_APP_SECRET); }
async function jdRequest(method, biz = {}) {
  if (!JD_APP_KEY || !JD_APP_SECRET) return { error: 'missing_jd_env' };
  const params = cleanParams({ method, app_key: JD_APP_KEY, access_token: JD_ACCESS_TOKEN, timestamp: jdTimestamp(), format: 'json', v: '1.0', sign_method: 'md5', '360buy_param_json': JSON.stringify(biz) });
  params.sign = jdSign(params);
  return postForm(JD_API_URL, params);
}
function normalizeJd(item, source = 'jd.union') {
  const skuId = String(item.skuId || item.sku_id || item.itemId || '');
  const priceInfo = item.priceInfo || item.price_info || {};
  const couponInfo = item.couponInfo || item.coupon_info || {};
  const imageInfo = item.imageInfo || item.image_info || {};
  const images = imageInfo.imageList || imageInfo.image_list || [];
  const price = Number(priceInfo.price || priceInfo.lowestPrice || item.price || 0);
  const coupon = Number(couponInfo.discount || 0);
  const url = skuId ? `https://item.jd.com/${skuId}.html` : '';
  return { platform: 'jd', source, goods_name: item.skuName || item.goodsName || item.name || '', goods_desc: item.skuName || '', brand_name: item.brandName || '', shop_name: item.shopName || '', goods_image_url: httpsUrl((images[0] && (images[0].url || images[0].imageUrl)) || item.imageUrl || ''), goods_thumbnail_url: httpsUrl((images[0] && (images[0].url || images[0].imageUrl)) || item.imageUrl || ''), sku_id: skuId, goods_id: skuId, sales_tip: item.comments || item.inOrderCount30Days || '', min_group_price_yuan: price, coupon_discount_yuan: coupon, coupon_price_yuan: Math.max(0, price - coupon) || price, has_coupon: coupon > 0, unified_tags: ['京东'], material_url: url, url, raw: item };
}

// Parse JD response — handles both goods.query and jingfen.query response key names
function parseJdResponse(raw) {
  if (raw.error || raw.error_response) return { httpError: (raw.error_response && (raw.error_response.zh_desc || raw.error_response.en_desc)) || raw.error };
  const resp = raw.jd_union_open_goods_query_response || raw.jd_union_open_goods_query_responce ||
                raw.jd_union_open_goods_jingfen_query_response || {};
  const resultText = resp.result || resp.queryResult;
  const parsed = parseJsonMaybe(resultText) || {};
  return { parsed, resp };
}

// 返回 true 表示是权限不足错误，需要降级到 jingfen.query
function isJdPermissionError(parsed) {
  const code = String(parsed.code || '');
  const msg  = (parsed.message || '').toLowerCase();
  return ['52', '403', '50', '51'].includes(code) ||
    msg.includes('权限') || msg.includes('permission') || msg.includes('unauthorized') || msg.includes('not auth');
}

async function searchJd(q, pageSize = 20) {
  const posId = Number(JD_POSITION_ID) || undefined;
  const goodsReq = { keyword: q, pageIndex: 1, pageSize: Math.min(Math.max(1, Number(pageSize) || 20), 30) };
  if (posId) goodsReq.positionId = posId;

  // First attempt with configured method (default: goods.query)
  const raw = await jdRequest(JD_SEARCH_METHOD, { goodsReq });
  const first = parseJdResponse(raw);

  if (first.httpError) {
    if (JD_PLAYWRIGHT_ENABLED && jdPlaywrightMod) {
      console.log('[JD] Union API HTTP error, trying Playwright fallback');
      return jdPlaywrightMod.searchJdPlaywright(q, pageSize);
    }
    return { ok: false, platform: 'jd', keyword: q, total_count: 0, goods_list: [], error: first.httpError, raw };
  }

  // Auto-fallback: goods.query permission error → jingfen.query
  let parsed = first.parsed;
  let usedMethod = JD_SEARCH_METHOD;
  let finalRaw = raw;

  if (parsed.code !== undefined && Number(parsed.code) !== 0 &&
      isJdPermissionError(parsed) &&
      JD_SEARCH_METHOD === 'jd.union.open.goods.query') {
    console.log(`[JD] goods.query permission error (code=${parsed.code}), auto-retrying with jingfen.query`);
    const raw2 = await jdRequest(JD_JINGFEN_METHOD, { goodsReq });
    const second = parseJdResponse(raw2);
    if (!second.httpError && !(second.parsed.code !== undefined && Number(second.parsed.code) !== 0)) {
      parsed = second.parsed;
      usedMethod = JD_JINGFEN_METHOD + ' (auto-fallback)';
      finalRaw = raw2;
    }
  }

  if (parsed.code !== undefined && Number(parsed.code) !== 0) {
    if (JD_PLAYWRIGHT_ENABLED && jdPlaywrightMod) {
      console.log(`[JD] Union API error (code=${parsed.code}), trying Playwright fallback`);
      return jdPlaywrightMod.searchJdPlaywright(q, pageSize);
    }
    return { ok: false, platform: 'jd', keyword: q, total_count: 0, goods_list: [],
      error: 'jd_api_error', jd_code: parsed.code, jd_message: parsed.message || '',
      hint: isJdPermissionError(parsed) ? '可在 union.jd.com 申请接口权限，或手动设置 JD_SEARCH_METHOD=jd.union.open.goods.jingfen.query' : undefined,
      raw: finalRaw };
  }

  const dataArr = Array.isArray(parsed.data) ? parsed.data
    : findDeep(parsed || finalRaw, x => x && (x.skuId || x.skuName || x.goodsName)).slice(0, 20);
  const goods = dataArr.map(x => normalizeJd(x, usedMethod));
  return { ok: goods.length > 0, platform: 'jd', source: usedMethod, keyword: q,
    total_count: goods.length, goods_list: goods, jd_code: parsed.code, jd_message: parsed.message, raw: finalRaw };
}

async function jdLink(body) {
  const skuId = body.sku_id || body.skuId || '';
  const materialId = body.material_url || body.materialId || body.url || (skuId ? `https://item.jd.com/${skuId}.html` : '');
  if (!materialId) return { ok: false, platform: 'jd', error: 'missing_material_id' };
  const raw = await jdRequest(JD_PROMOTION_METHOD, { promotionCodeReq: cleanParams({ materialId, couponUrl: body.coupon_url || body.couponUrl || '', siteId: JD_SITE_ID, positionId: JD_POSITION_ID }) });
  function findUrl(v, depth) {
    if (!v || depth > 8) return ''; if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
    if (typeof v === 'object') { for (const val of Object.values(v)) { const u = findUrl(val, depth + 1); if (u) return u; } }
    return '';
  }
  const url = findUrl(raw, 0);
  return { ok: !!url, platform: 'jd', url, material_url: url, raw };
}

// ---------- Taobao ----------
const TB_API_URL = envFirst('TB_API_URL') || 'https://eco.taobao.com/router/rest';
const TB_API_FALLBACK_URL = envFirst('TB_API_FALLBACK_URL') || 'http://gw.api.taobao.com/router/rest';
const TB_APP_KEY = envFirst('TB_APP_KEY', 'TAOBAO_APP_KEY', 'ALIMAMA_APP_KEY');
const TB_APP_SECRET = envFirst('TB_APP_SECRET', 'TAOBAO_APP_SECRET', 'ALIMAMA_APP_SECRET');
let TB_ADZONE_ID = envFirst('TB_ADZONE_ID', 'TAOBAO_ADZONE_ID', 'ADZONE_ID');
const TB_PID = envFirst('TB_PID', 'TAOBAO_PID');
const TB_ENABLED = String(process.env.TB_ENABLED || '').toLowerCase() === 'true';
const TB_SEARCH_METHOD = envFirst('TB_SEARCH_METHOD') || 'taobao.tbk.dg.material.optional.upgrade';
const TB_ITEM_METHOD = envFirst('TB_ITEM_METHOD') || 'taobao.tbk.item.info.get';
const TB_TIMEOUT_MS = Number(process.env.TB_TIMEOUT_MS || 6500);
(function normalizeAdzone() { const raw = String(TB_ADZONE_ID || TB_PID || '').trim(); const fromPid = raw.match(/(?:mm_)?\d+_\d+_(\d+)$/); const direct = raw.match(/^\d+$/); if (fromPid) TB_ADZONE_ID = fromPid[1]; else if (direct) TB_ADZONE_ID = raw; })();
function tbTimestamp() { const d = new Date(Date.now() + 8 * 3600000); const p = n => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; }
function tbSign(params) { let s = TB_APP_SECRET; Object.keys(params).sort().forEach(k => { s += k + String(params[k]); }); return md5Upper(s + TB_APP_SECRET); }
async function tbRequest(method, biz = {}) {
  if (!TB_ENABLED) return { error: 'tb_disabled' }; if (!TB_APP_KEY || !TB_APP_SECRET) return { error: 'missing_tb_env' };
  const params = cleanParams({ method, app_key: TB_APP_KEY, timestamp: tbTimestamp(), format: 'json', v: '2.0', sign_method: 'md5', ...biz });
  params.sign = tbSign(params);
  const errors = [];
  for (const endpoint of [TB_API_FALLBACK_URL, TB_API_URL].filter((x, i, a) => x && a.indexOf(x) === i)) {
    try { const raw = await postForm(endpoint, params, TB_TIMEOUT_MS); raw.__endpoint = endpoint; return raw; }
    catch (e) { errors.push({ endpoint, code: e.code || '', message: e.message || String(e) }); }
  }
  return { error: 'tb_request_failed', detail: errors };
}
function pickTbItems(raw) {
  const direct = raw && raw.tbk_dg_material_optional_upgrade_response && raw.tbk_dg_material_optional_upgrade_response.result_list && raw.tbk_dg_material_optional_upgrade_response.result_list.map_data;
  if (Array.isArray(direct)) return direct.slice(0, 20);
  const out = []; findDeep(raw, x => x && (x.item_basic_info || x.price_promotion_info || x.publish_info || x.num_iid || x.item_id || x.title || x.short_title), 1000).forEach(x => out.push(x));
  const seen = new Set();
  return out.filter(x => { const b = x.item_basic_info || x.basic_info || x; const numIid = String(x.item_id || b.num_iid || b.item_id || ''); const titleKey = String(b.title || b.short_title || b.raw_title || x.title || ''); const key = numIid || titleKey || String(Math.random()); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 20);
}
function normalizeTb(item, source = 'tb.material.search') {
  const basic = item.item_basic_info || item.basic_info || item; const promo = item.price_promotion_info || {}; const publish = item.publish_info || {};
  const title = basic.title || basic.short_title || basic.raw_title || item.title || '淘宝商品';
  const image = basic.pict_url || basic.pic_url || basic.white_image || item.pict_url || '';
  const promoList = promo.final_promotion_path_list && promo.final_promotion_path_list.final_promotion_path_map_data;
  const coupon = Array.isArray(promoList) && promoList[0] ? promoList[0] : {};
  const price = Number(promo.final_promotion_price || item.final_promotion_price || basic.zk_final_price || basic.reserve_price || basic.price || 0);
  const couponDiscount = Number(coupon.promotion_fee || 0);
  const direct = httpsUrl(publish.click_url || publish.coupon_share_url || basic.item_url || item.item_url || item.detail_url || basic.detail_url || item.goods_url || basic.goods_url || item.url || '');
  const url = direct || (title ? `https://s.m.taobao.com/h5?q=${encodeURIComponent(title)}` : '');
  return { platform: 'tb', source, goods_name: title, goods_desc: basic.sub_title || title, brand_name: basic.brand_name || '', shop_name: basic.shop_title || basic.nick || '', goods_image_url: httpsUrl(image), goods_thumbnail_url: httpsUrl(image), goods_id: String(item.item_id || basic.num_iid || basic.item_id || ''), num_iid: String(item.item_id || basic.num_iid || basic.item_id || ''), sales_tip: String(basic.annual_vol || basic.tk_total_sales || basic.volume || ''), min_group_price_yuan: price, coupon_discount_yuan: couponDiscount, coupon_price_yuan: price, has_coupon: couponDiscount > 0, unified_tags: ['淘宝'], material_url: url, url, item_url: url, direct_buy_url: !!direct, buy_link_status: direct ? 'direct' : 'fallback_search', raw: item };
}
async function searchTb(q, pageSize = 20) {
  if (!TB_ENABLED) return { ok: false, platform: 'tb', keyword: q, total_count: 0, goods_list: [], error: 'tb_disabled' };
  if (!TB_ADZONE_ID) return { ok: false, platform: 'tb', keyword: q, total_count: 0, goods_list: [], error: 'missing_tb_adzone_id' };
  const size = Math.min(Math.max(1, Number(pageSize) || 20), 100);
  const raw = await tbRequest(TB_SEARCH_METHOD, { adzone_id: TB_ADZONE_ID, q, page_size: size, page_no: 1, platform: 2 });
  const failed = raw && (raw.error_response || raw.error || raw.code);
  const items = failed ? [] : pickTbItems(raw).map(x => normalizeTb(x, 'tb.material.search'));
  return { ok: !failed, platform: 'tb', mode: 'keyword_search', source: 'tb.material.search', keyword: q, total_count: items.length, q, goods_list: items, raw };
}
async function tbItem(input) {
  const id = String(input || '').match(/\d{8,16}/)?.[0] || ''; if (!id) return { ok: false, platform: 'tb', error: 'missing_item_id' };
  const fields = 'num_iid,title,pict_url,small_images,reserve_price,zk_final_price,user_type,provcity,item_url,nick,seller_id,volume,cat_name,shop_title';
  const raw = await tbRequest(TB_ITEM_METHOD, { fields, num_iids: id, platform: 2 });
  const items = pickTbItems(raw).map(x => normalizeTb(x, 'tb.item.info'));
  return { ok: !(raw.error_response || raw.error || raw.code), platform: 'tb', mode: 'item_detail', item_id: id, goods: items[0] || null, goods_list: items, raw };
}

// ---------- Douyin 精选联盟 ----------
const DOUYIN_OPEN_API = 'https://open.douyin.com';
const DY_CLIENT_KEY    = envFirst('DOUYIN_CLIENT_KEY');
const DY_CLIENT_SECRET = envFirst('DOUYIN_CLIENT_SECRET');
const DY_REDIRECT_URI  = envFirst('DOUYIN_REDIRECT_URI');
const DOUYIN_ENABLED     = String(process.env.DOUYIN_ENABLED || '').toLowerCase() === 'true';
const DOUYIN_CONFIGURED  = !!(DY_CLIENT_KEY && DY_CLIENT_SECRET);
const dyToken = {
  access_token:  envFirst('DOUYIN_ACCESS_TOKEN'),
  refresh_token: envFirst('DOUYIN_REFRESH_TOKEN'),
  open_id:       envFirst('DOUYIN_OPEN_ID'),
  expires_at: 0
};
function dyHasToken() { return !!dyToken.access_token; }
async function dyExchangeCode(code) {
  const raw = await postForm(`${DOUYIN_OPEN_API}/oauth/access_token/`, {
    client_key: DY_CLIENT_KEY, client_secret: DY_CLIENT_SECRET, code, grant_type: 'authorization_code'
  });
  const d = raw && raw.data;
  if (d && d.access_token) {
    dyToken.access_token = d.access_token; dyToken.refresh_token = d.refresh_token;
    dyToken.open_id = d.open_id; dyToken.expires_at = Date.now() + (Number(d.expires_in) || 1296000) * 1000;
    console.log('[Douyin OAuth] Token obtained. Paste into Render env vars:');
    console.log(`  DOUYIN_ACCESS_TOKEN=${d.access_token}`);
    console.log(`  DOUYIN_REFRESH_TOKEN=${d.refresh_token}`);
    console.log(`  DOUYIN_OPEN_ID=${d.open_id}`);
  }
  return raw;
}
async function dyRefreshToken() {
  if (!dyToken.refresh_token) return false;
  try {
    const raw = await postForm(`${DOUYIN_OPEN_API}/oauth/refresh_token/`, {
      client_key: DY_CLIENT_KEY, grant_type: 'refresh_token', refresh_token: dyToken.refresh_token
    });
    const d = raw && raw.data;
    if (d && d.access_token) {
      dyToken.access_token = d.access_token; dyToken.refresh_token = d.refresh_token || dyToken.refresh_token;
      dyToken.open_id = d.open_id || dyToken.open_id; dyToken.expires_at = Date.now() + (Number(d.expires_in) || 1296000) * 1000;
      console.log('[Douyin OAuth] Token refreshed. Update DOUYIN_ACCESS_TOKEN in Render:', d.access_token.slice(0, 8) + '...');
      return true;
    }
  } catch (e) { console.error('[Douyin OAuth] Refresh failed:', e.message); }
  return false;
}
async function dyEnsureToken() {
  if (!dyHasToken()) return { ok: false, error: 'missing_access_token', hint: 'Visit /api/douyin/oauth-start' };
  if (dyToken.expires_at && Date.now() > dyToken.expires_at - 3600000) {
    const refreshed = await dyRefreshToken();
    if (!refreshed) return { ok: false, error: 'token_expired_refresh_failed', hint: 'Re-do OAuth at /api/douyin/oauth-start' };
  }
  return { ok: true };
}
function dyGet(path, params = {}, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(cleanParams(params)).toString();
    const req = https.request({
      method: 'GET', hostname: 'open.douyin.com', path: path + (qs ? '?' + qs : ''), port: 443, timeout: timeoutMs,
      headers: { 'Access-Token': dyToken.access_token, 'client-key': DY_CLIENT_KEY, 'User-Agent': 'Jiabibi/9.2' }
    }, res => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('non_json ' + data.slice(0, 200))); } });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('request_timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject); req.end();
  });
}
function dyPost(path, payload, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const req = https.request({
      method: 'POST', hostname: 'open.douyin.com', path, port: 443, timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Access-Token': dyToken.access_token, 'client-key': DY_CLIENT_KEY, 'User-Agent': 'Jiabibi/9.2' }
    }, res => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('non_json ' + data.slice(0, 200))); } });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('request_timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject); req.write(body); req.end();
  });
}
function normalizeDouyinProduct(p) {
  const priceFen = Number(p.market_price || p.price || 0), discountFen = Number(p.coupon_amount || 0);
  const finalFen = Math.max(0, priceFen - discountFen) || priceFen;
  const image = p.cover || (Array.isArray(p.images) && p.images[0]) || '';
  const url = p.product_url || p.schema_url || '';
  return { platform: 'douyin', source: 'douyin.jxlm.product.search', goods_name: p.title || p.product_name || '抖音商品', goods_desc: p.desc || p.title || '', brand_name: p.brand || '', shop_name: p.shop_name || '', goods_image_url: httpsUrl(image), goods_thumbnail_url: httpsUrl(image), goods_id: String(p.product_id || ''), product_id: String(p.product_id || ''), sales_tip: p.sold_count ? String(p.sold_count) + '销量' : '', min_group_price_yuan: yuanFromFen(priceFen), coupon_discount_yuan: yuanFromFen(discountFen), coupon_price_yuan: yuanFromFen(finalFen), has_coupon: discountFen > 0, commission_ratio: p.cos_ratio || 0, unified_tags: ['抖音'], material_url: url, url, raw: p };
}
async function searchDouyin(q, page = 1, pageSize = 20) {
  if (!DOUYIN_ENABLED) return { ok: false, platform: 'douyin', keyword: q, total_count: 0, goods_list: [], status: 'disabled', hint: 'Set DOUYIN_ENABLED=true' };
  if (!DOUYIN_CONFIGURED) return { ok: false, platform: 'douyin', keyword: q, total_count: 0, goods_list: [], status: 'not_configured', hint: 'Set DOUYIN_CLIENT_KEY and DOUYIN_CLIENT_SECRET' };
  const tokenCheck = await dyEnsureToken();
  if (!tokenCheck.ok) return { ok: false, platform: 'douyin', keyword: q, total_count: 0, goods_list: [], ...tokenCheck };
  try {
    const raw = await dyGet('/buyin/openapi/v1/product/search/', { keyword: q, page: String(Number(page) || 1), page_size: String(Math.min(Number(pageSize) || 20, 50)) });
    const ok = raw && (raw.err_no === 0 || (raw.err_no === undefined && !raw.err_tips));
    const products = asArray((raw && raw.data && (raw.data.products || raw.data.list)) || raw.products || []);
    return { ok: ok && products.length > 0, platform: 'douyin', source: 'douyin.jxlm.product.search', keyword: q, total_count: (raw && raw.data && raw.data.total) || products.length, goods_list: ok ? products.map(p => normalizeDouyinProduct(p)) : [], dy_err_no: raw && raw.err_no, dy_err_tips: raw && raw.err_tips, raw };
  } catch (e) {
    return { ok: false, platform: 'douyin', keyword: q, total_count: 0, goods_list: [], error: e.message };
  }
}
async function douyinLink(body) {
  if (!DOUYIN_ENABLED || !DOUYIN_CONFIGURED) return { ok: false, platform: 'douyin', status: DOUYIN_CONFIGURED ? 'disabled' : 'not_configured' };
  const tokenCheck = await dyEnsureToken();
  if (!tokenCheck.ok) return { ok: false, platform: 'douyin', ...tokenCheck };
  const productId = String(body.product_id || body.goods_id || ''), productUrl = body.product_url || body.material_url || body.url || '';
  if (!productId && !productUrl) return { ok: false, platform: 'douyin', error: 'missing_product_id_or_url' };
  try {
    const payload = { external_info: body.external_info || 'jiabibi' };
    if (productId) payload.product_id = productId;
    if (productUrl) payload.product_url = productUrl;
    const raw = await dyPost('/buyin/openapi/v1/product/url/generate/', payload);
    const ok = raw && raw.err_no === 0;
    const data = (raw && raw.data) || {};
    const url = data.promotion_url || data.link || data.url || '';
    return { ok: ok && !!url, platform: 'douyin', url, material_url: url, raw };
  } catch (e) { return { ok: false, platform: 'douyin', error: e.message }; }
}
function douyinStatusInfo() {
  return { enabled: DOUYIN_ENABLED, configured: DOUYIN_CONFIGURED, has_token: dyHasToken(), open_id: dyToken.open_id || '', token_expires_at: dyToken.expires_at ? new Date(dyToken.expires_at).toISOString() : 'unknown', oauth_start: '/api/douyin/oauth-start', platform: 'douyin.jxlm' };
}

function providerStatus() {
  return [
    { platform: 'pdd', name: '拼多多', configured: !!(PDD_CLIENT_ID && PDD_CLIENT_SECRET && PDD_PID), search: true, link: true, source: 'pdd.ddk' },
    { platform: 'jd',  name: '京东',  configured: !!(JD_APP_KEY && JD_APP_SECRET), search: true, link: true, source: 'jd.union',
      jd_search_method: JD_SEARCH_METHOD, auto_fallback: '权限错误自动降级 goods.query → jingfen.query → Playwright',
      playwright_enabled: JD_PLAYWRIGHT_ENABLED && !!jdPlaywrightMod },
    { platform: 'tb',  name: '淘宝',  configured: !!(TB_APP_KEY && TB_APP_SECRET && TB_ADZONE_ID), enabled: TB_ENABLED, search: true, link: true, source: 'taobao TOP / alimama' },
    { platform: 'douyin', name: '抖音', ...douyinStatusInfo(), search: DOUYIN_ENABLED && DOUYIN_CONFIGURED && dyHasToken(), link: DOUYIN_ENABLED && DOUYIN_CONFIGURED && dyHasToken(), source: 'open.douyin.com / buyin' }
  ];
}

async function parseInput(req, url) {
  const rawBody = req.method === 'POST' ? await readBody(req) : '';
  let body = {}; try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
  const q = String(body.q || body.keyword || url.searchParams.get('q') || url.searchParams.get('keyword') || url.searchParams.get('kw') || '').trim();
  const rawPlatform = String(body.platform || body.provider || url.searchParams.get('platform') || url.searchParams.get('provider') || '').trim();
  // 'all' 和空字符串都代表全平台搜索，统一为 ''
  const platform = rawPlatform === 'all' ? '' : rawPlatform;
  const pageSize = Number(body.page_size || url.searchParams.get('page_size') || 20);
  return { body, q, platform, pageSize };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/sandbox/') || url.pathname === '/api/sandbox/session') {
      if (!sandboxMod) return sendJson(res, 501, { ok: false, error: 'sandbox_module_not_loaded' });
      return sandboxMod.handleSandbox(req, res, url);
    }
    if (url.pathname === '/' || url.pathname === '/health') {
      const h = { ok: true, name: '价比比 API', runtime: 'server', version: '9.4', pdd_configured: !!(PDD_CLIENT_ID && PDD_CLIENT_SECRET && PDD_PID), jd_configured: !!(JD_APP_KEY && JD_APP_SECRET), jd_auto_fallback: 'enabled', tb_enabled: TB_ENABLED, tb_configured: !!(TB_APP_KEY && TB_APP_SECRET && TB_ADZONE_ID), douyin_enabled: DOUYIN_ENABLED, douyin_configured: DOUYIN_CONFIGURED, douyin_has_token: dyHasToken(), provider_status: '/api/providers/status', health_deep: '/api/health/deep', douyin_oauth: '/api/douyin/oauth-start', compare_api: '/api/compare?q=小米充电宝' };
      if (sandboxMod) Object.assign(h, sandboxMod.sandboxHealthInfo());
      return sendJson(res, 200, h);
    }
    if (url.pathname === '/api/providers/status')
      return sendJson(res, 200, { ok: true, runtime: 'server', version: '9.4', providers: providerStatus() });

    // 实时探针各平台。小心：会真实发起 API 请求
if (url.pathname === '/api/health/deep') {
      const q = url.searchParams.get('q') || '充电宝';
      const [pddR, jdR, tbR] = await Promise.allSettled([searchPdd(q), searchJd(q), searchTb(q)]);
      const p = r => r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || String(r.reason) };
      const pddRes = p(pddR), jdRes = p(jdR), tbRes = p(tbR);
      return sendJson(res, 200, {
        ok: true, q, runtime: 'server', version: '9.4', ts: new Date().toISOString(),
        pdd: { ok: pddRes.ok, count: pddRes.goods_list?.length || 0, error: pddRes.error || null },
        jd:  { ok: jdRes.ok,  count: jdRes.goods_list?.length  || 0, source: jdRes.source, jd_code: jdRes.jd_code, jd_message: jdRes.jd_message, error: jdRes.error || null },
        tb:  { ok: tbRes.ok,  count: tbRes.goods_list?.length  || 0, enabled: TB_ENABLED, error: tbRes.error || null },
        douyin: douyinStatusInfo()
      });
    }

    if (url.pathname === '/api/douyin/oauth-start') {
      if (!DOUYIN_CONFIGURED) return sendJson(res, 400, { ok: false, error: 'missing_douyin_credentials', hint: 'Set DOUYIN_CLIENT_KEY, DOUYIN_CLIENT_SECRET, DOUYIN_REDIRECT_URI in Render env vars' });
      const scope = 'user_info,buyin.product.search,buyin.product.url';
      const authUrl = `${DOUYIN_OPEN_API}/platform/oauth/connect/?client_key=${DY_CLIENT_KEY}&response_type=code&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(DY_REDIRECT_URI || '')}&state=jiabibi`;
      const acceptsHtml = (req.headers.accept || '').includes('text/html');
      if (acceptsHtml) return sendRedirect(res, authUrl);
      return sendJson(res, 200, { ok: true, message: '在浏览器打开授权链接', auth_url: authUrl });
    }
    if (url.pathname === '/api/douyin/oauth-callback') {
      const code = url.searchParams.get('code') || '';
      if (!code) return sendJson(res, 400, { ok: false, error: 'missing_code' });
      if (!DOUYIN_CONFIGURED) return sendJson(res, 400, { ok: false, error: 'missing_douyin_credentials' });
      const raw = await dyExchangeCode(code);
      const ok = !!(raw && raw.data && raw.data.access_token);
      return sendJson(res, ok ? 200 : 400, { ok, platform: 'douyin', message: ok ? 'OAuth 成功！请将 Render 日志中的 token 复制到环境变量。' : 'OAuth 失败', open_id: ok ? raw.data.open_id : '', expires_in: ok ? raw.data.expires_in : 0, raw: ok ? undefined : raw });
    }
    if (url.pathname === '/api/douyin/status') return sendJson(res, 200, { ok: true, ...douyinStatusInfo() });

    if (url.pathname === '/api/diag') {
      const q = (url.searchParams.get('q') || url.searchParams.get('keyword') || '').trim();
      if (!q) return sendJson(res, 400, { error: 'missing_keyword', hint: 'add ?q=小米充电宝' });
      const posId = Number(JD_POSITION_ID) || undefined;
      const jdGoodsReq = { keyword: q, pageIndex: 1, pageSize: 10 };
      if (posId) jdGoodsReq.positionId = posId;
      const [jdR, pddR] = await Promise.allSettled([jdRequest(JD_SEARCH_METHOD, { goodsReq: jdGoodsReq }), pddRequest('pdd.ddk.goods.search', { keyword: q, pid: PDD_PID, page: 1, page_size: 10 })]);
      return sendJson(res, 200, { ok: true, q, runtime: 'server', version: '9.4', jd: jdR.status === 'fulfilled' ? jdR.value : { fetch_error: String(jdR.reason) }, pdd: pddR.status === 'fulfilled' ? { total_count: (pddR.value.goods_search_response || {}).total_count, goods_count: ((pddR.value.goods_search_response || {}).goods_list || []).length, ok: true } : { fetch_error: String(pddR.reason) }, douyin: douyinStatusInfo() });
    }

    const { body, q, platform, pageSize } = await parseInput(req, url);
    if (url.pathname === '/api/compare') {
      if (!q) return sendJson(res, 400, { ok: false, error: 'missing_keyword' });
      const providerErrors = {};
      const runProvider = async (name, fn) => { try { return await fn(q); } catch (e) { providerErrors[name] = e.message || String(e); return { ok: false, platform: name, keyword: q, total_count: 0, goods_list: [], error: providerErrors[name] }; } };
      const tasks = [runProvider('pdd', searchPdd), runProvider('jd', searchJd), runProvider('tb', searchTb)];
      if (DOUYIN_ENABLED && DOUYIN_CONFIGURED && dyHasToken()) tasks.push(runProvider('douyin', searchDouyin));
      const [pdd, jd, tb, douyin] = await Promise.all(tasks);
      const providers = { pdd, jd, tb, douyin: douyin || { ok: false, platform: 'douyin', status: douyinStatusInfo(), goods_list: [], total_count: 0 } };
      const counts = { pdd: pdd.goods_list?.length || 0, jd: jd.goods_list?.length || 0, tb: tb.goods_list?.length || 0, douyin: douyin?.goods_list?.length || 0 };
      const allGoods = [...(pdd.goods_list || []), ...(jd.goods_list || []), ...(tb.goods_list || []), ...(douyin?.goods_list || [])];
      return sendJson(res, 200, { ok: true, runtime: 'server', version: '9.4', q, counts, provider_errors: providerErrors, providers, goods_list: allGoods });
    }
    if (url.pathname === '/api/douyin/search') { if (!q) return sendJson(res, 400, { ok: false, platform: 'douyin', error: 'missing_keyword' }); return sendJson(res, 200, await searchDouyin(q, Number(url.searchParams.get('page') || body.page || 1), Number(url.searchParams.get('page_size') || body.page_size || 20))); }
    if (url.pathname === '/api/douyin/link') return sendJson(res, 200, await douyinLink({ ...body, product_id: body.product_id || url.searchParams.get('product_id'), product_url: body.product_url || url.searchParams.get('product_url') }));
    if (url.pathname === '/api/tb/search' || url.pathname === '/api/tb/real-search') { if (!q) return sendJson(res, 400, { ok: false, platform: 'tb', error: 'missing_keyword' }); return sendJson(res, 200, await searchTb(q)); }
    if (url.pathname === '/api/tb/item' || url.pathname === '/api/tb/link') { const input = body.item_id || body.num_iid || body.id || body.url || body.material_url || url.searchParams.get('item_id') || url.searchParams.get('num_iid') || url.searchParams.get('id') || url.searchParams.get('url') || ''; return sendJson(res, 200, await tbItem(input)); }
    if (url.pathname === '/api/pdd/link') return sendJson(res, 200, await pddLink({ ...body, goods_sign: body.goods_sign || url.searchParams.get('goods_sign'), goods_id: body.goods_id || url.searchParams.get('goods_id') }));
    if (url.pathname === '/api/jd/search') { if (!q) return sendJson(res, 400, { ok: false, platform: 'jd', error: 'missing_keyword' }); return sendJson(res, 200, await searchJd(q, Math.min(Math.max(1, pageSize || 20), 100))); }
    if (url.pathname === '/api/jd/link') return sendJson(res, 200, await jdLink({ ...body, sku_id: body.sku_id || url.searchParams.get('sku_id'), material_url: body.material_url || url.searchParams.get('material_url') }));
    if (url.pathname === '/api/search' || url.pathname === '/api/search.json' || url.pathname === '/api/provider/search') {
      if (!q) return sendJson(res, 400, { ok: false, error: 'missing_keyword' });
      let result;
      const ps = Math.min(Math.max(1, pageSize || 20), 100);
      if (platform === 'tb') result = await searchTb(q, ps);
      else if (platform === 'pdd') result = await searchPdd(q, ps);
      else if (platform === 'jd') result = await searchJd(q, ps);
      else if (platform === 'douyin' || platform === 'dy') result = await searchDouyin(q);
      else {
        const tasks = [searchPdd(q, ps), searchJd(q, ps), searchTb(q, ps)];
        if (DOUYIN_ENABLED && DOUYIN_CONFIGURED && dyHasToken()) tasks.push(searchDouyin(q));
        const settled = await Promise.allSettled(tasks);
        const providers = settled.map(x => x.status === 'fulfilled' ? x.value : { ok: false, error: x.reason?.message || String(x.reason) });
        const goods = providers.flatMap(x => x.goods_list || []);
        result = { ok: true, q, keyword: q, providers, total_count: goods.length, best: cheapest(goods), goods_list: sortByPrice(goods) };
      }
      return sendJson(res, 200, result);
    }
    return sendJson(res, 404, { error: 'not_found', path: url.pathname });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error', message: e.message || String(e), stack: process.env.NODE_ENV === 'production' ? undefined : e.stack });
  }
}

http.createServer(handle).listen(PORT, () => console.log('Jiabibi server v9.4 listening on', PORT));
