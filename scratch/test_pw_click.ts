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

    // Look for product buttons
    const buttons = await page.$$('button:has(h3)');
    console.log('Product group buttons found:', buttons.length);
    if (buttons.length > 0) {
      await buttons[0].click();
      await page.waitForTimeout(500);

      // Check if modal opened or cart row added
      const modal = await page.$('.fixed.inset-0');
      console.log('Modal opened?', Boolean(modal));
      if (modal) {
        // Click first item inside modal
        const modalButtons = await modal.$$('button:has-text("DT")');
        console.log('Modal product buttons:', modalButtons.length);
        if (modalButtons.length > 0) {
          await modalButtons[0].click();
          await page.waitForTimeout(500);
        }
      }

      const cartRows = await page.$$eval('.cart-row', els => els.length);
      console.log('Cart rows after click:', cartRows);
    }

    await browser.close();
  } finally {
    server.kill();
  }
}

run().catch(console.error);
