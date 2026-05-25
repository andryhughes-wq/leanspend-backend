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
const redis     = require('./config/redis');
const { errorHandler } = require('./middleware/errorHandler');

const {
  budgetRouter, mealsRouter, dealsRouter, nutritionRouter,
  chatRouter, themeRouter, storesRouter, telegramRouter,
} = require('./routes/index');

const cron = require('node-cron');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(compression());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const limiter = rateLimit({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS) || 15*60*1000,
  max:      parseInt(process.env.API_RATE_LIMIT_MAX) || 100,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — slow down!' },
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
    logger.info('✅ PostgreSQL connected');

    try {
      await redis.connect();
      logger.info('✅ Redis connected');
    } catch(redisErr) {
      logger.warn('⚠️  Redis unavailable — app will run without caching');
    }

    try { await db.runMigrations(); } catch(e) { console.warn("Migration warning:", e.message); }

    // Initial Kroger sync on startup
    const krogerService = require('./services/krogerService');
    setTimeout(async () => {
      try {
        logger.info('🛒 Syncing live Kroger deals on startup...');
        await krogerService.syncDealsToDb(db);
      } catch(err) { logger.warn('Startup Kroger sync failed (non-fatal):', err.message); }
    }, 5000);

    // Kroger deal sync — every Wednesday at 6am (when Kroger resets weekly ads)
    cron.schedule('0 6 * * 3', async () => {
      logger.info('🛒 Wednesday Kroger weekly ad refresh starting...');
      try { await krogerService.syncDealsToDb(db); }
      catch(err) { logger.error('Kroger cron sync failed:', err.message); }
    });

    // Also refresh every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      logger.info('🔄 6-hour Kroger deal refresh...');
      try { await krogerService.syncDealsToDb(db); }
      catch(err) { logger.warn('6-hour sync failed:', err.message); }
    });

    cron.schedule('*/15 * * * *', async () => {
      try {
        await db.query(`UPDATE deals SET valid_to=CURRENT_DATE-1 WHERE valid_to<CURRENT_DATE AND valid_to>=CURRENT_DATE-INTERVAL '7 days'`);
      } catch(err) { logger.error('Deal cleanup error:', err.message); }
    });

    app.listen(PORT, () => {
      logger.info(`\n🥗💪 LeanSpend API is running!`);
      logger.info(`   URL:    http://localhost:${PORT}`);
      logger.info(`   Health: http://localhost:${PORT}/health`);
      logger.info(`   Tagline: ${process.env.APP_TAGLINE || 'Eat lean. Spend less. Live fit.'}\n`);
    });
  } catch (err) {
    logger.error('❌ Failed to start LeanSpend:', err.message);
    logger.error('   Check that PostgreSQL and Redis are running');
    logger.error('   Then check your .env file has DB_PASSWORD filled in');
    process.exit(1);
  }
}

process.on('SIGTERM', async () => { await db.disconnect(); await redis.disconnect(); process.exit(0); });

start();
module.exports = app;

