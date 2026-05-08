// server-clean.js: clean, first-principles Jiabibi API runtime.
// One file, no eval patch chain. Goal: real search facts -> cheapest/buy path.
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}
function md5Upper(s) { return crypto.createHash('md5').update(String(s), 'utf8').digest('hex').toUpperCase(); }
function cleanParams(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  }
  return out;
}
function asArray(v) { return !v ? [] : (Array.isArray(v) ? v : [v]); }
function yuanFromFen(v) { return Math.round(Number(v || 0)) / 100; }
function httpsUrl(u) {
  if (!u) return '';
  const s = String(u).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://' + s.replace(/^\/\//, '');
}
function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(text);
}
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 2_000_000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}
function postForm(endpoint, params, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    let u;
    try { u = new URL(endpoint); } catch (e) { return reject(e); }
    const cli = u.protocol === 'http:' ? http : https;
    const req = cli.request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Jiabibi/clean-1.0'
      }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('non_json ' + data.slice(0, 200))); }
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('request_timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
function sortByPrice(goods) {
  return (goods || []).slice().sort((a, b) => Number(a.coupon_price_yuan || a.min_group_price_yuan || 0) - Number(b.coupon_price_yuan || b.min_group_price_yuan || 0));
}
function cheapest(goods) {
  return sortByPrice(goods).find(x => Number(x.coupon_price_yuan || x.min_group_price_yuan || 0) > 0) || null;
}
function parseJsonMaybe(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return null; }
}
function findDeep(obj, pred, limit = 5000) {
  const seen = new Set();
  const out = [];
  function walk(v) {
    if (!v || typeof v !== 'object' || seen.has(v) || out.length >= limit) return;
    seen.add(v);
    if (pred(v)) out.push(v);
    if (Array.isArray(v)) v.forEach(walk);
    else Object.values(v).forEach(walk);
  }
  walk(obj);
  return out;
}

// ---------- PDD ----------
const PDD_API_URL = process.env.PDD_API_URL || 'https://gw-api.pinduoduo.com/api/router';
const PDD_CLIENT_ID = envFirst('PDD_CLIENT_ID', 'PDD_APP_KEY');
const PDD_CLIENT_SECRET = envFirst('PDD_CLIENT_SECRET', 'PDD_APP_SECRET');
const PDD_PID = envFirst('PDD_PID');
const PDD_CUSTOM_PARAMETERS = envFirst('PDD_CUSTOM_PARAMETERS');
function pddSign(params) {
  let s = PDD_CLIENT_SECRET;
  Object.keys(params).sort().forEach(k => { s += k + params[k]; });
  return md5Upper(s + PDD_CLIENT_SECRET);
}
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
  return {
    platform: 'pdd', source,
    goods_name: item.goods_name || '', goods_desc: item.goods_desc || item.goods_name || '', brand_name: item.brand_name || '', shop_name: item.mall_name || '',
    goods_image_url: item.goods_image_url || '', goods_thumbnail_url: item.goods_thumbnail_url || item.goods_image_url || '',
    goods_id: String(item.goods_id || ''), goods_sign: item.goods_sign || '',
    sales_tip: item.sales_tip || '', min_group_price_yuan: yuanFromFen(price), coupon_discount_yuan: yuanFromFen(coupon), coupon_price_yuan: yuanFromFen(final || price),
    has_coupon: coupon > 0, unified_tags: ['拼多多'], material_url: item.goods_url || '', url: item.goods_url || '', raw: item
  };
}
async function searchPdd(q) {
  const raw = await pddRequest('pdd.ddk.goods.search', { keyword: q, pid: PDD_PID, page: 1, page_size: 20, custom_parameters: PDD_CUSTOM_PARAMETERS });
  if (raw.error || raw.error_response) return { ok: false, platform: 'pdd', keyword: q, total_count: 0, goods_list: [], raw };
  const list = raw.goods_search_response && raw.goods_search_response.goods_list ? asArray(raw.goods_search_response.goods_list) : [];
  const goods = list.map(x => normalizePdd(x));
  return { ok: true, platform: 'pdd', source: 'pdd.ddk.goods.search', keyword: q, total_count: goods.length, goods_list: goods, raw };
}
async function pddLink(body) {
  const goodsSign = body.goods_sign || body.goodsSign || '';
  const goodsId = body.goods_id || body.goodsId || '';
  const biz = { p_id: PDD_PID, generate_short_url: 'true', custom_parameters: PDD_CUSTOM_PARAMETERS };
  if (goodsSign) biz.goods_sign_list = JSON.stringify([goodsSign]);
  else if (goodsId) biz.goods_id_list = JSON.stringify([Number(goodsId)]);
  else return { ok: false, platform: 'pdd', error: 'missing_goods_sign_or_id' };
  const raw = await pddRequest('pdd.ddk.goods.promotion.url.generate', biz);
  const list = raw.goods_promotion_url_generate_response && raw.goods_promotion_url_generate_response.goods_promotion_url_list ? asArray(raw.goods_promotion_url_generate_response.goods_promotion_url_list) : [];
  const first = list[0] || {};
  const url = first.short_url || first.mobile_short_url || first.url || first.mobile_url || '';
  return { ok: !!url, platform: 'pdd', url, material_url: url, raw };
}

// ---------- JD ----------
const JD_API_URL = envFirst('JD_API_URL') || 'https://api.jd.com/routerjson';
const JD_APP_KEY = envFirst('JD_APP_KEY', 'JD_APPKEY', 'APP_KEY');
const JD_APP_SECRET = envFirst('JD_APP_SECRET', 'JD_APPSECRET', 'APP_SECRET');
const JD_ACCESS_TOKEN = envFirst('JD_ACCESS_TOKEN', 'JD_TOKEN');
const JD_POSITION_ID = envFirst('JD_POSITION_ID', 'JD_POSITIONID') || '3104496027';
const JD_PID = envFirst('JD_PID') || '2038054117_4104082584_3104496027';
const JD_SITE_ID = envFirst('JD_SITE_ID', 'JD_SITEID') || (JD_PID.split('_')[1] || '');
const JD_SEARCH_METHOD = envFirst('JD_SEARCH_METHOD') || 'jd.union.open.goods.query';
const JD_PROMOTION_METHOD = envFirst('JD_PROMOTION_METHOD') || 'jd.union.open.promotion.common.get';
function jdTimestamp() {
  const d = new Date(Date.now() + 8 * 3600000); const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
function jdSign(params) {
  let s = JD_APP_SECRET;
  Object.keys(params).sort().forEach(k => { s += k + params[k]; });
  return md5Upper(s + JD_APP_SECRET);
}
async function jdRequest(method, biz = {}) {
  if (!JD_APP_KEY || !JD_APP_SECRET) return { error: 'missing_jd_env' };
  const params = cleanParams({ method, app_key: JD_APP_KEY, access_token: JD_ACCESS_TOKEN, timestamp: jdTimestamp(), format: 'json', v: '1.0', sign_method: 'md5', '360buy_param_json': JSON.stringify(biz) });
  params.sign = jdSign(params);
  return postForm(JD_API_URL, params);
}
function normalizeJd(item, source = 'jd.union.open.goods.query') {
  const skuId = String(item.skuId || item.sku_id || item.itemId || '');
  const priceInfo = item.priceInfo || item.price_info || {};
  const couponInfo = item.couponInfo || item.coupon_info || {};
  const imageInfo = item.imageInfo || item.image_info || {};
  const images = imageInfo.imageList || imageInfo.image_list || [];
  const price = Number(priceInfo.price || priceInfo.lowestPrice || item.price || 0);
  const coupon = Number(couponInfo.discount || 0);
  const final = Math.max(0, price - coupon);
  const url = skuId ? `https://item.jd.com/${skuId}.html` : '';
  return {
    platform: 'jd', source,
    goods_name: item.skuName || item.goodsName || item.name || '', goods_desc: item.skuName || '', brand_name: item.brandName || '', shop_name: item.shopName || '',
    goods_image_url: httpsUrl((images[0] && (images[0].url || images[0].imageUrl)) || item.imageUrl || ''), goods_thumbnail_url: httpsUrl((images[0] && (images[0].url || images[0].imageUrl)) || item.imageUrl || ''),
    sku_id: skuId, goods_id: skuId, sales_tip: item.comments || item.inOrderCount30Days || '',
    min_group_price_yuan: price, coupon_discount_yuan: coupon, coupon_price_yuan: final || price,
    has_coupon: coupon > 0, unified_tags: ['京东'], material_url: url, url, raw: item
  };
}
async function searchJd(q) {
  const raw = await jdRequest(JD_SEARCH_METHOD, { goodsReq: { keyword: q, pageIndex: 1, pageSize: 20 } });
  if (raw.error || raw.error_response) return { ok: false, platform: 'jd', keyword: q, total_count: 0, goods_list: [], raw };
  const resultText = raw.jd_union_open_goods_query_response && raw.jd_union_open_goods_query_response.result;
  const parsed = parseJsonMaybe(resultText) || raw;
  const list = findDeep(parsed, x => x && (x.skuId || x.skuName || x.goodsName)).slice(0, 20);
  const goods = list.map(x => normalizeJd(x));
  return { ok: true, platform: 'jd', source: JD_SEARCH_METHOD, keyword: q, total_count: goods.length, goods_list: goods, raw };
}
async function jdLink(body) {
  const skuId = body.sku_id || body.skuId || '';
  const materialId = body.material_url || body.materialId || body.url || (skuId ? `https://item.jd.com/${skuId}.html` : '');
  if (!materialId) return { ok: false, platform: 'jd', error: 'missing_material_id' };
  const raw = await jdRequest(JD_PROMOTION_METHOD, { promotionCodeReq: cleanParams({ materialId, couponUrl: body.coupon_url || body.couponUrl || '', siteId: JD_SITE_ID, positionId: JD_POSITION_ID }) });
  const text = JSON.stringify(raw);
  const m = text.match(/https?:\\?\/\\?\/[^"\\]+/);
  const url = m ? m[0].replace(/\\\//g, '/') : '';
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
(function normalizeAdzone() {
  const raw = String(TB_ADZONE_ID || TB_PID || '').trim();
  const fromPid = raw.match(/(?:mm_)?\d+_\d+_(\d+)$/);
  const direct = raw.match(/^\d+$/);
  if (fromPid) TB_ADZONE_ID = fromPid[1];
  else if (direct) TB_ADZONE_ID = raw;
})();
function tbTimestamp() {
  const d = new Date(Date.now() + 8 * 3600000); const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
function tbSign(params) {
  let s = TB_APP_SECRET;
  Object.keys(params).sort().forEach(k => { s += k + String(params[k]); });
  return md5Upper(s + TB_APP_SECRET);
}
async function tbRequest(method, biz = {}) {
  if (!TB_ENABLED) return { error: 'tb_disabled', message: 'TB_ENABLED is not true' };
  if (!TB_APP_KEY || !TB_APP_SECRET) return { error: 'missing_tb_env', message: 'TB_APP_KEY/TB_APP_SECRET missing' };
  const params = cleanParams({ method, app_key: TB_APP_KEY, timestamp: tbTimestamp(), format: 'json', v: '2.0', sign_method: 'md5', ...biz });
  params.sign = tbSign(params);
  const errors = [];
  for (const endpoint of [TB_API_FALLBACK_URL, TB_API_URL].filter((x, i, a) => x && a.indexOf(x) === i)) {
    try {
      const raw = await postForm(endpoint, params, 6500);
      raw.__endpoint = endpoint;
      return raw;
    } catch (e) { errors.push({ endpoint, code: e.code || '', message: e.message || String(e) }); }
  }
  return { error: 'tb_request_failed', message: '淘宝接口请求失败', detail: errors };
}
function pickTbItems(raw) {
  const direct = raw && raw.tbk_dg_material_optional_upgrade_response && raw.tbk_dg_material_optional_upgrade_response.result_list && raw.tbk_dg_material_optional_upgrade_response.result_list.map_data;
  if (Array.isArray(direct)) return direct.slice(0, 20);
  const out = [];
  findDeep(raw, x => x && (x.item_basic_info || x.price_promotion_info || x.publish_info || x.num_iid || x.item_id || x.title || x.short_title), 1000).forEach(x => out.push(x));
  const seen = new Set();
  return out.filter(x => {
    const b = x.item_basic_info || x.basic_info || x;
    const key = String(x.item_id || b.num_iid || b.item_id || b.title || b.short_title || Math.random());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}
function normalizeTb(item, source = 'tb.material.search') {
  const basic = item.item_basic_info || item.basic_info || item;
  const promo = item.price_promotion_info || {};
  const publish = item.publish_info || {};
  const title = basic.title || basic.short_title || basic.raw_title || item.title || '淘宝商品';
  const image = basic.pict_url || basic.pic_url || basic.white_image || item.pict_url || '';
  const promoList = promo.final_promotion_path_list && promo.final_promotion_path_list.final_promotion_path_map_data;
  const coupon = Array.isArray(promoList) && promoList[0] ? promoList[0] : {};
  const price = Number(promo.final_promotion_price || item.final_promotion_price || basic.zk_final_price || basic.reserve_price || basic.price || 0);
  const couponDiscount = Number(coupon.promotion_fee || 0);
  const direct = httpsUrl(publish.coupon_share_url || publish.click_url || basic.item_url || item.item_url || item.url || '');
  const fallback = title ? `https://s.m.taobao.com/h5?q=${encodeURIComponent(title)}` : '';
  const url = direct || fallback;
  return {
    platform: 'tb', source,
    goods_name: title, goods_desc: basic.sub_title || title, brand_name: basic.brand_name || '', shop_name: basic.shop_title || basic.nick || '',
    goods_image_url: httpsUrl(image), goods_thumbnail_url: httpsUrl(image), goods_id: String(item.item_id || basic.num_iid || basic.item_id || ''), num_iid: String(item.item_id || basic.num_iid || basic.item_id || ''),
    sales_tip: String(basic.annual_vol || basic.tk_total_sales || basic.volume || ''),
    min_group_price_yuan: price, coupon_discount_yuan: couponDiscount, coupon_price_yuan: price, has_coupon: couponDiscount > 0,
    unified_tags: ['淘宝', '关键词搜索'], material_url: url, url, item_url: url, direct_buy_url: !!direct, buy_link_status: direct ? 'direct' : 'fallback_search', raw: item
  };
}
async function searchTb(q) {
  if (!TB_ENABLED) return { ok: false, platform: 'tb', keyword: q, total_count: 0, goods_list: [], error: 'tb_disabled' };
  if (!TB_ADZONE_ID) return { ok: false, platform: 'tb', keyword: q, total_count: 0, goods_list: [], error: 'missing_tb_adzone_id' };
  const raw = await tbRequest(TB_SEARCH_METHOD, { adzone_id: TB_ADZONE_ID, q, page_size: 20, page_no: 1, platform: 2 });
  const failed = raw && (raw.error_response || raw.error || raw.code);
  const items = failed ? [] : pickTbItems(raw).map(x => normalizeTb(x, 'tb.material.search'));
  return { ok: !failed, platform: 'tb', mode: 'keyword_search', source: 'tb.material.search', keyword: q, total_count: items.length, q, goods_list: items, raw };
}
async function tbItem(input) {
  const id = String(input || '').match(/\d{8,16}/)?.[0] || '';
  if (!id) return { ok: false, platform: 'tb', error: 'missing_item_id' };
  const fields = 'num_iid,title,pict_url,small_images,reserve_price,zk_final_price,user_type,provcity,item_url,nick,seller_id,volume,cat_name,shop_title';
  const raw = await tbRequest(TB_ITEM_METHOD, { fields, num_iids: id, platform: 2 });
  const items = pickTbItems(raw).map(x => normalizeTb(x, 'tb.item.info'));
  return { ok: !(raw.error_response || raw.error || raw.code), platform: 'tb', mode: 'item_detail', item_id: id, goods: items[0] || null, goods_list: items, raw };
}

async function parseInput(req, url) {
  const rawBody = req.method === 'POST' ? await readBody(req) : '';
  let body = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
  const q = String(body.q || body.keyword || url.searchParams.get('q') || url.searchParams.get('keyword') || url.searchParams.get('kw') || '').trim();
  const platform = String(body.platform || body.provider || url.searchParams.get('platform') || url.searchParams.get('provider') || '').trim();
  return { body, q, platform };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/' || url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, name: '价比比 API clean', runtime: 'server-clean', pdd_configured: !!(PDD_CLIENT_ID && PDD_CLIENT_SECRET && PDD_PID), jd_configured: !!(JD_APP_KEY && JD_APP_SECRET), tb_enabled: TB_ENABLED, tb_configured: !!(TB_APP_KEY && TB_APP_SECRET && TB_ADZONE_ID), provider_status: '/api/providers/status' });
    }
    if (url.pathname === '/api/providers/status') {
      return sendJson(res, 200, { ok: true, runtime: 'server-clean', providers: [
        { platform: 'pdd', name: '拼多多', configured: !!(PDD_CLIENT_ID && PDD_CLIENT_SECRET && PDD_PID), search: true, link: true, source: 'pdd.ddk' },
        { platform: 'jd', name: '京东', configured: !!(JD_APP_KEY && JD_APP_SECRET), search: true, link: true, source: 'jd.union' },
        { platform: 'tb', name: '淘宝', configured: !!(TB_APP_KEY && TB_APP_SECRET && TB_ADZONE_ID), enabled: TB_ENABLED, search: true, link: true, source: 'taobao TOP / alimama' },
        { platform: 'douyin', name: '抖音', configured: false, search: false, link: false, source: 'provider_placeholder' }
      ] });
    }
    const { body, q, platform } = await parseInput(req, url);
    if (url.pathname === '/api/tb/search' || url.pathname === '/api/tb/real-search') {
      if (!q) return sendJson(res, 400, { ok: false, platform: 'tb', error: 'missing_keyword', message: '请加 ?q=关键词' });
      return sendJson(res, 200, await searchTb(q));
    }
    if (url.pathname === '/api/tb/item' || url.pathname === '/api/tb/link') {
      const input = body.item_id || body.num_iid || body.id || body.url || body.material_url || url.searchParams.get('item_id') || url.searchParams.get('num_iid') || url.searchParams.get('id') || url.searchParams.get('url') || '';
      return sendJson(res, 200, await tbItem(input));
    }
    if (url.pathname === '/api/pdd/link') return sendJson(res, 200, await pddLink({ ...body, goods_sign: body.goods_sign || url.searchParams.get('goods_sign'), goods_id: body.goods_id || url.searchParams.get('goods_id') }));
    if (url.pathname === '/api/jd/link') return sendJson(res, 200, await jdLink({ ...body, sku_id: body.sku_id || url.searchParams.get('sku_id'), material_url: body.material_url || url.searchParams.get('material_url') }));
    if (url.pathname === '/api/search' || url.pathname === '/api/search.json' || url.pathname === '/api/provider/search') {
      if (!q) return sendJson(res, 400, { ok: false, error: 'missing_keyword', message: '请加 ?q=关键词' });
      let result;
      if (platform === 'tb') result = await searchTb(q);
      else if (platform === 'pdd') result = await searchPdd(q);
      else if (platform === 'jd') result = await searchJd(q);
      else {
        const settled = await Promise.allSettled([searchPdd(q), searchJd(q), searchTb(q)]);
        const providers = settled.map(x => x.status === 'fulfilled' ? x.value : { ok: false, error: x.reason && x.reason.message || String(x.reason) });
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

http.createServer(handle).listen(PORT, () => console.log('Jiabibi clean API listening on', PORT));
