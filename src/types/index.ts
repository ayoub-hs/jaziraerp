export type CustomerType = 'RETAIL' | 'WHOLESALE' | 'RESELLER';

export interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  type: CustomerType;
  reseller_discount_percent: number;
  wallet_balance: number;
  total_debt?: number;
  open_ticket_count?: number;
  has_overdue_tickets?: boolean;
}

export interface PackSize {
  id: string;
  product_id: string;
  pack_label: string;
  multiplier: number;
  price_override?: number | null;
  barcode?: string | null;
}

export interface Product {
  id: string;
  family_id: string;
  family_name?: string;
  category: string;
  product_type?: 'MANUFACTURED' | 'RESALE';
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
  pack_sizes?: PackSize[];
}

export interface ProductFamily {
  id: string;
  name: string;
  category: string;
  type: 'MANUFACTURED' | 'RESALE';
  formulation_id?: string | null;
  image_url?: string | null;
  active: number;
  products?: Product[];
}

export interface CartItem {
  cart_item_id: string;
  product_id?: string;
  name: string;
  size_label?: string | null;
  barcode?: string | null;
  unit_price: number;
  quantity: number;
  pack_multiplier: number;
  pack_label?: string;
  is_quick_add?: boolean;
  selected_pack_size_id?: string;
  discount_amount?: number;
  container_type_id?: string | null;
  container_capacity_liters?: number | null;
  loan_container?: boolean;
  price_overridden?: boolean;
}

export interface RegisterSession {
  id: string;
  session_number: string;
  counter_name: string;
  opened_at: string;
  closed_at?: string | null;
  opening_cash: number;
  closing_cash_counted?: number | null;
  closing_cash_expected?: number | null;
  variance?: number | null;
  notes?: string | null;
  status: 'OPEN' | 'CLOSED';
}

export interface DebtTicket {
  id: string;
  ticket_number: string;
  customer_id: string;
  customer_name?: string;
  sale_id?: string | null;
  date: string;
  total_amount: number;
  remaining_amount: number;
  status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  is_overdue?: boolean;
  days_open?: number;
}

export interface SupplierDebtTicket {
  id: string;
  ticket_number: string;
  supplier_id: string;
  supplier_name?: string;
  purchase_id?: string | null;
  date: string;
  total_amount: number;
  remaining_amount: number;
  status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
}

export interface ContainerType {
  id: string;
  name: string;
  capacity_liters?: number | null;
  stock_quantity: number;
  total_loaned_out?: number;
}

export interface CustomerContainerLoan {
  id: string;
  customer_id: string;
  customer_name?: string;
  container_type_id: string;
  container_name?: string;
  container_type_name?: string;
  capacity_liters?: number | null;
  quantity_owed: number;
}

export interface ContainerTransaction {
  id: string;
  date: string;
  customer_id: string;
  customer_name?: string;
  container_type_id: string;
  container_type_name?: string;
  action: 'GIVE' | 'RETURN';
  quantity: number;
  notes?: string | null;
  created_at?: string;
}

export interface RawMaterial {
  id: string;
  name: string;
  type?: 'CHEMICAL' | 'PACKAGING' | string;
  category?: string;
  unit: string;
  stock_quantity: number;
  low_stock_threshold: number;
  current_cost_per_unit?: number;
  latest_purchase_cost?: number;
  latest_supplier_id?: string | null;
  latest_supplier_name?: string | null;
  updated_at?: string;
}

export interface Formulation {
  id: string;
  name: string;
  base_volume: number;
  notes?: string | null;
  items?: Array<{
    id: string;
    material_id: string;
    material_name: string;
    unit: string;
    percentage: number;
    amount_per_100l: number;
    cost_per_unit: number;
  }>;
  total_batch_cost?: number;
  cost_per_liter?: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  tax_id?: string | null;
  total_debt?: number;
}

export interface SaleSummary {
  id: string;
  receipt_number: string;
  invoice_number?: string | null;
  session_id?: string | null;
  date: string;
  customer_id?: string | null;
  customer_name?: string | null;
  subtotal_ht: number;
  tva_rate: number;
  tva_amount: number;
  total_ttc: number;
  total_discount?: number;
  cash_paid: number;
  wallet_paid: number;
  credit_amount: number;
  change_given?: number;
  status: 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'FULLY_REFUNDED';
  items?: Array<{
    id: string;
    product_id?: string | null;
    description: string;
    name?: string;
    quantity: number;
    unit_price: number;
    pack_multiplier: number;
    total_line: number;
    line_total?: number;
    discount_amount?: number;
    refunded_quantity?: number;
  }>;
}
