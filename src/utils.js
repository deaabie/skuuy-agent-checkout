/**
 * Enterprise Utilities: Cryptography, IP Bucketing, Security Headers & Rate Limiting
 */

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, PayPal-Request-Id',
  'Access-Control-Expose-Headers': 'X-Quota-Remaining, X-Quota-Total, X-RateLimit-Limit, X-RateLimit-Remaining',
  'Access-Control-Max-Age': '86400'
};

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

/**
 * Generate cryptographically secure API Quota Key: sq_live_<48 hex chars>
 */
export function generateQuotaKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `sq_live_${hex}`;
}

/**
 * Generate UUID v4 for PayPal-Request-Id idempotency
 */
export function generateUUID() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Extract client IP with IPv6 /64 subnet bucketing to prevent address-hopping attacks
 */
export function getClientIPBucket(request) {
  const ip = request.headers.get('cf-connecting-ip') || 
             request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
             '127.0.0.1';

  // IPv6 bucketing to /64 (first 4 segments)
  if (ip.includes(':')) {
    const segments = ip.split(':');
    return segments.slice(0, 4).join(':') + '::/64';
  }

  // IPv4 is full /32
  return ip;
}

/**
 * Standard JSON response builder with Security & CORS headers
 */
export function jsonResponse(payload, status = 200, extraHeaders = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...SECURITY_HEADERS,
      ...extraHeaders
    }
  });
}

/**
 * Standard Error response builder
 */
export function errorResponse(message, status = 400, code = 'INVALID_REQUEST', details = null) {
  return jsonResponse({
    success: false,
    error: message,
    code,
    status,
    timestamp: new Date().toISOString(),
    ...(details ? { details } : {})
  }, status);
}

/**
 * In-memory sliding window rate limiter
 * Limits requests per IP bucket (e.g., 60 req/min for checkout creation)
 */
const RATE_LIMIT_CACHE = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 60;

export function checkRateLimit(ipBucket) {
  const now = Date.now();
  const record = RATE_LIMIT_CACHE.get(ipBucket) || { count: 0, resetAt: now + WINDOW_MS };

  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + WINDOW_MS;
  } else {
    record.count += 1;
  }

  RATE_LIMIT_CACHE.set(ipBucket, record);

  // Evict old entries if cache grows large
  if (RATE_LIMIT_CACHE.size > 10000) {
    for (const [key, val] of RATE_LIMIT_CACHE.entries()) {
      if (now > val.resetAt) RATE_LIMIT_CACHE.delete(key);
    }
  }

  const remaining = Math.max(0, MAX_REQUESTS - record.count);
  return {
    allowed: record.count <= MAX_REQUESTS,
    limit: MAX_REQUESTS,
    remaining,
    resetInSeconds: Math.ceil((record.resetAt - now) / 1000)
  };
}
