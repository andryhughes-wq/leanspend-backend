'use strict';
const axios   = require('axios');
const cheerio = require('cheerio');
const logger  = require('../utils/logger');

// Cache scraped ads in memory (refresh every 6 hours)
const adCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

function isCacheValid(key) {
  const entry = adCache.get(key);
  return entry && (Date.now() - entry.timestamp < CACHE_TTL);
}

function getHeaders(referer = 'https://www.google.com') {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer,
  };
}

// ─── FLIPP — aggregates weekly ads from 2000+ stores ─────────────────────────
async function fetchFlippDeals(storeNames = ['kroger','walmart','target','heb','aldi']) {
  const cacheKey = `flipp:${storeNames.join(',')}`;
  if (isCacheValid(cacheKey)) return adCache.get(cacheKey).data;

  try {
    const results = [];
    for (const store of storeNames) {
      const url = `https://flipp.com/flyers/${store}`;
      const resp = await axios.get(url, { headers: getHeaders('https://flipp.com'), timeout: 15000 });
      const $    = cheerio.load(resp.data);

      // Flipp uses JSON-LD for structured data
      $('script[type="application/ld+json"]').each((i, el) => {
        try {
          const data = JSON.parse($(el).html() || '{}');
          if (data['@type'] === 'ItemList') {
            (data.itemListElement || []).forEach(item => {
              if (item.item?.offers) {
                results.push({
                  name:        item.item.name,
                  store:       store,
                  dealPrice:   item.item.offers.price,
                  currency:    item.item.offers.priceCurrency || 'USD',
                  source:      'flipp',
                  scrapedAt:   new Date().toISOString(),
                });
              }
            });
          }
        } catch (_) {}
      });

      // Also grab visible deal tiles
      $('.flyer-item, .deal-item, [data-test="flyer-item"]').each((i, el) => {
        const name  = $(el).find('.item-name, h3, .name').first().text().trim();
        const price = $(el).find('.sale-price, .price, [data-test="price"]').first().text().trim();
        if (name && price) {
          results.push({
            name,
            store,
            dealPrice: parseFloat(price.replace(/[^0-9.]/g,'')),
            source: 'flipp-html',
            scrapedAt: new Date().toISOString(),
          });
        }
      });
    }

    adCache.set(cacheKey, { data: results, timestamp: Date.now() });
    logger.info(`Flipp: scraped ${results.length} deals`);
    return results;
  } catch (err) {
    logger.warn('Flipp scrape failed:', err.message);
    return [];
  }
}

// ─── KROGER — weekly digital ad ───────────────────────────────────────────────
async function scrapeKrogerAd() {
  const cacheKey = 'kroger:weekly-ad';
  if (isCacheValid(cacheKey)) return adCache.get(cacheKey).data;

  try {
    const resp = await axios.get('https://www.kroger.com/weeklyad', {
      headers: getHeaders('https://www.kroger.com'),
      timeout: 15000,
    });
    const $ = cheerio.load(resp.data);
    const deals = [];

    // Kroger embeds deal data as JSON in script tags
    $('script').each((i, el) => {
      const content = $(el).html() || '';
      if (content.includes('weeklyAd') || content.includes('salePrice')) {
        const matches = content.match(/"description":"([^"]+)","salePrice":([0-9.]+)/g);
        if (matches) {
          matches.forEach(m => {
            const desc  = m.match(/"description":"([^"]+)"/)?.[1];
            const price = m.match(/"salePrice":([0-9.]+)/)?.[1];
            if (desc && price) deals.push({ name: desc, store: 'kroger', dealPrice: parseFloat(price), source: 'kroger-script', scrapedAt: new Date().toISOString() });
          });
        }
      }
    });

    // Also try visible deal tiles
    $('[data-testid="weekly-ad-item"], .kds-Card, .weekly-ad-item').each((i, el) => {
      const name  = $(el).find('[data-testid="item-name"], .kds-Card-title, h3').first().text().trim();
      const price = $(el).find('[data-testid="sale-price"], .kds-Price').first().text().trim();
      if (name && name.length > 2) {
        deals.push({
          name,
          store: 'kroger',
          dealPrice: parseFloat(price.replace(/[^0-9.]/g,'')) || null,
          source: 'kroger-html',
          scrapedAt: new Date().toISOString(),
        });
      }
    });

    if (deals.length === 0) {
      // Fallback: try Kroger's JSON API endpoint
      const apiResp = await axios.get('https://www.kroger.com/atlas/v1/page-data?pageName=weeklyAd', {
        headers: { ...getHeaders('https://www.kroger.com'), Accept: 'application/json' },
        timeout: 10000,
      });
      (apiResp.data?.pageData?.deals || []).forEach(d => {
        deals.push({ name: d.title||d.description, store:'kroger', dealPrice: d.salePrice||d.price, source:'kroger-api', scrapedAt: new Date().toISOString() });
      });
    }

    adCache.set(cacheKey, { data: deals, timestamp: Date.now() });
    logger.info(`Kroger ad: scraped ${deals.length} deals`);
    return deals;
  } catch (err) {
    logger.warn('Kroger ad scrape failed:', err.message);
    return getFallbackDeals('kroger');
  }
}

// ─── WALMART — weekly rollbacks & specials ────────────────────────────────────
async function scrapeWalmartAd() {
  const cacheKey = 'walmart:weekly-ad';
  if (isCacheValid(cacheKey)) return adCache.get(cacheKey).data;

  try {
    const resp = await axios.get('https://www.walmart.com/cp/weekly-ad/1218425', {
      headers: getHeaders('https://www.walmart.com'),
      timeout: 15000,
    });
    const $ = cheerio.load(resp.data);
    const deals = [];

    // Walmart embeds product data in __NEXT_DATA__
    const nextData = $('script#__NEXT_DATA__').html();
    if (nextData) {
      try {
        const parsed = JSON.parse(nextData);
        const items  = parsed?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items || [];
        items.forEach(item => {
          if (item.priceInfo?.currentPrice?.price) {
            deals.push({
              name:          item.name,
              store:         'walmart',
              dealPrice:     item.priceInfo.currentPrice.price,
              originalPrice: item.priceInfo.wasPrice?.price,
              dealType:      item.priceInfo.priceDisplayCodes?.rollback ? 'rollback' : 'sale',
              source:        'walmart-next',
              scrapedAt:     new Date().toISOString(),
            });
          }
        });
      } catch (_) {}
    }

    // HTML fallback
    if (deals.length === 0) {
      $('[data-item-id], .search-result-gridview-item').each((i, el) => {
        const name  = $(el).find('[itemprop="name"], .product-title').first().text().trim();
        const price = $(el).find('[itemprop="price"], .price-main').first().attr('content') || $(el).find('.price-main').text();
        if (name) deals.push({ name, store:'walmart', dealPrice: parseFloat(String(price).replace(/[^0-9.]/g,'')), source:'walmart-html', scrapedAt: new Date().toISOString() });
      });
    }

    adCache.set(cacheKey, { data: deals, timestamp: Date.now() });
    logger.info(`Walmart ad: scraped ${deals.length} deals`);
    return deals;
  } catch (err) {
    logger.warn('Walmart ad scrape failed:', err.message);
    return getFallbackDeals('walmart');
  }
}

// ─── HEB — weekly specials ────────────────────────────────────────────────────
async function scrapeHebAd() {
  const cacheKey = 'heb:weekly-ad';
  if (isCacheValid(cacheKey)) return adCache.get(cacheKey).data;

  try {
    // HEB has a JSON API for their weekly specials
    const resp = await axios.get('https://www.heb.com/weekly-specials', {
      headers: getHeaders('https://www.heb.com'),
      timeout: 15000,
    });
    const $ = cheerio.load(resp.data);
    const deals = [];

    $('script[type="application/json"], script#__NEXT_DATA__').each((i, el) => {
      try {
        const data = JSON.parse($(el).html() || '{}');
        const findDeals = (obj) => {
          if (!obj || typeof obj !== 'object') return;
          if (obj.salePrice || obj.dealPrice) {
            deals.push({ name: obj.name||obj.title||obj.description, store:'heb', dealPrice: obj.salePrice||obj.dealPrice, originalPrice: obj.regularPrice, source:'heb-json', scrapedAt: new Date().toISOString() });
          }
          Object.values(obj).forEach(v => { if (typeof v === 'object') findDeals(v); });
        };
        findDeals(data);
      } catch (_) {}
    });

    // HTML fallback
    if (deals.length === 0) {
      $('[data-testid="product-tile"], .product-tile, .weekly-special-item').each((i, el) => {
        const name  = $(el).find('[data-testid="product-name"], .product-name, h3').first().text().trim();
        const price = $(el).find('[data-testid="product-price"], .sale-price').first().text().trim();
        if (name) deals.push({ name, store:'heb', dealPrice: parseFloat(price.replace(/[^0-9.]/g,'')), source:'heb-html', scrapedAt: new Date().toISOString() });
      });
    }

    adCache.set(cacheKey, { data: deals, timestamp: Date.now() });
    logger.info(`HEB ad: scraped ${deals.length} deals`);
    return deals;
  } catch (err) {
    logger.warn('HEB ad scrape failed:', err.message);
    return getFallbackDeals('heb');
  }
}

// ─── TARGET — weekly circle deals ────────────────────────────────────────────
async function scrapeTargetAd() {
  const cacheKey = 'target:weekly-ad';
  if (isCacheValid(cacheKey)) return adCache.get(cacheKey).data;

  try {
    const resp = await axios.get('https://www.target.com/c/weekly-ad/-/N-4sr7l', {
      headers: getHeaders('https://www.target.com'),
      timeout: 15000,
    });
    const $ = cheerio.load(resp.data);
    const deals = [];

    const nextData = $('script#__NEXT_DATA__').html();
    if (nextData) {
      try {
        const parsed = JSON.parse(nextData);
        const products = parsed?.props?.pageProps?.initialData?.data?.search?.products || [];
        products.forEach(p => {
          const price = p.price?.current_retail || p.price?.reg_retail;
          if (p.title && price) {
            deals.push({ name: p.title, store:'target', dealPrice: price, originalPrice: p.price?.reg_retail, source:'target-next', scrapedAt: new Date().toISOString() });
          }
        });
      } catch (_) {}
    }

    adCache.set(cacheKey, { data: deals, timestamp: Date.now() });
    logger.info(`Target ad: scraped ${deals.length} deals`);
    return deals;
  } catch (err) {
    logger.warn('Target ad scrape failed:', err.message);
    return getFallbackDeals('target');
  }
}

// ─── ALDI — weekly specials (ALDI Finds) ─────────────────────────────────────
async function scrapeAldiAd() {
  const cacheKey = 'aldi:weekly-ad';
  if (isCacheValid(cacheKey)) return adCache.get(cacheKey).data;

  try {
    const resp = await axios.get('https://www.aldi.us/en/weekly-specials/', {
      headers: getHeaders('https://www.aldi.us'),
      timeout: 15000,
    });
    const $ = cheerio.load(resp.data);
    const deals = [];

    $('.product-item, .js-product-article, [class*="product"]').each((i, el) => {
      const name  = $(el).find('h3, .product-title, [class*="title"]').first().text().trim();
      const price = $(el).find('.product-price, [class*="price"]').first().text().trim();
      if (name && name.length > 2) {
        deals.push({
          name, store:'aldi',
          dealPrice: parseFloat(price.replace(/[^0-9.]/g,'')) || null,
          source: 'aldi-html',
          scrapedAt: new Date().toISOString(),
        });
      }
    });

    adCache.set(cacheKey, { data: deals, timestamp: Date.now() });
    logger.info(`Aldi ad: scraped ${deals.length} deals`);
    return deals;
  } catch (err) {
    logger.warn('Aldi ad scrape failed:', err.message);
    return getFallbackDeals('aldi');
  }
}

// ─── Scrape ALL stores ────────────────────────────────────────────────────────
async function scrapeAllWeeklyAds(stores = ['kroger','walmart','heb','target','aldi']) {
  logger.info(`Scraping weekly ads for: ${stores.join(', ')}`);
  const results = { deals: [], errors: [], scrapedAt: new Date().toISOString() };

  const scrapers = {
    kroger:  scrapeKrogerAd,
    walmart: scrapeWalmartAd,
    heb:     scrapeHebAd,
    target:  scrapeTargetAd,
    aldi:    scrapeAldiAd,
  };

  await Promise.allSettled(
    stores.map(async store => {
      if (scrapers[store]) {
        try {
          const deals = await scrapers[store]();
          results.deals.push(...deals);
          logger.info(`✅ ${store}: ${deals.length} deals`);
        } catch (err) {
          results.errors.push({ store, error: err.message });
          logger.warn(`❌ ${store} failed:`, err.message);
        }
      }
    })
  );

  logger.info(`Weekly ad scrape complete: ${results.deals.length} total deals`);
  return results;
}

// ─── Fallback deals when scraping fails ──────────────────────────────────────
function getFallbackDeals(store) {
  const fallbacks = {
    kroger:  [
      { name:'Chicken Breast Boneless Skinless', store:'kroger', dealPrice:2.50, originalPrice:4.99, dealType:'bogo',     description:'BOGO Free', source:'fallback', scrapedAt: new Date().toISOString() },
      { name:'Large Eggs 12ct',                  store:'kroger', dealPrice:1.99, originalPrice:3.49, dealType:'sale',     description:'Weekly Special', source:'fallback', scrapedAt: new Date().toISOString() },
      { name:'Greek Yogurt 32oz',                store:'kroger', dealPrice:3.99, originalPrice:5.49, dealType:'sale',     description:'Weekly Special', source:'fallback', scrapedAt: new Date().toISOString() },
      { name:'Broccoli Crowns',                  store:'kroger', dealPrice:0.99, originalPrice:1.89, dealType:'sale',     description:'Produce Special', source:'fallback', scrapedAt: new Date().toISOString() },
    ],
    walmart: [
      { name:'Great Value Large Eggs 12ct',      store:'walmart', dealPrice:1.48, originalPrice:2.98, dealType:'rollback', description:'Rollback', source:'fallback', scrapedAt: new Date().toISOString() },
      { name:'Chicken Thighs Bone-in 4lb',       store:'walmart', dealPrice:4.98, originalPrice:6.48, dealType:'rollback', description:'Rollback', source:'fallback', scrapedAt: new Date().toISOString() },
      { name:'Great Value Brown Rice 5lb',        store:'walmart', dealPrice:2.48, originalPrice:3.48, dealType:'rollback', description:'Rollback', source:'fallback', scrapedAt: new Date().toISOString() },
    ],
    heb: [
      { name:'H-E-B Boneless Chicken Breast',    store:'heb', dealPrice:3.99, originalPrice:5.49, dealType:'weekly_special', description:'HEB Weekly', source:'fallback', scrapedAt: new Date().toISOString() },
      { name:'Hill Country Fare Eggs Large',      store:'heb', dealPrice:2.49, originalPrice:3.09, dealType:'weekly_special', description:'HEB Weekly', source:'fallback', scrapedAt: new Date().toISOString() },
      { name:'Sweet Potatoes',                    store:'heb', dealPrice:0.79, originalPrice:1.49, dealType:'weekly_special', description:'HEB Weekly', source:'fallback', scrapedAt: new Date().toISOString() },
    ],
    target: [
      { name:'Good & Gather Eggs 12ct',          store:'target', dealPrice:2.49, originalPrice:3.49, dealType:'circle_deal', description:'Target Circle', source:'fallback', scrapedAt: new Date().toISOString() },
      { name:'Oat Milk 3-pack',                  store:'target', dealPrice:6.99, originalPrice:9.99, dealType:'circle_deal', description:'Target Circle', source:'fallback', scrapedAt: new Date().toISOString() },
    ],
    aldi: [
      { name:'ALDI Chicken Breast 2lb',          store:'aldi', dealPrice:4.99, originalPrice:6.99, dealType:'weekly_find', description:'ALDI Finds', source:'fallback', scrapedAt: new Date().toISOString() },
      { name:'Fresh Atlantic Salmon',            store:'aldi', dealPrice:6.99, originalPrice:9.99, dealType:'weekly_find', description:'ALDI Finds', source:'fallback', scrapedAt: new Date().toISOString() },
    ],
  };
  return fallbacks[store] || [];
}

// ─── Get current ad status ────────────────────────────────────────────────────
function getAdCacheStatus() {
  const status = {};
  for (const [key, val] of adCache.entries()) {
    const ageMinutes = Math.round((Date.now() - val.timestamp) / 60000);
    status[key] = { items: val.data.length, ageMinutes, fresh: ageMinutes < 360 };
  }
  return status;
}

function clearAdCache() {
  adCache.clear();
  logger.info('Weekly ad cache cleared');
}

module.exports = {
  scrapeAllWeeklyAds,
  scrapeKrogerAd,
  scrapeWalmartAd,
  scrapeHebAd,
  scrapeTargetAd,
  scrapeAldiAd,
  fetchFlippDeals,
  getFallbackDeals,
  getAdCacheStatus,
  clearAdCache,
};
