#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { execSync } = require('child_process');
const fs           = require('fs');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[34m', X = '\x1b[0m', BOLD = '\x1b[1m';
const ok   = m => console.log(`${G}  ✅ ${m}${X}`);
const fail = m => console.log(`${R}  ❌ ${m}${X}`);
const warn = m => console.log(`${Y}  ⚠️  ${m}${X}`);
const info = m => console.log(`${B}     ${m}${X}`);
const bold = m => console.log(`${BOLD}${m}${X}`);

console.log('\n');
bold('╔══════════════════════════════════════════╗');
bold('║      LeanSpend Setup Checker  💪🥗       ║');
bold('╚══════════════════════════════════════════╝');
console.log('');

let issues = 0;

// Node version
const nodeMajor = parseInt(process.version.slice(1).split('.')[0]);
if (nodeMajor >= 18) { ok(`Node.js ${process.version}`); }
else { fail(`Node.js ${process.version} is too old — need v18+`); info('Download: https://nodejs.org'); issues++; }

// .env file
if (!fs.existsSync('.env')) {
  fail('.env file not found!');
  info('The .env file should be in your leanspend folder');
  issues++;
} else {
  ok('.env file found');

  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY.trim() === '') {
    fail('GROQ_API_KEY is empty in .env');
    info('Get free key at: https://console.groq.com');
    info('Sign up → API Keys → Create Key → paste in .env as GROQ_API_KEY=gsk_...');
    issues++;
  } else if (process.env.GROQ_API_KEY.startsWith('gsk_')) {
    ok('GROQ_API_KEY is set');
  } else {
    warn('GROQ_API_KEY looks wrong — should start with gsk_');
  }

  if (!process.env.DB_PASSWORD || process.env.DB_PASSWORD.trim() === '') {
    fail('DB_PASSWORD is empty in .env');
    info('Add your PostgreSQL password to .env as DB_PASSWORD=yourpassword');
    issues++;
  } else {
    ok('DB_PASSWORD is set');
  }
}

// PostgreSQL
try {
  execSync('psql --version', { stdio: 'ignore' });
  ok('PostgreSQL is installed');
} catch {
  fail('PostgreSQL not found');
  info('Download: https://www.postgresql.org/download/windows/');
  issues++;
}

// Redis
try {
  const out = execSync('redis-cli ping', { stdio: 'pipe', timeout: 3000 }).toString().trim();
  if (out === 'PONG') { ok('Redis is running'); }
  else { warn('Redis installed but not running — start redis-server.exe'); }
} catch {
  warn('Redis not found or not running');
  info('Windows download: https://github.com/microsoftarchive/redis/releases');
  info('Download the .msi file, install it, then run redis-server.exe');
}

// node_modules
if (fs.existsSync('node_modules')) { ok('Dependencies installed (node_modules found)'); }
else { warn('Dependencies not installed — run: npm install'); }

console.log('');
bold('─────────────────────────────────────────────');
if (issues === 0) {
  bold(`${G}🎉 All good! Run these commands:${X}`);
  console.log('');
  console.log(`  ${B}1. npm install${X}`);
  console.log(`  ${B}2. Set up PostgreSQL database (see README)${X}`);
  console.log(`  ${B}3. npm run seed${X}`);
  console.log(`  ${B}4. npm run dev${X}`);
} else {
  bold(`${Y}Fix the ${issues} issue(s) above, then run: node setup.js again${X}`);
}
bold('─────────────────────────────────────────────');
console.log('');
