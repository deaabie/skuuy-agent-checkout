/**
 * Enterprise PayPal REST API v2 Integration
 * 
 * - OAuth2 Client Credentials with in-flight token caching & preemptive refresh
 * - Orders API v2 (intent: CAPTURE) with UUID v4 idempotency keys
 * - Capture API v2 with status verification
 * - Webhook Signature Verification with SSRF protection on cert_url
 */

import { generateUUID } from './utils.js';

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Resolve PayPal REST API Host
 */
export function getPayPalBaseUrl(env) {
  const isProd = (env.PAYPAL_ENV || '').toLowerCase() === 'production';
  return isProd ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

/**
 * Fetch or return cached OAuth2 Bearer Access Token
 */
export async function getAccessToken(env) {
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('CONFIG_ERROR: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be configured.');
  }

  const now = Date.now();
  // Return cached token if valid for at least 5 more minutes
  if (cachedToken && now < tokenExpiresAt - 300000) {
    return cachedToken;
  }

  const baseUrl = getPayPalBaseUrl(env);
  const authString = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authString}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: 'grant_type=client_credentials'
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PayPal OAuth token request failed: HTTP ${res.status} - ${errText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in * 1000);

  return cachedToken;
}

/**
 * Create a PayPal Order with strict server-side pricing and idempotency
 */
export async function createOrder(env, pack, customRequestId = null) {
  const token = await getAccessToken(env);
  const baseUrl = getPayPalBaseUrl(env);
  const requestId = customRequestId || generateUUID();
  const publicBase = env.PUBLIC_BASE_URL || 'https://checkout.skuuy.com';

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: `skuuy-${pack.id}`,
        description: pack.description,
        amount: {
          currency_code: pack.currency,
          value: pack.amount
        }
      }
    ],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          brand_name: 'Skuuy Agent Commerce',
          locale: 'en-US',
          landing_page: 'LOGIN',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: `${publicBase}/checkout/return?status=success`,
          cancel_url: `${publicBase}/checkout/return?status=cancel`
        }
      }
    }
  };

  const res = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': requestId,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PayPal Order creation failed: HTTP ${res.status} - ${errText}`);
  }

  const data = await res.json();
  const approveLink = data.links?.find(l => l.rel === 'approve' || l.rel === 'payer-action')?.href;

  if (!approveLink) {
    throw new Error(`PayPal order created (${data.id}) but no approval URL returned.`);
  }

  return {
    orderId: data.id,
    approvalUrl: approveLink,
    status: data.status,
    amount: pack.amount,
    currency: pack.currency,
    expiresIn: 10800 // 3 hours pending TTL
  };
}

/**
 * Capture an approved PayPal Order
 */
export async function captureOrder(env, orderId) {
  const token = await getAccessToken(env);
  const baseUrl = getPayPalBaseUrl(env);
  const requestId = generateUUID();

  const res = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': requestId,
      'Prefer': 'return=representation'
    }
  });

  if (!res.ok) {
    const errText = await res.text();
    let parsed;
    try { parsed = JSON.parse(errText); } catch (e) {}
    return {
      success: false,
      status: res.status,
      rawError: parsed || errText
    };
  }

  const data = await res.json();
  const captureUnit = data.purchase_units?.[0]?.payments?.captures?.[0];

  return {
    success: data.status === 'COMPLETED',
    status: data.status,
    orderId: data.id,
    captureId: captureUnit?.id || null,
    captureStatus: captureUnit?.status || null,
    amount: captureUnit?.amount?.value || null,
    currency: captureUnit?.amount?.currency_code || null,
    raw: data
  };
}

/**
 * Verify Webhook Signature via PayPal's official endpoint with SSRF protection
 */
export async function verifyWebhookSignature(env, request, rawBody) {
  const webhookId = env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.warn('[!] PAYPAL_WEBHOOK_ID not set. Skipping signature verification in development/testing.');
    return { isValid: false, reason: 'PAYPAL_WEBHOOK_ID_NOT_CONFIGURED' };
  }

  const transmissionId = request.headers.get('paypal-transmission-id');
  const transmissionTime = request.headers.get('paypal-transmission-time');
  const certUrl = request.headers.get('paypal-cert-url');
  const authAlgo = request.headers.get('paypal-auth-algo');
  const transmissionSig = request.headers.get('paypal-transmission-sig');

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return { isValid: false, reason: 'MISSING_SIGNATURE_HEADERS' };
  }

  // SSRF Protection: Ensure cert_url is an official PayPal certificate endpoint
  const trustedDomainRegex = /^https:\/\/(?:api|api-m)\.(?:sandbox\.)?paypal\.com\//i;
  if (!trustedDomainRegex.test(certUrl)) {
    console.error(`[!] SSRF attempt detected in paypal-cert-url: ${certUrl}`);
    return { isValid: false, reason: 'UNTRUSTED_CERT_URL' };
  }

  let eventObj;
  try {
    eventObj = JSON.parse(rawBody);
  } catch (e) {
    return { isValid: false, reason: 'INVALID_JSON_BODY' };
  }

  const token = await getAccessToken(env);
  const baseUrl = getPayPalBaseUrl(env);

  const verificationPayload = {
    transmission_id: transmissionId,
    transmission_time: transmissionTime,
    cert_url: certUrl,
    auth_algo: authAlgo,
    transmission_sig: transmissionSig,
    webhook_id: webhookId,
    webhook_event: eventObj
  };

  const res = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(verificationPayload)
  });

  if (!res.ok) {
    const errText = await res.text();
    return { isValid: false, reason: `VERIFICATION_API_ERROR_${res.status}`, detail: errText };
  }

  const data = await res.json();
  const isValid = data.verification_status === 'SUCCESS';

  return {
    isValid,
    verificationStatus: data.verification_status,
    event: eventObj
  };
}
