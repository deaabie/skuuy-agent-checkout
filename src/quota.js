/**
 * Enterprise Quota Lifecycle & Storage Management
 * 
 * Supports Cloudflare Workers KV (env.PAYPAL_QUOTAS) with in-memory fallback
 * for zero-config local testing and autonomous unit tests.
 * 
 * Key Schemas:
 * - pending:{orderId}   -> Uncaptured order details (TTL: 3 hours)
 * - order:{orderId}     -> Pointer to granted quotaKey (Replay & Double-Spend Defense)
 * - quota:{quotaKey}    -> Active API Quota state (total, remaining, lifecycle)
 */

import { generateQuotaKey } from './utils.js';

// In-memory fallback for local development or testing without KV bindings
const MEMORY_STORAGE = new Map();

async function kvGet(env, key) {
  if (env.PAYPAL_QUOTAS) {
    const raw = await env.PAYPAL_QUOTAS.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  const item = MEMORY_STORAGE.get(key);
  return item ? JSON.parse(JSON.stringify(item)) : null;
}

async function kvPut(env, key, value, options = {}) {
  const json = JSON.stringify(value);
  if (env.PAYPAL_QUOTAS) {
    await env.PAYPAL_QUOTAS.put(key, json, options);
    return;
  }
  MEMORY_STORAGE.set(key, value);
}

async function kvDelete(env, key) {
  if (env.PAYPAL_QUOTAS) {
    await env.PAYPAL_QUOTAS.delete(key);
    return;
  }
  MEMORY_STORAGE.delete(key);
}

/**
 * Save pending order state before buyer approval
 */
export async function savePendingOrder(env, orderId, pack, ipBucket) {
  const record = {
    orderId,
    api: pack.api,
    packId: pack.id,
    calls: pack.calls,
    amount: pack.amount,
    currency: pack.currency,
    ipBucket,
    createdAt: new Date().toISOString()
  };

  // TTL: 3 hours (10,800 seconds)
  await kvPut(env, `pending:${orderId}`, record, { expirationTtl: 10800 });
  return record;
}

/**
 * Retrieve pending order by orderId
 */
export async function getPendingOrder(env, orderId) {
  return await kvGet(env, `pending:${orderId}`);
}

/**
 * Check if order was already granted (Replay / Double-Spend defense)
 */
export async function getGrantedQuotaByOrder(env, orderId) {
  const quotaKey = await kvGet(env, `order:${orderId}`);
  if (!quotaKey) return null;
  return await getQuota(env, quotaKey);
}

/**
 * Grant API Quota on successful order capture
 */
export async function grantQuota(env, orderId, captureId, pendingData) {
  // 1. Check idempotency: Was this order already granted?
  const existingQuota = await getGrantedQuotaByOrder(env, orderId);
  if (existingQuota) {
    console.log(`[i] Order ${orderId} was already granted quota ${existingQuota.quotaKey}. Returning existing.`);
    return {
      quotaKey: existingQuota.quotaKey,
      api: existingQuota.api,
      total: existingQuota.total,
      remaining: existingQuota.remaining,
      orderId: existingQuota.orderId,
      captureId: existingQuota.captureId,
      alreadyGranted: true
    };
  }

  // 2. Generate new cryptographically secure quota key
  const quotaKey = generateQuotaKey();
  const now = new Date().toISOString();

  const quotaRecord = {
    quotaKey,
    api: pendingData.api,
    packId: pendingData.packId,
    total: pendingData.calls,
    remaining: pendingData.calls,
    orderId,
    captureId,
    amount: pendingData.amount,
    currency: pendingData.currency,
    createdAt: now,
    lastUsedAt: null,
    status: 'active'
  };

  // 3. Atomically store quota record and order pointer
  await kvPut(env, `quota:${quotaKey}`, quotaRecord);
  await kvPut(env, `order:${orderId}`, quotaKey);

  // 4. Clean up pending order
  await kvDelete(env, `pending:${orderId}`);

  return {
    quotaKey,
    api: quotaRecord.api,
    total: quotaRecord.total,
    remaining: quotaRecord.remaining,
    orderId,
    captureId,
    alreadyGranted: false
  };
}

/**
 * Retrieve quota details by quota key
 */
export async function getQuota(env, quotaKey) {
  if (!quotaKey || typeof quotaKey !== 'string') return null;
  return await kvGet(env, `quota:${quotaKey}`);
}

/**
 * Programmatically consume quota units
 * Used by Skuuy API services (read.skuuy.com, etc.) or demo agent
 */
export async function consumeQuota(env, quotaKey, units = 1) {
  const record = await getQuota(env, quotaKey);
  if (!record) {
    return { success: false, error: 'KEY_NOT_FOUND', status: 404 };
  }

  if (record.status !== 'active') {
    return { success: false, error: 'KEY_INACTIVE', status: 403 };
  }

  if (record.remaining < units) {
    return {
      success: false,
      error: 'INSUFFICIENT_QUOTA',
      status: 402,
      remaining: record.remaining,
      requested: units,
      total: record.total
    };
  }

  // Deduct units
  record.remaining -= units;
  record.lastUsedAt = new Date().toISOString();

  if (record.remaining === 0) {
    record.status = 'depleted';
  }

  await kvPut(env, `quota:${quotaKey}`, record);

  return {
    success: true,
    quotaKey,
    api: record.api,
    consumed: units,
    remaining: record.remaining,
    total: record.total,
    status: record.status
  };
}
