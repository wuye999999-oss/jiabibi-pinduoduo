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

new Function('require', code)(require);
