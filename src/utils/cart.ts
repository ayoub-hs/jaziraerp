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
 * Validates split payment amounts against total due and customer limits.
 */
export function validateSplitPayment(
  totalTTC: number,
  cashPaid: number,
  walletPaid: number,
  creditAmount: number,
  customer?: Customer | null
): { valid: boolean; error?: string; changeDue: number } {
  const cash = roundMoney(Math.max(0, cashPaid || 0));
  const wallet = roundMoney(Math.max(0, walletPaid || 0));
  const credit = roundMoney(Math.max(0, creditAmount || 0));

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

