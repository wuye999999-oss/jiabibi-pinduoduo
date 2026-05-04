const fs = require('fs');

let code = fs.readFileSync(require.resolve('./server2.js'), 'utf8');

const oldRoute = "if(url.pathname==='/api/jd/link'&&req.method==='POST')return sendJson(res,501,{ok:false,error:'jd_link_disabled_in_server2'});";

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
    if(typeof v.url === 'string' && /union|jd|3\.cn/.test(v.url)) return v.url;
    for(const child of Object.values(v)){
      const found = findClickURL(child);
      if(found) return found;
    }
    return '';
  }
  const clickURL = findClickURL(result);
  if(result.error_response || result.error || result.code) return sendJson(res,400,{ok:false,platform:'jd',error:'jd_link_error',raw:result,click_url:clickURL});
  return sendJson(res,200,{ok:true,platform:'jd',click_url:clickURL,url:clickURL,raw:result});
}`;

if (!code.includes(oldRoute)) {
  console.error('JD disabled route marker not found in server2.js; refusing to boot patched runtime.');
  process.exit(1);
}

code = code.replace(oldRoute, jdRoute);

// Run the patched server2 code in this process.
eval(code);
