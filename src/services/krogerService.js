'use strict';
const axios  = require('axios');
const logger = require('../utils/logger');

const BASE     = process.env.KROGER_BASE_URL || 'https://api.kroger.com/v1';
const CLIENT_ID     = process.env.KROGER_CLIENT_ID;
const CLIENT_SECRET = process.env.KROGER_CLIENT_SECRET;

let tokenCache = { token: null, expires: 0 };

// ─── Get OAuth2 token ─────────────────────────────────────────────────────────
async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const resp  = await axios.post(`${BASE}/connect/oauth2/token`,
    'grant_type=client_credentials&scope=product.compact',
    { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
  );
  tokenCache = { token: resp.data.access_token, expires: Date.now() + (resp.data.expires_in - 60) * 1000 };
  logger.info('✅ Kroger API token refreshed');
  return tokenCache.token;
}

// ─── Search for products on sale ──────────────────────────────────────────────
async function searchDeals(term, locationId = '01400943') {
  const token = await getToken();
  const resp  = await axios.get(`${BASE}/products`, {
    headers: { Authorization: `Bearer ${token}` },
    params:  { 'filter.term': term, 'filter.locationId': locationId, 'filter.fulfillment': 'ais', 'filter.limit': 50 },
    timeout: 15000,
  });
  return (resp.data.data || []).filter(p => p.items?.some(i => i.price?.promo > 0));
}

// ─── Get weekly promo items ───────────────────────────────────────────────────
async function getWeeklyDeals(locationId = '01400943') {
  const token = await getToken();
  // Fetch promo items across key fitness/grocery categories
  const categories = [
    'meat chicken', 'eggs dairy', 'fish seafood', 'produce vegetables',
    'greek yogurt', 'brown rice', 'sweet potato', 'broccoli', 'salmon',
  ];
  const allDeals = [];
  for (const term of categories) {
    try {
      const resp = await axios.get(`${BASE}/products`, {
        headers: { Authorization: `Bearer ${token}` },
        params:  { 'filter.term': term, 'filter.locationId': locationId, 'filter.fulfillment': 'ais', 'filter.limit': 10 },
        timeout: 10000,
      });
      const products = resp.data.data || [];
      for (const product of products) {
        const item = product.items?.[0];
        if (!item) continue;
        const regular = item.price?.regular;
        const promo   = item.price?.promo;
        if (promo && promo > 0 && promo < regular) {
          allDeals.push({
            name:          product.description,
            store:         'kroger',
            dealPrice:     promo,
            originalPrice: regular,
            savingsAmount: parseFloat((regular - promo).toFixed(2)),
            savingsPct:    parseFloat(((1 - promo/regular)*100).toFixed(1)),
            dealType:      'weekly_special',
            description:   `Kroger Weekly — ${product.description}`,
            upc:           product.upc,
            imageUrl:      product.images?.[0]?.sizes?.find(s=>s.size==='medium')?.url,
            source:        'kroger_api',
            scrapedAt:     new Date().toISOString(),
          });
        }
      }
    } catch(err) {
      logger.warn(`Kroger search failed for "${term}":`, err.message);
    }
  }
  logger.info(`Kroger API: found ${allDeals.length} live deals`);
  return allDeals;
}

// ─── Get nearby store location ID ────────────────────────────────────────────
async function findNearbyStore(zipCode = '77001') {
  try {
    const token = await getToken();
    const resp  = await axios.get(`${BASE}/locations`, {
      headers: { Authorization: `Bearer ${token}` },
      params:  { 'filter.zipCode.near': zipCode, 'filter.limit': 1, 'filter.chain': 'KROGER' },
      timeout: 10000,
    });
    const loc = resp.data.data?.[0];
    if (loc) { logger.info(`Nearest Kroger: ${loc.name} (${loc.locationId})`); return loc.locationId; }
  } catch(err) { logger.warn('Kroger location lookup failed:', err.message); }
  return '01400943'; // Default Houston-area Kroger
}

// ─── Save live Kroger deals to DB ─────────────────────────────────────────────
async function syncDealsToDb(db, locationId) {
  if (!CLIENT_ID || !CLIENT_SECRET) { logger.warn('Kroger API keys not set — skipping live sync'); return []; }
  try {
    const deals = await getWeeklyDeals(locationId);
    if (!deals.length) return [];

    // Get or create Kroger store row
    const storeRow = await db.query('SELECT id FROM stores WHERE slug=$1', ['kroger']);
    if (!storeRow.rows.length) return deals;
    const storeId = storeRow.rows[0].id;

    const today    = new Date();
    const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate() + 7);

    let saved = 0;
    for (const deal of deals.slice(0, 50)) {
      try {
        // Upsert product
        const prodRes = await db.query(`
          INSERT INTO products (store_id, store_product_id, name, upc, category, unit_price, image_url, last_scraped_at)
          VALUES ($1, $2, $3, $4, 'Grocery', $5, $6, NOW())
          ON CONFLICT (store_id, store_product_id) DO UPDATE SET
            unit_price=EXCLUDED.unit_price, image_url=EXCLUDED.image_url, last_scraped_at=NOW()
          RETURNING id
        `, [storeId, deal.upc || deal.name.slice(0,20), deal.name, deal.upc, deal.originalPrice, deal.imageUrl]);

        const productId = prodRes.rows[0].id;

        // Insert deal (delete old one first to refresh)
        await db.query(`DELETE FROM deals WHERE product_id=$1 AND source='kroger_api'`, [productId]);
        await db.query(`
          INSERT INTO deals (product_id, store_id, deal_type, original_price, deal_price, savings_amount, savings_percent, deal_description, valid_from, valid_to, source)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'kroger_api')
        `, [productId, storeId, deal.dealType, deal.originalPrice, deal.dealPrice, deal.savingsAmount, deal.savingsPct, deal.description, today, nextWeek]);
        saved++;
      } catch(_) {}
    }
    logger.info(`✅ Kroger API: synced ${saved} live deals to database`);
    return deals;
  } catch(err) {
    logger.error('Kroger API sync failed:', err.message);
    return [];
  }
}

module.exports = { getToken, getWeeklyDeals, searchDeals, findNearbyStore, syncDealsToDb };
