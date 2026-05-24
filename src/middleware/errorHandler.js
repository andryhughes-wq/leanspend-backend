'use strict';
const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('Error:', err.message);
  if (err.response) return res.status(502).json({ error: 'External API error', detail: err.response.data?.message || err.message });
  if (err.message?.includes('429') || err.message?.includes('rate')) {
    return res.status(429).json({ error: 'AI is busy — wait 30 seconds and try again.', reply: "Give me 30 seconds and I'll be right back! 💪" });
  }
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
}

module.exports = { errorHandler };
