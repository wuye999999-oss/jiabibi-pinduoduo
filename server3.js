const fs = require('fs');

let code = fs.readFileSync(require.resolve('./server2.js'), 'utf8');

const oldRoute = "if(url.pathname==='/api/jd/link'&&req.method==='POST')return sendJson(res,501,{ok:false,error:'jd_link_disabled_in_server2'});";

const enterprisePrelude = `const JD_ACCOUNT_TYPE = 'enterprise';
const JD_ADVANCED_API = String(process.env.JD_ADVANCED_API || '').toLowerCase() === 'true';
const JD_SELF_OPERATED_FULL_COVERAGE = String(process.env.JD_SELF_OPERATED_FULL_COVERAGE || '').toLowerCase() === 'true';
const JD_COVERAGE = JD_ADVANCED_API ? 'enterprise_advanced' : 'enterprise_common';

const TB_API_URL = process.env.TB_API_URL || 'https://eco.taobao.com/router/rest';
const TB_APP_KEY = envFirst('TB_APP_KEY','TAOBAO_APP_KEY','ALIMAMA_APP_KEY');
const TB_APP_SECRET = envFirst('TB_APP_SECRET','TAOBAO_APP_SECRET','ALIMAMA_APP_SECRET');
const TB_ADZONE_ID = envFirst('TB_ADZONE_ID','TAOBAO_ADZONE_ID','ADZONE_ID');
const TB_PID = envFirst('TB_PID','TAOBAO_PID');
const TB_ENABLED = String(process.env.TB_ENABLED || '').toLowerCase() === 'true';
const TB_SEARCH_ENABLED = String(process.env.TB_SEARCH_ENABLED || '').toLowerCase() === 'true';
const TB_ITEM_METHOD = process.env.TB_ITEM_METHOD || 'taobao.tbk.item.info.get';
const TB_SEARCH_METHOD = process.env.TB_SEARCH_METHOD || 'taobao.tbk.dg.material.optional';

function tbTimestamp(){
  const d=new Date(Date.now()+8*3600000); const p=n=>String(n).padStart(2,'0');
  return d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate())+' '+p(d.getUTCHours())+':'+p(d.getUTCMinutes())+':'+p(d.getUTCSeconds());
}
function tbSign(params,secret){
  let s=secret;
  Object.keys(params).sort().forEach(k=>{ if(params[k]!==undefined&&params[k]!==null) s+=k+String(params[k]); });
  return md5Upper(s+secret);
}
async function tbRequest(method,biz={}){
  if(!TB_ENABLED) return {error:'tb_disabled',message:'TB_ENABLED is not true'};
  if(!TB_APP_KEY||!TB_APP_SECRET) return {error:'missing_tb_env',message:'TB_APP_KEY/TB_APP_SECRET missing'};
  const p=cleanParams({method,app_key:TB_APP_KEY,timestamp:tbTimestamp(),format:'json',v:'2.0',sign_method:'md5',...biz});
  p.sign=tbSign(p,TB_APP_SECRET);
  return postForm(TB_API_URL,p);
}
function parseTbItemId(input){
  const text=dec(input||'');
  const url=findUrl(text)||text;
  try{
    const u=new URL(url);
    const id=u.searchParams.get('id')||u.searchParams.get('itemId')||u.searchParams.get('item_id')||u.searchParams.get('num_iid')||'';
    if(id) return String(id);
    const m=dec(url).match(/(?:id|itemId|item_id|num_iid)[=:](\\d{8,16})/i);
    if(m) return m[1];
  }catch(e){
    const m=text.match(/(?:id|itemId|item_id|num_iid)[=:](\\d{8,16})/i);
    if(m) return m[1];
  }
  const direct=text.match(/(?:^|[^0-9])(\\d{8,16})(?:[^0-9]|$)/);
  return direct?direct[1]:'';
}
function pickTbItems(raw){
  const out=[];
  function walk(v){
    if(!v||typeof v!=='object') return;
    if(Array.isArray(v)){ v.forEach(walk); return; }
    const id=v.num_iid||v.item_id||v.itemId||v.auction_id;
    const title=v.title||v.raw_title||v.short_title;
    if(id||title) out.push(v);
    Object.values(v).forEach(x=>{ if(x&&typeof x==='object') walk(x); });
  }
  walk(raw);
  const seen=new Set();
  return out.filter(x=>{const k=String(x.num_iid||x.item_id||x.itemId||x.auction_id||x.title||Math.random()); if(seen.has(k))return false; seen.add(k); return true;}).slice(0,20);
}
function normalizeTbItem(i,source='tb.item.info'){
  const price=Number(i.zk_final_price||i.reserve_price||i.price||0);
  const id=String(i.num_iid||i.item_id||i.itemId||i.auction_id||'');
  return {platform:'tb',source,goods_name:i.title||i.raw_title||i.short_title||'淘宝商品',goods_desc:i.title||i.raw_title||'',brand_name:i.brand_name||'',shop_name:i.shop_title||i.nick||'',goods_image_url:httpsUrl(i.pict_url||i.pic_url||i.white_image||''),goods_thumbnail_url:httpsUrl(i.pict_url||i.pic_url||i.white_image||''),goods_id:id,num_iid:id,sales_tip:i.volume?String(i.volume)+'人付款':'',min_group_price_yuan:price,coupon_discount_yuan:0,coupon_price_yuan:price,has_coupon:false,unified_tags:['淘宝','链接详情'],material_url:i.item_url||i.url||'',raw:i};
}
`;

const jdRoute = `if(url.pathname==='/api/jd/link'&&req.method==='POST'){
  const rawBody = await readBody(req);
  let body = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_) { body = {}; }
  const skuId = body.sku_id || body.skuId || url.searchParams.get('sku_id') || '';
  const materialId = body.material_url || body.materialId || body.url || (skuId ? 'https://item.jd.com/' + skuId + '.html' : '');
  const couponUrl = body.coupon_url || body.couponUrl || '';
  if (!materialId) return sendJson(res,400,{ok:false,error:'missing_material_id',message:'material_url or sku_id is required'});
  const result = await jdRequest(JD_PROMOTION_METHOD,{promotionCodeReq:cleanParams({materialId,couponUrl,siteId:JD_SITE_ID,positionId:JD_POSITION_ID})});
  function findClickURL(v){
    if(!v || typeof v !== 'object') return '';
    if(typeof v.clickURL === 'string' && v.clickURL) return v.clickURL;
    if(typeof v.clickUrl === 'string' && v.clickUrl) return v.clickUrl;
    if(typeof v.url === 'string' && /union|jd|3\\.cn/.test(v.url)) return v.url;
    for(const child of Object.values(v)){
      const found = findClickURL(child);
      if(found) return found;
    }
    return '';
  }
  const clickURL = findClickURL(result);
  if(result.error_response || result.error || result.code) return sendJson(res,400,{ok:false,platform:'jd',error:'jd_link_error',raw:result,click_url:clickURL,coverage:JD_COVERAGE,account_type:JD_ACCOUNT_TYPE,advanced_api:JD_ADVANCED_API,self_operated_full_coverage:JD_SELF_OPERATED_FULL_COVERAGE});
  return sendJson(res,200,{ok:true,platform:'jd',click_url:clickURL,url:clickURL,coverage:JD_COVERAGE,account_type:JD_ACCOUNT_TYPE,advanced_api:JD_ADVANCED_API,self_operated_full_coverage:JD_SELF_OPERATED_FULL_COVERAGE,raw:result});
}`;

const oldHealth = "if(url.pathname==='/'||url.pathname==='/health')return sendJson(res,200,{ok:true,name:'价比比 API server2',pdd_ps:'scrape_v2'});";
const newHealth = "if(url.pathname==='/'||url.pathname==='/health')return sendJson(res,200,{ok:true,name:'价比比 API server3',runtime:'server3',pdd_ps:'scrape_v2',jd_link:'enabled',tb_detail:'enabled',jd_account_type:JD_ACCOUNT_TYPE,jd_coverage:JD_COVERAGE,jd_advanced_api:JD_ADVANCED_API,jd_self_operated_full_coverage:JD_SELF_OPERATED_FULL_COVERAGE,tb_enabled:TB_ENABLED,tb_configured:!!(TB_APP_KEY&&TB_APP_SECRET),tb_search_enabled:TB_SEARCH_ENABLED,provider_status:'/api/providers/status'});";

const notFoundRoute = "return sendJson(res,404,{error:'not_found',path:url.pathname})";
const tbRoutes = `if((url.pathname==='/api/tb/item'||url.pathname==='/api/tb/link')&&(req.method==='GET'||req.method==='POST')){
  const rawBody=req.method==='POST'?await readBody(req):'';
  let body={}; try{body=rawBody?JSON.parse(rawBody):{};}catch(_){body={};}
  const input=body.item_id||body.num_iid||body.id||body.url||body.material_url||url.searchParams.get('item_id')||url.searchParams.get('num_iid')||url.searchParams.get('id')||url.searchParams.get('url')||'';
  const itemId=parseTbItemId(input);
  if(!itemId) return sendJson(res,400,{ok:false,platform:'tb',error:'missing_item_id',message:'请传淘宝/天猫商品链接或 item id'});
  const fields='num_iid,title,pict_url,small_images,reserve_price,zk_final_price,user_type,provcity,item_url,nick,seller_id,volume,cat_name,shop_title';
  const raw=await tbRequest(TB_ITEM_METHOD,{fields,num_iids:itemId,platform:'2'});
  const items=pickTbItems(raw).map(x=>normalizeTbItem(x));
  const first=items[0]||null;
  if(raw.error_response||raw.error||raw.code||raw.errorCode||raw.error_response) return sendJson(res,400,{ok:false,platform:'tb',error:'tb_item_error',item_id:itemId,raw,goods:first});
  return sendJson(res,200,{ok:true,platform:'tb',mode:'item_detail',item_id:itemId,goods:first,goods_list:items,raw});
}
if(url.pathname==='/api/tb/search'&&(req.method==='GET'||req.method==='POST')){
  const rawBody=req.method==='POST'?await readBody(req):'';
  let body={}; try{body=rawBody?JSON.parse(rawBody):{};}catch(_){body={};}
  const q=(body.q||body.keyword||url.searchParams.get('q')||url.searchParams.get('keyword')||'').trim();
  if(!TB_SEARCH_ENABLED) return sendJson(res,501,{ok:false,platform:'tb',error:'tb_search_disabled',message:'淘宝关键词搜索待 27939/16516 权限，当前先支持链接/商品ID详情',q});
  if(!q) return sendJson(res,400,{ok:false,platform:'tb',error:'missing_keyword'});
  const raw=await tbRequest(TB_SEARCH_METHOD,{adzone_id:TB_ADZONE_ID,q,page_size:'20',page_no:'1',platform:'2'});
  const items=pickTbItems(raw).map(x=>normalizeTbItem(x,'tb.material.search'));
  return sendJson(res,200,{ok:!(raw.error_response||raw.error||raw.code),platform:'tb',mode:'keyword_search',q,goods_list:items,raw});
}
`;
const providerStatusRoute = `if(url.pathname==='/api/providers/status'&&req.method==='GET')return sendJson(res,200,{ok:true,runtime:'server3',providers:[
  {platform:'pdd',name:'拼多多',configured:!!(PDD_CLIENT_ID&&PDD_CLIENT_SECRET&&PDD_PID),search:true,link:true,ps_scrape:true,coverage:'api_plus_scrape_fallback',source:'pdd.ddk + scrape fallback'},
  {platform:'jd',name:'京东',configured:!!(JD_APP_KEY&&JD_APP_SECRET),search:true,link:true,coverage:JD_COVERAGE,account_type:JD_ACCOUNT_TYPE,advanced_api:JD_ADVANCED_API,requires_enterprise_for_advanced:false,self_operated_full_coverage:JD_SELF_OPERATED_FULL_COVERAGE,source:'jd.union enterprise mode',notice:JD_ADVANCED_API?'企业模式：高级接口开关已开启':'企业模式：仍使用通用接口，等待高级接口权限'},
  {platform:'tb',name:'淘宝',configured:!!(TB_APP_KEY&&TB_APP_SECRET),enabled:TB_ENABLED,search:TB_SEARCH_ENABLED,link:true,item_detail:true,coverage:TB_SEARCH_ENABLED?'item_detail_plus_search':'item_detail_only',source:'taobao TOP / alimama',notice:TB_SEARCH_ENABLED?'淘宝：详情和搜索已开启':'淘宝：详情/链接先接入，关键词搜索待权限'},
  {platform:'douyin',name:'抖音',configured:false,search:false,link:false,source:'provider_placeholder',next:'等待抖音商城开放平台 API 接入'}
]});`;

if (!code.includes(oldRoute)) {
  console.error('JD disabled route marker not found in server2.js; refusing to boot patched runtime.');
  process.exit(1);
}

code = enterprisePrelude + code;
code = code.replace(oldRoute, jdRoute);
if (code.includes(oldHealth)) code = code.replace(oldHealth, newHealth);
if (code.includes(notFoundRoute)) code = code.replace(notFoundRoute, tbRoutes + providerStatusRoute + notFoundRoute);

// Run the patched server2 code in this process.
eval(code);
