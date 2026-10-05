import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Plus, 
  Trash2, 
  AlertTriangle, 
  Tag, 
  Layers, 
  RotateCcw, 
  User, 
  Wallet, 
  CreditCard, 
  Check, 
  Barcode as BarcodeIcon,
  ChevronRight,
  Package,
  Camera,
  Box,
  AlertCircle,
  CheckCircle2,
  X
} from 'lucide-react';
import type { 
  Product, 
  ProductFamily, 
  Customer, 
  ContainerType,
  CartItem, 
  RegisterSession,
  PackSize
} from '../../types/index.js';
import { calculateCartTotals, getProductPriceForCustomer, getProductPackPrice, calculateContainersNeeded } from '../../utils/cart.js';
import { formatMoney, roundMoney } from '../../utils/formatters.js';
import { playBeep, playErrorBeep, vibrateError } from '../../utils/audio.js';
import { QuickAddModal } from '../shared/QuickAddModal.js';
import { FamilySizesModal } from '../shared/FamilySizesModal.js';
import { CheckoutModal } from '../shared/CheckoutModal.js';
import { RefundModal } from '../shared/RefundModal.js';
import { CameraScannerModal } from '../shared/CameraScannerModal.js';
import { ContainerTransactionModal } from '../backoffice/ContainerTransactionModal.js';

import { scannerService } from '../../services/hardware/scanner.js';

interface DesktopPosProps {
  products: Product[];
  families: ProductFamily[];
  customers: Customer[];
  containerTypes?: ContainerType[];
  activeSession: RegisterSession | null;
  onOpenSessionModal?: () => void;
  onRefreshData: () => void;
  onPopDrawer: () => void;
  onProcessSale: (saleData: any) => Promise<{ sale_id: string; receipt_number: string } | null>;
  onPrintReceipt: (saleId: string) => void;
  onPrintInvoice: (saleId: string) => void;
}

export const DesktopPos: React.FC<DesktopPosProps> = ({
  products,
  families,
  customers,
  containerTypes = [],
  activeSession,
  onOpenSessionModal,
  onRefreshData,
  onPopDrawer,
  onProcessSale,
  onPrintReceipt,
  onPrintInvoice
}) => {
  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [saleDiscount, setSaleDiscount] = useState<number>(0);
  const [editingDiscountItemId, setEditingDiscountItemId] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Modals
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isRefundOpen, setIsRefundOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isContainerTxOpen, setIsContainerTxOpen] = useState(false);
  const [familyModalData, setFamilyModalData] = useState<{
    isOpen: boolean;
    familyName: string;
    products: Product[];
  }>({ isOpen: false, familyName: '', products: [] });
  const [scanAlert, setScanAlert] = useState<{ type: 'error' | 'success'; message: string; barcode?: string } | null>(null);

  useEffect(() => {
    if (scanAlert) {
      const timer = setTimeout(() => setScanAlert(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [scanAlert]);

  // Extract unique categories
  const categories = ['ALL', ...Array.from(new Set(families.map(f => f.category || 'Other')))];

  // Totals taking into account line discounts and global sale discount
  const totals = calculateCartTotals(cart, saleDiscount);

  // Global Keyboard Wedge Scanner Listener
  useEffect(() => {
    scannerService.start();
    const unsubscribe = scannerService.onScan((scannedCode) => {
      handleBarcodeScanned(scannedCode);
    });
    return () => {
      unsubscribe();
    };
  }, [products, selectedCustomer]);

  const handleBarcodeScanned = (scannedCode: string) => {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    let matchedProduct: Product | undefined;
    let matchedPackSize: PackSize | undefined;
    let packMultiplier = 1;
    let packLabel: string | undefined;

    for (const p of products) {
      if (p.barcode && p.barcode.toLowerCase() === cleanCode.toLowerCase()) {
        matchedProduct = p;
        break;
      }
      const ps = p.pack_sizes?.find(s => s.barcode && s.barcode.toLowerCase() === cleanCode.toLowerCase());
      if (ps) {
        matchedProduct = p;
        matchedPackSize = ps;
        packMultiplier = ps.multiplier;
        packLabel = ps.pack_label;
        break;
      }
    }

    if (matchedProduct) {
      playBeep();
      addProductToCart(matchedProduct, packMultiplier, packLabel, matchedPackSize);
      setScanAlert({
        type: 'success',
        message: `Ajouté au panier : ${matchedProduct.name}${packLabel ? ` (${packLabel})` : ''}`
      });
    } else {
      playErrorBeep();
      vibrateError();
      setScanAlert({
        type: 'error',
        barcode: cleanCode,
        message: `Code-barres introuvable : "${cleanCode}"`
      });
    }
  };

  const addProductToCart = (
    product: Product,
    packMultiplier = 1,
    packLabel?: string,
    packSize?: PackSize | null
  ) => {
    const resolvedPackSize =
      packSize ??
      (packMultiplier > 1
        ? product.pack_sizes?.find(s => s.multiplier === packMultiplier && (!packLabel || s.pack_label === packLabel))
        : undefined);
    const unitPrice = getProductPackPrice(product, selectedCustomer, resolvedPackSize, packMultiplier);

    setCart(prev => {
      const existingIdx = prev.findIndex(
        i =>
          i.product_id === product.id &&
          i.pack_multiplier === packMultiplier &&
          i.selected_pack_size_id === resolvedPackSize?.id
      );
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: updated[existingIdx].quantity + 1
        };
        return updated;
      } else {
        const container = containerTypes.find(c => c.id === product.container_type_id);
        const newItem: CartItem = {
          cart_item_id: 'cart_' + Date.now() + '_' + Math.random(),
          product_id: product.id,
          name: product.name,
          size_label: product.size_label,
          barcode: product.barcode,
          unit_price: unitPrice,
          quantity: 1,
          pack_multiplier: packMultiplier,
          pack_label: packLabel || resolvedPackSize?.pack_label,
          selected_pack_size_id: resolvedPackSize?.id,
          discount_amount: 0,
          container_type_id: product.container_type_id || null,
          container_capacity_liters: container?.capacity_liters ?? null,
          loan_container: Boolean(product.container_type_id)
        };
        return [...prev, newItem];
      }
    });
  };

  const handleToggleContainerLoan = (cartItemId: string) => {
    setCart(prev =>
      prev.map(item =>
        item.cart_item_id === cartItemId
          ? { ...item, loan_container: !item.loan_container }
          : item
      )
    );
  };

  const handleUpdateUnitPrice = (cartItemId: string, newPrice: number) => {
    setCart(prev =>
      prev.map(item =>
        item.cart_item_id === cartItemId
          ? { ...item, unit_price: Math.max(0, roundMoney(newPrice)) }
          : item
      )
    );
  };

  const handleUpdateItemDiscount = (cartItemId: string, amount: number) => {
    setCart(prev =>
      prev.map(item =>
        item.cart_item_id === cartItemId
          ? { ...item, discount_amount: Math.max(0, roundMoney(amount)) }
          : item
      )
    );
  };

  const handleUpdateQuantity = (cartItemId: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveItem(cartItemId);
      return;
    }
    setCart(prev =>
      prev.map(i => (i.cart_item_id === cartItemId ? { ...i, quantity: newQty } : i))
    );
  };

  const handleRemoveItem = (cartItemId: string) => {
    setCart(prev => prev.filter(i => i.cart_item_id !== cartItemId));
  };

  const handleClearCart = () => {
    if (cart.length === 0) return;
    if (window.confirm('Clear all items from cart?')) {
      setCart([]);
      setSaleDiscount(0);
    }
  };

  // Recalculate customer tier prices on cart when customer changes
  useEffect(() => {
    setCart(prev =>
      prev.map(item => {
        if (item.is_quick_add || !item.product_id) return item;
        const prod = products.find(p => p.id === item.product_id);
        if (!prod) return item;
        const packSize = item.selected_pack_size_id
          ? prod.pack_sizes?.find(s => s.id === item.selected_pack_size_id)
          : prod.pack_sizes?.find(s => s.multiplier === item.pack_multiplier);
        return {
          ...item,
          unit_price: getProductPackPrice(prod, selectedCustomer, packSize, item.pack_multiplier || 1)
        };
      })
    );
  }, [selectedCustomer, products]);

  // Filter products
  const filteredProducts = products.filter(p => {
    if (selectedCategory !== 'ALL') {
      const fam = families.find(f => f.id === p.family_id);
      if (fam?.category !== selectedCategory && p.category !== selectedCategory) {
        return false;
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchBarcode = p.barcode?.toLowerCase().includes(q);
      return matchName || matchBarcode;
    }
    return true;
  });

  // Group products by family for grid display — deduplicate filteredProducts by family_id
  const familyGroups = React.useMemo(() => {
    const map = new Map<string, {
      familyKey: string;
      familyName: string;
      category: string;
      matchedProducts: Product[];
    }>();

    for (const p of filteredProducts) {
      const key = p.family_id || p.id;
      const fam = p.family_id ? families.find(f => f.id === p.family_id) : null;
      const name = fam?.name || p.name;
      const cat = fam?.category || p.category || 'General';

      if (!map.has(key)) {
        map.set(key, {
          familyKey: key,
          familyName: name,
          category: cat,
          matchedProducts: []
        });
      }
      map.get(key)!.matchedProducts.push(p);
    }

    return Array.from(map.values()).map(group => {
      // Find all sizes in catalog for this family so modal lists all available sizes
      const allFamilyProducts = products.filter(p => (p.family_id ? p.family_id === group.familyKey : p.id === group.familyKey));
      const productsToShow = allFamilyProducts.length > 0 ? allFamilyProducts : group.matchedProducts;

      const prices = productsToShow.map(p => getProductPriceForCustomer(p, selectedCustomer));
      const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
      const totalStock = productsToShow.reduce((sum, p) => sum + (p.stock_quantity || 0), 0);
      const hasLowStock = productsToShow.some(p => p.stock_quantity <= p.low_stock_threshold);

      return {
        familyKey: group.familyKey,
        familyName: group.familyName,
        category: group.category,
        minPrice,
        totalStock,
        hasLowStock,
        products: productsToShow
      };
    });
  }, [filteredProducts, families, products, selectedCustomer]);

  const handleFamilyTileClick = (group: { familyName: string; products: Product[] }) => {
    setFamilyModalData({
      isOpen: true,
      familyName: group.familyName,
      products: group.products
    });
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-100 relative">
      {/* Barcode Scan Notification Alert */}
      {scanAlert && (
        <div
          className={`fixed top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border text-xs sm:text-sm font-bold animate-in fade-in slide-in-from-top-3 duration-200 ${
            scanAlert.type === 'error'
              ? 'bg-rose-600 text-white border-rose-400'
              : 'bg-emerald-600 text-white border-emerald-400'
          }`}
        >
          {scanAlert.type === 'error' ? (
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-white animate-pulse" />
          ) : (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-white" />
          )}
          <div className="flex flex-col">
            <span>{scanAlert.message}</span>
            {scanAlert.barcode && (
              <span className="text-[11px] font-mono opacity-90">Produit introuvable dans le catalogue</span>
            )}
          </div>
          <button
            onClick={() => setScanAlert(null)}
            className="ml-3 p-1 rounded-lg hover:bg-black/20 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* LEFT COLUMN: Products Browser (60% width) */}
      <div className="w-7/12 flex flex-col border-r border-slate-200 bg-white overflow-hidden">
        {/* Top Filter Bar */}
        <div className="p-3 border-b border-slate-200 space-y-2 bg-slate-50/50">
          <div className="flex items-center gap-2">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search products by name or scan barcode..."
                className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            {/* Camera Scan Button */}
            <button
              onClick={() => setIsCameraOpen(true)}
              title="Camera Barcode Scanner"
              className="flex items-center gap-1 bg-white hover:bg-slate-50 text-slate-700 font-bold px-3 py-1.5 rounded-xl text-xs border border-slate-300 transition-colors shrink-0"
            >
              <Camera className="w-3.5 h-3.5 text-slate-600" />
              Scan
            </button>

            {/* Quick Add Button */}
            <button
              onClick={() => setIsQuickAddOpen(true)}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-900 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-colors shrink-0"
            >
              <Tag className="w-3.5 h-3.5 text-emerald-400" />
              Quick Add
            </button>

            {/* Returns / Refund Button */}
            <button
              onClick={() => setIsRefundOpen(true)}
              className="flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold px-3 py-1.5 rounded-xl text-xs border border-amber-200 transition-colors shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Refund
            </button>
          </div>

          {/* Category Tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-lg font-semibold whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Products Grid (Grouped by Family) */}
        <div className="flex-1 p-3 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 content-start">
          {familyGroups.map(group => {
            return (
              <div
                key={group.familyKey}
                onClick={() => handleFamilyTileClick(group)}
                className="bg-white border border-slate-200 hover:border-emerald-500 hover:shadow-md p-2.5 rounded-xl cursor-pointer flex flex-col justify-between transition-all group"
              >
                <div>
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight truncate">
                      {group.category}
                    </span>
                    {group.products.length > 1 ? (
                      <span className="text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 rounded">
                        {group.products.length} tailles
                      </span>
                    ) : (
                      group.products[0]?.size_label && (
                        <span className="text-[10px] font-extrabold bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded">
                          {group.products[0].size_label}
                        </span>
                      )
                    )}
                  </div>
                  <h3 className="text-xs font-bold text-slate-900 line-clamp-2 mt-1 group-hover:text-emerald-700 transition-colors">
                    {group.familyName}
                  </h3>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-black text-emerald-700 font-mono">
                      {group.products.length > 1 ? `dès ${formatMoney(group.minPrice)}` : formatMoney(group.minPrice)}
                    </span>
                  </div>

                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                      group.hasLowStock
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                    title="Stock total disponible"
                  >
                    {group.hasLowStock && <AlertTriangle className="w-2.5 h-2.5" />}
                    {group.totalStock}
                  </span>
                </div>
              </div>
            );
          })}

          {familyGroups.length === 0 && (
            <div className="col-span-full py-16 text-center text-slate-400 text-xs">
              No products found matching your search.
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Persistent Cart & Terminal (40% width) */}
      <div className="w-5/12 flex flex-col bg-white overflow-hidden shadow-lg border-l border-slate-200">
        {/* Customer Header Bar */}
        <div className="p-3 border-b border-slate-200 bg-slate-50/80 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-emerald-600" />
              Customer
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsContainerTxOpen(true)}
                className="text-xs font-bold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
                title="Enregistrer un prêt ou retour de consigne"
              >
                <Box className="w-3.5 h-3.5 text-amber-600" />
                <span>Consignes</span>
              </button>
              {cart.length > 0 && (
                <button
                  onClick={handleClearCart}
                  className="text-[11px] font-semibold text-rose-600 hover:text-rose-800"
                >
                  Clear Cart
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedCustomer?.id || ''}
              onChange={e => {
                const cust = customers.find(c => c.id === e.target.value) || null;
                setSelectedCustomer(cust);
              }}
              className="flex-1 text-xs font-semibold px-2.5 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
            >
              <option value="">Passager / Retail Walk-in</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.type}{c.reseller_discount_percent ? ` -${c.reseller_discount_percent}%` : ''})
                </option>
              ))}
            </select>
          </div>

          {/* Customer Status Badges */}
          {selectedCustomer && (
            <div className="flex items-center gap-2 text-[10px] font-bold">
              <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                Tier: {selectedCustomer.type}
              </span>
              <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded flex items-center gap-1">
                <Wallet className="w-3 h-3" />
                Wallet: {formatMoney(selectedCustomer.wallet_balance)}
              </span>
              {(selectedCustomer.total_debt || 0) > 0 && (
                <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded flex items-center gap-1">
                  <CreditCard className="w-3 h-3" />
                  Debt: {formatMoney(selectedCustomer.total_debt)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Cart Item Rows */}
        <div className="flex-1 p-3 overflow-y-auto divide-y divide-slate-100">
          {cart.map(item => (
            <div key={item.cart_item_id} className="py-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-slate-900 truncate">
                    {item.name}
                  </h4>
                  <div className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                    <span className="text-slate-400 font-medium text-[9px]">P.U:</span>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={item.unit_price}
                      onChange={e => handleUpdateUnitPrice(item.cart_item_id, parseFloat(e.target.value) || 0)}
                      className="w-16 px-1 py-0.2 text-[10px] font-mono font-bold text-emerald-700 bg-white border border-slate-200 rounded focus:border-emerald-500 focus:outline-none"
                      title="Modifier le prix unitaire"
                    />
                    <span className="text-[9px] text-slate-400 font-mono">DT</span>
                    {item.size_label && (
                      <span className="bg-slate-100 px-1 rounded font-semibold">{item.size_label}</span>
                    )}
                    {item.pack_multiplier > 1 && (
                      <span className="text-blue-600 font-semibold">x{item.pack_multiplier} pcs</span>
                    )}
                  </div>
                </div>

                {/* Quantity Stepper */}
                <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-slate-50">
                  <button
                    onClick={() => handleUpdateQuantity(item.cart_item_id, Math.max(0, item.quantity - 1))}
                    className="px-2 py-0.5 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={item.quantity}
                    onChange={e =>
                      handleUpdateQuantity(item.cart_item_id, parseFloat(e.target.value) || 0)
                    }
                    className="w-12 text-center text-xs font-bold font-mono bg-white border-x border-slate-300 py-0.5 focus:outline-none"
                  />
                  <button
                    onClick={() => handleUpdateQuantity(item.cart_item_id, item.quantity + 1)}
                    className="px-2 py-0.5 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                  >
                    +
                  </button>
                </div>

                {/* Total Line & Remove */}
                <div className="text-right flex items-center gap-2">
                  <div className="flex flex-col items-end">
                    {(item.discount_amount || 0) > 0 && (
                      <span className="text-[10px] line-through text-slate-400 font-mono">
                        {formatMoney(item.unit_price * item.quantity)}
                      </span>
                    )}
                    <span className="text-xs font-black text-slate-900 font-mono">
                      {formatMoney(Math.max(0, (item.unit_price * item.quantity) - (item.discount_amount || 0)))}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveItem(item.cart_item_id)}
                    className="text-slate-300 hover:text-rose-600 p-1 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Per-line controls: Container Loan Toggle & Discount */}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <div className="flex items-center gap-2">
                  {item.container_type_id && (
                    <button
                      type="button"
                      onClick={() => handleToggleContainerLoan(item.cart_item_id)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors border ${
                        item.loan_container
                          ? 'bg-amber-100 text-amber-900 border-amber-300 shadow-xs'
                          : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                      }`}
                      title={item.loan_container ? "Consigne prêtée (enregistrée au compte client)" : "Emballage client (pas de consigne prêtée)"}
                    >
                      <Box className="w-3 h-3 text-amber-600" />
                      <span>
                        {item.loan_container
                          ? `Prêt consigne (${calculateContainersNeeded(item.quantity, item.pack_multiplier, item.size_label, item.container_capacity_liters, item.name)} pcs)`
                          : 'Emballage client'}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setEditingDiscountItemId(editingDiscountItemId === item.cart_item_id ? null : item.cart_item_id)}
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 transition-colors ${
                      (item.discount_amount || 0) > 0
                        ? 'bg-rose-100 text-rose-700 font-mono'
                        : 'text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200'
                    }`}
                    title="Remise par article"
                  >
                    <Tag className="w-3 h-3" />
                    {(item.discount_amount || 0) > 0 ? `Remise: -${formatMoney(item.discount_amount)}` : 'Remise'}
                  </button>
                </div>
              </div>

              {/* Line Discount Input dropdown */}
              {editingDiscountItemId === item.cart_item_id && (
                <div className="mt-1 flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-600">Remise ligne (DT):</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={item.discount_amount || ''}
                    onChange={e => handleUpdateItemDiscount(item.cart_item_id, parseFloat(e.target.value) || 0)}
                    placeholder="0.000"
                    className="w-20 px-1.5 py-0.5 text-xs font-mono font-bold border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setEditingDiscountItemId(null)}
                    className="text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded"
                  >
                    OK
                  </button>
                </div>
              )}
            </div>
          ))}

          {cart.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 py-12">
              <Package className="w-8 h-8 stroke-1 text-slate-300 mb-2" />
              <p className="text-xs font-medium">Cart is empty</p>
              <p className="text-[10px] text-slate-400">Scan barcode or click items to begin sale</p>
            </div>
          )}
        </div>

        {/* Totals & Checkout Box */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
          {/* Sale Discount Input */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
              <Tag className="w-3.5 h-3.5 text-emerald-600" />
              Remise globale (DT):
            </span>
            <input
              type="number"
              step="0.5"
              min="0"
              value={saleDiscount || ''}
              onChange={e => setSaleDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
              placeholder="0.000"
              className="w-24 px-2 py-1 text-xs text-right font-mono font-bold border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white"
            />
          </div>

          {/* Subtotals & Taxes */}
          <div className="space-y-1 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Articles ({totals.itemCount} items / {totals.totalPieces} pcs):</span>
              <span className="font-mono">{formatMoney(totals.subtotalHT)} HT</span>
            </div>
            <div className="flex justify-between">
              <span>TVA (19%):</span>
              <span className="font-mono">{formatMoney(totals.tvaAmount)}</span>
            </div>
            {totals.totalDiscount > 0 && (
              <div className="flex justify-between text-rose-600 font-semibold">
                <span>Total Remises:</span>
                <span className="font-mono">-{formatMoney(totals.totalDiscount)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-black text-slate-900 pt-1 border-t border-slate-200">
              <span>TOTAL TTC:</span>
              <span className="font-mono text-xl text-emerald-700">
                {formatMoney(totals.totalTTC)}
              </span>
            </div>
          </div>

          {/* Closed Register Notice */}
          {!activeSession && (
            <div className="mb-2.5 p-2.5 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-amber-900 font-semibold">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Caisse fermée — Session requise</span>
              </div>
              <button
                type="button"
                onClick={onOpenSessionModal}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-2.5 py-1 rounded-lg text-xs transition-colors shadow-xs"
              >
                Ouvrir la caisse
              </button>
            </div>
          )}

          {/* Checkout Button */}
          <button
            disabled={cart.length === 0}
            onClick={() => {
              if (!activeSession || activeSession.status !== 'OPEN') {
                if (onOpenSessionModal) onOpenSessionModal();
                return;
              }
              setIsCheckoutOpen(true);
            }}
            className={`w-full py-3 text-white font-black rounded-xl shadow-lg transition-all text-sm flex items-center justify-center gap-2 ${
              cart.length === 0
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : !activeSession
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            <span>{!activeSession ? 'Ouvrir la caisse pour encaisser' : 'Tender & Split Payment'}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Shared Modals */}
      <QuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        onAddItem={item => setCart(prev => [...prev, item])}
      />

      <FamilySizesModal
        isOpen={familyModalData.isOpen}
        onClose={() => setFamilyModalData({ isOpen: false, familyName: '', products: [] })}
        familyName={familyModalData.familyName}
        products={familyModalData.products}
        customer={selectedCustomer}
        onSelectProduct={prod => addProductToCart(prod)}
      />

      <CheckoutModal
        isOpen={isCheckoutOpen}
        activeSession={activeSession}
        onOpenSessionModal={onOpenSessionModal}
        onClose={() => setIsCheckoutOpen(false)}
        onSaleDone={() => {
          setCart([]);
          setSaleDiscount(0);
        }}
        items={cart}
        customer={selectedCustomer}
        saleDiscount={saleDiscount}
        onCompleteSale={async tender => {
          const salePayload = {
            customer_id: selectedCustomer?.id || null,
            items: cart.map(item => ({
              product_id: item.product_id || null,
              pack_size_id: item.selected_pack_size_id || null,
              description: item.name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              pack_multiplier: item.pack_multiplier || 1,
              is_quick_add: Boolean(item.is_quick_add),
              discount_amount: item.discount_amount || 0,
              container_type_id: item.container_type_id || null,
              container_capacity_liters: item.container_capacity_liters || null,
              loan_container: Boolean(item.loan_container)
            })),
            total_discount: tender.total_discount !== undefined ? tender.total_discount : saleDiscount,
            subtotal_ht: totals.subtotalHT,
            tva_amount: totals.tvaAmount,
            total_ttc: totals.totalTTC,
            cash_paid: tender.cash_paid,
            cash_tendered: tender.cash_tendered !== undefined ? tender.cash_tendered : tender.cash_paid,
            wallet_paid: tender.wallet_paid,
            credit_amount: tender.credit_amount
          };
          const result = await onProcessSale(salePayload);
          onRefreshData();
          return result;
        }}
        onPrintReceipt={onPrintReceipt}
        onPrintInvoice={onPrintInvoice}
      />

      <RefundModal
        isOpen={isRefundOpen}
        onClose={() => setIsRefundOpen(false)}
        onRefundCompleted={onRefreshData}
        activeSessionId={activeSession?.id || null}
      />

      <CameraScannerModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onScan={code => {
          handleBarcodeScanned(code);
        }}
      />

      <ContainerTransactionModal
        isOpen={isContainerTxOpen}
        onClose={() => setIsContainerTxOpen(false)}
        containerTypes={containerTypes}
        customers={customers}
        initialCustomerId={selectedCustomer?.id || null}
        onSuccess={() => {
          onRefreshData();
        }}
      />
    </div>
  );
};
