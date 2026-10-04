import { authService } from './authService.js';

export interface ShopInfo {
  shop_name: string;
  shop_subtitle: string;
  shop_address: string;
  shop_phone: string;
  tax_id: string;
  default_retail_markup_percent?: string;
  default_wholesale_markup_percent?: string;
}

const STORAGE_KEY = 'aljazira_shop_info';

const EMPTY_SHOP_INFO: ShopInfo = {
  shop_name: 'Société Al Jazira SHSP',
  shop_subtitle: '',
  shop_address: '',
  shop_phone: '',
  tax_id: '',
  default_retail_markup_percent: '',
  default_wholesale_markup_percent: ''
};

/**
 * Returns current shop info synchronously from localStorage cache,
 * or blank defaults if nothing is cached.
 */
export function getShopInfo(): ShopInfo {
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          shop_name: parsed.shop_name || EMPTY_SHOP_INFO.shop_name,
          shop_subtitle: parsed.shop_subtitle || '',
          shop_address: parsed.shop_address || '',
          shop_phone: parsed.shop_phone || '',
          tax_id: parsed.tax_id || '',
          default_retail_markup_percent: parsed.default_retail_markup_percent ?? '',
          default_wholesale_markup_percent: parsed.default_wholesale_markup_percent ?? ''
        };
      }
    } catch {
      // Fall through to default
    }
  }
  return { ...EMPTY_SHOP_INFO };
}

/**
 * Caches shop settings in localStorage and refreshes the lock-screen name.
 */
export function setCachedShopInfo(info: Partial<ShopInfo>): void {
  const current = getShopInfo();
  const updated: ShopInfo = {
    shop_name: info.shop_name !== undefined ? info.shop_name : current.shop_name,
    shop_subtitle: info.shop_subtitle !== undefined ? info.shop_subtitle : current.shop_subtitle,
    shop_address: info.shop_address !== undefined ? info.shop_address : current.shop_address,
    shop_phone: info.shop_phone !== undefined ? info.shop_phone : current.shop_phone,
    tax_id: info.tax_id !== undefined ? info.tax_id : current.tax_id,
    default_retail_markup_percent: info.default_retail_markup_percent !== undefined ? info.default_retail_markup_percent : current.default_retail_markup_percent,
    default_wholesale_markup_percent: info.default_wholesale_markup_percent !== undefined ? info.default_wholesale_markup_percent : current.default_wholesale_markup_percent
  };

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('[ShopInfo] Failed to cache shop info to localStorage:', e);
    }
  }

  if (updated.shop_name) {
    authService.setShopName(updated.shop_name);
  }
}

/**
 * Fetches /api/settings/shop from backend and caches result locally.
 * Falls back safely to offline cached info if network fails.
 */
export async function fetchShopInfo(): Promise<ShopInfo> {
  try {
    const res = await fetch('/api/settings/shop');
    if (res.ok) {
      const data = await res.json();
      setCachedShopInfo(data);
      return getShopInfo();
    }
  } catch (err) {
    console.warn('[ShopInfo] Offline or server unreachable, using cached settings:', err);
  }
  return getShopInfo();
}
