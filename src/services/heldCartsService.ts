import type { CartItem, Customer, Product } from '../types/index.js';
import { roundMoney } from '../utils/formatters.js';

export interface HeldCart {
  id: string;
  created_at: string;
  label: string;
  items: CartItem[];
  customer: Customer | null;
  saleDiscount: number;
  note?: string;
}

export interface PriceDiscrepancy {
  cartItemId: string;
  productName: string;
  oldPrice: number;
  newPrice: number;
}

const STORAGE_KEY = 'jazira_held_carts';
const MAX_HELD_CARTS = 10;

class HeldCartsService {
  private dispatchChange() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('held-carts-changed'));
    }
  }

  getHeldCarts(): HeldCart[] {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('Failed to parse held carts from localStorage:', err);
      return [];
    }
  }

  getHeldCartCount(): number {
    return this.getHeldCarts().length;
  }

  private saveHeldCarts(carts: HeldCart[]): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(carts));
    this.dispatchChange();
  }

  holdCart(
    items: CartItem[],
    customer: Customer | null,
    saleDiscount: number = 0,
    customLabel?: string,
    note?: string
  ): HeldCart {
    if (!items || items.length === 0) {
      throw new Error('Impossible de mettre en attente un panier vide');
    }

    const carts = this.getHeldCarts();
    if (carts.length >= MAX_HELD_CARTS) {
      throw new Error(`Limite de ${MAX_HELD_CARTS} paniers en attente atteinte`);
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const defaultLabel = customer
      ? `${customer.name} (${timeStr})`
      : `Panier #${carts.length + 1} (${timeStr})`;

    const heldCart: HeldCart = {
      id: `held-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      created_at: now.toISOString(),
      label: customLabel?.trim() || defaultLabel,
      items: JSON.parse(JSON.stringify(items)),
      customer: customer ? JSON.parse(JSON.stringify(customer)) : null,
      saleDiscount: saleDiscount || 0,
      note: note?.trim() || undefined
    };

    const updated = [heldCart, ...carts];
    this.saveHeldCarts(updated);
    return heldCart;
  }

  resumeCart(id: string): HeldCart | null {
    const carts = this.getHeldCarts();
    const index = carts.findIndex(c => c.id === id);
    if (index === -1) return null;

    const [resumed] = carts.splice(index, 1);
    this.saveHeldCarts(carts);
    return resumed;
  }

  deleteCart(id: string): boolean {
    const carts = this.getHeldCarts();
    const updated = carts.filter(c => c.id !== id);
    if (updated.length !== carts.length) {
      this.saveHeldCarts(updated);
      return true;
    }
    return false;
  }

  clearAll(): void {
    this.saveHeldCarts([]);
  }

  checkPriceDiscrepancies(heldCart: HeldCart, products: Product[]): PriceDiscrepancy[] {
    const discrepancies: PriceDiscrepancy[] = [];
    const customer = heldCart.customer;

    for (const item of heldCart.items) {
      if (item.is_quick_add || item.price_overridden || !item.product_id) {
        continue;
      }

      const prod = products.find(p => p.id === item.product_id);
      if (!prod) continue;

      let catalogBasePrice = Number(prod.retail_price) || 0;
      if (customer) {
        if (customer.type === 'WHOLESALE') {
          catalogBasePrice = Number(prod.wholesale_price) || 0;
        } else if (customer.type === 'RESELLER') {
          const discount = Math.max(0, Math.min(100, Number(customer.reseller_discount_percent) || 0));
          catalogBasePrice = (Number(prod.wholesale_price) || 0) * ((100 - discount) / 100);
        }
      }

      const expectedUnitPrice = roundMoney(catalogBasePrice * (item.pack_multiplier || 1));
      const currentUnitPrice = roundMoney(item.unit_price);

      if (Math.abs(expectedUnitPrice - currentUnitPrice) >= 0.001) {
        discrepancies.push({
          cartItemId: item.cart_item_id,
          productName: item.name,
          oldPrice: currentUnitPrice,
          newPrice: expectedUnitPrice
        });
      }
    }

    return discrepancies;
  }
}

export const heldCartsService = new HeldCartsService();
