import { chromium, type Page } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { seedAuditDb } from './seed_audit_db.js';

const PROJECT_ROOT = '/home/admin/VibeCoding/JaziraERP';
const OUTPUT_BASELINE_PATH = path.join(PROJECT_ROOT, "docs/audit-ui-2026-10/after_batch3.json");
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'docs/audit-ui-2026-10/screenshots');

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop_1600x780', width: 1600, height: 780, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'desktop_1563x545', width: 1563, height: 545, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
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

interface ModalMeasurement {
  modalName: string;
  viewport: string;
  innerH: number;
  innerW: number;
  card: {
    top: number;
    bottom: number;
    height: number;
    width: number;
    insideViewport: boolean;
  } | null;
  header: {
    top: number;
    bottom: number;
    height: number;
    insideViewport: boolean;
  } | null;
  closeBtn: {
    top: number;
    bottom: number;
    height: number;
    width: number;
    insideViewport: boolean;
  } | null;
  primaryAction: {
    text: string;
    top: number;
    bottom: number;
    height: number;
    width: number;
    insideViewport: boolean;
  } | null;
  body: {
    scrollHeight: number;
    clientHeight: number;
    scrolls: boolean;
  } | null;
  smallTextNodesCount: number;
  smallTextSamples: Array<{ text: string; fontSizePx: number; tagName: string }>;
}

async function measureActiveModal(page: Page, modalName: string, viewportName: string): Promise<ModalMeasurement> {
  return await page.evaluate(({ modalName, viewportName }) => {
    const innerH = window.innerHeight;
    const innerW = window.innerWidth;

    // Find the topmost modal overlay / container
    const overlays = Array.from(document.querySelectorAll('.fixed.inset-0'));
    const activeOverlay = (overlays[overlays.length - 1] as HTMLElement) || document.body;
    const card = (activeOverlay.querySelector('.bg-white.rounded-2xl, .bg-white.rounded-xl, .bg-white.rounded-t-3xl') || activeOverlay.firstElementChild) as HTMLElement | null;

    let cardData = null;
    if (card) {
      const cr = card.getBoundingClientRect();
      cardData = {
        top: Math.round(cr.top),
        bottom: Math.round(cr.bottom),
        height: Math.round(cr.height),
        width: Math.round(cr.width),
        insideViewport: cr.top >= 0 && cr.bottom <= innerH
      };
    }

    // Header (first colored header or title bar inside card)
    const header = (card?.querySelector('.bg-slate-900, header, .border-b') || card?.firstElementChild) as HTMLElement | null;
    let headerData = null;
    if (header) {
      const hr = header.getBoundingClientRect();
      headerData = {
        top: Math.round(hr.top),
        bottom: Math.round(hr.bottom),
        height: Math.round(hr.height),
        insideViewport: hr.top >= 0 && hr.bottom <= innerH
      };
    }

    // Close button (X icon or button with title/aria Fermer/Close/Cancel)
    const buttons = Array.from(card?.querySelectorAll('button') || []);
    const closeBtn = buttons.find(b =>
      b.querySelector('svg.lucide-x') ||
      b.getAttribute('aria-label')?.match(/fermer|close/i) ||
      b.getAttribute('title')?.match(/fermer|close|échap/i) ||
      b.textContent?.trim().match(/^(Fermer|Close|Annuler|Cancel|×)$/i)
    ) as HTMLElement | null;

    let closeBtnData = null;
    if (closeBtn) {
      const br = closeBtn.getBoundingClientRect();
      closeBtnData = {
        top: Math.round(br.top),
        bottom: Math.round(br.bottom),
        height: Math.round(br.height),
        width: Math.round(br.width),
        insideViewport: br.top >= 0 && br.bottom <= innerH
      };
    }

    // Primary Action button (Print, Save, Record, Start, Confirm, Encaisser, Reprendre)
    const primaryBtn = buttons.find(b =>
      b.getAttribute('type') === 'submit' ||
      b.textContent?.match(/Imprimer|Print|Enregistrer|Record|Démarrer|Start|Confirmer|Confirm|Reprendre|Rembourser/i) ||
      b.classList.contains('bg-emerald-600') ||
      b.classList.contains('bg-emerald-700') ||
      b.classList.contains('bg-blue-600') ||
      b.classList.contains('bg-amber-600')
    ) as HTMLElement | null;

    let primaryData = null;
    if (primaryBtn) {
      const pr = primaryBtn.getBoundingClientRect();
      primaryData = {
        text: primaryBtn.textContent?.trim().slice(0, 30) || '',
        top: Math.round(pr.top),
        bottom: Math.round(pr.bottom),
        height: Math.round(pr.height),
        width: Math.round(pr.width),
        insideViewport: pr.top >= 0 && pr.bottom <= innerH
      };
    }

    // Scrollable body
    const bodyEl = (card?.querySelector('.overflow-y-auto, .divide-y, form') || card) as HTMLElement | null;
    let bodyData = null;
    if (bodyEl) {
      bodyData = {
        scrollHeight: bodyEl.scrollHeight,
        clientHeight: bodyEl.clientHeight,
        scrolls: bodyEl.scrollHeight > bodyEl.clientHeight + 2
      };
    }

    // Small text nodes (< 12px)
    const smallTextSamples: Array<{ text: string; fontSizePx: number; tagName: string }> = [];
    if (card) {
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT);
      let el = walker.nextNode() as HTMLElement | null;
      while (el) {
        const hasText = Array.from(el.childNodes).some(c => c.nodeType === Node.TEXT_NODE && c.textContent && c.textContent.trim().length > 0);
        if (hasText) {
          const s = window.getComputedStyle(el);
          const fs = parseFloat(s.fontSize) || 0;
          if (fs > 0 && fs < 12) {
            smallTextSamples.push({
              text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
              fontSizePx: Math.round(fs * 10) / 10,
              tagName: el.tagName.toLowerCase()
            });
          }
        }
        el = walker.nextNode() as HTMLElement | null;
      }
    }

    return {
      modalName,
      viewport: viewportName,
      innerH,
      innerW,
      card: cardData,
      header: headerData,
      closeBtn: closeBtnData,
      primaryAction: primaryData,
      body: bodyData,
      smallTextNodesCount: smallTextSamples.length,
      smallTextSamples: smallTextSamples.slice(0, 10)
    };
  }, { modalName, viewportName });
}

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

async function runBaseline() {
  console.log('=== STARTING BATCH UI-3 BASELINE MEASUREMENTS ===');
  const dbPath = '/tmp/audit_test_b3_baseline.sqlite';
  seedAuditDb(dbPath);

  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      PORT: '3366',
      HOST: '127.0.0.1'
    },
    stdio: 'ignore'
  });

  const baselineData: Record<string, any> = {
    timestamp: new Date().toISOString(),
    description: 'Baseline measurements for Batch UI-3 (modal clipping, small text, contrast) before code changes',
    viewports: {}
  };

  try {
    await waitForServer('http://127.0.0.1:3366/api/health');
    console.log('Backend server running on port 3366');

    const browser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: true
    });

    for (const vp of VIEWPORTS) {
      console.log(`\n======================================================`);
      console.log(`MEASURING MODALS AT VIEWPORT: ${vp.name} (${vp.width}x${vp.height})`);
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
          localStorage.setItem('jazira_held_carts', JSON.stringify([
            {
              id: 'held_1',
              label: 'Panier Client Passager',
              created_at: new Date().toISOString(),
              saleDiscount: 0,
              customer: null,
              items: [
                { cart_item_id: 'c1', product_id: 'prod-01', name: 'Javel Parfumée Citron 1.5L', unit_price: 2.4, quantity: 2, pack_multiplier: 1 },
                { cart_item_id: 'c2', product_id: 'prod-05', name: 'Liquide Vaisselle Pomme 1L', unit_price: 3.1, quantity: 1, pack_multiplier: 1 }
              ]
            }
          ]));
        } catch(e) {}
      `);

      await page.goto('http://127.0.0.1:3366');
      await page.waitForTimeout(1000);

      const modalResults: Record<string, ModalMeasurement> = {};

      // Helper to navigate to Backoffice tab
      async function gotoBackofficeTab(tabName: string) {
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
          await page.waitForTimeout(400);
        }
      }

      // Helper to navigate to POS
      async function gotoPos() {
        if (!vp.isMobile) {
          const ctBtn = page.locator('header nav button:has-text("Countertop")');
          if (await ctBtn.isVisible()) await ctBtn.click({ force: true });
        } else {
          const mobBtn = page.locator('header nav button').filter({ has: page.locator('svg.lucide-shopping-cart, svg.lucide-smartphone') }).first();
          if (await mobBtn.isVisible()) {
            await mobBtn.click({ force: true });
          } else {
            await page.click('button:has-text("Mobile")').catch(() => {});
          }
        }
        await page.waitForTimeout(400);
      }

      // 1. ReceiptPrintModal (from Backoffice Sales History)
      console.log('-> Measuring ReceiptPrintModal...');
      await gotoBackofficeTab('Ventes');
      const receiptBtn = page.locator('button[title="Réimprimer ticket thermique"]').first();
      await receiptBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      if (await receiptBtn.isVisible()) {
        await receiptBtn.click({ force: true });
        await page.waitForTimeout(400);
        modalResults['ReceiptPrintModal'] = await measureActiveModal(page, 'ReceiptPrintModal', vp.name);
        await safeCloseModal(page);
      }

      // 2. InvoicePrintModal
      console.log('-> Measuring InvoicePrintModal...');
      await gotoBackofficeTab('Ventes');
      const invoiceBtn = page.locator('button[title="Facture A4 professionnelle"]').first();
      await invoiceBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      if (await invoiceBtn.isVisible()) {
        await invoiceBtn.click({ force: true });
        await page.waitForTimeout(400);
        modalResults['InvoicePrintModal'] = await measureActiveModal(page, 'InvoicePrintModal', vp.name);
        await safeCloseModal(page);
      }

      // 3. DeliveryNotePrintModal
      console.log('-> Measuring DeliveryNotePrintModal...');
      await gotoBackofficeTab('Ventes');
      const blBtn = page.locator('button[title="Bon de Livraison (BL)"]').first();
      await blBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      if (await blBtn.isVisible()) {
        await blBtn.click({ force: true });
        await page.waitForTimeout(400);
        modalResults['DeliveryNotePrintModal'] = await measureActiveModal(page, 'DeliveryNotePrintModal', vp.name);
        await safeCloseModal(page);
      }

      // 4. RefundModal
      console.log('-> Measuring RefundModal...');
      await gotoBackofficeTab('Ventes');
      const refundBtn = page.locator('button[title="Remboursement"]').first();
      await refundBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      if (await refundBtn.isVisible()) {
        await refundBtn.click({ force: true });
        await page.waitForTimeout(400);
        modalResults['RefundModal'] = await measureActiveModal(page, 'RefundModal', vp.name);
        await safeCloseModal(page);
      }

      // 5. CustomerStatementModal
      console.log('-> Measuring CustomerStatementModal...');
      await gotoBackofficeTab('Customers & Debt');
      const custRow = page.locator('tr:has-text("Grossiste Ben Salem"), div:has-text("Grossiste Ben Salem")').first();
      await custRow.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      if (await custRow.isVisible()) {
        await custRow.click({ force: true });
        await page.waitForTimeout(400);
        const stmtBtn = page.locator('button:has-text("Imprimer / PDF")').first();
        if (await stmtBtn.isVisible()) {
          await stmtBtn.click({ force: true });
          await page.waitForTimeout(400);
          modalResults['CustomerStatementModal'] = await measureActiveModal(page, 'CustomerStatementModal', vp.name);
          await safeCloseModal(page);
        }
      }

      // 6. SessionModal (Z-Report)
      console.log('-> Measuring SessionModal (Z-Report)...');
      await gotoBackofficeTab('Register Audits');
      const zBtn = page.locator('button[title*="Z-Report"], button:has-text("Z-Report")').first();
      await zBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      if (await zBtn.isVisible()) {
        await zBtn.click({ force: true });
        await page.waitForTimeout(400);
        modalResults['SessionModal_ZReport'] = await measureActiveModal(page, 'SessionModal_ZReport', vp.name);
        await safeCloseModal(page);
      }

      // Switch back to POS view for header & cashier modals
      await gotoPos();

      // 7. SessionModal (Close)
      console.log('-> Measuring SessionModal (Close)...');
      const closeSessBtn = page.locator('header button[title*="Close Register Session"], header button:has-text("Close")').first();
      if (await closeSessBtn.isVisible()) {
        await closeSessBtn.click({ force: true });
        await page.waitForTimeout(400);
        modalResults['SessionModal_Close'] = await measureActiveModal(page, 'SessionModal_Close', vp.name);
        await safeCloseModal(page);
      }

      // 8. SessionModal (Open)
      console.log('-> Measuring SessionModal (Open)...');
      const openSessBtn = page.locator('header button[title="Ouvrir une nouvelle session"]').first();
      if (await openSessBtn.isVisible()) {
        await openSessBtn.click({ force: true });
        await page.waitForTimeout(400);
        modalResults['SessionModal_Open'] = await measureActiveModal(page, 'SessionModal_Open', vp.name);
        await safeCloseModal(page);
      }

      // 9. CashMovementModal
      console.log('-> Measuring CashMovementModal...');
      const cashMoveBtn = page.locator('header button[title*="Cash In"], header button:has-text("Cash In/Out")').first();
      if (await cashMoveBtn.isVisible()) {
        await cashMoveBtn.click({ force: true });
        await page.waitForTimeout(400);
        modalResults['CashMovementModal'] = await measureActiveModal(page, 'CashMovementModal', vp.name);
        await safeCloseModal(page);
      }

      // 10. HeldCartsModal
      console.log('-> Measuring HeldCartsModal...');
      const heldBtn = page.locator('button[title*="Paniers en attente"], button[title*="panier"], button:has-text("Paniers")').first();
      if (await heldBtn.isVisible()) {
        await heldBtn.click({ force: true });
        await page.waitForTimeout(400);
        modalResults['HeldCartsModal'] = await measureActiveModal(page, 'HeldCartsModal', vp.name);
        await safeCloseModal(page);
      }

      // 11. QuickPriceLookupModal
      console.log('-> Measuring QuickPriceLookupModal...');
      const lookupBtn = page.locator('button:has-text("Vérif Prix"), button[title*="F3"]').first();
      if (await lookupBtn.isVisible()) {
        await lookupBtn.click({ force: true });
        await page.waitForTimeout(400);
        const lookupInput = page.locator('input[data-scanner-input="true"]').last();
        if (await lookupInput.isVisible()) {
          await lookupInput.fill('Javel');
          await page.waitForTimeout(300);
        }
        modalResults['QuickPriceLookupModal'] = await measureActiveModal(page, 'QuickPriceLookupModal', vp.name);
        await safeCloseModal(page);
      }

      // 12. QuickAddModal
      console.log('-> Measuring QuickAddModal...');
      const quickAddBtn = page.locator('button:has-text("Quick Add"), button[title*="Quick-add"]').first();
      if (await quickAddBtn.isVisible()) {
        await quickAddBtn.click({ force: true });
        await page.waitForTimeout(400);
        modalResults['QuickAddModal'] = await measureActiveModal(page, 'QuickAddModal', vp.name);
        await safeCloseModal(page);
      }

      baselineData.viewports[vp.name] = {
        viewport: vp.name,
        width: vp.width,
        height: vp.height,
        modals: modalResults
      };

      await context.close();
    }

    await browser.close();

    fs.writeFileSync(OUTPUT_BASELINE_PATH, JSON.stringify(baselineData, null, 2), 'utf8');
    console.log(`\nBaseline measurements written to: ${OUTPUT_BASELINE_PATH}`);

    // Print baseline table
    console.log('\n========================================================================================================================================');
    console.log('BATCH UI-3 MODAL BASELINE SUMMARY TABLE');
    console.log('========================================================================================================================================');
    console.log(
      String('Modal').padEnd(26) + ' | ' +
      String('Viewport').padEnd(16) + ' | ' +
      String('Card (T..B)').padEnd(14) + ' | ' +
      String('CloseBtn (In VP)').padEnd(16) + ' | ' +
      String('Primary (In VP)').padEnd(16) + ' | ' +
      String('Body Scrolls').padEnd(13) + ' | ' +
      String('<12px Nodes')
    );
    console.log('-'.repeat(120));

    for (const [vpName, vpData] of Object.entries(baselineData.viewports as Record<string, any>)) {
      for (const [mName, m] of Object.entries(vpData.modals as Record<string, ModalMeasurement>)) {
        const cardStr = m.card ? `${m.card.top}..${m.card.bottom} (${m.card.insideViewport ? 'YES' : 'CLIP!'})` : 'N/A';
        const closeStr = m.closeBtn ? `${m.closeBtn.top}..${m.closeBtn.bottom} (${m.closeBtn.insideViewport ? 'YES' : 'NO!'})` : 'N/A';
        const primStr = m.primaryAction ? `${m.primaryAction.top}..${m.primaryAction.bottom} (${m.primaryAction.insideViewport ? 'YES' : 'NO!'})` : 'N/A';
        const bodyStr = m.body ? `${m.body.scrolls ? 'YES' : 'NO'} (${m.body.scrollHeight}h)` : 'N/A';
        console.log(
          mName.padEnd(26) + ' | ' +
          vpName.padEnd(16) + ' | ' +
          cardStr.padEnd(14) + ' | ' +
          closeStr.padEnd(16) + ' | ' +
          primStr.padEnd(16) + ' | ' +
          bodyStr.padEnd(13) + ' | ' +
          m.smallTextNodesCount
        );
      }
    }
    console.log('========================================================================================================================================\n');

  } finally {
    server.kill();
  }
}

runBaseline().catch(err => {
  console.error('[Baseline Error]', err);
  process.exit(1);
});
