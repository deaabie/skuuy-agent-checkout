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
| `POST` | `/quota/consume` | Atomically consume quota on API call |
| `POST` | `/webhook/paypal` | PayPal webhook (signature-verified) |

### Create a checkout

```bash
curl -X POST https://checkout.skuuy.com/checkout/create \
  -H "Content-Type: application/json" \
  -d '{"api":"read_url","pack":"read-100"}'
```

```json
{
  "order_id": "9E893376W6063194A",
  "approval_url": "https://www.sandbox.paypal.com/checkoutnow?token=9E893376W6063194A",
  "amount": "1.00",
  "currency": "USD"
}
```

### Capture after approval

```bash
curl -X POST https://checkout.skuuy.com/checkout/capture \
  -H "Content-Type: application/json" \
  -d '{"order_id":"9E893376W6063194A"}'
```

```json
{
  "quota_key": "sq_live_abc123...",
  "api": "read_url",
  "quota_total": 100,
  "quota_remaining": 100
}
```

## Quota packs

| Pack | API | Quota | Price (USD) |
|---|---|---|---|
| `read-100` | `read_url` | 100 calls | $1.00 |
| `rpc-1000` | `rpc` | 1,000 calls | $2.00 |
| `file-25` | `file` | 25 drops | $1.00 |

Prices are computed 100% server-side. Clients never send amounts.

## Run the demo agent

```bash
node demo/agent.mjs
```

The script walks through the full autonomous flow: quota check → order creation → approval → capture → API call with the granted quota key. See `docs/demo-script.md` for the video shot list.

## Architecture

```
skuuy-agent-checkout (Cloudflare Worker)
├── src/index.js    — router, CORS, rate limiting, error boundary
├── src/paypal.js   — OAuth2 token cache, Orders v2, capture, webhook verification
├── src/packs.js    — canonical server-side pricing (single source of truth)
├── src/quota.js    — KV quota lifecycle: grant, check, atomic consume
└── src/utils.js    — quota key gen, UUID, IP bucketing (/64 IPv6, /32 IPv4)

Storage: Cloudflare KV (PAYPAL_QUOTAS)
Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET (Worker secrets, never in git)
PayPal: Orders API v2, sandbox environment
```

### Security

- **Server-side pricing** — amounts come from `src/packs.js`, never from client input.
- **Idempotency** — `PayPal-Request-Id` (UUID v4) on every order mutation prevents double-charges on retry.
- **Replay defense** — `order:{orderId} → quotaKey` mapping; re-capturing the same order returns the existing key, never duplicates quota.
- **Webhook verification** — PayPal certificate URL allowlisted before signature verification; anti-SSRF regex on `paypal-cert-url`.
- **Rate limiting** — sliding window per IP subnet.
- **Zero credential leaks** — no secrets in git; `.dev.vars` is gitignored.

## Sandbox test accounts

| Role | Email |
|---|---|
| Seller (Business) | `sb-fl8m753415634@business.example.com` |
| Buyer (Personal) | `sb-tkaz253435536@personal.example.com` |

## Project structure

```
├── src/            # Worker source
├── demo/           # agent.mjs — interactive demo agent
├── docs/           # demo-script.md — video pitch script & shot list
├── test/           # unit tests
├── wrangler.toml
└── package.json
```

## Tech stack

- Cloudflare Workers + KV
- PayPal REST APIs (OAuth2, Orders v2) — sandbox
- Node.js (demo agent)

## License

MIT
