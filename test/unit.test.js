import test from 'node:test';
import assert from 'node:assert/strict';

import { PACK_CATALOG, getPack, getPublicCatalog } from '../src/packs.js';
import { generateQuotaKey, generateUUID, getClientIPBucket, checkRateLimit } from '../src/utils.js';
import { grantQuota, getQuota, consumeQuota } from '../src/quota.js';

test('Packs: getPack validates valid packs and rejects invalid', () => {
  const read100 = getPack('read_url', 'read-100');
  assert.ok(read100);
  assert.equal(read100.calls, 100);
  assert.equal(read100.amount, '1.00');
  assert.equal(read100.currency, 'USD');

  const invalid = getPack('read_url', 'non-existent-pack');
  assert.equal(invalid, null);

  const invalidApi = getPack('fake_api', 'read-100');
  assert.equal(invalidApi, null);
});

test('Packs: getPublicCatalog returns sanitized catalog', () => {
  const catalog = getPublicCatalog();
  assert.ok(catalog.read_url);
  assert.ok(catalog.rpc);
  assert.ok(catalog.file);
  assert.ok(Array.isArray(catalog.read_url.packs));
});

test('Utils: generateQuotaKey creates high-entropy sq_live_ keys', () => {
  const key1 = generateQuotaKey();
  const key2 = generateQuotaKey();
  assert.ok(key1.startsWith('sq_live_'));
  assert.ok(key2.startsWith('sq_live_'));
  assert.notEqual(key1, key2);
  assert.equal(key1.length, 56); // 'sq_live_' (8) + 48 hex chars
});

test('Utils: generateUUID creates valid RFC 4122 v4 UUIDs', () => {
  const uuid = generateUUID();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.match(uuid, uuidRegex);
});

test('Utils: getClientIPBucket buckets IPv6 to /64', () => {
  const reqIpv6 = new Request('https://test.com', {
    headers: { 'cf-connecting-ip': '2001:0db8:85a3:0000:0000:8a2e:0370:7334' }
  });
  const bucket6 = getClientIPBucket(reqIpv6);
  assert.equal(bucket6, '2001:0db8:85a3:0000::/64');

  const reqIpv4 = new Request('https://test.com', {
    headers: { 'cf-connecting-ip': '192.168.1.100' }
  });
  const bucket4 = getClientIPBucket(reqIpv4);
  assert.equal(bucket4, '192.168.1.100');
});

test('Quota: grant, check, and consume lifecycle', async () => {
  const fakeEnv = {}; // Will trigger in-memory fallback
  const orderId = 'TEST_ORDER_' + Date.now();
  const captureId = 'TEST_CAPTURE_' + Date.now();
  const pendingData = {
    api: 'read_url',
    packId: 'read-100',
    calls: 100,
    amount: '1.00',
    currency: 'USD'
  };

  // 1. Grant Quota
  const grant = await grantQuota(fakeEnv, orderId, captureId, pendingData);
  assert.ok(grant.quotaKey.startsWith('sq_live_'));
  assert.equal(grant.remaining, 100);
  assert.equal(grant.total, 100);
  assert.equal(grant.alreadyGranted, false);

  // 2. Replay check (idempotency)
  const replay = await grantQuota(fakeEnv, orderId, captureId, pendingData);
  assert.equal(replay.quotaKey, grant.quotaKey);
  assert.equal(replay.alreadyGranted, true);

  // 3. Inspect quota
  const record = await getQuota(fakeEnv, grant.quotaKey);
  assert.ok(record);
  assert.equal(record.remaining, 100);
  assert.equal(record.status, 'active');

  // 4. Consume units
  const consume1 = await consumeQuota(fakeEnv, grant.quotaKey, 5);
  assert.equal(consume1.success, true);
  assert.equal(consume1.consumed, 5);
  assert.equal(consume1.remaining, 95);

  // 5. Reject over-consumption
  const overConsume = await consumeQuota(fakeEnv, grant.quotaKey, 200);
  assert.equal(overConsume.success, false);
  assert.equal(overConsume.error, 'INSUFFICIENT_QUOTA');
});

test('RateLimiter: sliding window enforces limit for POST (30) and GET (60)', async () => {
  const fakeEnv = {};
  const ip = '10.0.0.1';
  
  // Test POST limit (30)
  let allowedPost = 0;
  for (let i = 0; i < 40; i++) {
    const res = await checkRateLimit(fakeEnv, ip, true);
    if (res.allowed) allowedPost++;
  }
  assert.equal(allowedPost, 30);

  // Test GET limit (60) on different IP
  const ipGet = '10.0.0.2';
  let allowedGet = 0;
  for (let i = 0; i < 70; i++) {
    const res = await checkRateLimit(fakeEnv, ipGet, false);
    if (res.allowed) allowedGet++;
  }
  assert.equal(allowedGet, 60);
});
