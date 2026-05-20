'use strict';
const { normalizePrice, detectShopType, makeItem } = require('../extractor-common');

// Mobile JD is less aggressive about risk-control from datacenter IPs.
// Desktop URL is kept as fallback in case mobile redirects.
const URLS = [
  'https://m.jd.com/ware/search.action?enc=utf-8&keyword=',
  'https://search.jd.com/Search?enc=utf-8&keyword=',
];

async function search(page, keyword) {
  let navigated = false;
  for (const base of URLS) {
    try {
      await page.goto(base + encodeURIComponent(keyword), { waitUntil: 'domcontentloaded', timeout: 20000 });
      navigated = true;
      break;
    } catch { /* try next URL */ }
  }
  if (!navigated) return { status: 'failed', failed_reason: 'navigation_timeout', items: [] };

  const cur = page.url();
  if (cur.includes('passport.jd.com') || cur.includes('/login')) {
    return { status: 'need_user_login', items: [] };
  }
  const hasCaptcha = await page.$('#captcha_container,.JDJRV-bigimg,[class*="captcha"],[class*="verify"]').catch(() => null);
  if (hasCaptcha) return { status: 'need_user_action', items: [], failed_reason: 'captcha_detected' };

  // Wait for any product grid — mobile or desktop selectors
  await page.waitForSelector(
    '#J_goodsList .gl-item,[data-sku],[class*="goods-item"],[class*="goodsList"] li,[class*="product-item"]',
    { timeout: 10000 }
  ).catch(() => {});

  const raw = await page.evaluate(() => {
    const out = [];
    function text(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
    function attr(el, a) { return el ? (el.getAttribute(a) || '') : ''; }
    function httpsify(u) { return u && !u.startsWith('http') ? 'https:' + u : u; }

    // Selector sets: [card, title, price, shop, link, img]
    const patterns = [
      // Desktop JD
      ['#J_goodsList .gl-item,[data-sku]',
       '.p-name a em,.p-name em,.p-name a',
       '.p-price strong i,.p-price i,[class*="price"] i',
       '.p-shop a,.p-shopnum a',
       '.p-name a,[href*="item.jd"]',
       '.p-img img,[data-lazy-img]'],
      // Mobile JD
      ['[class*="goods-item"],[class*="goodsList"] li',
       '[class*="goods-name"] h4,[class*="goods-name"] p,[class*="goodsName"]',
       '[class*="current-price"],[class*="goods-price"],[class*="price"]',
       '[class*="goods-shop"],[class*="shop"]',
       'a[href]',
       'img'],
      // Generic fallback
      ['[class*="product-item"],[class*="item-wrapper"]',
       '[class*="title"],[class*="name"],h3,h4',
       '[class*="price"],[class*="amount"]',
       '[class*="shop"],[class*="store"]',
       'a[href]',
       'img'],
    ];

    for (const [cardSel, titleSel, priceSel, shopSel, linkSel, imgSel] of patterns) {
      const cards = document.querySelectorAll(cardSel);
      if (cards.length < 2) continue;
      Array.from(cards).slice(0, 20).forEach(card => {
        try {
          const title = text(card.querySelector(titleSel));
          const priceEl = card.querySelector(priceSel);
          let priceStr = '';
          if (priceEl) {
            const sub = priceEl.querySelector('i,em,strong,span');
            priceStr = sub ? text(sub) : text(priceEl);
          }
          const shopName = text(card.querySelector(shopSel));
          const linkEl = card.querySelector(linkSel);
          let itemUrl = httpsify(attr(linkEl, 'href') || (linkEl && linkEl.href) || '');
          const imgEl = card.querySelector(imgSel);
          let imageUrl = httpsify(attr(imgEl, 'data-lazy-img') || attr(imgEl, 'data-src') || (imgEl && imgEl.src) || '');
          const badges = [];
          card.querySelectorAll('.p-icons i,.p-icon i').forEach(b => badges.push(text(b)));
          if (title && priceStr) out.push({ title, priceStr, shopName, itemUrl, imageUrl, badges, rawText: card.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) });
        } catch (_) {}
      });
      if (out.length > 0) break;
    }
    return out;
  });

  const items = raw.map(r => makeItem({
    provider: 'jd', title: r.title, price: normalizePrice(r.priceStr),
    shopName: r.shopName || '京东', shopType: detectShopType(r.shopName, r.badges),
    itemUrl: r.itemUrl, imageUrl: r.imageUrl,
    confidence: r.title && r.priceStr ? 0.85 : 0.5, rawVisibleText: r.rawText,
  })).filter(x => x.price > 0 && x.title);

  return { status: items.length ? 'success' : 'failed', items, failed_reason: items.length ? undefined : 'no_items_extracted' };
}

module.exports = { search };
