'use strict';
const Redis  = require('ioredis');
const logger = require('../utils/logger');

let client;
let redisAvailable = false;

function getClient() {
  if (!client) {
    // Support both REDIS_URL (Railway) and individual vars (local)
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
      client = new Redis(redisUrl, {
        retryStrategy: times => Math.min(times * 500, 5000),
        lazyConnect:   true,
        maxRetriesPerRequest: 1,
      });
    } else {
      client = new Redis({
        host:          process.env.REDIS_HOST || 'localhost',
        port:          parseInt(process.env.REDIS_PORT) || 6379,
        password:      process.env.REDIS_PASSWORD || undefined,
        retryStrategy: times => Math.min(times * 500, 5000),
        lazyConnect:   true,
        maxRetriesPerRequest: 1,
      });
    }

    client.on('error', err => {
      logger.warn('Redis unavailable — running without cache:', err.message);
      redisAvailable = false;
    });
    client.on('connect', () => {
      logger.info('✅ Redis connected');
      redisAvailable = true;
    });
  }
  return client;
}

async function connect() {
  try {
    await getClient().connect();
    redisAvailable = true;
  } catch (err) {
    logger.warn('Redis connect failed — continuing without cache:', err.message);
    redisAvailable = false;
  }
}

async function disconnect() {
  if (client) { try { await client.quit(); } catch(_) {} }
}

async function healthCheck() {
  try { await getClient().ping(); return true; } catch { return false; }
}

const TTL = 60 * 60;

async function get(key) {
  if (!redisAvailable) return null;
  try {
    const v = await getClient().get(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

async function set(key, val, ttl=TTL) {
  if (!redisAvailable) return;
  try { await getClient().setex(key, ttl, JSON.stringify(val)); } catch(_) {}
}

async function del(key) {
  if (!redisAvailable) return;
  try { await getClient().del(key); } catch(_) {}
}

async function getOrSet(key, fn, ttl=TTL) {
  const c = await get(key);
  if (c !== null) return c;
  const f = await fn();
  await set(key, f, ttl);
  return f;
}

const keys = {
  activeDeals:      date    => `ls:deals:active:${date}`,
  productNutrition: id      => `ls:nutrition:${id}`,
  krogerToken:      ()      => 'ls:kroger:token',
  walmartToken:     ()      => 'ls:walmart:token',
  mealPlan:         (u,y,m) => `ls:mealplan:${u}:${y}:${m}`,
  productSearch:    (q,s)   => `ls:search:${s}:${q}`,
  userTheme:        id      => `ls:theme:${id}`,
};

module.exports = { connect, disconnect, healthCheck, get, set, del, getOrSet, keys };
