# Frontend Audit Report — Al Jazira SHSP ERP

## Line-by-Line Findings

[SEV: High] src/components/desktop/DesktopPos.tsx:814 | Canceling or closing CheckoutModal wipes the active cart and discount | onClose={() => { setIsCheckoutOpen(false); setCart([]); setSaleDiscount(0); }} | Reset cart only on sale completion rather than when dismissing the checkout modal.
[SEV: High] src/components/mobile/MobileRegister.tsx:1256 | Canceling or closing CheckoutModal in mobile view wipes the active cart and discount | onClose={() => { setIsCheckoutOpen(false); setCart([]); setSaleDiscount(0); }} | Reset cart only on sale completion rather than when dismissing the checkout modal.
[SEV: High] src/components/desktop/DesktopPos.tsx:162 | Adding SKU to cart ignores pack_size.price_override and charges multiplier times base retail price | const itemPrice = packMultiplier > 1 ? roundMoney(effectivePrice * packMultiplier) : effectivePrice; | Prioritize pack_size.price_override over multiplying the base unit price.
[SEV: High] src/components/shared/InvoicePrintModal.tsx:189 | Printed A4 invoice displays Net à Payer with an uncollected +1.000 DT fiscal stamp not present on the POS receipt | <span>{formatMoney(sale.total_ttc + 1.000)}</span> | Remove the hardcoded +1.000 addition and display sale.total_ttc.
[SEV: Med] src/services/syncManager.ts:194 | Operations rejected by server and flagged needs_review are continuously re-submitted in an infinite loop on every flush | const items = await clientDb.pending_sync_queue.toArray(); | Filter out items with needs_review before sending sync batch.
[SEV: Med] src/components/shared/RefundModal.tsx:71 | Fully refunded item quantity defaults to 1 instead of remaining available quantity, causing immediate validation error on submit | setRefundQuantity(Math.max(1, maxAvail).toString()); | Select the first item with positive remaining quantity and cap initial quantity with Math.min(1, maxAvail).
[SEV: Med] src/utils/audio.ts:8 | Instantiating a new AudioContext on every scan beep without calling close() causes browser audio context exhaustion | const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)(); | Close audioCtx when the tone finishes or share a single AudioContext instance.
[SEV: Med] src/components/shared/CameraScannerModal.tsx:39 | Camera scanner instantiates new AudioContext on each barcode read without calling close() | const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)(); | Call audioCtx.close() after playback completes or use a persistent context.
[SEV: Med] src/components/backoffice/Backoffice.tsx:1407 | Customer debt payment button lacks submitting and disabled guard during in-flight network request, permitting duplicate payments | <button onClick={handlePayCustomerDebt} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shrink-0">Pay</button> | Add an isSubmitting state and disable the button while the payment request is pending.
[SEV: Med] src/components/backoffice/Backoffice.tsx:1431 | Customer wallet top-up button lacks disabled state during in-flight request, allowing accidental duplicate deposits | <button onClick={handleTopUpWallet} className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shrink-0">Top Up</button> | Add an isSubmitting state and disable the button while top-up is processing.
[SEV: Med] src/components/backoffice/Backoffice.tsx:1629 | Supplier debt repayment button has no disabled state during submission, enabling duplicate repayment records | <button onClick={handlePaySupplierDebt} className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-lg text-xs shrink-0 transition-colors shadow-sm">Pay Supplier</button> | Add an isSubmitting state and disable the button while repayment is processing.
[SEV: Med] src/components/backoffice/Backoffice.tsx:1157 | Production batch execution wizard submit button has no disabled state, permitting concurrent duplicate batch runs | <button type="submit" className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow text-xs transition-colors flex items-center justify-center gap-1.5"> | Add an isSubmitting state and disable the submit button during batch execution.
[SEV: Med] src/components/mobile/MobileRegister.tsx:427 | Customer debt repayment silently fails without user feedback when API returns non-2xx status | if (res.ok) { ... } | Add an else block that parses error response and sets paymentMsg with the server message.
[SEV: Med] src/components/mobile/MobileRegister.tsx:456 | Container transaction dialog fails silently on error and lacks a double-submit guard | if (res.ok) { setIsContainerModalOpen(false); onRefreshData(); } | Add error feedback handling and disable the button while submitting.
[SEV: Low] src/services/hardware/webserial.ts:73 | User canceling WebSerial prompt triggers catch fallback which opens a second native port chooser | }).catch(async () => { return await (navigator as any).serial.requestPort(); }); | Avoid invoking requestPort again if the error indicates user cancellation.
[SEV: Low] src/components/backoffice/CreateCustomerModal.tsx:219 | Initial wallet balance input is editable in customer edit mode but ignored in the PUT payload | <input type="number" min="0" step="0.001" value={walletBalance} onChange={e => setWalletBalance(e.target.value)} className="w-full font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none" /> | Disable or hide the initial wallet credit field when editing an existing customer.
[SEV: Low] src/components/backoffice/Backoffice.tsx:312 | Supplier debt repayment handler silently ignores non-2xx responses without error notification | if (res.ok) { ... } | Parse error response and display an error message in the supplierActionNotice banner.
[SEV: Low] src/components/backoffice/ReportsTab.tsx:151 | Direct toFixed call on debt payment amount in CSV export will throw TypeError if amount is null or string | p.amount.toFixed(3), | Guard with Number(p.amount || 0).toFixed(3).
[SEV: Low] src/App.tsx:129 | Dexie offline fallback omits product families from local store, causing family grouping to be empty offline | const localProducts = await clientDb.products.toArray(); | Store and sync product families in clientDb alongside products.
[SEV: Low] src/components/shared/Header.tsx:334 | Cash drawer kick and receipt test buttons lack debouncing, enabling rapid hardware queue spam | <button onClick={handleDrawerClick} ...> | Debounce hardware trigger buttons with a short cooldown or active status.

---

## Concluding Sections

### (a) Top 10 by Risk

1. **`src/components/desktop/DesktopPos.tsx:814` & `src/components/mobile/MobileRegister.tsx:1256`**: Cashier opens checkout, needs to check prices or edit items, hits "Cancel" or "X", and the entire scanned cart is permanently wiped, forcing re-scanning.
2. **`src/components/desktop/DesktopPos.tsx:162`**: Multi-pack SKU additions completely ignore `pack_size.price_override`, calculating price strictly as `multiplier * base_price` and overcharging or undercharging customers when custom pack prices exist.
3. **`src/components/shared/InvoicePrintModal.tsx:189`**: Printed A4 invoice adds a hardcoded `+ 1.000` DT fiscal stamp to `NET À PAYER TTC` that was never billed, creating an accounting discrepancy against the registered POS receipt total.
4. **`src/services/syncManager.ts:194`**: Offline outbox resends invalid operations marked `needs_review: true` continuously on every flush interval, generating permanent API sync noise.
5. **`src/components/backoffice/Backoffice.tsx:1407, 1431, 1629`**: Financial buttons for customer debt repayment, customer wallet top-ups, and supplier debt repayments have no disabled/in-flight guards, causing double payments on rapid clicks.
6. **`src/components/backoffice/Backoffice.tsx:1157`**: Production batch execution wizard form submission lacks a disabled state while in-flight, risking duplicate batch creation and double inventory deduction.
7. **`src/components/shared/RefundModal.tsx:71`**: When opening refund for a sale with already refunded items, `Math.max(1, maxAvail)` defaults refund quantity to 1 against 0 available, failing submit validation immediately.
8. **`src/utils/audio.ts:8` & `src/components/shared/CameraScannerModal.tsx:39`**: Barcode scanner beeps leak `AudioContext` instances without calling `.close()`, causing browser audio exhaustion after repeated scans.
9. **`src/components/mobile/MobileRegister.tsx:427, 456`**: Cashier debt and container adjustments fail silently when network or server returns HTTP 4xx/5xx, leaving the cashier assuming success.
10. **`src/components/backoffice/CreateCustomerModal.tsx:219`**: In customer edit mode, the wallet balance input is visible and editable, but completely omitted from the update payload, silently discarding manager edits.

---

### (b) Pattern-Sweep Table

| Pattern Category | Target Regex / Query | Hit Count | Verified Benign Count | Bugs Found | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Money & Rounding** | `parseFloat\|toFixed\|Math.round\|Math.floor\|Math.ceil\|Number\(` | 153 hits (25 files) | 151 | 2 (`DesktopPos.tsx:162`, `ReportsTab.tsx:151`) | `roundMoney` EPSILON logic and Tunisian 3-decimal formatting verified across cart and modals. |
| **TVA & Taxes** | `1.19\|0.19` | 8 hits (3 files) | 8 | 0 | 19% TVA breakdown logic strictly satisfies `HT + TVA = TTC` invariant across unit tests. |
| **Empty Catches / Swallowing** | `catch\s*\(?[^)]*\)?\s*\{\s*\}`, `.catch\(\(\) =>` | 14 hits (8 files) | 12 | 2 (`MobileRegister.tsx:427, 456`) | Hardware fallbacks deliberately swallow disconnect errors; API handlers must display error states. |
| **Double Submit** | Async `onClick`/`onSubmit` without loading guard | 48 handlers inspected | 43 | 5 (`Backoffice.tsx:1157, 1407, 1431, 1629`, `MobileRegister.tsx:456`) | Payment, top-up, and batch wizard buttons require disabled state during pending promises. |
| **Storage & Security** | `localStorage\|sessionStorage`, `innerHTML\|eval\|window.open` | 8 hits (auth only) | 8 | 0 | 0 DOM injection vulnerabilities. `localStorage` strictly restricted to offline PIN hash verification. |
| **Lifecycle & Effects** | `useEffect\(` | 38 calls (12 files) | 37 | 1 (`App.tsx:129` offline families) | Hardware event listeners (barcode scanner, serial) cleanly detach on unmount. |

---

### (c) PASSED Checks

1. **Exact 3-Decimal Precision & Invariant Verification**: `roundMoney` handles edge-case floats with `Number.EPSILON * 1000`. `src/utils/tax.ts` satisfies `subtotalHT + tvaAmount === totalTTC` without drift.
2. **Offline PIN Verification & Security**: `src/services/authService.ts` hashes offline PINs with Web Crypto SHA-256 before comparing against cached master/operator hashes in localStorage, preventing cleartext PIN exposure.
3. **Hardware Driver Cleanup**: `src/services/hardware/scanner.ts` and `src/components/desktop/DesktopPos.tsx` properly clean up `window.removeEventListener('keydown')` on unmount to prevent memory leaks and duplicate keystroke buffers.
4. **Offline Sale Outbox Queue Serialization**: `syncManager.ts` serializes items into Dexie IndexedDB with temp client IDs, handles offline drawer kicking, and returns temporary receipt numbers without blocking POS operation.
5. **Split Payment Balance Invariant**: `src/utils/cart.ts` `validateSplitPayment` guarantees cash + wallet + credit matches total TTC to within `0.001 DT`.
6. **Container Return Calculations**: `calculateContainersNeeded` correctly uses `Math.floor` on discrete capacity per spec without fractional containers.
7. **Negative Stock Policy**: Production batch wizard and POS cart accurately honor the specification policy allowing stock deficits while alerting the operator.
8. **Cash Drawer Pulse Isolation**: `App.tsx` triggers countertop USB serial cash drawer exclusively for desktop sales, suppressing noisy physical kicks during mobile sales.

---

### (d) Chunks / Files NOT Fully Read

*None. Every file in `src/` (and configuration files) was read, audited, and ticked in `AUDIT_FRONTEND_PROGRESS.md`.*
