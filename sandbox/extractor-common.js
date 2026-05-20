'use strict';
const { sanitizePii } = require('./sanitizer');

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

// 铁律5: compute unit price from item title so comparisons use ¥/unit, not sticker price.
function computeUnitPrice(titleSpec, price) {
  if (!price || price <= 0) return { unitPrice: null, unitText: '', unitKind: '' };
  const t = String(titleSpec || '').toLowerCase().replace(/\s+/g, '');
  let m;
  m = t.match(/([0-9]+(?:\.[0-9]+)?)(kg|千克|斤|g|克)(?:[*x×]([0-9]+))?/);
  if (m) {
    let w = parseFloat(m[1]);
    if (m[2] === '斤') w *= 0.5;
    else if (m[2] === 'g' || m[2] === '克') w /= 1000;
    if (m[3]) w *= parseInt(m[3]);
    if (w > 0) return { unitPrice: price / w, unitText: w + 'kg｜¥' + (price / w).toFixed(2) + '/kg', unitKind: 'kg' };
  }
  m = t.match(/([0-9]+(?:\.[0-9]+)?)(ml|毫升|l|升)(?:[*x×]([0-9]+))?/);
  if (m) {
    let ml = parseFloat(m[1]);
    if (m[2] === 'l' || m[2] === '升') ml *= 1000;
    const c = m[3] ? parseInt(m[3]) : 1;
    const total = ml * c;
    if (total > 0) return { unitPrice: price / (total / 1000), unitText: ml + 'ml×' + c + '｜¥' + (price / (total / 1000)).toFixed(2) + '/L', unitKind: 'L' };
  }
  m = t.match(/([0-9]{4,6})(mah|毫安)/);
  if (m) {
    const cap = parseFloat(m[1]);
    if (cap > 0) return { unitPrice: price / (cap / 10000), unitText: cap + 'mAh｜¥' + (price / (cap / 10000)).toFixed(2) + '/万mAh', unitKind: '万mAh' };
  }
  m = t.match(/([0-9]+)(件|包|袋|瓶|抽|卷|片|个|支|盒|双|条)(?:[*x×]([0-9]+))?/);
  if (m) {
    let cnt = parseInt(m[1]);
    if (m[3]) cnt *= parseInt(m[3]);
    if (cnt > 1) return { unitPrice: price / cnt, unitText: cnt + m[2] + '｜¥' + (price / cnt).toFixed(2) + '/' + m[2], unitKind: m[2] };
  }
  return { unitPrice: null, unitText: '', unitKind: '' };
}

function makeItem(fields) {
  const price = Number(fields.price) || 0;
  const spec = String(fields.specText || '').trim();
  const titleSpec = (String(fields.title || '').trim() + ' ' + spec).trim();
  const computed = computeUnitPrice(titleSpec, price);
  return {
    source: 'sandbox',
    provider: String(fields.provider || 'unknown'),
    title: String(fields.title || '').trim(),
    price,
    originalPrice: fields.originalPrice || null,
    shopName: String(fields.shopName || '').trim(),
    shopType: fields.shopType || 'unknown',
    brand: String(fields.brand || '').trim(),
    category: String(fields.category || '').trim(),
    specText: spec,
    volumeValue: fields.volumeValue || null,
    volumeUnit: String(fields.volumeUnit || '').trim(),
    count: fields.count || null,
    unitPrice: fields.unitPrice !== undefined ? fields.unitPrice : computed.unitPrice,
    unitText: fields.unitText || computed.unitText,
    unitKind: fields.unitKind || computed.unitKind,
    itemUrl: String(fields.itemUrl || '').trim(),
    imageUrl: String(fields.imageUrl || '').trim(),
    confidence: Number(fields.confidence) || 0,
    sameProductScore: Number(fields.sameProductScore) || 0,
    warnings: Array.isArray(fields.warnings) ? fields.warnings : [],
    rawVisibleText: sanitizePii(String(fields.rawVisibleText || '').slice(0, 500)),
  };
}

module.exports = { normalizePrice, detectShopType, makeItem, computeUnitPrice };

