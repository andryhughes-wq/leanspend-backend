'use strict';
const { Pool } = require('pg');
const logger   = require('../utils/logger');

// Support DATABASE_URL (Railway) or individual vars (local)
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'leanspend',
      user:     process.env.DB_USER     || 'leanspend_user',
      password: process.env.DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

pool.on('error', err => logger.error('PostgreSQL pool error:', err.message));

pool.on('error', err => logger.error('PostgreSQL pool error:', err.message));

const MIGRATIONS = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE,
  name VARCHAR(255),
  monthly_income DECIMAL(10,2),
  food_budget DECIMAL(10,2),
  fitness_goal VARCHAR(50) DEFAULT 'balanced',
  allergies TEXT[] DEFAULT '{}',
  dye_filters TEXT[] DEFAULT '{}',
  preferred_stores TEXT[] DEFAULT '{}',
  household_size INT DEFAULT 1,
  theme_color VARCHAR(7) DEFAULT '#6BCB77',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  api_type VARCHAR(30),
  website_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id INT REFERENCES stores(id),
  store_product_id VARCHAR(255),
  upc VARCHAR(30),
  name VARCHAR(500) NOT NULL,
  brand VARCHAR(255),
  category VARCHAR(100),
  unit_price DECIMAL(10,2),
  unit_size VARCHAR(50),
  image_url TEXT,
  contains_allergens TEXT[] DEFAULT '{}',
  contains_dyes TEXT[] DEFAULT '{}',
  calories_per_serving INT,
  protein_g DECIMAL(6,2),
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, store_product_id)
);

CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  store_id INT REFERENCES stores(id),
  deal_type VARCHAR(50),
  original_price DECIMAL(10,2),
  deal_price DECIMAL(10,2),
  savings_amount DECIMAL(10,2),
  savings_percent DECIMAL(5,2),
  deal_description TEXT,
  valid_from DATE NOT NULL,
  valid_to DATE NOT NULL,
  source VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deal_price_history (
  id SERIAL PRIMARY KEY,
  product_id UUID REFERENCES products(id),
  store_id INT REFERENCES stores(id),
  price DECIMAL(10,2) NOT NULL,
  was_on_deal BOOLEAN DEFAULT false,
  deal_type VARCHAR(50),
  recorded_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meal_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  month INT NOT NULL,
  year INT NOT NULL,
  total_budget DECIMAL(10,2),
  total_cost_without_deals DECIMAL(10,2),
  total_cost_with_deals DECIMAL(10,2),
  total_savings DECIMAL(10,2),
  avg_daily_calories INT,
  avg_daily_protein_g DECIMAL(6,2),
  avg_daily_fiber_g DECIMAL(6,2),
  fitness_focus VARCHAR(50),
  ai_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id UUID REFERENCES meal_plans(id),
  meal_date DATE NOT NULL,
  meal_type VARCHAR(20) NOT NULL,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  total_cost DECIMAL(10,2),
  total_calories INT,
  total_protein_g DECIMAL(6,2),
  total_carbs_g DECIMAL(6,2),
  total_fat_g DECIMAL(6,2),
  total_fiber_g DECIMAL(6,2),
  uses_deal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_valid_range  ON deals(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_deals_store        ON deals(store_id);
CREATE INDEX IF NOT EXISTS idx_products_store     ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_meals_plan_date    ON meals(meal_plan_id, meal_date);
CREATE INDEX IF NOT EXISTS idx_meal_plans_user    ON meal_plans(user_id, year, month);

INSERT INTO stores (slug, name, api_type, website_url) VALUES
  ('kroger',     'Kroger',      'official_api', 'https://www.kroger.com'),
  ('walmart',    'Walmart',     'official_api', 'https://www.walmart.com'),
  ('heb',        'HEB',         'scraper',      'https://www.heb.com'),
  ('target',     'Target',      'scraper',      'https://www.target.com'),
  ('aldi',       'Aldi',        'scraper',      'https://www.aldi.us'),
  ('wholefoods', 'Whole Foods', 'scraper',      'https://www.wholefoodsmarket.com'),
  ('sprouts',    'Sprouts',     'scraper',      'https://www.sprouts.com'),
  ('randalls',   'Randalls',    'scraper',      'https://www.randalls.com'),
  ('safeway',    'Safeway',     'scraper',      'https://www.safeway.com'),
  ('costco',     'Costco',      'scraper',      'https://www.costco.com'),
  ('samsclub',   "Sams Club",  'scraper',      'https://www.samsclub.com')
ON CONFLICT (slug) DO NOTHING;
`;

async function connect()       { await pool.query('SELECT 1'); }
async function disconnect()    { await pool.end(); }
async function runMigrations() { await pool.query(MIGRATIONS); logger.info('✅ LeanSpend database schema ready'); }
async function healthCheck()   { try { await pool.query('SELECT 1'); return true; } catch { return false; } }

async function query(text, params) {
  try { return await pool.query(text, params); }
  catch (err) { logger.error('DB error:', err.message); throw err; }
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { connect, disconnect, runMigrations, healthCheck, query, transaction, pool };
