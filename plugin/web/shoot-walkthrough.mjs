import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:5173';
const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });

const cases = [
  { locale: 'zh', vw: 375, vh: 820, name: 'compact-zh' },
  { locale: 'en', vw: 375, vh: 820, name: 'compact-en' },
  { locale: 'zh', vw: 900, vh: 900, name: 'expanded-zh' },
  { locale: 'en', vw: 900, vh: 900, name: 'expanded-en' },
];

const browser = await chromium.launch();
for (const c of cases) {
  const ctx = await browser.newContext({ viewport: { width: c.vw, height: c.vh }, locale: c.locale });
  const page = await ctx.newPage();
  await page.addInitScript((loc) => { localStorage.setItem('ldvh-locale', loc); }, c.locale);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  try {
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
  } catch (e) {
    errors.push('GOTO: ' + e.message);
  }
  await page.waitForTimeout(3000);
  const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 260));
  const shot = `${OUT}/${c.name}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  // detect horizontal overflow
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  console.log(`=== ${c.name} ===`);
  console.log('text:', JSON.stringify(bodyText));
  console.log('overflow:', JSON.stringify(overflow), overflow.scrollW > overflow.clientW ? 'HORIZONTAL-OVERFLOW!' : 'ok');
  console.log('errors:', errors.slice(0, 6));
  console.log('shot:', shot);
  await ctx.close();
}
await browser.close();
console.log('DONE');
