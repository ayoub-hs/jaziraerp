import { Customer, CartItem, Product, PackSize } from '../types/index.js';
import { roundMoney } from './formatters.js';

export interface CartTotals {
  subtotalHT: number;
  tvaRate: number;
  tvaAmount: number;
  totalTTC: number;
  rawTotalTTC: number;
  totalDiscount: number;
  itemCount: number;
  totalPieces: number;
}

/**
 * Calculates effective unit price for a product based on customer tier.
 */
export function getProductPriceForCustomer(product: Product, customer?: Customer | null): number {
  if (!customer || customer.type === 'RETAIL') {
    return roundMoney(product.retail_price);
  }
  if (customer.type === 'WHOLESALE') {
    return roundMoney(product.wholesale_price);
  }
  if (customer.type === 'RESELLER') {
    const discount = Math.max(0, Math.min(100, customer.reseller_discount_percent || 0));
    const factor = (100 - discount) / 100;
    return roundMoney(product.wholesale_price * factor);
  }
  return roundMoney(product.retail_price);
}

/**
 * Calculates effective unit price for a product, customer tier, and pack size / multiplier,
 * matching server computeExpectedCatalogPrice:
 * - Base price is determined by customer tier:
 *   - Retail / walk-in / null: product.retail_price
 *   - Wholesale: product.wholesale_price
 *   - Reseller: product.wholesale_price * (100 - reseller_discount_percent) / 100
 * - Pack override:
 *   - If packSize has price_override != null and (customer == null || customer.type === 'RETAIL'),
 *     finalPrice = Number(packSize.price_override)
 *   - Else if packSize:
 *     finalPrice = basePrice * (Number(packSize.multiplier) || 1)
 *   - Else if packMultiplier > 1:
 *     finalPrice = basePrice * packMultiplier
 *   - Else:
 *     finalPrice = basePrice
 */
export function getProductPackPrice(
  product: Product,
  customer?: Customer | null,
  packSize?: PackSize | null,
  packMultiplier: number = 1
): number {
  let basePrice = Number(product.retail_price) || 0;
  if (customer) {
    if (customer.type === 'WHOLESALE') {
      basePrice = Number(product.wholesale_price) || 0;
    } else if (customer.type === 'RESELLER') {
      const discount = Math.max(0, Math.min(100, Number(customer.reseller_discount_percent) || 0));
      basePrice = (Number(product.wholesale_price) || 0) * ((100 - discount) / 100);
    }
  }

  let finalPrice = basePrice;
  if (packSize) {
    if (packSize.price_override !== null && packSize.price_override !== undefined && (!customer || customer.type === 'RETAIL')) {
      finalPrice = Number(packSize.price_override);
    } else {
      finalPrice = basePrice * (Number(packSize.multiplier) || 1);
    }
  } else if (packMultiplier && packMultiplier > 1) {
    finalPrice = basePrice * packMultiplier;
  }

  return roundMoney(finalPrice);
}

/**
 * Calculates totals for current cart contents, taking into account per-item and per-sale discounts.
 */
export function calculateCartTotals(items: CartItem[], saleDiscount: number = 0): CartTotals {
  let rawTotalTTC = 0;
  let totalLineDiscounts = 0;
  let totalPieces = 0;

  for (const item of items) {
    const qty = Math.max(0, item.quantity || 0);
    const multiplier = Math.max(1, item.pack_multiplier || 1);
    const grossLine = roundMoney(item.unit_price * qty);
    const lineDiscount = Math.max(0, roundMoney(item.discount_amount || 0));

    rawTotalTTC = roundMoney(rawTotalTTC + grossLine);
    totalLineDiscounts = roundMoney(totalLineDiscounts + lineDiscount);
    totalPieces += qty * multiplier;
  }

  const cleanSaleDiscount = Math.max(0, roundMoney(saleDiscount || 0));
  const totalDiscount = roundMoney(totalLineDiscounts + cleanSaleDiscount);
  const totalTTC = Math.max(0, roundMoney(rawTotalTTC - totalDiscount));

  const tvaRate = 0.19;
  const subtotalHT = roundMoney(totalTTC / (1 + tvaRate));
  const tvaAmount = roundMoney(totalTTC - subtotalHT);

  return {
    subtotalHT,
    tvaRate,
    tvaAmount,
    totalTTC,
    rawTotalTTC,
    totalDiscount,
    itemCount: items.length,
    totalPieces
  };
}

/**
 * Builds the sale payment payload separating applied cash from tendered cash.
 * applied cash = totalTTC - wallet - credit (floored at 0, never more than tendered).
 * cash_tendered is what the customer handed over; change = tendered - applied.
 */
export function buildPaymentPayload(
  totalTTC: number,
  cashTendered: number,
  wallet: number = 0,
  credit: number = 0
): { cash_paid: number; cash_tendered: number; wallet_paid: number; credit_amount: number } {
  const total = roundMoney(Math.max(0, totalTTC || 0));
  const walletPaid = roundMoney(Math.max(0, wallet || 0));
  const creditAmount = roundMoney(Math.max(0, credit || 0));
  const tendered = roundMoney(Math.max(0, cashTendered || 0));
  const applied = roundMoney(Math.max(0, total - walletPaid - creditAmount));
  return {
    cash_paid: roundMoney(Math.min(applied, tendered)),
    cash_tendered: tendered,
    wallet_paid: walletPaid,
    credit_amount: creditAmount
  };
}

export interface SplitPaymentOptions {
  rawCashString?: string;
  highChangeConfirmed?: boolean;
}

export interface SplitPaymentResult {
  valid: boolean;
  error?: string;
  changeDue: number;
  requiresHighChangeConfirmation?: boolean;
}

/**
 * Validates split payment amounts against total due and customer limits.
 */
export function validateSplitPayment(
  totalTTC: number,
  cashPaid: number,
  walletPaid: number,
  creditAmount: number,
  customer?: Customer | null,
  options?: SplitPaymentOptions
): SplitPaymentResult {
  const cash = roundMoney(Math.max(0, cashPaid || 0));
  const wallet = roundMoney(Math.max(0, walletPaid || 0));
  const credit = roundMoney(Math.max(0, creditAmount || 0));

  // 1. Guard against barcode scanned into cash input: integer part > 7 digits
  const rawCashStr = options?.rawCashString !== undefined
    ? String(options.rawCashString).trim()
    : String(cashPaid).trim();
  const intPart = rawCashStr.split('.')[0].replace(/^[-+]/, '').replace(/^0+/, '') || '0';
  if (intPart.length > 7) {
    return {
      valid: false,
      error: 'Montant espèces invalide - code-barres scanné ?',
      changeDue: 0
    };
  }

  // 2. Guard against extreme cash tender: cash > max(100 * totalTTC, 1000)
  const maxAllowedCash = Math.max(100 * totalTTC, 1000);
  if (cash > maxAllowedCash) {
    return {
      valid: false,
      error: 'Montant espèces invalide - code-barres scanné ?',
      changeDue: 0
    };
  }

  // Wallet payment pre-validation: cannot exceed customer's current wallet balance
  if (wallet > 0) {
    if (!customer) {
      return { valid: false, error: 'Cannot pay with wallet for anonymous customer', changeDue: 0 };
    }
    const availableWallet = roundMoney(customer.wallet_balance || 0);
    if (wallet > availableWallet) {
      return {
        valid: false,
        error: `Wallet payment (${wallet.toFixed(3)} DT) exceeds available balance (${availableWallet.toFixed(3)} DT)`,
        changeDue: 0
      };
    }
  }

  // Credit payment validation: requires named customer
  if (credit > 0 && !customer) {
    return { valid: false, error: 'Cannot issue credit ticket for anonymous customer', changeDue: 0 };
  }

  const nonCashTotal = roundMoney(wallet + credit);
  if (nonCashTotal > totalTTC) {
    return {
      valid: false,
      error: 'Wallet and credit amount cannot exceed total purchase amount',
      changeDue: 0
    };
  }

  const cashNeeded = roundMoney(totalTTC - nonCashTotal);
  const totalPaid = roundMoney(cash + nonCashTotal);

  if (totalPaid < totalTTC) {
    return {
      valid: false,
      error: `Insufficient payment: ${totalPaid.toFixed(3)} DT paid of ${totalTTC.toFixed(3)} DT required`,
      changeDue: 0
    };
  }

  const changeDue = roundMoney(Math.max(0, cash - cashNeeded));

  // 3. If change due is over 500.000 DT, require explicit confirmation
  if (changeDue > 500 && !options?.highChangeConfirmed) {
    return {
      valid: false,
      error: 'Rendu monnaie supérieur à 500 DT : confirmation requise',
      changeDue,
      requiresHighChangeConfirmation: true
    };
  }

  return {
    valid: true,
    changeDue
  };
}

/**
 * Extracts liquid volume in liters from a size label or product name.
 * Examples: "10L" -> 10, "1.5L" -> 1.5, "500ml" -> 0.5, "5 Litres" -> 5.
 * Returns null if no liquid unit is specified.
 */
export function parseSizeToLiters(sizeLabel?: string | null, productName?: string | null): number | null {
  const parseStr = (str: string): number | null => {
    const cleaned = str.trim().toLowerCase();
    if (!cleaned) return null;

    if (cleaned === 'l' || cleaned === 'litre' || cleaned === 'litres') {
      return 1;
    }

    const mlMatch = cleaned.match(/(?:^|\b|\s)([0-9]+(?:\.[0-9]+)?)\s*ml(?:\b|\s|$)/i);
    if (mlMatch) {
      const val = parseFloat(mlMatch[1]);
      return !isNaN(val) && val > 0 ? val / 1000 : null;
    }

    const lMatch = cleaned.match(/(?:^|\b|\s)([0-9]+(?:\.[0-9]+)?)\s*(?:l|litre|litres)(?:\b|\s|$)/i);
    if (lMatch) {
      const val = parseFloat(lMatch[1]);
      return !isNaN(val) && val > 0 ? val : null;
    }

    return null;
  };

  if (sizeLabel) {
    const parsed = parseStr(sizeLabel);
    if (parsed !== null) return parsed;
  }

  if (productName) {
    const parsed = parseStr(productName);
    if (parsed !== null) return parsed;
  }

  return null;
}

/**
 * Calculates number of returnable containers required for a cart item or sale line.
 * E.g. Buying 10L of bulk Vaisselle with a 10L bidon (capacity_liters = 10) -> 1 container.
 * Buying 20L of Vaisselle with a 10L bidon -> 2 containers.
 * Buying 2 x 5L pre-packaged bottles with 5L bidon -> 2 containers.
 */
export function calculateContainersNeeded(
  quantity: number,
  packMultiplier: number = 1,
  sizeLabel?: string | null,
  containerCapacityLiters?: number | null,
  productName?: string | null
): number {
  const qty = Math.max(0, quantity || 0);
  if (qty <= 0) return 0;
  const multiplier = Math.max(1, packMultiplier || 1);
  const totalUnits = qty * multiplier;

  if (!containerCapacityLiters || containerCapacityLiters <= 0) {
    return Math.max(1, Math.round(totalUnits));
  }

  const productLiters = parseSizeToLiters(sizeLabel, productName);
  if (productLiters && productLiters > 0) {
    const totalVolume = totalUnits * productLiters;
    return Math.floor(totalVolume / containerCapacityLiters);
  }

  return Math.floor(totalUnits / containerCapacityLiters);
}

/**
 * Recalculates cart unit prices for a newly selected customer tier.
 */
export function recalculateCartForCustomer(
  cart: CartItem[],
  customer: Customer | null,
  products: Product[]
): CartItem[] {
  return cart.map(item => {
    if (item.is_quick_add || !item.product_id || item.price_overridden) return item;
    const prod = products.find(p => p.id === item.product_id);
    if (!prod) return item;
    const packSize = item.selected_pack_size_id
      ? prod.pack_sizes?.find(s => s.id === item.selected_pack_size_id)
      : prod.pack_sizes?.find(s => s.multiplier === item.pack_multiplier);
    return {
      ...item,
      unit_price: getProductPackPrice(prod, customer, packSize, item.pack_multiplier || 1)
    };
  });
}


