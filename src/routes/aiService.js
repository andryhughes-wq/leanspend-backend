'use strict';
const axios  = require('axios');
const logger = require('../utils/logger');

const GROQ_API_KEY  = process.env.GROQ_API_KEY;
const GROQ_BASE     = 'https://api.groq.com/openai/v1';
const GROQ_FAST     = 'llama-3.1-8b-instant';    // chat, budget — 20k TPM free
const GROQ_SMART    = 'llama-3.3-70b-versatile';  // meal plans — better quality
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Core caller ──────────────────────────────────────────────────────────────
async function callGroq(messages, maxTokens = 4096, retries = 3, model = GROQ_FAST) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await axios.post(`${GROQ_BASE}/chat/completions`, {
        model, messages, max_tokens: maxTokens, temperature: 0.7,
      }, {
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 90000,
      });
      return resp.data.choices?.[0]?.message?.content || '';
    } catch (err) {
      const status  = err.response?.status;
      const isRetry = status === 429 || status === 503 || status === 500;
      if (isRetry && attempt < retries) {
        const wait = attempt * 10000;
        logger.warn(`Groq rate limit — retrying in ${wait/1000}s (attempt ${attempt}/${retries})`);
        await sleep(wait);
        continue;
      }
      throw new Error(`AI error: ${err.response?.data?.error?.message || err.message}`);
    }
  }
}

// ─── Preset meal plans per fitness goal ───────────────────────────────────────
const PRESET_PLANS = {
  'muscle-gain': {
    name: 'Muscle Builder',
    description: 'High protein, moderate carbs — designed to maximize muscle growth',
    meals: [
      { type:'breakfast', name:'Scrambled Eggs & Oatmeal', description:'4 eggs scrambled with 1 cup oats, banana, and black coffee', calories:520, proteinG:38, carbsG:52, fatG:14, fiberG:6, cost:1.80, ingredients:['eggs','rolled oats','banana'] },
      { type:'lunch',     name:'Chicken Rice Bowl',        description:'6oz grilled chicken breast over 1 cup brown rice with broccoli', calories:580, proteinG:52, carbsG:48, fatG:8,  fiberG:5, cost:3.20, ingredients:['chicken breast','brown rice','broccoli'] },
      { type:'dinner',    name:'Salmon & Sweet Potato',   description:'6oz baked salmon with roasted sweet potato and green beans', calories:620, proteinG:48, carbsG:42, fatG:18, fiberG:7, cost:5.50, ingredients:['salmon','sweet potato','green beans'] },
    ],
  },
  'weight-loss': {
    name: 'Lean & Clean',
    description: 'Low calorie, high fiber, high protein — keeps you full and burns fat',
    meals: [
      { type:'breakfast', name:'Greek Yogurt Parfait',     description:'1 cup Greek yogurt with berries, chia seeds, and a drizzle of honey', calories:280, proteinG:24, carbsG:32, fatG:4,  fiberG:5, cost:1.60, ingredients:['greek yogurt','berries','chia seeds','honey'] },
      { type:'lunch',     name:'Big Salad with Chicken',  description:'Large salad with 5oz chicken, cucumber, tomato, avocado, lemon dressing', calories:380, proteinG:40, carbsG:14, fatG:16, fiberG:8, cost:3.80, ingredients:['chicken breast','mixed greens','cucumber','tomato','avocado'] },
      { type:'dinner',    name:'Zucchini Turkey Bowl',    description:'Ground turkey with zucchini noodles, tomato sauce, and parmesan', calories:420, proteinG:42, carbsG:18, fatG:16, fiberG:4, cost:3.40, ingredients:['ground turkey','zucchini','tomato sauce'] },
    ],
  },
  'endurance': {
    name: 'Fuel the Run',
    description: 'High carb, moderate protein — designed for runners and endurance athletes',
    meals: [
      { type:'breakfast', name:'Banana Oat Pancakes',      description:'Oat flour pancakes with banana, maple syrup, and peanut butter', calories:520, proteinG:18, carbsG:82, fatG:12, fiberG:8, cost:1.40, ingredients:['rolled oats','banana','eggs','peanut butter','maple syrup'] },
      { type:'lunch',     name:'Pasta Primavera',          description:'Whole wheat pasta with mixed veggies, olive oil, and parmesan', calories:580, proteinG:22, carbsG:88, fatG:14, fiberG:10, cost:2.20, ingredients:['whole wheat pasta','mixed vegetables','olive oil','parmesan'] },
      { type:'dinner',    name:'Rice, Chicken & Beans',   description:'Brown rice with grilled chicken and black beans in a mild salsa', calories:640, proteinG:48, carbsG:72, fatG:8,  fiberG:12, cost:3.20, ingredients:['brown rice','chicken breast','black beans','salsa'] },
    ],
  },
  'balanced': {
    name: 'Everyday Healthy',
    description: 'Balanced macros for general health and steady energy all day',
    meals: [
      { type:'breakfast', name:'Avocado Toast & Eggs',    description:'2 eggs on whole grain toast with avocado, tomato, and everything bagel seasoning', calories:420, proteinG:22, carbsG:38, fatG:20, fiberG:8, cost:2.20, ingredients:['eggs','whole grain bread','avocado','tomato'] },
      { type:'lunch',     name:'Turkey & Hummus Wrap',    description:'Whole wheat wrap with turkey, hummus, spinach, cucumber, and feta', calories:480, proteinG:32, carbsG:44, fatG:16, fiberG:6, cost:3.10, ingredients:['ground turkey','whole wheat tortilla','hummus','spinach','cucumber'] },
      { type:'dinner',    name:'Stir Fry Rice Bowl',      description:'Stir fried chicken and vegetables over jasmine rice with low-sodium soy sauce', calories:540, proteinG:38, carbsG:58, fatG:10, fiberG:6, cost:2.80, ingredients:['chicken breast','mixed vegetables','jasmine rice','soy sauce'] },
    ],
  },
  'plant-based': {
    name: 'Plant Power',
    description: 'No meat or dairy — high fiber, plant protein focused',
    meals: [
      { type:'breakfast', name:'Tofu Scramble',            description:'Firm tofu scrambled with turmeric, nutritional yeast, spinach, and whole grain toast', calories:380, proteinG:28, carbsG:32, fatG:14, fiberG:8, cost:2.00, ingredients:['firm tofu','nutritional yeast','spinach','whole grain bread','turmeric'] },
      { type:'lunch',     name:'Lentil Soup & Bread',     description:'Red lentil soup with carrots, celery, cumin, and whole grain bread', calories:420, proteinG:24, carbsG:62, fatG:6,  fiberG:16, cost:1.60, ingredients:['red lentils','carrots','celery','cumin','whole grain bread'] },
      { type:'dinner',    name:'Black Bean Tacos',        description:'Corn tortillas with spiced black beans, salsa, avocado, and cabbage slaw', calories:480, proteinG:22, carbsG:68, fatG:14, fiberG:14, cost:2.20, ingredients:['black beans','corn tortillas','avocado','salsa','cabbage'] },
    ],
  },
};

// ─── WEEKLY Meal Plan Generator (1 week at a time) ────────────────────────────
const planCache = new Map();

async function generateWeeklyMealPlan({
  foodBudget, allergies = [], dyeFilters = [],
  householdSize = 1, preferredStores = [], activeDeals = [],
  weekStartDate, fitnessGoal = 'balanced', customFoods = [],
}) {
  const cacheKey = `week-${foodBudget}-${weekStartDate}-${fitnessGoal}-${householdSize}-${allergies.join(',')}-${customFoods.join(',')}`;
  if (planCache.has(cacheKey)) { logger.info('Returning cached weekly plan'); return planCache.get(cacheKey); }

  const allergyList = [...allergies, ...dyeFilters].filter(Boolean).join(', ') || 'none';
  const weeklyBudget = parseFloat((foodBudget / 4).toFixed(2));
  const dailyBudget  = parseFloat((weeklyBudget / 7).toFixed(2));

  const dealList = activeDeals.slice(0, 15)
    .map(d => `- ${d.name} at ${d.store}: $${d.salePrice} (saves $${d.savingsAmount})`)
    .join('\n') || 'Use typical US grocery prices';

  const customFoodNote = customFoods.length > 0
    ? `\nUSER WANTS THESE FOODS INCLUDED: ${customFoods.join(', ')}`
    : '';

  const fitnessTargets = {
    'muscle-gain':  'HIGH protein 140g+/day, moderate carbs, lean meats, eggs, Greek yogurt',
    'weight-loss':  'LOW calorie 1400-1600/day, high fiber, lean protein, lots of vegetables',
    'endurance':    'HIGH carb 55-60%, moderate protein, oats, sweet potato, brown rice, bananas',
    'balanced':     'Balanced macros ~2000 cal/day, 30% protein, 45% carbs, 25% fat',
    'plant-based':  'Plant proteins only — beans, lentils, tofu, tempeh, no meat or dairy',
  };

  const prompt = `You are a fitness nutritionist and budget meal planner. Generate a 7-day meal plan.

FITNESS GOAL: ${fitnessGoal} — ${fitnessTargets[fitnessGoal]||fitnessTargets.balanced}
WEEKLY BUDGET: $${weeklyBudget} for ${householdSize} person(s) ($${dailyBudget}/day)
AVOID ALL: ${allergyList}
WEEK STARTS: ${weekStartDate}
STORES: ${preferredStores.join(', ')||'any'}${customFoodNote}
DEALS TO USE:
${dealList}

Rules: 3 meals/day for 7 days, total cost under $${weeklyBudget}, realistic US prices, reuse ingredients.

Return ONLY valid JSON:
{
  "weekStartDate": "${weekStartDate}",
  "totalEstimatedCost": 72.50,
  "totalCostWithoutDeals": 95.00,
  "totalSavings": 22.50,
  "avgDailyCalories": 2050,
  "avgDailyProteinG": 82,
  "fitnessGoal": "${fitnessGoal}",
  "householdSize": ${householdSize},
  "shoppingList": [{"ingredient":"Chicken Breast","qty":"2 lbs","estimatedCost":8.99,"store":"kroger","onDeal":true}],
  "days": [
    {
      "date": "${weekStartDate}",
      "totalCost": 10.20,
      "meals": [
        {"type":"breakfast","name":"Oatmeal with Banana","description":"Rolled oats with banana and honey","calories":380,"proteinG":12,"carbsG":68,"fatG":7,"fiberG":6,"cost":1.40,"usesDeals":false,"ingredients":["rolled oats","banana","honey"]}
      ]
    }
  ]
}`;

  logger.info(`Generating 7-day meal plan (goal: ${fitnessGoal}, ${householdSize} people) with Groq...`);
  const text = await callGroq([
    { role:'system', content:'You are a fitness nutritionist. Respond with valid JSON only — no markdown, no explanation.' },
    { role:'user',   content: prompt },
  ], 5000, 3, GROQ_SMART);

  try {
    const result = JSON.parse(text.replace(/```json\n?|\n?```/g,'').trim());
    planCache.set(cacheKey, result);
    if (planCache.size > 50) planCache.delete(planCache.keys().next().value);
    return result;
  } catch (err) {
    logger.error('Failed to parse weekly meal plan JSON:', err.message);
    logger.error('Raw response (first 400 chars):', text.slice(0,400));
    throw new Error('Meal plan generation failed — please try again');
  }
}

// ─── Add custom food to existing plan via AI ──────────────────────────────────
async function addFoodToPlan({ existingPlan, foodItem, mealType = 'any', targetDate = null }) {
  const prompt = `Given this existing meal plan summary, suggest how to incorporate "${foodItem}" into the plan.
Existing plan goal: ${existingPlan.fitnessGoal}, weekly cost: $${existingPlan.totalEstimatedCost}

Return ONLY JSON with a suggested meal or snack incorporating "${foodItem}":
{
  "suggestion": "Add ${foodItem} to Tuesday dinner as a side dish",
  "meal": {
    "type": "${mealType === 'any' ? 'dinner' : mealType}",
    "name": "Meal name with ${foodItem}",
    "description": "Brief description",
    "calories": 350,
    "proteinG": 25,
    "carbsG": 30,
    "fatG": 10,
    "fiberG": 5,
    "cost": 2.50,
    "usesDeals": false,
    "ingredients": ["${foodItem}", "other ingredient"]
  },
  "nutritionNote": "Brief note about ${foodItem} and the fitness goal",
  "recommendedDate": "${targetDate || 'any day this week'}"
}`;

  const text = await callGroq([
    { role:'system', content:'You are a fitness nutritionist. Respond with JSON only.' },
    { role:'user',   content: prompt },
  ], 600, 2, GROQ_FAST);

  return JSON.parse(text.replace(/```json\n?|\n?```/g,'').trim());
}

// ─── Get preset plan for a goal ───────────────────────────────────────────────
function getPresetPlan(fitnessGoal) {
  return PRESET_PLANS[fitnessGoal] || PRESET_PLANS.balanced;
}

function getAllPresets() {
  return Object.entries(PRESET_PLANS).map(([id, plan]) => ({ id, ...plan }));
}

// ─── Budget Calculator ────────────────────────────────────────────────────────
async function calculateBudgetBreakdown({ monthlyIncome, householdSize = 1, zipCode = null, fitnessGoal = 'balanced' }) {
  const text = await callGroq([
    { role:'system', content:'You are a certified financial planner. Respond with JSON only — no markdown.' },
    { role:'user',   content:`Calculate monthly grocery budget.
Monthly income: $${monthlyIncome}
Household size: ${householdSize} ${householdSize === 1 ? 'person (individual)' : `people (family of ${householdSize})`}
Location: ${zipCode || 'Texas, USA'}
Fitness goal: ${fitnessGoal}

Return ONLY:
{
  "recommendedFoodBudget": 490,
  "foodBudgetPercent": 14,
  "perPersonPerDay": 5.44,
  "perPersonPerMonth": 163,
  "breakdown": {"groceries": 420, "supplements": 30, "household": 40},
  "budgetTier": "moderate",
  "householdTip": "For a family of ${householdSize}, buy in bulk and meal prep on Sundays",
  "fitnessNotes": "Brief tip for ${fitnessGoal} on this budget",
  "tips": ["tip 1", "tip 2", "tip 3"],
  "dealSavingsPotential": 127
}` },
  ], 600, 2, GROQ_FAST);
  return JSON.parse(text.replace(/```json\n?|\n?```/g,'').trim());
}

// ─── Chat Bot ─────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are LeanBot, a friendly AI assistant for LeanSpend — a fitness-focused grocery budgeting app.
You help with grocery budgeting, fitness meal planning, nutrition info, allergy awareness (especially Red 40, Yellow 5, Blue 1), and smart shopping.
Be warm, motivating, conversational. Use fitness and food emojis occasionally. Keep responses concise (2-4 sentences).
When a user asks to add food or create a meal plan, respond with a special JSON action block like this:
If they want to ADD a food item to their meal plan, end your response with:
##ACTION:ADD_FOOD:{"food":"chicken breast","mealType":"dinner"}##
If they want a NEW meal plan for a specific goal, end with:
##ACTION:NEW_PLAN:{"goal":"muscle-gain","week":"current"}##
Otherwise respond normally.`;

async function chat(userMessage, conversationHistory = [], context = 'general', userContext = {}) {
  const hints = {
    budget:    'User is on the Budget tab. Focus on grocery budgeting and store deals.',
    tips:      'User is on the Tips tab. Give smart grocery and fitness nutrition advice.',
    nutrition: 'User is on the Nutrition tab. Focus on food health and fitness nutrition.',
    meals:     'User is on the Meals tab. They may want to add foods or generate new meal plans.',
    general:   '',
  };
  const info = userContext?.monthlyIncome
    ? `User: $${userContext.monthlyIncome}/mo income, $${userContext.foodBudget}/mo food budget, ${userContext.householdSize||1} person(s), fitness goal: ${userContext.fitnessGoal||'balanced'}, stores: ${(userContext.preferredStores||[]).join(',')||'any'}.`
    : '';

  const reply = await callGroq([
    { role:'system', content:`${SYSTEM_PROMPT}\n${hints[context]||''}\n${info}` },
    ...conversationHistory.slice(-6).map(m => ({ role: m.role==='bot'?'assistant':'user', content: m.content })),
    { role:'user', content: userMessage },
  ], 500, 2, GROQ_FAST);

  // Parse any action commands from the reply
  const actionMatch = reply.match(/##ACTION:([^:]+):({[^}]+})##/);
  const cleanReply  = reply.replace(/##ACTION:[^#]+##/g, '').trim();

  if (actionMatch) {
    try {
      return {
        reply: cleanReply,
        action: { type: actionMatch[1], data: JSON.parse(actionMatch[2]) },
      };
    } catch (_) {}
  }
  return { reply: cleanReply, action: null };
}

async function telegramChat(userMessage, userContext = {}) {
  const info = userContext.monthly_income
    ? `User: $${userContext.monthly_income}/mo, budget $${userContext.food_budget}/mo, ${userContext.household_size||1} people, goal: ${userContext.fitness_goal||'balanced'}`
    : '';
  const text = await callGroq([
    { role:'system', content:`${SYSTEM_PROMPT}\nFormat for Telegram — plain text, short, punchy, motivating.\n${info}` },
    { role:'user',   content: userMessage },
  ], 300, 2, GROQ_FAST);
  return text.replace(/##ACTION:[^#]+##/g,'').trim();
}

async function generateDealPrediction(productName, priceHistory) {
  const history = priceHistory.slice(-12).map(h=>`${h.date}: $${h.price}${h.was_on_deal?' (DEAL)':''}`).join('\n');
  try {
    const text = await callGroq([
      { role:'system', content:'Analyze grocery price history and predict sale dates. JSON only.' },
      { role:'user',   content:`Predict next sale for "${productName}":\n${history}\n\nReturn ONLY:\n{"predictedNextSaleDate":"2026-06-07","confidence":"high","averageSaleFrequencyDays":12,"typicalSavingsPercent":25,"recommendation":"Buy this week"}` },
    ], 200, 2, GROQ_FAST);
    return JSON.parse(text.replace(/```json\n?|\n?```/g,'').trim());
  } catch { return null; }
}

module.exports = {
  generateWeeklyMealPlan,
  addFoodToPlan,
  getPresetPlan,
  getAllPresets,
  calculateBudgetBreakdown,
  chat,
  telegramChat,
  generateDealPrediction,
};
