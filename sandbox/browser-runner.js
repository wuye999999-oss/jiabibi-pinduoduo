'use strict';
const path = require('path');
const fs = require('fs');

const HEADLESS = String(process.env.SANDBOX_HEADLESS || 'true').toLowerCase() !== 'false';

let _pw = null;
function getPlaywright() {
  if (_pw) return _pw;
  try { _pw = require('playwright'); return _pw; }
  catch (e) { throw Object.assign(new Error('playwright_not_installed: run npx playwright install --with-deps chromium'), { code: 'PLAYWRIGHT_NOT_INSTALLED' }); }
}

async function launchBrowserForSession(session, platform) {
  const pw = getPlaywright();
  const userDataDir = path.join(session.userDataDir, platform);
  fs.mkdirSync(userDataDir, { recursive: true });
  const context = await pw.chromium.launchPersistentContext(userDataDir, {
    headless: HEADLESS,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  session.browsers[platform] = { context, page };
  return page;
}

async function getOrCreatePage(session, platform) {
  if (session.browsers[platform]) return session.browsers[platform].page;
  return launchBrowserForSession(session, platform);
}

async function takeScreenshot(session, platform) {
  const ctx = session.browsers[platform];
  if (!ctx || !ctx.page) return null;
  try {
    const buf = await ctx.page.screenshot({ type: 'jpeg', quality: 55, fullPage: false });
    return buf.toString('base64');
  } catch { return null; }
}

async function performAction(session, platform, action) {
  const ctx = session.browsers[platform];
  if (!ctx || !ctx.page) throw new Error('browser_not_open_for_platform: ' + platform);
  const page = ctx.page;
  switch (action.type) {
    case 'click': await page.mouse.click(Number(action.x) || 0, Number(action.y) || 0); break;
    case 'type': await page.keyboard.type(String(action.text || ''), { delay: 40 }); break;
    case 'press': await page.keyboard.press(String(action.key || 'Enter')); break;
    case 'scroll': await page.mouse.wheel(0, Number(action.deltaY || action.y || 300)); break;
    case 'navigate': await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 15000 }); break;
    default: throw new Error('unsupported_action_type: ' + action.type);
  }
  await page.waitForTimeout(400);
}

async function closeAllBrowsers(session) {
  for (const [, ctx] of Object.entries(session.browsers || {})) {
    try { if (ctx.context) await ctx.context.close(); } catch (_) {}
  }
  session.browsers = {};
}

module.exports = { launchBrowserForSession, getOrCreatePage, takeScreenshot, performAction, closeAllBrowsers };
