'use strict';

const ALLOWED_DOMAINS = [
  'jd.com','search.jd.com','item.jd.com','passport.jd.com','m.jd.com','union.jd.com',
  'pinduoduo.com','mobile.yangkeduo.com','yangkeduo.com',
  'taobao.com','s.taobao.com','login.taobao.com','tmall.com','detail.tmall.com',
  'douyin.com','haohuo.jinritemai.com','jinritemai.com',
];

const SENSITIVE_RE = /\b(cookie|set-cookie|authorization|token|password|secret|passwd|credential|access_token|refresh_token|x-auth|app_secret|client_secret|sk-)\b/i;

function sanitizeForLog(obj, depth = 0) {
  if (depth > 6) return '[deep]';
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(x => sanitizeForLog(x, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_RE.test(k)) out[k] = '[REDACTED]';
    else if (typeof v === 'string' && v.length > 800) out[k] = v.slice(0, 80) + '...[truncated]';
    else out[k] = sanitizeForLog(v, depth + 1);
  }
  return out;
}

function isAllowedDomain(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

function isPrivateUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const h = u.hostname;
    return u.protocol === 'file:' || u.protocol === 'data:' ||
      h === 'localhost' || h.startsWith('127.') || h.startsWith('192.168.') ||
      h.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch { return true; }
}

function validateNavigateUrl(url) {
  if (!url || typeof url !== 'string') return { ok: false, reason: 'invalid_url' };
  if (isPrivateUrl(url)) return { ok: false, reason: 'private_or_local_url_not_allowed' };
  if (!isAllowedDomain(url)) return { ok: false, reason: 'domain_not_in_allowlist' };
  return { ok: true };
}

function validateAction(action) {
  const allowed = ['click','type','press','scroll','navigate'];
  if (!allowed.includes(action.type)) return { ok: false, reason: 'unsupported_action_type' };
  if (action.type === 'navigate') return validateNavigateUrl(action.url);
  if (action.type === 'type' && typeof action.text !== 'string') return { ok: false, reason: 'type_requires_text_string' };
  if (action.type === 'press' && typeof action.key !== 'string') return { ok: false, reason: 'press_requires_key_string' };
  return { ok: true };
}

function safePublicResult(item) {
  const { raw, _original, ...rest } = item;
  return rest;
}

module.exports = { sanitizeForLog, validateNavigateUrl, validateAction, safePublicResult, isAllowedDomain, ALLOWED_DOMAINS };
