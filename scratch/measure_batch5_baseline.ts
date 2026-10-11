import { chromium, type Browser, type Page } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedAuditDb } from './seed_audit_db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_BASELINE_PATH = path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/before_batch5.json');

const VIEWPORTS = [
  { name: 'desktop_1600x900', width: 1600, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'desktop_1600x780', width: 1600, height: 780, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'desktop_1280x720', width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'phone_384x725', width: 384, height: 725, deviceScaleFactor: 2.81, isMobile: true, hasTouch: true },
  { name: 'phone_384x790', width: 384, height: 790, deviceScaleFactor: 2.81, isMobile: true, hasTouch: true }
];

async function waitForServer(url: string, timeoutMs = 20000): Promise<void> {
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
  throw new Error(`Timeout waiting for server at ${url}`);
}

async function runBaseline() {
  console.log('=== STARTING BATCH UI-5 BASELINE MEASUREMENTS ===');
  const dbPath = '/tmp/audit_test_b5_baseline.sqlite';
  seedAuditDb(dbPath);

  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      PORT: '3377',
      HOST: '127.0.0.1'
    },
    stdio: 'ignore'
  });

  const baselineData: Record<string, any> = {
    timestamp: new Date().toISOString(),
    description: 'Baseline measurements for Batch UI-5 (header polish, cart decimals/tags, contrast elevation)',
    emerald600WhitePairsCount: 14,
    slate400Count: 190,
    viewports: {}
  };

  try {
    await waitForServer('http://127.0.0.1:3377/api/health');
    console.log('Server is healthy on port 3377');

    const browser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: true
    });

    for (const vp of VIEWPORTS) {
      console.log(`Testing viewport: ${vp.name} (${vp.width}x${vp.height})`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.deviceScaleFactor,
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch
      });

      const page = await context.newPage();
      await page.addInitScript(`
        try {
          localStorage.setItem('aljazira_is_configured', 'true');
          localStorage.setItem('aljazira_is_locked', 'false');
          localStorage.setItem('aljazira_pin_hash', 'configured_hash');
        } catch(e) {}
      `);

      await page.goto('http://127.0.0.1:3377');
      await page.waitForTimeout(1000);

      // Measure header height
      const headerHeight = await page.evaluate(() => {
        const h = document.querySelector('header');
        return h ? Math.round(h.getBoundingClientRect().height * 10) / 10 : 0;
      });

      let cartData: any = null;

      // In desktop viewports (1600x900 and 1600x780), build 7-line cart
      if (!vp.isMobile && vp.width === 1600) {
        const barcodes = [
          '619100000001',
          '619100000002',
          '619100000003',
          '619100000004',
          '619100000005',
          '619100000006',
          '619100000007'
        ];
        const searchInput = page.locator('input[data-scanner-input="true"]');
        for (const b of barcodes) {
          await searchInput.fill(b);
          await searchInput.press('Enter');
          await page.waitForTimeout(150);
        }

        cartData = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('.cart-row'));
          const container = document.querySelector('.overflow-y-auto.divide-y') as HTMLElement | null;
          const cRect = container ? container.getBoundingClientRect() : { top: 0, bottom: 0, height: 0 };
          const innerH = window.innerHeight;

          const details = rows.map((r, i) => {
            const rect = r.getBoundingClientRect();
            const inC = rect.top >= cRect.top && rect.bottom <= cRect.bottom;
            const inV = rect.top >= 0 && rect.bottom <= innerH;
            return {
              index: i + 1,
              height: Math.round(rect.height * 10) / 10,
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
              isInsideContainer: inC,
              isInsideViewport: inV,
              isFullyVisible: inC && inV,
              title: (r.querySelector('h4')?.textContent || '').trim()
            };
          });

          return {
            totalRows: rows.length,
            visibleRowsCount: details.filter(d => d.isFullyVisible).length,
            rows: details,
            containerHeight: Math.round(cRect.height * 10) / 10
          };
        });
      }

      baselineData.viewports[vp.name] = {
        headerHeight,
        cart: cartData
      };

      console.log(`  Header height: ${headerHeight}px`);
      if (cartData) {
        console.log(`  7-line cart total rows: ${cartData.totalRows}, visible rows: ${cartData.visibleRowsCount}`);
      }

      await context.close();
    }

    await browser.close();

    fs.writeFileSync(OUTPUT_BASELINE_PATH, JSON.stringify(baselineData, null, 2), 'utf-8');
    console.log(`Saved baseline to ${OUTPUT_BASELINE_PATH}`);
  } finally {
    server.kill();
  }
}

runBaseline().catch(err => {
  console.error('Baseline run failed:', err);
  process.exit(1);
});
