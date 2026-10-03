# AUDIT PROGRESS CHECKLIST

## Module 1: server/utils [x] (1 finding)
- [x] server/utils/barcode.ts (20 lines) — 0 findings
- [x] server/utils/container.ts (77 lines) — 1 finding
- [x] server/utils/money.ts (69 lines) — 0 findings

## Module 2: server/db [x] (3 findings)
- [x] server/db/index.ts (79 lines) — 0 findings
- [x] server/db/schema.sql (413 lines) — 3 findings
- [x] server/db/seed.ts (113 lines) — 0 findings

## Module 3: server/services [x] (1 finding)
- [x] server/services/backupService.ts (218 lines) — 0 findings (backup timer waits 24h already known)
- [x] server/services/costingService.ts (137 lines) — 0 findings
- [x] server/services/debtService.ts (295 lines) — 1 finding
- [x] server/services/registerService.ts (75 lines) — 0 findings (expected cash double deduct already known)

## Module 4: server/routes & server/ [x] (11 findings + 2 conflicts)
- [x] server/index.ts (101 lines) — 1 finding
- [x] server/hardware/usb_printer.py (163 lines) — 0 findings
- [x] server/routes/accounting.ts (265 lines) — 2 findings
- [x] server/routes/auth.ts (228 lines) — 1 finding
- [x] server/routes/backup.ts (68 lines) — 0 findings
- [x] server/routes/categories.ts (188 lines) — 0 findings
- [x] server/routes/containers.ts (273 lines) — 0 findings
- [x] server/routes/customers.ts (336 lines) — 1 conflict (cash debt payment creates no CASH_IN)
- [x] server/routes/formulations.ts (201 lines) — 1 finding
- [x] server/routes/hardware.ts (426 lines) — 1 finding
- [x] server/routes/inventory.ts (181 lines) — 0 findings
- [x] server/routes/materials.ts (295 lines) — 1 finding
- [x] server/routes/production.ts (193 lines) — 0 findings
- [x] server/routes/products.ts (527 lines) — 2 findings
- [x] server/routes/register.ts (358 lines) — 1 conflict (dynamic counter creation/deletion)
- [x] server/routes/reports.ts (304 lines) — 1 finding
- [x] server/routes/sales.ts (899 lines) — 2 findings
- [x] server/routes/suppliers.ts (500 lines) — 1 finding
- [x] server/routes/sync.ts (400 lines) — 1 finding

## Module 5: src/utils [x] (1 finding)
- [x] src/utils/audio.ts (69 lines) — 0 findings
- [x] src/utils/cart.ts (206 lines) — 1 finding
- [x] src/utils/formatters.ts (66 lines) — 0 findings (roundMoney lacks EPSILON already known)

## Module 6: src/services & src/db [x] (3 findings)
- [x] src/db/clientDb.ts (93 lines) — 0 findings
- [x] src/services/authService.ts (191 lines) — 1 finding
- [x] src/services/syncManager.ts (209 lines) — 2 findings
- [x] src/services/hardware/barcode.ts (37 lines) — 0 findings
- [x] src/services/hardware/escpos.ts (213 lines) — 0 findings
- [x] src/services/hardware/scanner.ts (101 lines) — 0 findings
- [x] src/services/hardware/webbluetooth.ts (161 lines) — 0 findings
- [x] src/services/hardware/webserial.ts (131 lines) — 0 findings
- [x] src/services/hardware/webusb.ts (174 lines) — 0 findings

## Module 7: src/stores/hooks & types [x] (0 findings)
- [x] src/types/index.ts (218 lines) — 0 findings

## Module 8: src/components & pages & root src [x] (2 findings)
- [x] src/main.tsx (10 lines) — 0 findings
- [x] src/App.tsx (356 lines) — 2 findings
- [x] src/index.css (68 lines) — 0 findings
- [x] src/components/backoffice/Backoffice.tsx (2644 lines) — 0 findings
- [x] src/components/backoffice/BackupManager.tsx (295 lines) — 0 findings
- [x] src/components/backoffice/BarcodeLabelPrinter.tsx (173 lines) — 0 findings
- [x] src/components/backoffice/ConfirmDeleteModal.tsx (98 lines) — 0 findings
- [x] src/components/backoffice/ContainerTransactionModal.tsx (266 lines) — 0 findings
- [x] src/components/backoffice/CreateContainerModal.tsx (177 lines) — 0 findings
- [x] src/components/backoffice/CreateCustomerModal.tsx (248 lines) — 0 findings
- [x] src/components/backoffice/CreateExpenseModal.tsx (211 lines) — 0 findings
- [x] src/components/backoffice/CreateFormulationModal.tsx (552 lines) — 0 findings
- [x] src/components/backoffice/CreateMaterialModal.tsx (324 lines) — 0 findings
- [x] src/components/backoffice/CreateProductModal.tsx (565 lines) — 0 findings
- [x] src/components/backoffice/CreatePurchaseModal.tsx (527 lines) — 0 findings
- [x] src/components/backoffice/CreateSupplierModal.tsx (172 lines) — 0 findings
- [x] src/components/backoffice/InventoryAdjustmentModal.tsx (274 lines) — 0 findings
- [x] src/components/backoffice/ManageCategoriesModal.tsx (338 lines) — 0 findings
- [x] src/components/backoffice/MaterialPriceHistoryModal.tsx (162 lines) — 0 findings
- [x] src/components/backoffice/ReportsTab.tsx (630 lines) — 0 findings
- [x] src/components/desktop/DesktopPos.tsx (874 lines) — 0 findings
- [x] src/components/mobile/MobileRegister.tsx (1350 lines) — 0 findings
- [x] src/components/shared/AuthCredentialsModal.tsx (421 lines) — 0 findings
- [x] src/components/shared/CameraScannerModal.tsx (242 lines) — 0 findings
- [x] src/components/shared/CashMovementModal.tsx (175 lines) — 0 findings
- [x] src/components/shared/CheckoutModal.tsx (556 lines) — 0 findings
- [x] src/components/shared/FamilySizesModal.tsx (97 lines) — 0 findings
- [x] src/components/shared/Header.tsx (420 lines) — 0 findings
- [x] src/components/shared/InvoicePrintModal.tsx (218 lines) — 0 findings
- [x] src/components/shared/LockScreenModal.tsx (291 lines) — 0 findings
- [x] src/components/shared/QuickAddModal.tsx (149 lines) — 0 findings
- [x] src/components/shared/ReceiptPrintModal.tsx (297 lines) — 0 findings
- [x] src/components/shared/RefundModal.tsx (375 lines) — 0 findings
- [x] src/components/shared/SessionModal.tsx (484 lines) — 0 findings

## Module 9: config / deploy / package.json [x] (1 finding)
- [x] package.json (42 lines) — 0 findings
- [x] tsconfig.json (20 lines) — 0 findings
- [x] vite.config.ts (22 lines) — 0 findings
- [x] tailwind.config.js (21 lines) — 0 findings
- [x] postcss.config.js (6 lines) — 0 findings
- [x] index.html (16 lines) — 1 finding

## Module 10: tests [x] (0 findings)
- [x] tests/full_test_plan.test.ts (1249 lines) — 0 findings
- [x] tests/testApp.ts (34 lines) — 0 findings
- [x] server/utils/container.test.ts (74 lines) — 0 findings
- [x] server/utils/money.test.ts (73 lines) — 0 findings
- [x] server/db/schema.test.ts (143 lines) — 0 findings
- [x] server/routes/accounting.test.ts (186 lines) — 0 findings
- [x] server/routes/auth.test.ts (163 lines) — 0 findings
- [x] server/routes/backoffice_modals.test.ts (343 lines) — 0 findings
- [x] server/routes/backup.test.ts (104 lines) — 0 findings
- [x] server/routes/categories.test.ts (146 lines) — 0 findings
- [x] server/routes/containers.test.ts (153 lines) — 0 findings
- [x] server/routes/customers.test.ts (175 lines) — 0 findings
- [x] server/routes/formulations.test.ts (152 lines) — 0 findings
- [x] server/routes/hardware.test.ts (124 lines) — 0 findings
- [x] server/routes/materials.test.ts (226 lines) — 0 findings
- [x] server/routes/production.test.ts (170 lines) — 0 findings
- [x] server/routes/products.test.ts (329 lines) — 0 findings
- [x] server/routes/refunds.test.ts (226 lines) — 0 findings
- [x] server/routes/register.test.ts (312 lines) — 0 findings
- [x] server/routes/reports.test.ts (196 lines) — 0 findings
- [x] server/routes/sales.test.ts (564 lines) — 0 findings
- [x] server/routes/suppliers.test.ts (261 lines) — 0 findings
- [x] server/routes/sync.test.ts (187 lines) — 0 findings
- [x] src/services/authService.test.ts (81 lines) — 0 findings
- [x] src/services/hardware/escpos.test.ts (122 lines) — 0 findings
- [x] src/services/hardware/hardwareDrivers.test.ts (76 lines) — 0 findings
- [x] src/services/hardware/scanner.test.ts (39 lines) — 0 findings
- [x] src/utils/cart.test.ts (232 lines) — 0 findings
