import { chromium } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { seedAuditDb } from '/home/admin/VibeCoding/JaziraERP/scratch/seed_audit_db.js';

const PROJECT_ROOT = '/home/admin/VibeCoding/JaziraERP';
const OUTPUT_AFTER_PATH = path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/after_batch2.json');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/screenshots');

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const VIEWPORTS = [
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

function parseRgba(colorStr: string): [number, number, number, number] {
  if (!colorStr) return [0, 0, 0, 1];
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return [0, 0, 0, 1];
  return [
    parseInt(match[1], 10),
    parseInt(match[2], 10),
    parseInt(match[3], 10),
    match[4] !== undefined ? parseFloat(match[4]) : 1
  ];
}

function sRgbLuminance(r: number, g: number, b: number): number {
  const [rl, gl, bl] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function getContrastRatio(fgRgba: [number, number, number, number], bgRgb: [number, number, number]): number {
  const L1 = sRgbLuminance(fgRgba[0], fgRgba[1], fgRgba[2]);
  const L2 = sRgbLuminance(bgRgb[0], bgRgb[1], bgRgb[2]);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

async function run() {
  console.log('=== STARTING BATCH UI-2 AFTER MEASUREMENTS ===');
  const dbPath = '/tmp/audit_test_b2_after.sqlite';
  seedAuditDb(dbPath);

  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      PORT: '3355',
      HOST: '127.0.0.1',
      BUILD_ID: '9999999-new'
    },
    stdio: 'ignore'
  });

  const afterData: Record<string, any> = {
    timestamp: new Date().toISOString(),
    description: 'After measurements for Batch UI-2 (phone register, bottom nav, update banner)',
    viewports: {}
  };

  try {
    await waitForServer('http://127.0.0.1:3355/api/health');
    console.log('Backend test server started on port 3355!');

    const browser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: true
    });

    for (const vp of VIEWPORTS) {
      console.log(`\n========================================`);
      console.log(`MEASURING VIEWPORT: ${vp.name} (${vp.width}x${vp.height} @${vp.deviceScaleFactor})`);
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

      await page.goto('http://127.0.0.1:3355');
      await page.waitForTimeout(1000);

      // Ensure Mobile Register view is active
      await page.click('button:has-text("Mobile")').catch(() => {});
      await page.waitForTimeout(400);

      // 1. Seed 8 cart items
      const searchInput = page.locator('input[data-scanner-input="true"]');
      const barcodes = [
        '619100000001',
        '619100000002',
        '619100000003',
        '619100000004',
        '619100000005',
        '619100000006',
        '619100000007',
        '619100000008'
      ];
      for (const b of barcodes) {
        await searchInput.fill(b);
        await searchInput.press('Enter');
        await page.waitForTimeout(150);
      }

      // Select Customer: Grossiste Ben Salem
      const custSelect = page.locator('select').first();
      if (await custSelect.isVisible()) {
        const benSalemOption = await custSelect.locator('option:has-text("Ben Salem")').getAttribute('value').catch(() => null);
        if (benSalemOption) {
          await custSelect.selectOption(benSalemOption);
          await page.waitForTimeout(200);
        }
      }

      // MEASUREMENT A: CART DRAWER CLOSED
      if (vp.name === 'phone_384x725') {
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'tile_grid_phone_384x725.png') });
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'bottom_nav_phone_384x725.png') });
      }

      const drawerClosedMetrics = await page.evaluate(() => {
        const innerH = window.innerHeight;
        const innerW = window.innerWidth;
        const docScrollH = document.documentElement.scrollHeight;
        const docScrollW = document.documentElement.scrollWidth;

        // Bottom nav metrics
        const nav = document.querySelector('nav.fixed.bottom-0');
        const navRect = nav ? nav.getBoundingClientRect() : { height: 0, width: 0 };
        const buttons = nav ? Array.from(nav.querySelectorAll('button')) : [];
        const buttonMetrics = buttons.map(b => {
          const r = b.getBoundingClientRect();
          const span = b.querySelector('span');
          const style = span ? window.getComputedStyle(span) : window.getComputedStyle(b);
          return {
            text: b.textContent?.trim(),
            width: Math.round(r.width * 10) / 10,
            height: Math.round(r.height * 10) / 10,
            fontSizePx: parseFloat(style.fontSize),
            fontWeight: style.fontWeight
          };
        });

        // Tile grid metrics
        const tiles = Array.from(document.querySelectorAll('.grid.grid-cols-2 > div'));
        let tilesVisible = 0;
        tiles.forEach(t => {
          const r = t.getBoundingClientRect();
          if (r.top >= 0 && r.bottom <= innerH) {
            tilesVisible++;
          }
        });

        const firstTile = tiles[0] as HTMLElement | null;
        let tileSample = null;
        if (firstTile) {
          const title = firstTile.querySelector('h3');
          const price = firstTile.querySelector('span.font-mono');
          const badge = firstTile.querySelector('.text-pos-badge');
          tileSample = {
            titleFontSize: title ? parseFloat(window.getComputedStyle(title).fontSize) : 0,
            titleFontWeight: title ? window.getComputedStyle(title).fontWeight : '',
            priceFontSize: price ? parseFloat(window.getComputedStyle(price).fontSize) : 0,
            priceFontWeight: price ? window.getComputedStyle(price).fontWeight : '',
            badgeFontSize: badge ? parseFloat(window.getComputedStyle(badge).fontSize) : 0
          };
        }

        return {
          innerH,
          innerW,
          docScrollH,
          docScrollW,
          noPageScroll: docScrollH <= innerH,
          bottomNavHeight: Math.round(navRect.height * 10) / 10,
          bottomNavButtons: buttonMetrics,
          totalTilesRendered: tiles.length,
          tilesPerScreen: tilesVisible,
          tileSample
        };
      });

      // MEASUREMENT B: UPDATE BANNER
      await page.evaluate("window.dispatchEvent(new CustomEvent('pwa-update-available', { detail: { reload: function() {} } }))");
      await page.waitForTimeout(300);

      if (vp.name === 'phone_384x725') {
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'update_banner_phone_384x725.png') });
      }

      const bannerMetrics = await page.evaluate(() => {
        const b = document.querySelector('div[role="alert"].bg-amber-500') as HTMLElement | null;
        if (!b) return null;
        const style = window.getComputedStyle(b);
        return {
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontSize: parseFloat(style.fontSize),
          text: b.textContent?.trim().slice(0, 80)
        };
      });

      let bannerContrast = null;
      if (bannerMetrics) {
        const fg = parseRgba(bannerMetrics.color);
        const bg = parseRgba(bannerMetrics.backgroundColor);
        bannerContrast = getContrastRatio(fg, [bg[0], bg[1], bg[2]]);
      }

      // MEASUREMENT C: OPEN CART DRAWER
      const cartPill = page.locator('.absolute.bottom-16.inset-x-3');
      if (await cartPill.isVisible()) {
        await cartPill.click();
        await page.waitForTimeout(400);
      }

      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `pos_cart_8lines_${vp.name}.png`) });

      const drawerOpenMetrics = await page.evaluate(() => {
        const innerH = window.innerHeight;
        const innerW = window.innerWidth;
        const docScrollH = document.documentElement.scrollHeight;
        const docScrollW = document.documentElement.scrollWidth;

        // Drawer components
        const drawerRoot = document.querySelector('.fixed.inset-0.z-40') as HTMLElement | null;
        const drawerCard = drawerRoot?.querySelector('.bg-white.rounded-t-3xl') as HTMLElement | null;

        const header = drawerCard?.querySelector('.bg-slate-900') as HTMLElement | null;
        const headerRect = header ? header.getBoundingClientRect() : { height: 0 };

        const custBar = header?.querySelector('p.text-xs.text-slate-400') as HTMLElement | null;
        const custBarRect = custBar ? custBar.getBoundingClientRect() : { height: 0 };

        const containerNotice = drawerCard?.querySelector('.bg-emerald-50, .bg-amber-50') as HTMLElement | null;
        const containerNoticeRect = containerNotice ? containerNotice.getBoundingClientRect() : { height: 0 };

        const rowsContainer = drawerCard?.querySelector('.flex-1.overflow-y-auto.divide-y') as HTMLElement | null;
        const cRect = rowsContainer ? rowsContainer.getBoundingClientRect() : { top: 0, bottom: 0, height: 0 };

        const rows = Array.from(drawerCard?.querySelectorAll('.cart-row') || []);
        const rowDetails = rows.map((r, i) => {
          const rect = r.getBoundingClientRect();
          const inC = rect.top >= cRect.top && rect.bottom <= cRect.bottom;
          const inV = rect.top >= 0 && rect.bottom <= innerH;
          const isFullyVisible = inC && inV;

          const nameEl = r.querySelector('h4');
          const nameStyle = nameEl ? window.getComputedStyle(nameEl) : null;

          const priceEl = (r.querySelector('.cart-unit-price, input[title="Modifier le prix unitaire"]') || r.querySelector('.text-pos-price')) as HTMLElement | null;
          const priceStyle = priceEl ? window.getComputedStyle(priceEl) : null;

          const qtyEl = r.querySelector('input.qty-input, input[disallowzero="true"], .w-12 input, input[type="number"]') as HTMLElement | null;
          const qtyStyle = qtyEl ? window.getComputedStyle(qtyEl) : null;

          const lineTotalEl = (r.querySelector('.cart-line-total, .font-mono.text-xs.font-bold, .font-mono')) as HTMLElement | null;
          const lineTotalStyle = lineTotalEl ? window.getComputedStyle(lineTotalEl) : null;

          const buttons = Array.from(r.querySelectorAll('button'));
          const stepperMinus = buttons.find(b => b.textContent?.trim() === '-');
          const stepperPlus = buttons.find(b => b.textContent?.trim() === '+');
          const deleteBtn = buttons.find(b => b.querySelector('svg.lucide-trash-2') || b.querySelector('svg.lucide-trash') || b.getAttribute('title')?.includes('Supprimer'));
          const optionsBtn = buttons.find(b => b.querySelector('svg.lucide-more-horizontal') || b.getAttribute('title')?.includes('Options'));

          const minusRect = stepperMinus ? stepperMinus.getBoundingClientRect() : { width: 0, height: 0 };
          const plusRect = stepperPlus ? stepperPlus.getBoundingClientRect() : { width: 0, height: 0 };
          const delRect = deleteBtn ? deleteBtn.getBoundingClientRect() : { width: 0, height: 0 };
          const optRect = optionsBtn ? optionsBtn.getBoundingClientRect() : { width: 0, height: 0 };

          return {
            index: i + 1,
            height: Math.round(rect.height * 10) / 10,
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            isInsideContainer: inC,
            isInsideViewport: inV,
            isFullyVisible,
            name: {
              text: nameEl?.textContent?.trim().slice(0, 40) || '',
              fontSizePx: nameStyle ? parseFloat(nameStyle.fontSize) : 0,
              fontWeight: nameStyle?.fontWeight || ''
            },
            unitPrice: {
              fontSizePx: priceStyle ? parseFloat(priceStyle.fontSize) : 0,
              fontWeight: priceStyle?.fontWeight || ''
            },
            quantity: {
              fontSizePx: qtyStyle ? parseFloat(qtyStyle.fontSize) : 0,
              fontWeight: qtyStyle?.fontWeight || ''
            },
            lineTotal: {
              fontSizePx: lineTotalStyle ? parseFloat(lineTotalStyle.fontSize) : 0,
              fontWeight: lineTotalStyle?.fontWeight || ''
            },
            stepperMinusSize: { width: Math.round(minusRect.width * 10) / 10, height: Math.round(minusRect.height * 10) / 10 },
            stepperPlusSize: { width: Math.round(plusRect.width * 10) / 10, height: Math.round(plusRect.height * 10) / 10 },
            deleteBtnSize: { width: Math.round(delRect.width * 10) / 10, height: Math.round(delRect.height * 10) / 10 },
            optionsBtnSize: { width: Math.round(optRect.width * 10) / 10, height: Math.round(optRect.height * 10) / 10 }
          };
        });

        const paySection = (drawerCard?.querySelector('.p-3.bg-slate-50.border-t, .p-4.bg-slate-50.border-t, .border-t.bg-slate-50')) as HTMLElement | null;
        const pSecRect = paySection ? paySection.getBoundingClientRect() : { height: 0, top: 0, bottom: 0 };

        const totalEl = (drawerCard?.querySelector('.cart-grand-total, .text-pos-total, .text-xl.text-emerald-700') ||
          Array.from(drawerCard?.querySelectorAll('span') || []).find(s => s.textContent?.includes('TOTAL TTC'))?.nextElementSibling) as HTMLElement | null;
        const tRect = totalEl ? totalEl.getBoundingClientRect() : { top: 0, bottom: 0 };

        const payBtn = Array.from(drawerCard?.querySelectorAll('button') || []).find(b => b.textContent?.includes('Encaisser')) as HTMLElement | null;
        const payBtnRect = payBtn ? payBtn.getBoundingClientRect() : { top: 0, bottom: 0, height: 0 };

        const heights = rowDetails.map(r => r.height);
        const minHeight = heights.length ? Math.min(...heights) : 0;
        const maxHeight = heights.length ? Math.max(...heights) : 0;
        const meanHeight = heights.length ? Math.round((heights.reduce((a, b) => a + b, 0) / heights.length) * 10) / 10 : 0;
        const fullyVisibleCount = rowDetails.filter(r => r.isFullyVisible).length;

        return {
          innerH,
          innerW,
          docScrollH,
          docScrollW,
          noPageScroll: docScrollH <= innerH,
          drawerHeaderHeight: Math.round(headerRect.height),
          customerBarHeight: Math.round(custBarRect.height),
          containerNoticeHeight: Math.round(containerNoticeRect.height),
          cartRowsContainerClientHeight: Math.round(cRect.height),
          bottomPaySectionHeight: Math.round(pSecRect.height),
          totalInsideViewport: tRect.bottom <= innerH && tRect.top >= 0,
          payBtnInsideViewport: payBtn ? (payBtnRect.bottom <= innerH && payBtnRect.top >= 0) : false,
          payBtnHeight: Math.round(payBtnRect.height),
          minRowHeight: minHeight,
          maxRowHeight: maxHeight,
          meanRowHeight: meanHeight,
          fullyVisibleRowsCount: fullyVisibleCount,
          totalRowsCount: rowDetails.length,
          rowDetails
        };
      });

      afterData.viewports[vp.name] = {
        viewport: vp.name,
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.deviceScaleFactor,
        drawerClosed: drawerClosedMetrics,
        updateBanner: {
          ...bannerMetrics,
          contrastRatio: bannerContrast
        },
        drawerOpen: drawerOpenMetrics
      };

      console.log(`\nResults for ${vp.name}:`);
      console.log(`- Drawer closed: docScrollH=${drawerClosedMetrics.docScrollH}, innerH=${drawerClosedMetrics.innerH}, noPageScroll=${drawerClosedMetrics.noPageScroll}`);
      console.log(`- Bottom nav height: ${drawerClosedMetrics.bottomNavHeight}px`);
      console.log(`- Bottom nav buttons:`);
      drawerClosedMetrics.bottomNavButtons.forEach(b => {
        console.log(`    * ${b.text}: ${b.width}x${b.height}px, font: ${b.fontSizePx}px ${b.fontWeight}`);
      });
      console.log(`- Tiles per screen: ${drawerClosedMetrics.tilesPerScreen} of ${drawerClosedMetrics.totalTilesRendered}`);
      if (drawerClosedMetrics.tileSample) {
        console.log(`- Tile sample: title=${drawerClosedMetrics.tileSample.titleFontSize}px, price=${drawerClosedMetrics.tileSample.priceFontSize}px, badge=${drawerClosedMetrics.tileSample.badgeFontSize}px`);
      }
      console.log(`- Update banner contrast: ${bannerContrast}:1`);
      console.log(`- Drawer open: docScrollH=${drawerOpenMetrics.docScrollH}, innerH=${drawerOpenMetrics.innerH}, noPageScroll=${drawerOpenMetrics.noPageScroll}`);
      console.log(`- Header height: ${drawerOpenMetrics.drawerHeaderHeight}px`);
      console.log(`- Cart rows container height: ${drawerOpenMetrics.cartRowsContainerClientHeight}px`);
      console.log(`- Pay section height: ${drawerOpenMetrics.bottomPaySectionHeight}px`);
      console.log(`- Fully visible rows: ${drawerOpenMetrics.fullyVisibleRowsCount} of ${drawerOpenMetrics.totalRowsCount}`);
      console.log(`- Row heights: min=${drawerOpenMetrics.minRowHeight}px, max=${drawerOpenMetrics.maxRowHeight}px, mean=${drawerOpenMetrics.meanRowHeight}px`);
      console.log(`- Total inside viewport: ${drawerOpenMetrics.totalInsideViewport}`);
      console.log(`- Pay button inside viewport: ${drawerOpenMetrics.payBtnInsideViewport} (height=${drawerOpenMetrics.payBtnHeight}px)`);
      console.log(`- Row 1 details:`);
      const r1 = drawerOpenMetrics.rowDetails[0];
      if (r1) {
        console.log(`    * Name font: ${r1.name.fontSizePx}px ${r1.name.fontWeight}`);
        console.log(`    * Unit price font: ${r1.unitPrice.fontSizePx}px`);
        console.log(`    * Qty font: ${r1.quantity.fontSizePx}px`);
        console.log(`    * Line total font: ${r1.lineTotal.fontSizePx}px`);
        console.log(`    * Stepper minus size: ${r1.stepperMinusSize.width}x${r1.stepperMinusSize.height}px`);
        console.log(`    * Stepper plus size: ${r1.stepperPlusSize.width}x${r1.stepperPlusSize.height}px`);
        console.log(`    * Delete btn size: ${r1.deleteBtnSize.width}x${r1.deleteBtnSize.height}px`);
      }

      await context.close();
    }

    // CHECKOUT SCREENSHOT AT 384x400
    console.log('\nMeasuring checkout at 384x400...');
    const context400 = await browser.newContext({
      viewport: { width: 384, height: 400 },
      deviceScaleFactor: 2.81,
      isMobile: true,
      hasTouch: true
    });
    const page400 = await context400.newPage();
    await page400.goto('http://127.0.0.1:3355');
    await page400.waitForTimeout(1000);
    await page400.click('button:has-text("Mobile")').catch(() => {});
    await page400.waitForTimeout(300);

    // Add 1 item
    const search400 = page400.locator('input[data-scanner-input="true"]');
    await search400.fill('619100000001');
    await search400.press('Enter');
    await page400.waitForTimeout(300);

    // Open Cart Drawer
    const pill400 = page400.locator('.absolute.bottom-16.inset-x-3');
    if (await pill400.isVisible()) {
      await pill400.click();
      await page400.waitForTimeout(400);
    }

    // Click Encaisser
    const encaisserBtn = page400.locator('button:has-text("Encaisser")');
    if (await encaisserBtn.isVisible()) {
      await encaisserBtn.click();
      await page400.waitForTimeout(400);
    }

    // Focus cash tender input to simulate keyboard open
    const cashInput = page400.locator('.fixed.inset-0 input[type="number"]').first();
    if (await cashInput.isVisible()) {
      await cashInput.focus();
      await cashInput.fill('50');
      await page400.waitForTimeout(300);
    }
    await page400.screenshot({ path: path.join(SCREENSHOTS_DIR, 'checkout_phone_384x400.png') });
    await context400.close();

    await browser.close();

    fs.writeFileSync(OUTPUT_AFTER_PATH, JSON.stringify(afterData, null, 2), 'utf8');
    console.log(`\nSuccessfully saved after measurements to: ${OUTPUT_AFTER_PATH}`);
  } finally {
    server.kill();
  }
}

run().catch(err => {
  console.error('[Error]', err);
  process.exit(1);
});
