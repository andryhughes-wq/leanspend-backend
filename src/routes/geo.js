'use strict';
const express = require('express');
const db      = require('../config/database');
const logger  = require('../utils/logger');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const geoRouter = express.Router();

// POST /api/deals/submit - logged-in user submits a price sighting
geoRouter.post('/submit', requireAuth, async (req, res, next) => {
  try {
    const { productName, brand, storeName, price, barcode, latitude, longitude, zip } = req.body || {};
    if (!productName || price == null) {
      return res.status(400).json({ error: 'productName and price are required' });
    }
    const result = await db.query(
      `INSERT INTO deal_submissions
         (user_id, product_name, brand, store_name, price, barcode, latitude, longitude, zip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, product_name, store_name, price, latitude, longitude, zip, status, created_at`,
      [req.user.id, productName, brand || null, storeName || null, parseFloat(price),
       barcode || null, latitude || null, longitude || null, zip || null]
    );
    res.status(201).json({ submission: result.rows[0] });
  } catch (err) { logger.error('Submit error:', err.message); next(err); }
});

// GET /api/deals/nearby?lat=&lng=&radius= - find submissions within radius (miles)
geoRouter.get('/nearby', async (req, res, next) => {
  try {
    const lat    = parseFloat(req.query.lat);
    const lng    = parseFloat(req.query.lng);
    const radius = parseFloat(req.query.radius) || 25;
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng query params are required' });
    }
    // Haversine distance in miles; 3959 = Earth radius in miles
    const result = await db.query(
      `SELECT id, product_name, brand, store_name, price, latitude, longitude, zip,
              confirmations, status, created_at,
              (3959 * acos(
                 cos(radians($1)) * cos(radians(latitude)) *
                 cos(radians(longitude) - radians($2)) +
                 sin(radians($1)) * sin(radians(latitude))
              )) AS distance_miles
       FROM deal_submissions
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
       HAVING (3959 * acos(
                 cos(radians($1)) * cos(radians(latitude)) *
                 cos(radians(longitude) - radians($2)) +
                 sin(radians($1)) * sin(radians(latitude))
              )) <= $3
       ORDER BY distance_miles ASC
       LIMIT 100`,
      [lat, lng, radius]
    );
    res.json({ count: result.rows.length, radius, deals: result.rows });
  } catch (err) { logger.error('Nearby error:', err.message); next(err); }
});

module.exports = { geoRouter };
