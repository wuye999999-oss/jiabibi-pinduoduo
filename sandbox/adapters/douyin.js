'use strict';
const { normalizePrice, detectShopType, makeItem } = require('../extractor-common');

const URLS = [
  'https://haohuo.jinritemai.com/views/product/list?search_text=', // 抖音好货 — shopping-specific, lighter
  'https://www.douyin.com/search/',                                 // full-site search fallback
];

async function search(page, keyword) {
  let navigated = false;
  for (let i = 0; i < URLS.length; i++) {
    const url = i === 1
      ? URLS[i] + encodeURIComponent(keyword) + '?type=goods'
      : URLS[i] + encodeURIComponent(keyword);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      navigated = true;
      break;
    } catch { /* try next */ }
  }
  if (!navigated) return { status: 'failed', failed_reason: 'navigation_timeout', items: [] };

  const cur = page.url();
  if (/login|passport|sso/.test(cur)) return { status: 'need_user_login', items: [] };

  const hasVerify = await page.$('[class*="verify"],[class*="captcha"],[class*="qrcode"],[class*="slider"]').catch(() => null);
  if (hasVerify) return { status: 'need_user_action', items: [], failed_reason: 'security_verification' };

  await page.waitForSelector(
    '[class*="product-card"],[class*="goods-item"],[class*="shop-card"],[class*="ProductCard"],[class*="commodity"]',
    { timeout: 8000 }
  ).catch(() => {});

  const raw = await page.evaluate(() => {
    const out = [];
    function t(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
    function httpsify(u) { if (!u) return ''; return u.startsWith('http') ? u : 'https:' + u.replace(/^\/\//, ''); }
    function attr(el, a) { return el ? (el.getAttribute(a) || '') : ''; }

    const patterns = [
      // 抖音好货 (haohuo.jinritemai.com)
      ['[class*="product-card"],[class*="ProductCard"],[class*="commodity-card"]',
       '[class*="title"],[class*="name"],[class*="Title"]',
       '[class*="price"],[class*="amount"],[class*="Price"]'],
      // 抖音搜索 (www.douyin.com)
      ['[class*="goods-item"],[class*="shop-card"],[class*="GoodsCard"]',
       '[class*="title"],[class*="name"],h3,h4',
       '[class*="price"],[class*="amount"]'],
      // Generic fallback
      ['[class*="product"],[class*="item-wrap"]',
       '[class*="title"],[class*="name"],h3',
       '[class*="price"]'],
    ];

    for (const [cardSel, titleSel, priceSel] of patterns) {
      const cards = document.querySelectorAll(cardSel);
      if (cards.length < 2) continue;
      Array.from(cards).slice(0, 20).forEach(card => {
        try {
          const title = t(card.querySelector(titleSel));
          const priceEl = card.querySelector(priceSel);
          let priceStr = '';
          if (priceEl) {
            const sub = priceEl.querySelector('em,strong,span,i');
            priceStr = sub ? t(sub) : t(priceEl);
          }
          const shopEl = card.querySelector('[class*="shop"],[class*="Store"],[class*="seller"],[class*="brand"]');
          const shopName = t(shopEl);
          const linkEl = card.querySelector('a[href]');
          const itemUrl = httpsify(attr(linkEl, 'href') || (linkEl && linkEl.href) || '');
          const imgEl = card.querySelector('img');
          const imageUrl = httpsify(attr(imgEl, 'data-src') || attr(imgEl, 'src') || (imgEl && imgEl.src) || '');
          if (title && priceStr) out.push({ title, priceStr, shopName, itemUrl, imageUrl, rawText: card.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) });
        } catch (_) {}
      });
      if (out.length > 0) break;
    }
    return out;
  });

  if (!raw.length) return { status: 'failed', items: [], failed_reason: 'no_items_extracted' };

  const items = raw.map(r => makeItem({
    provider: 'douyin', title: r.title, price: normalizePrice(r.priceStr),
    shopName: r.shopName, shopType: detectShopType(r.shopName, []),
    itemUrl: r.itemUrl, imageUrl: r.imageUrl,
    confidence: 0.70, rawVisibleText: r.rawText,
  })).filter(x => x.price > 0 && x.title);

  return { status: items.length ? 'success' : 'failed', items, failed_reason: items.length ? undefined : 'no_priced_items' };
}

module.exports = { search };
