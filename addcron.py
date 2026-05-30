with open(r'C:\Users\andry\OneDrive\Desktop\LeanSpend\leanspend\src\index.js', 'r', encoding='utf-8') as f:
    content = f.read()

cron_code = """
// Daily deal refresh - runs at 6am every day
const adScraper = require('./services/weeklyAdScraper');
cron.schedule('0 6 * * *', async () => {
  logger.info('Daily deal refresh starting...');
  try {
    adScraper.clearAdCache();
    const ALL_STORES = ['kroger','walmart','heb','target','aldi','costco','samsclub','safeway','randalls'];
    await adScraper.scrapeAllWeeklyAds(ALL_STORES);
    logger.info('Daily deal refresh complete');
  } catch (err) {
    logger.error('Daily deal refresh failed:', err.message);
  }
}, { timezone: 'America/Chicago' });
"""

if 'Daily deal refresh' not in content:
    content = content.replace(
        "app.listen(",
        cron_code + "\napp.listen("
    )
    with open(r'C:\Users\andry\OneDrive\Desktop\LeanSpend\leanspend\src\index.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Added daily cron to index.js')
else:
    print('Cron already exists')
