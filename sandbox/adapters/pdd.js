'use strict';
const { normalizePrice, makeItem } = require('../extractor-common');

async function search(page, keyword) {
  const url = 'https://mobile.yangkeduo.com/search_result.html?search_key=' + encodeURIComponent(keyword);
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
  catch { return { status: 'failed', failed_reason: 'navigation_timeout', items: [] }; }

  const hasVerify = await page.$('[class*="verify"],[class*="captcha"],[class*="slide"]').catch(() => null);
  if (hasVerify) return { status: 'need_user_action', items: [], failed_reason: 'verification_required' };

  await page.waitForSelector('[class*="goods-item"],[class*="product-item"],[class*="SearchItem"]', { timeout: 8000 }).catch(() => {});

  const raw = await page.evaluate(() => {
    const out = [];
    const selectors = ['[class*="goods-item"]','[class*="product-item"]','[class*="SearchItem"]','[class*="item-wrapper"]'];
    let cards = [];
    for (const s of selectors) { const f = document.querySelectorAll(s); if (f.length > 1) { cards = Array.from(f); break; } }
    cards.slice(0, 20).forEach(card => {
      try {
        const titleEl = card.querySelector('[class*="title"],[class*="goods-name"],h3,h4');
        const title = titleEl ? titleEl.textContent.trim() : '';
        const priceEl = card.querySelector('[class*="price"],[class*="amount"]');
        const priceStr = priceEl ? priceEl.textContent.trim() : '';
        const shopEl = card.querySelector('[class*="shop"],[class*="store"]');
        const shopName = shopEl ? shopEl.textContent.trim() : '';
        const linkEl = card.querySelector('a[href]');
        let itemUrl = linkEl ? linkEl.href : '';
        const imgEl = card.querySelector('img');
        const imageUrl = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '';
        if (title) out.push({ title, priceStr, shopName, itemUrl, imageUrl, rawText: card.textContent.replace(/\s+/g,' ').trim().slice(0,400) });
      } catch (_) {}
    });
    return out;
  });

  const items = raw.map(r => makeItem({
    provider: 'pdd', title: r.title, price: normalizePrice(r.priceStr),
    shopName: r.shopName, shopType: 'normal',
    itemUrl: r.itemUrl, imageUrl: r.imageUrl,
    confidence: r.title ? 0.75 : 0.4, rawVisibleText: r.rawText,
  })).filter(x => x.price > 0 && x.title);

  return { status: items.length ? 'success' : 'failed', items, failed_reason: items.length ? undefined : 'no_items_extracted' };
}

module.exports = { search };
