# JaziraERP Countertop UI/UX Audit — Precise Fix Plan (2026-10)

This plan provides an **ordered, incremental, batch-by-batch execution roadmap** to remediate all 49 measured UI/UX violations and achieve 100% compliance with the 14 ergonomic targets.

> [!IMPORTANT]
> **Strict Implementation Guardrails**:
> 1. **Zero Business Logic Edits**: No changes to calculation logic, rounding routines, FIFO allocations, or SQLite schemas.
> 2. **Zero API / State Alterations**: Only Tailwind styling classes, typography tokens, padding/gap dimensions, and minimum touch boundaries are modified.
> 3. **Mechanical Verification**: Every batch must be verified by running `npx tsx docs/audit-ui-2026-10/scratch/measure.ts`, checking that violation counts decrease toward zero with 0 regressions in existing tests (`npm test`).

---

## Batch 1: POS Cart & Checkout Modal (Desktop & Mobile)

**Primary Objective**: Solve the operator's primary complaint ("cart text and numbers are too small to read at a glance") and fix the undersized checkout tender fields.

### Target Files & Line Ranges
1. `src/components/desktop/DesktopPos.tsx` (lines 905–1055, 1150–1210)
2. `src/components/mobile/MobileRegister.tsx` (lines 620–710, 890–940)
3. `src/components/shared/CheckoutModal.tsx` (lines 500–515, 615–640, 700–710, 750–765)

### Exact Class Replacement Mapping
```
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
| Target Element & Location                | Old Tailwind Classes                     | New Tailwind Classes / Styles                             |
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
| Cart Product Name (DesktopPos:910)       | text-xs font-bold text-slate-900 truncate| text-base font-bold text-slate-900 leading-snug line-clamp-2|
| Unit Price Input (DesktopPos:940)        | text-[10px] w-16 font-mono font-bold     | text-base w-20 font-mono font-bold py-1 px-1.5            |
| Stepper Buttons (DesktopPos:1016, 1030)  | px-2 py-0.5 text-xs                      | px-3 py-1.5 text-sm font-bold min-w-[36px] min-h-[36px]   |
| Stepper Qty Input (DesktopPos:1026)      | w-12 text-xs font-bold font-mono         | w-16 text-lg font-bold font-mono py-1                     |
| Line Total (DesktopPos:1044)             | text-xs font-black font-mono             | text-base font-black font-mono                            |
| Grand Total Display (DesktopPos:1167)    | text-xl text-emerald-700 font-mono       | text-3xl font-black text-emerald-700 font-mono            |
| Checkout Button (DesktopPos:1200)        | py-3 text-sm font-black                  | py-3.5 text-lg font-black tracking-wide                  |
| Mobile Cart Row Name (MobileReg:640)     | text-xs font-bold truncate               | text-base font-bold leading-tight                         |
| Mobile Stepper (+ / -) (MobileReg:660)   | w-7 h-7 text-xs                          | w-11 h-11 text-base font-bold min-w-[44px] min-h-[44px]  |
| Mobile Delete Button (MobileReg:670)     | w-7 h-7 p-1                              | w-11 h-11 p-2 flex items-center justify-center            |
| Checkout Cash Input (CheckoutModal:620)  | text-lg font-bold font-mono              | text-2xl font-black font-mono py-2.5 px-3.5               |
| Checkout Total Due (CheckoutModal:508)   | text-3xl font-black                      | text-4xl font-black tracking-tight                        |
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
```

### Expected Layout Impact
- **Desktop ($1600 \times 780$)**: Row height increases from $42\text{px}$ to $56\text{px}$. With cart table height at $440\text{px}$, 7 full cart rows remain visible before scroll (exceeding Target 10 $\ge 6$ lines).
- **Phone ($384 \times 725$)**: Cart rows expand from $70\text{px}$ to $88\text{px}$ to accommodate 44px tap targets. Drawer header and footer padding must be tightened (`py-2` instead of `py-4`) to ensure 4 full rows remain visible (achieving Target 12).
- **Phone ($384 \times 400$, Soft Keyboard)**: Cash tender input (22px), change due (24px), and "Complete Sale" button remain fully visible within 380px without scrolling (maintaining Target 13).

### Risk Analysis
- **Zero Calculation Risk**: Handlers `handleUpdateQuantity`, `handleUpdateUnitPrice`, and `calculateCartTotals` remain untouched.
- **Verification Assertion**:
  ```bash
  npx tsx docs/audit-ui-2026-10/scratch/measure.ts
  # Assert: Target violations for 'Sale-critical text' drop from 9 to 0.
  # Assert: Target violations for 'Amount input' drop from 11 to 2.
  ```

---

## Batch 2: Modals & Print Previews (Receipt, Invoice, BL, Session, Movement)

**Primary Objective**: Eliminate modal overflow clipping on short viewports ($1563 \times 545$, $384 \times 400$) and upgrade modal input sizes.

### Target Files & Line Ranges
1. `src/components/shared/ReceiptPrintModal.tsx` (lines 170–190, 320–345)
2. `src/components/shared/InvoicePrintModal.tsx` (lines 150–175)
3. `src/components/shared/DeliveryNotePrintModal.tsx` (lines 150–175)
4. `src/components/shared/SessionModal.tsx` (lines 265–290, 470–505, 600–640)
5. `src/components/shared/CashMovementModal.tsx` (lines 140–185)
6. `src/components/shared/HeldCartsModal.tsx` (lines 110–160)
7. `src/components/shared/RefundModal.tsx` (lines 140–190)

### Exact Class Replacement Mapping
```
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
| Target Element & Location                | Old Tailwind Classes                     | New Tailwind Classes / Styles                             |
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
| Modal Wrapper (All Modals)               | fixed inset-0 flex items-center justify-center p-4 | fixed inset-0 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto max-h-screen |
| Inner Modal Card (ReceiptPrint:173)      | max-w-sm w-full overflow-hidden          | max-w-sm w-full max-h-[92vh] flex flex-col overflow-hidden my-auto |
| Counted Cash Input (SessionModal:479)    | text-lg font-bold font-mono px-3 py-2    | text-2xl font-black font-mono px-4 py-3                  |
| Movement Cash Input (CashMovement:155)   | text-lg font-bold font-mono px-3 py-2    | text-2xl font-black font-mono px-4 py-3                  |
| Thermal Receipt Monospace Font (Receipt:195)| text-[11px] font-mono leading-tight   | text-[12px] font-mono leading-snug                       |
| Session Modal Cash Variance (Session:601)| text-sm font-mono font-black             | text-lg font-mono font-black                             |
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
```

### Expected Layout Impact
- Modals on $1563 \times 545$ and $384 \times 400$ will vertically constrain their scrollable body while keeping header and footer action buttons permanently visible on-screen.
- Counted cash inputs match POS checkout scale (22px).

### Risk Analysis
- **Zero ESC/POS Print Risk**: CSS print rules (`print:w-[58mm]`, `print:static`) remain unchanged.

---

## Batch 3: Mobile Navigation, Bottom Bar & Update Banner

**Primary Objective**: Fix touch target compliance ($\ge 44 \times 44\text{px}$) on mobile bottom bar, raise nav font size from 10px to 12px, and fix the UpdateBanner WCAG contrast failure.

### Target Files & Line Ranges
1. `src/components/mobile/MobileRegister.tsx` (lines 1750–1795)
2. `src/components/shared/Header.tsx` (lines 175–215, 450–465)
3. `src/App.tsx` (lines 80–110, `UpdateBanner.tsx`)

### Exact Class Replacement Mapping
```
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
| Target Element & Location                | Old Tailwind Classes                     | New Tailwind Classes / Styles                             |
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
| UpdateBanner Container (App:85)          | bg-amber-500 text-white                  | bg-amber-500 text-slate-950 font-bold border-b border-amber-600 |
| UpdateBanner Contrast Ratio              | 2.14:1 (FAIL)                            | 9.15:1 (PASS AAA)                                         |
| Bottom Nav Container (MobileReg:1755)    | h-14 bg-white border-t                   | h-16 bg-white border-t border-slate-200 safe-area-pb       |
| Bottom Nav Buttons (MobileReg:1760)      | py-1 text-[10px]                         | py-2 text-xs font-bold min-h-[48px] flex flex-col items-center justify-center |
| Header View Buttons (Header:180)         | px-2.5 py-1 text-xs                      | px-3 py-1.5 text-xs font-bold min-h-[36px]                |
| Header Close Session Button (Header:461) | px-2 py-1 text-xs                        | px-3 py-1.5 text-xs font-bold min-h-[36px]                |
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
```

### Expected Layout Impact
- Mobile bottom navigation button height expands from $43\text{px}$ to $48\text{px}$ ($54\text{px}$ container), fully satisfying Target 08 ($44 \times 44\text{px}$).
- UpdateBanner text is instantly legible in high glare with black-on-amber contrast.

### Verification Assertion
```bash
npx tsx docs/audit-ui-2026-10/scratch/measure.ts
# Assert: Target violations for 'Touch targets on phone' drop from 8 to 0.
# Assert: Target violations for 'Contrast' drop from 3 to 0.
```

---

## Batch 4: Backoffice Tables, Tabs, Customer & Supplier Detail

**Primary Objective**: Eliminate sub-12px text across backoffice inventory tables, customer statements, reports, and settings.

### Target Files & Line Ranges
1. `src/components/backoffice/Backoffice.tsx` (lines 200–550)
2. `src/components/backoffice/CustomerStatementModal.tsx` (lines 120–220)
3. `src/components/backoffice/ReportsTab.tsx` (lines 100–350)
4. `src/components/backoffice/ShopSettingsPanel.tsx` (lines 80–200)

### Exact Class Replacement Mapping
```
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
| Target Element & Location                | Old Tailwind Classes                     | New Tailwind Classes / Styles                             |
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
| Backoffice Table Headers (`th`)          | text-[11px] font-bold text-slate-500     | text-xs font-bold text-slate-700 tracking-wider           |
| Backoffice Table Data (`td`)             | text-xs text-slate-700                   | text-sm font-medium text-slate-900                        |
| Financial Numbers in Tables              | text-xs font-bold font-mono              | text-sm font-bold font-mono                               |
| Secondary Badges & Dates                 | text-[10px] text-slate-400               | text-xs font-semibold text-slate-600                      |
| Customer Debt Statement Rows             | text-[11px] font-mono                    | text-xs font-bold font-mono                               |
+------------------------------------------+------------------------------------------+-----------------------------------------------------------+
```

### Expected Layout Impact
- Desktop backoffice tables improve readability without losing desktop horizontal density.
- No table row expands beyond $48\text{px}$.

---

## 5. Verification Protocol & Success Criteria

```
+--------------------+-----------------------------------------------------+----------------------------------------------------------+
| Checkpoint         | Verification Command                                | Acceptance Standard                                      |
+--------------------+-----------------------------------------------------+----------------------------------------------------------+
| Regression Suite   | npm test                                            | 62 test files passed, 519 unit & integration tests pass  |
| Full Measurement   | npx tsx docs/audit-ui-2026-10/scratch/measure.ts    | Exit code 0, 0 Target Violations (down from 49)          |
| Visual Validation  | Chrome inspection on all 6 viewports                | Review generated screenshots in screenshots/ directory   |
+--------------------+-----------------------------------------------------+----------------------------------------------------------+
```

---

## 6. What Was Not Verified (Hardware Isolation Boundary)

In accordance with strict audit disclosure standards, the following physical hardware interactions were **not** mechanically tested in this software audit environment:

1. **Physical ESC/POS 58mm Thermal Print Head Output**:
   - The test verified the software DOM preview, monospace line layout, CSS 58mm `@media print` rules, and WebUSB/Bluetooth printer driver payload construction.
   - Physical paper curl, thermal heat density, and paper tear-off physical tolerances on the counter printer were not physically verified.
2. **Physical 24V RJ11 Cash Drawer Solenoid**:
   - The test verified the software `handleDrawerClick` trigger and WebUSB/WebSerial kick pulse command dispatch.
   - The physical mechanical solenoid opening of the cash drawer under the counter was not mechanically observed.
3. **Physical Handheld USB Laser Barcode Scanner Cable Connection**:
   - The test verified software scanner interception via `keydown` events, buffer assembly, and `[data-scanner-input="true"]` field routing.
   - Physical laser diode bounce off curved glossy plastic detergent containers was not tested.
4. **Capacitor Android Hardware Bluetooth SPP Bonding**:
   - Tested in Chrome mobile viewport emulation with touch enabled.
   - Native Android OS Bluetooth pairing stack (MPT-II RFCOMM serial socket) was not executed on a physical Android device.
