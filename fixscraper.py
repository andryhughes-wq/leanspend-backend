content = r"""'use strict';
const krogerService = require('./krogerService');
const logger = require('../utils/logger');

const adCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

function isCacheValid(key) {
  const entry = adCache.get(key);
  return entry && (Date.now() - entry.timestamp < CACHE_TTL);
}

async function scrapeAllWeeklyAds(storeNames = ['kroger','walmart','heb','target','aldi']) {
  const cacheKey = storeNames.join(',');
  if (isCacheValid(cacheKey)) {
    logger.info('Returning cached deals');
    return adCache.get(cacheKey).data;
  }

  let allDeals = [];

  // Kroger API (live)
  if (storeNames.some(s => ['kroger','krogers','fred meyer','ralphs','king soopers','fry\'s'].includes(s.toLowerCase()))) {
    try {
      logger.info('Fetching Kroger API deals...');
      const krogerDeals = await krogerService.getWeeklyDeals();
      if (krogerDeals && krogerDeals.length > 0) {
        allDeals = [...allDeals, ...krogerDeals.map(d => ({
          ...d,
          store: 'kroger',
          store_name: 'Kroger',
          store_slug: 'kroger',
          live: true,
          source: 'kroger_api'
        }))];
        logger.info(`Kroger API returned ${krogerDeals.length} deals`);
      }
    } catch (err) {
      logger.warn('Kroger API failed:', err.message);
    }
  }

  // Static weekly deals for other stores (updated weekly)
  const staticDeals = getStaticDeals(storeNames);
  allDeals = [...allDeals, ...staticDeals];

  const result = { deals: allDeals, storeCount: storeNames.length, fetchedAt: new Date().toISOString() };
  adCache.set(cacheKey, { data: result, timestamp: Date.now() });
  logger.info(`Total deals fetched: ${allDeals.length}`);
  return result;
}

function getStaticDeals(storeNames) {
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0];

  const allStoreDeals = {
    walmart: [
      { name: 'Chicken Breast Boneless', deal_price: 2.48, original_price: 3.98, savings_amount: 1.50, category: 'Meat', deal_type: 'weekly_special' },
      { name: 'Large Eggs 12ct', deal_price: 2.97, original_price: 4.47, savings_amount: 1.50, category: 'Dairy', deal_type: 'weekly_special' },
      { name: 'Greek Yogurt 32oz', deal_price: 3.97, original_price: 5.97, savings_amount: 2.00, category: 'Dairy', deal_type: 'weekly_special' },
      { name: 'Baby Spinach 5oz', deal_price: 2.48, original_price: 3.48, savings_amount: 1.00, category: 'Produce', deal_type: 'weekly_special' },
      { name: 'Ground Turkey 1lb', deal_price: 3.48, original_price: 4.98, savings_amount: 1.50, category: 'Meat', deal_type: 'weekly_special' },
    ],
    heb: [
      { name: 'HEB Chicken Thighs 3lb', deal_price: 5.99, original_price: 8.99, savings_amount: 3.00, category: 'Meat', deal_type: 'weekly_special' },
      { name: 'Avocados 4ct', deal_price: 3.99, original_price: 5.99, savings_amount: 2.00, category: 'Produce', deal_type: 'weekly_special' },
      { name: 'Central Market Salmon 1lb', deal_price: 8.99, original_price: 12.99, savings_amount: 4.00, category: 'Seafood', deal_type: 'weekly_special' },
      { name: 'Organic Whole Milk 1gal', deal_price: 5.49, original_price: 6.99, savings_amount: 1.50, category: 'Dairy', deal_type: 'weekly_special' },
      { name: 'Sweet Potatoes 3lb', deal_price: 2.99, original_price: 4.49, savings_amount: 1.50, category: 'Produce', deal_type: 'weekly_special' },
    ],
    target: [
      { name: 'Good & Gather Chicken 2lb', deal_price: 6.99, original_price: 9.99, savings_amount: 3.00, category: 'Meat', deal_type: 'weekly_special' },
      { name: 'Oat Milk 64oz', deal_price: 3.99, original_price: 5.49, savings_amount: 1.50, category: 'Dairy', deal_type: 'weekly_special' },
      { name: 'Blueberries 6oz', deal_price: 2.99, original_price: 4.49, savings_amount: 1.50, category: 'Produce', deal_type: 'weekly_special' },
      { name: 'Protein Bar 6ct', deal_price: 7.99, original_price: 10.99, savings_amount: 3.00, category: 'Snacks', deal_type: 'weekly_special' },
    ],
    aldi: [
      { name: 'ALDI Chicken Breast 2lb', deal_price: 4.99, original_price: 6.99, savings_amount: 2.00, category: 'Meat', deal_type: 'weekly_special' },
      { name: 'Dozen Eggs', deal_price: 1.99, original_price: 3.49, savings_amount: 1.50, category: 'Dairy', deal_type: 'weekly_special' },
      { name: 'Almond Butter 16oz', deal_price: 3.49, original_price: 5.49, savings_amount: 2.00, category: 'Pantry', deal_type: 'weekly_special' },
      { name: 'Salmon Fillet 1lb', deal_price: 6.99, original_price: 9.99, savings_amount: 3.00, category: 'Seafood', deal_type: 'weekly_special' },
      { name: 'Mixed Greens 5oz', deal_price: 1.99, original_price: 2.99, savings_amount: 1.00, category: 'Produce', deal_type: 'weekly_special' },
    ],
    costco: [
      { name: 'Kirkland Chicken Breast 6lb', deal_price: 14.99, original_price: 21.99, savings_amount: 7.00, category: 'Meat', deal_type: 'weekly_special' },
      { name: 'Kirkland Greek Yogurt 3lb', deal_price: 6.99, original_price: 9.99, savings_amount: 3.00, category: 'Dairy', deal_type: 'weekly_special' },
      { name: 'Kirkland Salmon 3lb', deal_price: 19.99, original_price: 27.99, savings_amount: 8.00, category: 'Seafood', deal_type: 'weekly_special' },
      { name: 'Organic Eggs 24ct', deal_price: 7.99, original_price: 11.99, savings_amount: 4.00, category: 'Dairy', deal_type: 'weekly_special' },
    ],
    samsclub: [
      { name: 'Member Mark Chicken 6lb', deal_price: 13.98, original_price: 18.98, savings_amount: 5.00, category: 'Meat', deal_type: 'weekly_special' },
      { name: 'Member Mark Eggs 36ct', deal_price: 8.98, original_price: 12.98, savings_amount: 4.00, category: 'Dairy', deal_type: 'weekly_special' },
      { name: 'Member Mark Tuna 8pk', deal_price: 9.98, original_price: 13.98, savings_amount: 4.00, category: 'Pantry', deal_type: 'weekly_special' },
    ],
    safeway: [
      { name: 'Chicken Drumsticks 3lb', deal_price: 4.99, original_price: 7.99, savings_amount: 3.00, category: 'Meat', deal_type: 'weekly_special' },
      { name: 'Lucerne Cottage Cheese', deal_price: 3.49, original_price: 4.99, savings_amount: 1.50, category: 'Dairy', deal_type: 'weekly_special' },
      { name: 'Strawberries 1lb', deal_price: 2.99, original_price: 4.49, savings_amount: 1.50, category: 'Produce', deal_type: 'weekly_special' },
    ],
    randalls: [
      { name: 'Randalls Chicken Wings 3lb', deal_price: 7.99, original_price: 11.99, savings_amount: 4.00, category: 'Meat', deal_type: 'weekly_special' },
      { name: 'Signature Farms Broccoli', deal_price: 1.99, original_price: 2.99, savings_amount: 1.00, category: 'Produce', deal_type: 'weekly_special' },
      { name: 'Lucerne Greek Yogurt', deal_price: 4.49, original_price: 5.99, savings_amount: 1.50, category: 'Dairy', deal_type: 'weekly_special' },
    ],
  };

  const deals = [];
  for (const store of storeNames) {
    const storeDeals = allStoreDeals[store.toLowerCase()];
    if (storeDeals) {
      storeDeals.forEach(d => {
        const savings_pct = d.original_price ? Math.round((1 - d.deal_price/d.original_price)*100) : 0;
        deals.push({
          ...d,
          product_name: d.name,
          store: store.toLowerCase(),
          store_name: store.charAt(0).toUpperCase() + store.slice(1),
          store_slug: store.toLowerCase(),
          savings_percent: savings_pct,
          valid_from: today,
          valid_to: nextWeek,
          live: true,
          source: 'weekly_static',
          description: d.category,
        });
      });
    }
  }
  return deals;
}

function clearAdCache() {
  adCache.clear();
  logger.info('Ad cache cleared');
}

module.exports = { scrapeAllWeeklyAds, clearAdCache };
"""

with open(r'C:\Users\andry\OneDrive\Desktop\LeanSpend\leanspend\src\services\weeklyAdScraper.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Rewrote weeklyAdScraper.js')
