'use strict';
require('dotenv').config();
const db     = require('../src/config/database');
const logger = require('../src/utils/logger');

const PRODUCTS = [
  { store:'kroger',  id:'KR-001', name:'Chicken Breast Boneless Skinless', brand:'Kroger',          category:'Meat',         price:4.99, size:'1 lb' },
  { store:'kroger',  id:'KR-002', name:'Large Eggs 12ct',                  brand:'Kroger',          category:'Dairy & Eggs', price:3.49, size:'12 ct' },
  { store:'kroger',  id:'KR-003', name:'Greek Yogurt Plain 32oz',          brand:'Kroger',          category:'Dairy',        price:5.49, size:'32 oz' },
  { store:'kroger',  id:'KR-004', name:'Salmon Fillet Fresh',              brand:null,              category:'Seafood',      price:9.99, size:'1 lb' },
  { store:'walmart', id:'WM-001', name:'Great Value Large Eggs 12ct',      brand:'Great Value',     category:'Dairy & Eggs', price:2.98, size:'12 ct' },
  { store:'walmart', id:'WM-002', name:'Chicken Thighs Bone-in 4lb',       brand:'Tyson',           category:'Meat',         price:6.48, size:'4 lb' },
  { store:'walmart', id:'WM-003', name:'Brown Rice 5lb',                   brand:'Great Value',     category:'Grains',       price:3.48, size:'5 lb' },
  { store:'walmart', id:'WM-004', name:'Black Beans Canned',               brand:'Great Value',     category:'Canned Goods', price:0.88, size:'15 oz' },
  { store:'heb',     id:'HEB-001',name:'H-E-B Boneless Chicken Breast',    brand:'H-E-B',           category:'Meat',         price:5.49, size:'1 lb' },
  { store:'heb',     id:'HEB-002',name:'Hill Country Fare Eggs Large',     brand:'Hill Country Fare',category:'Dairy & Eggs',price:3.09, size:'12 ct' },
  { store:'heb',     id:'HEB-003',name:'Fresh Broccoli Crown',             brand:null,              category:'Produce',      price:1.89, size:'1 lb' },
  { store:'heb',     id:'HEB-004',name:'Sweet Potatoes',                   brand:null,              category:'Produce',      price:1.49, size:'1 lb' },
];

const DEALS = [
  { id:'KR-001', salePrice:2.50, type:'bogo',           desc:'BOGO Chicken Breast — Kroger Weekly' },
  { id:'KR-002', salePrice:1.99, type:'sale',           desc:'Eggs Weekly Special' },
  { id:'KR-003', salePrice:3.99, type:'sale',           desc:'Greek Yogurt — Great for muscle goals!' },
  { id:'WM-001', salePrice:1.48, type:'rollback',       desc:'Egg Rollback — Walmart' },
  { id:'WM-002', salePrice:4.98, type:'rollback',       desc:'Chicken Thighs Rollback' },
  { id:'HEB-001',salePrice:3.99, type:'weekly_special', desc:'HEB Weekly — Chicken Breast' },
  { id:'HEB-003',salePrice:0.99, type:'weekly_special', desc:'Broccoli Weekly Price' },
  { id:'HEB-004',salePrice:0.99, type:'weekly_special', desc:'Sweet Potatoes — Perfect for endurance fuel' },
];

async function seed() {
  await db.connect();
  await db.runMigrations();

  const productMap = {};
  logger.info('🌱 Seeding LeanSpend products...');

  for (const p of PRODUCTS) {
    const storeRow = await db.query('SELECT id FROM stores WHERE slug=$1', [p.store]);
    if (!storeRow.rows.length) continue;
    const storeId = storeRow.rows[0].id;
    const res     = await db.query(`
      INSERT INTO products (store_id,store_product_id,name,brand,category,unit_price,unit_size,last_scraped_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (store_id,store_product_id) DO UPDATE SET unit_price=EXCLUDED.unit_price,last_scraped_at=NOW()
      RETURNING id
    `, [storeId,p.id,p.name,p.brand,p.category,p.price,p.size]);
    productMap[p.id] = { productId: res.rows[0].id, storeId, price: p.price };
    logger.info(`  ✅ ${p.name}`);
  }

  logger.info('🏷️  Seeding deals...');
  const today    = new Date();
  const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate()+7);

  for (const d of DEALS) {
    const p = productMap[d.id]; if (!p) continue;
    await db.query(`
      INSERT INTO deals (product_id,store_id,deal_type,original_price,deal_price,savings_amount,savings_percent,deal_description,valid_from,valid_to,source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'seed') ON CONFLICT DO NOTHING
    `, [p.productId,p.storeId,d.type,p.price,d.salePrice,parseFloat((p.price-d.salePrice).toFixed(2)),parseFloat(((1-d.salePrice/p.price)*100).toFixed(1)),d.desc,today,nextWeek]);
    logger.info(`  🏷️  ${d.desc}`);
  }

  logger.info('\n✅ LeanSpend seed complete!');
  logger.info('   Run: npm run dev — to start the server\n');
  await db.disconnect();
}

seed().catch(err => { logger.error('Seed failed:', err.message); process.exit(1); });
