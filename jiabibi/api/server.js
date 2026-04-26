const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(__dirname, '.env.example'), envPath);
  console.log('Created .env. Please fill it, save, then run again.');
  process.exit(0);
}

function loadEnv(file) {
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    process.env[key] = value;
  }
}
loadEnv(envPath);

const CLIENT_ID = process.env.PDD_CLIENT_ID;
const CLIENT_SECRET = process.env.PDD_CLIENT_SECRET;
const PID = process.env.PDD_PID;
const PORT = Number(process.env.PORT || 3000);
const API_URL = 'https://gw-api.pinduoduo.com/api/router';

if (!CLIENT_ID || !CLIENT_SECRET || CLIENT_ID.includes('你的') || CLIENT_SECRET.includes('你的')) {
  console.log('Missing PDD_CLIENT_ID or PDD_CLIENT_SECRET in .env');
  process.exit(1);
}
if (!PID || PID.includes('你的')) {
  console.log('Missing PDD_PID in .env');
  process.exit(1);
}

function md5Upper(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
}

function makeSign(params, secret) {
  const keys = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  let s = secret;
  for (const key of keys) s += key + params[key];
  s += secret;
  return md5Upper(s);
}

function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from PDD: ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function pddRequest(type, bizParams) {
  const params = {
    type,
    client_id: CLIENT_ID,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    data_type: 'JSON',
    ...bizParams
  };
  params.sign = makeSign(params, CLIENT_SECRET);
  return postForm(API_URL, params);
}

function json(res, status, obj) {
  const text = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(text);
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

function fenToYuan(fen) {
  if (typeof fen !== 'number') return null;
  return Number((fen / 100).toFixed(2));
}

function normalizeGoods(item) {
  const coupon = item.coupon_discount || 0;
  const groupPrice = item.min_group_price || 0;
  const finalPriceFen = Math.max(groupPrice - coupon, 0);
  return {
    goods_name: item.goods_name,
    brand_name: item.brand_name || '',
    image: item.goods_thumbnail_url || item.goods_image_url,
    goods_image_url: item.goods_image_url,
    min_group_price: fenToYuan(groupPrice),
    coupon_discount: fenToYuan(coupon),
    final_price: fenToYuan(finalPriceFen),
    sales_tip: item.sales_tip || '',
    goods_sign: item.goods_sign,
    goods_id: item.goods_id,
    has_coupon: !!item.has_coupon,
    tags: item.unified_tags || []
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <h2>价比比 API 已启动</h2>
        <p>搜索测试：</p>
        <p><a href="/api/pdd/search?keyword=充电宝">/api/pdd/search?keyword=充电宝</a></p>
        <p>生成推广链接请 POST /api/pdd/link，JSON: {"goods_sign":"..."}</p>
      `);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/pdd/search') {
      const keyword = url.searchParams.get('keyword') || '充电宝';
      const page = url.searchParams.get('page') || '1';
      const page_size = url.searchParams.get('page_size') || '10';

      const result = await pddRequest('pdd.ddk.goods.search', {
        keyword,
        page,
        page_size,
        with_coupon: 'true',
        pid: PID
      });

      if (result.error_response) return json(res, 400, result);

      const response = result.goods_search_response || {};
      const list = (response.goods_list || []).map(normalizeGoods);
      return json(res, 200, {
        ok: true,
        keyword,
        total_count: response.total_count || list.length,
        search_id: response.search_id || response.list_id,
        goods_list: list
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/pdd/link') {
      const body = await readBody(req);
      const goods_sign = body.goods_sign;
      if (!goods_sign) return json(res, 400, { ok: false, message: 'missing goods_sign' });

      const result = await pddRequest('pdd.ddk.goods.promotion.url.generate', {
        p_id: PID,
        goods_sign_list: JSON.stringify([goods_sign]),
        generate_short_url: 'true',
        generate_schema_url: 'true',
        generate_we_app: 'true'
      });

      if (result.error_response) return json(res, 400, result);

      const item = result.goods_promotion_url_generate_response?.goods_promotion_url_list?.[0] || {};
      return json(res, 200, {
        ok: true,
        mobile_short_url: item.mobile_short_url,
        short_url: item.short_url,
        mobile_url: item.mobile_url,
        url: item.url,
        schema_url: item.schema_url,
        we_app_info: item.we_app_info || null,
        raw: item
      });
    }

    return json(res, 404, { ok: false, message: 'not found' });
  } catch (err) {
    return json(res, 500, { ok: false, message: err.message });
  }
});

server.listen(PORT, () => {
  console.log('Jiabibi API running: http://localhost:' + PORT);
  console.log('Search test: http://localhost:' + PORT + '/api/pdd/search?keyword=%E5%85%85%E7%94%B5%E5%AE%9D');
});
