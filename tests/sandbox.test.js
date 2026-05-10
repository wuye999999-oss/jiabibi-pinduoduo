'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

// ---------- session-manager ----------
describe('session-manager', () => {
  // Override env for tests
  process.env.SANDBOX_SESSION_TTL_MS = '500';
  process.env.SANDBOX_MAX_CONCURRENT = '3';
  const sm = require('../sandbox/session-manager');

  test('createSession returns session with id, expiresAt, platformStatus', () => {
    const s = sm.createSession({ platforms: ['jd', 'pdd'], keyword: '百岁山' });
    assert.ok(s.id, 'id present');
    assert.ok(s.expiresAt, 'expiresAt present');
    assert.strictEqual(s.keyword, '百岁山');
    assert.deepStrictEqual(Object.keys(s.platformStatus).sort(), ['jd','pdd']);
    assert.strictEqual(s.platformStatus.jd.status, 'created');
  });

  test('getSession returns session by id', () => {
    const s = sm.createSession({ platforms: ['jd'], keyword: 'test' });
    const found = sm.getSession(s.id);
    assert.ok(found);
    assert.strictEqual(found.id, s.id);
  });

  test('getSession returns null for unknown id', () => {
    const found = sm.getSession('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.strictEqual(found, null);
  });

  test('session marked expired after TTL', async () => {
    const s = sm.createSession({ platforms: ['jd'], keyword: 'test-ttl' });
    await new Promise(r => setTimeout(r, 600));
    const found = sm.getSession(s.id);
    assert.strictEqual(found.status, 'expired');
  });

  test('requireSession throws EXPIRED after TTL', async () => {
    const s = sm.createSession({ platforms: ['pdd'], keyword: 'test-req' });
    await new Promise(r => setTimeout(r, 600));
    assert.throws(() => sm.requireSession(s.id), e => e.code === 'EXPIRED');
  });

  test('closeSession marks session closed and sets closedAt', async () => {
    const s = sm.createSession({ platforms: ['jd'], keyword: 'test-close' });
    await sm.closeSession(s, 'test');
    assert.strictEqual(s.status, 'closed');
    assert.ok(s.closedAt);
    assert.strictEqual(s.closeReason, 'test');
  });

  test('requireSession throws CLOSED for closed session', async () => {
    const s = sm.createSession({ platforms: ['jd'], keyword: 'test-closed' });
    await sm.closeSession(s);
    assert.throws(() => sm.requireSession(s.id), e => e.code === 'CLOSED');
  });
});

// ---------- sanitizer ----------
describe('sanitizer', () => {
  const san = require('../sandbox/sanitizer');

  test('sanitizeForLog redacts cookie key', () => {
    const result = san.sanitizeForLog({ cookie: 'session=abc123', title: 'test' });
    assert.strictEqual(result.cookie, '[REDACTED]');
    assert.strictEqual(result.title, 'test');
  });

  test('sanitizeForLog redacts authorization key', () => {
    const result = san.sanitizeForLog({ authorization: 'Bearer token123', data: 42 });
    assert.strictEqual(result.authorization, '[REDACTED]');
    assert.strictEqual(result.data, 42);
  });

  test('sanitizeForLog does not redact normal fields', () => {
    const result = san.sanitizeForLog({ title: 'hello', price: 9.9, shopName: 'test store' });
    assert.strictEqual(result.title, 'hello');
    assert.strictEqual(result.price, 9.9);
  });

  test('sanitizeForLog redacts nested secret key', () => {
    const result = san.sanitizeForLog({ nested: { app_secret: 'HIDDEN' } });
    assert.strictEqual(result.nested.app_secret, '[REDACTED]');
  });

  test('validateNavigateUrl allows jd.com', () => {
    const r = san.validateNavigateUrl('https://search.jd.com/Search?keyword=test');
    assert.strictEqual(r.ok, true);
  });

  test('validateNavigateUrl allows taobao.com', () => {
    const r = san.validateNavigateUrl('https://s.taobao.com/search?q=test');
    assert.strictEqual(r.ok, true);
  });

  test('validateNavigateUrl blocks localhost', () => {
    const r = san.validateNavigateUrl('http://localhost:3000/secret');
    assert.strictEqual(r.ok, false);
  });

  test('validateNavigateUrl blocks private IP', () => {
    const r = san.validateNavigateUrl('http://192.168.1.1/admin');
    assert.strictEqual(r.ok, false);
  });

  test('validateNavigateUrl blocks unknown domain', () => {
    const r = san.validateNavigateUrl('https://evil.com/phish');
    assert.strictEqual(r.ok, false);
  });

  test('validateNavigateUrl blocks file:// protocol', () => {
    const r = san.validateNavigateUrl('file:///etc/passwd');
    assert.strictEqual(r.ok, false);
  });

  test('validateAction allows click', () => {
    assert.strictEqual(san.validateAction({ type: 'click', x: 100, y: 200 }).ok, true);
  });

  test('validateAction allows type with text', () => {
    assert.strictEqual(san.validateAction({ type: 'type', text: 'hello' }).ok, true);
  });

  test('validateAction allows navigate to allowed domain', () => {
    assert.strictEqual(san.validateAction({ type: 'navigate', url: 'https://search.jd.com/Search?keyword=x' }).ok, true);
  });

  test('validateAction blocks navigate to blocked domain', () => {
    const r = san.validateAction({ type: 'navigate', url: 'https://badsite.com/x' });
    assert.strictEqual(r.ok, false);
  });

  test('validateAction rejects unknown action type', () => {
    assert.strictEqual(san.validateAction({ type: 'eval', code: 'process.exit()' }).ok, false);
  });

  test('safePublicResult strips raw field', () => {
    const item = { source: 'sandbox', title: 'test', price: 9.9, raw: { hidden: true }, _original: { also: 'hidden' } };
    const safe = san.safePublicResult(item);
    assert.ok(!Object.hasOwn(safe, 'raw'));
    assert.ok(!Object.hasOwn(safe, '_original'));
    assert.strictEqual(safe.title, 'test');
  });
});

// ---------- extractor-common ----------
describe('extractor-common', () => {
  const ec = require('../sandbox/extractor-common');

  test('normalizePrice parses plain number string', () => {
    assert.strictEqual(ec.normalizePrice('9.9'), 9.9);
  });

  test('normalizePrice parses ¥-prefixed string', () => {
    assert.strictEqual(ec.normalizePrice('¥19.80'), 19.80);
  });

  test('normalizePrice handles comma in price', () => {
    assert.strictEqual(ec.normalizePrice('1,299.00'), 1299.00);
  });

  test('normalizePrice returns 0 for empty', () => {
    assert.strictEqual(ec.normalizePrice(''), 0);
  });

  test('detectShopType identifies self_operated for JD', () => {
    assert.strictEqual(ec.detectShopType('京东自营'), 'self_operated');
  });

  test('detectShopType identifies official for 官方旗舰店', () => {
    assert.strictEqual(ec.detectShopType('百岁山官方旗舰店'), 'official');
  });

  test('detectShopType identifies flagship for 旗舰店', () => {
    assert.strictEqual(ec.detectShopType('某品牌旗舰店'), 'flagship');
  });

  test('detectShopType identifies channel for 专卖店', () => {
    assert.strictEqual(ec.detectShopType('某品牌专卖店'), 'channel');
  });

  test('detectShopType returns normal for unknown', () => {
    assert.strictEqual(ec.detectShopType('普通小店'), 'normal');
  });

  test('makeItem builds correct structure', () => {
    const item = ec.makeItem({ provider: 'jd', title: '百岁山 570ml', price: 29.9, shopName: '京东自营', shopType: 'self_operated' });
    assert.strictEqual(item.source, 'sandbox');
    assert.strictEqual(item.provider, 'jd');
    assert.strictEqual(item.title, '百岁山 570ml');
    assert.strictEqual(item.price, 29.9);
    assert.strictEqual(item.shopType, 'self_operated');
    assert.ok(Array.isArray(item.warnings));
    assert.ok(typeof item.confidence === 'number');
  });

  test('makeItem trims title whitespace', () => {
    const item = ec.makeItem({ provider: 'pdd', title: '  test  ', price: 1 });
    assert.strictEqual(item.title, 'test');
  });
});

// ---------- compare-bridge ----------
describe('compare-bridge', () => {
  const cb = require('../sandbox/compare-bridge');

  const apiItems = [
    { platform: 'jd', goods_name: '百岁山 570ml 24瓶', shop_name: '京东自营', coupon_price_yuan: 68, unified_tags: ['京东自营'] },
    { platform: 'pdd', goods_name: '百岁山 570ml 24瓶', shop_name: '某批发店', coupon_price_yuan: 55, unified_tags: ['拼多多'] },
    { platform: 'tb', goods_name: '百岁山 570ml 24瓶', shop_name: '百岁山官方旗舰店', coupon_price_yuan: 72, unified_tags: ['淘宝'] },
  ];

  const sandboxItems = [
    { source: 'sandbox', provider: 'jd', title: '百岁山 570ml 24瓶', price: 62, shopName: '京东自营', shopType: 'self_operated' },
    { source: 'sandbox', provider: 'taobao', title: '百岁山 570ml 24瓶', price: 70, shopName: '天猫超市', shopType: 'self_operated' },
  ];

  test('normalizeApiItem converts api item to normalized form', () => {
    const norm = cb.normalizeApiItem(apiItems[0]);
    assert.strictEqual(norm.source, 'api');
    assert.strictEqual(norm.provider, 'jd');
    assert.strictEqual(norm.price, 68);
    assert.strictEqual(norm.shopType, 'self_operated');
  });

  test('normalizeApiItem detects 官方旗舰店', () => {
    const norm = cb.normalizeApiItem(apiItems[2]);
    assert.strictEqual(norm.shopType, 'official');
  });

  test('bucketOf puts self_operated in official', () => {
    assert.strictEqual(cb.bucketOf('self_operated'), 'official');
  });

  test('bucketOf puts flagship in channel', () => {
    assert.strictEqual(cb.bucketOf('flagship'), 'channel');
  });

  test('bucketOf puts normal in normal', () => {
    assert.strictEqual(cb.bucketOf('normal'), 'normal');
  });

  test('mergeAndBucket produces three buckets', () => {
    const result = cb.mergeAndBucket(apiItems, sandboxItems);
    assert.ok(result.official_best, 'official_best present');
    assert.ok(result.normal_best, 'normal_best present');
    assert.ok(result.buckets);
    assert.strictEqual(result.total, apiItems.length + sandboxItems.length);
  });

  test('mergeAndBucket official_best is cheapest official item', () => {
    const result = cb.mergeAndBucket(apiItems, sandboxItems);
    // sandbox jd self_operated = 62 < api jd self_operated = 68 < tb self_operated = 70
    assert.strictEqual(result.official_best.price, 62);
    assert.strictEqual(result.official_best.source, 'sandbox');
  });

  test('mergeAndBucket counts api and sandbox items', () => {
    const result = cb.mergeAndBucket(apiItems, sandboxItems);
    assert.strictEqual(result.api_count, 3);
    assert.strictEqual(result.sandbox_count, 2);
  });

  test('mergeAndBucket handles empty sandbox items', () => {
    const result = cb.mergeAndBucket(apiItems, []);
    assert.strictEqual(result.sandbox_count, 0);
    assert.ok(result.official_best);
  });

  test('mergeAndBucket handles empty api items', () => {
    const result = cb.mergeAndBucket([], sandboxItems);
    assert.strictEqual(result.api_count, 0);
    assert.ok(result.official_best);
  });
});

// ---------- adapter fixture tests (mock page) ----------
describe('jd adapter with mock page', () => {
  const jd = require('../sandbox/adapters/jd');

  function makeMockPage({ url = 'https://search.jd.com/Search?keyword=test', hasCaptcha = false, items = [] } = {}) {
    return {
      goto: async () => {},
      url: () => url,
      $: async (sel) => {
        if (hasCaptcha && sel.includes('captcha')) return {};
        return null;
      },
      waitForSelector: async () => {},
      evaluate: async (fn) => fn(),
    };
  }

  test('jd search returns need_user_login when redirected to passport', async () => {
    const page = makeMockPage({ url: 'https://passport.jd.com/new/login.aspx' });
    const result = await jd.search(page, 'test');
    assert.strictEqual(result.status, 'need_user_login');
    assert.deepStrictEqual(result.items, []);
  });

  test('jd search returns need_user_action when captcha detected', async () => {
    const page = makeMockPage({ hasCaptcha: true });
    const result = await jd.search(page, 'test');
    assert.strictEqual(result.status, 'need_user_action');
  });

  test('jd search returns failed when no items extracted', async () => {
    const page = makeMockPage();
    const result = await jd.search(page, 'test');
    assert.strictEqual(result.status, 'failed');
    assert.deepStrictEqual(result.items, []);
  });
});

describe('pdd adapter with mock page', () => {
  const pdd = require('../sandbox/adapters/pdd');

  function makeMockPage({ hasCaptcha = false } = {}) {
    return {
      goto: async () => {},
      url: () => 'https://mobile.yangkeduo.com/search_result.html',
      $: async (sel) => hasCaptcha && sel.includes('captcha') ? {} : null,
      waitForSelector: async () => {},
      evaluate: async (fn) => fn(),
    };
  }

  test('pdd search returns need_user_action when captcha detected', async () => {
    const page = makeMockPage({ hasCaptcha: true });
    const result = await pdd.search(page, 'test');
    assert.strictEqual(result.status, 'need_user_action');
  });

  test('pdd search returns failed when no items in DOM', async () => {
    const page = makeMockPage();
    const result = await pdd.search(page, 'test');
    assert.strictEqual(result.status, 'failed');
  });
});

describe('taobao adapter with mock page', () => {
  const tb = require('../sandbox/adapters/taobao');

  test('taobao search returns need_user_login when redirected to login', async () => {
    const page = {
      goto: async () => {},
      url: () => 'https://login.taobao.com/member/login.jhtml',
      $: async () => null,
      waitForSelector: async () => {},
      evaluate: async (fn) => fn(),
    };
    const result = await tb.search(page, 'test');
    assert.strictEqual(result.status, 'need_user_login');
  });

  test('taobao search returns failed with no DOM items', async () => {
    const page = {
      goto: async () => {},
      url: () => 'https://s.taobao.com/search?q=test',
      $: async () => null,
      waitForSelector: async () => {},
      evaluate: async (fn) => fn(),
    };
    const result = await tb.search(page, 'test');
    assert.strictEqual(result.status, 'failed');
  });
});
