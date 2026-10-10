import { chromium } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, res => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`Status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.end();
      });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function run() {
  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      DATABASE_PATH: '/tmp/audit_test.sqlite',
      PORT: '3344',
      HOST: '127.0.0.1'
    },
    stdio: 'ignore'
  });

  try {
    await waitForServer('http://127.0.0.1:3344/api/health');

    const browser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: true
    });

    const context = await browser.newContext({
      viewport: { width: 1600, height: 780 },
      deviceScaleFactor: 1
    });

    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3344');
    await page.waitForTimeout(1000);

    // Click first family tile
    const tiles = await page.$$('div:has(> div > h3)');
    console.log('Found tiles:', tiles.length);
    if (tiles.length > 0) {
      await tiles[0].click();
      await page.waitForTimeout(500);

      // In FamilySizesModal, click first SKU
      const skuItem = await page.$('.fixed.inset-0 .divide-y > div div.cursor-pointer');
      console.log('SKU item found:', Boolean(skuItem));
      if (skuItem) {
        await skuItem.click();
        await page.waitForTimeout(500);
      }

      const rows = await page.$$('.cart-row');
      console.log('Cart rows:', rows.length);
    }

    await browser.close();
  } finally {
    server.kill();
  }
}

run().catch(console.error);
