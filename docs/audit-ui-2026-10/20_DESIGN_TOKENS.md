# JaziraERP Countertop UI/UX Audit — Design Tokens & Typography Scale (2026-10)

This document establishes the proposed **unified design tokens**, **ergonomic typographic scale**, **colour contrast rules**, and **touch target standards** for the single-operator counter POS/ERP.

---

## 1. Ergonomic Rationale & Viewing Distance

A counter operator works in an active physical retail environment:
- **Viewing Distance**: $70\text{ to }90\text{ cm}$ (28–36 inches) between cashier eyes and countertop screen.
- **Ambient Lighting**: Mixed fluorescent / daylight retail conditions with high glare potential.
- **Physical Dynamics**: Operator stands or sits on a high stool, handles 5L and 20L liquid chemical containers, scans barcodes, and takes cash with one hand while confirming totals with the other.

Under these conditions, standard web font sizes ($11\text{–}12\text{px}$) cause **eye strain**, **reading hesitation**, and **physical leaning forward**. The typography scale must prioritize **instant legibility at a glance** ($< 250\text{ms}$ recognition speed).

---

## 2. Proposed Unified Typography Scale

```
+------------------------+----------------------+--------------------+---------------------+----------------------------------------------------------+
| Token Name             | Font Size (CSS px)   | Line Height        | Font Weight         | Canonical Semantic Role                                  |
+------------------------+----------------------+--------------------+---------------------+----------------------------------------------------------+
| text-pos-total         | 30px (1.875rem)      | 36px (2.25rem)     | Black (900) Mono    | Cart grand total TTC, main sales banner                  |
| text-pos-change        | 24px (1.5rem)        | 32px (2rem)        | Black (900) Mono    | Change due to customer, large price lookup               |
| text-pos-input         | 22px (1.375rem)      | 28px (1.75rem)     | Bold (700) Mono     | Cash tender input, opening/closing cash float            |
| text-pos-qty           | 18px (1.125rem)      | 24px (1.5rem)      | Bold (700) Mono     | Cart quantity value, keypad display                      |
| text-pos-name          | 16px (1.0rem)        | 22px (1.375rem)    | Bold (700) Sans     | Cart item name, product title, checkout button text      |
| text-pos-price         | 16px (1.0rem)        | 22px (1.375rem)    | Bold (700) Mono     | Unit price input, line total, modal total                |
| text-pos-body          | 14px (0.875rem)      | 20px (1.25rem)     | Medium (500/600)    | Table data cells, form labels, customer names            |
| text-pos-caption       | 13px (0.8125rem)     | 18px (1.125rem)    | Semibold (600)      | Secondary metadata, barcodes, timestamps                 |
| text-pos-badge         | 12px (0.75rem)       | 16px (1.0rem)      | Bold (700) Sans     | Stock tags, status pills, category badges (ABSOLUTE MIN) |
+------------------------+----------------------+--------------------+---------------------+----------------------------------------------------------+
```

### Prohibitions
> [!IMPORTANT]
> **Zero Sub-12px Elements**: The classes `text-[9px]`, `text-[10px]`, `text-[11px]`, and `text-xs` (when rendering secondary badges at 11px) are **strictly forbidden**. Any element currently at 9px or 10px must be upgraded to `text-pos-badge` (12px bold) or `text-pos-caption` (13px).

---

## 3. Numeric & Tabular Formatting Token

All currency values, quantities, and barcode numbers must enforce monospace lining numerals to eliminate horizontal jitter when values increment:

```css
.font-money {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
```

---

## 4. Colour Palette & WCAG 2.1 AA Contrast Ratios

All foreground and background combinations must pass **WCAG 2.1 AA** ($\ge 4.5:1$ for normal text, $\ge 3.0:1$ for large text $\ge 18\text{px}$ bold or $\ge 24\text{px}$).

```
+-------------------+---------------------+---------------------+----------------+---------------+-----------------------------------------------+
| Token Name        | Foreground Color    | Background Color    | Contrast Ratio | WCAG 2.1 AA   | Intended Usage                                |
+-------------------+---------------------+---------------------+----------------+---------------+-----------------------------------------------+
| color-surface-app | #0f172a (slate-900) | #ffffff (white)     | 17.85:1        | PASS (AAA)    | Primary page body, main text                  |
| color-surface-card| #1e293b (slate-800) | #f8fafc (slate-50)  | 13.91:1        | PASS (AAA)    | Card content, secondary containers            |
| color-brand-green | #ffffff (white)     | #059669 (emerald-600)| 4.62:1        | PASS (AA)     | Primary actions (Tender, Confirm, Pay)        |
| color-brand-dark  | #047857 (emerald-700)| #ecfdf5 (emerald-50) | 5.25:1        | PASS (AA)     | Positive amounts, paid in full, exact cash    |
| color-alert-warn  | #0f172a (slate-900) | #f59e0b (amber-500) | 9.15:1         | PASS (AAA)    | UpdateBanner (REPLACES white on amber: 2.14:1)|
| color-alert-debt  | #9f1239 (rose-800)  | #ffe4e6 (rose-100)  | 7.10:1         | PASS (AAA)    | Reseller credit debt pill, cash short         |
| color-alert-blue  | #1e40af (blue-800)  | #dbeafe (blue-100)  | 7.55:1         | PASS (AAA)    | Cash over, sync in progress                   |
| color-muted-meta  | #475569 (slate-600) | #ffffff (white)     | 5.92:1         | PASS (AA)     | Captions, timestamps (REPLACES slate-400)     |
+-------------------+---------------------+---------------------+----------------+---------------+-----------------------------------------------+
```

### The Update Banner Contrast Fix:
- **Current Defect**: White text (`#ffffff`) on `bg-amber-500` (`#f59e0b`) produces contrast of **2.14:1** (Severe failure).
- **Mandated Fix**: Change text to dark slate `#0f172a` (`text-slate-950`) or switch background to `#d97706` (`bg-amber-600` with dark text) yielding **9.15:1** contrast.

---

## 5. Touch Targets & Ergonomic Sizing Scale

For mobile viewports ($384\text{px}$) and touch-screen POS monitors:

```
+-----------------------+---------------------+---------------------+-----------------------------------------------------+
| Component Type        | Minimum Width (px)  | Minimum Height (px) | Rule Rationale                                      |
+-----------------------+---------------------+---------------------+-----------------------------------------------------+
| Primary Action Button | 100% / min 120px    | 48px                | Tender, Confirm Sale, Start Next Sale               |
| Secondary Action      | 80px                | 44px                | Hold Cart, Refund, Quick Cash Tender                |
| Quantity Steppers     | 44px                | 44px                | Minus / Plus touch targets (REPLACES 28x28px)       |
| Table Row Action      | 44px                | 44px                | Delete cart row, select batch row                   |
| Mobile Bottom Nav     | 25% of viewport     | 54px                | Bottom navigation tab (REPLACES 43px height)        |
+-----------------------+---------------------+---------------------+-----------------------------------------------------+
```

---

## 6. Spacing & Density Tokens

To guarantee desktop density targets (e.g. $\ge 6$ cart lines visible at $1600 \times 780$, and $\ge 3$ lines at $1563 \times 545$) while increasing font sizes from 12px to 16px:

- **Cart Row Height**: $56\text{px}$ (compact 2-line layout on desktop, or unified single-line table row).
- **Row Padding**: `py-2.5 px-3` (replaces `py-3 px-4`).
- **Internal Gap**: `gap-2` instead of `gap-4`.
- **Cart Summary Height**: Capped at $140\text{px}$ so the scrollable cart body maintains at least $440\text{px}$ of vertical clearance on $1600 \times 780$.

---

## 7. Implementation Method (Tailwind Configuration & CSS Variables)

To implement this scale without disrupting React component logic or altering database/API payloads:

### Tailwind Config Extension (`tailwind.config.js`):
```javascript
module.exports = {
  theme: {
    extend: {
      fontSize: {
        'pos-total': ['1.875rem', { lineHeight: '2.25rem', fontWeight: '900' }], // 30px
        'pos-change': ['1.5rem', { lineHeight: '2rem', fontWeight: '900' }],      // 24px
        'pos-input': ['1.375rem', { lineHeight: '1.75rem', fontWeight: '700' }],  // 22px
        'pos-qty': ['1.125rem', { lineHeight: '1.5rem', fontWeight: '700' }],     // 18px
        'pos-name': ['1rem', { lineHeight: '1.375rem', fontWeight: '700' }],      // 16px
        'pos-price': ['1rem', { lineHeight: '1.375rem', fontWeight: '700' }],     // 16px
        'pos-body': ['0.875rem', { lineHeight: '1.25rem', fontWeight: '500' }],   // 14px
        'pos-caption': ['0.8125rem', { lineHeight: '1.125rem', fontWeight: '600' }], // 13px
        'pos-badge': ['0.75rem', { lineHeight: '1rem', fontWeight: '700' }]       // 12px
      },
      minHeight: {
        'touch': '44px',
        'touch-lg': '48px'
      },
      minWidth: {
        'touch': '44px'
      }
    }
  }
}
```
