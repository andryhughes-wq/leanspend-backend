'use strict';
require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');

const logger    = require('./utils/logger');
const db        = require('./config/database');
const cookieParser = require('cookie-parser');
const redis     = require('./config/redis');
const { errorHandler } = require('./middleware/errorHandler');

const {
  budgetRouter, mealsRouter, dealsRouter, nutritionRouter,
  chatRouter, themeRouter, storesRouter, telegramRouter,
} = require('./routes/index');
const { authRouter } = require('./routes/auth');
const { geoRouter } = require('./routes/geo');

const cron = require('node-cron');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: function (origin, callback) {
    const allowed = ['https://leanandry.vercel.app', 'http://localhost:3000'];
    if (!origin || allowed.includes(origin)) return callback(null, true);
    try { if (/\.vercel\.app$/.test(new URL(origin).hostname)) return callback(null, true); } catch (e) {}
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(cookieParser());

// Map tile proxy: fetch CARTO dark tiles server-side so the browser only ever
// talks to our own origin (no CORS, no ad-blocker/DNS filter can break the map).
// Registered BEFORE the rate limiter so a map view's many tiles aren't throttled.
const TILE_SUBS = ['a', 'b', 'c', 'd'];
app.get('/api/tiles/:z/:x/:y', async (req, res) => {
  const { z, x, y } = req.params;
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}$/.test(y)) {
    return res.status(400).end();
  }
  try {
    const sub = TILE_SUBS[(parseInt(x, 10) + parseInt(y, 10)) % TILE_SUBS.length];
    const url = `https://${sub}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
    const r = await fetch(url, { headers: { 'User-Agent': 'LeanSpend/1.0 (+https://leanandry.vercel.app)' } });
    if (!r.ok) return res.status(502).end();
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    return res.send(buf);
  } catch (err) {
    logger.error('Tile proxy error:', err.message);
    return res.status(502).end();
  }
});

const limiter = rateLimit({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS) || 15*60*1000,
  max:      parseInt(process.env.API_RATE_LIMIT_MAX) || 100,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests â€” slow down!' },
});
app.use('/api', limiter);

app.get('/health', async (req, res) => {
  const dbOk    = await db.healthCheck();
  const redisOk = await redis.healthCheck();
  res.json({
    status:    dbOk && redisOk ? 'healthy' : 'degraded',
    app:       process.env.APP_NAME || 'LeanSpend',
    tagline:   process.env.APP_TAGLINE || 'Eat lean. Spend less. Live fit.',
    timestamp: new Date().toISOString(),
    services:  { database: dbOk ? 'up' : 'down', redis: redisOk ? 'up' : 'down' },
  });
});

app.use('/api/auth',        authRouter);
app.use('/api/deals',       geoRouter);
app.use('/api/budget',      budgetRouter);
app.use('/api/meals',       mealsRouter);
app.use('/api/deals',       dealsRouter);
app.use('/api/nutrition',   nutritionRouter);
app.use('/api/chat',        chatRouter);
app.use('/api/theme',       themeRouter);
app.use('/api/stores',      storesRouter);
app.use('/webhook/telegram', telegramRouter);

app.use((req, res) => res.status(404).json({ error: 'Route not found', app: 'LeanSpend API' }));
app.use(errorHandler);

async function start() {
  try {
    await db.connect();
    logger.info('âœ… PostgreSQL connected');

    try {
      await redis.connect();
      logger.info('âœ… Redis connected');
    } catch(redisErr) {
      logger.warn('âš ï¸  Redis unavailable â€” app will run without caching');
    }

    try { try { await db.runMigrations(); } catch(migErr) { console.warn("Migration warning:", migErr.message); } } catch(e) { console.warn("Migration warning:", e.message); }

    // Initial Kroger sync on startup
    const krogerService = require('./services/krogerService');
    setTimeout(async () => {
      try {
        logger.info('ðŸ›’ Syncing live Kroger deals on startup...');
        await krogerService.syncDealsToDb(db);
      } catch(err) { logger.warn('Startup Kroger sync failed (non-fatal):', err.message); }
    }, 5000);

    // Kroger deal sync â€” every Wednesday at 6am (when Kroger resets weekly ads)
    cron.schedule('0 6 * * 3', async () => {
      logger.info('ðŸ›’ Wednesday Kroger weekly ad refresh starting...');
      try { await krogerService.syncDealsToDb(db); }
      catch(err) { logger.error('Kroger cron sync failed:', err.message); }
    });

    // Also refresh every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      logger.info('ðŸ”„ 6-hour Kroger deal refresh...');
      try { await krogerService.syncDealsToDb(db); }
      catch(err) { logger.warn('6-hour sync failed:', err.message); }
    });

    cron.schedule('*/15 * * * *', async () => {
      try {
        await db.query(`UPDATE deals SET valid_to=CURRENT_DATE-1 WHERE valid_to<CURRENT_DATE AND valid_to>=CURRENT_DATE-INTERVAL '7 days'`);
      } catch(err) { logger.error('Deal cleanup error:', err.message); }
    });
    // Daily price snapshot - 11pm Central, after the day's deal refreshes
    cron.schedule('0 23 * * *', async () => {
      logger.info('Daily price snapshot starting...');
      try {
        const r = await db.query(`
          INSERT INTO deal_price_history (product_id, store_id, price, was_on_deal, deal_type, recorded_date)
          SELECT p.id, p.store_id, COALESCE(d.deal_price, p.unit_price), (d.id IS NOT NULL), d.deal_type, CURRENT_DATE
          FROM products p
          LEFT JOIN LATERAL (
            SELECT id, deal_price, deal_type FROM deals
            WHERE deals.product_id = p.id AND deals.store_id = p.store_id
              AND CURRENT_DATE BETWEEN deals.valid_from AND deals.valid_to
            ORDER BY deals.deal_price ASC LIMIT 1
          ) d ON true
          WHERE p.unit_price IS NOT NULL OR d.deal_price IS NOT NULL
          ON CONFLICT (product_id, store_id, recorded_date) DO UPDATE
            SET price = EXCLUDED.price, was_on_deal = EXCLUDED.was_on_deal, deal_type = EXCLUDED.deal_type
        `);
        logger.info('Daily price snapshot complete: ' + r.rowCount + ' rows');
      } catch (err) { logger.error('Daily price snapshot failed:', err.message); }
    }, { timezone: 'America/Chicago' });

    
// Daily deal refresh - runs at 6am every day
const adScraper = require('./services/weeklyAdScraper');
cron.schedule('0 6 * * *', async () => {
  logger.info('Daily deal refresh starting...');
  try {
    adScraper.clearAdCache();
    const ALL_STORES = ['kroger','walmart','heb','target','aldi','costco','samsclub','safeway','randalls'];
    await adScraper.scrapeAllWeeklyAds(ALL_STORES);
    logger.info('Daily deal refresh complete');
  } catch (err) {
    logger.error('Daily deal refresh failed:', err.message);
  }
}, { timezone: 'America/Chicago' });

app.listen(PORT, () => {
      logger.info(`\nðŸ¥—ðŸ’ª LeanSpend API is running!`);
      logger.info(`   URL:    http://localhost:${PORT}`);
      logger.info(`   Health: http://localhost:${PORT}/health`);
      logger.info(`   Tagline: ${process.env.APP_TAGLINE || 'Eat lean. Spend less. Live fit.'}\n`);
    });
  } catch (err) {
    logger.error('Failed to start LeanSpend:', err.message, err.stack);
    logger.error('   Check that PostgreSQL and Redis are running');
    logger.error('   Then check your .env file has DB_PASSWORD filled in');
    process.exit(1);
  }
}

process.on('SIGTERM', async () => { await db.disconnect(); await redis.disconnect(); process.exit(0); });

start();
module.exports = app;

