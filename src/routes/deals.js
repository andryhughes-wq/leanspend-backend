'use strict';
const express   = require('express');
const db        = require('../config/database');
const redis     = require('../config/redis');
const adScraper = require('../services/weeklyAdScraper');
const logger    = require('../utils/logger');

const router = express.Router();

// GET /api/deals/weekly-ads — Live weekly ad data from store websites
router.get('/weekly-ads', async (req, res, next) => {
  try {
    const stores = req.query.stores ? req.query.stores.split(',') : ['kroger','walmart','heb','target','aldi'];
    const force  = req.query.force === 'true';

    if (force) adScraper.clearAdCache();

    const results = await adScraper.scrapeAllWeeklyAds(stores);
    res.json({
      ...results,
      storeCount: stores.length,
      message: `Scraped ${results.deals.length} deals from ${stores.length} stores`,
    });
  } catch (err) { next(err); }
});

// GET /api/deals/weekly-ads/:store — Live ad for a specific store
router.get('/weekly-ads/:store', async (req, res, next) => {
  try {
    const scrapers: Record<string, () => Promise<any[]>> = {
      kroger:  adScraper.scrapeKrogerAd,
      walmart: adScraper.scrapeWalmartAd,
      heb:     adScraper.scrapeHebAd,
      target:  adScraper.scrapeTargetAd,
      aldi:    adScraper.scrapeAldiAd,
    };

    const store   = req.params.store.toLowerCase();
    const scraper = scrapers[store];

    if (!scraper) return res.status(404).json({ error: `Store '${store}' not supported` });

    const deals = await scraper();
    res.json({ store, deals, count: deals.length, scrapedAt: new Date().toISOString() });
  } catch (err) { next(err); }
});

// GET /api/deals/ad-status — Cache status for all scraped ads
router.get('/ad-status', (req, res) => {
  res.json(adScraper.getAdCacheStatus());
});

// GET /api/deals/active — Active deals (DB + live scrape merged)
router.get('/active', async (req, res, next) => {
  try {
    const { store, limit = 50 } = req.query;
    const today    = new Date().toISOString().split('T')[0];
    const cacheKey = `ls:deals:${today}:${store||'all'}`;

    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(cached);

    // Get DB deals
    let dbDeals = [];
    try {
      let q = `
        SELECT d.id, d.deal_type, d.original_price, d.deal_price, d.savings_amount,
               d.savings_percent, d.deal_description, d.valid_from, d.valid_to,
               p.name as product_name, p.brand, p.category, p.image_url,
               s.slug as store_slug, s.name as store_name
        FROM deals d JOIN products p ON p.id=d.product_id JOIN stores s ON s.id=d.store_id
        WHERE d.valid_from<=CURRENT_DATE AND d.valid_to>=CURRENT_DATE
      `;
      const params = [];
      if (store) { q += ` AND s.slug=$1`; params.push(store); }
      q += ` ORDER BY d.savings_amount DESC NULLS LAST LIMIT ${parseInt(String(limit))}`;
      const result = await db.query(q, params);
      dbDeals = result.rows;
    } catch (_) {}

    // Also get live scraped deals
    let liveDeals = [];
    try {
      const stores = store ? [store] : ['kroger','walmart','heb'];
      const adResults = await adScraper.scrapeAllWeeklyAds(stores);
      liveDeals = adResults.deals.slice(0, 30).map(d => ({
        product_name:  d.name,
        store_slug:    d.store,
        store_name:    d.store?.charAt(0).toUpperCase() + d.store?.slice(1),
        deal_price:    d.dealPrice,
        original_price:d.originalPrice,
        savings_amount: d.originalPrice && d.dealPrice ? parseFloat((d.originalPrice - d.dealPrice).toFixed(2)) : null,
        deal_type:     d.dealType || 'weekly_special',
        deal_description: d.description || 'Weekly Special',
        source:        d.source,
        valid_from:    today,
        valid_to:      today,
        live:          true,
      }));
    } catch (_) {}

    // Merge — DB deals first, then live
    const allDeals = [...dbDeals, ...liveDeals];
    const data = { deals: allDeals, count: allDeals.length, dbDeals: dbDeals.length, liveDeals: liveDeals.length, fetchedAt: new Date().toISOString() };

    await redis.set(cacheKey, data, 60 * 30);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/deals/calendar
router.get('/calendar', async (req, res, next) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const result = await db.query(`
      SELECT d.valid_from, d.valid_to, d.deal_price, d.savings_amount, d.deal_type, d.deal_description,
             p.name as product_name, p.brand, s.slug as store_slug, s.name as store_name
      FROM deals d JOIN products p ON p.id=d.product_id JOIN stores s ON s.id=d.store_id
      WHERE EXTRACT(MONTH FROM d.valid_from)=$1 AND EXTRACT(YEAR FROM d.valid_from)=$2
      ORDER BY d.valid_from ASC, d.savings_amount DESC NULLS LAST
    `, [month, year]);
    const calendar: Record<string, any[]> = {};
    for (const deal of result.rows) {
      const key = new Date(deal.valid_from).toISOString().split('T')[0];
      if (!calendar[key]) calendar[key] = [];
      calendar[key].push(deal);
    }
    res.json({ month, year, calendar, totalDeals: result.rows.length });
  } catch (err) { next(err); }
});

// POST /api/deals/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    adScraper.clearAdCache();
    const stores = req.body.stores || ['kroger','walmart','heb','target','aldi'];
    const results = await adScraper.scrapeAllWeeklyAds(stores);
    res.json({ message: 'Weekly ads refreshed!', ...results });
  } catch (err) { next(err); }
});

module.exports = router;
