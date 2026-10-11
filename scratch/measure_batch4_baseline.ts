import { chromium, type Browser, type Page } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { seedAuditDb } from '/home/admin/VibeCoding/JaziraERP/scratch/seed_audit_db.js';

const PROJECT_ROOT = '/home/admin/VibeCoding/JaziraERP';
const OUTPUT_BASELINE_PATH = path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/before_batch4.json');
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
    const contEl = container || t.parentElement;
    const contStyle = contEl ? window.getComputedStyle(contEl) : null;
    const rows = Array.from(t.querySelectorAll('tbody tr'));
    const rowHeights = rows.map(r => r.getBoundingClientRect().height);
    const meanRowH = rowHeights.length ? rowHeights.reduce((a, b) => a + b, 0) / rowHeights.length : 0;
    const rowsOver48 = rowHeights.filter(h => h > 48.5).length;

    return {
      tableRowsCount: rows.length,
      meanRowHeight: Math.round(meanRowH * 10) / 10,
      rowsOver48,
      containerScrollHeight: contEl ? contEl.scrollHeight : 0,
      containerClientHeight: contEl ? contEl.clientHeight : 0,
      containerScrolls: contEl ? (contEl.scrollHeight > contEl.clientHeight + 2) : false,
      containerOverflowY: contStyle ? contStyle.overflowY : 'none'
    };
  });

  // Typography font sizes
  const headers = Array.from(document.querySelectorAll('th')).map(el => Math.round(parseFloat(window.getComputedStyle(el).fontSize) * 10) / 10);
  const cells = Array.from(document.querySelectorAll('td')).map(el => Math.round(parseFloat(window.getComputedStyle(el).fontSize) * 10) / 10);
  const labels = Array.from(document.querySelectorAll('label')).map(el => Math.round(parseFloat(window.getComputedStyle(el).fontSize) * 10) / 10);
  const inputs = Array.from(document.querySelectorAll('input, select, textarea')).map(el => Math.round(parseFloat(window.getComputedStyle(el).fontSize) * 10) / 10);
  const buttons = Array.from(document.querySelectorAll('button')).map(el => Math.round(parseFloat(window.getComputedStyle(el).fontSize) * 10) / 10);

  // Small text nodes (< 12px)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const smallTextNodes = [];
  const contrastPairs = [];
  let curr = walker.nextNode();

  while (curr) {
    const text = (curr.textContent || '').trim();
    const parent = curr.parentElement;
    if (text.length > 0 && parent && parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE') {
      const rect = parent.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(parent).visibility !== 'hidden';
      if (isVisible) {
        const style = window.getComputedStyle(parent);
        const fs = parseFloat(style.fontSize) || 0;
        if (fs > 0 && fs < 11.95) {
          smallTextNodes.push({
            text: text.slice(0, 40),
            fontSize: Math.round(fs * 10) / 10,
            tagName: parent.tagName.toLowerCase(),
            className: (parent.className || '').toString().slice(0, 50)
          });
        }

        // Contrast check
        const [fr, fg, fb, fa] = parseRgba(style.color);
        if (fa > 0.1) {
          const bgRgb = getEffectiveBg(parent);
          const ratio = Math.round(calcContrast([fr, fg, fb], bgRgb) * 100) / 100;
          if (ratio < 4.5) {
            contrastPairs.push({
              text: text.slice(0, 30),
              color: style.color,
              bg: 'rgb(' + bgRgb.join(',') + ')',
              ratio,
              tagName: parent.tagName.toLowerCase(),
              className: (parent.className || '').toString().slice(0, 50)
            });
          }
        }
      }
    }
    curr = walker.nextNode();
  }

  // Active modal details if present
  const overlay = document.querySelector('.fixed.inset-0');
  let modalData = null;
  if (overlay) {
    const card = overlay.querySelector('.bg-white.rounded-2xl, .bg-white.rounded-xl, .bg-white.rounded-t-3xl') || overlay.firstElementChild;
    if (card) {
      const cr = card.getBoundingClientRect();
      const header = card.querySelector('.bg-slate-900, header, .border-b') || card.firstElementChild;
      const hr = header ? header.getBoundingClientRect() : null;

      const btns = Array.from(card.querySelectorAll('button'));
      const closeBtn = btns.find(b =>
        b.querySelector('svg.lucide-x') ||
        b.getAttribute('aria-label')?.match(/fermer|close/i) ||
        b.getAttribute('title')?.match(/fermer|close|échap/i) ||
        b.textContent?.trim().match(/^(Fermer|Close|Annuler|Cancel|×)$/i)
      );
      const cbr = closeBtn ? closeBtn.getBoundingClientRect() : null;

      const primaryBtn = btns.find(b =>
        b.getAttribute('type') === 'submit' ||
        b.textContent?.match(/Imprimer|Print|Enregistrer|Record|Démarrer|Start|Confirmer|Confirm|Reprendre|Rembourser|Valider/i) ||
        b.classList.contains('bg-emerald-600') ||
        b.classList.contains('bg-emerald-700') ||
        b.classList.contains('bg-blue-600') ||
        b.classList.contains('bg-amber-600')
      );
      const pbr = primaryBtn ? primaryBtn.getBoundingClientRect() : null;

      const body = card.querySelector('.overflow-y-auto, .flex-1.overflow-y-auto');

      modalData = {
        card: { top: Math.round(cr.top), bottom: Math.round(cr.bottom), height: Math.round(cr.height), insideViewport: cr.top >= 0 && cr.bottom <= innerH },
        header: hr ? { top: Math.round(hr.top), bottom: Math.round(hr.bottom), height: Math.round(hr.height), insideViewport: hr.top >= 0 && hr.bottom <= innerH } : null,
        closeBtn: cbr ? { top: Math.round(cbr.top), bottom: Math.round(cbr.bottom), height: Math.round(cbr.height), insideViewport: cbr.top >= 0 && cbr.bottom <= innerH } : null,
        primaryBtn: pbr ? { text: primaryBtn?.textContent?.trim().slice(0, 30), top: Math.round(pbr.top), bottom: Math.round(pbr.bottom), height: Math.round(pbr.height), insideViewport: pbr.top >= 0 && pbr.bottom <= innerH } : null,
        bodyScrolls: body ? body.scrollHeight > body.clientHeight : false
      };
    }
  }

  return {
    innerH,
    innerW,
    docH,
    docW,
    pageScrolls: docH > innerH + 1,
    tables: tableData,
    typography: {
      headersMean: headers.length ? Math.round((headers.reduce((a, b) => a + b, 0) / headers.length) * 10) / 10 : 0,
      headersMin: headers.length ? Math.min(...headers) : 0,
      cellsMean: cells.length ? Math.round((cells.reduce((a, b) => a + b, 0) / cells.length) * 10) / 10 : 0,
      cellsMin: cells.length ? Math.min(...cells) : 0,
      labelsMin: labels.length ? Math.min(...labels) : 0,
      inputsMin: inputs.length ? Math.min(...inputs) : 0,
      buttonsMin: buttons.length ? Math.min(...buttons) : 0,
    },
    smallTextNodesCount: smallTextNodes.length,
    smallTextSamples: smallTextNodes.slice(0, 10),
    contrastUnder45Count: contrastPairs.length,
    contrastUnder45Samples: contrastPairs.slice(0, 10),
    modal: modalData
  };
})()`;

async function safeCloseModal(page: Page) {
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('.fixed.inset-0'));
      for (let i = modals.length - 1; i >= 0; i--) {
        const modal = modals[i];
        const buttons = Array.from(modal.querySelectorAll('button'));
        const closeBtn = buttons.find(b =>
          b.textContent?.match(/Fermer|Cancel|Annuler|Terminer|Close/i) ||
          b.querySelector('svg.lucide-x') ||
          b.getAttribute('title')?.match(/fermer|close/i)
        );
        if (closeBtn) closeBtn.click();
      }
    });
    await page.waitForTimeout(250);
  } catch {}
}

async function gotoBackofficeTab(page: Page, tabName: string) {
  // Ensure we are in backoffice
  const boNavBtn = page.locator('header nav button').filter({ has: page.locator('svg.lucide-settings') });
  if (await boNavBtn.isVisible()) {
    await boNavBtn.click({ force: true });
  } else {
    await page.click('header button:has-text("Backoffice")').catch(() => {});
  }
  await page.waitForTimeout(400);

  const tabBtn = page.locator(`aside button:has-text("${tabName}"), nav button:has-text("${tabName}"), button:has-text("${tabName}")`).first();
  if (await tabBtn.isVisible()) {
    await tabBtn.click({ force: true });
    await page.waitForTimeout(500);
  }
}

async function runBaseline() {
  console.log('=== STARTING BATCH UI-4 BASELINE MEASUREMENTS ===');
  const dbPath = '/tmp/audit_test_b4_baseline.sqlite';
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
    description: 'Baseline measurements for Batch UI-4 (backoffice readability, contrast, tables, modals)',
    staticCodeGrep: {},
    viewports: {}
  };

  try {
    await waitForServer('http://127.0.0.1:3377/api/health');
    console.log('Backend server running on port 3377');

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

      await page.goto('http://127.0.0.1:3377');
      await page.waitForTimeout(1000);

      const vpResults: Record<string, any> = { views: {}, modals: {} };

      // 1. Inventory / Catalog Table View
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Catalog & SKUs');
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_catalog.png`) });
        vpResults.views['catalog'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 2. Product Create / Edit Modal (CreateProductModal)
      if (vp.height >= 400) {
        await gotoBackofficeTab(page, 'Catalog & SKUs');
        const newProdBtn = page.locator('button:has-text("New Product / SKU"), button:has-text("+ New Product")').first();
        if (await newProdBtn.isVisible()) {
          await newProdBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_create_product_modal.png`) });
          vpResults.modals['CreateProductModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 3. Suppliers & Purchases List (SuppliersTab)
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Suppliers & Purchases');
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_suppliers.png`) });
        vpResults.views['suppliers'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 4. Create Purchase Modal (CreatePurchaseModal)
      if (vp.height >= 400) {
        await gotoBackofficeTab(page, 'Suppliers & Purchases');
        const newPurBtn = page.locator('button:has-text("New Purchase")').first();
        if (await newPurBtn.isVisible()) {
          await newPurBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_create_purchase_modal.png`) });
          vpResults.modals['CreatePurchaseModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 5. Purchase Detail Modal (PurchaseDetailModal)
      if (vp.height >= 400) {
        await gotoBackofficeTab(page, 'Suppliers & Purchases');
        const purRow = page.locator('table:has-text("Purchase #") tbody tr').first();
        if (await purRow.isVisible()) {
          await purRow.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_purchase_detail_modal.png`) });
          vpResults.modals['PurchaseDetailModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 6. Customers list and customer detail with debt tickets
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Customers & Debt');
        await page.waitForTimeout(600);
        const custRow = page.locator('button:has-text("Grossiste Ben Salem"), tr:has-text("Grossiste Ben Salem")').first();
        if (await custRow.isVisible()) {
          await custRow.click();
          await page.waitForTimeout(500);
        }
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_customers.png`) });
        vpResults.views['customers'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 7. Sales History (Ventes tab)
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Ventes');
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_sales.png`) });
        vpResults.views['sales'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 8. Reports tables
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Reports');
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_reports.png`) });
        vpResults.views['reports'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 9. Settings panel
      if (vp.height >= 545) {
        await gotoBackofficeTab(page, 'Settings');
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_settings.png`) });
        vpResults.views['settings'] = await page.evaluate(MEASURE_DOM_FN);
      }

      // 10. CreateMaterialModal
      if (vp.height >= 400) {
        await gotoBackofficeTab(page, 'Raw Materials');
        const newMatBtn = page.locator('button:has-text("New Material")').first();
        if (await newMatBtn.isVisible()) {
          await newMatBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_create_material_modal.png`) });
          vpResults.modals['CreateMaterialModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 11. AuthCredentialsModal
      if (vp.height >= 400) {
        const secBtn = page.locator('header button[title*="Security"]').first();
        if (await secBtn.isVisible()) {
          await secBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_auth_credentials_modal.png`) });
          vpResults.modals['AuthCredentialsModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 12. CameraScannerModal
      if (vp.height >= 400) {
        const posBtn = page.locator('header nav button').first();
        if (await posBtn.isVisible()) await posBtn.click();
        await page.waitForTimeout(500);
        const camBtn = page.locator('button[title*="Scanner code-barres caméra"], button:has-text("Scanner")').first();
        if (await camBtn.isVisible()) {
          await camBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_camera_scanner_modal.png`) });
          vpResults.modals['CameraScannerModal'] = await page.evaluate(MEASURE_DOM_FN);
          await safeCloseModal(page);
        }
      }

      // 13. LockScreenModal (last modal measured in viewport)
      if (vp.height >= 400) {
        const lockBtn = page.locator('header button[title*="Lock"]').first();
        if (await lockBtn.isVisible()) {
          await lockBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `b4_baseline_${vp.name}_lock_screen_modal.png`) });
          vpResults.modals['LockScreenModal'] = await page.evaluate(MEASURE_DOM_FN);
          // Reset lock state in SQLite DB and localStorage for the next viewport
          try {
            const Database = (await import('better-sqlite3')).default;
            const db = new Database(dbPath);
            db.prepare("UPDATE settings SET value = 'false' WHERE key = 'is_locked'").run();
            db.close();
          } catch {}
        }
      }

      baselineData.viewports[vp.name] = vpResults;
      await context.close();
    }

    await browser.close();

    // Static code grep counts
    const { execSync } = await import('child_process');
    try {
      const grepOutput = execSync('grep -rcE "text-\\[(9|10|11)px\\]" src/components/backoffice/ src/components/shared/ | grep -v ":0$"', { cwd: PROJECT_ROOT, encoding: 'utf8' });
      const sub12ByFile: Record<string, number> = {};
      for (const line of grepOutput.trim().split('\n')) {
        const [f, c] = line.split(':');
        if (f && c) sub12ByFile[f.trim()] = parseInt(c.trim(), 10);
      }
      const emerald600Count = parseInt(execSync('grep -ro "bg-emerald-600" src/ | wc -l', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim(), 10);
      baselineData.staticCodeGrep = {
        sub12ByFile,
        totalSub12Count: Object.values(sub12ByFile).reduce((a, b) => a + b, 0),
        emerald600Occurrences: emerald600Count
      };
    } catch (e) {
      console.warn('Grep error:', e);
    }

    fs.writeFileSync(OUTPUT_BASELINE_PATH, JSON.stringify(baselineData, null, 2), 'utf8');
    console.log(`\nSuccessfully saved baseline measurements to ${OUTPUT_BASELINE_PATH}`);

  } finally {
    server.kill();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(`${dbPath}-wal`); } catch {}
    try { fs.unlinkSync(`${dbPath}-shm`); } catch {}
  }
}

runBaseline().catch(err => {
  console.error('Fatal baseline measurement error:', err);
  process.exit(1);
});
