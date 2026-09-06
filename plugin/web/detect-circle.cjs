const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ colorScheme: 'dark' });

  // Go to intent list
  await page.goto('http://localhost:5173/objects/intent');
  await page.waitForTimeout(2000);

  // Click and immediately capture computed styles of key elements during animation
  await page.click('button:has-text("intent-0001")');

  // Capture styles at 100ms intervals for 1 second
  for (let i = 0; i < 10; i++) {
    const styles = await page.evaluate(() => {
      const main = document.querySelector('main');
      const root = document.getElementById('root');
      const layout = document.querySelector('[class*="flex h-screen"]');
      const contentDiv = main?.firstElementChild;

      const getInfo = (el, name) => {
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        return {
          name,
          tag: el.tagName,
          cls: el.className?.toString()?.substring(0, 100),
          borderRadius: cs.borderRadius,
          outline: cs.outline,
          outlineWidth: cs.outlineWidth,
          boxShadow: cs.boxShadow,
          border: cs.border,
          clipPath: cs.clipPath,
          transition: cs.transition,
          animation: cs.animation,
        };
      };

      return [
        getInfo(layout, 'layout'),
        getInfo(main, 'main'),
        getInfo(contentDiv, 'contentDiv'),
        getInfo(root, 'root'),
      ];
    });
    console.log(`Frame ${i * 100}ms:`, JSON.stringify(styles, null, 2));
    await page.waitForTimeout(100);
  }

  await browser.close();
})();
