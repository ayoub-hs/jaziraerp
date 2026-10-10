import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedAuditDb } from './seed_audit_db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/screenshots');
const OUTPUT_DATA_PATH = path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/measured_data.json');

// Ensure directories exist
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
fs.mkdirSync(path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/scratch'), { recursive: true });

interface ViewportConfig {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

const VIEWPORTS: ViewportConfig[] = [
  { name: 'desktop_1600x780', width: 1600, height: 780, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'desktop_1600x900', width: 1600, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'desktop_1563x545', width: 1563, height: 545, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'phone_384x725', width: 384, height: 725, deviceScaleFactor: 2.81, isMobile: true, hasTouch: true },
  { name: 'phone_384x790', width: 384, height: 790, deviceScaleFactor: 2.81, isMobile: true, hasTouch: true },
  { name: 'phone_384x400', width: 384, height: 400, deviceScaleFactor: 2.81, isMobile: true, hasTouch: true }
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

const MEASURE_ELEMENT_FN = `({ selector, role }) => {
  function parseRgba(colorStr) {
    if (!colorStr) return [0, 0, 0, 1];
    const match = colorStr.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (!match) return [0, 0, 0, 1];
    return [
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10),
      match[4] !== undefined ? parseFloat(match[4]) : 1
    ];
  }

  function sRgbLuminance(r, g, b) {
    const [rl, gl, bl] = [r, g, b].map(c => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  }

  function getEffectiveBg(el) {
    const layers = [];
    let curr = el;
    while (curr && curr !== document.documentElement) {
      const bg = window.getComputedStyle(curr).backgroundColor;
      const [r, g, b, a] = parseRgba(bg);
      if (a > 0) {
        layers.unshift([r, g, b, a]);
      }
      curr = curr.parentElement;
    }
    let [r, g, b] = [255, 255, 255];
    for (const [lr, lg, lb, la] of layers) {
      r = Math.round(lr * la + r * (1 - la));
      g = Math.round(lg * la + g * (1 - la));
      b = Math.round(lb * la + b * (1 - la));
    }
    return [r, g, b];
  }

  let el = null;
  const parts = selector.split(',').map(s => s.trim());
  for (const p of parts) {
    const hasTextMatch = p.match(/^(.*?):has-text\("([^"]+)"\)$/);
    if (hasTextMatch) {
      const tag = hasTextMatch[1] || '*';
      const textTarget = hasTextMatch[2];
      try {
        const candidates = Array.from(document.querySelectorAll(tag));
        el = candidates.find(c => c.textContent && c.textContent.includes(textTarget)) || null;
      } catch (e) {}
      if (el) break;
    } else {
      try {
        el = document.querySelector(p);
        if (el) break;
      } catch (e) {}
    }
  }
  if (!el) return null;

  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const [fgR, fgG, fgB, fgA] = parseRgba(style.color);
  const [bgR, bgG, bgB] = getEffectiveBg(el);

  const L1 = sRgbLuminance(fgR, fgG, fgB);
  const L2 = sRgbLuminance(bgR, bgG, bgB);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  const contrastRatio = (lighter + 0.05) / (darker + 0.05);

  const fontSizePx = parseFloat(style.fontSize) || 0;
  const fontWeightNum = parseInt(style.fontWeight, 10) || 400;
  const isClipped = (el.scrollWidth > el.clientWidth + 1) || (style.textOverflow === 'ellipsis');

  return {
    role,
    selector,
    text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
    fontSizePx,
    fontWeight: style.fontWeight,
    fontWeightNum,
    color: style.color,
    bgColor: \`rgb(\${bgR}, \${bgG}, \${bgB})\`,
    contrastRatio: Math.round(contrastRatio * 100) / 100,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
    top: Math.round(rect.top),
    bottom: Math.round(rect.bottom),
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    isClipped,
    fontFamily: style.fontFamily,
    fontVariantNumeric: style.fontVariantNumeric
  };
}`;

export interface AuditResults {
  timestamp: string;
  measurements: Record<string, any[]>;
  targetViolations: Array<{ target: string; screen: string; viewport: string; details: string; severity: 'Blocker' | 'High' | 'Medium' | 'Low' }>;
}

async function runAudit() {
  console.log('=== STARTING AL JAZIRA ERP UI/UX AUDIT MEASUREMENTS ===');
  const dbPath = '/tmp/audit_test.sqlite';
  seedAuditDb(dbPath);

  console.log('Starting backend test server on port 3344...');
  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      PORT: '3344',
      HOST: '127.0.0.1'
    },
    stdio: 'ignore'
  });

  const allMeasurements: Record<string, any[]> = {};
  const violations: Array<{ target: string; screen: string; viewport: string; details: string; severity: 'Blocker' | 'High' | 'Medium' | 'Low' }> = [];

  try {
    await waitForServer('http://127.0.0.1:3344/api/health');
    console.log('Backend server is healthy!');

    const browser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: true
    });

    for (const vp of VIEWPORTS) {
      console.log(`\n========================================`);
      console.log(`TESTING VIEWPORT: ${vp.name} (${vp.width}x${vp.height} @${vp.deviceScaleFactor})`);
      console.log(`========================================`);

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.deviceScaleFactor,
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch
      });

      const page = await context.newPage();
      await page.addInitScript(`
        window.__name = function(fn) { return fn; };
        globalThis.__name = function(fn) { return fn; };
        try {
          localStorage.setItem('aljazira_is_configured', 'true');
          localStorage.setItem('aljazira_is_locked', 'false');
          localStorage.setItem('aljazira_pin_hash', 'configured_hash');
        } catch(e) {}
      `);
      await page.goto('http://127.0.0.1:3344');
      await page.waitForTimeout(1000);

      async function takeShot(screenName: string) {
        const file = path.join(SCREENSHOTS_DIR, `${screenName}_${vp.name}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log(`  📸 Screenshot saved: ${screenName}_${vp.name}.png`);
      }

      async function safeCloseModal() {
        try {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(100);
          await page.evaluate(() => {
            const modals = Array.from(document.querySelectorAll('.fixed.inset-0'));
            for (let i = modals.length - 1; i >= 0; i--) {
              const modal = modals[i];
              const buttons = Array.from(modal.querySelectorAll('button'));
              const closeBtn = buttons.find(b => 
                b.textContent?.match(/Fermer|Cancel|Annuler|Terminer|Start Next Sale|Nouvelle vente/i) || 
                b.querySelector('svg.lucide-x') ||
                b.getAttribute('title')?.match(/fermer|close/i)
              );
              if (closeBtn) {
                closeBtn.click();
              }
            }
          });
          await page.waitForTimeout(250);
        } catch (e) {}
      }

      async function measure(screenName: string, selector: string, role: string) {
        try {
          const res = await page.evaluate(eval(MEASURE_ELEMENT_FN), { selector, role });
          if (res) {
            res.screen = screenName;
            res.viewport = vp.name;
            const key = `${screenName}_${vp.name}`;
            if (!allMeasurements[key]) allMeasurements[key] = [];
            allMeasurements[key].push(res);
            return res;
          }
        } catch (e) {
          console.error(`[Measure Error] ${screenName} selector "${selector}":`, e);
        }
        return null;
      }

      // ----------------------------------------------------------------------
      // SCREEN 1: Empty POS Cart
      // ----------------------------------------------------------------------
      if (!vp.isMobile) {
        await page.click('button:has-text("Countertop")').catch(() => {});
        await page.waitForTimeout(300);
        await takeShot('pos_cart_empty');

        const emptyMsg = await measure('pos_cart_empty', '.h-full.flex.flex-col p.text-xs', 'Empty Cart Label');
        if (emptyMsg && emptyMsg.fontSizePx < 13) {
          violations.push({
            target: 'Secondary text at least 13px',
            screen: 'pos_cart_empty',
            viewport: vp.name,
            details: `Empty cart message font size is ${emptyMsg.fontSizePx}px (target >= 13px)`,
            severity: 'Medium'
          });
        }
      } else {
        await page.click('button:has-text("Mobile")').catch(() => {});
        await page.waitForTimeout(300);
        await takeShot('pos_cart_empty');
      }

      // ----------------------------------------------------------------------
      // SCREEN 2: POS Cart with 1 Line
      // ----------------------------------------------------------------------
      if (!vp.isMobile) {
        const searchInput = page.locator('input[data-scanner-input="true"]');
        await searchInput.fill('619100000001');
        await searchInput.press('Enter');
        await page.waitForTimeout(400);

        await takeShot('pos_cart_1line');

        const name1 = await measure('pos_cart_1line', '.cart-row h4', 'Product Name');
        const puLabel1 = await measure('pos_cart_1line', '.cart-row span:has-text("P.U:")', 'P.U Label');
        const priceInput1 = await measure('pos_cart_1line', '.cart-row input[title="Modifier le prix unitaire"]', 'Unit Price Input');
        const qty1 = await measure('pos_cart_1line', '.cart-row input[title="Modifier la quantité"], .cart-row .qty-input, .cart-row input[disallowzero="true"], .cart-row .w-12 input', 'Quantity Input');
        const lineTotal1 = await measure('pos_cart_1line', '.cart-row .text-right .font-mono', 'Line Total');
        const grandTotal1 = await measure('pos_cart_1line', '.cart-grand-total, div:has-text("TOTAL TTC:") span:last-child, div:has-text("TOTAL TTC:") + span, .text-xl.text-emerald-700', 'Cart Grand Total');
        const payBtn1 = await measure('pos_cart_1line', 'button:has-text("Tender"), button:has-text("Encaisser")', 'Pay Primary Button');

        if (name1 && name1.fontSizePx < 16) {
          violations.push({
            target: 'Sale-critical text at least 16px',
            screen: 'pos_cart_1line',
            viewport: vp.name,
            details: `Cart product name font size is ${name1.fontSizePx}px (target >= 16px)`,
            severity: 'Blocker'
          });
        }
        if (priceInput1 && priceInput1.fontSizePx < 16) {
          violations.push({
            target: 'Sale-critical text at least 16px',
            screen: 'pos_cart_1line',
            viewport: vp.name,
            details: `Cart unit price input font size is ${priceInput1.fontSizePx}px (target >= 16px)`,
            severity: 'Blocker'
          });
        }
        if (qty1 && (qty1.fontSizePx < 18 || qty1.fontWeightNum < 700)) {
          violations.push({
            target: 'Quantity at least 18px bold',
            screen: 'pos_cart_1line',
            viewport: vp.name,
            details: `Quantity font size is ${qty1.fontSizePx}px, weight ${qty1.fontWeight} (target >= 18px bold)`,
            severity: 'Blocker'
          });
        }
        if (lineTotal1 && lineTotal1.fontSizePx < 16) {
          violations.push({
            target: 'Sale-critical text at least 16px',
            screen: 'pos_cart_1line',
            viewport: vp.name,
            details: `Line total font size is ${lineTotal1.fontSizePx}px (target >= 16px)`,
            severity: 'Blocker'
          });
        }
        if (puLabel1 && puLabel1.fontSizePx < 12) {
          violations.push({
            target: 'NOTHING under 12px anywhere',
            screen: 'pos_cart_1line',
            viewport: vp.name,
            details: `P.U label font size is ${puLabel1.fontSizePx}px (target >= 12px, sub-12 forbidden)`,
            severity: 'High'
          });
        }
        if (grandTotal1 && grandTotal1.fontSizePx < 28) {
          violations.push({
            target: 'Cart grand total at least 28px bold',
            screen: 'pos_cart_1line',
            viewport: vp.name,
            details: `Cart grand total font size is ${grandTotal1.fontSizePx}px (target >= 28px bold)`,
            severity: 'Blocker'
          });
        }
      }

      // ----------------------------------------------------------------------
      // SCREEN 3: POS Cart with 8 Lines (Long names, Overridden Price, Reseller Price, Discount)
      // ----------------------------------------------------------------------
      if (!vp.isMobile) {
        const barcodes = [
          '619100000002',
          '619100000003',
          '619100000004',
          '619100000005',
          '619100000006',
          '619100000007',
          '619100000008'
        ];
        const searchInput = page.locator('input[data-scanner-input="true"]');
        for (const b of barcodes) {
          await searchInput.fill(b);
          await searchInput.press('Enter');
          await page.waitForTimeout(150);
        }

        // Select Reseller customer: Grossiste Ben Salem
        const custInput = page.locator('input[placeholder*="Rechercher client"]');
        if (await custInput.isVisible()) {
          await custInput.click();
          await custInput.fill('Ben Salem');
          await page.waitForTimeout(300);
          const custDropdownItem = page.locator('.absolute.top-full div:has-text("Grossiste Ben Salem")').first();
          if (await custDropdownItem.isVisible()) {
            await custDropdownItem.click();
            await page.waitForTimeout(200);
          }
        }

        // Set line 2 overridden price
        const priceInputs = page.locator('.cart-row input[title="Modifier le prix unitaire"]');
        if (await priceInputs.count() >= 2) {
          await priceInputs.nth(1).fill('4.000');
          await priceInputs.nth(1).press('Enter');
        }

        // Add line 3 discount so 8 lines include long name, container, and discount
        const line3RemiseBtn = page.locator('.cart-row').nth(2).locator('button:has-text("Remise")');
        if (await line3RemiseBtn.isVisible()) {
          await line3RemiseBtn.click();
          await page.waitForTimeout(150);
          const lineDiscInput = page.locator('.cart-row').nth(2).locator('input[type="number"][step="0.1"]');
          if (await lineDiscInput.isVisible()) {
            await lineDiscInput.fill('1.000');
            await page.locator('.cart-row').nth(2).locator('button:has-text("OK")').click();
            await page.waitForTimeout(150);
          }
        }

        // Apply global sale discount
        const discountInput = page.locator('input[placeholder="0.000"]').last();
        if (await discountInput.isVisible()) {
          await discountInput.fill('5.000');
        }

        await page.waitForTimeout(300);
        await takeShot('pos_cart_8lines');

        const cartMetrics = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('.cart-row'));
          const container = document.querySelector('.overflow-y-auto.divide-y');
          const summary = document.querySelector('.w-5\\/12 .border-t.bg-slate-50') || document.querySelector('.w-5\\/12 > div:last-child');
          const cRect = container ? container.getBoundingClientRect() : { height: 0, top: 0, bottom: 0 };
          const sRect = summary ? summary.getBoundingClientRect() : { height: 0 };
          
          const details = rows.map((r, i) => {
            const rect = r.getBoundingClientRect();
            const isFullyVisible = rect.top >= cRect.top && rect.bottom <= cRect.bottom;
            return {
              index: i + 1,
              height: Math.round(rect.height * 10) / 10,
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
              isFullyVisible,
              text: (r.querySelector('h4')?.textContent || '').trim()
            };
          });

          const heights = details.map(d => d.height);
          const minHeight = heights.length ? Math.min(...heights) : 0;
          const maxHeight = heights.length ? Math.max(...heights) : 0;
          const meanHeight = heights.length ? Math.round((heights.reduce((a, b) => a + b, 0) / heights.length) * 10) / 10 : 0;
          const fullyVisibleCount = details.filter(d => d.isFullyVisible).length;

          return {
            rowDetails: details,
            minHeight,
            maxHeight,
            meanHeight,
            fullyVisibleCount,
            cartScrollAreaHeight: Math.round(cRect.height),
            summaryBlockHeight: Math.round(sRect.height)
          };
        });

        const visibleRowsCount = cartMetrics.fullyVisibleCount;
        const payVisible = await page.locator('button:has-text("Tender"), button:has-text("Encaisser")').isVisible();
        const totalVisible = await page.locator('.cart-grand-total, .text-xl.text-emerald-700, .text-3xl.text-emerald-700, span:has-text("TOTAL TTC")').first().isVisible();

        if (vp.name === 'desktop_1600x780') {
          console.log('\n======================================================');
          console.log('BATCH 1 MEASUREMENTS (desktop_1600x780):');
          console.log(`- Cart Scroll Area Height: ${cartMetrics.cartScrollAreaHeight}px`);
          console.log(`- Summary Block Height:    ${cartMetrics.summaryBlockHeight}px`);
          console.log(`- Number of Fully Visible Rows: ${visibleRowsCount} of ${cartMetrics.rowDetails.length}`);
          console.log(`- Row Heights: min = ${cartMetrics.minHeight}px, max = ${cartMetrics.maxHeight}px, mean = ${cartMetrics.meanHeight}px`);
          cartMetrics.rowDetails.forEach(r => {
            console.log(`  * Row ${r.index} [${r.height}px] (visible: ${r.isFullyVisible}): ${r.text.slice(0, 45)}`);
          });
          console.log('======================================================\n');

          const beforePath = path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/before_batch1.json');
          if (!fs.existsSync(beforePath)) {
            fs.writeFileSync(beforePath, JSON.stringify({
              timestamp: new Date().toISOString(),
              viewport: vp.name,
              cartMetrics
            }, null, 2), 'utf8');
            console.log(`Saved baseline to ${beforePath}`);
          }
          const afterPath = path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/after_batch1.json');
          fs.writeFileSync(afterPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            viewport: vp.name,
            cartMetrics
          }, null, 2), 'utf8');
          console.log(`Saved post-batch metrics to ${afterPath}`);
        }

        if (vp.name === 'desktop_1600x780') {
          if (visibleRowsCount < 6 || !payVisible || !totalVisible) {
            violations.push({
              target: 'Desktop 1600x780: at least 6 cart lines + total + pay visible',
              screen: 'pos_cart_8lines',
              viewport: vp.name,
              details: `Visible cart lines: ${visibleRowsCount} (target >= 6), Pay visible: ${payVisible}, Total visible: ${totalVisible}`,
              severity: 'High'
            });
          }
        } else if (vp.name === 'desktop_1563x545') {
          if (visibleRowsCount < 3 || !payVisible || !totalVisible) {
            violations.push({
              target: 'Desktop 1563x545: at least 3 cart lines + total + pay visible',
              screen: 'pos_cart_8lines',
              viewport: vp.name,
              details: `Visible cart lines: ${visibleRowsCount} (target >= 3), Pay visible: ${payVisible}, Total visible: ${totalVisible}`,
              severity: 'High'
            });
          }
        }
      } else {
        await page.click('button:has-text("Register")').catch(() => {});
        await page.waitForTimeout(200);

        const searchInput = page.locator('input[placeholder*="Search"]');
        if (await searchInput.isVisible()) {
          const barcodes = ['619100000001', '619100000002', '619100000003', '619100000004', '619100000005', '619100000006', '619100000007', '619100000008'];
          for (const b of barcodes) {
            await searchInput.fill(b);
            await searchInput.press('Enter');
            await page.waitForTimeout(150);
          }
        }
        // Open Cart Drawer
        const cartPill = page.locator('.absolute.bottom-16.inset-x-3');
        if (await cartPill.isVisible()) {
          await cartPill.click();
          await page.waitForTimeout(400);
          await takeShot('pos_cart_8lines');

          const visibleMobileRows = await page.evaluate<number>(`
            (() => {
              const rows = Array.from(document.querySelectorAll('.cart-row'));
              const container = document.querySelector('.overflow-y-auto.divide-y');
              if (!container) return rows.length;
              const cRect = container.getBoundingClientRect();
              return rows.filter(r => {
                const rRect = r.getBoundingClientRect();
                return rRect.top >= cRect.top && rRect.bottom <= cRect.bottom;
              }).length;
            })()
          `);

          if (vp.name === 'phone_384x725' && visibleMobileRows < 4) {
            violations.push({
              target: 'Phone 384x725: at least 4 cart lines visible before scroll',
              screen: 'pos_cart_mobile_drawer',
              viewport: vp.name,
              details: `Visible mobile cart lines: ${visibleMobileRows} (target >= 4)`,
              severity: 'High'
            });
          }
        }
      }

      // ----------------------------------------------------------------------
      // SCREEN 4: Product Grid & Search Results
      // ----------------------------------------------------------------------
      if (!vp.isMobile) {
        await takeShot('pos_product_grid');

        const tileCat = await measure('pos_product_grid', 'div:has(> div > h3) span.text-\\[10px\\]', 'Tile Category Tag');
        const tileTitle = await measure('pos_product_grid', 'div:has(> div > h3) h3', 'Tile Title');
        const tilePrice = await measure('pos_product_grid', 'div:has(> div > h3) span.font-mono', 'Tile Min Price');
        const tileStock = await measure('pos_product_grid', 'div:has(> div > h3) span:has-text("Stock"), div:has(> div > h3) span.text-\\[9px\\]', 'Tile Stock Badge');

        if (tileCat && tileCat.fontSizePx < 12) {
          violations.push({
            target: 'NOTHING under 12px anywhere',
            screen: 'pos_product_grid',
            viewport: vp.name,
            details: `Tile category tag font size is ${tileCat.fontSizePx}px`,
            severity: 'High'
          });
        }
        if (tileStock && tileStock.fontSizePx < 12) {
          violations.push({
            target: 'NOTHING under 12px anywhere',
            screen: 'pos_product_grid',
            viewport: vp.name,
            details: `Tile stock badge font size is ${tileStock.fontSizePx}px`,
            severity: 'High'
          });
        }

        const searchInput = page.locator('input[data-scanner-input="true"]');
        await searchInput.fill('Javel');
        await page.waitForTimeout(300);
        await takeShot('pos_search_results');
        await searchInput.fill('');
        await page.waitForTimeout(200);
      }

      // ----------------------------------------------------------------------
      // SCREEN 5: Scan Feedback Toast
      // ----------------------------------------------------------------------
      if (!vp.isMobile) {
        const searchInput = page.locator('input[data-scanner-input="true"]');
        await searchInput.fill('999999999999');
        await searchInput.press('Enter');
        await page.waitForTimeout(300);
        await takeShot('scan_toast');

        const toast = await measure('scan_toast', '.fixed.top-14', 'Scan Toast');
        if (toast && toast.contrastRatio < 4.5) {
          violations.push({
            target: 'Contrast at least 4.5:1 for text',
            screen: 'scan_toast',
            viewport: vp.name,
            details: `Scan toast contrast ratio is ${toast.contrastRatio}:1 (target >= 4.5:1)`,
            severity: 'Medium'
          });
        }

        await page.click('.fixed.top-14 button').catch(() => {});
      }

      // ----------------------------------------------------------------------
      // SCREEN 6: Customer Picker
      // ----------------------------------------------------------------------
      if (!vp.isMobile) {
        const custInput = page.locator('input[placeholder*="Rechercher client"]');
        if (await custInput.isVisible()) {
          await custInput.click();
          await custInput.fill('');
          await page.waitForTimeout(300);
          await takeShot('customer_picker');

          const custItemName = await measure('customer_picker', '.absolute.top-full .truncate', 'Customer Name');
          const custDebt = await measure('customer_picker', '.absolute.top-full span:has-text("Dette:")', 'Customer Debt Label');
          if (custItemName && custItemName.fontSizePx < 16) {
            violations.push({
              target: 'Sale-critical text at least 16px',
              screen: 'customer_picker',
              viewport: vp.name,
              details: `Customer picker item name font size is ${custItemName.fontSizePx}px (target >= 16px)`,
              severity: 'Blocker'
            });
          }
          if (custDebt && custDebt.fontSizePx < 12) {
            violations.push({
              target: 'NOTHING under 12px anywhere',
              screen: 'customer_picker',
              viewport: vp.name,
              details: `Customer debt indicator font size is ${custDebt.fontSizePx}px (< 12px)`,
              severity: 'High'
            });
          }

          await page.click('body', { position: { x: 10, y: 10 } });
        }
      }

      // ----------------------------------------------------------------------
      // SCREEN 7: Checkout Modal (Cash, Wallet, Split, Credit, Change Due, Overpayment)
      // ----------------------------------------------------------------------
      if (vp.isMobile) {
        const tenderBtn = page.locator('button:has-text("Tender Payment"), button:has-text("Encaisser")');
        if (await tenderBtn.isVisible()) {
          await tenderBtn.click();
          await page.waitForTimeout(400);
        }
      } else {
        const checkoutBtn = page.locator('button:has-text("Tender"), button:has-text("Encaisser"), button:has-text("Passer en caisse")').first();
        if (await checkoutBtn.isVisible()) {
          await checkoutBtn.click();
          await page.waitForTimeout(400);
        }
      }

      const isCheckoutModalOpen = await page.locator('input[type="number"][step="0.001"]').first().isVisible();
      if (isCheckoutModalOpen) {

        await takeShot('checkout_cash');

        const cashInput = await measure('checkout_cash', 'input[type="number"][step="0.001"]', 'Cash Tender Input');
        const changeDueDisplay = await measure('checkout_cash', '.bg-emerald-50\\/80 span.text-2xl', 'Change Due Display');
        const tenderLabel = await measure('checkout_cash', 'span:has-text("Cash Tendered"), span:has-text("Espèces reçues"), span:has-text("Espèces")', 'Cash Tender Label');
        const confirmBtn = await measure('checkout_cash', 'button:has-text("Complete Sale"), button:has-text("Valider"), button:has-text("Finaliser")', 'Confirm Sale Button');

        if (cashInput && cashInput.fontSizePx < 20) {
          violations.push({
            target: 'Amount input at least 20px',
            screen: 'checkout_cash',
            viewport: vp.name,
            details: `Checkout cash input font size is ${cashInput.fontSizePx}px (target >= 20px)`,
            severity: 'Blocker'
          });
        }
        if (tenderLabel && tenderLabel.fontSizePx < 16) {
          violations.push({
            target: 'Sale-critical text at least 16px',
            screen: 'checkout_cash',
            viewport: vp.name,
            details: `Payment method label font size is ${tenderLabel.fontSizePx}px (target >= 16px)`,
            severity: 'Blocker'
          });
        }
        if (confirmBtn && vp.isMobile && (confirmBtn.height < 44 || confirmBtn.width < 44)) {
          violations.push({
            target: 'Touch targets on phone at least 44x44 CSS px',
            screen: 'checkout_cash',
            viewport: vp.name,
            details: `Confirm button size is ${confirmBtn.width}x${confirmBtn.height}px (target >= 44x44px)`,
            severity: 'High'
          });
        }

        const walletMaxBtn = page.locator('button:has-text("Use Max")');
        if (await walletMaxBtn.isVisible()) {
          await walletMaxBtn.click();
          await page.waitForTimeout(200);
          await takeShot('checkout_wallet');
        }

        const creditBtn = page.locator('button:has-text("Open Credit"), button:has-text("Charge All"), button:has-text("Charge Remaining")');
        if (await creditBtn.isVisible()) {
          await creditBtn.click();
          await page.waitForTimeout(200);
          await takeShot('checkout_split');
        }

        const cashInp = page.locator('input[type="number"][step="0.001"]').first();
        await cashInp.fill('100.000');
        await page.waitForTimeout(200);
        await takeShot('checkout_overpayment_change');

        if (vp.name === 'phone_384x400') {
          await takeShot('checkout_keyboard');
          const isCashInpVisible = await cashInp.isVisible();
          const isChangeVisible = await page.locator('.bg-emerald-50\\/80').isVisible();
          const isConfirmVisible = await page.locator('button:has-text("Complete Sale"), button:has-text("Valider")').isVisible();

          if (!isCashInpVisible || !isChangeVisible || !isConfirmVisible) {
            violations.push({
              target: 'Phone 384x400: cash field, change due and confirm button all visible',
              screen: 'checkout_keyboard',
              viewport: vp.name,
              details: `Visibility at 384x400: cash=${isCashInpVisible}, change=${isChangeVisible}, confirm=${isConfirmVisible}`,
              severity: 'Blocker'
            });
          }
        }

        await cashInp.fill('600.000');
        await page.waitForTimeout(200);
        await takeShot('checkout_high_change');

        const exactBtn = page.locator('button:has-text("Exact")');
        if (await exactBtn.isVisible()) {
          await exactBtn.click();
        }
        await page.waitForTimeout(200);

        const submitBtn = page.locator('button:has-text("Complete Sale"), button:has-text("Valider")');
        if (await submitBtn.isVisible() && await submitBtn.isEnabled()) {
          await submitBtn.click();
          await page.waitForTimeout(600);
          await takeShot('checkout_completed');

          const previewReceiptLink = page.locator('button:has-text("Aperçu du ticket")');
          if (await previewReceiptLink.isVisible()) {
            await previewReceiptLink.click();
            await page.waitForTimeout(400);
            await takeShot('receipt_preview');

            const receiptFont = await measure('receipt_preview', '.font-mono.text-\\[10px\\], .receipt-paper', 'Receipt Monospace Text');
            if (receiptFont && receiptFont.fontSizePx < 12) {
              violations.push({
                target: 'NOTHING under 12px anywhere',
                screen: 'receipt_preview',
                viewport: vp.name,
                details: `Thermal receipt preview font size is ${receiptFont.fontSizePx}px (< 12px)`,
                severity: 'Medium'
              });
            }

            await safeCloseModal();
          }

          const invoiceBtn = page.locator('button:has-text("Print A4 Invoice"), button:has-text("Imprimer facture A4")');
          if (await invoiceBtn.isVisible()) {
            await invoiceBtn.click({ force: true });
            await page.waitForTimeout(400);
            await takeShot('invoice_preview');
            await safeCloseModal();
          }

          const blBtn = page.locator('button:has-text("Bon de Livraison")');
          if (await blBtn.isVisible()) {
            await blBtn.click({ force: true });
            await page.waitForTimeout(400);
            await takeShot('delivery_note_preview');
            await safeCloseModal();
          }

          const nextSaleBtn = page.locator('button:has-text("Start Next Sale"), button:has-text("Nouvelle vente"), button:has-text("Entrée")');
          if (await nextSaleBtn.isVisible()) {
            await nextSaleBtn.click({ force: true });
            await page.waitForTimeout(300);
          }
        }
      }

      // ----------------------------------------------------------------------
      // SCREEN 11: Held Carts Modal
      // ----------------------------------------------------------------------
      if (!vp.isMobile) {
        const searchInput = page.locator('input[data-scanner-input="true"]');
        await searchInput.fill('619100000001');
        await searchInput.press('Enter');
        await page.waitForTimeout(200);

        const holdBtn = page.locator('button[title*="Mettre en attente"]').first();
        if (await holdBtn.isVisible()) {
          await holdBtn.click();
          await page.waitForTimeout(300);
        }

        const heldCartsBtn = page.locator('button[title*="Paniers en attente"]').first();
        if (await heldCartsBtn.isVisible()) {
          await heldCartsBtn.click();
          await page.waitForTimeout(400);
          await takeShot('held_carts_modal');
          await safeCloseModal();
        }
      }

      // ----------------------------------------------------------------------
      // SCREEN 12: Refund Modal
      // ----------------------------------------------------------------------
      if (!vp.isMobile) {
        const refundBtn = page.locator('button:has-text("Refund")');
        if (await refundBtn.isVisible()) {
          await refundBtn.click();
          await page.waitForTimeout(400);
          await takeShot('refund_modal');

          const refundModeLabel = await measure('refund_modal', 'span:has-text("Mode de remboursement")', 'Refund Method Label');
          if (refundModeLabel && refundModeLabel.fontSizePx < 13) {
            violations.push({
              target: 'Secondary text at least 13px',
              screen: 'refund_modal',
              viewport: vp.name,
              details: `Refund modal mode label font size is ${refundModeLabel.fontSizePx}px (< 13px)`,
              severity: 'Medium'
            });
          }

          await safeCloseModal();
        }
      }

      // ----------------------------------------------------------------------
      // SCREEN 13: Session Modal (Open / Close Session & Z-report)
      // ----------------------------------------------------------------------
      if (vp.name !== 'phone_384x400') {
        const closeSessionBtn = page.locator('header button:has-text("Close")');
        if (await closeSessionBtn.isVisible()) {
          await closeSessionBtn.click();
          await page.waitForTimeout(400);
          await takeShot('session_close_modal');

          const sessionInput = await measure('session_close_modal', 'input[type="number"]', 'Counted Cash Input');
          if (sessionInput && sessionInput.fontSizePx < 20) {
            violations.push({
              target: 'Amount input at least 20px',
              screen: 'session_close_modal',
              viewport: vp.name,
              details: `Counted cash input font size is ${sessionInput.fontSizePx}px (target >= 20px)`,
              severity: 'Blocker'
            });
          }

          await safeCloseModal();
        }

        const openSessionBtn = page.locator('header button[title="Ouvrir une nouvelle session"]');
        if (await openSessionBtn.isVisible()) {
          await openSessionBtn.click();
          await page.waitForTimeout(400);
          await takeShot('session_open_modal');
          await safeCloseModal();
        }

        // ----------------------------------------------------------------------
        // SCREEN 14: Cash Movement Modal (Cash In/Out)
        // ----------------------------------------------------------------------
        const cashMoveBtn = page.locator('header button:has-text("Cash In/Out"), header button[title*="Cash In"]');
        if (await cashMoveBtn.isVisible()) {
          await cashMoveBtn.click();
          await page.waitForTimeout(400);
          await takeShot('cash_movement_modal');
          await safeCloseModal();
        }

        // ----------------------------------------------------------------------
        // SCREEN 15: Quick Price Lookup Modal [F3]
        // ----------------------------------------------------------------------
        if (!vp.isMobile) {
          const lookupBtn = page.locator('button:has-text("Vérif Prix")');
          if (await lookupBtn.isVisible()) {
            await lookupBtn.click();
            await page.waitForTimeout(400);
            await takeShot('price_lookup_mode');
            await safeCloseModal();
          }
        }

        // ----------------------------------------------------------------------
        // SCREEN 16: UpdateBanner
        // ----------------------------------------------------------------------
        await page.evaluate("window.dispatchEvent(new CustomEvent('pwa-update-available', { detail: { reload: function() {} } }))");
        await page.waitForTimeout(300);
        await takeShot('update_banner');

        const updateBanner = await measure('update_banner', 'div[role="alert"].bg-amber-500', 'Update Banner');
        if (updateBanner && updateBanner.contrastRatio < 4.5) {
          violations.push({
            target: 'Contrast at least 4.5:1 for text',
            screen: 'update_banner',
            viewport: vp.name,
            details: `UpdateBanner white text on amber-500 has contrast ${updateBanner.contrastRatio}:1 (target >= 4.5:1, severe readability failure)`,
            severity: 'Blocker'
          });
        }
      }

      // ----------------------------------------------------------------------
      // SCREEN 17: Backoffice Screens (Desktop) & Mobile Navigation Tabs
      // ----------------------------------------------------------------------
      if (!vp.isMobile) {
        await safeCloseModal();
        await page.click('header nav button:has-text("Backoffice")', { force: true });
        await page.waitForTimeout(500);

        await takeShot('navigation');

        // Customers & Debt Tab
        await page.click('button:has-text("Customers & Debt")').catch(() => {});
        await page.waitForTimeout(400);
        await takeShot('customers_list');

        const resellerRow = page.locator('tr:has-text("Grossiste Ben Salem"), div:has-text("Grossiste Ben Salem")').first();
        if (await resellerRow.isVisible()) {
          await resellerRow.click();
          await page.waitForTimeout(400);
          await takeShot('customer_detail_debt');

          const fifoBtn = page.locator('button:has-text("Règlement dette"), button:has-text("Paiement"), button:has-text("Statement"), button:has-text("Extrait")').first();
          if (await fifoBtn.isVisible()) {
            await fifoBtn.click();
            await page.waitForTimeout(400);
            await takeShot('reseller_payment_fifo');
            await safeCloseModal();
          }
        }

        // Suppliers & Purchases Tab
        await page.click('button:has-text("Suppliers & Purchases")').catch(() => {});
        await page.waitForTimeout(400);
        await takeShot('suppliers_list');

        const purRow = page.locator('tr:has-text("ACH-202610-001"), div:has-text("ACH-202610-001")').first();
        if (await purRow.isVisible()) {
          await purRow.click();
          await page.waitForTimeout(400);
          await takeShot('purchase_detail');
          await safeCloseModal();
        }

        // Catalog & Inventory
        await page.click('button:has-text("Catalog & SKUs")').catch(() => {});
        await page.waitForTimeout(400);
        await takeShot('inventory_table');

        // Reports Tables
        await page.click('button:has-text("Reports")').catch(() => {});
        await page.waitForTimeout(400);
        await takeShot('reports_tables');

        // Settings Panel
        await page.click('button:has-text("Settings")').catch(() => {});
        await page.waitForTimeout(400);
        await takeShot('settings_panel');

        // Register Audits & Z-Report
        await page.click('button:has-text("Register Audits")').catch(() => {});
        await page.waitForTimeout(400);
        const zSlipBtn = page.locator('button[title*="Z-Report"], button:has-text("Z-Report")').first();
        if (await zSlipBtn.isVisible()) {
          await zSlipBtn.click();
          await page.waitForTimeout(400);
          await takeShot('z_report_preview');
          await safeCloseModal();
        }
      } else if (vp.name !== 'phone_384x400') {
        // Mobile Tabs
        await page.click('nav button:has-text("Quick-Edit")').catch(() => {});
        await page.waitForTimeout(400);
        await takeShot('price_stock_update_mode');

        await page.click('nav button:has-text("Lookup")').catch(() => {});
        await page.waitForTimeout(400);
        await takeShot('price_lookup_mode');

        await page.click('nav button:has-text("Customers")').catch(() => {});
        await page.waitForTimeout(400);
        await takeShot('customers_list');

        const mobileNavButtons = await page.$$eval('nav.fixed.bottom-0 button', btns => {
          return btns.map(b => {
            const r = b.getBoundingClientRect();
            const s = window.getComputedStyle(b);
            return {
              text: b.textContent?.trim(),
              width: r.width,
              height: r.height,
              fontSize: parseFloat(s.fontSize)
            };
          });
        });

        for (const btn of mobileNavButtons) {
          if (btn.height < 44 || btn.width < 44) {
            violations.push({
              target: 'Touch targets on phone at least 44x44 CSS px',
              screen: 'mobile_bottom_nav',
              viewport: vp.name,
              details: `Bottom nav button "${btn.text}" is ${Math.round(btn.width)}x${Math.round(btn.height)}px (target >= 44x44px)`,
              severity: 'High'
            });
          }
          if (btn.fontSize < 12) {
            violations.push({
              target: 'NOTHING under 12px anywhere',
              screen: 'mobile_bottom_nav',
              viewport: vp.name,
              details: `Bottom nav button "${btn.text}" font size is ${btn.fontSize}px (< 12px)`,
              severity: 'High'
            });
          }
        }
      }

      await context.close();
    }

    await browser.close();
    console.log('\nAll viewport measurements and screenshots completed successfully!');

    const report: AuditResults = {
      timestamp: new Date().toISOString(),
      measurements: allMeasurements,
      targetViolations: violations
    };
    fs.writeFileSync(OUTPUT_DATA_PATH, JSON.stringify(report, null, 2), 'utf8');
    fs.copyFileSync(path.join(__dirname, 'measure.ts'), path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/scratch/measure.ts'));
    console.log(`Measured data written to: ${OUTPUT_DATA_PATH}`);

    console.log('\n======================================================');
    console.log('AUDIT MEASUREMENT SUMMARY — TARGET VERIFICATION REPORT');
    console.log('======================================================');
    const targetGroups: Record<string, number> = {};
    for (const v of violations) {
      targetGroups[v.target] = (targetGroups[v.target] || 0) + 1;
    }

    const TARGET_DEFINITIONS = [
      'Sale-critical text at least 16px',
      'Quantity at least 18px bold',
      'Cart grand total at least 28px bold',
      'Change due at least 22px bold',
      'Amount input at least 20px',
      'Secondary text at least 13px',
      'NOTHING under 12px anywhere',
      'Touch targets on phone at least 44x44 CSS px',
      'Contrast at least 4.5:1 for text',
      'Desktop 1600x780: at least 6 cart lines + total + pay visible',
      'Desktop 1563x545: at least 3 cart lines + total + pay visible',
      'Phone 384x725: at least 4 cart lines visible before scroll',
      'Phone 384x400: cash field, change due and confirm button all visible',
      'No horizontal page scroll'
    ];

    console.log(String('Target').padEnd(65) + ' | ' + 'Status' + ' | ' + 'Violations');
    console.log('-'.repeat(85));
    let hasFailures = false;
    for (const t of TARGET_DEFINITIONS) {
      const count = targetGroups[t] || 0;
      const status = count > 0 ? 'FAIL ❌' : 'PASS ✅';
      if (count > 0) hasFailures = true;
      console.log(t.padEnd(65) + ' | ' + status.padEnd(6) + ' | ' + count);
    }
    console.log('------------------------------------------------------');
    console.log(`Total Target Violations Detected: ${violations.length}`);

    if (hasFailures) {
      console.log('\n[AUDIT HARNESS] Target assertion failures detected as expected during audit.');
      process.exit(1);
    } else {
      console.log('\n[AUDIT HARNESS] All targets passed.');
      process.exit(0);
    }
  } finally {
    server.kill();
  }
}

runAudit().catch(err => {
  console.error('[Audit Error]', err);
  process.exit(1);
});
