const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Optional local .env loader. On Render, use Environment Variables instead.
function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadLocalEnv();

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

const PORT = process.env.PORT || 3000;

// Pinduoduo config
const PDD_API_URL = process.env.PDD_API_URL || 'https://gw-api.pinduoduo.com/api/router';
const CLIENT_ID = process.env.PDD_CLIENT_ID;
const CLIENT_SECRET = process.env.PDD_CLIENT_SECRET;
const PDD_PID = process.env.PDD_PID;
const CUSTOM_PARAMETERS = process.env.PDD_CUSTOM_PARAMETERS || '';

// JD Union config
const JD_API_URL = envFirst('JD_API_URL') || 'https://api.jd.com/routerjson';
const JD_APP_KEY = envFirst('JD_APP_KEY', 'JD_APPKEY', 'JD_APP_KEY_ID', 'JD_KEY', 'APP_KEY');
const JD_APP_SECRET = envFirst('JD_APP_SECRET', 'JD_APPSECRET', 'JD_SECRET', 'JD_SECRET_KEY', 'SECRET_KEY', 'APP_SECRET');
const JD_ACCESS_TOKEN = envFirst('JD_ACCESS_TOKEN', 'JD_TOKEN', 'ACCESS_TOKEN');
const JD_POSITION_ID = envFirst('JD_POSITION_ID', 'JD_POSITIONID', 'JD_POS_ID') || '3104496027';
const JD_PID = envFirst('JD_PID') || '2038054117_4104082584_3104496027';
const JD_SITE_ID = envFirst('JD_SITE_ID', 'JD_SITEID') || (JD_PID.split('_')[1] || '');
const JD_PROMOTION_METHOD = envFirst('JD_PROMOTION_METHOD') || 'jd.union.open.promotion.common.get';

function cleanParams(params) {
  const cleaned = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    cleaned[key] = String(value);
  }
  return cleaned;
}

function md5Upper(input) {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex').toUpperCase();
}

function makeSign(params, secret) {
  const keys = Object.keys(params).sort();
  let raw = secret;
  for (const key of keys) raw += key + params[key];
  raw += secret;
  return md5Upper(raw);
}

function jdTimestamp() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const beijing = new Date(utc + 8 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${beijing.getFullYear()}-${pad(beijing.getMonth() + 1)}-${pad(beijing.getDate())} ${pad(beijing.getHours())}:${pad(beijing.getMinutes())}:${pad(beijing.getSeconds())}`;
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
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('API returned non-JSON: ' + data.slice(0, 300)));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function pddRequest(type, bizParams = {}) {
  if (!CLIENT_ID || !CLIENT_SECRET || !PDD_PID) {
    return {
      error: 'missing_env',
      message: 'Missing PDD_CLIENT_ID, PDD_CLIENT_SECRET, or PDD_PID in Render Environment Variables.',
    };
  }

  const params = cleanParams({
    type,
    client_id: CLIENT_ID,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    data_type: 'JSON',
    ...bizParams,
  });
  params.sign = makeSign(params, CLIENT_SECRET.trim());
  return postForm(PDD_API_URL, params);
}

async function jdRequest(method, bizObject = {}) {
  if (!JD_APP_KEY || !JD_APP_SECRET) {
    return {
      error: 'missing_jd_env',
      message: 'Missing JD_APP_KEY/JD_APPKEY or JD_APP_SECRET/JD_SECRET in Render Environment Variables.',
    };
  }

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

function fenToYuan(value) {
  const n = Number(value || 0);
  return Math.round(n) / 100;
}

function normalizeGoods(item) {
  const minGroupPrice = Number(item.min_group_price || 0);
  const couponDiscount = Number(item.coupon_discount || item.extra_coupon_amount || 0);
  const couponPrice = Math.max(0, minGroupPrice - couponDiscount);
  return {
    platform: 'pdd',
    goods_name: item.goods_name,
    goods_desc: item.goods_desc,
    brand_name: item.brand_name || '',
    goods_image_url: item.goods_image_url,
    goods_thumbnail_url: item.goods_thumbnail_url || item.goods_image_url,
    goods_sign: item.goods_sign,
    goods_id: item.goods_id,
    sales_tip: item.sales_tip || '',
    min_group_price: minGroupPrice,
    min_group_price_yuan: fenToYuan(minGroupPrice),
    coupon_discount: couponDiscount,
    coupon_discount_yuan: fenToYuan(couponDiscount),
    coupon_price: couponPrice,
    coupon_price_yuan: fenToYuan(couponPrice),
    has_coupon: Boolean(item.has_coupon),
    unified_tags: item.unified_tags || [],
    promotion_rate: item.promotion_rate || 0,
    raw: item,
  };
}

function pickJdImage(item) {
  const img = item.imageInfo?.imageList?.[0]?.url || item.imageInfo?.whiteImage || item.imgUrl || item.imageUrl || '';
  if (!img) return '';
  return img.startsWith('http') ? img : `https:${img}`;
}

function pickBestJdCoupon(item) {
  const list = item.couponInfo?.couponList || item.couponList || [];
  if (!Array.isArray(list) || !list.length) return null;
  return list.find((c) => Number(c.isBest) === 1) || list[0];
}

function normalizeJdGoods(item) {
  const priceInfo = item.priceInfo || {};
  const coupon = pickBestJdCoupon(item);
  const price = Number(priceInfo.lowestPrice || priceInfo.price || priceInfo.jdPrice || 0);
  const finalPrice = Number(priceInfo.lowestCouponPrice || priceInfo.finalPrice || price || 0);
  const couponDiscount = Math.max(0, price - finalPrice);
  const skuId = item.skuId || item.sku_id || item.skuID || '';
  const materialUrl = item.materialUrl || item.link || item.itemUrl || item.url || (skuId ? `https://item.jd.com/${skuId}.html` : '');

  return {
    platform: 'jd',
    goods_name: item.skuName || item.goodsName || item.title || '',
    goods_desc: item.skuName || item.goodsName || item.title || '',
    brand_name: item.brandName || item.shopInfo?.shopName || '京东',
    shop_name: item.shopInfo?.shopName || '',
    goods_image_url: pickJdImage(item),
    goods_thumbnail_url: pickJdImage(item),
    sku_id: skuId,
    goods_id: skuId,
    material_url: materialUrl,
    coupon_url: coupon?.link || coupon?.couponUrl || '',
    sales_tip: item.inOrderCount30Days ? String(item.inOrderCount30Days) : (item.comments || ''),
    min_group_price_yuan: price,
    coupon_discount_yuan: couponDiscount,
    coupon_price_yuan: finalPrice,
    has_coupon: Boolean(coupon),
    unified_tags: [coupon ? '有优惠券' : '', item.owner === 'g' ? '京东自营' : '', item.shopInfo?.shopName || ''].filter(Boolean),
    promotion_rate: item.commissionInfo?.commissionShare || 0,
    raw: item,
  };
}

function findArrayDeep(value, keys = []) {
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) return child;
    if (child && typeof child === 'object') {
      const found = findArrayDeep(child, keys);
      if (found.length) return found;
    }
  }
  return [];
}

function findNumberDeep(value, keys = []) {
  if (!value || typeof value !== 'object') return 0;
  for (const key of keys) {
    if (value[key] !== undefined && !Number.isNaN(Number(value[key]))) return Number(value[key]);
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findNumberDeep(child, keys);
      if (found) return found;
    }
  }
  return 0;
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
          has_client_id: Boolean(CLIENT_ID),
          has_client_secret: Boolean(CLIENT_SECRET),
          has_pid: Boolean(PDD_PID),
          has_jd_app_key: Boolean(JD_APP_KEY),
          has_jd_app_secret: Boolean(JD_APP_SECRET),
          has_jd_position_id: Boolean(JD_POSITION_ID),
          jd_api_url: JD_API_URL,
          jd_env_hint: 'Accepted names: JD_APP_KEY or JD_APPKEY; JD_APP_SECRET or JD_SECRET/JD_SECRET_KEY.',
        },
      });
    }

    if (url.pathname === '/api/pdd/search' && req.method === 'GET') {
      const keyword = url.searchParams.get('keyword') || '充电宝';
      const page = url.searchParams.get('page') || '1';
      const pageSize = url.searchParams.get('page_size') || '20';
      const sortType = url.searchParams.get('sort_type') || undefined;

      const result = await pddRequest('pdd.ddk.goods.search', {
        keyword,
        page,
        page_size: pageSize,
        with_coupon: 'true',
        pid: PDD_PID,
        custom_parameters: CUSTOM_PARAMETERS,
        sort_type: sortType,
      });

      if (result.error_response || result.error) return sendJson(res, 400, result);

      const response = result.goods_search_response || {};
      const list = (response.goods_list || []).map(normalizeGoods);
      return sendJson(res, 200, {
        ok: true,
        platform: 'pdd',
        keyword,
        total_count: response.total_count || list.length,
        search_id: response.search_id || response.list_id || '',
        goods_list: list,
      });
    }

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
        custom_parameters: CUSTOM_PARAMETERS,
      });

      if (result.error_response || result.error) return sendJson(res, 400, result);

      const item = result.goods_promotion_url_generate_response?.goods_promotion_url_list?.[0] || {};
      return sendJson(res, 200, {
        ok: true,
        platform: 'pdd',
        mobile_short_url: item.mobile_short_url,
        short_url: item.short_url,
        mobile_url: item.mobile_url,
        url: item.url,
        schema_url: item.schema_url,
        we_app_info: item.we_app_info,
        raw: result,
      });
    }

    if (url.pathname === '/api/jd/search' && req.method === 'GET') {
      const keyword = url.searchParams.get('keyword') || '充电宝';
      const page = Number(url.searchParams.get('page') || '1');
      const pageSize = Number(url.searchParams.get('page_size') || '20');
      const result = await jdRequest('jd.union.open.goods.query', {
        goodsReqDTO: {
          keyword,
          pageIndex: page,
          pageSize: Math.min(pageSize, 30),
          hasBestCoupon: 1,
          pid: JD_PID,
        },
      });

      if (result.error_response || result.error || result.code) return sendJson(res, 400, result);
      const rawList = findArrayDeep(result, ['data', 'goodsList', 'result', 'list']);
      const list = rawList.map(normalizeJdGoods);
      const totalCount = findNumberDeep(result, ['totalCount', 'total_count', 'total']) || list.length;
      return sendJson(res, 200, {
        ok: true,
        platform: 'jd',
        keyword,
        total_count: totalCount,
        goods_list: list,
        raw: result,
      });
    }

    if (url.pathname === '/api/jd/link' && req.method === 'POST') {
      const rawBody = await readBody(req);
      let body = {};
      try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_) { body = {}; }
      const skuId = body.sku_id || body.skuId || url.searchParams.get('sku_id');
      const materialId = body.material_url || body.materialId || body.url || (skuId ? `https://item.jd.com/${skuId}.html` : '');
      const couponUrl = body.coupon_url || body.couponUrl || '';
      if (!materialId) return sendJson(res, 400, { error: 'missing_material_id', message: 'material_url or sku_id is required' });

      const promotionCodeReq = cleanParams({
        materialId,
        couponUrl,
        siteId: JD_SITE_ID,
        positionId: JD_POSITION_ID,
      });
      const result = await jdRequest(JD_PROMOTION_METHOD, { promotionCodeReq });

      if (result.error_response || result.error || result.code) return sendJson(res, 400, result);
      const clickURL = result.jd_union_open_promotion_common_get_response?.result?.clickURL || result.result?.clickURL || findArrayDeep(result, ['data'])?.[0]?.clickURL || '';
      return sendJson(res, 200, {
        ok: true,
        platform: 'jd',
        click_url: clickURL,
        url: clickURL,
        raw: result,
      });
    }

    return sendJson(res, 404, { error: 'not_found', path: url.pathname });
  } catch (err) {
    return sendJson(res, 500, { error: 'server_error', message: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Jiabibi API running on port ${PORT}`);
});
