'use strict';
const { normalizePrice, makeItem } = require('../extractor-common');

async function search(page, keyword) {
  const url = 'https://www.douyin.com/search/' + encodeURIComponent(keyword) + '?type=goods';
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
  catch { return { status: 'failed', failed_reason: 'navigation_timeout', items: [] }; }

  const cur = page.url();
  if (cur.includes('login') || cur.includes('passport')) return { status: 'need_user_login', items: [] };

  const hasVerify = await page.$('[class*="verify"],[class*="captcha"],[class*="qrcode"]').catch(() => null);
  if (hasVerify) return { status: 'need_user_action', items: [], failed_reason: 'douyin_requires_verification' };

  const found = await page.waitForSelector('[class*="product-card"],[class*="goods-item"],[class*="shop-card"]', { timeout: 8000 }).catch(() => null);
  if (!found) return { status: 'need_user_action', items: [], failed_reason: 'douyin_web_shopping_requires_app_or_login' };

  const raw = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[class*="product-card"],[class*="goods-item"],[class*="shop-card"]').forEach(card => {
      try {
        const titleEl = card.querySelector('[class*="title"],[class*="name"]');
        const title = titleEl ? titleEl.textContent.trim() : '';
        const priceEl = card.querySelector('[class*="price"],[class*="amount"]');
        const priceStr = priceEl ? priceEl.textContent.trim() : '';
        const imgEl = card.querySelector('img');
        const imageUrl = imgEl ? (imgEl.src || '') : '';
        const linkEl = card.querySelector('a[href]');
        const itemUrl = linkEl ? linkEl.href : '';
        if (title) out.push({ title, priceStr, imageUrl, itemUrl, rawText: card.textContent.replace(/\s+/g,' ').trim().slice(0,400) });
      } catch (_) {}
    });
    return out.slice(0, 20);
  });

  if (!raw.length) return { status: 'failed', items: [], failed_reason: 'no_items_extracted_douyin_web_limited' };

  const items = raw.map(r => makeItem({
    provider: 'douyin', title: r.title, price: normalizePrice(r.priceStr),
    shopType: 'normal', itemUrl: r.itemUrl, imageUrl: r.imageUrl,
    confidence: 0.6, rawVisibleText: r.rawText,
  })).filter(x => x.title);

  return { status: 'success', items };
}

module.exports = { search };
