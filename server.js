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

const PORT = process.env.PORT || 3000;
const PDD_API_URL = process.env.PDD_API_URL || 'https://gw-api.pinduoduo.com/api/router';
const CLIENT_ID = process.env.PDD_CLIENT_ID;
const CLIENT_SECRET = process.env.PDD_CLIENT_SECRET;
const PDD_PID = process.env.PDD_PID;
const CUSTOM_PARAMETERS = process.env.PDD_CUSTOM_PARAMETERS || '';

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
          reject(new Error('PDD returned non-JSON: ' + data.slice(0, 300)));
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

function fenToYuan(value) {
  const n = Number(value || 0);
  return Math.round(n) / 100;
}

function normalizeGoods(item) {
  const minGroupPrice = Number(item.min_group_price || 0);
  const couponDiscount = Number(item.coupon_discount || item.extra_coupon_amount || 0);
  const couponPrice = Math.max(0, minGroupPrice - couponDiscount);
  return {
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
        mobile_short_url: item.mobile_short_url,
        short_url: item.short_url,
        mobile_url: item.mobile_url,
        url: item.url,
        schema_url: item.schema_url,
        we_app_info: item.we_app_info,
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
