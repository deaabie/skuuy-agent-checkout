/**
 * QuotaCoordinator Durable Object
 * 
 * Provides atomic, single-threaded serialized quota consumption per quota key.
 * Guarantees zero overdrafts, zero race conditions, and zero negative balances.
 * 
 * Design:
 * - Deterministic instance routing: idFromName("quota:{key}")
 * - Authoritative balance stored in DO transactional storage
 * - Lazy migration: first touch seeds from KV if not already in DO storage
 * - Synchronous/buffered mirror back to KV for external index & read consistency
 */

export class QuotaCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^\//, '');

    try {
      // 1. Seed initial quota on grant
      if (action === 'seed' && request.method === 'POST') {
        const body = await request.json();
        await this.state.storage.put('record', body);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 2. Authoritative get with lazy KV migration
      if (action === 'get') {
        const quotaKey = url.searchParams.get('key');
        let record = await this.state.storage.get('record');

        // Lazy migration: first touch seeds from KV if missing in DO storage
        if (!record && quotaKey && this.env.PAYPAL_QUOTAS) {
          const raw = await this.env.PAYPAL_QUOTAS.get(`quota:${quotaKey}`);
          if (raw) {
            record = JSON.parse(raw);
            await this.state.storage.put('record', record);
          }
        }

        if (!record) {
          return new Response(JSON.stringify(null), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify(record), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 3. Atomic serialized consume
      if (action === 'consume' && request.method === 'POST') {
        const body = await request.json();
        const units = parseInt(body.units || 1, 10);
        const quotaKey = body.key;

        let record = await this.state.storage.get('record');

        // Lazy migration: first touch seeds from KV if missing in DO storage
        if (!record && quotaKey && this.env.PAYPAL_QUOTAS) {
          const raw = await this.env.PAYPAL_QUOTAS.get(`quota:${quotaKey}`);
          if (raw) {
            record = JSON.parse(raw);
            await this.state.storage.put('record', record);
          }
        }

        if (!record) {
          return new Response(JSON.stringify({ success: false, error: 'KEY_NOT_FOUND', status: 404 }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (record.status === 'revoked' || record.status === 'suspended') {
          return new Response(JSON.stringify({ success: false, error: 'KEY_INACTIVE', status: 403 }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (record.remaining < units) {
          return new Response(JSON.stringify({
            success: false,
            error: 'INSUFFICIENT_QUOTA',
            status: 402,
            remaining: record.remaining,
            requested: units,
            total: record.total
          }), {
            status: 402,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (record.status !== 'active') {
          return new Response(JSON.stringify({ success: false, error: 'KEY_INACTIVE', status: 403 }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Single-threaded atomic deduction
        record.remaining -= units;
        record.lastUsedAt = new Date().toISOString();

        if (record.remaining === 0) {
          record.status = 'depleted';
        }

        await this.state.storage.put('record', record);

        // Mirror balance back to KV for external read consistency
        if (this.env.PAYPAL_QUOTAS && quotaKey) {
          try {
            await this.env.PAYPAL_QUOTAS.put(`quota:${quotaKey}`, JSON.stringify(record));
          } catch (kvErr) {
            console.error('DO to KV mirror sync error:', kvErr);
          }
        }

        return new Response(JSON.stringify({
          success: true,
          quotaKey,
          api: record.api,
          consumed: units,
          remaining: record.remaining,
          total: record.total,
          status: record.status
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}
