// Phone screenshots for the decks (submission/slides/images): 390x844 at 1.5x, like the others there, from the running
// app at $BASE through the Chrome at $CDP. Each language opens its own demo bank and asks for hot pot nearby (one model
// call each when the model is on), then saves the list with its photos.
// Usage: node shots.mjs <out dir>
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8000';
const CDP = process.env.CDP || 'http://localhost:9335';
const out = process.argv[2] || 'work/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP(CDP);
for (const [lang, ask] of [['zh', '附近有什么好吃的火锅'], ['en', 'Any good hot pot nearby?']].filter(([l]) => !process.env.ONLY || l === process.env.ONLY)) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true,
    hasTouch: true, locale: lang === 'zh' ? 'zh-CN' : 'en-US', geolocation: { latitude: 22.5431, longitude: 114.0579 },
    permissions: ['geolocation'] });
  const page = await context.newPage();
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await page.locator('.lp-hero .site-button.cta').click();
  await page.waitForURL(/#\/home/);
  await page.getByRole('button', { name: lang === 'zh' ? '中文' : 'English', exact: true }).first().click();
  await page.goto(`${BASE}/#/assistant`, { waitUntil: 'networkidle' });
  await sleep(1200);
  const box = page.locator('main textarea').first();
  await box.fill(ask);
  await page.locator('main').getByRole('button', { name: lang === 'zh' ? '发送' : 'Send', exact: true }).last().click();
  await page.getByRole('link', { name: lang === 'zh' ? '地图' : 'Map' }).first().waitFor({ timeout: 90000 });
  await sleep(6000);   // the photos
  // the reply and the first places, the list's title under the header
  await page.locator('main').getByText(lang === 'zh' ? '我来找找' : 'Here are real places').last()
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -70));
  await sleep(1500);
  await page.screenshot({ path: path.join(out, `${lang}-places.jpg`), type: 'jpeg', quality: 88 });
  console.log(`${lang}-places.jpg`);
  await context.close();
}
await browser.close();
