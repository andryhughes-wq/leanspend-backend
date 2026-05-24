# 💪🥗 LeanSpend — Eat Lean. Spend Less. Live Fit.

Fitness-focused grocery budgeting with AI meal planning, live store deals, and nutrition tracking.

---

## Windows Setup Guide — Step by Step

### Step 1 — Install Node.js
1. Go to **https://nodejs.org**
2. Click the big green **LTS** button to download
3. Run the installer — click Next through everything, keep all defaults
4. When done, open Command Prompt and run: `node --version`
5. You should see something like `v20.x.x` ✅

---

### Step 2 — Install PostgreSQL
1. Go to **https://www.postgresql.org/download/windows/**
2. Click **Download the installer**
3. Run the installer:
   - Keep default port **5432**
   - Set a password for the `postgres` user — **write this down!**
   - Keep all other defaults
4. When done, search your Start menu for **"SQL Shell (psql)"** and open it
5. Press Enter 4 times to accept the defaults (host, database, port, username)
6. Type your password when prompted
7. Run these commands one at a time (copy and paste each line):
```sql
CREATE DATABASE leanspend;
CREATE USER leanspend_user WITH PASSWORD 'leanspend123';
GRANT ALL PRIVILEGES ON DATABASE leanspend TO leanspend_user;
ALTER DATABASE leanspend OWNER TO leanspend_user;
\q
```
8. Your DB password is: `leanspend123` (or whatever you chose)

---

### Step 3 — Install Redis
1. Go to **https://github.com/microsoftarchive/redis/releases**
2. Download **Redis-x64-3.0.504.msi** (the .msi file)
3. Run the installer — keep all defaults, check **"Add to PATH"**
4. Redis will start automatically as a Windows service
5. Test it: open Command Prompt and run `redis-cli ping`
6. You should see `PONG` ✅

---

### Step 4 — Fill in your .env file
Open the `.env` file in the `leanspend` folder with Notepad and fill in:
```
DB_PASSWORD=leanspend123
```
The GROQ_API_KEY is already filled in for you.
Everything else is optional for now.

---

### Step 5 — Run the setup checker
Open Command Prompt **in the leanspend folder** and run:
```cmd
node setup.js
```
It will tell you if anything is missing.

---

### Step 6 — Install dependencies and start
```cmd
npm install
npm run seed
npm run dev
```

Open your browser and go to: **http://localhost:3001/health**

If you see `"status": "healthy"` — you're done! 🎉

---

## API Endpoints

| Method | URL | What it does |
|--------|-----|-------------|
| GET | /health | Check server status |
| POST | /api/budget/calculate | Calculate food budget |
| POST | /api/meals/generate | AI 30-day meal plan |
| GET | /api/deals/active | Current store deals |
| GET | /api/deals/calendar | Deals by date |
| GET | /api/nutrition/search | Search USDA foods |
| GET | /api/nutrition/benefits | Ingredient health info |
| POST | /api/chat | AI chatbot |
| POST | /api/theme/save | Save color theme |
| GET | /api/theme/load/:userId | Load saved theme |

---

## Troubleshooting

**"Cannot connect to database"**
→ Make sure DB_PASSWORD in .env matches what you set in Step 2
→ Make sure PostgreSQL service is running (search "Services" in Start menu)

**"Cannot connect to Redis"**
→ Search "Services" in Start menu → find "Redis" → click Start

**"AI error" when generating meal plan**
→ Check GROQ_API_KEY in .env — go to https://console.groq.com for a new key

**Port 3001 already in use**
→ Change `PORT=3001` to `PORT=3002` in .env
