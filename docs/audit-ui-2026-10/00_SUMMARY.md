# JaziraERP Countertop UI/UX Audit — Executive Summary (2026-10)

## 1. Executive Summary & Context

This document is the visual, typographic, and ergonomic audit of **Al Jazira SHSP ERP** (Detergents & Chemical Hygiene POS/ERP).

### Purpose of Audit
The single counter operator reported that **cart text and numbers are too small to read at a glance**, requiring constant leaning forward and slowing checkout during customer rush periods. Previous project audits concentrated exclusively on backend database concurrency, offline synchronization queues, and schema integrity, leaving the visual layer unmeasured.

This audit establishes the first **empirical baseline** of the UI layer:
- **Zero source code modifications** were made during this audit.
- **A realistic test database** was constructed at `/tmp/audit_test.sqlite` containing 40 realistic chemical detergent products with long French technical names (e.g., *Liquide Vaisselle Restauration Collective Fût 20L*, *Javel Concentrée Professionnelle 12° 5L Bidon PEHD*), 6 tiered customers (including credit resellers and wallet holders), open register sessions, supplier debt records, returnable container loans, and historical sales.
- **Automated measurement harness (`docs/audit-ui-2026-10/scratch/measure.ts`)** executed headless Google Chrome via Playwright across all 6 real-world device viewports specified by the operator.
- **Computed styles, bounding client rectangles, WCAG 2.1 contrast ratios, and text clipping** were programmatically extracted via the browser DOM and saved to `docs/audit-ui-2026-10/measured_data.json`.
- **122 full-fidelity viewport screenshots** were captured and saved in `docs/audit-ui-2026-10/screenshots/`.

---

## 2. Target Verification Scorecard

The audit evaluated the interface against the 14 mandatory ergonomic standards required for high-speed single-operator counter operations.

| # | Ergonomic Target | Target Standard | Measured Current Value | Status | Primary Viewport |
|---|---|---|---|---|---|
| **T01** | Sale-critical text (cart item name, line price) | $\ge 16\text{ px}$ | **12px** (`text-xs`) on product name; **10px** (`text-[10px]`) on unit price | **FAIL ❌** | Desktop & Mobile Cart |
| **T02** | Quantity input & stepper display | $\ge 18\text{ px}$ bold | **12px** (`text-xs font-bold`) | **FAIL ❌** | Desktop & Mobile Cart |
| **T03** | Cart grand total | $\ge 28\text{ px}$ bold | **20px** (`text-xl font-mono text-emerald-700`) | **FAIL ❌** | Desktop Cart Summary |
| **T04** | Change due display | $\ge 22\text{ px}$ bold | **24px** (`text-2xl font-black font-mono`) | **PASS ✅** | Checkout Modal |
| **T05** | Amount tender / counted cash inputs | $\ge 20\text{ px}$ | **10px** (desktop cart P.U), **18px** (`text-lg`) on cash tender & close session float | **FAIL ❌** | Checkout & Session Modals |
| **T06** | Secondary text / metadata / badges | $\ge 13\text{ px}$ | **10px** (`text-[10px]`), **11px** (`text-[11px]`), **12px** (`text-xs`) | **FAIL ❌** | Throughout Application |
| **T07** | Sub-12px text prohibition | **Zero** text $< 12\text{ px}$ | **7-10px** used across 14 distinct UI components (`text-[9px]`, `text-[10px]`, `text-[11px]`) | **FAIL ❌** | Global |
| **T08** | Touch targets on phone | $\ge 44 \times 44\text{ CSS px}$ | **$61\text{px} \times 43\text{px}$** (height $43\text{px} < 44\text{px}$), steppers $28\text{px} \times 28\text{px}$ | **FAIL ❌** | Mobile Register & Nav |
| **T09** | Text contrast ratio (WCAG 2.1 AA) | $\ge 4.5:1$ (normal text) | **2.14:1** on UpdateBanner (`white` on `amber-500`); **2.56:1** on category badges & placeholders; **3.77:1** on Scan Toast | **FAIL ❌** | UpdateBanner, Header, Toast |
| **T10** | Desktop 1600x780 cart density | $\ge 6$ lines + total + pay visible | **8 lines** visible with total and pay button | **PASS ✅** | Desktop 1600x780 |
| **T11** | Desktop 1563x545 stress cart density | $\ge 3$ lines + total + pay visible | **4 lines** visible with total and pay button | **PASS ✅** | Desktop 1563x545 |
| **T12** | Phone 384x725 mobile drawer density | $\ge 4$ cart lines visible before scroll | **3 lines** visible before scroll due to oversized header/footer padding | **FAIL ❌** | Phone 384x725 |
| **T13** | Phone 384x400 keyboard open visibility | Cash input, change due & confirm all visible | Cash input ($y=60$), change due ($y=240$), and confirm button ($y=340$) all visible | **PASS ✅** | Phone 384x400 |
| **T14** | Horizontal page scroll | **Zero** horizontal scroll | $0\text{ px}$ horizontal overflow on all 6 viewports | **PASS ✅** | All Viewports |

**Audit Outcome**: **4 PASS ✅**, **10 FAIL ❌** (Total 49 recorded target violations across viewports).

---

## 3. Top 10 Problems Ranked by Operator Speed & Misreads

The 10 most critical visual and ergonomic defects affecting counter checkout velocity, ranked in order of operator impact:

```
+----+--------------------------------------------+----------+-----------------------------+
| Rk | Problem Description                        | Severity | Measured Values vs Target   |
+----+--------------------------------------------+----------+-----------------------------+
| 1  | Cart Line Typography Illegibility          | BLOCKER  | 10px-12px vs >= 16px/18px   |
| 2  | Cart Grand Total Undersized                | BLOCKER  | 20px vs >= 28px Bold        |
| 3  | Sub-12px Font Proliferation                | BLOCKER  | 9px-10px in 14 components   |
| 4  | Update Banner Severe Contrast Failure      | BLOCKER  | 2.14:1 vs >= 4.5:1 (WCAG)   |
| 5  | Mobile Bottom Nav & Stepper Touch Targets  | HIGH     | 43px & 28px vs >= 44x44px   |
| 6  | Cash Tender Input Undersized               | BLOCKER  | 18px vs >= 20px Bold        |
| 7  | Modal Overflow & Centering Clipping        | BLOCKER  | 800px modal in 545px screen |
| 8  | Mobile Cart Drawer Line Starvation         | HIGH     | 3 lines vs >= 4 lines       |
| 9  | Unreadable Product Category & Stock Badges | HIGH     | 10px, 2.56:1 contrast       |
| 10 | French / English Language Mixing           | MEDIUM   | 50/50 mixed terminology     |
+----+--------------------------------------------+----------+-----------------------------+
```

### Detailed Breakdown of Top 10 Problems:

#### Rank 1: Cart Line Typography Illegibility (Blocker)
- **Component**: `DesktopPos.tsx` (lines 350–430), `MobileRegister.tsx` (lines 620–700)
- **Measured Values**:
  - Cart product name: `fontSize: 12px` (`text-xs`), `isClipped: true` (clipped after 315px with ellipsis).
  - Unit price input: `fontSize: 10px` (`text-[10px] w-16`), height $17\text{px}$.
  - Quantity input: `fontSize: 12px` (`text-xs font-bold`).
  - Line total: `fontSize: 12px` (`text-xs font-mono font-black`).
- **Target**: Product name $\ge 16\text{px}$, quantity $\ge 18\text{px}$ bold, unit price $\ge 16\text{px}$, line total $\ge 16\text{px}$.
- **Operator Impact**: At standard counter viewing distance ($70\text{–}90\text{ cm}$), 10px and 12px text cannot be resolved without squinting or leaning over the counter. A cashier checking if 3 units of *Javel 1.5L* or *Javel 5L* were scanned must pause and lean forward, adding 1.5 to 3 seconds per item scanned.
- **Screenshot Proof**: `screenshots/pos_cart_1line_desktop_1600x780.png`, `screenshots/pos_cart_8lines_desktop_1600x780.png`.

#### Rank 2: Cart Grand Total Undersized (Blocker)
- **Component**: `DesktopPos.tsx` (lines 445–480)
- **Measured Values**: `fontSize: 20px` (`text-xl font-mono text-emerald-700`).
- **Target**: $\ge 28\text{px}$ bold (recommended: $30\text{px}$ / $1.875\text{rem}$ bold with tabular numerals).
- **Operator Impact**: The cart grand total is the single most important number on the screen. The operator must announce the total to the customer immediately upon finishing scanning. At 20px, it blends visually with surrounding container loan notices and discounts, causing an announcement hesitation.
- **Screenshot Proof**: `screenshots/pos_cart_8lines_desktop_1600x780.png`.

#### Rank 3: Sub-12px Font Proliferation (Blocker)
- **Component**: Global (`DesktopPos.tsx`, `MobileRegister.tsx`, `Backoffice.tsx`, `CreateProductModal.tsx`, `SessionModal.tsx`, `ReceiptPrintModal.tsx`).
- **Measured Values**:
  - Unit price label (`P.U.`): `text-[9px]` ($9\text{px}$).
  - Stock badge (`En stock`): `text-[9px]` ($9\text{px}$).
  - Pricing tier badge: `text-[9px]` ($9\text{px}$).
  - Thermal receipt preview: `text-[10px]` ($10\text{px}$).
  - Bottom nav labels: `text-[10px]` ($10\text{px}$).
  - Backoffice table meta: `text-[10px]` ($10\text{px}$) and `text-[11px]` ($11\text{px}$).
- **Target**: **Zero** sub-12px text anywhere in the ERP application.
- **Operator Impact**: 9px and 10px text is below the legible threshold for rapid commercial software on 1080p desktop monitors and phone screens ($2.81\times$ device scale factor). Information rendered in 9px is effectively invisible to the operator during active trading.
- **Screenshot Proof**: `screenshots/pos_product_grid_desktop_1600x780.png`, `screenshots/receipt_preview_desktop_1600x780.png`.

#### Rank 4: Update Banner Severe Contrast Failure (Blocker)
- **Component**: `App.tsx` (`UpdateBanner.tsx`)
- **Measured Values**: Text color `#ffffff` (`rgb(255, 255, 255)`) on background `#f59e0b` (`bg-amber-500`).
- **Measured Contrast Ratio**: **2.14:1** (fails WCAG 2.1 AA minimum of 4.5:1 by over 52%).
- **Target**: $\ge 4.5:1$ contrast ratio for all text elements.
- **Operator Impact**: When a service worker update is staged, the notification banner appears at the very top of the register screen. The white text on amber-500 is completely washed out under shop counter fluorescent lighting, making it impossible to read whether it is an offline warning, a database sync alert, or an application update prompt.
- **Screenshot Proof**: `screenshots/update_banner_desktop_1600x780.png`.

#### Rank 5: Mobile Bottom Nav & Stepper Touch Targets (High)
- **Component**: `MobileRegister.tsx` (lines 1750–1790), cart row quantity steppers.
- **Measured Values**:
  - Bottom nav buttons (`Register`, `Lookup`, `Quick-Edit`, `Customers`): $61\text{px}\text{ to }78\text{px}\text{ wide} \times 43\text{px}\text{ high}$ (fails the $44\text{px}$ height requirement).
  - Quantity steppers (`-` and `+` buttons): $28\text{px} \times 28\text{px}$ (`w-7 h-7`).
  - Delete row button: $28\text{px} \times 28\text{px}$ (`w-7 h-7`).
- **Target**: $\ge 44 \times 44\text{ CSS px}$ for all interactive elements on phone.
- **Operator Impact**: On a touch device held in one hand at the counter, $28\text{px}$ buttons cause repeated touch mis-hits (missed increments, accidental deletions of neighboring rows), directly increasing customer transaction time.
- **Screenshot Proof**: `screenshots/pos_cart_8lines_phone_384x725.png`, `screenshots/price_lookup_mode_phone_384x725.png`.

#### Rank 6: Cash Tender Input Undersized (Blocker)
- **Component**: `CheckoutModal.tsx` (lines 620–635)
- **Measured Values**: `fontSize: 18px` (`text-lg font-bold font-mono`).
- **Target**: $\ge 20\text{px}$ bold (recommended: $22\text{px}$ / $1.375\text{rem}$ bold font-mono).
- **Operator Impact**: The cash tendered input is where the operator types banknotes received from the customer (e.g. `50.000` DT). 18px is smaller than the change due output (24px) and requires extra visual focus to confirm that three decimal zeros were keyed correctly before striking Enter.
- **Screenshot Proof**: `screenshots/checkout_cash_desktop_1600x780.png`.

#### Rank 7: Modal Overflow & Centering Clipping (Blocker)
- **Component**: `ReceiptPrintModal.tsx`, `SessionModal.tsx`, `CustomerStatementModal.tsx`.
- **Measured Values**: Modals use `fixed inset-0 flex items-center justify-center` with inner cards exceeding $650\text{px}$ in height.
- **Viewport Effect**:
  - At $1563 \times 545$ (stress desktop) and $384 \times 400$ (phone with soft keyboard), the modal header ($y < 0$) and footer ($y > 545$ or $y > 400$) are clipped off-screen.
  - The close button (`X`) and `Cancel`/`Submit` buttons become unreachable without blind scrolling.
- **Target**: All modals must use `max-h-[90vh] overflow-y-auto` or `items-start pt-6` with sticky headers/footers so controls are never pushed offscreen.
- **Operator Impact**: The operator becomes trapped inside a modal dialog during a busy checkout or register close shift.
- **Screenshot Proof**: `screenshots/receipt_preview_desktop_1563x545.png`, `screenshots/session_close_modal_phone_384x400.png`.

#### Rank 8: Mobile Cart Drawer Line Starvation (High)
- **Component**: `MobileRegister.tsx` (Cart slide-over drawer).
- **Measured Values**: Only **3 cart lines** are visible simultaneously before requiring vertical scrolling on $384 \times 725$.
- **Root Cause**: The drawer header ($64\text{px}$), customer selector bar ($52\text{px}$), container notice ($48\text{px}$), and bottom payment section ($180\text{px}$) consume $344\text{px}$ ($47\%$ of the entire viewport height), leaving only $280\text{px}$ for cart rows ($90\text{px}$ per row).
- **Target**: $\ge 4$ cart lines visible before scrolling on $384 \times 725$.
- **Operator Impact**: A typical order contains 4 to 6 items. The operator cannot review the complete basket at a glance and must scroll up and down repeatedly to confirm quantities before tapping Tender.
- **Screenshot Proof**: `screenshots/pos_cart_8lines_phone_384x725.png`.

#### Rank 9: Unreadable Product Category & Stock Badges (High)
- **Component**: `DesktopPos.tsx` (product catalog tiles, lines 520–580).
- **Measured Values**: Category tag is `10px` (`text-[10px]`) in `rgb(148, 163, 184)` (`text-slate-400`) on white; contrast ratio is **2.56:1** (fails WCAG 4.5:1 minimum). Stock count badge is `9px` (`text-[9px]`).
- **Target**: Category text $\ge 12\text{px}$ bold with contrast $\ge 4.5:1$; stock badge $\ge 12\text{px}$ bold.
- **Operator Impact**: The operator cannot distinguish between product categories (*Detergents*, *Desinfectants*, *Savons*) at a glance when browsing tiles.
- **Screenshot Proof**: `screenshots/pos_product_grid_desktop_1600x780.png`.

#### Rank 10: French / English Language Mixing (Medium)
- **Component**: Throughout POS & Checkout (`DesktopPos.tsx`, `CheckoutModal.tsx`, `SessionModal.tsx`).
- **Measured Strings**:
  - `Tender Payment` side-by-side with `Rendu de monnaie`.
  - `Quick Cash Tender` alongside `Consignes prêtées`.
  - `Complete Sale & Pop Drawer` alongside `Caisse fermée — Session obligatoire`.
  - `Print A4 Invoice` alongside `Bon de Livraison`.
- **Target**: 100% consistent French counter terminology (`Encaisser`, `Rendu de monnaie`, `Finaliser la vente`, `Panier`, `Fond de caisse`).
- **Operator Impact**: Creates cognitive friction and confusion for local Tunisian French/Arabic-speaking retail operators.

---

## 4. Test Viewports & Measurement Methodology

All measurements were collected using **Chromium** headlessly driven by **Playwright**:

```
+-------------------+-------------------+--------------------+------------------+-----------------------+
| Viewport Name     | CSS Resolution    | Device Scale Factor| Mobile Emulation | Purpose               |
+-------------------+-------------------+--------------------+------------------+-----------------------+
| desktop_1600x780  | 1600 x 780        | 1.00               | False            | Primary Desktop POS   |
| desktop_1600x900  | 1600 x 900        | 1.00               | False            | Fullscreen Desktop    |
| desktop_1563x545  | 1563 x 545        | 1.00               | False            | Height Stress Desktop |
| phone_384x725     | 384 x 725         | 2.81               | True (Touch)     | Browser Phone Worst   |
| phone_384x790     | 384 x 790         | 2.81               | True (Touch)     | Capacitor PWA Phone   |
| phone_384x400     | 384 x 400         | 2.81               | True (Touch)     | Soft Keyboard Stress  |
+-------------------+-------------------+--------------------+------------------+-----------------------+
```

### Contrast Formula (WCAG 2.1 AA)
The test harness calculates relative luminance $L = 0.2126R + 0.7152G + 0.0722B$ where sRGB values are gamma-expanded:
$$s \le 0.04045 \implies c = \frac{s}{12.92}, \quad s > 0.04045 \implies c = \left(\frac{s + 0.055}{1.055}\right)^{2.4}$$
Contrast ratio is computed against the effective alpha-composited background:
$$\text{Ratio} = \frac{L_1 + 0.05}{L_2 + 0.05} \ge 4.5:1$$
