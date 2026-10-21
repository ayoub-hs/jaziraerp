import React, { useState, useEffect, useRef } from 'react';
import { 
  Package, 
  FlaskConical, 
  Layers, 
  Users, 
  Truck, 
  Box, 
  History, 
  TrendingUp, 
  Plus, 
  AlertTriangle, 
  Check, 
  Search, 
  DollarSign, 
  Printer, 
  Download,
  Calendar,
  CreditCard,
  Wallet,
  Database,
  Scale,
  Receipt,
  ArrowUpRight,
  ArrowDownLeft,
  Edit2,
  Eye,
  FileText,
  Trash2,
  Settings,
  BarChart3,
  Calculator,
  X
} from 'lucide-react';
import type { 
  Product, 
  ProductFamily, 
  Customer, 
  Supplier, 
  ContainerType, 
  CustomerContainerLoan, 
  ContainerTransaction, 
  RawMaterial, 
  Formulation, 
  RegisterSession, 
  DebtTicket, 
  SupplierDebtTicket 
} from '../../types/index.js';
import { formatMoney, formatDate, formatDateTime } from '../../utils/formatters.js';
import { BarcodeLabelPrinter } from './BarcodeLabelPrinter.js';
import { BackupManager } from './BackupManager.js';
import { CreateProductModal } from './CreateProductModal.js';
import { BatchCostBackfillModal } from './BatchCostBackfillModal.js';
import { CreateMaterialModal } from './CreateMaterialModal.js';
import { MaterialPriceHistoryModal } from './MaterialPriceHistoryModal.js';
import { CreateFormulationModal } from './CreateFormulationModal.js';
import { CreateCustomerModal } from './CreateCustomerModal.js';
import { CreateSupplierModal } from './CreateSupplierModal.js';
import { CreateContainerModal } from './CreateContainerModal.js';
import { ContainerTransactionModal } from './ContainerTransactionModal.js';
import { InventoryAdjustmentModal } from './InventoryAdjustmentModal.js';
import { CreateExpenseModal } from './CreateExpenseModal.js';
import { CreatePurchaseModal } from './CreatePurchaseModal.js';
import { ConfirmDeleteModal } from './ConfirmDeleteModal.js';
import { ManageCategoriesModal } from './ManageCategoriesModal.js';
import { ReportsTab } from './ReportsTab.js';
import { ShopSettingsPanel } from './ShopSettingsPanel.js';
import { SalesHistoryTab } from './SalesHistoryTab.js';
import { CustomerStatementModal } from './CustomerStatementModal.js';
import { PurchaseDetailModal } from './PurchaseDetailModal.js';
import { BatchDetailModal } from './BatchDetailModal.js';
import { printZReportThermal } from '../../services/hardware/zReportPrinter.js';
import { useRequestKey } from '../../hooks/useRequestKey.js';
import type { ZReportSessionData } from '../../services/hardware/escpos.js';

interface BackofficeProps {
  products: Product[];
  families: ProductFamily[];
  customers: Customer[];
  containerTypes: ContainerType[];
  onRefreshData: () => void;
  activeSession?: RegisterSession | null;
  onPrintReceipt?: (saleId: string) => void;
  onPrintInvoice?: (saleId: string) => void;
  onPrintDeliveryNote?: (saleId: string) => void;
}

type BackofficeTab = 
  | 'SALES'
  | 'CATALOG' 
  | 'MATERIALS' 
  | 'PRODUCTION' 
  | 'CUSTOMERS' 
  | 'SUPPLIERS' 
  | 'CONTAINERS' 
  | 'SESSIONS' 
  | 'ACCOUNTING'
  | 'REPORTS'
  | 'BACKUPS'
  | 'SETTINGS';

export const Backoffice: React.FC<BackofficeProps> = ({
  products,
  families,
  customers,
  containerTypes,
  onRefreshData,
  activeSession,
  onPrintReceipt,
  onPrintInvoice,
  onPrintDeliveryNote
}) => {
  const customerPaymentKey = useRequestKey();
  const supplierPaymentKey = useRequestKey();
  const [activeTab, setActiveTab] = useState<BackofficeTab>('CATALOG');

  // Module states
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sessions, setSessions] = useState<RegisterSession[]>([]);
  const [accountingData, setAccountingData] = useState<any>(null);

  // New Creation & Adjustment Modals
  const [isCreateProductOpen, setIsCreateProductOpen] = useState(false);
  const [isCreateMaterialOpen, setIsCreateMaterialOpen] = useState(false);
  const [isCreateFormulationOpen, setIsCreateFormulationOpen] = useState(false);
  const [isCreateCustomerOpen, setIsCreateCustomerOpen] = useState(false);
  const [isCreateSupplierOpen, setIsCreateSupplierOpen] = useState(false);
  const [isCreateContainerOpen, setIsCreateContainerOpen] = useState(false);
  const [isContainerTxOpen, setIsContainerTxOpen] = useState(false);
  const [containerTxInitialAction, setContainerTxInitialAction] = useState<'GIVE' | 'RETURN'>('GIVE');
  const [containerTxInitialCustomerId, setContainerTxInitialCustomerId] = useState<string | null>(null);
  const [containerTxInitialContainerTypeId, setContainerTxInitialContainerTypeId] = useState<string | null>(null);
  const [customerContainerLoans, setCustomerContainerLoans] = useState<CustomerContainerLoan[]>([]);
  const [containerTransactions, setContainerTransactions] = useState<ContainerTransaction[]>([]);
  const [isInventoryAdjustmentOpen, setIsInventoryAdjustmentOpen] = useState(false);
  const [inventoryAdjDefaultType, setInventoryAdjDefaultType] = useState<'PRODUCT' | 'RAW_MATERIAL'>('PRODUCT');
  const [isCreateExpenseOpen, setIsCreateExpenseOpen] = useState(false);
  const [isCategoriesModalOpen, setIsCategoriesModalOpen] = useState(false);

  // Modals & Wizards
  const [isBarcodeLabelModalOpen, setIsBarcodeLabelModalOpen] = useState(false);
  const [isBatchCostModalOpen, setIsBatchCostModalOpen] = useState(false);
  const [selectedFormulationId, setSelectedFormulationId] = useState('');
  const [batchVolume, setBatchVolume] = useState('100');
  const [targetProductId, setTargetProductId] = useState('');
  const [unitsProduced, setUnitsProduced] = useState('100');
  const [batchResult, setBatchResult] = useState<any>(null);

  // Supplier Payment / Purchase state
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [purchaseDetailId, setPurchaseDetailId] = useState<string | null>(null);

  // Customer debt payment & top-up
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerTickets, setCustomerTickets] = useState<DebtTicket[]>([]);
  const [debtPayAmount, setDebtPayAmount] = useState('');
  const [walletTopUpAmount, setWalletTopUpAmount] = useState('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isPayingCustomerDebt, setIsPayingCustomerDebt] = useState(false);
  const isPayingCustomerDebtRef = useRef(false);
  const [isToppingUpWallet, setIsToppingUpWallet] = useState(false);
  const isToppingUpWalletRef = useRef(false);
  const [isCustomerStatementOpen, setIsCustomerStatementOpen] = useState(false);

  // Supplier ledger drill-down & debt payment
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierTickets, setSupplierTickets] = useState<SupplierDebtTicket[]>([]);
  const [supplierDebtPayAmount, setSupplierDebtPayAmount] = useState('');
  const [supplierActionNotice, setSupplierActionNotice] = useState<string | null>(null);
  const [isPayingSupplierDebt, setIsPayingSupplierDebt] = useState(false);
  const isPayingSupplierDebtRef = useRef(false);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);

  // Batch Wizard state
  const [isExecutingBatch, setIsExecutingBatch] = useState(false);
  const isExecutingBatchRef = useRef(false);

  // Edit states for CRUD modals (Section C)
  const [materialToEdit, setMaterialToEdit] = useState<RawMaterial | null>(null);
  const [materialForPriceHistory, setMaterialForPriceHistory] = useState<RawMaterial | null>(null);
  const [familyToEdit, setFamilyToEdit] = useState<ProductFamily | null>(null);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [supplierToEdit, setSupplierToEdit] = useState<Supplier | null>(null);
  const [containerTypeToEdit, setContainerTypeToEdit] = useState<ContainerType | null>(null);
  const [formulationToEdit, setFormulationToEdit] = useState<Formulation | null>(null);

  // History / Audit states (Section D)
  const [productionBatches, setProductionBatches] = useState<any[]>([]);
  const [batchDetailId, setBatchDetailId] = useState<string | null>(null);
  const [purchasesHistory, setPurchasesHistory] = useState<any[]>([]);
  const [expensesHistory, setExpensesHistory] = useState<any[]>([]);
  const [inventoryAdjustments, setInventoryAdjustments] = useState<any[]>([]);
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<any | null>(null);
  const [isSessionDetailOpen, setIsSessionDetailOpen] = useState(false);

  // Inactive Catalog toggle
  const [showInactiveCatalog, setShowInactiveCatalog] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[] | null>(null);
  const [allFamilies, setAllFamilies] = useState<ProductFamily[] | null>(null);

  const fetchCatalogAll = async () => {
    try {
      const [pRes, fRes] = await Promise.all([
        fetch('/api/products?active=all'),
        fetch('/api/products/families?active=all')
      ]);
      if (pRes.ok) setAllProducts(await pRes.json());
      if (fRes.ok) setAllFamilies(await fRes.json());
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (showInactiveCatalog) {
      fetchCatalogAll();
    } else {
      setAllProducts(null);
      setAllFamilies(null);
    }
  }, [showInactiveCatalog]);

  // Search & Low Stock Filter States (Item 4)
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogLowStockOnly, setCatalogLowStockOnly] = useState(false);
  const [materialsSearch, setMaterialsSearch] = useState('');
  const [materialsLowStockOnly, setMaterialsLowStockOnly] = useState(false);
  const [customersSearch, setCustomersSearch] = useState('');
  const [customersOverdueOnly, setCustomersOverdueOnly] = useState(false);
  const [suppliersSearch, setSuppliersSearch] = useState('');
  const [purchasesSearch, setPurchasesSearch] = useState('');
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false);

  // Persistent Counters Management
  const [counters, setCounters] = useState<{ id: string; name: string; is_active: number; created_at: string }[]>([]);
  const [isCountersModalOpen, setIsCountersModalOpen] = useState(false);
  const [newCounterName, setNewCounterName] = useState('');
  const [counterError, setCounterError] = useState<string | null>(null);

  const loadCounters = async () => {
    try {
      const res = await fetch('/api/register/counters?active=all');
      if (res.ok) {
        setCounters(await res.json());
      }
    } catch (err) {
      console.warn('Failed to load counters:', err);
    }
  };

  useEffect(() => {
    loadBackofficeData();
  }, [activeTab]);

  // Synchronize selected customer when customers list is refreshed
  useEffect(() => {
    if (selectedCustomer) {
      const fresh = customers.find(c => c.id === selectedCustomer.id);
      if (fresh) {
        setSelectedCustomer(fresh);
      }
    }
  }, [customers]);

  // Initial preload of reference data for modal pickers
  useEffect(() => {
    const fetchCommon = async () => {
      try {
        const [matRes, formRes, supRes] = await Promise.all([
          fetch('/api/materials'),
          fetch('/api/formulations'),
          fetch('/api/suppliers')
        ]);
        if (matRes.ok) setMaterials(await matRes.json());
        if (formRes.ok) setFormulations(await formRes.json());
        if (supRes.ok) setSuppliers(await supRes.json());
      } catch (err) {
        console.warn('Failed to preload reference data:', err);
      }
    };
    fetchCommon();
  }, []);

  const loadBackofficeData = async () => {
    try {
      if (activeTab === 'MATERIALS' || activeTab === 'PRODUCTION' || activeTab === 'CATALOG') {
        if (showInactiveCatalog) {
          fetchCatalogAll();
        }
        const [matRes, formRes, supRes, adjRes] = await Promise.all([
          fetch('/api/materials'),
          fetch('/api/formulations'),
          fetch('/api/suppliers'),
          fetch('/api/inventory/adjustments')
        ]);
        if (matRes.ok) setMaterials(await matRes.json());
        if (formRes.ok) setFormulations(await formRes.json());
        if (supRes.ok) setSuppliers(await supRes.json());
        if (adjRes.ok) setInventoryAdjustments(await adjRes.json());
      }
      if (activeTab === 'PRODUCTION') {
        const [batchRes, formRes] = await Promise.all([
          fetch('/api/production/batches'),
          fetch('/api/formulations')
        ]);
        if (batchRes.ok) setProductionBatches(await batchRes.json());
        if (formRes.ok) setFormulations(await formRes.json());
      }
      if (activeTab === 'SUPPLIERS') {
        const [supRes, purRes, matRes] = await Promise.all([
          fetch('/api/suppliers'),
          fetch('/api/purchases'),
          fetch('/api/materials')
        ]);
        if (supRes.ok) {
          const loadedSuppliers = await supRes.json();
          setSuppliers(loadedSuppliers);
          if (selectedSupplier) {
            const updated = loadedSuppliers.find((s: Supplier) => s.id === selectedSupplier.id);
            if (updated) setSelectedSupplier(updated);
          }
        }
        if (purRes.ok) setPurchasesHistory(await purRes.json());
        if (matRes.ok) setMaterials(await matRes.json());
      }
      if (activeTab === 'CONTAINERS') {
        const [loansRes, txsRes] = await Promise.all([
          fetch('/api/containers/loans'),
          fetch('/api/containers/transactions')
        ]);
        if (loansRes.ok) setCustomerContainerLoans(await loansRes.json());
        if (txsRes.ok) setContainerTransactions(await txsRes.json());
      }
      if (activeTab === 'SESSIONS') {
        const sesRes = await fetch('/api/register/sessions');
        if (sesRes.ok) setSessions(await sesRes.json());
        loadCounters();
      }
      if (activeTab === 'ACCOUNTING') {
        const [cfRes, svRes, matRes, expRes] = await Promise.all([
          fetch('/api/accounting/cash-flow'),
          fetch('/api/accounting/stock-valuation'),
          fetch('/api/materials'),
          fetch('/api/accounting/expenses')
        ]);
        const cf = cfRes.ok ? await cfRes.json() : null;
        const sv = svRes.ok ? await svRes.json() : null;
        if (matRes.ok) setMaterials(await matRes.json());
        if (expRes.ok) setExpensesHistory(await expRes.json());
        setAccountingData({ cashFlow: cf, stockValuation: sv });
      }
    } catch (err) {
      console.warn('Error loading backoffice data:', err);
    }
  };

  const handleOpenSessionDetail = async (session: RegisterSession) => {
    setLoadingSessionDetail(true);
    setIsSessionDetailOpen(true);
    setSelectedSessionDetail(null);
    try {
      const res = await fetch(`/api/register/sessions/${session.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedSessionDetail(data);
      }
    } catch (err) {
      console.warn('Failed to load session detail:', err);
    } finally {
      setLoadingSessionDetail(false);
    }
  };

  const handlePrintZReport = async (session: any) => {
    if (!session || !session.id) return;
    try {
      const res = await fetch(`/api/register/sessions/${session.id}`);
      if (res.ok) {
        const data = await res.json();
        const zData: ZReportSessionData = {
          session_number: data.session?.session_number || data.session_number,
          counter_name: data.session?.counter_name || data.counter_name,
          opened_at: data.session?.opened_at || data.opened_at,
          closed_at: data.session?.closed_at || data.closed_at,
          opening_cash: data.live_cash_breakdown?.opening_cash ?? data.session?.opening_cash ?? data.opening_cash ?? 0,
          cash_sales: data.live_cash_breakdown?.cash_sales ?? data.cash_sales ?? 0,
          cash_refunds: data.live_cash_breakdown?.cash_refunds ?? data.cash_refunds ?? 0,
          net_sales_cash: data.live_cash_breakdown?.net_sales_cash,
          cash_in: data.live_cash_breakdown?.cash_in ?? data.cash_in ?? 0,
          cash_out: data.live_cash_breakdown?.cash_out ?? data.cash_out ?? 0,
          expected_cash: data.live_cash_breakdown?.expected_cash ?? data.session?.expected_cash ?? data.expected_cash ?? 0,
          closing_cash_counted: data.session?.closing_cash_counted ?? data.closing_cash_counted ?? data.session?.counted_cash ?? data.counted_cash,
          counted_cash: data.session?.closing_cash_counted ?? data.closing_cash_counted ?? data.session?.counted_cash ?? data.counted_cash,
          variance: data.session?.variance ?? data.variance ?? data.session?.difference ?? data.difference,
          difference: data.session?.variance ?? data.variance ?? data.session?.difference ?? data.difference,
          movements: data.movements || []
        };
        await printZReportThermal(zData);
      }
    } catch (err) {
      console.warn('Failed to print Z-report:', err);
    }
  };

  const handleSelectSupplierForTickets = async (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setSupplierActionNotice(null);
    try {
      const res = await fetch(`/api/suppliers/${supplier.id}/tickets`);
      if (res.ok) {
        setSupplierTickets(await res.json());
      }
    } catch (err) {
      console.warn('Failed to load supplier tickets:', err);
    }
  };

  const handlePaySupplierDebt = async () => {
    if (isPayingSupplierDebtRef.current) return;
    if (!selectedSupplier) return;
    const amount = parseFloat(supplierDebtPayAmount);
    if (isNaN(amount) || amount <= 0) return;

    isPayingSupplierDebtRef.current = true;
    setIsPayingSupplierDebt(true);
    setSupplierActionNotice(null);
    try {
      const clientRequestId = supplierPaymentKey.keyFor(JSON.stringify({
        supplier_id: selectedSupplier.id,
        amount
      }));
      const res = await fetch(`/api/suppliers/${selectedSupplier.id}/debt/repay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, client_request_id: clientRequestId })
      });
      if (res.ok) {
        supplierPaymentKey.clear();
        setSupplierActionNotice(`Paiement de dette de ${formatMoney(amount)} enregistré pour ${selectedSupplier.name}.`);
        setSupplierDebtPayAmount('');
        handleSelectSupplierForTickets(selectedSupplier);
        const supRes = await fetch('/api/suppliers');
        if (supRes.ok) {
          const supList = await supRes.json();
          setSuppliers(supList);
          const updated = supList.find((s: Supplier) => s.id === selectedSupplier.id);
          if (updated) setSelectedSupplier(updated);
        }
        onRefreshData();
      } else {
        const data = await res.json().catch(() => ({}));
        setSupplierActionNotice(`Erreur : ${data.error || `Échec du paiement (${res.status})`}`);
      }
    } catch (err: any) {
      console.warn('Supplier debt payment failed:', err);
      setSupplierActionNotice(`Erreur : ${err.message || 'Échec du paiement'}`);
    } finally {
      isPayingSupplierDebtRef.current = false;
      setIsPayingSupplierDebt(false);
    }
  };

  const handleSelectCustomerForTickets = async (customer: Customer) => {
    setSelectedCustomer(customer);
    try {
      const res = await fetch(`/api/customers/${customer.id}/tickets`);
      if (res.ok) {
        setCustomerTickets(await res.json());
      }
    } catch (err) {
      console.warn('Failed to load customer tickets:', err);
    }
  };

  const handlePayCustomerDebt = async () => {
    if (isPayingCustomerDebtRef.current) return;
    if (!selectedCustomer) return;
    const amount = parseFloat(debtPayAmount);
    if (isNaN(amount) || amount <= 0) return;

    isPayingCustomerDebtRef.current = true;
    setIsPayingCustomerDebt(true);
    setActionNotice(null);
    try {
      const clientRequestId = customerPaymentKey.keyFor(JSON.stringify({
        customer_id: selectedCustomer.id,
        amount
      }));
      const res = await fetch(`/api/customers/${selectedCustomer.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, client_request_id: clientRequestId })
      });
      if (res.ok) {
        customerPaymentKey.clear();
        setActionNotice(`Règlement de dette de ${formatMoney(amount)} enregistré.`);
        setDebtPayAmount('');
        handleSelectCustomerForTickets(selectedCustomer);
        onRefreshData();
      } else {
        const data = await res.json().catch(() => ({}));
        setActionNotice(`Erreur : ${data.error || `Échec du paiement (${res.status})`}`);
      }
    } catch (err: any) {
      console.warn('Payment failed:', err);
      setActionNotice(`Erreur : ${err.message || 'Échec du paiement'}`);
    } finally {
      isPayingCustomerDebtRef.current = false;
      setIsPayingCustomerDebt(false);
    }
  };

  const handleTopUpWallet = async () => {
    if (isToppingUpWalletRef.current) return;
    if (!selectedCustomer) return;
    const amount = parseFloat(walletTopUpAmount);
    if (isNaN(amount) || amount <= 0) return;

    isToppingUpWalletRef.current = true;
    setIsToppingUpWallet(true);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}/wallet/top-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      if (res.ok) {
        setActionNotice(`Portefeuille rechargé de ${formatMoney(amount)}.`);
        setWalletTopUpAmount('');
        onRefreshData();
      } else {
        const data = await res.json().catch(() => ({}));
        setActionNotice(`Erreur : ${data.error || `Échec de la recharge (${res.status})`}`);
      }
    } catch (err: any) {
      console.warn('Topup failed:', err);
      setActionNotice(`Erreur : ${err.message || 'Échec de la recharge'}`);
    } finally {
      isToppingUpWalletRef.current = false;
      setIsToppingUpWallet(false);
    }
  };

  const handleRunBatchWizard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isExecutingBatchRef.current) return;
    if (!selectedFormulationId || !targetProductId) return;

    isExecutingBatchRef.current = true;
    setIsExecutingBatch(true);
    try {
      const res = await fetch('/api/production/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formulation_id: selectedFormulationId,
          target_product_id: targetProductId,
          batch_volume: parseFloat(batchVolume),
          batch_volume_liters: parseFloat(batchVolume),
          units_produced: parseFloat(unitsProduced)
        })
      });
      if (res.ok) {
        const data = await res.json();
        setBatchResult(data);
        onRefreshData();
        loadBackofficeData();
      } else {
        const data = await res.json().catch(() => ({}));
        setBatchResult({ error: data.error || `Échec de l'exécution du lot (${res.status})` });
      }
    } catch (err: any) {
      console.warn('Batch wizard failed:', err);
      setBatchResult({ error: err.message || "Échec de l'exécution du lot" });
    } finally {
      isExecutingBatchRef.current = false;
      setIsExecutingBatch(false);
    }
  };

  // Delete Confirmation State & Handlers
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    itemName?: string;
    onConfirm: () => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    onConfirm: async () => {}
  });

  const confirmDelete = (opts: {
    title: string;
    itemName: string;
    message?: string;
    onConfirm: () => Promise<void>;
  }) => {
    setDeleteModalState({
      isOpen: true,
      title: opts.title,
      itemName: opts.itemName,
      message: opts.message,
      onConfirm: opts.onConfirm
    });
  };

  const handleDeleteProduct = (prod: Product) => {
    confirmDelete({
      title: 'Supprimer l\'Article',
      itemName: prod.name,
      message: `Êtes-vous sûr de vouloir supprimer "${prod.name}" ? S'il est référencé dans des ventes, lots, achats ou ajustements passés, la suppression sera refusée.`,
      onConfirm: async () => {
        const res = await fetch(`/api/products/${prod.id}`, { method: 'DELETE' });
        if (!res.ok) {
          if (res.status === 409) {
            throw new Error('Impossible de supprimer: déjà référencé. Désactivez-le plutôt.');
          }
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression de l\'article');
        }
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteFamily = (fam: ProductFamily) => {
    confirmDelete({
      title: 'Supprimer la Famille de Produits',
      itemName: fam.name,
      message: `Êtes-vous sûr de vouloir supprimer la famille "${fam.name}" ? Une famille contenant des articles existants ne peut pas être supprimée (désactivez-la plutôt).`,
      onConfirm: async () => {
        const res = await fetch(`/api/products/families/${fam.id}`, { method: 'DELETE' });
        if (!res.ok) {
          if (res.status === 409) {
            throw new Error('Impossible de supprimer: cette famille contient des articles existants. Désactivez-la plutôt.');
          }
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression de la famille');
        }
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteMaterial = (mat: RawMaterial) => {
    confirmDelete({
      title: 'Supprimer la Matière Première',
      itemName: mat.name,
      message: `Êtes-vous sûr de vouloir supprimer "${mat.name}" ? Si elle est utilisée dans des formulations, lots, achats ou ajustements, la suppression sera refusée.`,
      onConfirm: async () => {
        const res = await fetch(`/api/materials/${mat.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression de la matière première');
        }
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteCustomer = (cust: Customer) => {
    confirmDelete({
      title: 'Supprimer le Client',
      itemName: cust.name,
      message: `Êtes-vous sûr de vouloir supprimer le client "${cust.name}" ? S'il a des ventes, billets de dette ou consignes passés, il sera désactivé en toute sécurité.`,
      onConfirm: async () => {
        const res = await fetch(`/api/customers/${cust.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression du client');
        }
        if (selectedCustomer?.id === cust.id) setSelectedCustomer(null);
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteSupplier = (sup: Supplier) => {
    confirmDelete({
      title: 'Supprimer le Fournisseur',
      itemName: sup.name,
      message: `Êtes-vous sûr de vouloir supprimer le fournisseur "${sup.name}" ? S'il a des factures d'achat ou des dettes ouvertes, il sera désactivé en toute sécurité.`,
      onConfirm: async () => {
        const res = await fetch(`/api/suppliers/${sup.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression du fournisseur');
        }
        if (selectedSupplier?.id === sup.id) setSelectedSupplier(null);
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteContainerType = (ct: ContainerType) => {
    confirmDelete({
      title: 'Supprimer le Type de Contenant',
      itemName: ct.name,
      message: `Êtes-vous sûr de vouloir supprimer "${ct.name}" ? S'il est actuellement prêté ou lié à des produits, il sera désactivé en toute sécurité.`,
      onConfirm: async () => {
        const res = await fetch(`/api/containers/types/${ct.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression du type de contenant');
        }
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteExpense = (exp: any) => {
    confirmDelete({
      title: 'Supprimer la Dépense',
      itemName: `${exp.category} (${formatMoney(exp.amount)})`,
      message: `Êtes-vous sûr de vouloir supprimer cette dépense de ${formatMoney(exp.amount)} ?`,
      onConfirm: async () => {
        const res = await fetch(`/api/accounting/expenses/${exp.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression de la dépense');
        }
        loadBackofficeData();
      }
    });
  };

  const handleDeleteAdjustment = (adj: any) => {
    confirmDelete({
      title: 'Annuler & Supprimer l\'Ajustement de Stock',
      itemName: `${adj.item_name} (${adj.quantity_delta > 0 ? `+${adj.quantity_delta}` : adj.quantity_delta})`,
      message: `Êtes-vous sûr de vouloir annuler et supprimer cet ajustement de stock ? La quantité en stock sera inversée de ${adj.quantity_delta > 0 ? `-${adj.quantity_delta}` : `+${Math.abs(adj.quantity_delta)}`}.`,
      onConfirm: async () => {
        const res = await fetch(`/api/inventory/adjustments/${adj.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de l\'annulation de l\'ajustement');
        }
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteCounter = (counter: { id: string; name: string }) => {
    confirmDelete({
      title: 'Supprimer / Désactiver la Caisse',
      itemName: counter.name,
      message: `Êtes-vous sûr de vouloir retirer la caisse "${counter.name}" ? Si elle possède un historique de sessions, elle sera désactivée pour préserver les tickets.`,
      onConfirm: async () => {
        const res = await fetch(`/api/register/counters/${counter.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression de la caisse');
        }
        await loadCounters();
      }
    });
  };

  const handleCreateCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    setCounterError(null);
    const clean = newCounterName.trim();
    if (!clean) return;
    try {
      const res = await fetch('/api/register/counters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCounterError(data.error || 'Échec de l\'ajout de la caisse');
        return;
      }
      setNewCounterName('');
      await loadCounters();
    } catch (err: any) {
      setCounterError(err.message || 'Erreur lors de la création de la caisse');
    }
  };

  const displayedFamilies: ProductFamily[] = (showInactiveCatalog && allFamilies) ? allFamilies : families;
  const displayedProducts: Product[] = (showInactiveCatalog && allProducts) ? allProducts : products;

  // Filtered lists and counts (Item 4)
  const catalogLowStockCount = displayedProducts.filter(p => p.stock_quantity <= p.low_stock_threshold).length;
  const filteredProducts = displayedProducts.filter(p => {
    if (catalogLowStockOnly && p.stock_quantity > p.low_stock_threshold) return false;
    if (catalogSearch.trim()) {
      const q = catalogSearch.toLowerCase().trim();
      const matchName = p.name?.toLowerCase().includes(q);
      const matchBarcode = p.barcode?.toLowerCase().includes(q);
      const matchCat = p.category?.toLowerCase().includes(q);
      if (!matchName && !matchBarcode && !matchCat) return false;
    }
    return true;
  });

  const materialsLowStockCount = materials.filter(m => m.stock_quantity <= (m.low_stock_threshold || 0)).length;
  const filteredMaterials = materials.filter(m => {
    if (materialsLowStockOnly && m.stock_quantity > (m.low_stock_threshold || 0)) return false;
    if (materialsSearch.trim()) {
      const q = materialsSearch.toLowerCase().trim();
      const cat = (m.category || m.type || '').toLowerCase();
      const matchName = m.name?.toLowerCase().includes(q);
      const matchCat = cat.includes(q);
      if (!matchName && !matchCat) return false;
    }
    return true;
  });

  const overdueCustomersCount = customers.filter(c => !!c.has_overdue_tickets).length;
  const filteredCustomers = customers.filter(c => {
    if (customersOverdueOnly && !c.has_overdue_tickets) return false;
    if (customersSearch.trim()) {
      const q = customersSearch.toLowerCase().trim();
      const matchName = c.name?.toLowerCase().includes(q);
      const matchPhone = c.phone?.toLowerCase().includes(q);
      if (!matchName && !matchPhone) return false;
    }
    return true;
  });

  const filteredSuppliers = suppliers.filter(s => {
    if (suppliersSearch.trim()) {
      const q = suppliersSearch.toLowerCase().trim();
      if (!s.name?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const filteredPurchases = purchasesHistory.filter(p => {
    if (purchasesSearch.trim()) {
      const q = purchasesSearch.toLowerCase().trim();
      const matchSupplier = p.supplier_name?.toLowerCase().includes(q);
      const matchNumber = p.purchase_number?.toLowerCase().includes(q);
      const matchInv = (p as any).supplier_invoice_number?.toLowerCase().includes(q);
      if (!matchSupplier && !matchNumber && !matchInv) return false;
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col md:flex-row bg-slate-100 overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-56 bg-slate-900 text-slate-300 flex md:flex-col shrink-0 overflow-x-auto border-r border-slate-800">
        <div className="p-3 border-b border-slate-800 hidden md:block">
          <span className="text-pos-badge font-bold text-slate-600 uppercase tracking-wider">
            Administration
          </span>
        </div>
        <nav className="flex md:flex-col p-1.5 gap-1 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('SALES')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'SALES' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Ventes</span>
          </button>
          <button
            onClick={() => setActiveTab('CATALOG')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'CATALOG' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Catalogue & Articles</span>
          </button>
          <button
            onClick={() => setActiveTab('MATERIALS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'MATERIALS' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <FlaskConical className="w-4 h-4" />
            <span>Matières Premières</span>
          </button>
          <button
            onClick={() => setActiveTab('PRODUCTION')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'PRODUCTION' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Production</span>
          </button>
          <button
            onClick={() => setActiveTab('CUSTOMERS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'CUSTOMERS' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Clients & Créances</span>
          </button>
          <button
            onClick={() => setActiveTab('SUPPLIERS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'SUPPLIERS' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Truck className="w-4 h-4" />
            <span>Fournisseurs & Achats</span>
          </button>
          <button
            onClick={() => setActiveTab('CONTAINERS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'CONTAINERS' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Box className="w-4 h-4" />
            <span>Consignes</span>
          </button>
          <button
            onClick={() => setActiveTab('SESSIONS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'SESSIONS' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Clôtures de Caisse</span>
          </button>
          <button
            onClick={() => setActiveTab('ACCOUNTING')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'ACCOUNTING' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Grand Livre</span>
          </button>
          <button
            onClick={() => setActiveTab('REPORTS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'REPORTS' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Rapports</span>
          </button>
          <button
            onClick={() => setActiveTab('BACKUPS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'BACKUPS' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Sauvegardes</span>
          </button>
          <button
            onClick={() => setActiveTab('SETTINGS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'SETTINGS' ? 'bg-emerald-700 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Paramètres</span>
          </button>
        </nav>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 p-4 md:p-6 overflow-y-auto">
        {/* 0. SALES TAB */}
        {activeTab === 'SALES' && (
          <SalesHistoryTab
            onPrintReceipt={onPrintReceipt || (() => {})}
            onPrintInvoice={onPrintInvoice || (() => {})}
            onPrintDeliveryNote={onPrintDeliveryNote}
          />
        )}

        {/* 1. CATALOG TAB */}
        {activeTab === 'CATALOG' && (
          <div className="space-y-4">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">Catalogue Produits & Articles</h2>
                <p className="text-xs text-slate-500">Gestion des articles fabriqués et de revente, prix et stocks</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setInventoryAdjDefaultType('PRODUCT');
                    setIsInventoryAdjustmentOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2 rounded-xl transition-colors border border-slate-300"
                >
                  <Scale className="w-4 h-4 text-slate-500" />
                  Ajustement de Stock
                </button>
                <button
                  type="button"
                  onClick={() => setIsCategoriesModalOpen(true)}
                  className="flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-bold px-3 py-2 rounded-xl transition-colors border border-purple-200"
                >
                  <Layers className="w-4 h-4 text-purple-600" />
                  Gérer Catégories
                </button>
                <button
                  type="button"
                  onClick={() => setIsBatchCostModalOpen(true)}
                  className="flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold px-3 py-2 rounded-xl transition-colors border border-blue-200"
                >
                  <Calculator className="w-4 h-4 text-blue-600" />
                  Tailles & Coûts
                </button>
                <button
                  onClick={() => {
                    setFamilyToEdit(null);
                    setProductToEdit(null);
                    setIsCreateProductOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-sm transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  + Nouvel Article
                </button>
                <button
                  onClick={() => setIsBarcodeLabelModalOpen(true)}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-sm transition-colors"
                >
                  <Printer className="w-4 h-4 text-emerald-400" />
                  Imprimer Étiquettes
                </button>
              </div>
            </div>

            {/* Filter Bar (Search, Low Stock, Inactive) */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200">
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Rechercher produit, code-barres, catégorie..."
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                />
                {catalogSearch && (
                  <button
                    type="button"
                    onClick={() => setCatalogSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCatalogLowStockOnly(prev => !prev)}
                  className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl transition-colors border ${
                    catalogLowStockOnly
                      ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Stock bas ({catalogLowStockCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowInactiveCatalog(prev => !prev)}
                  className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl transition-colors border ${
                    showInactiveCatalog
                      ? 'bg-slate-800 text-white border-slate-800 shadow-xs'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  <Eye className="w-4 h-4" />
                  <span>Afficher inactifs</span>
                </button>
              </div>
            </div>

            {/* Product Families Section */}
            {displayedFamilies.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Familles de Produits ({displayedFamilies.length})
                  </h3>
                  <span className="text-pos-badge text-slate-600">Cliquez sur « Modifier » pour changer la catégorie, le type ou la recette</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {displayedFamilies.map(f => (
                    <div key={f.id} className={`p-3 border rounded-xl flex items-center justify-between ${
                      f.active === 0 ? 'bg-slate-100/70 border-slate-300 opacity-75' : 'bg-slate-50 border-slate-200/80'
                    }`}>
                      <div>
                        <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                          <span>{f.name}</span>
                          {f.active === 0 && (
                            <span className="px-1.5 py-0.5 rounded text-pos-badge font-bold bg-slate-200 text-slate-700 uppercase">
                              Inactif
                            </span>
                          )}
                        </div>
                        <div className="text-pos-badge text-slate-600">
                          {f.category} • <span className={f.type === 'MANUFACTURED' ? 'text-emerald-800 font-semibold' : 'text-blue-800 font-semibold'}>{f.type}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setProductToEdit(null);
                            setFamilyToEdit(f);
                            setIsCreateProductOpen(true);
                          }}
                          className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg border border-slate-200 text-pos-badge flex items-center gap-1 transition-colors shadow-2xs"
                        >
                          <Edit2 className="w-3 h-3 text-slate-500" />
                          Modifier Famille
                        </button>
                        <button
                          onClick={() => handleDeleteFamily(f)}
                          className="p-1.5 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg border border-slate-200 transition-colors shadow-2xs"
                          title="Supprimer la famille"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-280px)]">
              <div className="overflow-x-auto overflow-y-auto flex-1">
                <table className="w-full text-left border-collapse text-pos-body min-w-[750px]">
                <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700 uppercase text-pos-caption">
                    <th className="py-2.5 px-3">Désignation</th>
                    <th className="py-2.5 px-3">Catégorie</th>
                    <th className="py-2.5 px-3">Format</th>
                    <th className="py-2.5 px-3">Code-barres (Code-128)</th>
                    <th className="py-2.5 px-3 text-right">Coût Réf.</th>
                    <th className="py-2.5 px-3 text-right">Prix Détail (TTC)</th>
                    <th className="py-2.5 px-3 text-right">Prix Gros (TTC)</th>
                    <th className="py-2.5 px-3 text-center">Stock</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map(p => (
                    <tr key={p.id} className={p.active === 0 ? "bg-slate-100/70 opacity-75 hover:bg-slate-100" : "hover:bg-slate-50"}>
                      <td className="py-2 px-3 font-bold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span>{p.name}</span>
                          {p.active === 0 && (
                            <span className="px-1.5 py-0.5 rounded text-pos-badge font-bold bg-slate-200 text-slate-700 uppercase">
                              Inactif
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-slate-700">{p.category}</td>
                      <td className="py-2 px-3">
                        <span className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded font-semibold text-pos-badge">
                          {p.size_label || 'Pièce'}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono text-pos-badge text-slate-700">{p.barcode || '—'}</td>
                      <td className="py-2 px-3 text-right font-mono text-slate-700 tabular-nums">{formatMoney(p.cost_reference)}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800 tabular-nums">{formatMoney(p.retail_price)}</td>
                      <td className="py-2 px-3 text-right font-mono text-blue-800 tabular-nums">{formatMoney(p.wholesale_price)}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded font-bold font-mono text-pos-badge ${
                          p.stock_quantity <= p.low_stock_threshold ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {p.stock_quantity}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap space-x-1.5">
                        <button
                          onClick={() => {
                            setFamilyToEdit(null);
                            setProductToEdit(p);
                            setIsCreateProductOpen(true);
                          }}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-pos-badge inline-flex items-center gap-1 transition-colors"
                        >
                          <Edit2 className="w-3 h-3 text-slate-500" />
                          Modifier Article
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(p)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors inline-flex items-center"
                          title="Supprimer l'article"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-600">
                        Aucun produit dans le catalogue. Cliquez sur « + Nouvel Article » ci-dessus pour en créer un.
                      </td>
                    </tr>
                  ) : filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-600">
                        Aucun résultat pour cette recherche
                      </td>
                    </tr>
                  ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Batch Detail Modal (row click) */}
            <BatchDetailModal
              isOpen={Boolean(batchDetailId)}
              onClose={() => setBatchDetailId(null)}
              batchId={batchDetailId}
            />
          </div>
        )}

        {/* 2. MATERIALS TAB */}
        {activeTab === 'MATERIALS' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">Matières Premières & Emballages</h2>
                <p className="text-xs text-slate-500">Suivi des produits chimiques, emballages, coûts unitaires et stocks</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setInventoryAdjDefaultType('RAW_MATERIAL');
                    setIsInventoryAdjustmentOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2 rounded-xl transition-colors border border-slate-300"
                >
                  <Scale className="w-4 h-4 text-slate-500" />
                  Ajustement de Stock
                </button>
                <button
                  type="button"
                  onClick={() => setIsCategoriesModalOpen(true)}
                  className="flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-bold px-3 py-2 rounded-xl transition-colors border border-purple-200"
                >
                  <Layers className="w-4 h-4 text-purple-600" />
                  Gérer Catégories
                </button>
                <button
                  onClick={() => {
                    setMaterialToEdit(null);
                    setIsCreateMaterialOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-sm transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  + Nouvelle Matière
                </button>
              </div>
            </div>

            {/* Filter Bar (Search, Low Stock) */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200">
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Rechercher matière première, catégorie..."
                  value={materialsSearch}
                  onChange={e => setMaterialsSearch(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                />
                {materialsSearch && (
                  <button
                    type="button"
                    onClick={() => setMaterialsSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMaterialsLowStockOnly(prev => !prev)}
                  className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl transition-colors border ${
                    materialsLowStockOnly
                      ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Stock bas ({materialsLowStockCount})</span>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-280px)]">
              <div className="overflow-x-auto overflow-y-auto flex-1">
                <table className="w-full text-left border-collapse text-pos-body min-w-[700px]">
                <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700 uppercase text-pos-caption">
                    <th className="py-2.5 px-3">Matière Première</th>
                    <th className="py-2.5 px-3">Catégorie</th>
                    <th className="py-2.5 px-3">Unité</th>
                    <th className="py-2.5 px-3 text-right">Coût / Unité</th>
                    <th className="py-2.5 px-3 text-center">Stock</th>
                    <th className="py-2.5 px-3">Dernier Fournisseur</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMaterials.map(m => {
                    const cat = m.category || m.type || 'General';
                    const cost = m.current_cost_per_unit ?? m.latest_purchase_cost ?? 0;
                    return (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-bold text-slate-900">{m.name}</td>
                        <td className="py-2 px-3">
                          <span className="px-1.5 py-0.5 rounded text-pos-badge font-bold bg-slate-100 text-slate-800 uppercase">
                            {cat}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-700 font-semibold">{m.unit}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">{formatMoney(cost)}</td>
                        <td className="py-2 px-3 text-center font-mono font-bold text-slate-800">
                          <span className={`px-2 py-0.5 rounded font-bold font-mono text-pos-badge ${
                            m.stock_quantity <= (m.low_stock_threshold || 0) ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-800'
                          }`}>
                            {m.stock_quantity}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-700">{m.latest_supplier_name || '—'}</td>
                        <td className="py-2 px-3 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => {
                              setMaterialToEdit(m);
                              setIsCreateMaterialOpen(true);
                            }}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-pos-badge inline-flex items-center gap-1 transition-colors"
                          >
                            <Edit2 className="w-3 h-3 text-slate-500" />
                            Modifier
                          </button>
                          <button
                            onClick={() => setMaterialForPriceHistory(m)}
                            className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-800 font-bold rounded-lg text-pos-badge inline-flex items-center gap-1 transition-colors"
                          >
                            <TrendingUp className="w-3 h-3 text-blue-600" />
                            Historique Prix
                          </button>
                          <button
                            onClick={() => handleDeleteMaterial(m)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors inline-flex items-center"
                            title="Supprimer la matière"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {materials.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-600">
                        Aucune matière première enregistrée. Cliquez sur « + Nouvelle Matière » pour en ajouter une.
                      </td>
                    </tr>
                  ) : filteredMaterials.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-600">
                        Aucun résultat pour cette recherche
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              </div>
            </div>

            {/* Inventory Adjustments Audit Log */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-6">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="w-4 h-4 text-slate-600" />
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    Journal des Ajustements de Stock ({inventoryAdjustments.length})
                  </h3>
                </div>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-pos-body border-collapse min-w-[650px]">
                  <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-pos-caption uppercase">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Article / Matière</th>
                      <th className="py-2.5 px-3">Motif</th>
                      <th className="py-2.5 px-3 text-center">Écart</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inventoryAdjustments.map(adj => (
                      <tr key={adj.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{formatDateTime(adj.date || adj.created_at)}</td>
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-pos-badge font-bold ${
                            adj.item_type === 'RAW_MATERIAL' ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-900'
                          }`}>
                            {adj.item_type}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-bold text-slate-900">{adj.item_name || '—'}</td>
                        <td className="py-2 px-3 text-slate-700">{adj.reason}</td>
                        <td className="py-2 px-3 text-center font-mono font-bold tabular-nums">
                          <span className={adj.quantity_delta >= 0 ? 'text-emerald-800' : 'text-rose-700'}>
                            {adj.quantity_delta > 0 ? `+${adj.quantity_delta}` : adj.quantity_delta} {adj.unit_or_size || ''}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => handleDeleteAdjustment(adj)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors inline-flex items-center"
                            title="Annuler & supprimer l'ajustement"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {inventoryAdjustments.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-slate-600">
                          Aucun ajustement de stock enregistré.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 3. PRODUCTION WIZARD TAB */}
        {activeTab === 'PRODUCTION' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">Assistant de Production par Lots</h2>
                <p className="text-xs text-slate-500">
                  Fabriquez des articles finis avec déduction automatique des matières premières et calcul du coût unitaire
                </p>
              </div>
              <button
                onClick={() => setIsCreateFormulationOpen(true)}
                className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                + Nouvelle Recette
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Production Form */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                <form onSubmit={handleRunBatchWizard} className="space-y-4">
                  {/* 1. Recipe Selection */}
                  <div>
                    <label htmlFor="wizard-recipe-select" className="block text-xs font-bold text-slate-700 mb-1">
                      1. Sélectionner la Recette *
                    </label>
                    <select
                      id="wizard-recipe-select"
                      value={selectedFormulationId}
                      onChange={e => {
                        setSelectedFormulationId(e.target.value);
                        setTargetProductId('');
                      }}
                      required
                      className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl"
                    >
                      <option value="">Choisir une recette...</option>
                      {formulations.map(f => (
                        <option key={f.id} value={f.id}>
                          {f.name} (Est. {formatMoney(f.cost_per_liter)} / L)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 2. Target Product Selection */}
                  <div>
                    <label htmlFor="wizard-product-select" className="block text-xs font-bold text-slate-700 mb-1">
                      2. Article Produit à Réapprovisionner *
                    </label>
                    <select
                      id="wizard-product-select"
                      value={targetProductId}
                      onChange={e => {
                        const newId = e.target.value;
                        setTargetProductId(newId);
                        const prod = products.find(p => p.id === newId);
                        const selForm = formulations.find(f => f.id === selectedFormulationId);
                        const yUnit = (selForm as any)?.base_yield_unit || 'L';
                        const isPiece = ['pcs', 'piece', 'pieces', 'unit', 'unite', 'unites'].includes(String(yUnit).toLowerCase());
                        const effectiveSize = (prod?.size_volume && prod.size_volume > 0)
                          ? prod.size_volume
                          : (isPiece ? 1 : null);
                        if (effectiveSize) {
                          const v = parseFloat(batchVolume);
                          if (!isNaN(v) && v > 0) {
                            const u = Math.round((v / effectiveSize) * 1000) / 1000;
                            setUnitsProduced(String(u));
                          }
                        }
                      }}
                      required
                      className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl"
                    >
                      <option value="">Choisir l'article fini à réapprovisionner...</option>
                      {(() => {
                        const familyById = new Map((families || []).map(f => [f.id, f]));
                        const linkedProducts = products.filter(p => {
                          const fam = familyById.get(p.family_id);
                          const isMfg = fam ? fam.type === 'MANUFACTURED' : (p.product_type === 'MANUFACTURED' || !p.product_type);
                          return isMfg && Boolean(selectedFormulationId && fam?.formulation_id === selectedFormulationId);
                        });
                        const otherMfgProducts = products.filter(p => {
                          const fam = familyById.get(p.family_id);
                          const isMfg = fam ? fam.type === 'MANUFACTURED' : (p.product_type === 'MANUFACTURED' || !p.product_type);
                          return isMfg && (!selectedFormulationId || fam?.formulation_id !== selectedFormulationId);
                        });

                        return (
                          <>
                            {linkedProducts.length > 0 && (
                              <optgroup label="Produits liés à cette recette">
                                {linkedProducts.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.size_label || 'Pièce'}) — Stock: {p.stock_quantity}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {otherMfgProducts.length > 0 && (
                              <optgroup label={linkedProducts.length > 0 ? "Autres produits fabriqués" : "Tous les produits fabriqués"}>
                                {otherMfgProducts.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.size_label || 'Pièce'}) — Stock: {p.stock_quantity}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </>
                        );
                      })()}
                    </select>

                    {/* Missing size warning or size volume used */}
                    {(() => {
                      const selectedTargetProduct = products.find(p => p.id === targetProductId);
                      const selectedFormulation = formulations.find(f => f.id === selectedFormulationId);
                      const yieldUnit = (selectedFormulation as any)?.base_yield_unit || 'L';
                      const isPieceUnit = ['pcs', 'piece', 'pieces', 'unit', 'unite', 'unites'].includes(String(yieldUnit).toLowerCase());

                      if (selectedTargetProduct) {
                        if (selectedTargetProduct.size_volume !== null && selectedTargetProduct.size_volume !== undefined && selectedTargetProduct.size_volume > 0) {
                          return (
                            <div className="text-pos-badge text-emerald-800 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 inline-flex items-center gap-1.5 mt-1.5">
                              Format unitaire utilisé : {selectedTargetProduct.size_volume} {yieldUnit}
                            </div>
                          );
                        } else if (isPieceUnit) {
                          return (
                            <div className="text-pos-badge text-emerald-800 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 inline-flex items-center gap-1.5 mt-1.5">
                              Format unitaire utilisé : 1
                            </div>
                          );
                        } else {
                          return (
                            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-950 rounded-xl text-xs flex items-center justify-between mt-2">
                              <span className="flex items-center gap-1.5 font-semibold">
                                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                Format manquant : cet article n'a aucun volume unitaire configuré.
                              </span>
                              <button
                                type="button"
                                onClick={() => setIsBatchCostModalOpen(true)}
                                className="font-bold underline text-blue-700 hover:text-blue-900 ml-2 shrink-0 text-pos-badge"
                              >
                                Tailles & Coûts
                              </button>
                            </div>
                          );
                        }
                      }

                      if (selectedFormulationId) {
                        const familyById = new Map((families || []).map(f => [f.id, f]));
                        const hasLinked = products.some(p => {
                          const fam = familyById.get(p.family_id);
                          return fam && fam.type === 'MANUFACTURED' && fam.formulation_id === selectedFormulationId;
                        });
                        if (!hasLinked) {
                          return (
                            <p className="text-pos-badge text-amber-800 font-semibold mt-1">
                              ℹ️ Cette formule n'est pas encore liée à une famille spécifique. Vous pouvez choisir n'importe quel produit fabriqué ci-dessus.
                            </p>
                          );
                        }
                      }
                      return null;
                    })()}
                  </div>

                  {/* 3. Batch Volume & Units Produced with Bi-Directional Derivation */}
                  {(() => {
                    const selectedFormulation = formulations.find(f => f.id === selectedFormulationId);
                    const selectedTargetProduct = products.find(p => p.id === targetProductId);
                    const yieldUnit = (selectedFormulation as any)?.base_yield_unit || 'L';
                    const isPieceUnit = ['pcs', 'piece', 'pieces', 'unit', 'unite', 'unites'].includes(String(yieldUnit).toLowerCase());
                    const effectiveSize = (selectedTargetProduct?.size_volume && selectedTargetProduct.size_volume > 0)
                      ? selectedTargetProduct.size_volume
                      : (isPieceUnit ? 1 : null);
                    const volumeUnitLabel = isPieceUnit ? 'Pièces' : yieldUnit === 'kg' ? 'Kilogrammes' : 'Litres';

                    return (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="wizard-batch-volume" className="block text-xs font-bold text-slate-700 mb-1">
                            Volume du Lot ({volumeUnitLabel}) *
                          </label>
                          <input
                            id="wizard-batch-volume"
                            type="number"
                            step="any"
                            min="0.001"
                            required
                            value={batchVolume}
                            onChange={e => {
                              const newVol = e.target.value;
                              setBatchVolume(newVol);
                              if (effectiveSize && effectiveSize > 0) {
                                const v = parseFloat(newVol);
                                if (!isNaN(v) && v > 0) {
                                  const u = Math.round((v / effectiveSize) * 1000) / 1000;
                                  setUnitsProduced(String(u));
                                }
                              }
                            }}
                            className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl"
                          />
                        </div>
                        <div>
                          <label htmlFor="wizard-units-produced" className="block text-xs font-bold text-slate-700 mb-1">
                            Unités Produites *
                          </label>
                          <input
                            id="wizard-units-produced"
                            type="number"
                            step="any"
                            min="0.001"
                            required
                            value={unitsProduced}
                            onChange={e => {
                              const newUnits = e.target.value;
                              setUnitsProduced(newUnits);
                              if (effectiveSize && effectiveSize > 0) {
                                const u = parseFloat(newUnits);
                                if (!isNaN(u) && u > 0) {
                                  const v = Math.round((u * effectiveSize) * 1000) / 1000;
                                  setBatchVolume(String(v));
                                }
                              }
                            }}
                            className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl"
                          />
                        </div>
                      </div>
                    );
                  })()}

                  <button
                    type="submit"
                    disabled={isExecutingBatch || (() => {
                      const p = products.find(x => x.id === targetProductId);
                      const f = formulations.find(x => x.id === selectedFormulationId);
                      const unit = (f as any)?.base_yield_unit || 'L';
                      const isPiece = ['pcs', 'piece', 'pieces', 'unit', 'unite', 'unites'].includes(String(unit).toLowerCase());
                      if (isPiece) return false;
                      return Boolean(p && (p.size_volume === null || p.size_volume === undefined || p.size_volume <= 0));
                    })()}
                    className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl shadow text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <FlaskConical className="w-4 h-4" />
                    {isExecutingBatch ? 'Production en cours...' : 'Lancer la Production du Lot'}
                  </button>
                </form>
              </div>

              {/* Batch Execution Results */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 flex flex-col justify-center">
                {batchResult ? (
                  batchResult.error ? (
                    <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                      <span>{batchResult.error}</span>
                    </div>
                  ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                      <Check className="w-5 h-5" />
                      <span>Lot fabriqué avec succès !</span>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1 font-mono">
                      <div>Numéro de Lot : <span className="font-bold">{batchResult.batch_number}</span></div>
                      <div>Coût Total : <span className="font-bold tabular-nums">{formatMoney(batchResult.total_batch_cost)}</span></div>
                      <div>Coût / Unité : <span className="font-bold text-emerald-800 tabular-nums">{formatMoney(batchResult.cost_per_unit)}</span></div>
                    </div>
                    {((batchResult.negative_stock_warnings && batchResult.negative_stock_warnings.length > 0) ||
                      (batchResult.warnings && batchResult.warnings.length > 0)) && (
                      <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl text-xs text-amber-950 space-y-2">
                        <span className="font-bold block flex items-center gap-1.5 text-amber-900">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          Avertissements de déficit de stock (passé en négatif) :
                        </span>
                        <div className="space-y-1 pl-1">
                          {(batchResult.negative_stock_warnings || []).map((w: any, i: number) => (
                            <div key={i} className="text-pos-badge font-mono text-slate-800">
                              • <span className="font-sans font-bold text-slate-900">{w.material_name}</span> : Requis {w.quantity_required} {w.unit}, Disponible {w.current_stock} {w.unit} (Déficit : <span className="text-rose-700 font-bold">{w.deficit} {w.unit}</span>)
                            </div>
                          ))}
                          {(!batchResult.negative_stock_warnings && batchResult.warnings) &&
                            batchResult.warnings.map((w: string, i: number) => (
                              <div key={i} className="text-pos-badge">• {w}</div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )) : (
                  <div className="text-center text-slate-600 text-xs py-12">
                    Remplissez le formulaire à gauche pour lancer une production.
                  </div>
                )}
              </div>
            </div>

            {/* Saved Formulations / Recipes */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Formulations & Recettes Configurées ({formulations.length})
                </h3>
                <span className="text-pos-badge text-slate-600">Modifier les composants, proportions ou prévisualiser les coûts de revient</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {formulations.map(f => (
                  <div key={f.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-xs text-slate-900">{f.name}</h4>
                      <p className="text-pos-badge text-slate-600">
                        Base: <span className="font-semibold text-slate-700">{f.base_volume || (f as any).base_volume_liters || 100}L</span> • Est: <span className="font-bold font-mono text-emerald-800 tabular-nums">{formatMoney(f.cost_per_liter)}/L</span>
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setFormulationToEdit(f);
                        setIsCreateFormulationOpen(true);
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg border border-slate-200 text-pos-badge flex items-center gap-1 transition-colors shadow-2xs"
                    >
                      <Edit2 className="w-3 h-3 text-slate-500" />
                      Consulter / Modifier
                    </button>
                  </div>
                ))}
                {formulations.length === 0 && (
                  <div className="col-span-3 text-center py-6 text-slate-600 text-xs">
                    Aucune recette configurée. Cliquez sur « + Nouvelle Recette » pour en créer une.
                  </div>
                )}
              </div>
            </div>

            {/* Production Batch History Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-280px)]">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-emerald-700" />
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    Historique des Lots de Production ({productionBatches.length})
                  </h3>
                </div>
              </div>
              <div className="overflow-x-auto overflow-y-auto flex-1">
                <table className="w-full text-left text-pos-body border-collapse min-w-[700px]">
                  <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-pos-caption uppercase">
                      <th className="py-2.5 px-3">N° Lot</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Recette</th>
                      <th className="py-2.5 px-3">Article Réapprovisionné</th>
                      <th className="py-2.5 px-3 text-center">Volume Lot</th>
                      <th className="py-2.5 px-3 text-center">Unités Produites</th>
                      <th className="py-2.5 px-3 text-right">Coût / Unité</th>
                      <th className="py-2.5 px-3 text-right">Coût Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {productionBatches.map(b => (
                      <tr
                        key={b.id}
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() => setBatchDetailId(b.id)}
                        title="Voir le détail du lot"
                      >
                        <td className="py-2 px-3 font-mono font-bold text-slate-900">{b.batch_number}</td>
                        <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{formatDateTime(b.date || b.created_at)}</td>
                        <td className="py-2 px-3 font-semibold text-slate-800">{b.formulation_name}</td>
                        <td className="py-2 px-3 font-bold text-slate-900">{b.target_product_name} {b.size_label ? `(${b.size_label})` : ''}</td>
                        <td className="py-2 px-3 text-center font-mono font-bold text-slate-800 tabular-nums">
                          {b.batch_volume !== null && b.batch_volume !== undefined
                            ? `${b.batch_volume} ${b.formulation_base_unit || (b as any).base_yield_unit || 'L'}`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 text-center font-mono font-bold text-slate-800 tabular-nums">{b.units_produced}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800 tabular-nums">{formatMoney(b.cost_per_unit)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">{formatMoney(b.total_batch_cost)}</td>
                      </tr>
                    ))}
                    {productionBatches.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-600">
                          Aucun lot de production enregistré. Lancez un lot via l'assistant ci-dessus.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 4. CUSTOMERS TAB */}
        {activeTab === 'CUSTOMERS' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">Comptes Clients & Billets de Dette</h2>
                <p className="text-xs text-slate-500">Gestion des comptes clients, recharges de portefeuille et suivi des créances</p>
              </div>
              <button
                onClick={() => {
                  setCustomerToEdit(null);
                  setIsCreateCustomerOpen(true);
                }}
                className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                + Nouveau Client
              </button>
            </div>

            {actionNotice && (
              <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold">
                {actionNotice}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Customer Directory */}
              <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-3 space-y-2 max-h-96 overflow-y-auto">
                <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide px-1">
                  Répertoire Clients
                </h3>
                <div className="flex items-center gap-2 mb-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Rechercher client, tél..."
                      value={customersSearch}
                      onChange={e => setCustomersSearch(e.target.value)}
                      className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                    />
                    {customersSearch && (
                      <button
                        type="button"
                        onClick={() => setCustomersSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustomersOverdueOnly(prev => !prev)}
                    className={`flex items-center gap-1 text-pos-badge font-bold px-2.5 py-1.5 rounded-xl transition-colors border shrink-0 ${
                      customersOverdueOnly
                        ? 'bg-rose-700 text-white border-rose-700 shadow-xs'
                        : 'bg-white hover:bg-rose-50 text-rose-700 border-rose-200'
                    }`}
                    title="Afficher uniquement les clients avec dettes en retard"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>En retard ({overdueCustomersCount})</span>
                  </button>
                </div>
                {filteredCustomers.map(c => (
                  <div
                    key={c.id}
                    onClick={() => handleSelectCustomerForTickets(c)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedCustomer?.id === c.id
                        ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-xs text-slate-900">{c.name}</h4>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-pos-badge font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            {c.type}
                          </span>
                          {c.has_overdue_tickets && (
                            <span className="text-pos-badge font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 uppercase">
                              En retard
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCustomerToEdit(c);
                            setIsCreateCustomerOpen(true);
                          }}
                          className="p-1 text-slate-600 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
                          title="Modifier le client"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCustomer(c);
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-100/60 rounded-lg transition-colors"
                          title="Supprimer le client"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-2 text-pos-badge">
                      <span className="text-slate-600">Portefeuille : {formatMoney(c.wallet_balance)}</span>
                      <span className={`font-bold font-mono ${c.has_overdue_tickets ? 'text-rose-700 font-black' : c.total_debt ? 'text-amber-800' : 'text-slate-500'}`}>
                        Dette : {formatMoney(c.total_debt)}
                      </span>
                    </div>
                  </div>
                ))}
                {filteredCustomers.length === 0 && (
                  <div className="p-6 text-center text-slate-600 text-xs">
                    Aucun résultat pour cette recherche
                  </div>
                )}
              </div>

              {/* Customer Detail & Actions */}
              <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
                {selectedCustomer ? (
                  <>
                    <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-black text-slate-900">{selectedCustomer.name}</h3>
                          <button
                            type="button"
                            onClick={() => setIsCustomerStatementOpen(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-bold transition-colors cursor-pointer"
                            title="Consulter et imprimer le relevé de compte complet (A4 / PDF)"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Imprimer / PDF</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsCustomerStatementOpen(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-bold transition-colors cursor-pointer"
                            title="Exporter le relevé au format CSV"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Exporter CSV</span>
                          </button>
                        </div>
                        <p className="text-xs text-slate-500">{selectedCustomer.phone || 'Sans téléphone'} • {selectedCustomer.address || 'Sans adresse'}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-500 block">Dette Totale Ouverte :</span>
                        <span className="text-lg font-black text-amber-800 font-mono tabular-nums">
                          {formatMoney(selectedCustomer.total_debt)}
                        </span>
                      </div>
                    </div>

                    {/* Debt & Wallet Operations */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* FIFO Debt Repayment */}
                      <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200 space-y-2">
                        <span className="text-xs font-bold text-amber-900 block flex items-center gap-1">
                          <CreditCard className="w-3.5 h-3.5" />
                          Règlement de Dette (FIFO)
                        </span>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="0.001"
                            placeholder="Montant DT"
                            value={debtPayAmount}
                            onChange={e => setDebtPayAmount(e.target.value)}
                            className="w-full text-xs font-bold font-mono px-2 py-1.5 border border-slate-300 rounded-lg"
                          />
                          <button
                            type="button"
                            disabled={isPayingCustomerDebt}
                            onClick={handlePayCustomerDebt}
                            className="bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg text-xs shrink-0 transition-colors"
                          >
                            {isPayingCustomerDebt ? 'Règlement...' : 'Régler'}
                          </button>
                        </div>
                      </div>

                      {/* Wallet Top-up */}
                      <div className="bg-purple-50/70 p-3 rounded-xl border border-purple-200 space-y-2">
                        <span className="text-xs font-bold text-purple-900 block flex items-center gap-1">
                          <Wallet className="w-3.5 h-3.5" />
                          Recharger le Portefeuille Client
                        </span>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="0.001"
                            placeholder="Montant DT"
                            value={walletTopUpAmount}
                            onChange={e => setWalletTopUpAmount(e.target.value)}
                            className="w-full text-xs font-bold font-mono px-2 py-1.5 border border-slate-300 rounded-lg"
                          />
                          <button
                            type="button"
                            disabled={isToppingUpWallet}
                            onClick={handleTopUpWallet}
                            className="bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg text-xs shrink-0 transition-colors"
                          >
                            {isToppingUpWallet ? 'Recharge...' : 'Recharger'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Open Debt Tickets Table */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Billets de Dette en Cours
                      </h4>
                      <div className="border border-slate-200 rounded-xl max-h-48 overflow-y-auto overflow-x-auto">
                        <table className="w-full text-left border-collapse text-pos-body min-w-[500px]">
                          <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                            <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700 uppercase text-pos-caption">
                              <th className="py-2.5 px-3">N° Billet</th>
                              <th className="py-2.5 px-3">Date</th>
                              <th className="py-2.5 px-3 text-right">Total Initial</th>
                              <th className="py-2.5 px-3 text-right">Reste Dû</th>
                              <th className="py-2.5 px-3 text-center">Statut</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {customerTickets.map(t => (
                              <tr key={t.id}>
                                <td className="py-2 px-3 font-mono font-bold text-slate-900">{t.ticket_number}</td>
                                <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{formatDate(t.date)}</td>
                                <td className="py-2 px-3 text-right font-mono tabular-nums">{formatMoney(t.total_amount)}</td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-amber-800 tabular-nums">{formatMoney(t.remaining_amount)}</td>
                                <td className="py-2 px-3 text-center">
                                  <span className={`px-1.5 py-0.5 rounded text-pos-badge font-bold ${
                                    t.is_overdue ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'
                                  }`}>
                                    {t.is_overdue ? 'En retard (>30j)' : t.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {customerTickets.length === 0 && (
                              <tr>
                                <td colSpan={5} className="p-4 text-center text-slate-600">
                                  Aucun billet de dette ouvert pour ce client.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-24 text-center text-slate-600 text-xs">
                    Sélectionnez un client à gauche pour consulter ses billets et enregistrer des règlements.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 5. SUPPLIERS TAB */}
        {activeTab === 'SUPPLIERS' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">Fournisseurs & Achats</h2>
                <p className="text-xs text-slate-500">Enregistrer les réceptions d'achats, gérer les fournisseurs et suivre les règlements de dettes</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSupplierToEdit(null);
                    setIsCreateSupplierOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  + Nouveau Fournisseur
                </button>
                <button
                  onClick={() => setIsPurchaseModalOpen(true)}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition-colors"
                >
                  <Truck className="w-4 h-4 text-emerald-400" />
                  + Nouvel Achat
                </button>
              </div>
            </div>

            {supplierActionNotice && (
              <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold">
                {supplierActionNotice}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Supplier Directory */}
              <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-3 space-y-2 max-h-96 overflow-y-auto">
                <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide px-1">
                  Répertoire Fournisseurs
                </h3>
                <div className="relative mb-2">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Rechercher fournisseur..."
                    value={suppliersSearch}
                    onChange={e => setSuppliersSearch(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                  {suppliersSearch && (
                    <button
                      type="button"
                      onClick={() => setSuppliersSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {filteredSuppliers.map(s => (
                  <div
                    key={s.id}
                    onClick={() => handleSelectSupplierForTickets(s)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedSupplier?.id === s.id
                        ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-xs text-slate-900">{s.name}</h4>
                        {s.phone && (
                          <span className="text-pos-badge font-mono text-slate-600">
                            {s.phone}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSupplierToEdit(s);
                            setIsCreateSupplierOpen(true);
                          }}
                          className="p-1 text-slate-600 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
                          title="Modifier le fournisseur"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSupplier(s);
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-100/60 rounded-lg transition-colors"
                          title="Supprimer le fournisseur"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-2 text-pos-badge">
                      <span className="text-slate-600">{s.address || 'Sans adresse'}</span>
                      <span className={`font-bold font-mono ${s.total_debt ? 'text-rose-700' : 'text-slate-500'}`}>
                        Dette : {formatMoney(s.total_debt)}
                      </span>
                    </div>
                  </div>
                ))}
                {suppliers.length === 0 ? (
                  <div className="p-4 text-center text-slate-600 text-xs">
                    Aucun fournisseur enregistré. Cliquez sur « + Nouveau Fournisseur » pour en créer un.
                  </div>
                ) : filteredSuppliers.length === 0 ? (
                  <div className="p-6 text-center text-slate-600 text-xs">
                    Aucun résultat pour cette recherche
                  </div>
                ) : null}
              </div>

              {/* Supplier Detail & Debt Ledger */}
              <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
                {selectedSupplier ? (
                  <>
                    <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                      <div>
                        <h3 className="text-base font-black text-slate-900">{selectedSupplier.name}</h3>
                        <p className="text-xs text-slate-500">{selectedSupplier.phone || 'Sans téléphone'} • {selectedSupplier.address || 'Sans adresse'}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-500 block">Total Dette Fournisseur :</span>
                        <span className="text-lg font-black text-rose-700 font-mono tabular-nums">
                          {formatMoney(selectedSupplier.total_debt)}
                        </span>
                      </div>
                    </div>

                    {/* FIFO Debt Repayment */}
                    <div className="bg-rose-50/70 p-3.5 rounded-xl border border-rose-200 space-y-2">
                      <span className="text-xs font-bold text-rose-900 block flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5" />
                        Règlement Dette Fournisseur (FIFO)
                      </span>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.001"
                          placeholder="Montant DT à payer"
                          value={supplierDebtPayAmount}
                          onChange={e => setSupplierDebtPayAmount(e.target.value)}
                          className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-lg"
                        />
                        <button
                          type="button"
                          disabled={isPayingSupplierDebt}
                          onClick={handlePaySupplierDebt}
                          className="bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-xs shrink-0 transition-colors shadow-sm"
                        >
                          {isPayingSupplierDebt ? 'Paiement en cours...' : 'Payer Fournisseur'}
                        </button>
                      </div>
                    </div>

                    {/* Open Debt Tickets Table */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Billets de Dette Fournisseur en Cours
                      </h4>
                      <div className="border border-slate-200 rounded-xl max-h-48 overflow-y-auto overflow-x-auto">
                        <table className="w-full text-left border-collapse text-pos-body min-w-[500px]">
                          <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                            <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700 uppercase text-pos-caption">
                              <th className="py-2.5 px-3">N° Billet</th>
                              <th className="py-2.5 px-3">Date</th>
                              <th className="py-2.5 px-3">N° Achat</th>
                              <th className="py-2.5 px-3 text-right">Total Initial</th>
                              <th className="py-2.5 px-3 text-right">Reste Dû</th>
                              <th className="py-2.5 px-3 text-center">Statut</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {supplierTickets.map(t => (
                              <tr key={t.id}>
                                <td className="py-2 px-3 font-mono font-bold text-slate-900">{t.ticket_number}</td>
                                <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{formatDate(t.date)}</td>
                                <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{(t as any).purchase_number || '—'}</td>
                                <td className="py-2 px-3 text-right font-mono tabular-nums">{formatMoney(t.total_amount)}</td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-rose-700 tabular-nums">{formatMoney(t.remaining_amount)}</td>
                                <td className="py-2 px-3 text-center">
                                  <span className={`px-1.5 py-0.5 rounded text-pos-badge font-bold ${
                                    t.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                  }`}>
                                    {t.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {supplierTickets.length === 0 && (
                              <tr>
                                <td colSpan={6} className="p-4 text-center text-slate-600">
                                  Aucun billet de dette ouvert pour ce fournisseur.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-24 text-center text-slate-600 text-xs">
                    Sélectionnez un fournisseur à gauche pour consulter son grand livre et enregistrer des paiements.
                  </div>
                )}
              </div>
            </div>

            {/* Purchase History Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-280px)]">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-emerald-700" />
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    Historique des Achats & Réceptions ({filteredPurchases.length})
                  </h3>
                </div>
                <div className="relative w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Rechercher fournisseur, n°..."
                    value={purchasesSearch}
                    onChange={e => setPurchasesSearch(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {purchasesSearch && (
                    <button
                      type="button"
                      onClick={() => setPurchasesSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto overflow-y-auto flex-1">
                <table className="w-full text-left text-pos-body border-collapse min-w-[700px]">
                  <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-pos-caption uppercase">
                      <th className="py-2.5 px-3">N° Achat</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Fournisseur</th>
                      <th className="py-2.5 px-3 text-center">Articles</th>
                      <th className="py-2.5 px-3 text-right">Total TTC</th>
                      <th className="py-2.5 px-3 text-right">Payé</th>
                      <th className="py-2.5 px-3 text-right">Dette Ajoutée</th>
                      <th className="py-2.5 px-3 text-center">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPurchases.map(p => (
                      <tr
                        key={p.id}
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() => setPurchaseDetailId(p.id)}
                        title="Voir le détail de l'achat"
                      >
                        <td className="py-2 px-3 font-mono font-bold text-slate-900">{p.purchase_number}</td>
                        <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{formatDate(p.date)}</td>
                        <td className="py-2 px-3 font-bold text-slate-900">{p.supplier_name}</td>
                        <td className="py-2 px-3 text-center font-mono font-semibold tabular-nums">{p.item_count || 1}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">{formatMoney(p.total_amount)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800 tabular-nums">{formatMoney(p.cash_paid)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-rose-700 tabular-nums">{formatMoney(p.debt_amount)}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-pos-badge font-bold ${
                            p.payment_status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                          }`}>
                            {p.payment_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {purchasesHistory.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-600">
                          Aucun achat enregistré. Cliquez sur « + Nouvel Achat » ci-dessus pour saisir une facture.
                        </td>
                      </tr>
                    ) : filteredPurchases.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-600">
                          Aucun résultat pour cette recherche
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            {/* New Purchase Modal */}
            <CreatePurchaseModal
              isOpen={isPurchaseModalOpen}
              onClose={() => setIsPurchaseModalOpen(false)}
              onSuccess={() => {
                loadBackofficeData();
                onRefreshData();
              }}
              suppliers={suppliers}
              materials={materials}
              products={products}
              initialSupplierId={selectedSupplier?.id}
            />

            {/* Purchase Detail Modal (row click) */}
            <PurchaseDetailModal
              isOpen={Boolean(purchaseDetailId)}
              onClose={() => setPurchaseDetailId(null)}
              purchaseId={purchaseDetailId}
            />
          </div>
        )}

        {/* 6. CONTAINERS TAB */}
        {activeTab === 'CONTAINERS' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">Suivi des Consignes & Emballages</h2>
                <p className="text-xs text-slate-500">Suivi des consignes, prêts de contenants aux clients et retours</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setContainerTxInitialAction('GIVE');
                    setContainerTxInitialCustomerId(null);
                    setContainerTxInitialContainerTypeId(null);
                    setIsContainerTxOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-amber-700 hover:bg-amber-800 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition-colors"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  Prêter / Retourner
                </button>
                <button
                  onClick={() => {
                    setContainerTypeToEdit(null);
                    setIsCreateContainerOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  + Nouveau Type de Contenant
                </button>
              </div>
            </div>

            {/* Container Types Stock Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {containerTypes.map(ct => (
                <div key={ct.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-pos-badge font-bold text-slate-500 uppercase tracking-tight">Type de Contenant</span>
                        <h3 className="font-bold text-slate-900 text-sm mt-0.5">{ct.name}</h3>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setContainerTypeToEdit(ct);
                            setIsCreateContainerOpen(true);
                          }}
                          className="p-1 text-slate-600 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Modifier le type de contenant"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteContainerType(ct)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Supprimer le type de contenant"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-between items-center text-xs">
                      <span className="text-slate-600">Stock en Boutique (Vide) :</span>
                      <span className="font-black font-mono text-emerald-800 tabular-nums">{ct.stock_quantity}</span>
                    </div>
                    <div className="mt-1 flex justify-between items-center text-xs">
                      <span className="text-slate-600">Prêté aux Clients :</span>
                      <span className="font-black font-mono text-amber-800 tabular-nums">{ct.total_loaned_out || 0}</span>
                    </div>
                  </div>
                  <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-center gap-2">
                    <button
                      onClick={() => {
                        setContainerTxInitialAction('GIVE');
                        setContainerTxInitialContainerTypeId(ct.id);
                        setIsContainerTxOpen(true);
                      }}
                      className="flex-1 py-1.5 px-2 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-pos-badge rounded-lg transition-colors flex items-center justify-center gap-1"
                    >
                      <ArrowUpRight className="w-3 h-3" />
                      Prêter
                    </button>
                    <button
                      onClick={() => {
                        setContainerTxInitialAction('RETURN');
                        setContainerTxInitialContainerTypeId(ct.id);
                        setIsContainerTxOpen(true);
                      }}
                      className="flex-1 py-1.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-pos-badge rounded-lg transition-colors flex items-center justify-center gap-1"
                    >
                      <ArrowDownLeft className="w-3 h-3" />
                      Retour
                    </button>
                  </div>
                </div>
              ))}
              {containerTypes.length === 0 && (
                <div className="sm:col-span-3 p-8 text-center text-slate-600 text-xs bg-white rounded-2xl border border-slate-200">
                  Aucun type de contenant défini. Cliquez sur « + Nouveau Type de Contenant » ci-dessus pour en ajouter un.
                </div>
              )}
            </div>

            {/* Active Customer Loans Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-700" />
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    Prêts de Contenants en Cours ({customerContainerLoans.length})
                  </h3>
                </div>
              </div>
              {customerContainerLoans.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-600">
                  Aucun prêt de contenant en cours. Tous les contenants sont restitués.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-pos-body border-collapse min-w-[500px]">
                    <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-pos-caption uppercase">
                        <th className="py-2.5 px-3">Client</th>
                        <th className="py-2.5 px-3">Type de Contenant</th>
                        <th className="py-2.5 px-3 text-center">Quantité Due</th>
                        <th className="py-2.5 px-3 text-right">Action Rapide</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {customerContainerLoans.map(loan => (
                        <tr key={`${loan.customer_id}-${loan.container_type_id}`} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-bold text-slate-900">{loan.customer_name}</td>
                          <td className="py-2 px-3 text-slate-700">{loan.container_type_name || loan.container_name}</td>
                          <td className="py-2 px-3 text-center font-bold font-mono text-amber-800 tabular-nums">{loan.quantity_owed}</td>
                          <td className="py-2 px-3 text-right">
                            <button
                              onClick={() => {
                                setContainerTxInitialAction('RETURN');
                                setContainerTxInitialCustomerId(loan.customer_id);
                                setContainerTxInitialContainerTypeId(loan.container_type_id);
                                setIsContainerTxOpen(true);
                              }}
                              className="py-1 px-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-pos-badge rounded-lg transition-colors inline-flex items-center gap-1"
                            >
                              <ArrowDownLeft className="w-3 h-3" />
                              Retourner
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recent Container Movement History */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-slate-600" />
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    Journal des Mouvements de Consignes ({containerTransactions.length})
                  </h3>
                </div>
              </div>
              {containerTransactions.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-600">
                  Aucun mouvement de consigne enregistré.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto overflow-x-auto">
                  <table className="w-full text-left text-pos-body border-collapse min-w-[500px]">
                    <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-pos-caption uppercase">
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Client</th>
                        <th className="py-2.5 px-3">Contenant</th>
                        <th className="py-2.5 px-3 text-center">Opération</th>
                        <th className="py-2.5 px-3 text-center">Quantité</th>
                        <th className="py-2.5 px-3">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {containerTransactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{formatDateTime(tx.date || tx.created_at)}</td>
                          <td className="py-2 px-3 font-bold text-slate-900">{tx.customer_name}</td>
                          <td className="py-2 px-3 text-slate-700">{tx.container_type_name}</td>
                          <td className="py-2 px-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-pos-badge font-bold ${
                              tx.action === 'GIVE'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {tx.action === 'GIVE' ? 'PRÊT (GIVE)' : 'RETOUR (RETURN)'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center font-bold font-mono text-slate-900 tabular-nums">{tx.quantity}</td>
                          <td className="py-2 px-3 text-slate-600 text-pos-badge">{tx.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 7. REGISTER SESSIONS TAB */}
        {activeTab === 'SESSIONS' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-black text-slate-900">Historique des Clôtures de Caisse</h2>
                <p className="text-xs text-slate-500">Suivi des fonds de caisse, ventes espèces, écarts et tickets</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  loadCounters();
                  setIsCountersModalOpen(true);
                }}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Gérer les Caisses ({counters.filter(c => c.is_active).length} Actives)</span>
              </button>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-280px)]">
              <div className="overflow-x-auto overflow-y-auto flex-1">
                <table className="w-full text-left text-pos-body border-collapse min-w-[850px]">
                <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700 uppercase text-pos-caption">
                    <th className="py-2.5 px-3">N° Session</th>
                    <th className="py-2.5 px-3">Caisse</th>
                    <th className="py-2.5 px-3">Ouverture</th>
                    <th className="py-2.5 px-3">Clôture</th>
                    <th className="py-2.5 px-3 text-center">Nbre Ventes</th>
                    <th className="py-2.5 px-3 text-right">Total Ventes</th>
                    <th className="py-2.5 px-3 text-right">Fond Initial</th>
                    <th className="py-2.5 px-3 text-right">Espèces Comptées</th>
                    <th className="py-2.5 px-3 text-right">Écart</th>
                    <th className="py-2.5 px-3 text-center">Statut</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sessions.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono font-bold text-slate-900">{s.session_number}</td>
                      <td className="py-2 px-3 text-slate-700">{s.counter_name}</td>
                      <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{formatDateTime(s.opened_at)}</td>
                      <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{formatDateTime(s.closed_at) || 'En cours'}</td>
                      <td className="py-2 px-3 text-center font-mono font-bold text-slate-800 tabular-nums">{(s as any).sale_count ?? 0}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">{formatMoney((s as any).sales_total ?? 0)}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatMoney(s.opening_cash)}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatMoney(s.closing_cash_counted)}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">
                        {s.variance !== null && s.variance !== undefined ? (
                          <span className={s.variance === 0 ? 'text-emerald-800' : s.variance > 0 ? 'text-blue-800' : 'text-rose-700'}>
                            {formatMoney(s.variance)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-pos-badge font-bold ${
                          s.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handlePrintZReport(s)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-pos-badge inline-flex items-center gap-1 transition-colors"
                            title="Imprimer / Réimprimer Rapport Z"
                          >
                            <Printer className="w-3.5 h-3.5 text-slate-500" />
                            Rapport Z
                          </button>
                          <button
                            onClick={() => handleOpenSessionDetail(s)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-pos-badge inline-flex items-center gap-1 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-500" />
                            Détails
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={11} className="p-8 text-center text-slate-600">
                        Aucune session de caisse enregistrée pour le moment.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>

            {/* Session Drill-down Modal */}
            {isSessionDetailOpen && (
              <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
                <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[calc(100dvh-1rem)] sm:max-h-[85vh] overflow-hidden flex flex-col border border-slate-200">
                  <div className="p-3 sm:p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
                    <div>
                      <h3 className="text-sm font-black text-slate-900">
                        Détail de la Session : {selectedSessionDetail?.session?.session_number || selectedSessionDetail?.session_number || 'Chargement...'}
                      </h3>
                      <p className="text-pos-badge text-slate-600">
                        {selectedSessionDetail?.session?.counter_name || selectedSessionDetail?.counter_name} • Ouverte le : {formatDateTime(selectedSessionDetail?.session?.opened_at || selectedSessionDetail?.opened_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePrintZReport(selectedSessionDetail?.session || selectedSessionDetail)}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Printer className="w-3.5 h-3.5 text-emerald-400" />
                        Réimprimer Rapport Z
                      </button>
                      <button
                        onClick={() => setIsSessionDetailOpen(false)}
                        className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="p-3 sm:p-5 overflow-y-auto min-h-0 flex-1 space-y-4">
                    {loadingSessionDetail ? (
                      <div className="text-center py-12 text-slate-600 text-xs">Chargement des données de session...</div>
                    ) : selectedSessionDetail ? (
                      <>
                        {/* Live Cash Breakdown Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <span className="text-slate-600 text-pos-badge uppercase font-bold block">Fond Initial</span>
                            <span className="font-mono font-bold text-slate-900 text-sm tabular-nums">
                              {formatMoney(selectedSessionDetail?.session?.opening_cash ?? selectedSessionDetail?.opening_cash ?? 0)}
                            </span>
                          </div>
                          <div className="bg-emerald-50/70 p-3 rounded-xl border border-emerald-200">
                            <span className="text-emerald-800 text-pos-badge uppercase font-bold block">Encaissements Espèces</span>
                            <span className="font-mono font-bold text-emerald-900 text-sm tabular-nums">
                              {formatMoney(selectedSessionDetail?.live_cash_breakdown?.cash_sales ?? selectedSessionDetail?.cash_sales ?? 0)}
                            </span>
                          </div>
                          <div className="bg-blue-50/70 p-3 rounded-xl border border-blue-200">
                            <span className="text-blue-800 text-pos-badge uppercase font-bold block">Espèces Attendues</span>
                            <span className="font-mono font-bold text-blue-900 text-sm tabular-nums">
                              {formatMoney(selectedSessionDetail?.live_cash_breakdown?.expected_cash ?? selectedSessionDetail?.session?.expected_cash ?? selectedSessionDetail?.expected_cash ?? 0)}
                            </span>
                          </div>
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <span className="text-slate-600 text-pos-badge uppercase font-bold block">Compté / Écart</span>
                            <span className="font-mono font-bold text-slate-900 text-sm tabular-nums">
                              {(selectedSessionDetail?.session?.closing_cash_counted !== null && selectedSessionDetail?.session?.closing_cash_counted !== undefined)
                                ? `${formatMoney(selectedSessionDetail.session.closing_cash_counted)} (${formatMoney(selectedSessionDetail.session.variance || 0)})`
                                : (selectedSessionDetail?.closing_cash_counted !== null && selectedSessionDetail?.closing_cash_counted !== undefined)
                                ? `${formatMoney(selectedSessionDetail.closing_cash_counted)} (${formatMoney(selectedSessionDetail.variance || 0)})`
                                : 'Session en cours'}
                            </span>
                          </div>
                        </div>

                        {/* Sales List Table */}
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 font-bold text-xs text-slate-700 uppercase tracking-wide">
                            Tickets de Vente de la Session ({selectedSessionDetail.sales?.length || 0})
                          </div>
                          <div className="max-h-56 overflow-y-auto overflow-x-auto">
                            <table className="w-full text-left text-pos-body border-collapse min-w-[550px]">
                              <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                                <tr className="bg-slate-50 text-slate-700 font-bold text-pos-caption uppercase border-b border-slate-200">
                                  <th className="py-2.5 px-3">N° Ticket</th>
                                  <th className="py-2.5 px-3">Heure</th>
                                  <th className="py-2.5 px-3">Client</th>
                                  <th className="py-2.5 px-3 text-right">Total TTC</th>
                                  <th className="py-2.5 px-3 text-right">Espèces Payées</th>
                                  <th className="py-2.5 px-3 text-center">Statut</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {selectedSessionDetail.sales?.map((sale: any) => (
                                  <tr key={sale.id} className="hover:bg-slate-50">
                                    <td className="py-2 px-3 font-mono font-bold text-slate-900">{sale.receipt_number}</td>
                                    <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{formatDateTime(sale.date)}</td>
                                    <td className="py-2 px-3 text-slate-800">{sale.customer_name || 'Client Comptoir'}</td>
                                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">{formatMoney(sale.total_ttc)}</td>
                                    <td className="py-2 px-3 text-right font-mono text-emerald-800 font-bold tabular-nums">{formatMoney(sale.cash_paid)}</td>
                                    <td className="py-2 px-3 text-center">
                                      <span className={`px-1.5 py-0.5 rounded text-pos-badge font-bold ${
                                        sale.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                                      }`}>
                                        {sale.status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                                {(!selectedSessionDetail.sales || selectedSessionDetail.sales.length === 0) && (
                                  <tr>
                                    <td colSpan={6} className="p-4 text-center text-slate-600 text-xs">
                                      Aucune vente enregistrée durant cette session.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Cash Movements Table */}
                        {selectedSessionDetail.movements && selectedSessionDetail.movements.length > 0 && (
                          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 font-bold text-xs text-slate-700 uppercase tracking-wide">
                              Mouvements d'Espèces ({selectedSessionDetail.movements.length})
                            </div>
                            <div className="overflow-x-auto max-h-56 overflow-y-auto">
                              <table className="w-full text-left text-pos-body border-collapse min-w-[400px]">
                                <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                                  <tr className="bg-slate-50 text-slate-700 font-bold text-pos-caption uppercase border-b border-slate-200">
                                    <th className="py-2.5 px-3">Type</th>
                                    <th className="py-2.5 px-3 text-right">Montant</th>
                                    <th className="py-2.5 px-3">Motif</th>
                                    <th className="py-2.5 px-3">Date & Heure</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {selectedSessionDetail.movements.map((m: any) => (
                                    <tr key={m.id}>
                                      <td className="py-2 px-3 font-bold">
                                        <span className={`px-1.5 py-0.5 rounded text-pos-badge ${
                                          m.type === 'CASH_IN' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                        }`}>
                                          {m.type}
                                        </span>
                                      </td>
                                      <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">{formatMoney(m.amount)}</td>
                                      <td className="py-2 px-3 text-slate-700">{m.reason}</td>
                                      <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{formatDateTime(m.created_at || m.date)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {/* Counters Management Modal */}
            {isCountersModalOpen && (
              <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
                <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[calc(100dvh-1rem)] sm:max-h-[85vh] overflow-hidden flex flex-col border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
                  <div className="p-3 sm:p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-slate-200 text-slate-800 flex items-center justify-center">
                        <Settings className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-slate-900">Gestion des Caisses & Terminaux</h3>
                        <p className="text-pos-badge text-slate-600">Configuration des postes d'encaissement et caisses physiques</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsCountersModalOpen(false)}
                      className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-3 sm:p-5 space-y-4 overflow-y-auto min-h-0 flex-1">
                    {/* Add Counter Form */}
                    <form onSubmit={handleCreateCounter} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Nom de la nouvelle caisse (ex. Caisse 2, Caisse Mobile)..."
                        value={newCounterName}
                        onChange={e => setNewCounterName(e.target.value)}
                        className="flex-1 text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none"
                      />
                      <button
                        type="submit"
                        className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl text-xs flex items-center gap-1 shadow-sm transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Ajouter</span>
                      </button>
                    </form>
                    {counterError && (
                      <p className="text-xs text-rose-600 font-semibold">{counterError}</p>
                    )}

                    {/* Counters Table */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                      <table className="w-full text-left border-collapse text-pos-body">
                        <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                          <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700 uppercase text-pos-caption">
                            <th className="py-2.5 px-3">Nom de la Caisse</th>
                            <th className="py-2.5 px-3 text-center">Statut</th>
                            <th className="py-2.5 px-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {counters.map(c => (
                            <tr key={c.id} className="hover:bg-slate-50">
                              <td className="py-2 px-3 font-bold text-slate-800">{c.name}</td>
                              <td className="py-2 px-3 text-center">
                                <span className={`px-2 py-0.5 rounded text-pos-badge font-bold ${
                                  c.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {c.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right">
                                {c.is_active ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteCounter(c)}
                                    className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors"
                                    title="Désactiver / Supprimer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <span className="text-pos-badge text-slate-500 italic">Désactivée</span>
                                )}
                              </td>
                            </tr>
                          ))}
                          {counters.length === 0 && (
                            <tr>
                              <td colSpan={3} className="p-4 text-center text-slate-600">
                                Aucune caisse configurée.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsCountersModalOpen(false)}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100 transition-colors"
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 8. ACCOUNTING TAB */}
        {activeTab === 'ACCOUNTING' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">Flux de Trésorerie & Valorisation des Stocks</h2>
                <p className="text-xs text-slate-500">Aperçu en temps réel du grand livre, des flux de trésorerie et de la valeur des actifs</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setInventoryAdjDefaultType('PRODUCT');
                    setIsInventoryAdjustmentOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2 rounded-xl transition-colors border border-slate-300"
                >
                  <Scale className="w-4 h-4 text-slate-500" />
                  Ajustement de Stock
                </button>
                <button
                  onClick={() => setIsCreateExpenseOpen(true)}
                  className="flex items-center gap-1.5 bg-rose-700 hover:bg-rose-800 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition-colors"
                >
                  <Receipt className="w-4 h-4" />
                  + Nouvelle Dépense
                </button>
              </div>
            </div>
            {accountingData && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Cash Flow Statement */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                  <h3 className="text-sm font-bold text-slate-900">Encaissements vs Décaissements</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Total Ventes Espèces :</span>
                      <span className="font-mono font-bold text-emerald-800 tabular-nums">
                        {formatMoney(accountingData.cashFlow?.money_in?.sales_cash || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Recouvrement Créances Clients :</span>
                      <span className="font-mono font-bold text-emerald-800 tabular-nums">
                        {formatMoney(accountingData.cashFlow?.money_in?.customer_debt_repayments || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Règlements Achats Fournisseurs :</span>
                      <span className="font-mono font-bold text-rose-700 tabular-nums">
                        {formatMoney(accountingData.cashFlow?.money_out?.paid_purchases || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Dépenses Générales Payées :</span>
                      <span className="font-mono font-bold text-rose-700 tabular-nums">
                        {formatMoney(accountingData.cashFlow?.money_out?.general_expenses || 0)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-slate-200 flex justify-between text-sm font-black text-slate-900">
                      <span>Position Nette de Trésorerie :</span>
                      <span className="font-mono text-base text-blue-800 tabular-nums">
                        {formatMoney(accountingData.cashFlow?.net_cash_flow || 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Stock Valuation at Cost */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                  <h3 className="text-sm font-bold text-slate-900">Valorisation des Stocks au Coût d'Achat</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Valeur Stock Matières Premières :</span>
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {formatMoney(accountingData.stockValuation?.raw_materials_valuation || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Valeur Stock Produits Finis :</span>
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {formatMoney(accountingData.stockValuation?.finished_goods_valuation || 0)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-slate-200 flex justify-between text-sm font-black text-slate-900">
                      <span>Valeur Totale des Stocks :</span>
                      <span className="font-mono text-base text-emerald-800 tabular-nums">
                        {formatMoney(accountingData.stockValuation?.total_stock_valuation || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* General Expenses Log Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-6">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-rose-600" />
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    Journal des Dépenses Générales ({expensesHistory.length})
                  </h3>
                </div>
                <button
                  onClick={() => setIsCreateExpenseOpen(true)}
                  className="px-2.5 py-1 bg-rose-700 hover:bg-rose-800 text-white font-bold rounded-lg text-pos-badge inline-flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  + Ajouter Dépense
                </button>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-pos-body border-collapse min-w-[600px]">
                  <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-pos-caption uppercase">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Catégorie</th>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3">Mode de Règlement</th>
                      <th className="py-2.5 px-3 text-right">Montant</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {expensesHistory.map(exp => (
                      <tr key={exp.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{formatDateTime(exp.date || exp.created_at)}</td>
                        <td className="py-2 px-3">
                          <span className="px-1.5 py-0.5 rounded text-pos-badge font-bold bg-slate-100 text-slate-800">
                            {exp.category}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-800 font-medium">{exp.description || '—'}</td>
                        <td className="py-2 px-3 text-slate-700 font-mono text-pos-badge">{exp.payment_source}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-rose-700 tabular-nums">{formatMoney(exp.amount)}</td>
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => handleDeleteExpense(exp)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors inline-flex items-center"
                            title="Supprimer la dépense"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {expensesHistory.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-600">
                          Aucune dépense générale enregistrée pour le moment. Cliquez sur « + Nouvelle Dépense » pour enregistrer le loyer, l'électricité ou les fournitures.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 9. REPORTS TAB */}
        {activeTab === 'REPORTS' && <ReportsTab />}

        {/* 10. BACKUPS TAB */}
        {activeTab === 'BACKUPS' && <BackupManager />}

        {/* 11. SETTINGS TAB */}
        {activeTab === 'SETTINGS' && <ShopSettingsPanel />}
      </main>

      {/* 1. Create Product / SKU Modal */}
      <CreateProductModal
        isOpen={isCreateProductOpen}
        onClose={() => {
          setIsCreateProductOpen(false);
          setFamilyToEdit(null);
          setProductToEdit(null);
        }}
        onSuccess={() => {
          onRefreshData();
          loadBackofficeData();
        }}
        families={families}
        formulations={formulations}
        containerTypes={containerTypes}
        familyToEdit={familyToEdit}
        productToEdit={productToEdit}
        onSwitchToEdit={setProductToEdit}
      />

      {/* 2. Create Raw Material Modal */}
      <CreateMaterialModal
        isOpen={isCreateMaterialOpen}
        onClose={() => {
          setIsCreateMaterialOpen(false);
          setMaterialToEdit(null);
        }}
        onSuccess={() => {
          onRefreshData();
          loadBackofficeData();
        }}
        suppliers={suppliers}
        materialToEdit={materialToEdit}
      />

      {/* 2b. Material Price History Modal */}
      <MaterialPriceHistoryModal
        isOpen={Boolean(materialForPriceHistory)}
        material={materialForPriceHistory}
        onClose={() => setMaterialForPriceHistory(null)}
      />

      {/* 3. Create Formulation Modal */}
      <CreateFormulationModal
        isOpen={isCreateFormulationOpen}
        onClose={() => {
          setIsCreateFormulationOpen(false);
          setFormulationToEdit(null);
        }}
        onSuccess={() => {
          onRefreshData();
          loadBackofficeData();
        }}
        materials={materials}
        formulationToEdit={formulationToEdit}
      />

      {/* 4. Create Customer Modal */}
      <CreateCustomerModal
        isOpen={isCreateCustomerOpen}
        onClose={() => {
          setIsCreateCustomerOpen(false);
          setCustomerToEdit(null);
        }}
        onSuccess={() => {
          onRefreshData();
          loadBackofficeData();
        }}
        customerToEdit={customerToEdit}
      />

      {/* 5. Create Supplier Modal */}
      <CreateSupplierModal
        isOpen={isCreateSupplierOpen}
        onClose={() => {
          setIsCreateSupplierOpen(false);
          setSupplierToEdit(null);
        }}
        onSuccess={() => {
          onRefreshData();
          loadBackofficeData();
        }}
        supplierToEdit={supplierToEdit}
      />

      {/* 6. Create Container Type Modal */}
      <CreateContainerModal
        isOpen={isCreateContainerOpen}
        onClose={() => {
          setIsCreateContainerOpen(false);
          setContainerTypeToEdit(null);
        }}
        onSuccess={() => {
          onRefreshData();
          loadBackofficeData();
        }}
        containerTypeToEdit={containerTypeToEdit}
      />

      {/* 6b. Container Give / Return Transaction Modal */}
      <ContainerTransactionModal
        isOpen={isContainerTxOpen}
        onClose={() => setIsContainerTxOpen(false)}
        onSuccess={() => {
          onRefreshData();
          loadBackofficeData();
        }}
        customers={customers}
        containerTypes={containerTypes}
        initialAction={containerTxInitialAction}
        initialCustomerId={containerTxInitialCustomerId}
        initialContainerTypeId={containerTxInitialContainerTypeId}
      />

      {/* 7. Inventory Stock Adjustment Modal */}
      <InventoryAdjustmentModal
        isOpen={isInventoryAdjustmentOpen}
        onClose={() => setIsInventoryAdjustmentOpen(false)}
        onSuccess={() => {
          onRefreshData();
          loadBackofficeData();
        }}
        products={products}
        materials={materials}
        initialType={inventoryAdjDefaultType}
      />

      {/* 8. Record General Expense Modal */}
      <CreateExpenseModal
        isOpen={isCreateExpenseOpen}
        onClose={() => setIsCreateExpenseOpen(false)}
        onSuccess={() => {
          onRefreshData();
          loadBackofficeData();
        }}
        activeSessionId={activeSession?.id}
      />

      {/* Printable Shelf Barcode Sticker Modal */}
      <BarcodeLabelPrinter
        isOpen={isBarcodeLabelModalOpen}
        onClose={() => setIsBarcodeLabelModalOpen(false)}
        products={products}
      />

      {/* Confirm Delete Confirmation Dialog */}
      <ConfirmDeleteModal
        isOpen={deleteModalState.isOpen}
        onClose={() => setDeleteModalState(prev => ({ ...prev, isOpen: false }))}
        onConfirm={deleteModalState.onConfirm}
        title={deleteModalState.title}
        itemName={deleteModalState.itemName}
        message={deleteModalState.message}
      />

      {/* Central Category Management Modal */}
      <ManageCategoriesModal
        isOpen={isCategoriesModalOpen}
        onClose={() => setIsCategoriesModalOpen(false)}
        onSuccess={() => {
          onRefreshData();
          loadBackofficeData();
        }}
      />

      {/* Customer Statement & Ledger Modal */}
      <CustomerStatementModal
        isOpen={isCustomerStatementOpen}
        onClose={() => setIsCustomerStatementOpen(false)}
        customer={selectedCustomer}
      />

      {/* Batch Cost & Size Volume Backfill Modal */}
      <BatchCostBackfillModal
        isOpen={isBatchCostModalOpen}
        onClose={() => setIsBatchCostModalOpen(false)}
        onSuccess={() => {
          onRefreshData();
          loadBackofficeData();
        }}
      />
    </div>
  );
};
