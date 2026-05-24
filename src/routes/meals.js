'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const db        = require('../config/database');
const redis     = require('../config/redis');
const aiService = require('../services/aiService');
const adScraper = require('../services/weeklyAdScraper');

const router   = express.Router();
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// POST /api/meals/generate-week — Generate ONE week of meals
router.post('/generate-week',
  body('foodBudget').isFloat({ min: 0 }),
  body('weekStartDate').isISO8601().withMessage('weekStartDate must be YYYY-MM-DD'),
  validate,
  async (req, res, next) => {
    try {
      const {
        userId, foodBudget, allergies = [], dyeFilters = [],
        preferredStores = [], householdSize = 1, fitnessGoal = 'balanced',
        weekStartDate, customFoods = [],
      } = req.body;

      // Fetch live deals from weekly ads + DB
      let activeDeals = [];
      try {
        // First try live weekly ad scrape
        const adResults = await adScraper.scrapeAllWeeklyAds(preferredStores.slice(0,3));
        activeDeals = adResults.deals.slice(0, 20);
      } catch (_) {}

      // Fallback to DB deals
      if (activeDeals.length === 0) {
        try {
          const r = await db.query(`
            SELECT p.name, s.slug as store, d.deal_price as "salePrice",
                   d.original_price as "unitPrice", d.savings_amount as "savingsAmount"
            FROM deals d JOIN products p ON p.id=d.product_id JOIN stores s ON s.id=d.store_id
            WHERE d.valid_from<=CURRENT_DATE AND d.valid_to>=CURRENT_DATE
            ORDER BY d.savings_amount DESC NULLS LAST LIMIT 20
          `);
          activeDeals = r.rows;
        } catch (_) {}
      }

      const plan = await aiService.generateWeeklyMealPlan({
        foodBudget, allergies, dyeFilters, householdSize,
        preferredStores, activeDeals, weekStartDate, fitnessGoal, customFoods,
      });

      // Save to DB if userId provided
      if (userId) {
        const weekDate  = new Date(weekStartDate);
        const month     = weekDate.getMonth() + 1;
        const year      = weekDate.getFullYear();

        try {
          const planRow = await db.query(`
            INSERT INTO meal_plans (user_id, month, year, total_budget, total_cost_with_deals, total_savings, avg_daily_calories, avg_daily_protein_g, fitness_focus, ai_notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
          `, [
            userId, month, year, foodBudget / 4,
            plan.totalEstimatedCost, plan.totalSavings,
            plan.avgDailyCalories, plan.avgDailyProteinG,
            fitnessGoal, JSON.stringify({ weekStartDate, shoppingList: plan.shoppingList }),
          ]);
          plan.mealPlanId = planRow.rows[0].id;

          for (const day of plan.days || []) {
            for (const meal of day.meals || []) {
              await db.query(`
                INSERT INTO meals (meal_plan_id, meal_date, meal_type, name, description, total_cost, total_calories, total_protein_g, total_carbs_g, total_fat_g, total_fiber_g, uses_deal)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
              `, [
                planRow.rows[0].id, day.date, meal.type, meal.name,
                meal.description, meal.cost, meal.calories, meal.proteinG,
                meal.carbsG, meal.fatG, meal.fiberG, meal.usesDeals,
              ]);
            }
          }
        } catch (dbErr) {
          // Don't fail if DB save fails — return the plan anyway
          console.warn('DB save failed:', dbErr.message);
        }
      }

      res.json({ plan, generatedAt: new Date().toISOString() });
    } catch (err) { next(err); }
  }
);

// POST /api/meals/add-food — Add a custom food item to existing plan via AI
router.post('/add-food', async (req, res, next) => {
  try {
    const { existingPlan, foodItem, mealType, targetDate } = req.body;
    if (!foodItem) return res.status(400).json({ error: 'foodItem required' });

    const suggestion = await aiService.addFoodToPlan({
      existingPlan: existingPlan || { fitnessGoal: 'balanced', totalEstimatedCost: 70 },
      foodItem, mealType, targetDate,
    });
    res.json(suggestion);
  } catch (err) { next(err); }
});

// GET /api/meals/presets — Get all preset meal plans
router.get('/presets', (req, res) => {
  res.json(aiService.getAllPresets());
});

// GET /api/meals/presets/:goal — Get preset for specific goal
router.get('/presets/:goal', (req, res) => {
  const preset = aiService.getPresetPlan(req.params.goal);
  res.json(preset);
});

// GET /api/meals/plan/:userId — Get saved meal plan
router.get('/plan/:userId', async (req, res, next) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const result = await db.query(`
      SELECT mp.*, json_agg(json_build_object(
        'id',m.id,'date',m.meal_date,'type',m.meal_type,'name',m.name,
        'cost',m.total_cost,'calories',m.total_calories,'protein',m.total_protein_g,
        'usesDeals',m.uses_deal,'description',m.description
      ) ORDER BY m.meal_date,m.meal_type) as meals
      FROM meal_plans mp LEFT JOIN meals m ON m.meal_plan_id=mp.id
      WHERE mp.user_id=$1 AND mp.month=$2 AND mp.year=$3
      GROUP BY mp.id ORDER BY mp.created_at DESC LIMIT 1
    `, [req.params.userId, month, year]);
    if (!result.rows.length) return res.status(404).json({ error: 'No meal plan found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// GET /api/meals/day/:userId — Today's meals
router.get('/day/:userId', async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const result = await db.query(`
      SELECT m.* FROM meals m JOIN meal_plans mp ON mp.id=m.meal_plan_id
      WHERE mp.user_id=$1 AND m.meal_date=$2
      ORDER BY CASE m.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END
    `, [req.params.userId, date]);
    res.json({ date, meals: result.rows });
  } catch (err) { next(err); }
});

module.exports = router;
