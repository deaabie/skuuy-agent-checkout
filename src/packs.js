/**
 * Canonical Server-Side API Quota & Pricing Catalog
 * 
 * SECURITY:
 * Amounts and quotas are strictly defined here on the server.
 * Client-submitted amounts or currencies are NEVER trusted.
 */

export const PACK_CATALOG = {
  'read_url': {
    api: 'read_url',
    name: 'Skuuy Read URL API',
    serviceUrl: 'https://read.skuuy.com',
    description: 'URL-to-Markdown scraper with AI readability extraction and token counting',
    packs: {
      'read-100': {
        id: 'read-100',
        api: 'read_url',
        name: 'Starter Pack (100 Calls)',
        calls: 100,
        amount: '1.00',
        currency: 'USD',
        description: 'Skuuy API Quota: 100 read_url calls'
      },
      'read-500': {
        id: 'read-500',
        api: 'read_url',
        name: 'Developer Pack (500 Calls)',
        calls: 500,
        amount: '4.50',
        currency: 'USD',
        description: 'Skuuy API Quota: 500 read_url calls (10% volume discount)'
      }
    }
  },
  'rpc': {
    api: 'rpc',
    name: 'Skuuy RPC Relay API',
    serviceUrl: 'https://rpc.skuuy.com',
    description: 'High-availability low-latency Base & EVM JSON-RPC relay',
    packs: {
      'rpc-1000': {
        id: 'rpc-1000',
        api: 'rpc',
        name: 'Micro Node Pack (1,000 Calls)',
        calls: 1000,
        amount: '2.00',
        currency: 'USD',
        description: 'Skuuy API Quota: 1,000 RPC calls'
      },
      'rpc-5000': {
        id: 'rpc-5000',
        api: 'rpc',
        name: 'Validator Pack (5,000 Calls)',
        calls: 5000,
        amount: '8.00',
        currency: 'USD',
        description: 'Skuuy API Quota: 5,000 RPC calls (20% volume discount)'
      }
    }
  },
  'file': {
    api: 'file',
    name: 'Skuuy File Drop API',
    serviceUrl: 'https://file.skuuy.com',
    description: 'Decentralized ephemeral storage and secure file drop API',
    packs: {
      'file-25': {
        id: 'file-25',
        api: 'file',
        name: 'Drop Pack (25 File Uploads)',
        calls: 25,
        amount: '1.00',
        currency: 'USD',
        description: 'Skuuy API Quota: 25 file drops'
      },
      'file-100': {
        id: 'file-100',
        api: 'file',
        name: 'Vault Pack (100 File Uploads)',
        calls: 100,
        amount: '3.00',
        currency: 'USD',
        description: 'Skuuy API Quota: 100 file drops (25% volume discount)'
      }
    }
  }
};

/**
 * Lookup and validate pack selection
 * @param {string} api 
 * @param {string} packId 
 * @returns {object|null}
 */
export function getPack(api, packId) {
  if (!api || !packId) return null;
  const service = PACK_CATALOG[api];
  if (!service) return null;
  return service.packs[packId] || null;
}

/**
 * Return full public catalog for agent discovery
 */
export function getPublicCatalog() {
  const result = {};
  for (const [key, service] of Object.entries(PACK_CATALOG)) {
    result[key] = {
      api: service.api,
      name: service.name,
      serviceUrl: service.serviceUrl,
      description: service.description,
      packs: Object.values(service.packs).map(p => ({
        pack: p.id,
        name: p.name,
        calls: p.calls,
        amount: p.amount,
        currency: p.currency,
        description: p.description
      }))
    };
  }
  return result;
}
