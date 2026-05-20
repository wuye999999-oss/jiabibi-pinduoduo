'use strict';
const { normalizePrice, detectShopType, makeItem } = require('../extractor-common');

const URLS = [
  'https://mobile.yangkeduo.com/search_result.html?search_key=',
  'https://yangkeduo.com/search_result.html?search_key=',
];

async function search(page, keyword) {
  let navigated = false;
  for (const base of URLS) {
    try {
      await page.goto(base + encodeURIComponent(keyword), { waitUntil: 'domcontentloaded', timeout: 20000 });
      navigated = true;
      break;
    } catch { /* try next */ }
  }
  if (!navigated) return { status: 'failed', failed_reason: 'navigation_timeout', items: [] };

  const hasVerify = await page.$('[class*="verify"],[class*="captcha"],[class*="slide"],[class*="Verify"]').catch(() => null);
  if (hasVerify) return { status: 'need_user_action', items: [], failed_reason: 'verification_required' };

  await page.waitForSelector(
    '[class*="SearchItem"],[class*="search-item"],[class*="goods-item"],[class*="goodsItem"],[class*="item-wrapper"]',
    { timeout: 10000 }
  ).catch(() => {});

  const raw = await page.evaluate(() => {
    const out = [];
    function t(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
    function httpsify(u) { return u && !u.startsWith('http') ? 'https:' + u : u; }
    function attr(el, a) { return el ? (el.getAttribute(a) || '') : ''; }

    const patterns = [
      ['[class*="SearchItem"],[class*="search-item"]',
       '[class*="goods-name"],[class*="goodsName"],[class*="item-title"],[class*="title"]',
       '[class*="goods-price"],[class*="goodsPrice"],[class*="price"],[class*="amount"]'],
      ['[class*="goods-item"],[class*="goodsItem"]',
       '[class*="title"],[class*="name"],h3,h4',
       '[class*="price"],[class*="amount"]'],
      ['[class*="item-wrapper"],[class*="product-item"]',
       '[class*="title"],[class*="name"],h3,h4',
       '[class*="price"],[class*="amount"]'],
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
          const shopEl = card.querySelector('[class*="shop"],[class*="store"],[class*="mall"]');
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

  const items = raw.map(r => makeItem({
    provider: 'pdd', title: r.title, price: normalizePrice(r.priceStr),
    shopName: r.shopName, shopType: detectShopType(r.shopName, []),
    itemUrl: r.itemUrl, imageUrl: r.imageUrl,
    confidence: r.title && r.priceStr ? 0.75 : 0.4, rawVisibleText: r.rawText,
  })).filter(x => x.price > 0 && x.title);

  return { status: items.length ? 'success' : 'failed', items, failed_reason: items.length ? undefined : 'no_items_extracted' };
}

module.exports = { search };
