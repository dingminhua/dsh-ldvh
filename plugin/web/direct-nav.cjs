const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ colorScheme: 'dark' });

  // Direct navigation - capture frames during page load
  await page.goto('http://localhost:5173/objects/intent/intent-0001');

  for (let i = 0; i <= 15; i++) {
    await page.screenshot({ path: `direct-${String(i).padStart(2, '0')}.png` });
    await page.waitForTimeout(100);
  }

  console.log('Done! Captured 16 frames of direct navigation.');
  await browser.close();
})();
