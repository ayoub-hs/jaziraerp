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

    const searchInput = page.locator('input[data-scanner-input="true"]');
    await searchInput.fill('619100000001');
    await searchInput.press('Enter');
    await page.waitForTimeout(300);

    await searchInput.fill('619100000002');
    await searchInput.press('Enter');
    await page.waitForTimeout(300);

    const rowCount = await page.locator('.cart-row').count();
    console.log('Cart row count after entering barcodes:', rowCount);

    const firstRowText = await page.locator('.cart-row').first().textContent();
    console.log('First cart row summary:', firstRowText?.slice(0, 80));

    await browser.close();
  } finally {
    server.kill();
  }
}

run().catch(console.error);
