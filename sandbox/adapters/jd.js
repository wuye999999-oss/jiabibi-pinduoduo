'use strict';
const { normalizePrice, detectShopType, makeItem } = require('../extractor-common');

async function search(page, keyword) {
  const url = 'https://search.jd.com/Search?enc=utf-8&keyword=' + encodeURIComponent(keyword);
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
  catch { return { status: 'failed', failed_reason: 'navigation_timeout', items: [] }; }

  const cur = page.url();
  if (cur.includes('passport.jd.com') || cur.includes('/login')) {
    return { status: 'need_user_login', items: [] };
  }
  const hasCaptcha = await page.$('#captcha_container,.JDJRV-bigimg,[class*="captcha"]').catch(() => null);
  if (hasCaptcha) return { status: 'need_user_action', items: [], failed_reason: 'captcha_detected' };

  await page.waitForSelector('#J_goodsList .gl-item,[data-sku]', { timeout: 8000 }).catch(() => {});

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
        card.querySelectorAll('.p-icons i,.p-icon i').forEach(b => badges.push(b.textContent.trim()));
        if (title && priceStr) out.push({ title, priceStr, shopName, itemUrl, imageUrl, badges, rawText: card.textContent.replace(/\s+/g,' ').trim().slice(0,400) });
      } catch (_) {}
    });
    return out.slice(0, 20);
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
