const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ colorScheme: 'dark' });

  // Navigate to intent list first
  await page.goto('http://localhost:5173/objects/intent');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'frame-00-list.png' });

  // Click the first intent and capture frames during transition
  const clickPromise = page.click('button:has-text("intent-0001")');

  // Capture multiple frames immediately after click
  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(100);
    await page.screenshot({ path: `frame-${String(i).padStart(2, '0')}-click.png` });
  }

  // Wait for click to complete
  await clickPromise;

  // More frames after navigation starts
  for (let i = 11; i <= 20; i++) {
    await page.waitForTimeout(100);
    try {
      await page.screenshot({ path: `frame-${String(i).padStart(2, '0')}-nav.png` });
    } catch(e) {}
  }

  // Final frame after full load
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'frame-final.png', fullPage: true });

  console.log('Done! Captured 21 frames.');
  await browser.close();
})();
