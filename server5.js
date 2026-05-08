// server5.js: use Taobao material optional upgrade API and normalize adzone id.
process.env.TB_SEARCH_METHOD = process.env.TB_SEARCH_METHOD || 'taobao.tbk.dg.material.optional.upgrade';
process.env.TB_SEARCH_FALLBACK_METHOD = process.env.TB_SEARCH_FALLBACK_METHOD || 'taobao.tbk.dg.material.optional.upgrade';
process.env.TB_MATERIAL_ID = process.env.TB_MATERIAL_ID || '80309';

// PID format is usually mm_account_site_adzone.
// Taobao TOP adzone_id must be the numeric last segment, not the full PID.
(function normalizeAdzone(){
  const raw = String(process.env.TB_ADZONE_ID || process.env.TAOBAO_ADZONE_ID || process.env.ADZONE_ID || process.env.TB_PID || process.env.TAOBAO_PID || '').trim();
  const fromPid = raw.match(/(?:mm_)?\d+_\d+_(\d+)$/);
  const direct = raw.match(/^\d+$/);
  if (fromPid) process.env.TB_ADZONE_ID = fromPid[1];
  else if (direct) process.env.TB_ADZONE_ID = raw;
})();

require('./server4.js');
