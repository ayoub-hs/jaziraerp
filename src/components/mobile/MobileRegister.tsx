import React, { useState, useRef } from 'react';
import { 
  ShoppingCart, 
  Search, 
  Edit3, 
  Users, 
  Camera, 
  ChevronUp, 
  X, 
  Plus, 
  Minus, 
  Trash2, 
  AlertTriangle, 
  DollarSign, 
  CheckCircle, 
  CreditCard, 
  ArrowRight,
  RefreshCw,
  Box,
  Tag,
  AlertCircle,
  RotateCcw,
  UserPlus
} from 'lucide-react';
import type { 
  Product, 
  ProductFamily, 
  Customer, 
  CartItem, 
  RegisterSession,
  ContainerType,
  PackSize
} from '../../types/index.js';
import { calculateCartTotals, getProductPriceForCustomer, getProductPackPrice, calculateContainersNeeded } from '../../utils/cart.js';
import { formatMoney, roundMoney } from '../../utils/formatters.js';
import { playBeep, playErrorBeep, vibrateError } from '../../utils/audio.js';
import { CheckoutModal } from '../shared/CheckoutModal.js';
import { FamilySizesModal } from '../shared/FamilySizesModal.js';
import { QuickAddModal } from '../shared/QuickAddModal.js';
import { CameraScannerModal } from '../shared/CameraScannerModal.js';
import { RefundModal } from '../shared/RefundModal.js';
import { CreateCustomerModal } from '../backoffice/CreateCustomerModal.js';
import { scannerService } from '../../services/hardware/scanner.js';
import { BufferedNumberInput } from '../shared/BufferedNumberInput.js';

interface MobileRegisterProps {
  products: Product[];
  families: ProductFamily[];
  customers: Customer[];
  containerTypes: ContainerType[];
  activeSession: RegisterSession | null;
  onOpenSessionModal?: () => void;
  onRefreshData: () => void;
  onProcessSale: (saleData: any) => Promise<{ sale_id: string; receipt_number: string } | null>;
  onPrintReceipt: (saleId: string) => void;
  onPrintInvoice: (saleId: string) => void;
}

export const MobileRegister: React.FC<MobileRegisterProps> = ({
  products,
  families,
  customers,
  containerTypes,
  activeSession,
  onOpenSessionModal,
  onRefreshData,
  onProcessSale,
  onPrintReceipt,
  onPrintInvoice
}) => {
  const [activeTab, setActiveTab] = useState<'REGISTER' | 'LOOKUP' | 'QUICK_EDIT' | 'CUSTOMERS'>('REGISTER');

  // Cart & Customer state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [saleDiscount, setSaleDiscount] = useState<number>(0);
  const [editingDiscountItemId, setEditingDiscountItemId] = useState<string | null>(null);
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isRefundOpen, setIsRefundOpen] = useState(false);
  const [isCreateCustomerOpen, setIsCreateCustomerOpen] = useState(false);
  const [familyModalData, setFamilyModalData] = useState<{
    isOpen: boolean;
    familyName: string;
    products: Product[];
  }>({ isOpen: false, familyName: '', products: [] });

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Price Lookup State
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupProduct, setLookupProduct] = useState<Product | null>(null);

  // Quick Edit State
  const [editQuery, setEditQuery] = useState('');
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editRetailPrice, setEditRetailPrice] = useState('');
  const [editWholesalePrice, setEditWholesalePrice] = useState('');
  const [editStock, setEditStock] = useState('');
  const [editSuccessMsg, setEditSuccessMsg] = useState<string | null>(null);
  const [isSubmittingQuickEdit, setIsSubmittingQuickEdit] = useState(false);
  const isSubmittingQuickEditRef = useRef(false);

  // Customer Tab State
  const [custSearch, setCustSearch] = useState('');
  const [selectedCustDetails, setSelectedCustDetails] = useState<Customer | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMsg, setPaymentMsg] = useState<string | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const isSubmittingPaymentRef = useRef(false);

  // Container give/return in customer view
  const [isContainerModalOpen, setIsContainerModalOpen] = useState(false);
  const [containerAction, setContainerAction] = useState<'GIVE' | 'RETURN'>('GIVE');
  const [selectedContainerTypeId, setSelectedContainerTypeId] = useState<string>('');
  const [containerQty, setContainerQty] = useState('1');
  const [isSubmittingContainer, setIsSubmittingContainer] = useState(false);
  const [containerError, setContainerError] = useState<string | null>(null);
  const isSubmittingContainerRef = useRef(false);

  // Camera & Scanner State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'REGISTER' | 'LOOKUP' | 'QUICK_EDIT'>('REGISTER');

  // Quick-add uncataloged item
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  const totals = calculateCartTotals(cart, saleDiscount);
  const categories = ['ALL', ...Array.from(new Set(families.map(f => f.category || 'Other')))];

  // Global Keyboard Wedge Scanner Listener
  React.useEffect(() => {
    scannerService.start();
    const unsubscribe = scannerService.onScan(barcode => {
      handleBarcodeScanned(barcode);
    });
    return () => {
      unsubscribe();
    };
  }, [products, selectedCustomer, activeTab]);

  // Recalculate customer tier prices on cart when customer changes
  React.useEffect(() => {
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

  const [scanAlert, setScanAlert] = useState<{ type: 'error' | 'success'; message: string; barcode?: string } | null>(null);

  React.useEffect(() => {
    if (scanAlert) {
      const timer = setTimeout(() => setScanAlert(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [scanAlert]);

  const handleBarcodeScanned = (scannedCode: string) => {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    if (activeTab === 'REGISTER') {
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
          message: `Ajouté : ${matchedProduct.name}${packMultiplier > 1 ? ` (${packLabel || `Pack x${packMultiplier}`})` : ''}`
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
    } else if (activeTab === 'LOOKUP') {
      handleLookupSearch(cleanCode);
    } else if (activeTab === 'QUICK_EDIT') {
      handleEditSearch(cleanCode);
    }
  };

  const handleCameraScan = (code: string) => {
    handleBarcodeScanned(code);
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
      const idx = prev.findIndex(
        i =>
          i.product_id === product.id &&
          i.pack_multiplier === packMultiplier &&
          i.selected_pack_size_id === resolvedPackSize?.id
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      const container = containerTypes.find(c => c.id === product.container_type_id);
      return [
        ...prev,
        {
          cart_item_id: 'mob_' + Date.now() + '_' + Math.random(),
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
          loan_container: Boolean(selectedCustomer && product.container_type_id)
        }
      ];
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
      setCart(prev => prev.filter(i => i.cart_item_id !== cartItemId));
      return;
    }
    setCart(prev =>
      prev.map(i => (i.cart_item_id === cartItemId ? { ...i, quantity: newQty } : i))
    );
  };

  // Filter products for Register tab
  const filteredProducts = products.filter(p => {
    if (selectedCategory !== 'ALL') {
      const fam = families.find(f => f.id === p.family_id);
      if (fam?.category !== selectedCategory && p.category !== selectedCategory) {
        return false;
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q);
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

  const [lookupNotFound, setLookupNotFound] = useState(false);

  const handleLookupSearch = (term: string) => {
    const cleanTerm = term.trim();
    setLookupQuery(term);
    if (!cleanTerm) {
      setLookupProduct(null);
      setLookupNotFound(false);
      return;
    }
    const q = cleanTerm.toLowerCase();
    let found: Product | undefined;
    for (const p of products) {
      if (p.barcode?.toLowerCase() === q || p.name.toLowerCase().includes(q)) {
        found = p;
        break;
      }
      const ps = p.pack_sizes?.find(s => s.barcode?.toLowerCase() === q);
      if (ps) {
        found = p;
        break;
      }
    }
    if (found) {
      playBeep();
      setLookupProduct(found);
      setLookupNotFound(false);
    } else {
      playErrorBeep();
      vibrateError();
      setLookupProduct(null);
      setLookupNotFound(true);
    }
  };

  const handleEditSearch = (term: string) => {
    setEditQuery(term);
    if (!term.trim()) {
      setEditProduct(null);
      return;
    }
    const q = term.toLowerCase();
    const found = products.find(
      p => p.barcode?.toLowerCase() === q || p.name.toLowerCase().includes(q) || p.pack_sizes?.some(s => s.barcode?.toLowerCase() === q)
    );
    if (found) {
      setEditProduct(found);
      setEditRetailPrice(Number(found.retail_price || 0).toFixed(3));
      setEditWholesalePrice(Number(found.wholesale_price || 0).toFixed(3));
      setEditStock(found.stock_quantity.toString());
      setEditSuccessMsg(null);
    } else {
      setEditProduct(null);
    }
  };

  const handleSaveQuickEdit = async () => {
    if (!editProduct || isSubmittingQuickEditRef.current) return;
    isSubmittingQuickEditRef.current = true;
    setIsSubmittingQuickEdit(true);
    setEditSuccessMsg(null);
    try {
      const res = await fetch(`/api/products/${editProduct.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          retail_price: parseFloat(editRetailPrice) || 0,
          wholesale_price: parseFloat(editWholesalePrice) || 0,
          stock_quantity: parseFloat(editStock) || 0
        })
      });
      if (res.ok) {
        setEditSuccessMsg('Price & Stock updated successfully!');
        onRefreshData();
      } else {
        const data = await res.json().catch(() => ({}));
        setEditSuccessMsg(data.error || `Erreur mise à jour (${res.status})`);
      }
    } catch (err: any) {
      setEditSuccessMsg(err.message || 'Quick edit save failed');
    } finally {
      isSubmittingQuickEditRef.current = false;
      setIsSubmittingQuickEdit(false);
    }
  };

  const handleRecordCustomerPayment = async (customer: Customer) => {
    if (isSubmittingPaymentRef.current) return;
    const val = parseFloat(paymentAmount);
    if (isNaN(val) || val <= 0) return;

    isSubmittingPaymentRef.current = true;
    setIsSubmittingPayment(true);
    setPaymentMsg(null);
    try {
      const res = await fetch(`/api/customers/${customer.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: val, session_id: activeSession?.id })
      });
      if (res.ok) {
        const data = await res.json();
        setPaymentMsg(`Payment of ${formatMoney(val)} recorded via FIFO debt tickets.`);
        setPaymentAmount('');
        onRefreshData();
      } else {
        const data = await res.json().catch(() => ({}));
        setPaymentMsg(data.error || `Erreur paiement (${res.status})`);
      }
    } catch (err: any) {
      setPaymentMsg(err.message || 'Error processing payment');
    } finally {
      isSubmittingPaymentRef.current = false;
      setIsSubmittingPayment(false);
    }
  };

  const handleContainerTransaction = async () => {
    if (isSubmittingContainerRef.current) return;
    if (!selectedCustDetails || !selectedContainerTypeId) return;
    const qty = parseInt(containerQty);
    if (isNaN(qty) || qty <= 0) return;

    isSubmittingContainerRef.current = true;
    setIsSubmittingContainer(true);
    setContainerError(null);
    try {
      const res = await fetch('/api/containers/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedCustDetails.id,
          container_type_id: selectedContainerTypeId,
          action: containerAction,
          quantity: qty
        })
      });
      if (res.ok) {
        setIsContainerModalOpen(false);
        setContainerQty('1');
        onRefreshData();
      } else {
        const data = await res.json().catch(() => ({}));
        setContainerError(data.error || `Erreur contenant (${res.status})`);
      }
    } catch (err: any) {
      setContainerError(err.message || 'Container error');
    } finally {
      isSubmittingContainerRef.current = false;
      setIsSubmittingContainer(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-100 overflow-hidden relative pb-14">
      {/* Barcode Scan Notification Alert Toast */}
      {scanAlert && (
        <div
          className={`fixed top-14 inset-x-3 z-50 flex items-center justify-between p-3.5 rounded-2xl shadow-2xl border text-xs font-bold animate-in fade-in slide-in-from-top-3 duration-200 ${
            scanAlert.type === 'error'
              ? 'bg-rose-600 text-white border-rose-400'
              : 'bg-emerald-600 text-white border-emerald-400'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {scanAlert.type === 'error' ? (
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-white animate-pulse" />
            ) : (
              <CheckCircle className="w-5 h-5 flex-shrink-0 text-white" />
            )}
            <div className="flex flex-col">
              <span>{scanAlert.message}</span>
              {scanAlert.barcode && (
                <span className="text-[10px] font-mono opacity-90">Vérifiez le rayon ou l'étiquette</span>
              )}
            </div>
          </div>
          <button
            onClick={() => setScanAlert(null)}
            className="p-1 hover:bg-black/20 text-white rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 1. REGISTER TAB */}
      {activeTab === 'REGISTER' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Filter Bar */}
          <div className="p-3 bg-white border-b border-slate-200 space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
              <button
                onClick={() => {
                  setCameraMode('REGISTER');
                  setIsCameraOpen(true);
                }}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl flex items-center justify-center shrink-0 text-slate-700"
                title="Scan Barcode with Camera"
              >
                <Camera className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsQuickAddOpen(true)}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl flex items-center justify-center shrink-0"
                title="Quick-add uncataloged product"
              >
                <Tag className="w-4 h-4 text-emerald-400" />
              </button>
              <button
                onClick={() => setIsRefundOpen(true)}
                className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl flex items-center justify-center shrink-0"
                title="Remboursement / Retour"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            {/* Customer Selector & Quick Add Customer Row */}
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <select
                  value={selectedCustomer?.id || ''}
                  onChange={e => {
                    const c = customers.find(c => c.id === e.target.value) || null;
                    setSelectedCustomer(c);
                  }}
                  className="w-full text-xs font-semibold px-2.5 py-1.5 border border-slate-300 rounded-xl bg-slate-50 text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none truncate"
                >
                  <option value="">Client : Passager (Comptant)</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.total_debt && c.total_debt > 0 ? `(Dette: ${c.total_debt.toFixed(1)} DT)` : ''} [{c.type}]
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setIsCreateCustomerOpen(true)}
                className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-700 rounded-xl text-xs font-bold flex items-center gap-1 shrink-0 transition-colors"
                title="Créer un nouveau client"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>+ Client</span>
              </button>
            </div>

            {/* Category Pills */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-lg font-semibold whitespace-nowrap text-xs transition-colors ${
                    selectedCategory === cat
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product Grid Grouped by Family */}
          <div className="flex-1 p-3 overflow-y-auto grid grid-cols-2 gap-2 content-start pb-24">
            {familyGroups.map(group => (
              <div
                key={group.familyKey}
                onClick={() => handleFamilyTileClick(group)}
                className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col justify-between shadow-sm active:bg-slate-50 transition-colors cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase truncate">
                      {group.category}
                    </span>
                    {group.products.length > 1 ? (
                      <span className="text-[10px] font-extrabold bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded border border-emerald-200">
                        {group.products.length} tailles
                      </span>
                    ) : (
                      group.products[0]?.size_label && (
                        <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded">
                          {group.products[0].size_label}
                        </span>
                      )
                    )}
                  </div>
                  <h3 className="text-xs font-bold text-slate-900 line-clamp-2">
                    {group.familyName}
                  </h3>
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-black text-emerald-700 font-mono">
                    {group.products.length > 1 ? `dès ${formatMoney(group.minPrice)}` : formatMoney(group.minPrice)}
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                      group.hasLowStock
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {group.hasLowStock && <AlertTriangle className="w-2.5 h-2.5" />}
                    {group.totalStock}
                  </span>
                </div>
              </div>
            ))}

            {familyGroups.length === 0 && (
              <div className="col-span-full py-16 text-center text-slate-400 text-xs">
                No products found.
              </div>
            )}
          </div>

          {/* Floating Camera Barcode Scan FAB */}
          <button
            onClick={() => {
              setCameraMode('REGISTER');
              setIsCameraOpen(true);
            }}
            className={`fixed ${
              cart.length > 0 ? 'bottom-32' : 'bottom-16'
            } right-4 z-20 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white p-3.5 rounded-full shadow-2xl flex items-center justify-center transition-all border-2 border-white`}
            title="Scan Barcode with Camera"
          >
            <Camera className="w-5 h-5" />
          </button>

          {/* Sticky Bottom Cart Pill (Tap to open full sheet) */}
          {cart.length > 0 && (
            <div
              onClick={() => setIsCartDrawerOpen(true)}
              className="absolute bottom-16 inset-x-3 bg-slate-900 text-white p-3.5 rounded-2xl shadow-xl flex items-center justify-between cursor-pointer active:scale-[0.99] transition-transform z-20"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center font-bold text-xs">
                  {totals.totalPieces}
                </div>
                <div>
                  <span className="text-xs font-bold block">
                    {totals.itemCount} items in cart
                  </span>
                  <span className="text-[10px] text-slate-400">Tap to review & checkout</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-base font-black text-emerald-400 font-mono">
                  {formatMoney(totals.totalTTC)}
                </span>
                <ChevronUp className="w-5 h-5 text-slate-400" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. PRICE LOOKUP TAB */}
      {activeTab === 'LOOKUP' && (
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-sm font-bold text-slate-900 mb-2">Price & Aisle Lookup</h2>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Scan barcode or type name..."
                  value={lookupQuery}
                  onChange={e => handleLookupSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
              <button
                onClick={() => {
                  setCameraMode('LOOKUP');
                  setIsCameraOpen(true);
                }}
                className="px-3 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl flex items-center justify-center shrink-0 text-slate-700"
                title="Scan Barcode with Camera"
              >
                <Camera className="w-5 h-5" />
              </button>
            </div>
          </div>

          {lookupProduct ? (
            <div className="bg-white p-5 rounded-2xl shadow-md border border-emerald-500 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-xs font-bold text-slate-400 uppercase">
                    {lookupProduct.category}
                  </span>
                  <h3 className="text-lg font-black text-slate-900 mt-0.5">
                    {lookupProduct.name}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono mt-1">
                    Barcode: {lookupProduct.barcode || 'N/A'}
                  </p>
                </div>
                {lookupProduct.size_label && (
                  <span className="bg-slate-100 text-slate-800 text-xs font-extrabold px-2 py-1 rounded-lg">
                    {lookupProduct.size_label}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Prix Détail (TTC)</span>
                  <div className="text-xl font-black text-emerald-700 font-mono mt-0.5">
                    {formatMoney(lookupProduct.retail_price)}
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Prix Gros (TTC)</span>
                  <div className="text-xl font-black text-blue-700 font-mono mt-0.5">
                    {formatMoney(lookupProduct.wholesale_price)}
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                <span className="font-bold text-slate-700">Stock en Rayon / Magasin:</span>
                <span className={`font-black font-mono px-2 py-0.5 rounded ${
                  lookupProduct.stock_quantity <= lookupProduct.low_stock_threshold
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {lookupProduct.stock_quantity} {lookupProduct.size_label || 'unités'}
                </span>
              </div>
            </div>
          ) : lookupNotFound && lookupQuery ? (
            <div className="bg-rose-50 border-2 border-rose-200 p-6 rounded-2xl text-center space-y-2 animate-in fade-in">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
              <h3 className="font-bold text-sm text-rose-900">Produit introuvable</h3>
              <p className="text-xs text-rose-700 font-mono">
                "{lookupQuery}" ne correspond à aucun code-barres ou article du catalogue
              </p>
            </div>
          ) : (
            <div className="py-16 text-center text-slate-400 text-xs">
              Scan barcode to view product details instantly without touching cart.
            </div>
          )}
        </div>
      )}

      {/* 3. QUICK-EDIT TAB */}
      {activeTab === 'QUICK_EDIT' && (
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-sm font-bold text-slate-900 mb-2">In-Aisle Price & Stock Quick-Edit</h2>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Scan barcode to edit..."
                  value={editQuery}
                  onChange={e => handleEditSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
              <button
                onClick={() => {
                  setCameraMode('QUICK_EDIT');
                  setIsCameraOpen(true);
                }}
                className="px-3 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl flex items-center justify-center shrink-0 text-slate-700"
                title="Scan Barcode with Camera"
              >
                <Camera className="w-5 h-5" />
              </button>
            </div>
          </div>

          {editProduct && (
            <div className="bg-white p-5 rounded-2xl shadow-md border border-slate-200 space-y-4">
              <h3 className="font-bold text-slate-900 text-sm">{editProduct.name}</h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Prix Détail (TTC en DT)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={editRetailPrice}
                    onChange={e => setEditRetailPrice(e.target.value)}
                    className="w-full text-base font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Prix Gros (TTC en DT)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={editWholesalePrice}
                    onChange={e => setEditWholesalePrice(e.target.value)}
                    className="w-full text-base font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Stock en Magasin
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={editStock}
                    onChange={e => setEditStock(e.target.value)}
                    className="w-full text-base font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {editSuccessMsg && (
                <div className="p-2.5 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  <span>{editSuccessMsg}</span>
                </div>
              )}

              <button
                onClick={handleSaveQuickEdit}
                disabled={isSubmittingQuickEdit}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl shadow text-sm transition-colors"
              >
                {isSubmittingQuickEdit ? 'Saving...' : 'Save & Update'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 4. CUSTOMERS & DEBT TAB */}
      {activeTab === 'CUSTOMERS' && (
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-slate-900">Customers & Debt Ledger</h2>
              <button
                onClick={() => setIsCreateCustomerOpen(true)}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-sm transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>+ Client</span>
              </button>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search customers..."
                value={custSearch}
                onChange={e => setCustSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-2.5">
            {customers
              .filter(c => c.name.toLowerCase().includes(custSearch.toLowerCase()))
              .map(customer => {
                const hasDebt = (customer.total_debt || 0) > 0;
                return (
                  <div
                    key={customer.id}
                    className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm">{customer.name}</h3>
                        <span className="text-[10px] font-bold text-slate-500 uppercase">
                          Tier: {customer.type}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block font-semibold">Total Dû:</span>
                        <span className={`text-base font-black font-mono ${hasDebt ? 'text-amber-700' : 'text-slate-400'}`}>
                          {formatMoney(customer.total_debt)}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2 border-t border-slate-100">
                      <div className="flex-1 flex gap-1">
                        <input
                          type="number"
                          step="0.001"
                          placeholder="Montant DT"
                          value={selectedCustDetails?.id === customer.id ? paymentAmount : ''}
                          onChange={e => {
                            setSelectedCustDetails(customer);
                            setPaymentAmount(e.target.value);
                          }}
                          className="w-full text-xs font-mono font-bold px-2 py-1.5 border border-slate-300 rounded-lg focus:outline-none"
                        />
                        <button
                          disabled={isSubmittingPayment}
                          onClick={() => handleRecordCustomerPayment(customer)}
                          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg text-xs shrink-0 transition-colors"
                        >
                          {isSubmittingPayment && selectedCustDetails?.id === customer.id ? 'Paiement...' : 'Payer (FIFO)'}
                        </button>
                      </div>

                      <button
                        onClick={() => {
                          setSelectedCustDetails(customer);
                          setIsContainerModalOpen(true);
                        }}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-1.5 rounded-lg text-xs shrink-0"
                      >
                        Bidons
                      </button>
                    </div>

                    {paymentMsg && selectedCustDetails?.id === customer.id && (
                      <p className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 p-2 rounded-lg">
                        {paymentMsg}
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* PULL-UP BOTTOM SHEET CART DRAWER */}
      {isCartDrawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex flex-col justify-end">
          <div className="bg-white rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200">
            {/* Drawer Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm">Shopping Cart ({totals.itemCount} items)</h3>
                <p className="text-xs text-slate-400">
                  {selectedCustomer ? selectedCustomer.name : 'Walk-in Retail'}
                </p>
              </div>
              <button
                onClick={() => setIsCartDrawerOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Cart Items List */}
            <div className="p-4 flex-1 overflow-y-auto divide-y divide-slate-100">
              {cart.map(item => (
                <div key={item.cart_item_id} className="py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-xs text-slate-900 truncate">{item.name}</h4>
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
                          <span className="bg-slate-100 px-1 rounded font-semibold text-slate-600">
                            {item.size_label}
                          </span>
                        )}
                        {(() => {
                          const prod = products.find(p => p.id === item.product_id);
                          if (!prod?.pack_sizes || prod.pack_sizes.length === 0) {
                            return item.pack_multiplier > 1 ? (
                              <span className="text-blue-600 font-semibold bg-blue-50 px-1 rounded">{item.pack_label || `x${item.pack_multiplier} pcs`}</span>
                            ) : null;
                          }
                          return (
                            <select
                              value={item.selected_pack_size_id || 'base'}
                              onChange={e => {
                                const selectedId = e.target.value;
                                if (selectedId === 'base') {
                                  const unitPrice = getProductPackPrice(prod, selectedCustomer, null, 1);
                                  setCart(prev => prev.map(i => i.cart_item_id === item.cart_item_id ? {
                                    ...i,
                                    pack_multiplier: 1,
                                    selected_pack_size_id: undefined,
                                    pack_label: undefined,
                                    unit_price: unitPrice
                                  } : i));
                                } else {
                                  const ps = prod.pack_sizes?.find(s => s.id === selectedId);
                                  if (ps) {
                                    const unitPrice = getProductPackPrice(prod, selectedCustomer, ps, ps.multiplier);
                                    setCart(prev => prev.map(i => i.cart_item_id === item.cart_item_id ? {
                                      ...i,
                                      pack_multiplier: ps.multiplier,
                                      selected_pack_size_id: ps.id,
                                      pack_label: ps.pack_label,
                                      unit_price: unitPrice
                                    } : i));
                                  }
                                }
                              }}
                              className="text-[9px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1 py-0.2 outline-none cursor-pointer"
                            >
                              <option value="base">Unité (1 pc)</option>
                              {prod.pack_sizes.map(ps => (
                                <option key={ps.id} value={ps.id}>
                                  {ps.pack_label || `Pack x${ps.multiplier}`}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Quantity Stepper */}
                    <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-slate-50 shrink-0">
                      <button
                        onClick={() => handleUpdateQuantity(item.cart_item_id, Math.max(0, item.quantity - 1))}
                        className="px-2 py-0.5 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                      >
                        -
                      </button>
                      <BufferedNumberInput
                        step="0.001"
                        min={0.001}
                        disallowZero={true}
                        value={item.quantity}
                        onCommit={val => handleUpdateQuantity(item.cart_item_id, val)}
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
                    <div className="text-right flex items-center gap-2 shrink-0">
                      <div className="flex flex-col items-end">
                        {(item.discount_amount || 0) > 0 && (
                          <span className="text-[10px] line-through text-slate-400 font-mono">
                            {formatMoney(item.unit_price * item.quantity)}
                          </span>
                        )}
                        <span className="font-mono text-xs font-bold text-slate-900">
                          {formatMoney(Math.max(0, (item.unit_price * item.quantity) - (item.discount_amount || 0)))}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          setCart(prev => prev.filter(i => i.cart_item_id !== item.cart_item_id))
                        }
                        className="text-slate-300 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Container Loan Toggle & Discount Button */}
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
                          title={item.loan_container ? "Consigne prêtée (enregistrée au compte client)" : "Emballage client (pas de prêt consigne)"}
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

                  {/* Line Discount Input Editor */}
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
            </div>

            {/* Drawer Footer & Checkout */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
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
                <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-amber-900 font-semibold">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Caisse fermée — Session requise</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCartDrawerOpen(false);
                      if (onOpenSessionModal) onOpenSessionModal();
                    }}
                    className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-2.5 py-1 rounded-lg text-xs transition-colors shadow-xs"
                  >
                    Ouvrir
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  if (!activeSession || activeSession.status !== 'OPEN') {
                    setIsCartDrawerOpen(false);
                    if (onOpenSessionModal) onOpenSessionModal();
                    return;
                  }
                  setIsCartDrawerOpen(false);
                  setIsCheckoutOpen(true);
                }}
                className={`w-full py-3.5 text-white font-black rounded-xl text-sm shadow-lg transition-colors ${
                  !activeSession
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {!activeSession ? 'Ouvrir la caisse pour encaisser' : 'Tender Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Container Loan Give/Return Modal */}
      {isContainerModalOpen && selectedCustDetails && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Returnable Containers — {selectedCustDetails.name}
            </h3>

            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setContainerAction('GIVE')}
                className={`py-1.5 rounded-lg text-xs font-bold ${
                  containerAction === 'GIVE' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600'
                }`}
              >
                GIVE (Prêt)
              </button>
              <button
                type="button"
                onClick={() => setContainerAction('RETURN')}
                className={`py-1.5 rounded-lg text-xs font-bold ${
                  containerAction === 'RETURN' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'
                }`}
              >
                RETURN (Retour)
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Container Type</label>
              <select
                value={selectedContainerTypeId}
                onChange={e => setSelectedContainerTypeId(e.target.value)}
                className="w-full text-xs font-semibold px-2.5 py-2 border border-slate-300 rounded-xl"
              >
                <option value="">Select container type...</option>
                {containerTypes.map(ct => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name} (Shop Stock: {ct.stock_quantity})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                value={containerQty}
                onChange={e => setContainerQty(e.target.value)}
                className="w-full text-sm font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl"
              />
            </div>

            {containerError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
                {containerError}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsContainerModalOpen(false);
                  setContainerError(null);
                }}
                className="flex-1 py-2 bg-slate-100 font-bold rounded-xl text-xs text-slate-700 hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingContainer}
                onClick={handleContainerTransaction}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 font-bold rounded-xl text-xs text-white transition-colors"
              >
                {isSubmittingContainer ? 'Enregistrement...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout Modal */}
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
          const payload = {
            customer_id: selectedCustomer?.id || null,
            items: cart.map(item => ({
              product_id: item.product_id || null,
              pack_size_id: item.selected_pack_size_id || null,
              description: item.name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              pack_multiplier: item.pack_multiplier || 1,
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
          const result = await onProcessSale(payload);
          onRefreshData();
          return result;
        }}
        onPrintReceipt={onPrintReceipt}
        onPrintInvoice={onPrintInvoice}
      />

      {/* Family Sizes Selection Modal */}
      <FamilySizesModal
        isOpen={familyModalData.isOpen}
        onClose={() => setFamilyModalData({ isOpen: false, familyName: '', products: [] })}
        familyName={familyModalData.familyName}
        products={familyModalData.products}
        customer={selectedCustomer}
        onSelectProduct={(prod, mult, lbl, ps) => addProductToCart(prod, mult, lbl, ps)}
      />

      {/* Camera Barcode Scanner Viewfinder Modal */}
      <CameraScannerModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onScan={handleCameraScan}
      />

      {/* Quick-Add Uncataloged Item */}
      <QuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        onAddItem={item => setCart(prev => [...prev, item])}
      />

      {/* Refund and Returns Modal */}
      <RefundModal
        isOpen={isRefundOpen}
        onClose={() => setIsRefundOpen(false)}
        onRefundCompleted={onRefreshData}
        activeSessionId={activeSession?.id || null}
      />

      {/* Create Customer Modal */}
      <CreateCustomerModal
        isOpen={isCreateCustomerOpen}
        onClose={() => setIsCreateCustomerOpen(false)}
        onSuccess={() => {
          setIsCreateCustomerOpen(false);
          onRefreshData();
        }}
      />

      {/* FIXED BOTTOM NAVIGATION BAR (4 TABS) */}
      <nav className="fixed bottom-0 inset-x-0 bg-slate-900 border-t border-slate-800 flex items-center justify-around py-2 px-1 z-30 select-none">
        <button
          onClick={() => setActiveTab('REGISTER')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg text-[10px] font-bold transition-colors ${
            activeTab === 'REGISTER' ? 'text-emerald-400' : 'text-slate-400 hover:text-white'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>Register</span>
        </button>

        <button
          onClick={() => setActiveTab('LOOKUP')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg text-[10px] font-bold transition-colors ${
            activeTab === 'LOOKUP' ? 'text-emerald-400' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Search className="w-4 h-4" />
          <span>Lookup</span>
        </button>

        <button
          onClick={() => setActiveTab('QUICK_EDIT')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg text-[10px] font-bold transition-colors ${
            activeTab === 'QUICK_EDIT' ? 'text-emerald-400' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Edit3 className="w-4 h-4" />
          <span>Quick-Edit</span>
        </button>

        <button
          onClick={() => setActiveTab('CUSTOMERS')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg text-[10px] font-bold transition-colors ${
            activeTab === 'CUSTOMERS' ? 'text-emerald-400' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Customers</span>
        </button>
      </nav>
    </div>
  );
};
