/**
 * sandbox-ui.js — 真实授权验价模式前端逻辑
 * 运行时依赖 window.API 和 window.renderAll（由 index.html 内联脚本提供）
 */
(function () {
  'use strict';

  const API = window.API || 'https://jiabibi-api.onrender.com';

  const PLATFORM_NAMES = { jd: '京东', pdd: '拼多多', taobao: '淘宝', douyin: '抖音' };
  const STATUS_LABELS = {
    created: '已创建', opening: '开启中', searching: '搜索中',
    extracting: '读取中', success: '读取成功', failed: '验价失败',
    need_user_login: '需要登录', need_user_action: '需要手动操作',
    expired: '已过期', closed: '已关闭', done: '已完成',
  };

  let sandboxAvailable = null; // null=unknown, true=available, false=disabled(501)
  let quickSearchController = null; // AbortController for in-flight quick-search

  let state = {
    sessionId: null,
    keyword: '',
    platforms: ['jd', 'pdd', 'taobao'],
    platformStatuses: {},
    currentPlatform: 'jd',
    sandboxItems: [],
    pollTimer: null,
    closed: false,
  };

  function el(id) { return document.getElementById(id); }

  function updatePlatformGrid() {
    const grid = el('sb-platform-grid');
    const tabs = el('sb-platform-tabs');
    if (!grid || !tabs) return;
    grid.innerHTML = state.platforms.map(p => {
      const st = (state.platformStatuses[p] || {}).status || 'created';
      const label = STATUS_LABELS[st] || st;
      const count = (state.platformStatuses[p] || {}).itemCount;
      return `<div class="sb-platform"><b>${PLATFORM_NAMES[p] || p}</b><span class="sb-status ${st}">${label}${count !== undefined ? ' · ' + count + '条' : ''}</span></div>`;
    }).join('');
    tabs.innerHTML = state.platforms.map(p => `<button class="${p === state.currentPlatform ? 'active' : ''}" onclick="SandboxUI.switchPlatform('${p}')">${PLATFORM_NAMES[p] || p}</button>`).join('');
  }

  async function loadScreenshot(platform) {
    if (!state.sessionId) return;
    const area = el('sb-screenshot');
    if (!area) return;
    try {
      const r = await fetch(`${API}/api/sandbox/session/${state.sessionId}/screenshot?platform=${platform}`, { cache: 'no-store' });
      if (!r.ok) { area.innerHTML = `<p>没有截图（${PLATFORM_NAMES[platform] || platform}尚未打开）</p>`; return; }
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      area.innerHTML = `<img src="${objUrl}" alt="${PLATFORM_NAMES[platform] || platform}当前页面" style="max-width:100%;border-radius:12px;border:1px solid #e8e8ed" />
        <p style="font-size:12px;color:#86868b;margin-top:6px">${PLATFORM_NAMES[platform] || platform}当前页面截屏。如需登录/扫码请在页面中操作，然后点「开始搜索」。</p>`;
    } catch (e) {
      area.innerHTML = `<p>截图加载失败：${e.message}</p>`;
    }
  }

  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  async function pollStatus() {
    if (!state.sessionId || state.closed) { stopPolling(); return; }
    try {
      const r = await fetch(`${API}/api/sandbox/session/${state.sessionId}/status`, { cache: 'no-store' });
      const d = await r.json();
      if (d.platforms) state.platformStatuses = d.platforms;
      updatePlatformGrid();
      const statusEl = el('sb-session-status');
      if (statusEl) statusEl.textContent = `会话状态：${STATUS_LABELS[d.status] || d.status} · 过期时间：${d.expiresAt ? new Date(d.expiresAt).toLocaleTimeString() : '未知'}`;
      if (['expired', 'closed'].includes(d.status)) stopPolling();
      // Auto-refresh screenshot when the current platform needs user attention
      // (login page / captcha) — the user can see what the browser shows without clicking.
      const curSt = (state.platformStatuses[state.currentPlatform] || {}).status;
      if (['need_user_login', 'need_user_action', 'searching'].includes(curSt)) {
        loadScreenshot(state.currentPlatform);
      }
    } catch (_) {}
  }

  async function createSession() {
    const keyword = (window.lastQ || el('keyword') && el('keyword').value || '').trim();
    if (!keyword) { alert('请先搜索商品关键词'); return false; }
    state.keyword = keyword;
    try {
      const r = await fetch(`${API}/api/sandbox/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: state.platforms, keyword }),
      });
      const d = await r.json();
      if (!d.ok) {
        if (d.error === 'sandbox_disabled') {
          alert('真实验价功能暂未开启。如需使用，请联系管理员设置 SANDBOX_ENABLED=true。');
          return false;
        }
        throw new Error(d.message || d.error || '创建失败');
      }
      state.sessionId = d.sessionId;
      state.platformStatuses = {};
      for (const p of state.platforms) state.platformStatuses[p] = { status: 'created' };
      return true;
    } catch (e) {
      alert('创建验价会话失败：' + e.message);
      return false;
    }
  }

  function showPanel() {
    const panel = el('sandbox-panel');
    if (panel) panel.classList.add('show');
    updatePlatformGrid();
    state.pollTimer = setInterval(pollStatus, 3000);
    loadScreenshot(state.currentPlatform);
  }

  async function runSearch() {
    if (!state.sessionId) { alert('请先开启验价会话'); return; }
    const btn = el('sb-search-btn');
    if (btn) { btn.disabled = true; btn.textContent = '搜索中...'; }
    try {
      const r = await fetch(`${API}/api/sandbox/session/${state.sessionId}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: state.keyword, platforms: state.platforms }),
      });
      const d = await r.json();
      if (d.platforms) state.platformStatuses = d.platforms;
      updatePlatformGrid();
      if (d.results && d.results.length > 0) {
        state.sandboxItems = d.results;
        const badge = el('sb-result-badge');
        if (badge) { badge.textContent = d.total + '条结果'; badge.style.display = 'inline-block'; }
        mergeAndRefreshDisplay();
      } else {
        const blocked = Object.values(d.platforms || {}).some(p => p && ['need_user_action', 'need_user_login'].includes(p.status));
        const statusEl = el('sb-session-status');
        if (statusEl && blocked) {
          statusEl.textContent = '部分平台需要登录或人工通过验证码。请切到对应平台标签，在下方截图里完成登录/验证，然后再次点「开始搜索」。';
        }
      }
      await loadScreenshot(state.currentPlatform);
    } catch (e) {
      alert('搜索失败：' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '开始搜索'; }
    }
  }

  function sandboxToApiFormat(item) {
    const shopTagMap = { self_operated: '京东自营', official: '官方旗舰店', flagship: '旗舰店', channel: '渠道店', normal: '' };
    const platformMap = { taobao: 'tb', jd: 'jd', pdd: 'pdd', douyin: 'douyin' };
    return {
      platform: platformMap[item.provider] || item.provider,
      source: 'sandbox',
      goods_name: item.title,
      goods_desc: item.title,
      brand_name: item.brand || '',
      shop_name: item.shopName + (shopTagMap[item.shopType] ? ' · ' + shopTagMap[item.shopType] : ''),
      goods_image_url: item.imageUrl,
      goods_thumbnail_url: item.imageUrl,
      goods_id: '',
      sales_tip: '',
      min_group_price_yuan: item.price,
      coupon_discount_yuan: 0,
      coupon_price_yuan: item.price,
      has_coupon: false,
      unified_tags: [shopTagMap[item.shopType] || item.shopType || ''],
      material_url: item.itemUrl,
      url: item.itemUrl,
      _sandbox: true,
    };
  }

  function mergeAndRefreshDisplay() {
    if (!window.renderAll || !state.sandboxItems.length) return;
    const sandboxConverted = state.sandboxItems
      .filter(item => (item.confidence || 0) >= 0.65)
      .map(sandboxToApiFormat);
    if (!sandboxConverted.length) return;
    const base = window.lastApiData || { goods_list: [], total_count: 0 };
    const merged = {
      ...base,
      goods_list: [...(base.goods_list || []), ...sandboxConverted],
      total_count: (base.goods_list || []).length + sandboxConverted.length,
    };
    window.renderAll(merged, window.lastQ || state.keyword);
  }

  async function quickSearch(keyword) {
    const q = String(keyword || '').trim();
    if (!q) return null;
    if (sandboxAvailable === false) return null; // skip if already known disabled
    // Abort any in-flight request for a previous keyword to prevent stale results.
    if (quickSearchController) { quickSearchController.abort(); quickSearchController = null; }
    const ctrl = new AbortController();
    quickSearchController = ctrl;
    state.keyword = q;
    // Timeout: cold Render start (~50s) + 3-platform sequential search (~75s) = 125s max.
    // Cap at 90s so we fail fast rather than hanging indefinitely.
    const timeoutId = setTimeout(() => ctrl.abort(), 90000);
    try {
      const r = await fetch(`${API}/api/sandbox/quick-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: q, platforms: ['jd', 'pdd', 'taobao'] }),
        signal: ctrl.signal,
      });
      clearTimeout(timeoutId);
      if (r.status === 501) { sandboxAvailable = false; return null; } // sandbox disabled — cache and skip
      if (r.status === 429) return null; // server busy — silent, don't cache
      sandboxAvailable = true;
      const d = await r.json();
      if (!d.ok || !d.results || !d.results.length) return d;
      state.sandboxItems = d.results;
      const badge = el('sb-result-badge');
      if (badge) { badge.textContent = d.total + '条验价结果'; badge.style.display = 'inline-block'; }
      mergeAndRefreshDisplay();
      return d;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e && e.name === 'AbortError') return null; // silently cancelled by newer search or 90s timeout
      return null;
    } finally {
      if (quickSearchController === ctrl) quickSearchController = null;
    }
  }

  async function close() {
    state.closed = true;
    stopPolling();
    if (state.sessionId) {
      try {
        await fetch(`${API}/api/sandbox/session/${state.sessionId}`, { method: 'DELETE' });
      } catch (_) {}
      state.sessionId = null;
    }
    const panel = el('sandbox-panel');
    if (panel) panel.classList.remove('show');
    state.sandboxItems = [];
    const badge = el('sb-result-badge');
    if (badge) badge.style.display = 'none';
    if (window.renderAll) {
      const base = window.lastApiData || { goods_list: [], total_count: 0 };
      window.renderAll(base, window.lastQ || state.keyword);
    }
  }

  function switchPlatform(p) {
    state.currentPlatform = p;
    updatePlatformGrid();
    loadScreenshot(p);
  }

  function refreshScreenshot() {
    loadScreenshot(state.currentPlatform);
  }

  async function openConsentModal() {
    const keyword = (window.lastQ || (el('keyword') && el('keyword').value) || '').trim();
    if (!keyword) { alert('请先搜索商品，再开启验价'); return; }
    el('consent-modal').classList.add('show');
  }

  async function confirmStart() {
    el('consent-modal').classList.remove('show');
    state.closed = false;
    state.sandboxItems = [];
    const ok = await createSession();
    if (ok) { showPanel(); runSearch(); }
  }

  function cancelConsent() {
    el('consent-modal').classList.remove('show');
  }

  window.SandboxUI = { open: openConsentModal, confirmStart, cancelConsent, close, runSearch, switchPlatform, refreshScreenshot, quickSearch };
})();
