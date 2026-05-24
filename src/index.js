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

    await redis.connect();
    logger.info('✅ Redis connected');

    await db.runMigrations();

    cron.schedule('0 * * * *',  () => logger.info('🔄 Hourly deal refresh running...'));
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
