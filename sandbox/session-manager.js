'use strict';
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TTL_MS = Number(process.env.SANDBOX_SESSION_TTL_MS) || 600000;
const MAX_CONCURRENT = Number(process.env.SANDBOX_MAX_CONCURRENT) || 2;

const sessions = new Map();

function newId() { return crypto.randomBytes(16).toString('hex'); }

function createSession({ platforms, keyword }) {
  const active = [...sessions.values()].filter(s => !['closed','expired'].includes(s.status));
  if (active.length >= MAX_CONCURRENT) {
    throw Object.assign(new Error('max_concurrent_sessions'), { code: 'MAX_CONCURRENT' });
  }
  const id = newId();
  const userDataDir = path.join(os.tmpdir(), 'jbb-sandbox-' + id);
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  const platformStatus = {};
  for (const p of platforms) platformStatus[p] = { status: 'created' };
  const session = {
    id, keyword: String(keyword || '').slice(0, 200),
    platforms: [...platforms], platformStatus,
    status: 'created', expiresAt,
    expiresAtMs: Date.now() + TTL_MS,
    userDataDir, browsers: {}, results: {},
    createdAt: new Date().toISOString(),
    closedAt: null, closeReason: null,
  };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAtMs && !['closed','expired'].includes(s.status)) s.status = 'expired';
  return s;
}

function requireSession(id) {
  const s = getSession(id);
  if (!s) throw Object.assign(new Error('session_not_found'), { code: 'NOT_FOUND' });
  if (s.status === 'expired') throw Object.assign(new Error('session_expired'), { code: 'EXPIRED' });
  if (s.status === 'closed') throw Object.assign(new Error('session_closed'), { code: 'CLOSED' });
  return s;
}

async function closeSession(session, reason = 'user_request') {
  if (!session) return;
  session.status = 'closed';
  session.closedAt = new Date().toISOString();
  session.closeReason = reason;
  for (const [, ctx] of Object.entries(session.browsers)) {
    try { if (ctx.context) await ctx.context.close(); } catch (_) {}
  }
  session.browsers = {};
  try {
    if (session.userDataDir && fs.existsSync(session.userDataDir)) {
      fs.rmSync(session.userDataDir, { recursive: true, force: true });
    }
  } catch (_) {}
}

async function cleanupExpired() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAtMs && !['closed','expired'].includes(session.status)) {
      await closeSession(session, 'ttl_expired');
      session.status = 'expired';
    }
    if (['closed','expired'].includes(session.status) && session.closedAt) {
      if (now - new Date(session.closedAt).getTime() > 5 * 60 * 1000) sessions.delete(id);
    }
  }
}

function activeSessions() {
  return [...sessions.values()].filter(s => !['closed','expired'].includes(s.status));
}

setInterval(cleanupExpired, 60000).unref();

module.exports = { createSession, getSession, requireSession, closeSession, cleanupExpired, activeSessions, TTL_MS, MAX_CONCURRENT };
