// server5.js: use Taobao material optional upgrade API when server4 falls back.
process.env.TB_SEARCH_METHOD = process.env.TB_SEARCH_METHOD || 'taobao.tbk.dg.material.optional.upgrade';
process.env.TB_SEARCH_FALLBACK_METHOD = process.env.TB_SEARCH_FALLBACK_METHOD || 'taobao.tbk.dg.material.optional.upgrade';
process.env.TB_MATERIAL_ID = process.env.TB_MATERIAL_ID || '80309';
require('./server4.js');
