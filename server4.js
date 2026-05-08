// server4.js: wraps server3 and hardens Taobao TOP request timeout/fallback
const nodeFs = require('fs');

let code = nodeFs.readFileSync(require.resolve('./server3.js'), 'utf8');

code = code.replace(
  "const TB_API_URL = process.env.TB_API_URL || 'https://eco.taobao.com/router/rest';",
  "const TB_API_URL = process.env.TB_API_URL || 'https://eco.taobao.com/router/rest';\nconst TB_API_FALLBACK_URL = process.env.TB_API_FALLBACK_URL || 'http://gw.api.taobao.com/router/rest';\nconst TB_TIMEOUT_MS = Number(process.env.TB_TIMEOUT_MS || 6500);"
);

code = code.replace(/async function tbRequest\(method,biz=\{\}\)\{[\s\S]*?return postForm\(TB_API_URL,p\);\n\}/, `function tbPostForm(endpoint,params,timeoutMs=6500){
  return new Promise((resolve,reject)=>{
    const body=new URLSearchParams(params).toString();
    let u; try{u=new URL(endpoint)}catch(e){return reject(e)}
    const cli=u.protocol==='http:'?http:https;
    const req=cli.request({
      method:'POST',hostname:u.hostname,path:u.pathname+u.search,port:u.port||(u.protocol==='http:'?80:443),timeout:timeoutMs,
      headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body),'User-Agent':'Jiabibi/1.0'}
    },res=>{
      let d=''; res.setEncoding('utf8');
      res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(new Error('tb_non_json '+d.slice(0,200)))}});
    });
    req.on('timeout',()=>req.destroy(Object.assign(new Error('tb_request_timeout'),{code:'ETIMEDOUT'})));
    req.on('error',reject);
    req.write(body); req.end();
  });
}
async function tbRequest(method,biz={}){
  if(!TB_ENABLED) return {error:'tb_disabled',message:'TB_ENABLED is not true'};
  if(!TB_APP_KEY||!TB_APP_SECRET) return {error:'missing_tb_env',message:'TB_APP_KEY/TB_APP_SECRET missing'};
  const p=cleanParams({method,app_key:TB_APP_KEY,timestamp:tbTimestamp(),format:'json',v:'2.0',sign_method:'md5',...biz});
  p.sign=tbSign(p,TB_APP_SECRET);
  const endpoints=[TB_API_FALLBACK_URL,TB_API_URL].filter((x,i,a)=>x&&a.indexOf(x)===i);
  const errors=[];
  for(const endpoint of endpoints){
    try{
      const result=await tbPostForm(endpoint,p,TB_TIMEOUT_MS);
      if(result && typeof result==='object') result.__endpoint=endpoint;
      return result;
    }catch(e){
      errors.push({endpoint,code:e.code||'',message:e.message||String(e)});
    }
  }
  return {error:'tb_request_failed',message:'淘宝接口请求超时或网络不可达',detail:errors};
}`);

code = code.replace(/function normalizeTbItem\(i,source='tb\.item\.info'\)\{[\s\S]*?\n\}/, `function normalizeTbItem(i,source='tb.item.info'){
  const basic=i.item_basic_info||i.basic_info||i;
  const promo=i.price_promotion_info||{};
  const price=Number(promo.final_promotion_price||i.final_promotion_price||basic.zk_final_price||basic.reserve_price||basic.price||0);
  const id=String(i.item_id||basic.num_iid||basic.item_id||basic.itemId||basic.auction_id||'');
  const title=basic.title||basic.short_title||basic.raw_title||i.title||'淘宝商品';
  const img=basic.pict_url||basic.pic_url||basic.white_image||i.pict_url||'';
  const sales=basic.annual_vol||basic.tk_total_sales||basic.volume||i.volume||'';
  const promoList=promo.final_promotion_path_list&&promo.final_promotion_path_list.final_promotion_path_map_data;
  const coupon=Array.isArray(promoList)&&promoList[0]?promoList[0]:{};
  const couponDiscount=Number(coupon.promotion_fee||0);
  return {
    platform:'tb',source,
    goods_name:title,goods_desc:basic.sub_title||title,brand_name:basic.brand_name||'',shop_name:basic.shop_title||basic.nick||'',
    goods_image_url:httpsUrl(img),goods_thumbnail_url:httpsUrl(img),goods_id:id,num_iid:id,
    sales_tip:sales?String(sales):'',min_group_price_yuan:price,coupon_discount_yuan:couponDiscount,coupon_price_yuan:price,
    has_coupon:couponDiscount>0,unified_tags:['淘宝','关键词搜索'],material_url:basic.item_url||i.item_url||i.url||'',raw:i
  };
}`);

code = code.replace("function parseTbItemId(input){", `async function tbSearchWithFallback(q){
  const attempts=[];
  const primary={method:TB_SEARCH_METHOD,biz:{adzone_id:TB_ADZONE_ID,q,page_size:'20',page_no:'1',platform:'2'}};
  const fallback={method:process.env.TB_SEARCH_FALLBACK_METHOD || 'taobao.tbk.item.get',biz:{fields:'num_iid,title,pict_url,small_images,reserve_price,zk_final_price,user_type,provcity,item_url,nick,seller_id,volume,cat_name,shop_title',q,page_size:'20',page_no:'1',platform:'2'}};
  for(const t of [primary,fallback]){
    const raw=await tbRequest(t.method,t.biz);
    const err=raw&&(raw.error_response||raw.error||raw.code);
    attempts.push({method:t.method,ok:!err,endpoint:raw&&raw.__endpoint||'',error_response:raw&&raw.error_response||null,error:raw&&raw.error||'',code:raw&&raw.code||''});
    if(!err){raw.__attempts=attempts;return raw;}
  }
  return {error:'tb_search_permission_or_method_failed',message:'淘宝搜索接口权限不足或当前方法不可用',attempts};
}
function parseTbItemId(input){`);

code = code.split("const raw=await tbRequest(TB_SEARCH_METHOD,{adzone_id:TB_ADZONE_ID,q,page_size:'20',page_no:'1',platform:'2'});").join("const raw=await tbSearchWithFallback(q);");

// Stage 3: make Taobao a first-class provider in unified /api/search, not only a front-end hydration patch.
code = code.replace(
  "async function searchTaobao(k){return providerPlaceholder('tb',k)}",
  `async function searchTaobao(k){
    const q=String(k||'').trim();
    if(!q) return providerPlaceholder('tb',q,'淘宝关键词为空');
    if(!TB_ENABLED) return providerPlaceholder('tb',q,'淘宝未启用：TB_ENABLED is not true');
    if(!TB_ADZONE_ID) return providerPlaceholder('tb',q,'淘宝 adzone_id 缺失');
    const raw=await tbSearchWithFallback(q);
    const items=pickTbItems(raw).map(x=>normalizeTbItem(x,'tb.material.search'));
    const failed=raw&&(raw.error_response||raw.error||raw.code);
    if(failed){
      return {ok:false,platform:'tb',source:'tb.material.search',keyword:q,total_count:0,goods_list:[],error:raw.error||raw.code||'tb_search_failed',message:raw.message||'淘宝搜索接口返回异常',raw};
    }
    return {ok:true,platform:'tb',source:'tb.material.search',keyword:q,total_count:items.length,goods_list:items,raw};
  }`
);

new Function('require', code)(require);
