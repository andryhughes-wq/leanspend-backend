'use strict';
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

// Hard guard: rejects the request if no valid token. Use on protected routes.
function requireAuth(req, res, next) {
  try {
    const bearer = (req.headers.authorization || '').replace('Bearer ', '');
    const token  = (req.cookies && req.cookies.ls_token) || bearer;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.uid, email: payload.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Soft attach: sets req.user if a valid token exists, but never blocks. Use on
// routes that behave differently for logged-in vs anonymous users.
function optionalAuth(req, res, next) {
  try {
    const bearer = (req.headers.authorization || '').replace('Bearer ', '');
    const token  = (req.cookies && req.cookies.ls_token) || bearer;
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = { id: payload.uid, email: payload.email };
    }
  } catch (_) { /* ignore bad token, treat as anonymous */ }
  next();
}

module.exports = { requireAuth, optionalAuth };
