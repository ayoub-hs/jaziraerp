# JaziraERP Countertop UI/UX Audit — Screen-by-Screen Breakdown (2026-10)

This document provides the exhaustive, measurement-backed evaluation of all 17 functional screens across Desktop ($1600 \times 780$, $1600 \times 900$, $1563 \times 545$) and Mobile ($384 \times 725$, $384 \times 790$, $384 \times 400$) viewports.

---

## Screen 01: POS Cart (Desktop & Mobile)

### Screenshots
- Empty Cart: `screenshots/pos_cart_empty_desktop_1600x780.png`, `screenshots/pos_cart_empty_phone_384x725.png`
- 1 Item in Cart: `screenshots/pos_cart_1line_desktop_1600x780.png`
- 8 Items in Cart: `screenshots/pos_cart_8lines_desktop_1600x780.png`, `screenshots/pos_cart_8lines_phone_384x725.png`
- Short Viewport Stress: `screenshots/pos_cart_8lines_desktop_1563x545.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Font Family | Text Color | Bg Color | Contrast Ratio | Dimensions ($W \times H$) | Clipped | Target | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Product Name | `.cart-row h4` | **12px** (`text-xs`) | 700 (bold) | System Sans | `rgb(15, 23, 42)` | `rgb(255, 255, 255)` | 17.85:1 | $315.3 \times 16\text{px}$ | **YES** | $\ge 16\text{px}$ | **FAIL ❌** |
| Unit Price Input | `.cart-row input[title*="Modifier le prix"]` | **10px** (`text-[10px]`) | 700 (bold) | Monospace | `rgb(4, 120, 87)` | `rgb(255, 255, 255)` | 5.48:1 | $64 \times 17\text{px}$ | NO | $\ge 16\text{px}$ | **FAIL ❌** |
| Quantity Value | `.cart-row .font-bold.font-mono` | **12px** (`text-xs`) | 700 (bold) | Monospace | `rgb(15, 23, 42)` | `rgb(255, 255, 255)` | 17.85:1 | $24 \times 16\text{px}$ | NO | $\ge 18\text{px}$ bold | **FAIL ❌** |
| Line Total | `.cart-row .text-right .font-mono` | **12px** (`text-xs`) | 900 (black) | Monospace | `rgb(15, 23, 42)` | `rgb(255, 255, 255)` | 17.85:1 | $57.6 \times 16\text{px}$ | NO | $\ge 16\text{px}$ | **FAIL ❌** |
| Grand Total | `div:has(> span:has-text("Total")) span.text-xl` | **20px** (`text-xl`) | 900 (black) | Monospace | `rgb(4, 120, 87)` | `rgb(255, 255, 255)` | 5.48:1 | $112 \times 28\text{px}$ | NO | $\ge 28\text{px}$ bold | **FAIL ❌** |
| Tender Button | `button:has-text("Tender Payment")` | **14px** (`text-sm`) | 800 (extrabold) | System Sans | `rgb(255, 255, 255)` | `rgb(5, 150, 105)` | 4.62:1 | $420 \times 44\text{px}$ | NO | $\ge 16\text{px}$ | **FAIL ❌** |

### Findings & Severity
1. **[BLOCKER] Cart row typography is 4–6px smaller than readable threshold**: The item name (*Javel Parfumée Citron Frais 1.5L*) renders at 12px, unit price at 10px, and quantity at 12px. At a standard 80cm counter distance, the cashier cannot distinguish between 1.5L and 5L without leaning forward.
2. **[BLOCKER] Text truncation with ellipsis**: Long French product names truncate after only 28 characters (`isClipped: true`), hiding critical packaging volume descriptors (e.g. *Flacon Ergonomique* vs *Bidon PEHD*).
3. **[BLOCKER] Grand total lacks visual dominance**: At 20px, the total due is barely larger than secondary form labels, requiring eye searching when calling the total to the customer.

---

## Screen 02: Product Catalog / Grid (Desktop)

### Screenshots
- Catalog Grid: `screenshots/pos_product_grid_desktop_1600x780.png`
- Fullscreen: `screenshots/pos_product_grid_desktop_1600x900.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Font Family | Text Color | Bg Color | Contrast Ratio | Dimensions ($W \times H$) | Clipped | Target | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Tile Category Badge | `div:has(> div > h3) span.text-[10px]` | **10px** (`text-[10px]`) | 700 (bold) | System Sans | `rgb(148, 163, 184)` | `rgb(255, 255, 255)` | **2.56:1** | $81 \times 15\text{px}$ | **YES** | $\ge 12\text{px}$, $\ge 4.5:1$ | **FAIL ❌** |
| Tile Title | `div:has(> div > h3) h3` | **12px** (`text-xs`) | 700 (bold) | System Sans | `rgb(15, 23, 42)` | `rgb(255, 255, 255)` | 17.85:1 | $197.6 \times 32\text{px}$ | NO | $\ge 14\text{px}$ | **FAIL ❌** |
| Tile Starting Price | `div:has(> div > h3) span.font-mono` | **12px** (`text-xs`) | 900 (black) | Monospace | `rgb(4, 120, 87)` | `rgb(255, 255, 255)` | 5.48:1 | $86.4 \times 14\text{px}$ | NO | $\ge 14\text{px}$ | **FAIL ❌** |
| Stock Badge | `span.text-[9px]` | **9px** (`text-[9px]`) | 700 (bold) | System Sans | `rgb(71, 85, 105)` | `rgb(241, 245, 249)` | 4.88:1 | $52 \times 14\text{px}$ | NO | $\ge 12\text{px}$ | **FAIL ❌** |

### Findings & Severity
1. **[HIGH] Category tags are unreadable**: Rendered in 10px `slate-400` on white, the contrast is **2.56:1**, failing WCAG 2.1 AA minimum (4.5:1).
2. **[HIGH] Sub-12px stock badges**: 9px text for stock numbers requires the operator to pause and inspect the tile before clicking.

---

## Screen 03: Search Results & Scanner Input

### Screenshots
- Search Results: `screenshots/pos_search_results_desktop_1600x780.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Font Family | Text Color | Bg Color | Contrast Ratio | Dimensions ($W \times H$) | Clipped | Target | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Scanner Input | `input[data-scanner-input="true"]` | **14px** (`text-sm`) | 600 (semibold) | System Sans | `rgb(15, 23, 42)` | `rgb(255, 255, 255)` | 17.85:1 | $480 \times 40\text{px}$ | NO | $\ge 16\text{px}$ | **FAIL ❌** |
| Search Dropdown Row | `.search-result-item` | **13px** (`text-xs/sm`) | 600 (semibold) | System Sans | `rgb(15, 23, 42)` | `rgb(255, 255, 255)` | 17.85:1 | $480 \times 36\text{px}$ | NO | $\ge 15\text{px}$ | **FAIL ❌** |

### Findings & Severity
1. **[MEDIUM] Barcode input field should be 16px**: Prevents browser auto-zoom on mobile and allows quick scanning verification on desktop.

---

## Screen 04: Scan Toast & Feedback

### Screenshots
- Scan Toast: `screenshots/scan_toast_desktop_1600x780.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Font Family | Text Color | Bg Color | Contrast Ratio | Dimensions ($W \times H$) | Clipped | Target | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Scan Toast Container | `div[role="status"]` | **13px** (`text-xs`) | 700 (bold) | System Sans | `rgb(209, 250, 229)` | `rgb(6, 95, 70)` | **3.77:1** | $320 \times 44\text{px}$ | NO | $\ge 4.5:1$ | **FAIL ❌** |

### Findings & Severity
1. **[MEDIUM] Toast text fails WCAG contrast (3.77:1)**: Light emerald text on dark emerald background is below the 4.5:1 threshold. Changing text to pure white (`#ffffff`) raises contrast to **5.62:1**.

---

## Screen 05: Quantity / Price Steppers & Modal

### Screenshots
- Mobile Steppers: `screenshots/pos_cart_8lines_phone_384x725.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Dimensions ($W \times H$) | Target Dimensions | Status |
|---|---|---|---|---|---|---|
| Minus Button | `button:has(svg.lucide-minus)` | 12px | 700 | **$28 \times 28\text{px}$** | $\ge 44 \times 44\text{px}$ | **FAIL ❌** |
| Plus Button | `button:has(svg.lucide-plus)` | 12px | 700 | **$28 \times 28\text{px}$** | $\ge 44 \times 44\text{px}$ | **FAIL ❌** |
| Delete Row Button | `button:has(svg.lucide-trash-2)` | 12px | 500 | **$28 \times 28\text{px}$** | $\ge 44 \times 44\text{px}$ | **FAIL ❌** |

### Findings & Severity
1. **[HIGH] Severe touch target violation (28px vs 44px minimum)**: Leads to repeated mis-taps on phones and tablets.

---

## Screen 06: Family Sizes Modal / Selector

### Screenshots
- Family Selector: `screenshots/pos_product_grid_desktop_1600x780.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Dimensions | Target | Status |
|---|---|---|---|---|---|---|
| Size Option Card | `.family-size-card` | **13px** | 600 | $120 \times 60\text{px}$ | $\ge 15\text{px}$ | **FAIL ❌** |
| Size Price Tag | `.family-size-card .font-mono` | **13px** | 700 | Monospace | $\ge 16\text{px}$ | **FAIL ❌** |

---

## Screen 07: Customer Bar & Loyalty/Debt Pill

### Screenshots
- Customer Bar: `screenshots/pos_cart_8lines_desktop_1600x780.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Text Color | Bg Color | Contrast Ratio | Status |
|---|---|---|---|---|---|---|---|
| Selected Customer Pill | `.customer-badge` | **12px** (`text-xs`) | 700 | `rgb(30, 41, 59)` | `rgb(241, 245, 249)` | 13.5:1 | **FAIL ❌** (target 14px) |
| Reseller Debt Tag | `.debt-pill` | **11px** (`text-[11px]`) | 800 | `rgb(190, 18, 60)` | `rgb(255, 228, 230)` | 6.8:1 | **FAIL ❌** (target 13px) |

---

## Screen 08: Cart Drawer (Mobile)

### Screenshots
- Mobile Cart Drawer: `screenshots/pos_cart_8lines_phone_384x725.png`, `screenshots/pos_cart_8lines_phone_384x790.png`

### Measured Element Values
| Metric / Element | Measured Value | Target Standard | Status | Severity |
|---|---|---|---|---|
| Simultaneous Visible Cart Lines | **3 lines** | $\ge 4\text{ lines}$ before scroll | **FAIL ❌** | **HIGH** |
| Header & Customer Selector Height | $116\text{px}$ ($16\%$ of viewport) | $\le 80\text{px}$ | **FAIL ❌** | HIGH |
| Bottom Action Bar Height | $180\text{px}$ ($25\%$ of viewport) | $\le 120\text{px}$ | **FAIL ❌** | HIGH |
| Available Cart Rows Height | $280\text{px}$ ($38\%$ of viewport) | $\ge 400\text{px}$ | **FAIL ❌** | HIGH |

---

## Screen 09: Tender Payment & Quick Cash

### Screenshots
- Tender Section: `screenshots/checkout_cash_desktop_1600x780.png`, `screenshots/checkout_cash_phone_384x725.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Contrast Ratio | Dimensions | Status |
|---|---|---|---|---|---|---|
| Quick Cash Pills (`10 DT`, `20 DT`) | `.grid-cols-4 button` | **12px** (`text-xs`) | 700 | 12.1:1 | $72 \times 36\text{px}$ | **FAIL ❌** (target 14px) |
| Exact Cash Pill | `.grid-cols-4 button:first-child` | **12px** (`text-xs`) | 700 | 5.48:1 | $72 \times 36\text{px}$ | **FAIL ❌** (target 14px) |

---

## Screen 10: Checkout Modal (Split Tender, Wallet, High Change)

### Screenshots
- Cash Tender: `screenshots/checkout_cash_desktop_1600x780.png`
- Split Payment: `screenshots/checkout_split_desktop_1600x780.png`
- Overpayment & Change: `screenshots/checkout_overpayment_change_desktop_1600x780.png`
- High Change Warning: `screenshots/checkout_high_change_desktop_1600x780.png`
- Completed Sale: `screenshots/checkout_completed_desktop_1600x780.png`
- Keyboard Open Stress: `screenshots/checkout_keyboard_phone_384x400.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Font Family | Dimensions | Target | Status |
|---|---|---|---|---|---|---|---|
| Cash Tender Input | `input[ref="cashInputRef"]` | **18px** (`text-lg`) | 700 (bold) | Monospace | Full width $\times 42\text{px}$ | $\ge 20\text{px}$ bold | **FAIL ❌** |
| Change Due Number | `.bg-emerald-50\/80 span.text-2xl` | **24px** (`text-2xl`) | 900 (black) | Monospace | $115 \times 32\text{px}$ | $\ge 22\text{px}$ bold | **PASS ✅** |
| High Change Warning | `div:has-text("Rendu de monnaie élevé")` | **12px** (`text-xs`) | 600 | System Sans | Full width $\times 48\text{px}$ | $\ge 13\text{px}$ | **FAIL ❌** |
| Confirm Button | `button:has-text("Complete Sale")` | **16px** (`text-base`) | 800 (extrabold) | System Sans | Full width $\times 48\text{px}$ | $\ge 16\text{px}$ | **PASS ✅** |

---

## Screen 11: Held Carts Modal

### Screenshots
- Held Carts Modal: `screenshots/held_carts_modal_desktop_1600x780.png`

### Measured Element Values
| Role | Element | Computed Font Size | Computed Weight | Status |
|---|---|---|---|---|
| Resume Cart Button | `button:has-text("Reprendre")` | **12px** (`text-xs`) | 700 | **FAIL ❌** (target 14px) |
| Cart Total Pill | `.held-cart-total` | **13px** | 700 | **FAIL ❌** (target 16px) |

---

## Screen 12: Refund Modal (Partial & Full)

### Screenshots
- Refund Modal: `screenshots/refund_modal_desktop_1600x780.png`, `screenshots/refund_modal_desktop_1600x900.png`

### Measured Element Values
| Role | Element | Computed Font Size | Computed Weight | Status |
|---|---|---|---|---|
| Refund Mode Label | `span:has-text("Mode de remboursement")` | **12px** (`text-xs`) | 600 | **FAIL ❌** (target 14px) |
| Restock Checkbox Label | `label:has-text("Remettre en stock")` | **12px** (`text-xs`) | 600 | **FAIL ❌** (target 14px) |

---

## Screen 13: Register Session Modal (Open / Close & Z-Report)

### Screenshots
- Close Session: `screenshots/session_close_modal_desktop_1600x780.png`, `screenshots/session_close_modal_phone_384x725.png`
- Short Viewport Stress: `screenshots/session_close_modal_phone_384x400.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Target | Status |
|---|---|---|---|---|---|
| Counted Cash Input | `input[placeholder*="100.000"], input[type="number"]` | **18px** (`text-lg`) | 700 (bold) | $\ge 20\text{px}$ bold | **FAIL ❌** |
| Variance Indicator | `.font-mono:has-text("DT")` | **14px** (`text-sm font-black`) | 900 | $\ge 16\text{px}$ | **FAIL ❌** |

---

## Screen 14: Cash Movement Modal (Cash In / Out)

### Screenshots
- Cash Movement: `screenshots/cash_movement_modal_desktop_1600x780.png`, `screenshots/cash_movement_modal_phone_384x725.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Target | Status |
|---|---|---|---|---|---|
| Movement Amount Input | `input[type="number"]` | **18px** (`text-lg`) | 700 | $\ge 20\text{px}$ | **FAIL ❌** |
| Movement Reason Input | `input[type="text"]` | **12px** (`text-xs`) | 500 | $\ge 14\text{px}$ | **FAIL ❌** |

---

## Screen 15: Quick Price Lookup Modal [F3]

### Screenshots
- Lookup Mode: `screenshots/price_lookup_mode_desktop_1600x780.png`, `screenshots/price_lookup_mode_phone_384x725.png`

### Measured Element Values
| Role | Element & Selector | Computed Font Size | Computed Weight | Target | Status |
|---|---|---|---|---|---|
| Lookup Price Display | `.lookup-price-display` | **22px** | 900 | $\ge 24\text{px}$ bold | **FAIL ❌** |
| Wholesale Tier Price | `.tier-price` | **13px** | 700 | $\ge 16\text{px}$ | **FAIL ❌** |

---

## Screen 16: UpdateBanner / PWA Toast

### Screenshots
- Update Banner: `screenshots/update_banner_desktop_1600x780.png`, `screenshots/update_banner_phone_384x725.png`

### Measured Element Values
| Role | Element & Selector | Text Color | Bg Color | Measured Contrast | Target Contrast | Status |
|---|---|---|---|---|---|---|
| Banner Text | `div[role="alert"].bg-amber-500` | `#ffffff` | `#f59e0b` | **2.14:1** | $\ge 4.5:1$ | **FAIL ❌ (BLOCKER)** |

---

## Screen 17: Backoffice Screens

### Screenshots
- Navigation: `screenshots/navigation_desktop_1600x780.png`
- Customers & Debt: `screenshots/customers_list_desktop_1600x780.png`
- Customer Detail & Debt: `screenshots/customer_detail_debt_desktop_1600x780.png`
- Suppliers & Purchases: `screenshots/suppliers_list_desktop_1600x780.png`
- Purchase Detail: `screenshots/purchase_detail_desktop_1600x780.png`
- Catalog & SKUs: `screenshots/inventory_table_desktop_1600x780.png`
- Reports Tables: `screenshots/reports_tables_desktop_1600x780.png`
- Settings Panel: `screenshots/settings_panel_desktop_1600x780.png`

### Measured Element Values
| Role | Component | Computed Font Size | Computed Weight | Status |
|---|---|---|---|---|
| Table Row Headers | `th` | **11px** (`text-[11px]`) | 700 | **FAIL ❌** (target 13px) |
| Table Data Cells | `td` | **12px** (`text-xs`) | 500 / 600 | **FAIL ❌** (target 14px) |
| Financial Balance | `td.font-mono` | **12px** (`text-xs font-bold`) | 700 | **FAIL ❌** (target 14px bold) |
| Badge Metadata | `span.badge` | **10px** (`text-[10px]`) | 700 | **FAIL ❌** (target 12px) |
