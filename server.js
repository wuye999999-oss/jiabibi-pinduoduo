const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PDD_API_URL = process.env.PDD_API_URL || 'https://gw-api.pinduoduo.com/api/router';
const PDD_CLIENT_ID = process.env.PDD_CLIENT_ID || '';
const PDD_CLIENT_SECRET = process.env.PDD_CLIENT_SECRET || '';
const PDD_PID = process.env.PDD_PID || '';
const PDD_CUSTOM_PARAMETERS = process.env.PDD_CUSTOM_PARAMETERS || '';

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

const JD_API_URL = envFirst('JD_API_URL') || 'https://api.jd.com/routerjson';
const JD_APP_KEY = envFirst('JD_APP_KEY', 'JD_APPKEY', 'JD_APP_KEY_ID', 'JD_KEY', 'APP_KEY');
const JD_APP_SECRET = envFirst('JD_APP_SECRET', 'JD_APPSECRET', 'JD_SECRET', 'JD_SECRET_KEY', 'SECRET_KEY', 'APP_SECRET');
const JD_ACCESS_TOKEN = envFirst('JD_ACCESS_TOKEN', 'JD_TOKEN', 'ACCESS_TOKEN');
const JD_POSITION_ID = envFirst('JD_POSITION_ID', 'JD_POSITIONID', 'JD_POS_ID') || '3104496027';
const JD_PID = envFirst('JD_PID') || '2038054117_4104082584_3104496027';
const JD_SITE_ID = envFirst('JD_SITE_ID', 'JD_SITEID') || (JD_PID.split('_')[1] || '');
const JD_PROMOTION_METHOD = envFirst('JD_PROMOTION_METHOD') || 'jd.union.open.promotion.common.get';

function md5Upper(input) { return crypto.createHash('md5').update(input, 'utf8').digest('hex').toUpperCase(); }
function cleanParams(params) { const out = {}; for (const [key, value] of Object.entries(params)) { if (value === undefined || value === null || value === '') continue; out[key] = String(value); } return out; }
function makeSign(params, secret) { const keys = Object.keys(params).sort(); let raw = secret; for (const key of keys) raw += key + params[key]; raw += secret; return md5Upper(raw); }
function postForm(url, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const target = new URL(url);
    const req = https.request({ method: 'POST', hostname: target.hostname, path: target.pathname + target.search, port: target.port || 443, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (_) { reject(new Error('API returned non-JSON: ' + data.slice(0, 300))); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
function jdTimestamp() { const now = new Date(); const utc = now.getTime() + now.getTimezoneOffset() * 60000; const bj = new Date(utc + 8 * 3600000); const pad = (n) => String(n).padStart(2, '0'); return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(bj.getSeconds())}`; }
async function pddRequest(type, bizParams = {}) { if (!PDD_CLIENT_ID || !PDD_CLIENT_SECRET || !PDD_PID) return { error: 'missing_pdd_env', message: 'Missing PDD env.' }; const params = cleanParams({ type, client_id: PDD_CLIENT_ID, timestamp: Math.floor(Date.now() / 1000), data_type: 'JSON', ...bizParams }); params.sign = makeSign(params, PDD_CLIENT_SECRET.trim()); return postForm(PDD_API_URL, params); }
async function jdRequest(method, bizObject = {}) { if (!JD_APP_KEY || !JD_APP_SECRET) return { error: 'missing_jd_env', message: 'Missing JD env.' }; const params = cleanParams({ method, app_key: JD_APP_KEY, access_token: JD_ACCESS_TOKEN, timestamp: jdTimestamp(), format: 'json', v: '1.0', sign_method: 'md5', '360buy_param_json': JSON.stringify(bizObject) }); params.sign = makeSign(params, JD_APP_SECRET); return postForm(JD_API_URL, params); }

function yuanFromFen(value) { return Math.round(Number(value || 0)) / 100; }
function asArray(value) { if (!value) return []; return Array.isArray(value) ? value : [value]; }
function httpsUrl(url) { if (!url) return ''; return String(url).startsWith('http') ? String(url) : `https://${String(url).replace(/^\/\//, '')}`; }
function normalizePdd(item, source = 'real') { const priceFen = Number(item.min_group_price || 0); const couponFen = Number(item.coupon_discount || item.extra_coupon_amount || 0); const finalFen = Math.max(0, priceFen - couponFen); return { platform: 'pdd', source, goods_name: item.goods_name || '', goods_desc: item.goods_desc || '', brand_name: item.brand_name || '', shop_name: item.mall_name || '', goods_image_url: item.goods_image_url || '', goods_thumbnail_url: item.goods_thumbnail_url || item.goods_image_url || '', goods_sign: item.goods_sign, goods_id: item.goods_id, sales_tip: item.sales_tip || '', min_group_price_yuan: yuanFromFen(priceFen), coupon_discount_yuan: yuanFromFen(couponFen), coupon_price_yuan: yuanFromFen(finalFen), has_coupon: Boolean(item.has_coupon || couponFen > 0), unified_tags: [source.includes('url') ? '链接直查' : '', ...(item.unified_tags || [])].filter(Boolean), material_url: '', raw: item }; }
function pickJdImage(item) { const imageList = item.imageInfo?.imageList?.urlInfo || item.imageInfo?.imageList || []; const first = Array.isArray(imageList) ? imageList[0] : imageList; return httpsUrl(first?.url || item.imageInfo?.whiteImage || item.imgUrl || item.imageUrl || ''); }
function pickJdCoupon(item) { const raw = item.couponInfo?.couponList?.coupon || item.couponInfo?.couponList || item.couponList || []; const list = asArray(raw); return list.find((c) => Number(c.isBest) === 1) || list[0] || null; }
function normalizeJd(item, source = 'real') { const priceInfo = item.priceInfo || {}; const coupon = pickJdCoupon(item); const price = Number(priceInfo.lowestPrice || priceInfo.price || priceInfo.jdPrice || item.unitPrice || item.wlUnitPrice || item.jdPrice || 0); const finalPrice = Number(priceInfo.lowestCouponPrice || priceInfo.finalPrice || price || 0); const skuId = item.skuId || item.sku_id || item.skuID || item.skuIdStr || ''; const materialUrl = item.materialUrl || item.link || item.itemUrl || item.url || (skuId ? `https://item.jd.com/${skuId}.html` : ''); const image = pickJdImage(item) || httpsUrl(item.imageUrl || item.imgUrl || ''); return { platform: 'jd', source, goods_name: item.skuName || item.goodsName || item.title || item.goods_name || '', goods_desc: item.skuName || item.goodsName || item.title || '', brand_name: item.brandName || item.shopInfo?.shopName || '京东', shop_name: item.shopInfo?.shopName || item.shopName || '', goods_image_url: image, goods_thumbnail_url: image, sku_id: skuId, goods_id: skuId, material_url: httpsUrl(materialUrl), coupon_url: coupon?.link || coupon?.couponUrl || '', sales_tip: item.inOrderCount30Days ? String(item.inOrderCount30Days) : (item.comments || ''), min_group_price_yuan: price, coupon_discount_yuan: Math.max(0, price - finalPrice), coupon_price_yuan: finalPrice, has_coupon: Boolean(coupon), unified_tags: [source.includes('fallback') ? '京粉精选' : '', source.includes('url') ? '链接直查' : '', coupon ? '有优惠券' : '', item.owner === 'g' ? '京东自营' : '', item.shopInfo?.shopName || item.shopName || ''].filter(Boolean), raw: item }; }
function parseJdQueryResult(result, key) { const wrapper = result[key] || result.jd_union_open_goods_query_responce || result.jd_union_open_goods_query_response || result.jd_union_open_goods_jingfen_query_responce || result.jd_union_open_goods_jingfen_query_response || result.jd_union_open_goods_promotiongoodsinfo_query_responce || result.jd_union_open_goods_promotiongoodsinfo_query_response || result; let queryResult = wrapper.queryResult || wrapper.result || wrapper; if (typeof queryResult === 'string') { try { queryResult = JSON.parse(queryResult); } catch (_) {} } return queryResult; }
function extractJdGoodsList(queryResult) { const data = queryResult?.data; if (!data) return []; return asArray(data.goodsResp || data); }
function isForbidden(queryResult) { return String(queryResult?.code || '') === '403' || /无访问权限/.test(String(queryResult?.message || '')); }

function decodeText(input) { try { return decodeURIComponent(String(input || '')); } catch { return String(input || ''); } }
function findUrl(input) { const text = decodeText(input); const m = text.match(/https?:\/\/[^\s\u3000]+/i); return m ? m[0].replace(/[，。；;]+$/, '') : ''; }
function parseProductLink(input) {
  const text = decodeText(input);
  const url = findUrl(text) || text;
  const out = { is_link: /^https?:\/\//i.test(url), platform: '', id: '', id_type: '', url, keyword_hint: '' };
  if (!out.is_link) return out;
  let u = null;
  try { u = new URL(url); } catch { return out; }
  const host = u.hostname.toLowerCase();
  const all = decodeText(url);
  if (/jd\.com|3\.cn/.test(host)) {
    out.platform = 'jd'; out.id_type = 'sku_id';
    const patterns = [/item\.jd\.com\/(\d+)\.html/i, /item\.m\.jd\.com\/(?:product\/)?(\d+)\.html/i, /sku(?:Id|id)?[=:](\d{5,})/i, /wareId[=:](\d{5,})/i];
    for (const re of patterns) { const m = all.match(re); if (m) { out.id = m[1]; break; } }
  } else if (/pinduoduo\.com|yangkeduo\.com|pdd\.cn/.test(host)) {
    out.platform = 'pdd';
    out.id = u.searchParams.get('goods_id') || u.searchParams.get('goodsId') || u.searchParams.get('goods_sign') || u.searchParams.get('goodsSign') || '';
    out.id_type = /[a-zA-Z_]/.test(out.id) ? 'goods_sign' : 'goods_id';
  } else if (/taobao\.com|tmall\.com|tb\.cn/.test(host)) {
    out.platform = 'tb'; out.id_type = 'item_id'; out.id = u.searchParams.get('id') || u.searchParams.get('itemId') || u.searchParams.get('item_id') || '';
    out.keyword_hint = u.searchParams.get('title') || u.searchParams.get('q') || u.searchParams.get('keyword') || '';
  } else if (/douyin\.com|jinritemai\.com|iesdouyin\.com/.test(host)) {
    out.platform = 'douyin'; out.id_type = 'product_id'; out.id = u.searchParams.get('id') || u.searchParams.get('product_id') || u.searchParams.get('promotion_id') || '';
    out.keyword_hint = u.searchParams.get('title') || u.searchParams.get('keyword') || '';
  }
  return out;
}
function extractJdSku(input) { const p = parseProductLink(input); return p.platform === 'jd' ? p.id : ''; }

async function searchJdItemBySku(skuId) { const raw = await jdRequest('jd.union.open.goods.promotiongoodsinfo.query', { skuIds: String(skuId) }); const qr = parseJdQueryResult(raw, 'jd_union_open_goods_promotiongoodsinfo_query_responce'); if (qr?.code && String(qr.code) !== '200') throw { jd_error: qr, raw }; let data = qr?.data || qr; if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) {} } const list = asArray(data).map((item) => normalizeJd(item, 'url.promotiongoodsinfo')); return { ok: true, platform: 'jd', source: 'url.promotiongoodsinfo', keyword: String(skuId), total_count: list.length, goods_list: list, raw }; }
async function searchPddItemByLink(parsed) {
  const biz = { pid: PDD_PID };
  if (parsed.id_type === 'goods_sign') biz.goods_sign = parsed.id;
  else if (parsed.id) biz.goods_id_list = JSON.stringify([Number(parsed.id)]);
  if (!parsed.id) return providerPlaceholder('pdd', parsed.url, '拼多多链接已识别，但未提取到 goods_id/goods_sign。');
  const raw = await pddRequest('pdd.ddk.goods.detail', biz);
  if (raw.error_response || raw.error) throw raw;
  const response = raw.goods_detail_response || raw;
  const list = (response.goods_details || response.goods_list || []).map((item) => normalizePdd(item, 'url.detail'));
  return { ok: true, platform: 'pdd', source: 'url.detail', keyword: parsed.id, total_count: list.length, goods_list: list, raw };
}
async function resolveLink(input) {
  const parsed = parseProductLink(input);
  if (!parsed.is_link) return { ok: true, is_link: false, keyword: String(input || '').trim(), goods_list: [], parsed };
  let exact = { ok: true, platform: parsed.platform, source: 'link_detected', goods_list: [], total_count: 0 };
  try {
    if (parsed.platform === 'jd' && parsed.id) exact = await searchJdItemBySku(parsed.id);
    else if (parsed.platform === 'pdd' && parsed.id) exact = await searchPddItemByLink(parsed);
    else if (parsed.platform === 'tb') exact = providerPlaceholder('tb', parsed.keyword_hint || parsed.id || input, '淘宝链接已识别，真实商品详情 provider 待接入。');
    else if (parsed.platform === 'douyin') exact = providerPlaceholder('douyin', parsed.keyword_hint || parsed.id || input, '抖音链接已识别，真实商品详情 provider 待接入。');
  } catch (err) { exact = { ok: false, platform: parsed.platform, source: 'link_resolve_failed', error: err.error || err.message || 'resolve_failed', detail: err, goods_list: [] }; }
  const first = exact.goods_list?.[0];
  const seedKeyword = first?.goods_name || parsed.keyword_hint || parsed.id || String(input || '').trim();
  return { ok: true, is_link: true, parsed, seed_keyword: seedKeyword, exact };
}

async function searchPdd(keyword, page = 1, pageSize = 20) { const result = await pddRequest('pdd.ddk.goods.search', { keyword, page, page_size: pageSize, with_coupon: 'true', pid: PDD_PID, custom_parameters: PDD_CUSTOM_PARAMETERS }); if (result.error_response || result.error) throw result; const response = result.goods_search_response || {}; return { ok: true, platform: 'pdd', source: 'real', keyword, total_count: response.total_count || 0, goods_list: (response.goods_list || []).map((x) => normalizePdd(x, 'real')) }; }
async function searchJd(keyword, page = 1, pageSize = 20) { const sku = extractJdSku(keyword); if (sku) return searchJdItemBySku(sku); const goodsRaw = await jdRequest('jd.union.open.goods.query', { goodsReqDTO: { keyword, pageIndex: page, pageSize: Math.min(pageSize, 30), sceneId: 1, isCoupon: 1, hasBestCoupon: 1, pid: JD_PID } }); let queryResult = parseJdQueryResult(goodsRaw, 'jd_union_open_goods_query_responce'); let source = 'goods.query'; let raw = goodsRaw; if (isForbidden(queryResult)) { const jingfenRaw = await jdRequest('jd.union.open.goods.jingfen.query', { goodsReq: { eliteId: 1, pageIndex: page, pageSize: Math.min(pageSize, 30), pid: JD_PID } }); queryResult = parseJdQueryResult(jingfenRaw, 'jd_union_open_goods_jingfen_query_responce'); source = 'jingfen.query.fallback'; raw = { goods_query_error: parseJdQueryResult(goodsRaw, 'jd_union_open_goods_query_responce'), jingfen: jingfenRaw }; } if (queryResult?.code && String(queryResult.code) !== '200') throw { jd_error: queryResult, raw }; const list = extractJdGoodsList(queryResult).map((item) => normalizeJd(item, source)); return { ok: true, platform: 'jd', source, keyword, total_count: Number(queryResult?.totalCount || list.length), goods_list: list, raw }; }

function providerPlaceholder(platform, keyword, message) { return { ok: true, platform, source: 'provider_placeholder', keyword, total_count: 0, goods_list: [], message: message || `${platform === 'tb' ? '淘宝' : platform === 'douyin' ? '抖音' : platform}真实接口尚未接入，当前只保留 provider 骨架，不返回假商品。` }; }
function inferBrand(keyword) { const brands = ['小米', '安克', '维达', '蓝月亮', '苹果', '华为', '荣耀', '美的', '得力', '公牛', '飞利浦']; return brands.find((b) => keyword.includes(b)) || ''; }
function inferCategory(keyword) { const cats = ['充电宝', '纸巾', '洗衣液', '耳机', '手机壳', '电饭煲', '文具', '保温杯']; return cats.find((c) => keyword.includes(c)) || keyword || '商品'; }
function mockGoods(platform, keyword, index, price, tag, shop) { const brand = inferBrand(keyword); const cat = inferCategory(keyword); const name = `${brand ? brand + ' ' : ''}${cat} ${tag} Mock ${index}`; return { platform, source: 'mock', goods_name: name, goods_desc: '开发调试 Mock 商品，不用于正式展示', brand_name: brand || platform, shop_name: shop, goods_image_url: `https://placehold.co/600x600?text=${encodeURIComponent(platform)}`, goods_thumbnail_url: `https://placehold.co/300x300?text=${encodeURIComponent(platform)}`, goods_id: `${platform}_mock_${index}`, sales_tip: `${index * 1000}+`, min_group_price_yuan: price + 20, coupon_discount_yuan: 20, coupon_price_yuan: price, has_coupon: true, unified_tags: ['Mock', tag, shop], material_url: '', raw: { mock: true } }; }
function searchMock(platform, keyword) { const base = platform === 'pdd' ? 55 : platform === 'jd' ? 66 : platform === 'tb' ? 59 : 62; const shopPrefix = { pdd: '拼多多', jd: '京东', tb: '淘宝', douyin: '抖音' }[platform] || platform; const list = [mockGoods(platform, keyword, 1, base, '低价渠道', `${shopPrefix}渠道店`), mockGoods(platform, keyword, 2, base + 10, '授权/专营', `${shopPrefix}专营店`), mockGoods(platform, keyword, 3, base + 30, '官方旗舰', `${shopPrefix}官方旗舰店`), mockGoods(platform, keyword, 4, base - 5, '适配款', `${shopPrefix}配件店`)]; return { ok: true, platform, source: 'mock', keyword, total_count: list.length, goods_list: list, message: '显式 mock=1 开发调试数据。' }; }
async function searchTaobao(keyword) { return providerPlaceholder('tb', keyword); }
async function searchDouyin(keyword) { return providerPlaceholder('douyin', keyword); }

async function unifiedSearch(inputKeyword, platforms, page, pageSize, useMock = false) {
  const linkResolved = useMock ? null : await resolveLink(inputKeyword);
  const keyword = linkResolved?.is_link ? linkResolved.seed_keyword : inputKeyword;
  const wanted = platforms.includes('all') ? ['pdd', 'jd', 'tb', 'douyin'] : platforms;
  const tasks = wanted.map(async (platform) => {
    const p = platform === 'taobao' ? 'tb' : platform === 'dy' ? 'douyin' : platform;
    try {
      if (useMock) return searchMock(p, keyword);
      if (p === 'pdd') return await searchPdd(keyword, page, pageSize);
      if (p === 'jd') return await searchJd(keyword, page, pageSize);
      if (p === 'tb') return await searchTaobao(keyword);
      if (p === 'douyin') return await searchDouyin(keyword);
      return { ok: false, platform: p, error: 'unknown_platform', goods_list: [] };
    } catch (err) { return { ok: false, platform: p, error: err.error || err.message || 'provider_error', detail: err, goods_list: [] }; }
  });
  const results = await Promise.all(tasks);
  let goods = results.flatMap((result) => result.goods_list || []);
  if (linkResolved?.exact?.goods_list?.length) {
    const exactGoods = linkResolved.exact.goods_list.map((x) => ({ ...x, source: `${x.source}.exact_input` }));
    const seen = new Set(goods.map((g) => `${g.platform}:${g.goods_id || g.sku_id || g.goods_sign || g.goods_name}`));
    for (const item of exactGoods) {
      const key = `${item.platform}:${item.goods_id || item.sku_id || item.goods_sign || item.goods_name}`;
      if (!seen.has(key)) goods.unshift(item);
    }
  }
  return { ok: true, input: inputKeyword, keyword, link: linkResolved?.is_link ? linkResolved : null, mock: Boolean(useMock), platforms: wanted, total_count: goods.length, providers: results.map(({ ok, platform, source, total_count, error, message }) => ({ ok, platform, source, total_count: total_count || 0, error, message })), goods_list: goods };
}

function sendJson(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(JSON.stringify(data, null, 2)); }
function readBody(req) { return new Promise((resolve) => { let body = ''; req.on('data', (chunk) => { body += chunk; }); req.on('end', () => resolve(body)); }); }
function findArrayDeep(value, keys = []) { if (!value || typeof value !== 'object') return []; for (const key of keys) if (Array.isArray(value[key])) return value[key]; for (const child of Object.values(value)) { if (Array.isArray(child)) return child; if (child && typeof child === 'object') { const found = findArrayDeep(child, keys); if (found.length) return found; } } return []; }

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
    const url = new URL(req.url, `http://${req.headers.host}`);
    const useMock = url.searchParams.get('mock') === '1' || url.searchParams.get('mock') === 'true';

    if (url.pathname === '/' || url.pathname === '/health') return sendJson(res, 200, { ok: true, name: '价比比 API', message: '价比比 API 已启动', env: { has_client_id: Boolean(PDD_CLIENT_ID), has_client_secret: Boolean(PDD_CLIENT_SECRET), has_pid: Boolean(PDD_PID), has_jd_app_key: Boolean(JD_APP_KEY), has_jd_app_secret: Boolean(JD_APP_SECRET), has_jd_position_id: Boolean(JD_POSITION_ID), tb_provider: 'placeholder_no_fake_goods', douyin_provider: 'placeholder_no_fake_goods', mock_mode: 'use &mock=1 explicitly', link_resolve: ['jd', 'pdd', 'tb', 'douyin'] } });

    if (url.pathname === '/api/search' && req.method === 'GET') {
      const keyword = url.searchParams.get('keyword') || '小米充电宝';
      const platforms = (url.searchParams.get('platform') || 'all').split(',').map((x) => x.trim()).filter(Boolean);
      const page = Number(url.searchParams.get('page') || '1');
      const pageSize = Number(url.searchParams.get('page_size') || '20');
      return sendJson(res, 200, await unifiedSearch(keyword, platforms, page, pageSize, useMock));
    }
    if (url.pathname === '/api/resolve' && req.method === 'GET') return sendJson(res, 200, await resolveLink(url.searchParams.get('input') || ''));
    if (url.pathname === '/api/pdd/search' && req.method === 'GET') return sendJson(res, 200, useMock ? searchMock('pdd', url.searchParams.get('keyword') || '充电宝') : await searchPdd(url.searchParams.get('keyword') || '充电宝', Number(url.searchParams.get('page') || '1'), Number(url.searchParams.get('page_size') || '20')));
    if (url.pathname === '/api/jd/search' && req.method === 'GET') return sendJson(res, 200, useMock ? searchMock('jd', url.searchParams.get('keyword') || '充电宝') : await searchJd(url.searchParams.get('keyword') || '充电宝', Number(url.searchParams.get('page') || '1'), Number(url.searchParams.get('page_size') || '20')));
    if (url.pathname === '/api/tb/search' && req.method === 'GET') return sendJson(res, 200, useMock ? searchMock('tb', url.searchParams.get('keyword') || '小米充电宝') : await searchTaobao(url.searchParams.get('keyword') || '小米充电宝'));
    if (url.pathname === '/api/douyin/search' && req.method === 'GET') return sendJson(res, 200, useMock ? searchMock('douyin', url.searchParams.get('keyword') || '小米充电宝') : await searchDouyin(url.searchParams.get('keyword') || '小米充电宝'));

    if (url.pathname === '/api/pdd/link' && req.method === 'POST') { const rawBody = await readBody(req); let body = {}; try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_) { body = {}; } const goodsSign = body.goods_sign || body.goodsSign || url.searchParams.get('goods_sign'); if (!goodsSign) return sendJson(res, 400, { error: 'missing_goods_sign', message: 'goods_sign is required' }); const result = await pddRequest('pdd.ddk.goods.promotion.url.generate', { p_id: PDD_PID, goods_sign_list: JSON.stringify([goodsSign]), generate_short_url: 'true', generate_mobile: 'true', generate_schema_url: 'true', generate_we_app: 'true', custom_parameters: PDD_CUSTOM_PARAMETERS }); if (result.error_response || result.error) return sendJson(res, 400, result); const item = result.goods_promotion_url_generate_response?.goods_promotion_url_list?.[0] || {}; return sendJson(res, 200, { ok: true, platform: 'pdd', mobile_short_url: item.mobile_short_url, short_url: item.short_url, mobile_url: item.mobile_url, url: item.url, schema_url: item.schema_url, we_app_info: item.we_app_info, raw: result }); }
    if (url.pathname === '/api/jd/link' && req.method === 'POST') { const rawBody = await readBody(req); let body = {}; try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_) { body = {}; } const skuId = body.sku_id || body.skuId || url.searchParams.get('sku_id'); const materialId = body.material_url || body.materialId || body.url || (skuId ? `https://item.jd.com/${skuId}.html` : ''); const couponUrl = body.coupon_url || body.couponUrl || ''; if (!materialId) return sendJson(res, 400, { error: 'missing_material_id', message: 'material_url or sku_id is required' }); const result = await jdRequest(JD_PROMOTION_METHOD, { promotionCodeReq: cleanParams({ materialId, couponUrl, siteId: JD_SITE_ID, positionId: JD_POSITION_ID }) }); if (result.error_response || result.error || result.code) return sendJson(res, 400, result); const clickURL = result.jd_union_open_promotion_common_get_response?.result?.clickURL || result.result?.clickURL || findArrayDeep(result, ['data'])?.[0]?.clickURL || ''; return sendJson(res, 200, { ok: true, platform: 'jd', click_url: clickURL, url: clickURL, raw: result }); }
    if ((url.pathname === '/api/tb/link' || url.pathname === '/api/douyin/link') && req.method === 'POST') return sendJson(res, 501, { ok: false, error: 'provider_not_connected', message: '真实 provider 尚未接入，不提供假转链。' });
    return sendJson(res, 404, { error: 'not_found', path: url.pathname });
  } catch (err) { return sendJson(res, 500, { error: 'server_error', message: err.message || String(err), detail: err }); }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Jiabibi API running on port ${PORT}`));
