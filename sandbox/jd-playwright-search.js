'use strict';
// 无状态 Playwright JD 搜索 — 每次请求独立启动 headless Chromium，
// 用于 JD Union API 权限不足时的自动降级。
// 启用条件：server.js 中 JD_PLAYWRIGHT_ENABLED=true（默认开启）。

const JD_PW_TIMEOUT_MS = Number(process.env.JD_PW_TIMEOUT_MS || 18000);
const JD_PW_WAIT_MS = Number(process.env.JD_PW_WAIT_MS || 8000);

function httpsUrl(u) {
  if (!u) return '';
  const s = String(u).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return 'https:' + (s.startsWith('//') ? s : '//' + s);
}

function parsePrice(str) {
  const m = String(str || '').replace(/,/g, '').match(/\d+\.?\d*/);
  return m ? parseFloat(m[0]) : 0;
}

function detectShopType(shopName, badges) {
  const text = [shopName, ...(badges || [])].join(' ').toLowerCase();
  if (/京东自营|jd自营/.test(text)) return 'official';
  if (/官方旗舰店|品牌旗舰店|旗舰店/.test(text)) return 'official';
  if (/专卖店|专营店|授权/.test(text)) return 'channel';
  return 'normal';
}

function normalizeItem(r) {
  const price = parsePrice(r.priceStr);
  const skuId = (r.itemUrl || '').match(/\/(\d+)\.html/)?.[1] || '';
  const shopType = detectShopType(r.shopName, r.badges);
  const storeTypeTag = shopType === 'official' ? '官方/自营' : (shopType === 'channel' ? '渠道' : '普通');
  return {
    platform: 'jd',
    source: 'playwright',
    goods_name: r.title || '',
    goods_desc: r.title || '',
    brand_name: '',
    shop_name: r.shopName || '京东',
    shop_type: shopType,
    goods_image_url: httpsUrl(r.imageUrl),
    goods_thumbnail_url: httpsUrl(r.imageUrl),
    sku_id: skuId,
    goods_id: skuId,
    sales_tip: '',
    min_group_price_yuan: price,
    coupon_discount_yuan: 0,
    coupon_price_yuan: price,
    has_coupon: false,
    unified_tags: ['京东', storeTypeTag],
    material_url: r.itemUrl || '',
    url: r.itemUrl || '',
  };
}

async function searchJdPlaywright(q, pageSize = 20) {
  let pw;
  try { pw = require('playwright'); }
  catch {
    return { ok: false, platform: 'jd', source: 'playwright', error: 'playwright_not_installed', goods_list: [], total_count: 0 };
  }

  let browser;
  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const context = await browser.newContext({
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    const searchUrl = 'https://search.jd.com/Search?enc=utf-8&keyword=' + encodeURIComponent(q);
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: JD_PW_TIMEOUT_MS });
    } catch {
      return { ok: false, platform: 'jd', source: 'playwright', error: 'navigation_timeout', goods_list: [], total_count: 0 };
    }

    const curUrl = page.url();
    if (curUrl.includes('passport.jd.com') || curUrl.includes('/login')) {
      return { ok: false, platform: 'jd', source: 'playwright', error: 'need_login', goods_list: [], total_count: 0 };
    }
    const hasCaptcha = await page.$('#captcha_container,.JDJRV-bigimg,[class*="captcha"]').catch(() => null);
    if (hasCaptcha) {
      return { ok: false, platform: 'jd', source: 'playwright', error: 'captcha_detected', goods_list: [], total_count: 0 };
    }

    await page.waitForSelector('#J_goodsList .gl-item,[data-sku]', { timeout: JD_PW_WAIT_MS }).catch(() => {});

    const raw = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#J_goodsList .gl-item,[data-sku]').forEach(card => {
        try {
          const titleEl = card.querySelector('.p-name a em,.p-name em,.p-name a');
          const title = titleEl ? titleEl.textContent.trim() : '';
          const priceEl = card.querySelector('.p-price strong i,.p-price i,[class*="price"] i');
          const priceStr = priceEl ? priceEl.textContent.trim() : '';
          const shopEl = card.querySelector('.p-shop a,.p-shopnum a');
          const shopName = shopEl ? shopEl.textContent.trim() : '';
          let itemUrl = (card.querySelector('.p-name a,[href*="item.jd"]') || {}).href || '';
          if (itemUrl && !itemUrl.startsWith('http')) itemUrl = 'https:' + itemUrl;
          let imageUrl = '';
          const imgEl = card.querySelector('.p-img img,[data-lazy-img]');
          if (imgEl) imageUrl = imgEl.getAttribute('data-lazy-img') || imgEl.src || '';
          if (imageUrl && !imageUrl.startsWith('http')) imageUrl = 'https:' + imageUrl;
          const badges = [];
          card.querySelectorAll('.p-icons i,.p-icon i').forEach(b => {
            const t = b.textContent.trim();
            if (t) badges.push(t);
          });
          if (title && priceStr) out.push({ title, priceStr, shopName, itemUrl, imageUrl, badges });
        } catch (_) {}
      });
      return out.slice(0, 30);
    });

    const goods = raw
      .slice(0, Math.min(pageSize, 30))
      .map(normalizeItem)
      .filter(x => x.coupon_price_yuan > 0 && x.goods_name);

    return {
      ok: goods.length > 0,
      platform: 'jd',
      source: 'playwright',
      keyword: q,
      total_count: goods.length,
      goods_list: goods,
    };
  } catch (e) {
    return { ok: false, platform: 'jd', source: 'playwright', error: e.message, goods_list: [], total_count: 0 };
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
  }
}

module.exports = { searchJdPlaywright };
