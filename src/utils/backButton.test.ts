import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerBackHandler,
  handleBackButton,
  resetBackHandlersForTest,
  getBackHandlersCount
} from './backButton.js';
import { Capacitor } from '@capacitor/core';

const mockMinimizeApp = vi.fn().mockResolvedValue(undefined);
const mockExitApp = vi.fn().mockResolvedValue(undefined);

vi.mock('@capacitor/app', () => ({
  App: {
    minimizeApp: () => mockMinimizeApp(),
    exitApp: () => mockExitApp(),
    addListener: vi.fn(),
  }
}));

describe('Step 4: Android Hardware Back Button Handling', () => {
  beforeEach(() => {
    resetBackHandlersForTest();
    vi.clearAllMocks();
  });

  it('executes handlers in LIFO stack order and stops at first consuming handler', () => {
    const log: string[] = [];

    const unreg1 = registerBackHandler(() => {
      log.push('first');
      return true;
    });

    const unreg2 = registerBackHandler(() => {
      log.push('second');
      return true;
    });

    // Second (topmost) handler should run and consume the event
    const handled = handleBackButton();
    expect(handled).toBe(true);
    expect(log).toEqual(['second']);

    // Unregister top handler: first should now run
    unreg2();
    log.length = 0;
    const handled2 = handleBackButton();
    expect(handled2).toBe(true);
    expect(log).toEqual(['first']);

    unreg1();
    expect(getBackHandlersCount()).toBe(0);
  });

  it('minimizes app (does NOT exit) when no handlers consume the event', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);

    const handled = handleBackButton();
    expect(handled).toBe(false);
    expect(mockMinimizeApp).toHaveBeenCalledTimes(1);
    expect(mockExitApp).not.toHaveBeenCalled();
  });

  it('preserves cart and closes modal when back is pressed DURING checkout', () => {
    let modalOpen = true;
    let saleDoneCalled = false;
    let cart = [{ id: 'item_1', name: 'Product A' }];

    const onClose = () => { modalOpen = false; };
    const onSaleDone = () => {
      saleDoneCalled = true;
      cart = [];
    };

    let completedSale: any = null;

    // Simulate CheckoutModal handler registration
    const unregister = registerBackHandler(() => {
      if (completedSale) {
        onSaleDone();
        onClose();
      } else {
        onClose();
      }
      return true;
    });

    // Press back during active tender entry
    const handled = handleBackButton();
    expect(handled).toBe(true);
    expect(modalOpen).toBe(false);
    expect(saleDoneCalled).toBe(false);
    // Cart is preserved!
    expect(cart.length).toBe(1);

    unregister();
  });

  it('clears cart via onSaleDone when back is pressed on COMPLETED sale screen', () => {
    let modalOpen = true;
    let saleDoneCalled = false;
    let cart = [{ id: 'item_1', name: 'Product A' }];
    let saleDiscount = 5;

    const onClose = () => { modalOpen = false; };
    const onSaleDone = () => {
      saleDoneCalled = true;
      cart = [];
      saleDiscount = 0;
    };

    let completedSale = { sale_id: 'sale_999', receipt_number: 'REC-999' };

    // Simulate CheckoutModal handler registration on success screen
    const unregister = registerBackHandler(() => {
      if (completedSale) {
        onSaleDone();
        onClose();
      } else {
        onClose();
      }
      return true;
    });

    // Press back on completed sale screen
    const handled = handleBackButton();
    expect(handled).toBe(true);
    expect(modalOpen).toBe(false);
    expect(saleDoneCalled).toBe(true);
    // Cart and discount cleared!
    expect(cart.length).toBe(0);
    expect(saleDiscount).toBe(0);

    unregister();
  });

  it('closes nested camera over drawer in proper sequential order', () => {
    let cameraOpen = true;
    let drawerOpen = true;

    // Register drawer handler first
    const unregDrawer = registerBackHandler(() => {
      if (drawerOpen) {
        drawerOpen = false;
        return true;
      }
      return false;
    });

    // Register camera scanner on top of drawer
    const unregCamera = registerBackHandler(() => {
      if (cameraOpen) {
        cameraOpen = false;
        return true;
      }
      return false;
    });

    // 1st back: closes camera
    expect(handleBackButton()).toBe(true);
    expect(cameraOpen).toBe(false);
    expect(drawerOpen).toBe(true);
    unregCamera();

    // 2nd back: closes drawer
    expect(handleBackButton()).toBe(true);
    expect(drawerOpen).toBe(false);
    unregDrawer();

    // 3rd back: nothing open -> falls through to minimize
    expect(handleBackButton()).toBe(false);
  });

  it('MOB-01: ensures all 25 application modals register useBackButton or registerBackHandler', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const modalFiles = [
      'src/components/shared/SessionModal.tsx',
      'src/components/shared/RefundModal.tsx',
      'src/components/shared/CashMovementModal.tsx',
      'src/components/shared/QuickAddModal.tsx',
      'src/components/shared/CameraScannerModal.tsx',
      'src/components/shared/FamilySizesModal.tsx',
      'src/components/shared/ReceiptPrintModal.tsx',
      'src/components/shared/InvoicePrintModal.tsx',
      'src/components/shared/DeliveryNotePrintModal.tsx',
      'src/components/shared/AuthCredentialsModal.tsx',
      'src/components/backoffice/ContainerTransactionModal.tsx',
      'src/components/backoffice/CreateCustomerModal.tsx',
      'src/components/backoffice/InventoryAdjustmentModal.tsx',
      'src/components/backoffice/BatchDetailModal.tsx',
      'src/components/backoffice/ConfirmDeleteModal.tsx',
      'src/components/backoffice/CreateContainerModal.tsx',
      'src/components/backoffice/CreateExpenseModal.tsx',
      'src/components/backoffice/CreateFormulationModal.tsx',
      'src/components/backoffice/CreateMaterialModal.tsx',
      'src/components/backoffice/CreateProductModal.tsx',
      'src/components/backoffice/CreatePurchaseModal.tsx',
      'src/components/backoffice/CreateSupplierModal.tsx',
      'src/components/backoffice/CustomerStatementModal.tsx',
      'src/components/backoffice/ManageCategoriesModal.tsx',
      'src/components/backoffice/MaterialPriceHistoryModal.tsx',
      'src/components/backoffice/PurchaseDetailModal.tsx',
    ];

    const missingBackHandler: string[] = [];

    for (const relPath of modalFiles) {
      const fullPath = path.resolve(process.cwd(), relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (!content.includes('useBackButton') && !content.includes('registerBackHandler')) {
        missingBackHandler.push(relPath);
      }
    }

    expect(missingBackHandler).toEqual([]);
  });
});
