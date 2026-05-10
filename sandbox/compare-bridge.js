'use strict';

function normalizeApiItem(item) {
  const price = Number(item.coupon_price_yuan || item.min_group_price_yuan || item.final_price || item.price || 0);
  const text = [item.goods_name, item.goods_desc, item.brand_name, item.shop_name, ...(item.unified_tags || [])].join(' ');
  const n = text.toLowerCase();
  let shopType = 'normal';
  if (/京东自营|jd自营/.test(n)) shopType = 'self_operated';
  else if (/天猫超市/.test(n)) shopType = 'self_operated';
  else if (/官方旗舰店|品牌旗舰店/.test(n)) shopType = 'official';
  else if (/旗舰店/.test(n)) shopType = 'flagship';
  else if (/专卖店|专营店|授权/.test(n)) shopType = 'channel';
  else if (/天猫/.test(n)) shopType = 'flagship';
  return {
    source: 'api',
    provider: String(item.platform || 'unknown'),
    title: String(item.goods_name || item.goods_desc || ''),
    price,
    shopName: String(item.shop_name || item.brand_name || ''),
    shopType,
    itemUrl: String(item.material_url || item.url || item.item_url || ''),
    imageUrl: String(item.goods_image_url || item.goods_thumbnail_url || ''),
    specText: '',
    _original: item,
  };
}

function bucketOf(shopType) {
  if (['self_operated','official'].includes(shopType)) return 'official';
  if (['flagship','channel'].includes(shopType)) return 'channel';
  return 'normal';
}

function mergeAndBucket(apiItems, sandboxItems) {
  const apiNorm = (apiItems || []).map(normalizeApiItem);
  const all = [...apiNorm, ...(sandboxItems || [])];
  const buckets = { official: [], channel: [], normal: [] };
  for (const item of all) {
    const b = bucketOf(item.shopType || 'normal');
    buckets[b].push(item);
  }
  for (const key of Object.keys(buckets)) buckets[key].sort((a, b) => a.price - b.price);
  return {
    official_best: buckets.official[0] || null,
    channel_best: buckets.channel[0] || null,
    normal_best: buckets.normal[0] || null,
    buckets,
    total: all.length,
    api_count: apiNorm.length,
    sandbox_count: (sandboxItems || []).length,
  };
}

module.exports = { mergeAndBucket, normalizeApiItem, bucketOf };
