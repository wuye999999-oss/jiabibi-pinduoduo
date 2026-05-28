'use strict';
const { normalizePrice, detectShopType, makeItem } = require('../extractor-common');

const URLS = [
  'https://s.m.taobao.com/h5?q=',        // mobile — lighter risk-control
  'https://s.taobao.com/search?q=',       // desktop fallback
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

  const cur = page.url();
  if (/login\.taobao\.com|login\.m\.taobao\.com/.test(cur)) {
    return { status: 'need_user_login', items: [] };
  }
  const hasRisk = await page.$('#nocaptcha,.nc-container,[id*="J_HsecSdk"],[class*="security"]').catch(() => null);
  if (hasRisk) return { status: 'need_user_action', items: [], failed_reason: 'security_verification' };

  await page.waitForSelector(
    '[class*="item--"],[class*="BItem"],[class*="card--"],[class*="ItemCard"],.search-item,[data-id],[class*="items_"]',
    { timeout: 10000 }
  ).catch(() => {});

  const raw = await page.evaluate(() => {
    const out = [];
    function t(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
    function httpsify(u) { if (!u) return ''; return u.startsWith('http') ? u : 'https:' + u.replace(/^\/\//, ''); }
    function attr(el, a) { return el ? (el.getAttribute(a) || '') : ''; }

    const patterns = [
      // Mobile Taobao
      ['[class*="item--"],[class*="BItem"],[class*="card--"],[class*="ItemCard"]',
       '[class*="title"],[class*="Title"],h3,h4',
       '[class*="price"],[class*="Price"]'],
      // Desktop Taobao
      ['.search-item,[data-id]',
       '[class*="title"],[class*="Title"],h3,h4',
       '[class*="price"],[class*="Price"]'],
      // Generic fallback
      ['[class*="items_"] li,[class*="goods-item"]',
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
          const shopEl = card.querySelector('[class*="shop"],[class*="Store"],[class*="mall"],[class*="seller"]');
          const shopName = t(shopEl);
          const linkEl = card.querySelector('a[href*="item.taobao"],a[href*="detail.tmall"],a[href]');
          const itemUrl = httpsify(attr(linkEl, 'href') || (linkEl && linkEl.href) || '');
          const imgEl = card.querySelector('img');
          const imageUrl = httpsify(attr(imgEl, 'data-src') || attr(imgEl, 'src') || (imgEl && imgEl.src) || '');
          const isTmall = card.textContent.includes('天猫') || shopName.includes('天猫');
          if (title && priceStr) out.push({ title, priceStr, shopName, itemUrl, imageUrl, isTmall, rawText: card.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) });
        } catch (_) {}
      });
      if (out.length > 0) break;
    }
    return out;
  });

  const items = raw.map(r => {
    let shopType = detectShopType(r.shopName, []);
    if (shopType === 'normal' && r.isTmall) shopType = 'flagship';
    return makeItem({
      provider: 'taobao', title: r.title, price: normalizePrice(r.priceStr),
      shopName: r.shopName, shopType,
      itemUrl: r.itemUrl, imageUrl: r.imageUrl,
      confidence: r.title && r.priceStr ? 0.80 : 0.5, rawVisibleText: r.rawText,
    });
  }).filter(x => x.price > 0 && x.title);

  return { status: items.length ? 'success' : 'failed', items, failed_reason: items.length ? undefined : 'no_items_extracted' };
}

module.exports = { search };
