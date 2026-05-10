'use strict';

function normalizePrice(str) {
  if (typeof str === 'number') return str;
  const m = String(str || '').replace(/,/g, '').match(/\d+\.?\d*/);
  return m ? parseFloat(m[0]) : 0;
}

function detectShopType(shopName, badges) {
  const text = [shopName, ...(badges || [])].join(' ');
  const n = text.toLowerCase();
  if (/京东自营|jd自营/.test(n)) return 'self_operated';
  if (/天猫超市/.test(n)) return 'self_operated';
  if (/官方旗舰店|品牌旗舰店/.test(n)) return 'official';
  if (/旗舰店/.test(n)) return 'flagship';
  if (/专卖店|专营店|授权/.test(n)) return 'channel';
  if (/天猫/.test(n)) return 'flagship';
  return 'normal';
}

function makeItem(fields) {
  return {
    source: 'sandbox',
    provider: String(fields.provider || 'unknown'),
    title: String(fields.title || '').trim(),
    price: Number(fields.price) || 0,
    originalPrice: fields.originalPrice || null,
    shopName: String(fields.shopName || '').trim(),
    shopType: fields.shopType || 'unknown',
    brand: String(fields.brand || '').trim(),
    category: String(fields.category || '').trim(),
    specText: String(fields.specText || '').trim(),
    volumeValue: fields.volumeValue || null,
    volumeUnit: String(fields.volumeUnit || '').trim(),
    count: fields.count || null,
    unitPrice: fields.unitPrice || null,
    itemUrl: String(fields.itemUrl || '').trim(),
    imageUrl: String(fields.imageUrl || '').trim(),
    confidence: Number(fields.confidence) || 0,
    sameProductScore: Number(fields.sameProductScore) || 0,
    warnings: Array.isArray(fields.warnings) ? fields.warnings : [],
    rawVisibleText: String(fields.rawVisibleText || '').slice(0, 500),
  };
}

module.exports = { normalizePrice, detectShopType, makeItem };
