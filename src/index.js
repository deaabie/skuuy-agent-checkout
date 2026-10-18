/**
 * Skuuy Agent Checkout - Main Cloudflare Worker Entrypoint
 * 
 * An autonomous AI agent commerce gateway on PayPal fiat rails.
 * Features:
 * - Enterprise REST API with strict server-side price enforcement
 * - Idempotent order creation and capture
 * - Cryptographic quota issuance (sq_live_...)
 * - Asynchronous PayPal webhook verification with SSRF protection
 * - Global IPv6 /64 and IPv4 /32 sliding-window rate limiting
 */

import { getPack, getPublicCatalog } from './packs.js';
import { createOrder, captureOrder, verifyWebhookSignature } from './paypal.js';
import { savePendingOrder, getPendingOrder, getGrantedQuotaByOrder, grantQuota, getQuota, consumeQuota } from './quota.js';
import { CORS_HEADERS, jsonResponse, errorResponse, getClientIPBucket, checkRateLimit } from './utils.js';

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method.toUpperCase();
    const ipBucket = getClientIPBucket(request);

    try {
      // 2. Public Catalog & Documentation
      if (method === 'GET' && path === '/') {
        return renderHome(env);
      }

      if (method === 'GET' && path === '/health') {
        return jsonResponse({
          status: 'ok',
          service: 'skuuy-agent-checkout',
          version: '1.0.0',
          paypal_env: env.PAYPAL_ENV || 'sandbox',
          docs: 'https://checkout.skuuy.com',
          timestamp: new Date().toISOString()
        });
      }

      if (method === 'GET' && path === '/catalog') {
        return jsonResponse({
          success: true,
          catalog: getPublicCatalog(),
          fiat_currency: 'USD',
          dual_rail_note: 'Traditional fiat rails (PayPal Orders API v2). For crypto micropayments on Base, see x402 headers on respective Skuuy endpoints.'
        });
      }

      // 3. Buyer / Agent Return Screen
      if (method === 'GET' && path === '/checkout/return') {
        const status = url.searchParams.get('status') || 'success';
        return renderReturnPage(status);
      }

      // 4. Global Rate Limiting (POST: 30 req/min, GET: 60 req/min, excluding /health)
      if (path !== '/health') {
        const isPost = method === 'POST';
        const rate = await checkRateLimit(env, ipBucket, isPost);
        if (!rate.allowed) {
          return errorResponse(
            `Rate limit exceeded. Maximum ${rate.limit} requests per minute. Try again in ${rate.resetInSeconds}s.`,
            429,
            'RATE_LIMIT_EXCEEDED',
            null,
            {
              'Retry-After': String(rate.resetInSeconds),
              'X-RateLimit-Limit': String(rate.limit),
              'X-RateLimit-Remaining': String(rate.remaining),
              'X-RateLimit-Reset': String(rate.resetInSeconds)
            }
          );
        }
      }

      // 5. POST /checkout/create -> Create PayPal Order
      if (method === 'POST' && path === '/checkout/create') {
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return errorResponse('Invalid JSON payload in request body.', 400, 'INVALID_JSON');
        }

        const { api, pack: packId, request_id } = body;
        if (!api || !packId) {
          return errorResponse('Missing required fields: "api" and "pack" are mandatory.', 400, 'MISSING_PARAMS', {
            example: { api: 'read_url', pack: 'read-100' },
            available_packs_url: '/catalog'
          });
        }

        const pack = getPack(api, packId);
        if (!pack) {
          return errorResponse(`Unknown pack combination: api="${api}", pack="${packId}".`, 400, 'INVALID_PACK', {
            available_packs_url: '/catalog'
          });
        }

        // Call PayPal API v2 to create order
        const order = await createOrder(env, pack, request_id);

        // Store pending order in KV
        await savePendingOrder(env, order.orderId, pack, ipBucket);

        return jsonResponse({
          success: true,
          order_id: order.orderId,
          approval_url: order.approvalUrl,
          api: pack.api,
          pack: pack.id,
          calls: pack.calls,
          amount: pack.amount,
          currency: pack.currency,
          expires_in: order.expiresIn,
          instructions: 'Direct your wallet or user agent to approval_url. Once authorized, call POST /checkout/capture.'
        });
      }

      // 6. POST /checkout/capture -> Capture PayPal Order & Issue Quota
      if (method === 'POST' && path === '/checkout/capture') {
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return errorResponse('Invalid JSON payload in request body.', 400, 'INVALID_JSON');
        }

        const { order_id } = body;
        if (!order_id) {
          return errorResponse('Missing required field: "order_id" is mandatory.', 400, 'MISSING_ORDER_ID');
        }

        // Check idempotency first: Was this order already granted?
        const alreadyGranted = await getGrantedQuotaByOrder(env, order_id);
        if (alreadyGranted) {
          return jsonResponse({
            success: true,
            quota_key: alreadyGranted.quotaKey,
            api: alreadyGranted.api,
            quota_total: alreadyGranted.total,
            quota_remaining: alreadyGranted.remaining,
            order_id: alreadyGranted.orderId,
            capture_id: alreadyGranted.captureId,
            status: alreadyGranted.status,
            replayed: true
          });
        }

        // Look up pending order record
        const pending = await getPendingOrder(env, order_id);
        if (!pending) {
          return errorResponse(
            `Order ID "${order_id}" not found or expired. Make sure the order was created via /checkout/create.`,
            404,
            'ORDER_NOT_FOUND_OR_EXPIRED'
          );
        }

        // Execute capture against PayPal
        const captureResult = await captureOrder(env, order_id);

        if (!captureResult.success) {
          return jsonResponse({
            success: false,
            error: 'PAYMENT_NOT_COMPLETED',
            paypal_status: captureResult.status || 'UNKNOWN',
            details: captureResult.rawError || 'The order has not yet been approved by the buyer or was declined.'
          }, 402);
        }

        // Grant Quota in KV
        const granted = await grantQuota(env, order_id, captureResult.captureId, pending);

        return jsonResponse({
          success: true,
          quota_key: granted.quotaKey,
          api: granted.api,
          quota_total: granted.total,
          quota_remaining: granted.remaining,
          order_id: granted.orderId,
          capture_id: granted.captureId,
          status: 'active'
        });
      }

      // 7. GET /quota/check -> Inspect Quota by Key
      if (method === 'GET' && path === '/quota/check') {
        const key = url.searchParams.get('key');
        if (!key) {
          return errorResponse('Missing required query parameter: "key" is mandatory.', 400, 'MISSING_KEY');
        }

        const quota = await getQuota(env, key);
        if (!quota) {
          return errorResponse('Quota key not found or expired.', 404, 'KEY_NOT_FOUND');
        }

        return jsonResponse({
          success: true,
          quota_key: quota.quotaKey,
          api: quota.api,
          pack: quota.packId,
          quota_total: quota.total,
          quota_remaining: quota.remaining,
          status: quota.status,
          created_at: quota.createdAt,
          last_used_at: quota.lastUsedAt
        });
      }

      // 8. POST /quota/consume -> Deduct units from Quota
      if (method === 'POST' && path === '/quota/consume') {
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return errorResponse('Invalid JSON payload in request body.', 400, 'INVALID_JSON');
        }

        const { key, units = 1 } = body;
        if (!key) {
          return errorResponse('Missing required field: "key".', 400, 'MISSING_KEY');
        }

        const unitCount = parseInt(units, 10);
        if (isNaN(unitCount) || unitCount <= 0 || unitCount > 1000) {
          return errorResponse('"units" must be a positive integer between 1 and 1000.', 400, 'INVALID_UNITS');
        }

        const result = await consumeQuota(env, key, unitCount);
        if (!result.success) {
          return errorResponse(result.error, result.status || 400, result.error, result);
        }

        return jsonResponse({
          success: true,
          quota_key: result.quotaKey,
          api: result.api,
          consumed: result.consumed,
          quota_remaining: result.remaining,
          quota_total: result.total,
          status: result.status
        });
      }

      // 9. POST /webhook/paypal -> Asynchronous Webhook Reconciler
      if (method === 'POST' && path === '/webhook/paypal') {
        const rawBody = await request.text();
        const verification = await verifyWebhookSignature(env, request, rawBody);

        if (!verification.isValid) {
          console.warn('[!] Invalid PayPal Webhook signature:', verification.reason);
          return errorResponse('Invalid webhook signature.', 401, 'INVALID_WEBHOOK_SIGNATURE', {
            reason: verification.reason
          });
        }

        const event = verification.event;
        const eventType = event.event_type;
        console.log(`[✓] Verified PayPal Webhook event: ${eventType} (ID: ${event.id})`);

        if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
          const resource = event.resource || {};
          const captureId = resource.id;
          const orderId = resource.supplementary_data?.related_ids?.order_id;

          if (orderId) {
            const alreadyGranted = await getGrantedQuotaByOrder(env, orderId);
            if (!alreadyGranted) {
              const pending = await getPendingOrder(env, orderId);
              if (pending) {
                await grantQuota(env, orderId, captureId, pending);
                console.log(`[✓] Webhook asynchronously granted quota for order ${orderId}`);
              }
            }
          }
        }

        // Always return 200 to acknowledge PayPal event
        return jsonResponse({ received: true, event_type: eventType });
      }

      // 404 Route Not Found
      return errorResponse(`Route not found: ${method} ${path}`, 404, 'NOT_FOUND', {
        available_endpoints: [
          'GET /health',
          'GET /catalog',
          'POST /checkout/create',
          'POST /checkout/capture',
          'GET /quota/check?key=...',
          'POST /quota/consume',
          'POST /webhook/paypal'
        ]
      });

    } catch (err) {
      console.error('Unhandled Worker Exception:', err);
      return errorResponse(
        err.message || 'An unexpected internal error occurred.',
        500,
        'INTERNAL_SERVER_ERROR'
      );
    }
  }
};

/**
 * Render Interactive HTML Documentation & Neo-Brutalist Playground
 */
function renderHome(env) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Skuuy Agent Checkout - PayPal AI Hackathon</title>
  <link rel="icon" href="https://skuuy.com/favicon.svg" type="image/svg+xml">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .neo-box { border: 3px solid #000; box-shadow: 6px 6px 0px #000; }
    .neo-btn { border: 2px solid #000; box-shadow: 4px 4px 0px #000; transition: all 0.1s ease; }
    .neo-btn:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0px #000; }
  </style>
</head>
<body class="bg-[#FFFDF0] text-slate-900 min-h-screen p-4 sm:p-8">
  <div class="max-w-4xl mx-auto space-y-8">
    
    <!-- Hero Header -->
    <header class="neo-box rounded-3xl bg-[#FFE600] p-6 sm:p-10 space-y-4">
      <div class="inline-flex items-center gap-2 px-3 py-1 bg-black text-[#FFE600] font-black text-xs uppercase tracking-wider rounded-lg border-2 border-black">
        <span>🏆 PayPal AI Hackathon 2026</span>
      </div>
      <h1 class="text-3xl sm:text-5xl font-black uppercase tracking-tight text-black leading-tight">
        Skuuy Agent Checkout
      </h1>
      <p class="text-base sm:text-lg font-bold text-slate-900 max-w-2xl leading-relaxed">
        Autonomous AI Agent Quota Commerce on PayPal Fiat Rails. Machine-to-machine payments without humans in the loop, zero signup, instant API quota issuance.
      </p>
      <div class="flex flex-wrap gap-3 pt-2">
        <span class="neo-box px-3 py-1 bg-white text-xs font-black uppercase">⚡ PayPal Orders v2</span>
        <span class="neo-box px-3 py-1 bg-[#00F0FF] text-xs font-black uppercase">🔒 Idempotent CAPTURE</span>
        <span class="neo-box px-3 py-1 bg-[#00E676] text-xs font-black uppercase">🌐 Dual-Rail (Fiat + x402)</span>
        <span class="neo-box px-3 py-1 bg-[#FF007F] text-white text-xs font-black uppercase">🛡️ Enterprise Cloudflare KV</span>
      </div>
    </header>

    <!-- Architecture & Concept -->
    <section class="neo-box rounded-3xl bg-white p-6 sm:p-8 space-y-4">
      <h2 class="text-2xl font-black uppercase text-black">How It Works (Agentic Commerce)</h2>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm font-bold pt-2">
        <div class="p-4 bg-slate-50 border-2 border-black rounded-xl space-y-1">
          <div class="text-[#FF007F] font-black">STEP 1</div>
          <div class="font-black text-black">Discovery</div>
          <p class="text-xs text-slate-600 font-medium">Agent queries <code class="bg-slate-200 px-1 py-0.5 rounded">/catalog</code> to discover API quotas and pricing.</p>
        </div>
        <div class="p-4 bg-slate-50 border-2 border-black rounded-xl space-y-1">
          <div class="text-[#00F0FF] font-black">STEP 2</div>
          <div class="font-black text-black">Create Order</div>
          <p class="text-xs text-slate-600 font-medium">Agent requests PayPal Order via <code class="bg-slate-200 px-1 py-0.5 rounded">POST /checkout/create</code> with strict server pricing.</p>
        </div>
        <div class="p-4 bg-slate-50 border-2 border-black rounded-xl space-y-1">
          <div class="text-[#00E676] font-black">STEP 3</div>
          <div class="font-black text-black">Wallet Approval</div>
          <p class="text-xs text-slate-600 font-medium">Agent wallet signs approval via PayPal Sandbox authorization URL.</p>
        </div>
        <div class="p-4 bg-slate-50 border-2 border-black rounded-xl space-y-1">
          <div class="text-black font-black">STEP 4</div>
          <div class="font-black text-black">Capture & Quota</div>
          <p class="text-xs text-slate-600 font-medium"><code class="bg-slate-200 px-1 py-0.5 rounded">POST /checkout/capture</code> executes capture and issues <code class="bg-slate-200 px-1 py-0.5 rounded">sq_live_...</code> key.</p>
        </div>
      </div>
    </section>

    <!-- Available API Quotas -->
    <section class="neo-box rounded-3xl bg-[#00F0FF] p-6 sm:p-8 space-y-4 text-black">
      <h2 class="text-2xl font-black uppercase">Live Quota Packs</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="p-4 bg-white border-2 border-black rounded-2xl shadow-[4px_4px_0px_#000] space-y-2">
          <div class="text-xs font-black uppercase text-slate-500">read_url</div>
          <div class="text-lg font-black">read-100</div>
          <div class="text-2xl font-black text-[#FF007F]">$1.00 <span class="text-xs font-bold text-slate-600">/ 100 reads</span></div>
          <p class="text-xs font-bold text-slate-700">URL to clean Markdown reader API.</p>
        </div>
        <div class="p-4 bg-white border-2 border-black rounded-2xl shadow-[4px_4px_0px_#000] space-y-2">
          <div class="text-xs font-black uppercase text-slate-500">rpc</div>
          <div class="text-lg font-black">rpc-1000</div>
          <div class="text-2xl font-black text-[#00E676]">$2.00 <span class="text-xs font-bold text-slate-600">/ 1k calls</span></div>
          <p class="text-xs font-bold text-slate-700">High-throughput Base RPC relay.</p>
        </div>
        <div class="p-4 bg-white border-2 border-black rounded-2xl shadow-[4px_4px_0px_#000] space-y-2">
          <div class="text-xs font-black uppercase text-slate-500">file</div>
          <div class="text-lg font-black">file-25</div>
          <div class="text-2xl font-black text-black">$1.00 <span class="text-xs font-bold text-slate-600">/ 25 drops</span></div>
          <p class="text-xs font-bold text-slate-700">Ephemeral decentralized file storage.</p>
        </div>
      </div>
    </section>

    <!-- API Reference for AI Agents -->
    <section class="neo-box rounded-3xl bg-white p-6 sm:p-8 space-y-4">
      <h2 class="text-2xl font-black uppercase text-black">Agentic Endpoints</h2>
      <div class="space-y-3 font-mono text-xs">
        <div class="p-3 bg-slate-100 border-2 border-black rounded-xl">
          <div class="flex items-center gap-2 font-bold"><span class="px-2 py-0.5 bg-[#00E676] text-black rounded font-black">GET</span> /catalog</div>
          <p class="mt-1 text-slate-600 font-sans">Discover available API packs, quantities, and USD pricing.</p>
        </div>
        <div class="p-3 bg-slate-100 border-2 border-black rounded-xl">
          <div class="flex items-center gap-2 font-bold"><span class="px-2 py-0.5 bg-[#00F0FF] text-black rounded font-black">POST</span> /checkout/create</div>
          <p class="mt-1 text-slate-600 font-sans">Payload: <code>{"api": "read_url", "pack": "read-100"}</code> &rarr; Returns <code>order_id</code> and <code>approval_url</code>.</p>
        </div>
        <div class="p-3 bg-slate-100 border-2 border-black rounded-xl">
          <div class="flex items-center gap-2 font-bold"><span class="px-2 py-0.5 bg-[#00F0FF] text-black rounded font-black">POST</span> /checkout/capture</div>
          <p class="mt-1 text-slate-600 font-sans">Payload: <code>{"order_id": "8RU..."}</code> &rarr; Captures payment and issues <code>sq_live_...</code> quota key.</p>
        </div>
        <div class="p-3 bg-slate-100 border-2 border-black rounded-xl">
          <div class="flex items-center gap-2 font-bold"><span class="px-2 py-0.5 bg-[#00E676] text-black rounded font-black">GET</span> /quota/check?key=sq_live_...</div>
          <p class="mt-1 text-slate-600 font-sans">Check remaining units and validity of a quota key.</p>
        </div>
        <div class="p-3 bg-slate-100 border-2 border-black rounded-xl">
          <div class="flex items-center gap-2 font-bold"><span class="px-2 py-0.5 bg-[#00F0FF] text-black rounded font-black">POST</span> /quota/consume</div>
          <p class="mt-1 text-slate-600 font-sans">Payload: <code>{"key": "sq_live_...", "units": 1}</code> &rarr; Decrements quota during API calls.</p>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="text-center text-xs font-bold text-slate-500 py-4">
      &copy; 2026 Skuuy Network &bull; Built for PayPal AI Hackathon &bull; MIT Licensed
    </footer>

  </div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}

function renderReturnPage(status) {
  const isSuccess = status === 'success';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Payment Authorization Status</title>
  <link rel="icon" href="https://skuuy.com/favicon.svg" type="image/svg+xml">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-[#FFFDF0] text-slate-900 min-h-screen flex items-center justify-center p-6">
  <div class="max-w-md w-full bg-white border-4 border-black p-8 rounded-3xl shadow-[8px_8px_0px_#000] text-center space-y-4">
    <div class="w-16 h-16 mx-auto rounded-2xl border-3 border-black flex items-center justify-center text-2xl font-black ${isSuccess ? 'bg-[#00E676]' : 'bg-[#FF007F] text-white'}">
      ${isSuccess ? '✓' : '✗'}
    </div>
    <h1 class="text-2xl font-black uppercase text-black">
      ${isSuccess ? 'Payment Authorized!' : 'Payment Cancelled'}
    </h1>
    <p class="text-sm font-bold text-slate-700 leading-relaxed">
      ${isSuccess 
        ? 'Your PayPal sandbox payment has been authorized. You can now return to your autonomous agent terminal — the agent will execute the capture and receive its API quota instantly.' 
        : 'The checkout was cancelled. No quota was issued.'}
    </p>
    <a href="/" class="inline-block px-4 py-2 bg-black text-[#FFE600] font-black text-xs uppercase rounded-xl border-2 border-black shadow-[3px_3px_0px_#000] hover:bg-slate-900">
      Back to Home
    </a>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}
