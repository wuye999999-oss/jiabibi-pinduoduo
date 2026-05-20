'use strict';
const sessionManager = require('./session-manager');
const browserRunner = require('./browser-runner');
const sanitizer = require('./sanitizer');
const compareBridge = require('./compare-bridge');

const ENABLED = String(process.env.SANDBOX_ENABLED || '').toLowerCase() === 'true';
const ALLOWED_PLATFORMS = (process.env.SANDBOX_ALLOWED_PLATFORMS || 'jd,pdd,taobao,douyin').split(',').map(x => x.trim());

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE',
  });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1_000_000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

const adapterCache = {};
function getAdapter(platform) {
  if (adapterCache[platform]) return adapterCache[platform];
  try { adapterCache[platform] = require('./adapters/' + platform); return adapterCache[platform]; }
  catch { return null; }
}

function normPlatform(p) {
  if (['tb','taobao','tmall'].includes(p)) return 'taobao';
  if (['pdd','pinduoduo'].includes(p)) return 'pdd';
  if (['jd','jingdong'].includes(p)) return 'jd';
  if (['dy','douyin'].includes(p)) return 'douyin';
  return p;
}

async function handleSandbox(req, res, url) {
  if (!ENABLED) return sendJson(res, 501, { ok: false, error: 'sandbox_disabled', message: '请设置环境变量 SANDBOX_ENABLED=true 开启真实授权验价模式' });

  const pathname = url.pathname;
  const method = req.method;

  // POST /api/sandbox/quick-search — stateless one-shot: create + search + close, no session lifecycle needed
  if (pathname === '/api/sandbox/quick-search' && method === 'POST') {
    const raw = await readBody(req);
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const keyword = String(body.keyword || '').trim();
    if (!keyword) return sendJson(res, 400, { ok: false, error: 'missing_keyword' });
    // Exclude douyin — always needs login, wastes ~350 MB
    const platforms = (Array.isArray(body.platforms) ? body.platforms : ALLOWED_PLATFORMS)
      .map(normPlatform).filter(p => ALLOWED_PLATFORMS.includes(p) && p !== 'douyin');
    if (!platforms.length) return sendJson(res, 400, { ok: false, error: 'no_valid_platforms' });

    let session = null;
    const platformStatus = {};
    const results = {};
    try {
      session = sessionManager.createSession({ platforms, keyword });
    } catch (e) {
      if (e.code === 'MAX_CONCURRENT') return sendJson(res, 429, { ok: false, error: 'busy', message: '服务器正忙，请稍后再试' });
      return sendJson(res, 500, { ok: false, error: 'session_create_failed', message: e.message });
    }

    try {
      for (const platform of platforms) {
        platformStatus[platform] = { status: 'opening' };
        try {
          const adapter = getAdapter(platform);
          if (!adapter) { platformStatus[platform] = { status: 'failed', reason: 'no_adapter' }; continue; }
          const page = await browserRunner.getOrCreatePage(session, platform);
          platformStatus[platform] = { status: 'searching' };
          const result = await adapter.search(page, keyword);
          platformStatus[platform] = { status: result.status, itemCount: (result.items || []).length, failed_reason: result.failed_reason };
          if (result.status === 'success' && result.items) results[platform] = result.items;
        } catch (e) {
          platformStatus[platform] = { status: 'failed', reason: e.message };
        } finally {
          // Always release browser immediately — free ~200 MB per platform
          await browserRunner.closePlatformBrowser(session, platform).catch(() => {});
        }
      }
    } finally {
      await sessionManager.closeSession(session, 'quick_search_done').catch(() => {});
    }

    const allItems = Object.values(results).flat();
    const safeItems = allItems.map(sanitizer.safePublicResult);
    // Run compare-bridge so the client can directly see the ranked winners
    // without having to run buildPriceModel client-side on raw items.
    const bucket = compareBridge.mergeAndBucket([], allItems);
    const safe = x => (x ? sanitizer.safePublicResult(x) : null);
    return sendJson(res, 200, {
      ok: true, keyword, total: allItems.length,
      platforms: platformStatus,
      results: safeItems,
      best: {
        official_best: safe(bucket.official_best),
        channel_best: safe(bucket.channel_best),
        normal_best: safe(bucket.normal_best),
      },
    });
  }

  // POST /api/sandbox/session — create session
  if (pathname === '/api/sandbox/session' && method === 'POST') {
    const raw = await readBody(req);
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const platforms = (Array.isArray(body.platforms) ? body.platforms : ALLOWED_PLATFORMS)
      .map(normPlatform).filter(p => ALLOWED_PLATFORMS.includes(p));
    const keyword = String(body.keyword || '').trim();
    if (!keyword) return sendJson(res, 400, { ok: false, error: 'missing_keyword' });
    if (!platforms.length) return sendJson(res, 400, { ok: false, error: 'no_valid_platforms' });
    try {
      const session = sessionManager.createSession({ platforms, keyword });
      const platformsOut = {};
      for (const p of platforms) platformsOut[p] = { status: 'created' };
      return sendJson(res, 200, { ok: true, sessionId: session.id, expiresAt: session.expiresAt, keyword: session.keyword, platforms: platformsOut });
    } catch (e) {
      if (e.code === 'MAX_CONCURRENT') return sendJson(res, 429, { ok: false, error: 'max_concurrent_sessions', message: '当前验价会话已满，请稍后再试' });
      return sendJson(res, 500, { ok: false, error: 'session_create_failed', message: e.message });
    }
  }

  const m = pathname.match(/^\/api\/sandbox\/session\/([a-f0-9]{32})(\/.*)?$/);
  if (!m) return sendJson(res, 404, { ok: false, error: 'not_found', path: pathname });
  const sessionId = m[1];
  const sub = m[2] || '';

  // DELETE /api/sandbox/session/:id — close
  if (method === 'DELETE' && sub === '') {
    const session = sessionManager.getSession(sessionId);
    if (!session) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
    await sessionManager.closeSession(session, 'user_request');
    return sendJson(res, 200, { ok: true, message: 'session_closed', sessionId });
  }

  // GET /api/sandbox/session/:id/status
  if (method === 'GET' && sub === '/status') {
    const session = sessionManager.getSession(sessionId);
    if (!session) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
    return sendJson(res, 200, { ok: true, sessionId, status: session.status, expiresAt: session.expiresAt, keyword: session.keyword, platforms: session.platformStatus, closedAt: session.closedAt, closeReason: session.closeReason });
  }

  // GET /api/sandbox/session/:id/screenshot?platform=jd
  if (method === 'GET' && sub === '/screenshot') {
    let session;
    try { session = sessionManager.requireSession(sessionId); }
    catch (e) { return sendJson(res, e.code === 'NOT_FOUND' ? 404 : 410, { ok: false, error: e.message }); }
    const platform = normPlatform(url.searchParams.get('platform') || '');
    if (!platform || !ALLOWED_PLATFORMS.includes(platform)) return sendJson(res, 400, { ok: false, error: 'invalid_platform' });
    const screenshot = await browserRunner.takeScreenshot(session, platform);
    if (!screenshot) return sendJson(res, 204, { ok: false, error: 'no_screenshot' });
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    return res.end(Buffer.from(screenshot, 'base64'));
  }

  // POST /api/sandbox/session/:id/action
  if (method === 'POST' && sub === '/action') {
    let session;
    try { session = sessionManager.requireSession(sessionId); }
    catch (e) { return sendJson(res, e.code === 'NOT_FOUND' ? 404 : 410, { ok: false, error: e.message }); }
    const raw = await readBody(req);
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const platform = normPlatform(body.platform || '');
    if (!platform || !ALLOWED_PLATFORMS.includes(platform)) return sendJson(res, 400, { ok: false, error: 'invalid_platform' });
    const v = sanitizer.validateAction(body);
    if (!v.ok) return sendJson(res, 400, { ok: false, error: 'invalid_action', reason: v.reason });
    // 铁律2: block typing on login/passport pages — server must never receive credentials
    if (body.type === 'type') {
      const ctx = session.browsers[platform];
      if (ctx && ctx.page) {
        const curUrl = ctx.page.url();
        if (/login|passport|account|signin/i.test(curUrl)) {
          return sendJson(res, 403, { ok: false, error: 'type_blocked_on_login_page', message: '铁律2：服务端沙盒不支持在登录页输入内容，请使用 App 授权验价' });
        }
      }
    }
    try {
      await browserRunner.getOrCreatePage(session, platform);
      await browserRunner.performAction(session, platform, body);
      const screenshot = await browserRunner.takeScreenshot(session, platform);
      return sendJson(res, 200, { ok: true, platform, action: body.type, screenshot });
    } catch (e) { return sendJson(res, 500, { ok: false, error: 'action_failed', message: e.message }); }
  }

  // POST /api/sandbox/session/:id/search
  if (method === 'POST' && sub === '/search') {
    let session;
    try { session = sessionManager.requireSession(sessionId); }
    catch (e) { return sendJson(res, e.code === 'NOT_FOUND' ? 404 : 410, { ok: false, error: e.message }); }
    const raw = await readBody(req);
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const keyword = String(body.keyword || session.keyword || '').trim();
    if (!keyword) return sendJson(res, 400, { ok: false, error: 'missing_keyword' });
    const platforms = (Array.isArray(body.platforms) ? body.platforms : session.platforms).map(normPlatform).filter(p => ALLOWED_PLATFORMS.includes(p));
    session.status = 'searching';

    // Sequential launch — Render free tier has 512 MB; parallel Chromium contexts OOM-crash the server
    for (const platform of platforms) {
      session.platformStatus[platform] = { status: 'opening' };
      try {
        const adapter = getAdapter(platform);
        if (!adapter) { session.platformStatus[platform] = { status: 'failed', reason: 'no_adapter' }; continue; }

        // Douyin shopping requires login/app even for search — skip browser launch entirely on server
        if (platform === 'douyin') {
          session.platformStatus[platform] = { status: 'need_user_action', failed_reason: 'douyin_requires_app_not_supported_server_side' };
          continue;
        }

        const page = await browserRunner.getOrCreatePage(session, platform);
        session.platformStatus[platform] = { status: 'searching' };
        const result = await adapter.search(page, keyword);
        session.platformStatus[platform] = { status: result.status, itemCount: (result.items || []).length, failed_reason: result.failed_reason };
        if (result.status === 'success' && result.items) session.results[platform] = result.items;

        // Free RAM immediately when a platform needs login — server must never hold login state (铁律2)
        if (['need_user_login', 'need_user_action'].includes(result.status)) {
          await browserRunner.closePlatformBrowser(session, platform).catch(() => {});
        }
      } catch (e) {
        session.platformStatus[platform] = { status: 'failed', reason: e.message };
        await browserRunner.closePlatformBrowser(session, platform).catch(() => {});
      }
    }

    session.status = 'done';
    const allItems = Object.values(session.results).flat();
    return sendJson(res, 200, { ok: true, sessionId, keyword, total: allItems.length, platforms: session.platformStatus, results: allItems.map(sanitizer.safePublicResult) });
  }

  // GET /api/sandbox/session/:id/results
  if (method === 'GET' && sub === '/results') {
    const session = sessionManager.getSession(sessionId);
    if (!session) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
    const allItems = Object.values(session.results || {}).flat();
    return sendJson(res, 200, { ok: true, sessionId, keyword: session.keyword, total: allItems.length, platforms: session.platformStatus, results: allItems.map(sanitizer.safePublicResult) });
  }

  return sendJson(res, 404, { ok: false, error: 'unknown_sandbox_subpath', subpath: sub });
}

function sandboxHealthInfo() {
  return {
    sandbox_enabled: ENABLED,
    sandbox_max_concurrent: sessionManager.MAX_CONCURRENT,
    sandbox_ttl_ms: sessionManager.TTL_MS,
    sandbox_active_sessions: sessionManager.activeSessions().length,
    sandbox_allowed_platforms: ALLOWED_PLATFORMS,
  };
}

module.exports = { handleSandbox, sandboxHealthInfo };
