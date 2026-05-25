'use strict';
const { Pool } = require('pg');
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('Set DATABASE_URL first!'); process.exit(1); }
console.log('Connecting...');
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
const STORES = [['kroger','Kroger'],['walmart','Walmart'],['heb','HEB'],['target','Target'],['aldi','Aldi'],['wholefoods','Whole Foods'],['sprouts','Sprouts'],['randalls','Randalls'],['safeway','Safeway'],['costco','Costco'],['samsclub',"Sam's Club"]];
const PRODUCTS = [
  {store:'kroger',id:'KR-001',name:'Chicken Breast Boneless Skinless',brand:'Kroger',category:'Meat',price:4.99,size:'1 lb'},
  {store:'kroger',id:'KR-002',name:'Large Eggs 12ct',brand:'Kroger',category:'Dairy & Eggs',price:3.49,size:'12 ct'},
  {store:'kroger',id:'KR-003',name:'Greek Yogurt Plain 32oz',brand:'Kroger',category:'Dairy',price:5.49,size:'32 oz'},
  {store:'kroger',id:'KR-004',name:'Salmon Fillet Fresh',brand:null,category:'Seafood',price:9.99,size:'1 lb'},
  {store:'walmart',id:'WM-001',name:'Great Value Large Eggs 12ct',brand:'Great Value',category:'Dairy & Eggs',price:2.98,size:'12 ct'},
  {store:'walmart',id:'WM-002',name:'Chicken Thighs Bone-in 4lb',brand:'Tyson',category:'Meat',price:6.48,size:'4 lb'},
  {store:'walmart',id:'WM-003',name:'Brown Rice 5lb',brand:'Great Value',category:'Grains',price:3.48,size:'5 lb'},
  {store:'walmart',id:'WM-004',name:'Black Beans Canned',brand:'Great Value',category:'Canned Goods',price:0.88,size:'15 oz'},
  {store:'heb',id:'HEB-001',name:'H-E-B Boneless Chicken Breast',brand:'H-E-B',category:'Meat',price:5.49,size:'1 lb'},
  {store:'heb',id:'HEB-002',name:'Hill Country Fare Eggs Large',brand:'Hill Country Fare',category:'Dairy & Eggs',price:3.09,size:'12 ct'},
  {store:'heb',id:'HEB-003',name:'Fresh Broccoli Crown',brand:null,category:'Produce',price:1.89,size:'1 lb'},
  {store:'heb',id:'HEB-004',name:'Sweet Potatoes',brand:null,category:'Produce',price:1.49,size:'1 lb'},
  {store:'randalls',id:'RAN-001',name:'Randalls Boneless Chicken Breast',brand:'Randalls',category:'Meat',price:5.99,size:'1 lb'},
  {store:'randalls',id:'RAN-002',name:'Large Eggs 18ct',brand:'Randalls',category:'Dairy & Eggs',price:4.99,size:'18 ct'},
  {store:'randalls',id:'RAN-003',name:'Fresh Salmon Fillet',brand:null,category:'Seafood',price:11.99,size:'1 lb'},
  {store:'randalls',id:'RAN-004',name:'Organic Baby Spinach 5oz',brand:'O Organics',category:'Produce',price:4.49,size:'5 oz'},
  {store:'safeway',id:'SAF-001',name:'Safeway Chicken Breast Value Pack',brand:'Safeway',category:'Meat',price:4.99,size:'1 lb'},
  {store:'safeway',id:'SAF-002',name:'Lucerne Large Eggs 18ct',brand:'Lucerne',category:'Dairy & Eggs',price:5.49,size:'18 ct'},
  {store:'safeway',id:'SAF-003',name:'O Organics Greek Yogurt 32oz',brand:'O Organics',category:'Dairy',price:7.49,size:'32 oz'},
  {store:'safeway',id:'SAF-004',name:'Fresh Broccoli Crowns',brand:null,category:'Produce',price:1.79,size:'1 lb'},
  {store:'costco',id:'CST-001',name:'Kirkland Chicken Breast 6.5lb',brand:'Kirkland',category:'Meat',price:26.99,size:'6.5 lb'},
  {store:'costco',id:'CST-002',name:'Kirkland Omega-3 Salmon 3lb',brand:'Kirkland',category:'Seafood',price:29.99,size:'3 lb'},
  {store:'costco',id:'CST-003',name:'Vital Farms Eggs 24ct',brand:'Vital Farms',category:'Dairy & Eggs',price:13.99,size:'24 ct'},
  {store:'costco',id:'CST-004',name:'Kirkland Greek Yogurt 3lb',brand:'Kirkland',category:'Dairy',price:9.49,size:'3 lb'},
  {store:'samsclub',id:'SAM-001',name:"Member's Mark Chicken Breast 4lb",brand:"Member's Mark",category:'Meat',price:17.98,size:'4 lb'},
  {store:'samsclub',id:'SAM-002',name:'SE Grocers Large Eggs 60ct',brand:'SE Grocers',category:'Dairy & Eggs',price:12.98,size:'60 ct'},
  {store:'samsclub',id:'SAM-003',name:"Member's Mark Atlantic Salmon 3lb",brand:"Member's Mark",category:'Seafood',price:26.98,size:'3 lb'},
  {store:'samsclub',id:'SAM-004',name:"Member's Mark Brown Rice 50lb",brand:"Member's Mark",category:'Grains',price:31.98,size:'50 lb'},
];
const DEALS = [
  {id:'KR-001',salePrice:2.50,type:'bogo',desc:'BOGO Chicken Breast — Kroger Weekly'},
  {id:'KR-002',salePrice:1.99,type:'sale',desc:'Eggs Weekly Special — Kroger'},
  {id:'KR-003',salePrice:3.99,type:'sale',desc:'Greek Yogurt — Great for muscle goals!'},
  {id:'WM-001',salePrice:1.48,type:'rollback',desc:'Egg Rollback — Walmart'},
  {id:'WM-002',salePrice:4.98,type:'rollback',desc:'Chicken Thighs Rollback — Walmart'},
  {id:'HEB-001',salePrice:3.99,type:'weekly_special',desc:'HEB Weekly — Chicken Breast'},
  {id:'HEB-003',salePrice:0.99,type:'weekly_special',desc:'Broccoli Weekly Price — HEB'},
  {id:'HEB-004',salePrice:0.99,type:'weekly_special',desc:'Sweet Potatoes — Endurance fuel'},
  {id:'RAN-001',salePrice:3.49,type:'weekly_special',desc:'Randalls Weekly — Chicken Breast'},
  {id:'RAN-002',salePrice:3.49,type:'weekly_special',desc:'Randalls Weekly — Large Eggs 18ct'},
  {id:'RAN-003',salePrice:7.99,type:'weekly_special',desc:'Randalls Weekly — Fresh Salmon'},
  {id:'RAN-004',salePrice:2.99,type:'weekly_special',desc:'Randalls Weekly — Organic Spinach'},
  {id:'SAF-001',salePrice:2.99,type:'weekly_special',desc:'Safeway Weekly — Chicken Breast'},
  {id:'SAF-002',salePrice:3.99,type:'weekly_special',desc:'Safeway Weekly — Lucerne Eggs 18ct'},
  {id:'SAF-003',salePrice:4.99,type:'weekly_special',desc:'Safeway Weekly — O Organics Greek Yogurt'},
  {id:'SAF-004',salePrice:0.99,type:'weekly_special',desc:'Safeway Weekly — Broccoli Crowns'},
  {id:'CST-001',salePrice:19.99,type:'hot_buy',desc:'Costco Hot Buy — Kirkland Chicken'},
  {id:'CST-002',salePrice:22.99,type:'hot_buy',desc:'Costco Hot Buy — Omega-3 Salmon'},
  {id:'CST-003',salePrice:9.99,type:'coupon',desc:'Costco Coupon — Vital Farms Eggs'},
  {id:'CST-004',salePrice:6.99,type:'hot_buy',desc:'Costco Hot Buy — Kirkland Greek Yogurt'},
  {id:'SAM-001',salePrice:12.98,type:'member_savings',desc:"Sam's Club — Member's Mark Chicken"},
  {id:'SAM-002',salePrice:8.98,type:'member_savings',desc:"Sam's Club — SE Grocers Eggs 60ct"},
  {id:'SAM-003',salePrice:19.98,type:'member_savings',desc:"Sam's Club — Member's Mark Salmon"},
  {id:'SAM-004',salePrice:24.98,type:'member_savings',desc:"Sam's Club — Member's Mark Brown Rice"},
];
async function seed() {
  const client = await pool.connect();
  console.log('Connected!');
  try {
    for (const [slug, name] of STORES) {
      await client.query(`INSERT INTO stores (slug,name,api_type,website_url) VALUES ($1,$2,'scraper',$3) ON CONFLICT (slug) DO NOTHING`, [slug, name, 'https://www.'+slug+'.com']);
      console.log('Store: ' + name);
    }
    const productMap = {};
    for (const p of PRODUCTS) {
      const sr = await client.query('SELECT id FROM stores WHERE slug=$1', [p.store]);
      if (!sr.rows.length) continue;
      const storeId = sr.rows[0].id;
      const res = await client.query(`INSERT INTO products (store_id,store_product_id,name,brand,category,unit_price,unit_size,last_scraped_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (store_id,store_product_id) DO UPDATE SET unit_price=EXCLUDED.unit_price,last_scraped_at=NOW() RETURNING id`, [storeId,p.id,p.name,p.brand,p.category,p.price,p.size]);
      productMap[p.id] = {productId:res.rows[0].id, storeId, price:p.price};
      console.log('Product: ' + p.name);
    }
    const today = new Date();
    const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate()+7);
    for (const d of DEALS) {
      const p = productMap[d.id]; if (!p) continue;
      await client.query(`INSERT INTO deals (product_id,store_id,deal_type,original_price,deal_price,savings_amount,savings_percent,deal_description,valid_from,valid_to,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'seed') ON CONFLICT DO NOTHING`, [p.productId,p.storeId,d.type,p.price,d.salePrice,parseFloat((p.price-d.salePrice).toFixed(2)),parseFloat(((1-d.salePrice/p.price)*100).toFixed(1)),d.desc,today,nextWeek]);
      console.log('Deal: ' + d.desc);
    }
    console.log('\nSeed complete!');
  } finally { client.release(); await pool.end(); }
}
seed().catch(err => { console.error('FAILED:', err.message, err.code, err.detail); process.exit(1); });
