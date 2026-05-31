'use strict';
const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const db      = require('../config/database');
const logger  = require('../utils/logger');

const authRouter = express.Router();
const JWT_SECRET  = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TOKEN_DAYS  = 30;

function signToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_DAYS + 'd' });
}

function cookieOpts() {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge:   TOKEN_DAYS * 24 * 60 * 60 * 1000,
    path:     '/',
  };
}

function isEmail(s) { return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }

// POST /api/auth/register
authRouter.post('/register', async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!isEmail(email))                 return res.status(400).json({ error: 'Valid email required' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await db.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with that email already exists' });

    const hash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1,$2,$3)
       RETURNING id, email, name, created_at`,
      [email.toLowerCase(), hash, displayName || null]
    );
    const user  = result.rows[0];
    const token = signToken(user);
    res.cookie('ls_token', token, cookieOpts());
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name }, token });
  } catch (err) { logger.error('Register error:', err.message); next(err); }
});

// POST /api/auth/login
authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!isEmail(email) || !password) return res.status(400).json({ error: 'Email and password required' });

    const result = await db.query('SELECT id, email, name, password_hash FROM users WHERE email=$1', [email.toLowerCase()]);
    const user   = result.rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken(user);
    res.cookie('ls_token', token, cookieOpts());
    res.json({ user: { id: user.id, email: user.email, name: user.name }, token });
  } catch (err) { logger.error('Login error:', err.message); next(err); }
});

// GET /api/auth/me
authRouter.get('/me', async (req, res) => {
  try {
    const bearer = (req.headers.authorization || '').replace('Bearer ', '');
    const token  = req.cookies?.ls_token || bearer;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const payload = jwt.verify(token, JWT_SECRET);
    const result  = await db.query('SELECT id, email, name, created_at FROM users WHERE id=$1', [payload.uid]);
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
});

// POST /api/auth/logout
authRouter.post('/logout', (req, res) => {
  res.clearCookie('ls_token', { path: '/' });
  res.json({ ok: true });
});

module.exports = { authRouter };
