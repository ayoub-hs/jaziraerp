import Dexie, { type Table } from 'dexie';

export interface LocalProduct {
  id: string;
  family_id: string;
  family_name?: string;
  category: string;
  product_type?: string;
  name: string;
  size_label?: string | null;
  barcode?: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  cost_reference: number;
  retail_price: number;
  wholesale_price: number;
  container_type_id?: string | null;
  active: number;
  is_low_stock?: number;
  pack_sizes?: LocalPackSize[];
}

export interface LocalPackSize {
  id: string;
  product_id: string;
  pack_label: string;
  multiplier: number;
  price_override?: number | null;
  barcode?: string | null;
}

export interface LocalCustomer {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  type: 'RETAIL' | 'WHOLESALE' | 'RESELLER';
  reseller_discount_percent: number;
  wallet_balance: number;
  total_debt?: number;
  open_ticket_count?: number;
  has_overdue_tickets?: boolean;
}

export interface LocalContainerType {
  id: string;
  name: string;
  capacity_liters?: number | null;
  stock_quantity: number;
  total_loaned_out?: number;
}

export interface LocalActiveSession {
  id: string;
  counter_name: string;
  session_number: string;
  opening_cash: number;
  status: 'OPEN' | 'CLOSED';
}

export interface PendingSyncItem {
  queue_id?: number;
  temp_client_id: string;
  action_type: 'SALE' | 'CASH_MOVEMENT' | 'CONTAINER_TRANSACTION' | 'PRICE_STOCK_EDIT';
  payload: any;
  created_at: string;
  attempts?: number;
  error?: string;
  needs_review?: boolean;
}

export class AppClientDatabase extends Dexie {
  products!: Table<LocalProduct, string>;
  pack_sizes!: Table<LocalPackSize, string>;
  customers!: Table<LocalCustomer, string>;
  container_types!: Table<LocalContainerType, string>;
  active_session!: Table<LocalActiveSession, string>;
  pending_sync_queue!: Table<PendingSyncItem, number>;

  constructor() {
    super('AlJaziraERP_ClientDB');

    this.version(1).stores({
      products: 'id, family_id, barcode, name, category, stock_quantity, active',
      pack_sizes: 'id, product_id, barcode',
      customers: 'id, name, type',
      container_types: 'id, name',
      active_session: 'id, counter_name, status',
      pending_sync_queue: '++queue_id, temp_client_id, action_type, created_at'
    });
  }
}

export const clientDb = new AppClientDatabase();
