'use strict';
const axios  = require('axios');
const redis  = require('../config/redis');
const logger = require('../utils/logger');

const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';
const API_KEY   = process.env.USDA_API_KEY || 'DEMO_KEY';

const client = () => axios.create({ baseURL: USDA_BASE, params: { api_key: API_KEY }, timeout: 10000 });

const NUTRIENT_MAP = {
  1008:'calories', 1004:'total_fat', 1258:'saturated_fat', 1257:'trans_fat',
  1253:'cholesterol', 1093:'sodium', 1005:'total_carbs', 1079:'dietary_fiber',
  2000:'total_sugars', 1235:'added_sugars', 1003:'protein',
  1114:'vitamin_d', 1087:'calcium', 1089:'iron', 1092:'potassium',
};

function extractNutrients(foodNutrients) {
  const r = {};
  for (const fn of foodNutrients) {
    const key = NUTRIENT_MAP[fn.nutrientId || fn.nutrient?.id];
    if (key) r[key] = fn.value ?? fn.amount ?? 0;
  }
  return r;
}

function pct(v, dv) { return v && dv ? Math.round((v/dv)*100) : 0; }

function normalizeFood(food) {
  const n = extractNutrients(food.foodNutrients || []);
  return {
    fdcId: food.fdcId, description: food.description,
    brandOwner: food.brandOwner, gtinUpc: food.gtinUpc,
    ingredients: food.ingredients, servingSize: food.servingSize,
    servingSizeUnit: food.servingSizeUnit,
    nutritionLabel: {
      servingDesc:  food.householdServingFullText || `${food.servingSize}${food.servingSizeUnit}`,
      calories:     n.calories,
      totalFat:     { value: n.total_fat,     unit:'g',   dv: pct(n.total_fat,78) },
      saturatedFat: { value: n.saturated_fat, unit:'g',   dv: pct(n.saturated_fat,20) },
      transFat:     { value: n.trans_fat,     unit:'g' },
      cholesterol:  { value: n.cholesterol,   unit:'mg',  dv: pct(n.cholesterol,300) },
      sodium:       { value: n.sodium,        unit:'mg',  dv: pct(n.sodium,2300) },
      totalCarbs:   { value: n.total_carbs,   unit:'g',   dv: pct(n.total_carbs,275) },
      dietaryFiber: { value: n.dietary_fiber, unit:'g',   dv: pct(n.dietary_fiber,28) },
      totalSugars:  { value: n.total_sugars,  unit:'g' },
      addedSugars:  { value: n.added_sugars,  unit:'g',   dv: pct(n.added_sugars,50) },
      protein:      { value: n.protein,       unit:'g',   dv: pct(n.protein,50) },
      vitaminD:     { value: n.vitamin_d,     unit:'mcg', dv: pct(n.vitamin_d,20) },
      calcium:      { value: n.calcium,       unit:'mg',  dv: pct(n.calcium,1300) },
      iron:         { value: n.iron,          unit:'mg',  dv: pct(n.iron,18) },
      potassium:    { value: n.potassium,     unit:'mg',  dv: pct(n.potassium,4700) },
    },
    allergens: detectAllergens(food),
  };
}

async function searchFood(query, dataType, pageSize=25) {
  return redis.getOrSet(`usda:search:${query}:${dataType||'all'}`, async () => {
    const params = { query, pageSize };
    if (dataType) params.dataType = dataType;
    const resp = await client().get('/foods/search', { params });
    return (resp.data.foods || []).map(f => ({
      fdcId: f.fdcId, description: f.description, brandOwner: f.brandOwner,
      gtinUpc: f.gtinUpc, servingSize: f.servingSize,
      nutrients: extractNutrients(f.foodNutrients || []),
    }));
  }, 60*60*24);
}

async function getFoodById(fdcId) {
  return redis.getOrSet(`usda:food:${fdcId}`, async () => {
    const resp = await client().get(`/food/${fdcId}`, { params: { format: 'full' } });
    return normalizeFood(resp.data);
  }, 60*60*24*7);
}

async function searchByUpc(upc) {
  return redis.getOrSet(`usda:upc:${upc}`, async () => {
    const resp = await client().get('/foods/search', { params: { query: upc, dataType: 'Branded', pageSize: 1 } });
    const foods = resp.data.foods || [];
    return foods.length ? normalizeFood(foods[0]) : null;
  }, 60*60*24*7);
}

function detectAllergens(food) {
  const text = (food.ingredients || '').toLowerCase();
  const map = {
    gluten: /wheat|barley|rye|gluten/, dairy: /milk|cream|cheese|butter|lactose|whey|casein/,
    eggs: /egg|albumin/, peanuts: /peanut|groundnut/,
    tree_nuts: /almond|cashew|walnut|pecan|pistachio|hazelnut/,
    soy: /soy|soybean|tofu/, shellfish: /shrimp|crab|lobster/,
    red_40: /red 40|allura red/, yellow_5: /yellow 5|tartrazine/,
    yellow_6: /yellow 6|sunset yellow/, blue_1: /blue 1|brilliant blue/,
  };
  return Object.entries(map).filter(([,re]) => re.test(text)).map(([k]) => k);
}

const BENEFITS = {
  chicken:  { positive:['Complete protein with all 9 essential amino acids — perfect for muscle building','Low in saturated fat — supports heart health and lean body composition','Rich in B vitamins that fuel energy metabolism during workouts'], negative:['Conventionally raised may contain antibiotic residues — choose organic when possible'] },
  broccoli: { positive:['Sulforaphane — powerful antioxidant that may reduce inflammation post-workout','Excellent source of Vitamin C and folate supporting recovery','High fiber content supports gut health and satiety'], negative:['May cause bloating — those on blood thinners should monitor Vitamin K intake'] },
  eggs:     { positive:['Complete protein with all essential amino acids ideal for muscle repair','Choline supports brain function and liver health','Leucine content makes them excellent for triggering muscle protein synthesis'], negative:['Common allergen — consult doctor about cholesterol if cardiovascular risk is present'] },
  banana:   { positive:['Fast-digesting carbs make it perfect pre-workout fuel','Potassium helps prevent muscle cramps during exercise','Natural sugars provide quick energy without a heavy crash'], negative:['Higher natural sugars — diabetics should monitor intake around workouts'] },
  oats:     { positive:['Beta-glucan fiber keeps you full and supports consistent energy levels','Excellent pre-workout carb source with slow-burning complex carbohydrates','Contains avenanthramides with anti-inflammatory properties supporting recovery'], negative:['May contain gluten cross-contamination — choose certified GF if celiac'] },
  salmon:   { positive:['Omega-3 fatty acids reduce muscle soreness and inflammation after training','High-quality protein with 25g per 100g supporting muscle synthesis','Vitamin D supports bone health and immune function'], negative:['High cost — canned salmon is nutritionally equivalent at a fraction of the price'] },
  rice:     { positive:['Easy-to-digest carbohydrate ideal for pre or post-workout meals','Gluten-free and low in allergens — suitable for most diets','Pairs perfectly with proteins for a complete macro-balanced meal'], negative:['White rice is low in fiber and nutrients compared to brown rice alternatives'] },
};

async function getIngredientBenefits(ingredient) {
  const key = Object.keys(BENEFITS).find(k => ingredient.toLowerCase().includes(k));
  if (key) return BENEFITS[key];
  return { positive:['Rich in nutrients supporting your fitness goals — see full nutrition label'], negative:['Always check ingredients for personal allergens'] };
}

module.exports = { searchFood, getFoodById, searchByUpc, getIngredientBenefits, detectAllergens };
