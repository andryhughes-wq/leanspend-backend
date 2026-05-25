'use strict';
const express   = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const aiService   = require('../services/aiService');
const usdaService = require('../services/usdaService');
const db          = require('../config/database');
const redis       = require('../config/redis');
const logger      = require('../utils/logger');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// ─── BUDGET ───────────────────────────────────────────────────────────────────
const budgetRouter = express.Router();

budgetRouter.post('/calculate',
  body('monthlyIncome').isFloat({ min: 100 }),
  body('householdSize').optional().isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const { monthlyIncome, householdSize=1, zipCode, fitnessGoal='balanced' } = req.body;
      const cacheKey = `ls:budget:${monthlyIncome}:${householdSize}:${fitnessGoal}`;
      const cached   = await redis.get(cacheKey);
      if (cached) return res.json(cached);

      const breakdown = await aiService.calculateBudgetBreakdown({ monthlyIncome, householdSize, zipCode, fitnessGoal });
      const result    = {
        ...breakdown,
        monthlyIncome, householdSize,
        perDay:  parseFloat((breakdown.recommendedFoodBudget/30).toFixed(2)),
        perMeal: parseFloat((breakdown.recommendedFoodBudget/90).toFixed(2)),
        generatedAt: new Date().toISOString(),
      };
      await redis.set(cacheKey, result, 60*60*24);
      res.json(result);
    } catch(err) { next(err); }
  }
);

budgetRouter.post('/users',
  body('monthlyIncome').isFloat({ min: 0 }),
  validate,
  async (req, res, next) => {
    try {
      const { monthlyIncome, allergies=[], dyeFilters=[], preferredStores=[], householdSize=1, telegramId, fitnessGoal='balanced', themeColor } = req.body;
      const pct        = monthlyIncome < 2000 ? 0.18 : monthlyIncome < 4000 ? 0.14 : 0.12;
      const foodBudget = parseFloat((monthlyIncome*pct).toFixed(2));
      const result     = await db.query(`
        INSERT INTO users (monthly_income, food_budget, allergies, dye_filters, preferred_stores, household_size, telegram_id, fitness_goal, theme_color)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (telegram_id) DO UPDATE SET
          monthly_income=$1, food_budget=$2, allergies=$3, dye_filters=$4,
          preferred_stores=$5, household_size=$6, fitness_goal=$8,
          theme_color=COALESCE($9, users.theme_color), updated_at=NOW()
        RETURNING *
      `, [monthlyIncome, foodBudget, allergies, dyeFilters, preferredStores, householdSize, telegramId, fitnessGoal, themeColor||'#6BCB77']);
      res.status(201).json(result.rows[0]);
    } catch(err) { next(err); }
  }
);

budgetRouter.get('/users/:id', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch(err) { next(err); }
});

// ─── MEALS ────────────────────────────────────────────────────────────────────
const mealsRouter = express.Router();

mealsRouter.post('/generate',
  body('monthlyIncome').isFloat({ min: 0 }),
  body('foodBudget').isFloat({ min: 0 }),
  body('month').isInt({ min:1, max:12 }),
  body('year').isInt({ min:2024, max:2030 }),
  validate,
  async (req, res, next) => {
    try {
      const { userId, monthlyIncome, foodBudget, allergies=[], dyeFilters=[], preferredStores=[], householdSize=1, month, year, fitnessGoal='balanced' } = req.body;

      let activeDeals = [];
      try {
        const r = await db.query(`
          SELECT p.name, s.slug as store, d.deal_price as "salePrice", d.original_price as "unitPrice", d.savings_amount as "savingsAmount"
          FROM deals d JOIN products p ON p.id=d.product_id JOIN stores s ON s.id=d.store_id
          WHERE d.valid_from<=CURRENT_DATE AND d.valid_to>=CURRENT_DATE ORDER BY d.savings_amount DESC NULLS LAST LIMIT 30
        `);
        activeDeals = r.rows;
      } catch(_) {}

      const plan = await aiService.generateMealPlan({ monthlyIncome, foodBudget, allergies, dyeFilters, householdSize, preferredStores, activeDeals, month, year, fitnessGoal });

      let mealPlanId = null;
      if (userId) {
        const planRow = await db.query(`
          INSERT INTO meal_plans (user_id,month,year,total_budget,total_cost_without_deals,total_cost_with_deals,total_savings,avg_daily_calories,avg_daily_protein_g,avg_daily_fiber_g,fitness_focus,ai_notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
        `, [userId,month,year,foodBudget,plan.totalCostWithoutDeals,plan.totalEstimatedCost,plan.totalSavings,plan.avgDailyCalories,plan.avgDailyProteinG,plan.avgDailyFiberG,fitnessGoal,JSON.stringify({shoppingList:plan.shoppingList})]);
        mealPlanId = planRow.rows[0].id;

        for (const day of plan.days||[]) {
          for (const meal of day.meals||[]) {
            await db.query(`
              INSERT INTO meals (meal_plan_id,meal_date,meal_type,name,description,total_cost,total_calories,total_protein_g,total_carbs_g,total_fat_g,total_fiber_g,uses_deal)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            `, [mealPlanId,day.date,meal.type,meal.name,meal.description,meal.cost,meal.calories,meal.proteinG,meal.carbsG,meal.fatG,meal.fiberG,meal.usesDeals]);
          }
        }
      }
      res.json({ mealPlanId, plan, generatedAt: new Date().toISOString() });
    } catch(err) { next(err); }
  }
);

mealsRouter.get('/plan/:userId', async (req, res, next) => {
  try {
    const month = parseInt(req.query.month)||new Date().getMonth()+1;
    const year  = parseInt(req.query.year)||new Date().getFullYear();
    const result = await db.query(`
      SELECT mp.*, json_agg(json_build_object('id',m.id,'date',m.meal_date,'type',m.meal_type,'name',m.name,'cost',m.total_cost,'calories',m.total_calories,'protein',m.total_protein_g,'usesDeals',m.uses_deal) ORDER BY m.meal_date,m.meal_type) as meals
      FROM meal_plans mp LEFT JOIN meals m ON m.meal_plan_id=mp.id
      WHERE mp.user_id=$1 AND mp.month=$2 AND mp.year=$3 GROUP BY mp.id LIMIT 1
    `, [req.params.userId, month, year]);
    if (!result.rows.length) return res.status(404).json({ error: 'No meal plan found for this month' });
    res.json(result.rows[0]);
  } catch(err) { next(err); }
});

mealsRouter.get('/day/:userId', async (req, res, next) => {
  try {
    const date   = req.query.date||new Date().toISOString().split('T')[0];
    const result = await db.query(`
      SELECT m.* FROM meals m JOIN meal_plans mp ON mp.id=m.meal_plan_id
      WHERE mp.user_id=$1 AND m.meal_date=$2
      ORDER BY CASE m.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END
    `, [req.params.userId, date]);
    res.json({ date, meals: result.rows });
  } catch(err) { next(err); }
});

// ─── DEALS ────────────────────────────────────────────────────────────────────
const dealsRouter = express.Router();

dealsRouter.get('/active', async (req, res, next) => {
  try {
    const { store, limit=50 } = req.query;
    const today    = new Date().toISOString().split('T')[0];
    const cacheKey = `ls:deals:${today}:${store||'all'}`;
    const cached   = await redis.get(cacheKey);
    if (cached) return res.json(cached);

    let q = `SELECT d.id,d.deal_type,d.original_price,d.deal_price,d.savings_amount,d.savings_percent,d.deal_description,d.valid_from,d.valid_to,p.name as product_name,p.brand,p.category,p.image_url,s.slug as store_slug,s.name as store_name FROM deals d JOIN products p ON p.id=d.product_id JOIN stores s ON s.id=d.store_id WHERE d.valid_from<=CURRENT_DATE AND d.valid_to>=CURRENT_DATE`;
    const params = [];
    if (store) { q += ` AND s.slug=$1`; params.push(store); }
    q += ` ORDER BY d.savings_amount DESC NULLS LAST LIMIT ${parseInt(limit)}`;
    const result = await db.query(q, params);
    const data   = { deals: result.rows, count: result.rows.length, fetchedAt: new Date().toISOString() };
    await redis.set(cacheKey, data, 60*30);
    res.json(data);
  } catch(err) { next(err); }
});

dealsRouter.get('/calendar', async (req, res, next) => {
  try {
    const month = parseInt(req.query.month)||new Date().getMonth()+1;
    const year  = parseInt(req.query.year)||new Date().getFullYear();
    const result = await db.query(`
      SELECT d.valid_from,d.valid_to,d.deal_price,d.savings_amount,d.deal_type,d.deal_description,p.name as product_name,p.brand,s.slug as store_slug,s.name as store_name
      FROM deals d JOIN products p ON p.id=d.product_id JOIN stores s ON s.id=d.store_id
      WHERE EXTRACT(MONTH FROM d.valid_from)=$1 AND EXTRACT(YEAR FROM d.valid_from)=$2
      ORDER BY d.valid_from ASC, d.savings_amount DESC NULLS LAST
    `, [month, year]);
    const calendar = {};
    for (const deal of result.rows) {
      const key = new Date(deal.valid_from).toISOString().split('T')[0];
      if (!calendar[key]) calendar[key] = [];
      calendar[key].push(deal);
    }
    res.json({ month, year, calendar, totalDeals: result.rows.length });
  } catch(err) { next(err); }
});

// ─── NUTRITION ────────────────────────────────────────────────────────────────
const nutritionRouter = express.Router();
nutritionRouter.get('/search',     async (req,res,next) => { try { const {q,dataType='Branded',limit=10}=req.query; if(!q) return res.status(400).json({error:'q required'}); res.json({ results: await usdaService.searchFood(q,dataType,parseInt(limit)), query:q }); } catch(err){next(err);} });
nutritionRouter.get('/facts/:id',  async (req,res,next) => { try { const c=redis.keys.productNutrition(req.params.id); const cached=await redis.get(c); if(cached) return res.json(cached); const facts=await usdaService.getFoodById(req.params.id); await redis.set(c,facts,60*60*24*7); res.json(facts); } catch(err){next(err);} });
nutritionRouter.get('/upc/:upc',   async (req,res,next) => { try { const r=await usdaService.searchByUpc(req.params.upc); if(!r) return res.status(404).json({error:'Not found'}); res.json(r); } catch(err){next(err);} });
nutritionRouter.get('/benefits',   async (req,res,next) => { try { const {ingredient}=req.query; if(!ingredient) return res.status(400).json({error:'ingredient required'}); res.json({ ingredient, benefits: await usdaService.getIngredientBenefits(ingredient) }); } catch(err){next(err);} });
nutritionRouter.get('/allergens',  async (req,res,next) => { try { const {ingredients}=req.query; if(!ingredients) return res.status(400).json({error:'ingredients required'}); const detected=usdaService.detectAllergens({ingredients}); const DYES=['red_40','yellow_5','yellow_6','blue_1','blue_2','red_3']; res.json({ ingredients:ingredients.split(','), detectedAllergens:detected.filter(a=>!DYES.includes(a)), detectedDyes:detected.filter(a=>DYES.includes(a)), isSafe:detected.length===0 }); } catch(err){next(err);} });

// ─── CHAT ─────────────────────────────────────────────────────────────────────
const chatRouter = express.Router();
const chatLimiter = rateLimit({ windowMs:60*1000, max:20, message:{error:'Too many messages — wait a moment.',reply:"Catching my breath! Try again in 30 seconds. 💪"} });
chatRouter.post('/', chatLimiter, async (req,res,next) => {
  try {
    const {message,history=[],context,userContext}=req.body;
    if (!message||typeof message!=='string') return res.status(400).json({error:'message required'});
    if (message.length>500) return res.status(400).json({error:'Message too long'});
    const result = await aiService.chat(message,history,context,userContext); res.json(typeof result === "string" ? { reply: result, action: null } : result);
  } catch(err){next(err);}
});

// ─── THEME ────────────────────────────────────────────────────────────────────
const themeRouter = express.Router();
themeRouter.post('/save', async (req,res,next) => {
  try {
    const {userId,themeColor,themeName}=req.body;
    if (!userId) return res.status(400).json({error:'userId required'});
    await db.query('UPDATE users SET theme_color=$1, updated_at=NOW() WHERE id=$2', [themeColor, userId]);
    await redis.set(redis.keys.userTheme(userId), {themeColor, themeName}, 60*60*24*30);
    res.json({ success:true, themeColor, themeName, message:'Theme synced across all platforms!' });
  } catch(err){next(err);}
});
themeRouter.get('/load/:userId', async (req,res,next) => {
  try {
    const cached = await redis.get(redis.keys.userTheme(req.params.userId));
    if (cached) return res.json(cached);
    const result = await db.query('SELECT theme_color FROM users WHERE id=$1', [req.params.userId]);
    if (!result.rows.length) return res.status(404).json({error:'User not found'});
    res.json({ themeColor: result.rows[0].theme_color });
  } catch(err){next(err);}
});

// ─── STORES ───────────────────────────────────────────────────────────────────
const storesRouter = express.Router();
storesRouter.get('/', async (req,res,next) => {
  try { const r=await db.query('SELECT * FROM stores WHERE active=true ORDER BY name'); res.json(r.rows); }
  catch(err){next(err);}
});

// ─── TELEGRAM ────────────────────────────────────────────────────────────────
const telegramRouter = express.Router();
let bot = null;
try {
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
    if (process.env.NODE_ENV==='production'&&process.env.TELEGRAM_WEBHOOK_URL) bot.setWebHook(process.env.TELEGRAM_WEBHOOK_URL);
    logger.info('✅ LeanSpend Telegram bot initialized');
  }
} catch(e) { logger.warn('Telegram not initialized:', e.message); }

telegramRouter.post('/', express.json(), async (req,res) => {
  if (!bot) return res.sendStatus(200);
  try {
    const {message}=req.body; if(!message) return res.sendStatus(200);
    const chatId=message.chat.id, telegramId=message.from.id, text=message.text||'';
    if (text.startsWith('/start')) {
      await bot.sendMessage(chatId, `💪 Welcome to *LeanSpend*!\n\nEat lean. Spend less. Live fit.\n\n/setincome 3500 — Save your income\n/budget — Your food budget\n/goal — Set fitness goal\n/deals — Today's best deals\n/help — All commands\n\nOr just chat: _"I have $40 and need high-protein meals for 3 days"_`, {parse_mode:'Markdown'});
    } else if (text.startsWith('/setincome')) {
      const income=parseFloat(text.split(' ')[1]); if(isNaN(income)) return bot.sendMessage(chatId,'Usage: /setincome 3500');
      const pct=income<2000?0.18:income<4000?0.14:0.12; const budget=(income*pct).toFixed(2);
      await db.query(`INSERT INTO users (telegram_id,monthly_income,food_budget) VALUES ($1,$2,$3) ON CONFLICT (telegram_id) DO UPDATE SET monthly_income=$2,food_budget=$3,updated_at=NOW()`, [telegramId,income,budget]);
      await bot.sendMessage(chatId, `✅ Saved!\n\n💵 Income: $${income.toLocaleString()}\n🛒 Food budget: *$${budget}/month*\n📅 That's $${(budget/30).toFixed(2)}/day!\n\n💪 Now set your goal: /goal`, {parse_mode:'Markdown'});
    } else if (text.startsWith('/goal')) {
      await bot.sendMessage(chatId, `🎯 *Set your fitness goal:*\n\n/goal muscle — Build muscle (high protein)\n/goal weightloss — Lose weight (low cal)\n/goal endurance — Cardio/endurance (high carb)\n/goal balanced — General health\n/goal plantbased — Plant-based eating`, {parse_mode:'Markdown'});
    } else if (text.startsWith('/budget')) {
      const income=parseFloat(text.split(' ')[1]);
      if (!isNaN(income)) {
        const pct=income<2000?0.18:income<4000?0.14:0.12; const budget=(income*pct).toFixed(2);
        await bot.sendMessage(chatId, `💰 *Budget for $${income.toLocaleString()}:*\n🛒 Food: *$${budget}/mo*\n📅 Per day: *$${(budget/30).toFixed(2)}*\n💪 Per meal: *$${(budget/90).toFixed(2)}*`, {parse_mode:'Markdown'});
      } else {
        const u=await db.query('SELECT * FROM users WHERE telegram_id=$1',[telegramId]);
        if (!u.rows.length) return bot.sendMessage(chatId,'Set income first: /setincome 3500');
        const user=u.rows[0];
        await bot.sendMessage(chatId, `💰 *Your LeanSpend Budget:*\n💵 Income: $${parseFloat(user.monthly_income).toLocaleString()}\n🛒 Food: *$${parseFloat(user.food_budget).toFixed(2)}/mo*\n📅 Per day: *$${(user.food_budget/30).toFixed(2)}*\n🎯 Goal: ${user.fitness_goal||'balanced'}`, {parse_mode:'Markdown'});
      }
    } else if (text.startsWith('/help')) {
      await bot.sendMessage(chatId, `🤖 *LeanSpend Commands:*\n/start — Welcome\n/setincome [amount] — Save income\n/budget — View budget\n/goal — Set fitness goal\n/help — This message\n\n💬 Or just chat naturally!`, {parse_mode:'Markdown'});
    } else {
      await bot.sendChatAction(chatId,'typing');
      const u=await db.query('SELECT * FROM users WHERE telegram_id=$1',[telegramId]);
      const reply=await aiService.telegramChat(text, u.rows[0]||{});
      await bot.sendMessage(chatId, reply);
    }
    res.sendStatus(200);
  } catch(err) { logger.error('Telegram error:',err.message); res.sendStatus(500); }
});

module.exports = { budgetRouter, mealsRouter, dealsRouter, nutritionRouter, chatRouter, themeRouter, storesRouter, telegramRouter };

// ─── KROGER LIVE API ENDPOINTS ───────────────────────────────────────────────

// GET /api/deals/kroger-live — fetch fresh deals directly from Kroger API
dealsRouter.get('/kroger-live', async (req, res, next) => {
  try {
    let kroger;
    try { kroger = require('../services/krogerService'); }
    catch(_) { return res.json({ deals: [], message: 'krogerService not found' }); }

    const zipCode    = req.query.zip || '77001';
    const locationId = await kroger.findNearbyStore(zipCode);
    const deals      = await kroger.getWeeklyDeals(locationId);

    // Also save to DB in background
    kroger.syncDealsToDb(db, locationId).catch(e => logger.warn('BG sync:', e.message));

    res.json({ deals, count: deals.length, locationId, source: 'kroger_api', fetchedAt: new Date().toISOString() });
  } catch(err) { next(err); }
});

// POST /api/deals/sync-kroger — manually trigger a Kroger sync
dealsRouter.post('/sync-kroger', async (req, res, next) => {
  try {
    let kroger;
    try { kroger = require('../services/krogerService'); }
    catch(_) { return res.json({ message: 'krogerService not found' }); }
    const deals = await kroger.syncDealsToDb(db);
    res.json({ message: `Synced ${deals.length} live Kroger deals!`, count: deals.length, syncedAt: new Date().toISOString() });
  } catch(err) { next(err); }
});

// ─── These lines are appended by patch — do not edit above ────────────────────
// Re-open the existing routers and add new v2 endpoints

// Weekly meal plan generation
mealsRouter.post('/generate-week', async (req, res, next) => {
  try {
    const {
      userId, foodBudget, allergies=[], dyeFilters=[],
      preferredStores=[], householdSize=1, fitnessGoal='balanced',
      weekStartDate, customFoods=[],
    } = req.body;

    if (!foodBudget)    return res.status(400).json({ error: 'foodBudget is required' });
    if (!weekStartDate) return res.status(400).json({ error: 'weekStartDate is required (YYYY-MM-DD)' });

    let activeDeals = [];
    try {
      const r = await db.query(`
        SELECT p.name, s.slug as store, d.deal_price as "salePrice",
               d.original_price as "unitPrice", d.savings_amount as "savingsAmount"
        FROM deals d JOIN products p ON p.id=d.product_id JOIN stores s ON s.id=d.store_id
        WHERE d.valid_from<=CURRENT_DATE AND d.valid_to>=CURRENT_DATE
        ORDER BY d.savings_amount DESC NULLS LAST LIMIT 20
      `);
      activeDeals = r.rows;
    } catch(_) {}

    const plan = await aiService.generateWeeklyMealPlan({
      foodBudget: parseFloat(foodBudget),
      allergies, dyeFilters, householdSize: parseInt(householdSize),
      preferredStores, activeDeals, weekStartDate,
      fitnessGoal, customFoods,
    });

    if (userId) {
      try {
        const weekDate = new Date(weekStartDate);
        const month = weekDate.getMonth() + 1;
        const year  = weekDate.getFullYear();
        const planRow = await db.query(`
          INSERT INTO meal_plans (user_id,month,year,total_budget,total_cost_with_deals,total_savings,avg_daily_calories,avg_daily_protein_g,fitness_focus,ai_notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
        `, [userId,month,year,foodBudget/4,plan.totalEstimatedCost,plan.totalSavings,plan.avgDailyCalories,plan.avgDailyProteinG,fitnessGoal,JSON.stringify({weekStartDate,shoppingList:plan.shoppingList})]);
        plan.mealPlanId = planRow.rows[0].id;
        for (const day of plan.days||[]) {
          for (const meal of day.meals||[]) {
            await db.query(`
              INSERT INTO meals (meal_plan_id,meal_date,meal_type,name,description,total_cost,total_calories,total_protein_g,total_carbs_g,total_fat_g,total_fiber_g,uses_deal)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            `, [planRow.rows[0].id,day.date,meal.type,meal.name,meal.description,meal.cost,meal.calories,meal.proteinG,meal.carbsG,meal.fatG,meal.fiberG,meal.usesDeals]);
          }
        }
      } catch(dbErr) { logger.warn('DB save (non-fatal):', dbErr.message); }
    }

    res.json({ plan, generatedAt: new Date().toISOString() });
  } catch(err) { next(err); }
});

// Add custom food to plan via AI
mealsRouter.post('/add-food', async (req, res, next) => {
  try {
    const { existingPlan, foodItem, mealType, targetDate } = req.body;
    if (!foodItem) return res.status(400).json({ error: 'foodItem is required' });
    const suggestion = await aiService.addFoodToPlan({
      existingPlan: existingPlan || { fitnessGoal: 'balanced', totalEstimatedCost: 70 },
      foodItem, mealType, targetDate,
    });
    res.json(suggestion);
  } catch(err) { next(err); }
});

// Preset meal plans
mealsRouter.get('/presets', (req, res) => {
  try { res.json(aiService.getAllPresets()); }
  catch(e) { res.json([]); }
});

mealsRouter.get('/presets/:goal', (req, res) => {
  try {
    const preset = aiService.getPresetPlan(req.params.goal);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    res.json(preset);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Live weekly ads scraper
dealsRouter.get('/weekly-ads', async (req, res, next) => {
  try {
    let adScraper;
    try { adScraper = require('../services/weeklyAdScraper'); }
    catch(_) { return res.json({ deals: [], message: 'weeklyAdScraper not found — copy it to src/services/', storeCount: 0 }); }
    const stores = req.query.stores ? String(req.query.stores).split(',') : ['kroger','walmart','heb'];
    if (req.query.force === 'true') adScraper.clearAdCache();
    const results = await adScraper.scrapeAllWeeklyAds(stores);
    res.json({ ...results, storeCount: stores.length });
  } catch(err) { next(err); }
});

dealsRouter.get('/weekly-ads/:store', async (req, res, next) => {
  try {
    let adScraper;
    try { adScraper = require('../services/weeklyAdScraper'); }
    catch(_) { return res.json({ deals: [], store: req.params.store, count: 0 }); }
    const scrapers = {
      kroger: adScraper.scrapeKrogerAd, walmart: adScraper.scrapeWalmartAd,
      heb: adScraper.scrapeHebAd, target: adScraper.scrapeTargetAd, aldi: adScraper.scrapeAldiAd,
    };
    const store = req.params.store.toLowerCase();
    if (!scrapers[store]) return res.status(404).json({ error: `Store '${store}' not supported` });
    const deals = await scrapers[store]();
    res.json({ store, deals, count: deals.length, scrapedAt: new Date().toISOString() });
  } catch(err) { next(err); }
});

dealsRouter.get('/ad-status', (req, res) => {
  try { const s = require('../services/weeklyAdScraper'); res.json(s.getAdCacheStatus()); }
  catch(_) { res.json({ message: 'weeklyAdScraper not installed' }); }
});

dealsRouter.post('/refresh', async (req, res, next) => {
  try {
    let s;
    try { s = require('../services/weeklyAdScraper'); }
    catch(_) { return res.json({ message: 'weeklyAdScraper not installed' }); }
    s.clearAdCache();
    const stores  = req.body.stores || ['kroger','walmart','heb','target','aldi'];
    const results = await s.scrapeAllWeeklyAds(stores);
    res.json({ message: 'Weekly ads refreshed!', ...results });
  } catch(err) { next(err); }
});

// Chat v2 — returns { reply, action } for chatbot meal plan actions
chatRouter.post('/v2', async (req, res, next) => {
  try {
    const { message, history=[], context, userContext } = req.body;
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
    if (message.length > 500) return res.status(400).json({ error: 'Message too long' });
    const result = await aiService.chat(message, history, context, userContext);
    res.json(typeof result === 'string' ? { reply: result, action: null } : result);
  } catch(err) { next(err); }
});
