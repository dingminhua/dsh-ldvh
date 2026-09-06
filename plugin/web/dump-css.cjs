const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ colorScheme: 'dark' });

  // Go to page and wait for the circle to appear
  await page.goto('http://localhost:5173/objects/intent/intent-0001');
  await page.waitForTimeout(150); // Capture at ~150ms when circle should be visible

  // Dump ALL stylesheet rules that could produce a circle
  const allRules = await page.evaluate(() => {
    const results = [];
    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            const css = rule.cssText || '';
            if (css.match(/border-radius.*[5-9][0-9]{2}%|clip-path|@keyframes|outline.*circle|radial|animation.*ring/i) ||
                css.match(/transition.*all/i)) {
              results.push(css.substring(0, 300));
            }
          }
        } catch(e) { /* cross-origin */ }
      }
    } catch(e) {}
    return results;
  });

  console.log('Suspicious CSS rules:');
  console.log(JSON.stringify(allRules, null, 2));

  // Also check every single element for ANY non-zero border-radius > 10px
  const bigRadius = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('*').forEach(el => {
      const cs = window.getComputedStyle(el);
      const br = parseFloat(cs.borderRadius);
      if (br > 10 && br < 9999) {
        results.push({
          tag: el.tagName,
          cls: el.className?.toString()?.substring(0, 80),
          br: cs.borderRadius,
        });
      }
    });
    return results;
  });
  console.log('\nElements with border-radius > 10px:');
  console.log(JSON.stringify(bigRadius, null, 2));

  await browser.close();
})();
