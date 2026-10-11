import { chromium, type Browser, type Page } from 'playwright';
import { spawn, execSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { seedAuditDb } from '/home/admin/VibeCoding/JaziraERP/scratch/seed_audit_db.js';

const PROJECT_ROOT = '/home/admin/VibeCoding/JaziraERP';
const OUTPUT_AFTER_PATH = path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/after_batch4.json');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/screenshots');

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop_1600x780', width: 1600, height: 780, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'phone_384x725', width: 384, height: 725, deviceScaleFactor: 2.81, isMobile: true, hasTouch: true },
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

// Client evaluation function to measure DOM, typography, contrast, and layout
const MEASURE_DOM_FN = `(() => {
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

  function calcContrast(fgRgb, bgRgb) {
    const l1 = sRgbLuminance(fgRgb[0], fgRgb[1], fgRgb[2]);
    const l2 = sRgbLuminance(bgRgb[0], bgRgb[1], bgRgb[2]);
    const max = Math.max(l1, l2);
    const min = Math.min(l1, l2);
    return (max + 0.05) / (min + 0.05);
  }

  const innerH = window.innerHeight;
  const innerW = window.innerWidth;
  const docH = document.documentElement.scrollHeight;
  const docW = document.documentElement.scrollWidth;

  // Tables & containers
  const tables = Array.from(document.querySelectorAll('table'));
  const tableData = tables.map(t => {
    let container = t.parentElement;
    while (container && container !== document.body && window.getComputedStyle(container).overflowY === 'visible') {
      container = container.parentElement;
    }
    const rows = Array.from(t.querySelectorAll('tbody tr'));
    const rowHeights = rows.map(r => r.getBoundingClientRect().height);
    const meanRowH = rowHeights.length ? rowHeights.reduce((a, b) => a + b, 0) / rowHeights.length : 0;
    const over48 = rowHeights.filter(h => h > 48).length;

    return {
      tableRowsCount: rows.length,
      meanRowHeight: Math.round(meanRowH),
      rowsOver48: over48,
      containerScrollHeight: container ? container.scrollHeight : 0,
      containerClientHeight: container ? container.clientHeight : 0,
      containerScrolls: container ? container.scrollHeight > container.clientHeight : false,
      containerOverflowY: container ? window.getComputedStyle(container).overflowY : 'none'
    };
  });

  // Typography
  const ths = Array.from(document.querySelectorAll('th'));
  const thSizes = ths.map(el => parseFloat(window.getComputedStyle(el).fontSize));
  const tds = Array.from(document.querySelectorAll('td'));
  const tdSizes = tds.map(el => parseFloat(window.getComputedStyle(el).fontSize));
  const labels = Array.from(document.querySelectorAll('label'));
  const labelSizes = labels.map(el => parseFloat(window.getComputedStyle(el).fontSize));
  const inputs = Array.from(document.querySelectorAll('input, select'));
  const inputSizes = inputs.map(el => parseFloat(window.getComputedStyle(el).fontSize));
  const buttons = Array.from(document.querySelectorAll('button'));
  const buttonSizes = buttons.map(el => parseFloat(window.getComputedStyle(el).fontSize));

  // Small text detection (< 12px)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode;
  const smallTextSamples = [];
  let smallCount = 0;
  while ((textNode = walker.nextNode())) {
    const parent = textNode.parentElement;
    if (!parent) continue;
    const text = textNode.nodeValue?.trim();
    if (!text || text.length < 2) continue;
    const size = parseFloat(window.getComputedStyle(parent).fontSize);
    if (size < 12) {
      smallCount++;
      if (smallTextSamples.length < 15) {
        smallTextSamples.push({
          text: text.slice(0, 40),
          fontSize: Math.round(size),
          tagName: parent.tagName.toLowerCase(),
          className: parent.className.toString().slice(0, 50)
        });
      }
    }
  }

  // Modals & viewports
  const modals = Array.from(document.querySelectorAll('.fixed.inset-0, [role="dialog"]'));
  const modalData = modals.map(m => {
    const dialogBox = m.querySelector('.bg-white, [class*="max-w-"]') || m;
    const rect = dialogBox.getBoundingClientRect();
    const exceedsViewportH = rect.height > (innerH + 2);
    const exceedsViewportW = rect.width > (innerW + 2);

    const footer = dialogBox.querySelector('button[type="submit"]')?.closest('div');
    const scrollContainers = Array.from(dialogBox.querySelectorAll('*')).filter(el => {
      const style = window.getComputedStyle(el);
      return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });

    return {
      boxHeight: Math.round(rect.height),
      boxWidth: Math.round(rect.width),
      viewportH: innerH,
      viewportW: innerW,
      exceedsViewportH,
      exceedsViewportW,
      hasScrollableBody: scrollContainers.length > 0,
      stickyFooterPresent: Boolean(footer)
    };
  });

  // Low contrast scan
  const contrastSamples = [];
  const allElements = Array.from(document.querySelectorAll('p, span, td, th, label, button, a, h1, h2, h3, h4'));
  for (const el of allElements) {
    const text = el.textContent?.trim();
    if (!text || text.length < 2) continue;
    const fgRgb = parseRgba(window.getComputedStyle(el).color);
    if (fgRgb[3] < 0.2) continue; // transparent
    const bgRgb = getEffectiveBg(el);
    const contrast = calcContrast(fgRgb, bgRgb);
    if (contrast < 4.5) {
      if (contrastSamples.length < 12) {
        contrastSamples.push({
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 30),
          contrastRatio: Number(contrast.toFixed(2)),
          color: window.getComputedStyle(el).color,
          bg: \`rgb(\${bgRgb.join(',')})\`
        });
      }
    }
  }

  return {
    innerH,
    innerW,
    docH,
    docW,
    pageScrolls: docH > innerH,
    tables: tableData,
    typography: {
      headersMean: thSizes.length ? Number((thSizes.reduce((a, b) => a + b, 0) / thSizes.length).toFixed(1)) : 0,
      headersMin: thSizes.length ? Math.min(...thSizes) : 0,
      cellsMean: tdSizes.length ? Number((tdSizes.reduce((a, b) => a + b, 0) / tdSizes.length).toFixed(1)) : 0,
      cellsMin: tdSizes.length ? Math.min(...tdSizes) : 0,
      labelsMin: labelSizes.length ? Math.min(...labelSizes) : 0,
      inputsMin: inputSizes.length ? Math.min(...inputSizes) : 0,
      buttonsMin: buttonSizes.length ? Math.min(...buttonSizes) : 0
    },
    smallTextNodesCount: smallCount,
    smallTextSamples,
    modals: modalData,
    lowContrastSampleCount: contrastSamples.length,
    lowContrastSamples: contrastSamples
  };
})()`;

async function safeCloseModal(page: Page) {
  try {
    const escOrClose = page.locator('button').filter({ has: page.locator('svg.lucide-x') }).first();
    if (await escOrClose.isVisible()) {
      await escOrClose.click();
      await page.waitForTimeout(250);
      return;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0');
      if (modal) {
        const closeBtn = Array.from(modal.querySelectorAll('button')).find(b => 
          b.textContent?.match(/fermer|annuler|close|cancel/i) ||
          b.getAttribute('title')?.match(/fermer|close/i)
        );
        if (closeBtn) closeBtn.click();
      }
    });
    await page.waitForTimeout(250);
  } catch {}
}

async function gotoBackofficeTab(page: Page, tabPattern: string) {
  const boNavBtn = page.locator('header nav button').filter({ has: page.locator('svg.lucide-settings') });
  if (await boNavBtn.isVisible()) {
    await boNavBtn.click({ force: true });
  } else {
    await page.click('header button:has-text("Backoffice")').catch(() => {});
  }
  await page.waitForTimeout(400);

  const tabBtn = page.locator(`aside button, nav button, button`).filter({ hasText: new RegExp(tabPattern, 'i') }).first();
  if (await tabBtn.isVisible()) {
    await tabBtn.click({ force: true });
    await page.waitForTimeout(500);
  }
}

async function runAfter() {
  console.log('=== STARTING BATCH UI-4 AFTER MEASUREMENTS ===');
  const dbPath = '/tmp/audit_test_b4_after.sqlite';
  seedAuditDb(dbPath);

  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      PORT: '3378',
      HOST: '127.0.0.1'
    },
    stdio: 'ignore'
  });

  const afterData: Record<string, any> = {
    timestamp: new Date().toISOString(),
    description: 'Post-implementation audit measurements for Batch UI-4 (backoffice readability, contrast, tables, modals, French terminology)',
    staticCodeGrep: {},
    viewports: {}
  };

  try {
    await waitForServer('http://127.0.0.1:3378/api/health');
    console.log('Backend server running on port 3378');

    const browser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: true
    });

    for (const vp of VIEWPORTS) {
      console.log(`\n======================================================`);
      console.log(`MEASURING VIEWPORT: ${vp.name} (${vp.width}x${vp.height})`);
      console.log(`======================================================`);

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

      await page.goto('http://127.0.0.1:3378');
      await page.waitForTimeout(1000);

      const vpResults: Record<string, any> = { views: {}, modals: {} };

      // 1. Inventory / Catalog Table View
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Catalog');
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_catalog.png`) });
        vpResults.views['catalog'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 2. Product Create / Edit Modal (CreateProductModal)
      if (vp.height >= 400) {
        await gotoBackofficeTab(page, 'Catalog');
        const newProdBtn = page.locator('button:has-text("Nouveau Produit"), button:has-text("Nouvel Article"), button:has-text("New Product")').first();
        if (await newProdBtn.isVisible()) {
          await newProdBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_create_product_modal.png`) });
          vpResults.modals['CreateProductModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 3. Suppliers & Purchases List (SuppliersTab)
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Fournisseur');
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_suppliers.png`) });
        vpResults.views['suppliers'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 4. Create Purchase Modal (CreatePurchaseModal)
      if (vp.height >= 400) {
        await gotoBackofficeTab(page, 'Fournisseur');
        const newPurBtn = page.locator('button:has-text("Réception"), button:has-text("Nouvel Achat"), button:has-text("New Purchase")').first();
        if (await newPurBtn.isVisible()) {
          await newPurBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_create_purchase_modal.png`) });
          vpResults.modals['CreatePurchaseModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 5. Purchase Detail Modal (PurchaseDetailModal)
      if (vp.height >= 400) {
        await gotoBackofficeTab(page, 'Fournisseur');
        const purRow = page.locator('table:has-text("Achat"), table:has-text("Purchase") tbody tr').first();
        if (await purRow.isVisible()) {
          await purRow.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_purchase_detail_modal.png`) });
          vpResults.modals['PurchaseDetailModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 6. Customers list and customer detail with debt tickets
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Client');
        await page.waitForTimeout(600);
        const custRow = page.locator('button:has-text("Grossiste Ben Salem"), tr:has-text("Grossiste Ben Salem")').first();
        if (await custRow.isVisible()) {
          await custRow.click();
          await page.waitForTimeout(500);
        }
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_customers.png`) });
        vpResults.views['customers'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 7. Sales History (Ventes tab)
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Vente');
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_sales.png`) });
        vpResults.views['sales'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 8. Reports tables
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Rapport');
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_reports.png`) });
        vpResults.views['reports'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 9. Settings panel
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Paramètre');
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_settings.png`) });
        vpResults.views['settings'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 10. CreateMaterialModal
      if (vp.height >= 400) {
        await gotoBackofficeTab(page, 'Matière');
        const newMatBtn = page.locator('button:has-text("Nouvelle Matière"), button:has-text("New Material")').first();
        if (await newMatBtn.isVisible()) {
          await newMatBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_create_material_modal.png`) });
          vpResults.modals['CreateMaterialModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 11. AuthCredentialsModal
      if (vp.height >= 400) {
        const secBtn = page.locator('header button[title*="Sécurité"], header button[title*="Security"]').first();
        if (await secBtn.isVisible()) {
          await secBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_auth_credentials_modal.png`) });
          vpResults.modals['AuthCredentialsModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 12. CameraScannerModal
      if (vp.height >= 400) {
        const posBtn = page.locator('header nav button').first();
        if (await posBtn.isVisible()) await posBtn.click();
        await page.waitForTimeout(500);
        const camBtn = page.locator('button[title*="Scanner code-barres"], button:has-text("Scanner")').first();
        if (await camBtn.isVisible()) {
          await camBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_camera_scanner_modal.png`) });
          vpResults.modals['CameraScannerModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 13. LockScreenModal (measured in dedicated isolated context so it never leaks state)
      if (vp.height >= 400) {
        const lockContext = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: vp.deviceScaleFactor,
          isMobile: vp.isMobile,
          hasTouch: vp.hasTouch
        });
        const lockPage = await lockContext.newPage();
        await lockPage.addInitScript(`
          window.__name = function(fn) { return fn; };
          globalThis.__name = function(fn) { return fn; };
          try {
            localStorage.setItem('aljazira_is_configured', 'true');
            localStorage.setItem('aljazira_is_locked', 'true');
          } catch(e) {}
        `);
        await lockPage.goto('http://127.0.0.1:3378');
        await lockPage.waitForTimeout(600);
        await lockPage.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_after_${vp.name}_lock_screen_modal.png`) });
        vpResults.modals['LockScreenModal'] = await lockPage.evaluate(MEASURE_DOM_FN);
        await lockContext.close();
      }

      afterData.viewports[vp.name] = vpResults;
      await context.close();
    }

    await browser.close();

    // Grep code metrics for text-[10px], text-[11px] and emerald-600 in backoffice components
    try {
      const grepOutput = execSync('grep -rnE "text-\\[(9|10|11)px\\]" src/components/backoffice/ src/components/shared/ || true', {
        cwd: PROJECT_ROOT,
        encoding: 'utf8'
      });
      const lines = grepOutput.split('\n').filter(Boolean);
      const sub12ByFile: Record<string, number> = {};
      for (const line of lines) {
        const file = line.split(':')[0];
        sub12ByFile[file] = (sub12ByFile[file] || 0) + 1;
      }
      const emerald600Count = parseInt(execSync('grep -ro "bg-emerald-600" src/ | wc -l', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim(), 10);
      afterData.staticCodeGrep = {
        sub12ByFile,
        totalSub12Count: Object.values(sub12ByFile).reduce((a, b) => a + b, 0),
        emerald600Occurrences: emerald600Count
      };
    } catch (e) {
      console.warn('Grep error:', e);
    }

    fs.writeFileSync(OUTPUT_AFTER_PATH, JSON.stringify(afterData, null, 2), 'utf8');
    console.log(`\nSuccessfully saved after measurements to ${OUTPUT_AFTER_PATH}`);

  } finally {
    server.kill();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(`${dbPath}-wal`); } catch {}
    try { fs.unlinkSync(`${dbPath}-shm`); } catch {}
  }
}

runAfter().catch(err => {
  console.error('Fatal measurement error:', err);
  process.exit(1);
});
