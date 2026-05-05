const fs = require('fs');

let code = fs.readFileSync(require.resolve('./server2.js'), 'utf8');

const oldRoute = "if(url.pathname==='/api/jd/link'&&req.method==='POST')return sendJson(res,501,{ok:false,error:'jd_link_disabled_in_server2'});";

const enterprisePrelude = `const JD_ACCOUNT_TYPE = process.env.JD_ACCOUNT_TYPE || 'personal';
const JD_ADVANCED_API = String(process.env.JD_ADVANCED_API || '').toLowerCase() === 'true';
const JD_SELF_OPERATED_FULL_COVERAGE = String(process.env.JD_SELF_OPERATED_FULL_COVERAGE || '').toLowerCase() === 'true';
const JD_COVERAGE = JD_ACCOUNT_TYPE === 'enterprise' ? (JD_ADVANCED_API ? 'enterprise_advanced' : 'enterprise_common') : 'common_limited';
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
const newHealth = "if(url.pathname==='/'||url.pathname==='/health')return sendJson(res,200,{ok:true,name:'价比比 API server3',runtime:'server3',pdd_ps:'scrape_v2',jd_link:'enabled',jd_account_type:JD_ACCOUNT_TYPE,jd_coverage:JD_COVERAGE,jd_advanced_api:JD_ADVANCED_API,jd_self_operated_full_coverage:JD_SELF_OPERATED_FULL_COVERAGE,provider_status:'/api/providers/status'});";

const notFoundRoute = "return sendJson(res,404,{error:'not_found',path:url.pathname})";
const providerStatusRoute = `if(url.pathname==='/api/providers/status'&&req.method==='GET')return sendJson(res,200,{ok:true,runtime:'server3',providers:[
  {platform:'pdd',name:'拼多多',configured:!!(PDD_CLIENT_ID&&PDD_CLIENT_SECRET&&PDD_PID),search:true,link:true,ps_scrape:true,coverage:'api_plus_scrape_fallback',source:'pdd.ddk + scrape fallback'},
  {platform:'jd',name:'京东',configured:!!(JD_APP_KEY&&JD_APP_SECRET),search:true,link:true,coverage:JD_COVERAGE,account_type:JD_ACCOUNT_TYPE,advanced_api:JD_ADVANCED_API,requires_enterprise_for_advanced:JD_ACCOUNT_TYPE!=='enterprise',self_operated_full_coverage:JD_SELF_OPERATED_FULL_COVERAGE,source:JD_ACCOUNT_TYPE==='enterprise'?'jd.union enterprise mode':'jd.union common interface',notice:JD_ACCOUNT_TYPE==='enterprise'?(JD_ADVANCED_API?'企业模式：高级接口开关已开启':'企业模式：仍使用通用接口，等待高级接口权限'):'个人推客仅通用接口；高级接口/完整自营覆盖需企业商号申请'},
  {platform:'tb',name:'淘宝',configured:false,search:false,link:false,source:'provider_placeholder',next:'等待淘宝客/开放平台 API 接入'},
  {platform:'douyin',name:'抖音',configured:false,search:false,link:false,source:'provider_placeholder',next:'等待抖音商城开放平台 API 接入'}
]});`;

if (!code.includes(oldRoute)) {
  console.error('JD disabled route marker not found in server2.js; refusing to boot patched runtime.');
  process.exit(1);
}

code = enterprisePrelude + code;
code = code.replace(oldRoute, jdRoute);
if (code.includes(oldHealth)) code = code.replace(oldHealth, newHealth);
if (code.includes(notFoundRoute)) code = code.replace(notFoundRoute, providerStatusRoute + notFoundRoute);

// Run the patched server2 code in this process.
eval(code);
