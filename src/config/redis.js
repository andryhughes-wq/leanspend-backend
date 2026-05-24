'use strict';
const Redis  = require('ioredis');
const logger = require('../utils/logger');

let client;

function getClient() {
  if (!client) {
    client = new Redis({
      host:          process.env.REDIS_HOST || 'localhost',
      port:          parseInt(process.env.REDIS_PORT) || 6379,
      password:      process.env.REDIS_PASSWORD || undefined,
      retryStrategy: times => Math.min(times * 100, 3000),
      lazyConnect:   true,
    });
    client.on('error', err => logger.error('Redis error:', err.message));
  }
  return client;
}

async function connect()    { await getClient().connect(); }
async function disconnect() { if (client) await client.quit(); }
async function healthCheck() {
  try { await getClient().ping(); return true; } catch { return false; }
}

const TTL = 60 * 60;
async function get(key)              { const v = await getClient().get(key); return v ? JSON.parse(v) : null; }
async function set(key, val, ttl=TTL){ await getClient().setex(key, ttl, JSON.stringify(val)); }
async function del(key)              { await getClient().del(key); }
async function getOrSet(key, fn, ttl=TTL) {
  const c = await get(key); if (c !== null) return c;
  const f = await fn(); await set(key, f, ttl); return f;
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
