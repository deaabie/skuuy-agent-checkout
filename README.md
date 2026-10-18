# 🤖 Skuuy Agent Checkout

**Autonomous AI agent quota commerce on PayPal fiat rails.**

An AI agent that buys developer API quota with PayPal — no human checkout, no signup, machine-to-machine commerce. The agent detects it needs API access, creates a PayPal order, authorizes payment through its wallet, captures the payment, and receives a quota key that grants instant API access.

Built for the PayPal AI Hackathon 2026 on Devpost.

---

## How it works

```
Agent needs API access
        │
        ▼
POST /checkout/create  { api: "read_url", pack: "read-100" }
        │  → server computes price ($1.00), creates PayPal order
        ▼
Agent opens approval URL → wallet authorizes payment
        │
        ▼
POST /checkout/capture  { order_id }
        │  → PayPal captures $1.00, server issues quota key
        ▼
Agent calls API with quota key → 200 + data ✅
```

One quota system, two payment rails: PayPal (fiat) here, x402/USDC micropayments in production at [skuuy.com](https://skuuy.com).

## Live demo

- **API:** https://checkout.skuuy.com
- **Catalog:** https://checkout.skuuy.com/catalog
- **Health:** https://checkout.skuuy.com/health

## API reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Landing page + interactive docs |
| `GET` | `/health` | Service status |
| `GET` | `/catalog` | Quota packs for agent discovery |
| `POST` | `/checkout/create` | Create PayPal order → returns `order_id` + `approval_url` |
| `POST` | `/checkout/capture` | Capture payment → returns `quota_key` |
| `GET` | `/quota/check?key=` | Inspect quota balance |
| `POST` | `/quota/consume` | Atomically consume quota on API call (Durable Object, race-free) |
| `POST` | `/webhook/paypal` | PayPal webhook (signature-verified) |

### Create a checkout

```bash
curl -X POST https://checkout.skuuy.com/checkout/create \
  -H "Content-Type: application/json" \
  -d '{"api":"read_url","pack":"read-100"}'
```

```json
{
  "order_id": "73770343F32640848",
  "approval_url": "https://www.sandbox.paypal.com/checkoutnow?token=73770343F32640848",
  "amount": "1.00",
  "currency": "USD"
}
```

### Capture after approval

```bash
curl -X POST https://checkout.skuuy.com/checkout/capture \
  -H "Content-Type: application/json" \
  -d '{"order_id":"73770343F32640848"}'
```

```json
{
  "quota_key": "sq_live_...",
  "api": "read_url",
  "quota_total": 100,
  "quota_remaining": 100
}
```

## Quota packs

| Pack | API | Quota | Price (USD) |
|---|---|---|---|
| `read-100` | `read_url` | 100 calls | $1.00 |
| `read-500` | `read_url` | 500 calls | $4.50 |
| `rpc-1000` | `rpc` | 1,000 calls | $2.00 |
| `rpc-5000` | `rpc` | 5,000 calls | $8.00 |
| `file-25` | `file` | 25 drops | $1.00 |
| `file-100` | `file` | 100 drops | $3.00 |

Prices are computed 100% server-side. Clients never send amounts. Volume packs carry a 10–25% discount.

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Create the KV namespace (one time)
npx wrangler kv:namespace create PAYPAL_QUOTAS
# → copy the returned id into wrangler.toml [[kv_namespaces]]

# 3. Store PayPal credentials (never in git)
npx wrangler secret put PAYPAL_CLIENT_ID
npx wrangler secret put PAYPAL_CLIENT_SECRET
npx wrangler secret put PAYPAL_WEBHOOK_ID
# Get these from developer.paypal.com → your app → sandbox credentials.
# The webhook ID comes from the webhook you register at
# https://checkout.skuuy.com/webhook/paypal
# (events: CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED,
#  PAYMENT.CAPTURE.DENIED)

# 4. Run locally
npx wrangler dev
# → http://localhost:8787

# 5. Run tests
npm test   # 8/8 passing, incl. Durable Object concurrency test

# 6. Deploy
npx wrangler deploy
```

## Run the demo agent

```bash
# Against production:
CHECKOUT_URL=https://checkout.skuuy.com node demo/agent.mjs

# Against local dev server:
node demo/agent.mjs   # defaults to http://localhost:8787
```

The script walks through the full autonomous flow: quota check → order creation → approval → capture → API call with the granted quota key. See `docs/demo-script.md` for the video shot list.

> **Note for judges:** the agent needs a running Worker. Without `CHECKOUT_URL`
> it defaults to `http://localhost:8787`. If the server is unreachable, the
> script falls back to mock order/quota data for visual demonstration only
> (clearly labeled in terminal output) — no real PayPal transaction occurs.

## Architecture

```
skuuy-agent-checkout (Cloudflare Worker)
├── src/index.js    — router, CORS, rate limiting, error boundary
├── src/paypal.js   — OAuth2 token cache, Orders v2, capture, webhook verification
├── src/packs.js    — canonical server-side pricing (single source of truth)
├── src/quota.js    — quota lifecycle: grant, check, consume (routes through DO)
├── src/quota-do.js — QuotaCoordinator Durable Object: atomic serialized consume
└── src/utils.js    — quota key gen, UUID, IP bucketing (/64 IPv6, /32 IPv4)

Storage: Cloudflare KV (PAYPAL_QUOTAS — lookup index) +
         Durable Object storage (authoritative quota balance, strongly consistent)
Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID
         (Worker secrets via `wrangler secret put`, never in git)
PayPal: Orders API v2, sandbox environment
```

### Security

- **Server-side pricing** — amounts come from `src/packs.js`, never from client input.
- **Atomic quota consume** — all consumes serialize through the `QuotaCoordinator`
  Durable Object (single-threaded per key); 10 concurrent consumes decrement
  exactly 10, never overdraft. Verified live.
- **Idempotency** — `PayPal-Request-Id` (UUID v4) on every order mutation prevents double-charges on retry.
- **Replay defense** — `order:{orderId} → quotaKey` mapping; re-capturing the same order returns the existing key, never duplicates quota.
- **Webhook verification** — PayPal certificate URL allowlisted before signature verification; anti-SSRF regex on `paypal-cert-url`.
- **Rate limiting** — KV-backed sliding window per IP subnet (30 req/min POST, 60 req/min GET).
- **Zero credential leaks** — no secrets in git; `.dev.vars` is gitignored.

## Sandbox test accounts

Use this personal sandbox buyer account to test the complete end-to-end payment authorization flow on the PayPal sandbox `approval_url`:

| Role | Email | Password |
|---|---|---|
| Buyer (Personal) | `sb-tkaz253435536@personal.example.com` | `v>Lr0nf9` |

## Project structure

```
├── src/            # Worker source (incl. quota-do.js Durable Object)
├── demo/           # agent.mjs — interactive demo agent
├── docs/           # demo-script.md — video pitch script & shot list
├── test/           # unit tests (8/8 passing, incl. concurrency test)
├── wrangler.toml
└── package.json
```

## Tech stack

- Cloudflare Workers + KV + Durable Objects
- PayPal REST APIs (OAuth2, Orders v2) — sandbox
- Node.js (demo agent)

## License

MIT
