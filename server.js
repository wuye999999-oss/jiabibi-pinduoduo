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

function md5Upper(input) {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex').toUpperCase();
}

function cleanParams(params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = String(v);
  }
  return out;
}

function makeSign(params, secret) {
  const keys = Object.keys(params).sort();
  let raw = secret;
  for (const key of keys) raw += key + params[key];
  raw += secret;
  return md5Upper(raw);
}

function postForm(url, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const target = new URL(url);
    const req = https.request({
      method: 'POST',
      hostname: target.hostname,
      path: target.pathname + target.search,
      port: target.port || 443,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (_) { reject(new Error('API returned non-JSON: ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function jdTimestamp() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const bj = new Date(utc + 8 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(bj.getSeconds())}`;
}

async function pddRequest(type, bizParams = {}) {
  if (!PDD_CLIENT_ID || !PDD_CLIENT_SECRET || !PDD_PID) return { error: 'missing_pdd_env' };
  const params = cleanParams({
    type,
    client_id: PDD_CLIENT_ID,
    timestamp: Math.floor(Date.now() / 1000),
    data_type: 'JSON',
    ...bizParams,
  });
  params.sign = makeSign(params, PDD_CLIENT_SECRET.trim());
  return postForm(PDD_API_URL, params);
}

async function jdRequest(method, bizObject = {}) {
  if (!JD_APP_KEY || !JD_APP_SECRET) return { error: 'missing_jd_env' };
  const params = cleanParams({
    method,
    app_key: JD_APP_KEY,
    access_token: JD_ACCESS_TOKEN,
    timestamp: jdTimestamp(),
    format: 'json',
    v: '1.0',
    sign_method: 'md5',
    '360buy_param_json': JSON.stringify(bizObject),
  });
  params.sign = makeSign(params, JD_APP_SECRET);
  return postForm(JD_API_URL, params);
}

function yuanFromFen(v) { return Math.round(Number(v || 0)) / 100; }
function asArray(v) { if (!v) return []; return Array.isArray(v) ? v : [v]; }
function httpsUrl(u) { if (!u) return ''; return String(u).startsWith('http') ? String(u) : `https://${String(u).replace(/^\/\//, '')}`; }

function normalizePdd(item) {
  const priceFen = Number(item.min_group_price || 0);
  const couponFen = Number(item.coupon_discount || item.extra_coupon_amount || 0);
  const finalFen = Math.max(0, priceFen - couponFen);
  return {
    platform: 'pdd',
    source: 'real',
    goods_name: item.goods_name || '',
    goods_desc: item.goods_desc || '',
    brand_name: item.brand_name || '',
    shop_name: item.mall_name || '',
    goods_image_url: item.goods_image_url || '',
    goods_thumbnail_url: item.goods_thumbnail_url || item.goods_image_url || '',
    goods_sign: item.goods_sign,
    goods_id: item.goods_id,
    sales_tip: item.sales_tip || '',
    min_group_price_yuan: yuanFromFen(priceFen),
    coupon_discount_yuan: yuanFromFen(couponFen),
    coupon_price_yuan: yuanFromFen(finalFen),
    has_coupon: Boolean(item.has_coupon || couponFen > 0),
    unified_tags: item.unified_tags || [],
    material_url: '',
    raw: item,
  };
}

function pickJdImage(item) {
  const imageList = item.imageInfo?.imageList?.urlInfo || item.imageInfo?.imageList || [];
  const first = Array.isArray(imageList) ? imageList[0] : imageList;
  return httpsUrl(first?.url || item.imageInfo?.whiteImage || item.imgUrl || item.imageUrl || '');
}

function pickJdCoupon(item) {
  const raw = item.couponInfo?.couponList?.coupon || item.couponInfo?.couponList || item.couponList || [];
  const list = asArray(raw);
  return list.find((c) => Number(c.isBest) === 1) || list[0] || null;
}

function normalizeJd(item, source = 'real') {
  const priceInfo = item.priceInfo || {};
  const coupon = pickJdCoupon(item);
  const price = Number(priceInfo.lowestPrice || priceInfo.price || priceInfo.jdPrice || 0);
  const finalPrice = Number(priceInfo.lowestCouponPrice || priceInfo.finalPrice || price || 0);
  const skuId = item.skuId || item.sku_id || item.skuID || '';
  const materialUrl = item.materialUrl || item.link || item.itemUrl || item.url || (skuId ? `https://item.jd.com/${skuId}.html` : '');
  return {
    platform: 'jd',
    source,
    goods_name: item.skuName || item.goodsName || item.title || '',
    goods_desc: item.skuName || item.goodsName || item.title || '',
    brand_name: item.brandName || item.shopInfo?.shopName || '京东',
    shop_name: item.shopInfo?.shopName || '',
    goods_image_url: pickJdImage(item),
    goods_thumbnail_url: pickJdImage(item),
    sku_id: skuId,
    goods_id: skuId,
    material_url: httpsUrl(materialUrl),
    coupon_url: coupon?.link || coupon?.couponUrl || '',
    sales_tip: item.inOrderCount30Days ? String(item.inOrderCount30Days) : (item.comments || ''),
    min_group_price_yuan: price,
    coupon_discount_yuan: Math.max(0, price - finalPrice),
    coupon_price_yuan: finalPrice,
    has_coupon: Boolean(coupon),
    unified_tags: [source.includes('fallback') ? '京粉精选' : '', coupon ? '有优惠券' : '', item.owner === 'g' ? '京东自营' : '', item.shopInfo?.shopName || ''].filter(Boolean),
    raw: item,
  };
}

function parseJdQueryResult(result, key) {
  const wrapper = result[key] || result.jd_union_open_goods_query_responce || result.jd_union_open_goods_query_response || result.jd_union_open_goods_jingfen_query_responce || result.jd_union_open_goods_jingfen_query_response || result;
  let queryResult = wrapper.queryResult || wrapper.result || wrapper;
  if (typeof queryResult === 'string') { try { queryResult = JSON.parse(queryResult); } catch (_) {} }
  return queryResult;
}
function extractJdGoodsList(queryResult) {
  const data = queryResult?.data;
  if (!data) return [];
  return asArray(data.goodsResp || data);
}
function isForbidden(queryResult) { return String(queryResult?.code || '') === '403' || /无访问权限/.test(String(queryResult?.message || '')); }

async function searchPdd(keyword, page = 1, pageSize = 20) {
  const result = await pddRequest('pdd.ddk.goods.search', {
    keyword,
    page,
    page_size: pageSize,
    with_coupon: 'true',
    pid: PDD_PID,
    custom_parameters: PDD_CUSTOM_PARAMETERS,
  });
  if (result.error_response || result.error) throw result;
  const response = result.goods_search_response || {};
  return { ok: true, platform: 'pdd', source: 'real', keyword, total_count: response.total_count || 0, goods_list: (response.goods_list || []).map(normalizePdd) };
}

async function searchJd(keyword, page = 1, pageSize = 20) {
  const goodsRaw = await jdRequest('jd.union.open.goods.query', {
    goodsReqDTO: { keyword, pageIndex: page, pageSize: Math.min(pageSize, 30), sceneId: 1, isCoupon: 1, hasBestCoupon: 1, pid: JD_PID },
  });
  let queryResult = parseJdQueryResult(goodsRaw, 'jd_union_open_goods_query_responce');
  let source = 'goods.query';
  let raw = goodsRaw;
  if (isForbidden(queryResult)) {
    const jingfenRaw = await jdRequest('jd.union.open.goods.jingfen.query', {
      goodsReq: { eliteId: 1, pageIndex: page, pageSize: Math.min(pageSize, 30), pid: JD_PID },
    });
    queryResult = parseJdQueryResult(jingfenRaw, 'jd_union_open_goods_jingfen_query_responce');
    source = 'jingfen.query.fallback';
    raw = { goods_query_error: parseJdQueryResult(goodsRaw, 'jd_union_open_goods_query_responce'), jingfen: jingfenRaw };
  }
  if (queryResult?.code && String(queryResult.code) !== '200') throw { jd_error: queryResult, raw };
  const list = extractJdGoodsList(queryResult).map((x) => normalizeJd(x, source));
  return { ok: true, platform: 'jd', source, keyword, total_count: Number(queryResult?.totalCount || list.length), goods_list: list, raw };
}

function inferBrand(keyword) {
  const brands = ['小米', '安克', '维达', '蓝月亮', '苹果', '华为', '荣耀', '美的', '得力', '公牛', '飞利浦'];
  return brands.find((b) => keyword.includes(b)) || '';
}
function inferCategory(keyword) {
  const cats = ['充电宝', '纸巾', '洗衣液', '耳机', '手机壳', '电饭煲', '文具', '保温杯'];
  return cats.find((c) => keyword.includes(c)) || keyword || '商品';
}
function mockGoods(platform, keyword, i, price, tag, shop) {
  const brand = inferBrand(keyword);
  const cat = inferCategory(keyword);
  const platformName = platform === 'tb' ? '淘宝' : '抖音';
  const name = `${brand ? brand + ' ' : ''}${cat} ${tag} 沙盒样例 ${i}`;
  return {
    platform,
    source: 'sandbox',
    goods_name: name,
    goods_desc: `${platformName}沙盒商品，用于前端同步和字段适配`,
    brand_name: brand || platformName,
    shop_name: shop,
    goods_image_url: `https://placehold.co/600x600?text=${encodeURIComponent(platformName)}`,
    goods_thumbnail_url: `https://placehold.co/300x300?text=${encodeURIComponent(platformName)}`,
    goods_id: `${platform}_sandbox_${i}`,
    sales_tip: `${i * 1000}+`,
    min_group_price_yuan: price + 20,
    coupon_discount_yuan: 20,
    coupon_price_yuan: price,
    has_coupon: true,
    unified_tags: ['沙盒', tag, shop],
    material_url: '',
    raw: { sandbox: true },
  };
}
function searchSandbox(platform, keyword) {
  const isTb = platform === 'tb';
  const list = [
    mockGoods(platform, keyword, 1, isTb ? 59 : 62, '低价渠道', isTb ? '淘宝渠道店' : '抖音好物店'),
    mockGoods(platform, keyword, 2, isTb ? 69 : 72, '授权/专营', isTb ? '天猫专营店' : '精选联盟专营店'),
    mockGoods(platform, keyword, 3, isTb ? 89 : 92, '官方旗舰', isTb ? '天猫官方旗舰店' : '品牌官方旗舰'),
    mockGoods(platform, keyword, 4, isTb ? 49 : 55, '适配款', isTb ? '淘宝配件店' : '抖音配件店'),
  ];
  return { ok: true, platform, source: 'sandbox', keyword, total_count: list.length, goods_list: list };
}

async function unifiedSearch(keyword, platforms, page, pageSize) {
  const wanted = platforms.includes('all') ? ['pdd', 'jd', 'tb', 'douyin'] : platforms;
  const tasks = wanted.map(async (p) => {
    try {
      if (p === 'pdd') return await searchPdd(keyword, page, pageSize);
      if (p === 'jd') return await searchJd(keyword, page, pageSize);
      if (p === 'tb' || p === 'taobao') return searchSandbox('tb', keyword);
      if (p === 'douyin' || p === 'dy') return searchSandbox('douyin', keyword);
      return { ok: false, platform: p, error: 'unknown_platform', goods_list: [] };
    } catch (err) {
      return { ok: false, platform: p, error: err.error || err.message || 'provider_error', detail: err, goods_list: [] };
    }
  });
  const results = await Promise.all(tasks);
  const goods = results.flatMap((r) => r.goods_list || []);
  return {
    ok: true,
    keyword,
    platforms: wanted,
    total_count: goods.length,
    providers: results.map(({ ok, platform, source, total_count, error }) => ({ ok, platform, source, total_count: total_count || 0, error })),
    goods_list: goods,
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data, null, 2));
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}
function findArrayDeep(value, keys = []) {
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) if (Array.isArray(value[key])) return value[key];
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) return child;
    if (child && typeof child === 'object') {
      const found = findArrayDeep(child, keys);
      if (found.length) return found;
    }
  }
  return [];
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/' || url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        name: '价比比 API',
        message: '价比比 API 已启动',
        env: {
          has_client_id: Boolean(PDD_CLIENT_ID),
          has_client_secret: Boolean(PDD_CLIENT_SECRET),
          has_pid: Boolean(PDD_PID),
          has_jd_app_key: Boolean(JD_APP_KEY),
          has_jd_app_secret: Boolean(JD_APP_SECRET),
          has_jd_position_id: Boolean(JD_POSITION_ID),
        },
      });
    }

    if (url.pathname === '/api/search' && req.method === 'GET') {
      const keyword = url.searchParams.get('keyword') || '小米充电宝';
      const platformParam = url.searchParams.get('platform') || 'all';
      const platforms = platformParam.split(',').map((x) => x.trim()).filter(Boolean);
      const page = Number(url.searchParams.get('page') || '1');
      const pageSize = Number(url.searchParams.get('page_size') || '20');
      return sendJson(res, 200, await unifiedSearch(keyword, platforms, page, pageSize));
    }

    if (url.pathname === '/api/pdd/search' && req.method === 'GET') {
      const keyword = url.searchParams.get('keyword') || '充电宝';
      const page = Number(url.searchParams.get('page') || '1');
      const pageSize = Number(url.searchParams.get('page_size') || '20');
      const data = await searchPdd(keyword, page, pageSize);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/jd/search' && req.method === 'GET') {
      const keyword = url.searchParams.get('keyword') || '充电宝';
      const page = Number(url.searchParams.get('page') || '1');
      const pageSize = Number(url.searchParams.get('page_size') || '20');
      const data = await searchJd(keyword, page, pageSize);
      return sendJson(res, 200, data);
    }

    if (url.pathname === '/api/tb/search' && req.method === 'GET') return sendJson(res, 200, searchSandbox('tb', url.searchParams.get('keyword') || '小米充电宝'));
    if (url.pathname === '/api/douyin/search' && req.method === 'GET') return sendJson(res, 200, searchSandbox('douyin', url.searchParams.get('keyword') || '小米充电宝'));

    if (url.pathname === '/api/pdd/link' && req.method === 'POST') {
      const rawBody = await readBody(req);
      let body = {};
      try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_) { body = {}; }
      const goodsSign = body.goods_sign || body.goodsSign || url.searchParams.get('goods_sign');
      if (!goodsSign) return sendJson(res, 400, { error: 'missing_goods_sign', message: 'goods_sign is required' });
      const result = await pddRequest('pdd.ddk.goods.promotion.url.generate', {
        p_id: PDD_PID,
        goods_sign_list: JSON.stringify([goodsSign]),
        generate_short_url: 'true',
        generate_mobile: 'true',
        generate_schema_url: 'true',
        generate_we_app: 'true',
        custom_parameters: PDD_CUSTOM_PARAMETERS,
      });
      if (result.error_response || result.error) return sendJson(res, 400, result);
      const item = result.goods_promotion_url_generate_response?.goods_promotion_url_list?.[0] || {};
      return sendJson(res, 200, { ok: true, platform: 'pdd', mobile_short_url: item.mobile_short_url, short_url: item.short_url, mobile_url: item.mobile_url, url: item.url, schema_url: item.schema_url, we_app_info: item.we_app_info, raw: result });
    }

    if (url.pathname === '/api/jd/link' && req.method === 'POST') {
      const rawBody = await readBody(req);
      let body = {};
      try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_) { body = {}; }
      const skuId = body.sku_id || body.skuId || url.searchParams.get('sku_id');
      const materialId = body.material_url || body.materialId || body.url || (skuId ? `https://item.jd.com/${skuId}.html` : '');
      const couponUrl = body.coupon_url || body.couponUrl || '';
      if (!materialId) return sendJson(res, 400, { error: 'missing_material_id', message: 'material_url or sku_id is required' });
      const result = await jdRequest(JD_PROMOTION_METHOD, { promotionCodeReq: cleanParams({ materialId, couponUrl, siteId: JD_SITE_ID, positionId: JD_POSITION_ID }) });
      if (result.error_response || result.error || result.code) return sendJson(res, 400, result);
      const clickURL = result.jd_union_open_promotion_common_get_response?.result?.clickURL || result.result?.clickURL || findArrayDeep(result, ['data'])?.[0]?.clickURL || '';
      return sendJson(res, 200, { ok: true, platform: 'jd', click_url: clickURL, url: clickURL, raw: result });
    }

    if ((url.pathname === '/api/tb/link' || url.pathname === '/api/douyin/link') && req.method === 'POST') {
      return sendJson(res, 200, { ok: true, sandbox: true, message: '沙盒平台暂未接入真实转链', url: 'https://jiabibi-web.onrender.com' });
    }

    return sendJson(res, 404, { error: 'not_found', path: url.pathname });
  } catch (err) {
    return sendJson(res, 500, { error: 'server_error', message: err.message || String(err), detail: err });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Jiabibi API running on port ${PORT}`));
