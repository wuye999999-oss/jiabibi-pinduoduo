// server6.js: clean Taobao keyword search runtime.
// Goal: return one normalized item per Taobao search result, with price/image/title/buy URL.
const fs = require('fs');

process.env.TB_SEARCH_METHOD = process.env.TB_SEARCH_METHOD || 'taobao.tbk.dg.material.optional.upgrade';
process.env.TB_SEARCH_FALLBACK_METHOD = process.env.TB_SEARCH_FALLBACK_METHOD || 'taobao.tbk.dg.material.optional.upgrade';
process.env.TB_MATERIAL_ID = process.env.TB_MATERIAL_ID || '80309';

(function normalizeAdzone(){
  const raw = String(process.env.TB_ADZONE_ID || process.env.TAOBAO_ADZONE_ID || process.env.ADZONE_ID || process.env.TB_PID || process.env.TAOBAO_PID || '').trim();
  const fromPid = raw.match(/(?:mm_)?\d+_\d+_(\d+)$/);
  const direct = raw.match(/^\d+$/);
  if (fromPid) process.env.TB_ADZONE_ID = fromPid[1];
  else if (direct) process.env.TB_ADZONE_ID = raw;
})();

function replaceFunction(src, name, replacement) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return src;
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return src.slice(0, start) + replacement + src.slice(i + 1);
  }
  return src;
}

let code = fs.readFileSync(require.resolve('./server3.js'), 'utf8');

code = code.replace(
  "const TB_API_URL = process.env.TB_API_URL || 'https://eco.taobao.com/router/rest';",
  "const TB_API_URL = process.env.TB_API_URL || 'https://eco.taobao.com/router/rest';\nconst TB_API_FALLBACK_URL = process.env.TB_API_FALLBACK_URL || 'http://gw.api.taobao.com/router/rest';"
);

code = code.replace(
  'return postForm(TB_API_URL,p);',
  `try {\n    const r = await postForm(TB_API_FALLBACK_URL,p);\n    if (r && typeof r === 'object') r.__endpoint = TB_API_FALLBACK_URL;\n    return r;\n  } catch(e) {\n    const r = await postForm(TB_API_URL,p);\n    if (r && typeof r === 'object') r.__endpoint = TB_API_URL;\n    return r;\n  }`
);

code = replaceFunction(code, 'pickTbItems', `function pickTbItems(raw){
  const list = raw && raw.tbk_dg_material_optional_upgrade_response && raw.tbk_dg_material_optional_upgrade_response.result_list && raw.tbk_dg_material_optional_upgrade_response.result_list.map_data;
  if (Array.isArray(list)) return list.slice(0, 20);
  const out = [];
  function walk(v){
    if(!v || typeof v !== 'object') return;
    if(Array.isArray(v)){ v.forEach(walk); return; }
    if(v.item_basic_info || v.price_promotion_info || v.publish_info) out.push(v);
    else if(v.num_iid || v.item_id || v.itemId || v.auction_id || v.title || v.raw_title || v.short_title) out.push(v);
    Object.values(v).forEach(x => { if(x && typeof x === 'object') walk(x); });
  }
  walk(raw);
  const seen = new Set();
  return out.filter(x => {
    const basic = x.item_basic_info || x.basic_info || x;
    const k = String(x.item_id || basic.num_iid || basic.item_id || basic.itemId || basic.auction_id || basic.title || basic.short_title || Math.random());
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0,20);
}`);

code = replaceFunction(code, 'normalizeTbItem', `function normalizeTbItem(i,source='tb.item.info'){
  const basic = i.item_basic_info || i.basic_info || i;
  const promo = i.price_promotion_info || {};
  const publish = i.publish_info || {};
  const promoList = promo.final_promotion_path_list && promo.final_promotion_path_list.final_promotion_path_map_data;
  const coupon = Array.isArray(promoList) && promoList[0] ? promoList[0] : {};
  const price = Number(promo.final_promotion_price || i.final_promotion_price || basic.zk_final_price || basic.reserve_price || basic.price || 0);
  const couponDiscount = Number(coupon.promotion_fee || 0);
  const id = String(i.item_id || basic.num_iid || basic.item_id || basic.itemId || basic.auction_id || '');
  const title = basic.title || basic.short_title || basic.raw_title || i.title || '淘宝商品';
  const img = basic.pict_url || basic.pic_url || basic.white_image || i.pict_url || '';
  const sales = basic.annual_vol || basic.tk_total_sales || basic.volume || i.volume || '';
  const buyUrl = publish.coupon_share_url || publish.click_url || basic.item_url || i.item_url || i.url || '';
  return {
    platform:'tb', source,
    goods_name:title, goods_desc:basic.sub_title || title, brand_name:basic.brand_name || '', shop_name:basic.shop_title || basic.nick || '',
    goods_image_url:httpsUrl(img), goods_thumbnail_url:httpsUrl(img), goods_id:id, num_iid:id,
    sales_tip:sales ? String(sales) : '', min_group_price_yuan:price, coupon_discount_yuan:couponDiscount, coupon_price_yuan:price,
    has_coupon:couponDiscount > 0, unified_tags:['淘宝','关键词搜索'], material_url:httpsUrl(buyUrl), url:httpsUrl(buyUrl), raw:i
  };
}`);

code = code.replace('function parseTbItemId(input){', `async function tbSearchWithFallback(q){
  const attempts=[];
  const tries=[
    {method:TB_SEARCH_METHOD,biz:{adzone_id:TB_ADZONE_ID,q,page_size:'20',page_no:'1',platform:'2'}},
    {method:process.env.TB_SEARCH_FALLBACK_METHOD,biz:{adzone_id:TB_ADZONE_ID,q,page_size:'20',page_no:'1',platform:'2'}}
  ];
  for(const t of tries){
    const raw=await tbRequest(t.method,t.biz);
    const err=raw&&(raw.error_response||raw.error||raw.code);
    attempts.push({method:t.method,ok:!err,endpoint:raw&&raw.__endpoint||'',error_response:raw&&raw.error_response||null,error:raw&&raw.error||'',code:raw&&raw.code||''});
    if(!err){raw.__attempts=attempts;return raw;}
  }
  return {error:'tb_search_permission_or_method_failed',message:'淘宝搜索接口权限不足或当前方法不可用',attempts};
}
function parseTbItemId(input){`);

code = code.split("const raw=await tbRequest(TB_SEARCH_METHOD,{adzone_id:TB_ADZONE_ID,q,page_size:'20',page_no:'1',platform:'2'});").join("const raw=await tbSearchWithFallback(q);");

new Function('require', code)(require);
