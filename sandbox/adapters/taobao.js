'use strict';
const { normalizePrice, makeItem } = require('../extractor-common');

async function search(page, keyword) {
  const url = 'https://s.taobao.com/search?q=' + encodeURIComponent(keyword);
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); }
  catch { return { status: 'failed', failed_reason: 'navigation_timeout', items: [] }; }

  const cur = page.url();
  if (cur.includes('login.taobao.com') || cur.includes('login.m.taobao.com')) {
    return { status: 'need_user_login', items: [] };
  }
  const hasRisk = await page.$('#nocaptcha,.nc-container,[id*="J_HsecSdk"]').catch(() => null);
  if (hasRisk) return { status: 'need_user_action', items: [], failed_reason: 'security_verification' };

  await page.waitForSelector('[class*="item--"],[class*="BItem"],.search-item,[data-id]', { timeout: 10000 }).catch(() => {});

  const raw = await page.evaluate(() => {
    const out = [];
    const sels = ['[class*="item--"]','[class*="BItem"]','.search-item','[data-id]'];
    let cards = [];
    for (const s of sels) { const f = document.querySelectorAll(s); if (f.length >= 2) { cards = Array.from(f); break; } }
    cards.slice(0, 20).forEach(card => {
      try {
        const titleEl = card.querySelector('[class*="title"],[class*="Title"],h3,h4');
        const title = titleEl ? titleEl.textContent.trim() : '';
        const priceEl = card.querySelector('[class*="price"],[class*="Price"]');
        let priceStr = '';
        if (priceEl) { const sub = priceEl.querySelector('em,strong,span'); priceStr = sub ? sub.textContent.trim() : priceEl.textContent.trim(); }
        const shopEl = card.querySelector('[class*="shop"],[class*="Store"],[class*="mall"]');
        const shopName = shopEl ? shopEl.textContent.trim() : '';
        const linkEl = card.querySelector('a[href*="item.taobao"],a[href*="detail.tmall"],a[href]');
        let itemUrl = linkEl ? linkEl.href : '';
        const imgEl = card.querySelector('img');
        let imageUrl = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '';
        if (imageUrl && !imageUrl.startsWith('http')) imageUrl = 'https:' + imageUrl;
        const isTmall = card.textContent.includes('天猫') || shopName.includes('天猫');
        if (title) out.push({ title, priceStr, shopName, itemUrl, imageUrl, isTmall, rawText: card.textContent.replace(/\s+/g,' ').trim().slice(0,400) });
      } catch (_) {}
    });
    return out;
  });

  const items = raw.map(r => {
    let shopType = 'normal';
    if (/天猫超市/.test(r.shopName)) shopType = 'self_operated';
    else if (r.isTmall && /官方旗舰店|品牌旗舰/.test(r.shopName)) shopType = 'official';
    else if (r.isTmall) shopType = 'flagship';
    return makeItem({
      provider: 'taobao', title: r.title, price: normalizePrice(r.priceStr),
      shopName: r.shopName, shopType, itemUrl: r.itemUrl, imageUrl: r.imageUrl,
      confidence: r.title && r.priceStr ? 0.80 : 0.5, rawVisibleText: r.rawText,
    });
  }).filter(x => x.price > 0 && x.title);

  return { status: items.length ? 'success' : 'failed', items, failed_reason: items.length ? undefined : 'no_items_extracted' };
}

module.exports = { search };
