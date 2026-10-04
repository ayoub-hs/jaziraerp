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

interface BackofficeProps {
  products: Product[];
  families: ProductFamily[];
  customers: Customer[];
  containerTypes: ContainerType[];
  onRefreshData: () => void;
  activeSession?: RegisterSession | null;
}

type BackofficeTab = 
  | 'CATALOG' 
  | 'MATERIALS' 
  | 'PRODUCTION' 
  | 'CUSTOMERS' 
  | 'SUPPLIERS' 
  | 'CONTAINERS' 
  | 'SESSIONS' 
  | 'ACCOUNTING'
  | 'REPORTS'
  | 'BACKUPS';

export const Backoffice: React.FC<BackofficeProps> = ({
  products,
  families,
  customers,
  containerTypes,
  onRefreshData,
  activeSession
}) => {
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
  const [isBatchWizardOpen, setIsBatchWizardOpen] = useState(false);
  const [selectedFormulationId, setSelectedFormulationId] = useState('');
  const [batchVolume, setBatchVolume] = useState('100');
  const [targetProductId, setTargetProductId] = useState('');
  const [unitsProduced, setUnitsProduced] = useState('100');
  const [batchResult, setBatchResult] = useState<any>(null);

  // Supplier Payment / Purchase state
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);

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

  // Supplier ledger drill-down & debt payment
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierTickets, setSupplierTickets] = useState<SupplierDebtTicket[]>([]);
  const [supplierDebtPayAmount, setSupplierDebtPayAmount] = useState('');
  const [supplierActionNotice, setSupplierActionNotice] = useState<string | null>(null);
  const [isPayingSupplierDebt, setIsPayingSupplierDebt] = useState(false);
  const isPayingSupplierDebtRef = useRef(false);

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
  const [purchasesHistory, setPurchasesHistory] = useState<any[]>([]);
  const [expensesHistory, setExpensesHistory] = useState<any[]>([]);
  const [inventoryAdjustments, setInventoryAdjustments] = useState<any[]>([]);
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<any | null>(null);
  const [isSessionDetailOpen, setIsSessionDetailOpen] = useState(false);
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
        const batchRes = await fetch('/api/production/batches');
        if (batchRes.ok) setProductionBatches(await batchRes.json());
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
      const res = await fetch(`/api/suppliers/${selectedSupplier.id}/debt/repay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      if (res.ok) {
        setSupplierActionNotice(`Recorded debt payment of ${formatMoney(amount)} to ${selectedSupplier.name}.`);
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
        setSupplierActionNotice(`Error: ${data.error || `Payment failed (${res.status})`}`);
      }
    } catch (err: any) {
      console.warn('Supplier debt payment failed:', err);
      setSupplierActionNotice(`Error: ${err.message || 'Payment failed'}`);
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
      const res = await fetch(`/api/customers/${selectedCustomer.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      if (res.ok) {
        setActionNotice(`Recorded debt payment of ${formatMoney(amount)}.`);
        setDebtPayAmount('');
        handleSelectCustomerForTickets(selectedCustomer);
        onRefreshData();
      } else {
        const data = await res.json().catch(() => ({}));
        setActionNotice(`Error: ${data.error || `Payment failed (${res.status})`}`);
      }
    } catch (err: any) {
      console.warn('Payment failed:', err);
      setActionNotice(`Error: ${err.message || 'Payment failed'}`);
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
        setActionNotice(`Wallet topped up with ${formatMoney(amount)}.`);
        setWalletTopUpAmount('');
        onRefreshData();
      } else {
        const data = await res.json().catch(() => ({}));
        setActionNotice(`Error: ${data.error || `Top up failed (${res.status})`}`);
      }
    } catch (err: any) {
      console.warn('Topup failed:', err);
      setActionNotice(`Error: ${err.message || 'Top up failed'}`);
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
        setBatchResult({ error: data.error || `Batch wizard failed (${res.status})` });
      }
    } catch (err: any) {
      console.warn('Batch wizard failed:', err);
      setBatchResult({ error: err.message || 'Batch wizard failed' });
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
      title: 'Delete Product SKU',
      itemName: prod.name,
      message: `Are you sure you want to delete "${prod.name}"? If referenced by past sales, batches, purchases, or inventory adjustments, deletion will be rejected.`,
      onConfirm: async () => {
        const res = await fetch(`/api/products/${prod.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to delete product SKU');
        }
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteFamily = (fam: ProductFamily) => {
    confirmDelete({
      title: 'Delete Product Family',
      itemName: fam.name,
      message: `Are you sure you want to delete family "${fam.name}"? All associated SKUs will be safely deactivated and archived.`,
      onConfirm: async () => {
        const res = await fetch(`/api/products/families/${fam.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to delete product family');
        }
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteMaterial = (mat: RawMaterial) => {
    confirmDelete({
      title: 'Delete Raw Material',
      itemName: mat.name,
      message: `Are you sure you want to delete "${mat.name}"? If used in formulations, batches, purchases, or inventory adjustments, deletion will be rejected.`,
      onConfirm: async () => {
        const res = await fetch(`/api/materials/${mat.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to delete raw material');
        }
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteCustomer = (cust: Customer) => {
    confirmDelete({
      title: 'Delete Customer',
      itemName: cust.name,
      message: `Are you sure you want to delete customer "${cust.name}"? If they have past sales, debt tickets, or containers, they will be safely deactivated.`,
      onConfirm: async () => {
        const res = await fetch(`/api/customers/${cust.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to delete customer');
        }
        if (selectedCustomer?.id === cust.id) setSelectedCustomer(null);
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteSupplier = (sup: Supplier) => {
    confirmDelete({
      title: 'Delete Supplier',
      itemName: sup.name,
      message: `Are you sure you want to delete supplier "${sup.name}"? If they have past purchase invoices or open debts, they will be safely deactivated.`,
      onConfirm: async () => {
        const res = await fetch(`/api/suppliers/${sup.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to delete supplier');
        }
        if (selectedSupplier?.id === sup.id) setSelectedSupplier(null);
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteContainerType = (ct: ContainerType) => {
    confirmDelete({
      title: 'Delete Container Type',
      itemName: ct.name,
      message: `Are you sure you want to delete "${ct.name}"? If currently loaned out or linked to products, it will be safely deactivated.`,
      onConfirm: async () => {
        const res = await fetch(`/api/containers/types/${ct.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to delete container type');
        }
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteExpense = (exp: any) => {
    confirmDelete({
      title: 'Delete Expense',
      itemName: `${exp.category} (${formatMoney(exp.amount)})`,
      message: `Are you sure you want to delete this expense entry of ${formatMoney(exp.amount)}?`,
      onConfirm: async () => {
        const res = await fetch(`/api/accounting/expenses/${exp.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to delete expense');
        }
        loadBackofficeData();
      }
    });
  };

  const handleDeleteAdjustment = (adj: any) => {
    confirmDelete({
      title: 'Revert & Delete Stock Adjustment',
      itemName: `${adj.item_name} (${adj.quantity_delta > 0 ? `+${adj.quantity_delta}` : adj.quantity_delta})`,
      message: `Are you sure you want to revert and remove this stock adjustment? The stock quantity will be reversed by ${adj.quantity_delta > 0 ? `-${adj.quantity_delta}` : `+${Math.abs(adj.quantity_delta)}`}.`,
      onConfirm: async () => {
        const res = await fetch(`/api/inventory/adjustments/${adj.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to revert adjustment');
        }
        onRefreshData();
        loadBackofficeData();
      }
    });
  };

  const handleDeleteCounter = (counter: { id: string; name: string }) => {
    confirmDelete({
      title: 'Delete / Deactivate Counter',
      itemName: counter.name,
      message: `Are you sure you want to remove register "${counter.name}"? If it has historical sessions, it will be safely deactivated so past receipts are preserved.`,
      onConfirm: async () => {
        const res = await fetch(`/api/register/counters/${counter.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to remove counter');
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
        setCounterError(data.error || 'Failed to add counter');
        return;
      }
      setNewCounterName('');
      await loadCounters();
    } catch (err: any) {
      setCounterError(err.message || 'Error creating counter');
    }
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row bg-slate-100 overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-56 bg-slate-900 text-slate-300 flex md:flex-col shrink-0 overflow-x-auto border-r border-slate-800">
        <div className="p-3 border-b border-slate-800 hidden md:block">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Administration
          </span>
        </div>
        <nav className="flex md:flex-col p-1.5 gap-1 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('CATALOG')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'CATALOG' ? 'bg-emerald-600 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Catalog & SKUs</span>
          </button>
          <button
            onClick={() => setActiveTab('MATERIALS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'MATERIALS' ? 'bg-emerald-600 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <FlaskConical className="w-4 h-4" />
            <span>Raw Materials</span>
          </button>
          <button
            onClick={() => setActiveTab('PRODUCTION')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'PRODUCTION' ? 'bg-emerald-600 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Production Wizard</span>
          </button>
          <button
            onClick={() => setActiveTab('CUSTOMERS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'CUSTOMERS' ? 'bg-emerald-600 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Customers & Debt</span>
          </button>
          <button
            onClick={() => setActiveTab('SUPPLIERS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'SUPPLIERS' ? 'bg-emerald-600 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Truck className="w-4 h-4" />
            <span>Suppliers & Purchases</span>
          </button>
          <button
            onClick={() => setActiveTab('CONTAINERS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'CONTAINERS' ? 'bg-emerald-600 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Box className="w-4 h-4" />
            <span>Containers</span>
          </button>
          <button
            onClick={() => setActiveTab('SESSIONS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'SESSIONS' ? 'bg-emerald-600 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Register Audits</span>
          </button>
          <button
            onClick={() => setActiveTab('ACCOUNTING')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'ACCOUNTING' ? 'bg-emerald-600 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Accounting Ledger</span>
          </button>
          <button
            onClick={() => setActiveTab('REPORTS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'REPORTS' ? 'bg-emerald-600 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Reports</span>
          </button>
          <button
            onClick={() => setActiveTab('BACKUPS')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'BACKUPS' ? 'bg-emerald-600 text-white shadow-sm' : 'hover:bg-slate-800'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Database Backups</span>
          </button>
        </nav>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 p-4 md:p-6 overflow-y-auto">
        {/* 1. CATALOG TAB */}
        {activeTab === 'CATALOG' && (
          <div className="space-y-4">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">Product Catalog & SKUs</h2>
                <p className="text-xs text-slate-500">Manage manufactured and resale items, pricing, and stock</p>
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
                  Stock Adjustment
                </button>
                <button
                  type="button"
                  onClick={() => setIsCategoriesModalOpen(true)}
                  className="flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-bold px-3 py-2 rounded-xl transition-colors border border-purple-200"
                >
                  <Layers className="w-4 h-4 text-purple-600" />
                  Manage Categories
                </button>
                <button
                  onClick={() => {
                    setFamilyToEdit(null);
                    setProductToEdit(null);
                    setIsCreateProductOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-sm transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  New Product / SKU
                </button>
                <button
                  onClick={() => setIsBarcodeLabelModalOpen(true)}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-sm transition-colors"
                >
                  <Printer className="w-4 h-4 text-emerald-400" />
                  Print Barcode Labels
                </button>
              </div>
            </div>

            {/* Product Families Section */}
            {families.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Product Families ({families.length})
                  </h3>
                  <span className="text-[11px] text-slate-500">Click &quot;Edit&quot; to modify family category, manufacturing type, or recipe</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {families.map(f => (
                    <div key={f.id} className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
                      <div>
                        <div className="font-bold text-xs text-slate-900">{f.name}</div>
                        <div className="text-[10px] text-slate-500">
                          {f.category} • <span className={f.type === 'MANUFACTURED' ? 'text-emerald-700 font-semibold' : 'text-blue-700 font-semibold'}>{f.type}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setProductToEdit(null);
                            setFamilyToEdit(f);
                            setIsCreateProductOpen(true);
                          }}
                          className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg border border-slate-200 text-[11px] flex items-center gap-1 transition-colors shadow-2xs"
                        >
                          <Edit2 className="w-3 h-3 text-slate-500" />
                          Edit Family
                        </button>
                        <button
                          onClick={() => handleDeleteFamily(f)}
                          className="p-1.5 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg border border-slate-200 transition-colors shadow-2xs"
                          title="Delete Family"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px]">
                    <th className="p-3">Product Name</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Size</th>
                    <th className="p-3">Barcode (Code-128)</th>
                    <th className="p-3 text-right">Cost Ref.</th>
                    <th className="p-3 text-right">Retail (TTC)</th>
                    <th className="p-3 text-right">Wholesale (TTC)</th>
                    <th className="p-3 text-center">Stock</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-900">{p.name}</td>
                      <td className="p-3 text-slate-500">{p.category}</td>
                      <td className="p-3">
                        <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-semibold text-[10px]">
                          {p.size_label || 'Piece'}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-[11px] text-slate-600">{p.barcode || '—'}</td>
                      <td className="p-3 text-right font-mono text-slate-500">{formatMoney(p.cost_reference)}</td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-700">{formatMoney(p.retail_price)}</td>
                      <td className="p-3 text-right font-mono text-blue-700">{formatMoney(p.wholesale_price)}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded font-bold font-mono text-[11px] ${
                          p.stock_quantity <= p.low_stock_threshold ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {p.stock_quantity}
                        </span>
                      </td>
                      <td className="p-3 text-right whitespace-nowrap space-x-1.5">
                        <button
                          onClick={() => {
                            setFamilyToEdit(null);
                            setProductToEdit(p);
                            setIsCreateProductOpen(true);
                          }}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[11px] inline-flex items-center gap-1 transition-colors"
                        >
                          <Edit2 className="w-3 h-3 text-slate-500" />
                          Edit SKU
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(p)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors inline-flex items-center"
                          title="Delete SKU"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400">
                        No products in catalog yet. Click &quot;+ New Product / SKU&quot; above to create one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 2. MATERIALS TAB */}
        {activeTab === 'MATERIALS' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">Raw Materials & Packaging</h2>
                <p className="text-xs text-slate-500">Track chemicals, packaging, unit costs, and inventory</p>
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
                  Stock Adjustment
                </button>
                <button
                  type="button"
                  onClick={() => setIsCategoriesModalOpen(true)}
                  className="flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-bold px-3 py-2 rounded-xl transition-colors border border-purple-200"
                >
                  <Layers className="w-4 h-4 text-purple-600" />
                  Manage Categories
                </button>
                <button
                  onClick={() => {
                    setMaterialToEdit(null);
                    setIsCreateMaterialOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-sm transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  New Material
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px]">
                    <th className="p-3">Material Name</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Unit</th>
                    <th className="p-3 text-right">Cost / Unit</th>
                    <th className="p-3 text-center">Stock</th>
                    <th className="p-3">Latest Supplier</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {materials.map(m => {
                    const cat = m.category || m.type || 'General';
                    const cost = m.current_cost_per_unit ?? m.latest_purchase_cost ?? 0;
                    return (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="p-3 font-bold text-slate-900">{m.name}</td>
                        <td className="p-3">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">
                            {cat}
                          </span>
                        </td>
                        <td className="p-3 text-slate-600 font-semibold">{m.unit}</td>
                        <td className="p-3 text-right font-mono font-bold text-slate-900">{formatMoney(cost)}</td>
                        <td className="p-3 text-center font-mono font-bold text-slate-800">
                          <span className={`px-2 py-0.5 rounded font-bold font-mono text-[11px] ${
                            m.stock_quantity <= (m.low_stock_threshold || 0) ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {m.stock_quantity}
                          </span>
                        </td>
                        <td className="p-3 text-slate-500">{m.latest_supplier_name || '—'}</td>
                        <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => {
                              setMaterialToEdit(m);
                              setIsCreateMaterialOpen(true);
                            }}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[11px] inline-flex items-center gap-1 transition-colors"
                          >
                            <Edit2 className="w-3 h-3 text-slate-500" />
                            Edit
                          </button>
                          <button
                            onClick={() => setMaterialForPriceHistory(m)}
                            className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg text-[11px] inline-flex items-center gap-1 transition-colors"
                          >
                            <TrendingUp className="w-3 h-3 text-blue-500" />
                            Price History
                          </button>
                          <button
                            onClick={() => handleDeleteMaterial(m)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors inline-flex items-center"
                            title="Delete Material"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {materials.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        No raw materials recorded yet. Click &quot;+ New Material&quot; above to create one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Inventory Adjustments Audit Log */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-6">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="w-4 h-4 text-slate-600" />
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    Inventory Adjustments Audit Log ({inventoryAdjustments.length})
                  </h3>
                </div>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase">
                      <th className="p-3">Date</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Item</th>
                      <th className="p-3">Reason</th>
                      <th className="p-3 text-center">Delta</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inventoryAdjustments.map(adj => (
                      <tr key={adj.id} className="hover:bg-slate-50">
                        <td className="p-3 text-slate-500 font-mono text-[11px]">{formatDateTime(adj.date || adj.created_at)}</td>
                        <td className="p-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            adj.item_type === 'RAW_MATERIAL' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {adj.item_type}
                          </span>
                        </td>
                        <td className="p-3 font-bold text-slate-900">{adj.item_name || '—'}</td>
                        <td className="p-3 text-slate-600">{adj.reason}</td>
                        <td className="p-3 text-center font-mono font-bold">
                          <span className={adj.quantity_delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                            {adj.quantity_delta > 0 ? `+${adj.quantity_delta}` : adj.quantity_delta} {adj.unit_or_size || ''}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleDeleteAdjustment(adj)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors inline-flex items-center"
                            title="Revert & Delete Adjustment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {inventoryAdjustments.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-slate-400">
                          No stock adjustments recorded yet.
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
                <h2 className="text-lg font-black text-slate-900">Batch Production Wizard</h2>
                <p className="text-xs text-slate-500">
                  Produce manufactured items, automatically deducting proportional raw materials and updating unit costs
                </p>
              </div>
              <button
                onClick={() => setIsCreateFormulationOpen(true)}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Formulation
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Production Form */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                <form onSubmit={handleRunBatchWizard} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      1. Select Formulation (Recipe) *
                    </label>
                    <select
                      value={selectedFormulationId}
                      onChange={e => setSelectedFormulationId(e.target.value)}
                      required
                      className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl"
                    >
                      <option value="">Choose formulation...</option>
                      {formulations.map(f => (
                        <option key={f.id} value={f.id}>
                          {f.name} (Est. {formatMoney(f.cost_per_liter)} / L)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Batch Volume (Liters) *
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        required
                        value={batchVolume}
                        onChange={e => setBatchVolume(e.target.value)}
                        className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Units Produced *
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        required
                        value={unitsProduced}
                        onChange={e => setUnitsProduced(e.target.value)}
                        className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      2. Target Product SKU *
                    </label>
                    <select
                      value={targetProductId}
                      onChange={e => setTargetProductId(e.target.value)}
                      required
                      className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl"
                    >
                      <option value="">Choose target SKU to restock...</option>
                      {products
                        .filter(p => p.product_type === 'MANUFACTURED' || !p.product_type)
                        .map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.size_label || 'Piece'}) — Current Stock: {p.stock_quantity}
                          </option>
                        ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={isExecutingBatch}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl shadow text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <FlaskConical className="w-4 h-4" />
                    {isExecutingBatch ? 'Executing Batch...' : 'Execute Production Batch'}
                  </button>
                </form>
              </div>

              {/* Batch Execution Results */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 flex flex-col justify-center">
                {batchResult ? (
                  batchResult.error ? (
                    <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{batchResult.error}</span>
                    </div>
                  ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
                      <Check className="w-5 h-5" />
                      <span>Batch Completed Successfully!</span>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1 font-mono">
                      <div>Batch Number: <span className="font-bold">{batchResult.batch_number}</span></div>
                      <div>Total Cost: <span className="font-bold">{formatMoney(batchResult.total_batch_cost)}</span></div>
                      <div>Cost / Unit: <span className="font-bold text-emerald-700">{formatMoney(batchResult.cost_per_unit)}</span></div>
                    </div>
                    {batchResult.warnings && batchResult.warnings.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-xs text-amber-800 space-y-1">
                        <span className="font-bold block flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Stock Deficit Warnings (Allowed to proceed into negative):
                        </span>
                        {batchResult.warnings.map((w: string, i: number) => (
                          <div key={i}>• {w}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )) : (
                  <div className="text-center text-slate-400 text-xs py-12">
                    Fill the form on the left to execute a production run.
                  </div>
                )}
              </div>
            </div>

            {/* Saved Formulations / Recipes */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Configured Formulations & Recipes ({formulations.length})
                </h3>
                <span className="text-[11px] text-slate-500">Edit materials, proportions, or test batch cost preview</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {formulations.map(f => (
                  <div key={f.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-xs text-slate-900">{f.name}</h4>
                      <p className="text-[11px] text-slate-500">
                        Base: <span className="font-semibold text-slate-700">{f.base_volume || (f as any).base_volume_liters || 100}L</span> • Est: <span className="font-bold font-mono text-emerald-700">{formatMoney(f.cost_per_liter)}/L</span>
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setFormulationToEdit(f);
                        setIsCreateFormulationOpen(true);
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg border border-slate-200 text-[11px] flex items-center gap-1 transition-colors shadow-2xs"
                    >
                      <Edit2 className="w-3 h-3 text-slate-500" />
                      View / Edit
                    </button>
                  </div>
                ))}
                {formulations.length === 0 && (
                  <div className="col-span-3 text-center py-6 text-slate-400 text-xs">
                    No recipes configured yet. Click &quot;+ New Formulation&quot; to build a formulation recipe.
                  </div>
                )}
              </div>
            </div>

            {/* Production Batch History Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-emerald-600" />
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    Production Batch History ({productionBatches.length})
                  </h3>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase">
                      <th className="p-3">Batch #</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Recipe</th>
                      <th className="p-3">Restocked SKU</th>
                      <th className="p-3 text-center">Batch Vol</th>
                      <th className="p-3 text-center">Units Produced</th>
                      <th className="p-3 text-right">Cost / Unit</th>
                      <th className="p-3 text-right">Total Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {productionBatches.map(b => (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="p-3 font-mono font-bold text-slate-900">{b.batch_number}</td>
                        <td className="p-3 text-slate-500 text-[11px]">{formatDateTime(b.date || b.created_at)}</td>
                        <td className="p-3 font-semibold text-slate-800">{b.formulation_name}</td>
                        <td className="p-3 font-bold text-slate-900">{b.target_product_name} {b.size_label ? `(${b.size_label})` : ''}</td>
                        <td className="p-3 text-center font-mono font-bold text-slate-800">{b.batch_volume_liters}L</td>
                        <td className="p-3 text-center font-mono font-bold text-slate-800">{b.units_produced}</td>
                        <td className="p-3 text-right font-mono font-bold text-emerald-700">{formatMoney(b.cost_per_unit)}</td>
                        <td className="p-3 text-right font-mono font-bold text-slate-900">{formatMoney(b.total_batch_cost)}</td>
                      </tr>
                    ))}
                    {productionBatches.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400">
                          No production batches recorded yet. Execute a batch using the wizard above.
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
                <h2 className="text-lg font-black text-slate-900">Customer Balances & Debt Tickets</h2>
                <p className="text-xs text-slate-500">Manage customer accounts, wallet deposits, and track open debt tickets</p>
              </div>
              <button
                onClick={() => {
                  setCustomerToEdit(null);
                  setIsCreateCustomerOpen(true);
                }}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Customer
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
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide px-1">
                  Customer Directory
                </h3>
                {customers.map(c => (
                  <div
                    key={c.id}
                    onClick={() => handleSelectCustomerForTickets(c)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedCustomer?.id === c.id
                        ? 'border-emerald-500 bg-emerald-50/50 shadow-sm'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-xs text-slate-900">{c.name}</h4>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                          {c.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCustomerToEdit(c);
                            setIsCreateCustomerOpen(true);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
                          title="Edit Customer"
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
                          title="Delete Customer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-2 text-[11px]">
                      <span className="text-slate-500">Wallet: {formatMoney(c.wallet_balance)}</span>
                      <span className={`font-bold font-mono ${c.total_debt ? 'text-amber-700' : 'text-slate-400'}`}>
                        Debt: {formatMoney(c.total_debt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Customer Detail & Actions */}
              <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
                {selectedCustomer ? (
                  <>
                    <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                      <div>
                        <h3 className="text-base font-black text-slate-900">{selectedCustomer.name}</h3>
                        <p className="text-xs text-slate-500">{selectedCustomer.phone || 'No phone'} • {selectedCustomer.address || 'No address'}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-500 block">Total Open Debt:</span>
                        <span className="text-lg font-black text-amber-700 font-mono">
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
                          Record Debt Repayment (FIFO)
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
                            className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg text-xs shrink-0 transition-colors"
                          >
                            {isPayingCustomerDebt ? 'Paying...' : 'Pay'}
                          </button>
                        </div>
                      </div>

                      {/* Wallet Top-up */}
                      <div className="bg-purple-50/70 p-3 rounded-xl border border-purple-200 space-y-2">
                        <span className="text-xs font-bold text-purple-900 block flex items-center gap-1">
                          <Wallet className="w-3.5 h-3.5" />
                          Deposit into Customer Wallet
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
                            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg text-xs shrink-0 transition-colors"
                          >
                            {isToppingUpWallet ? 'Top Up...' : 'Top Up'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Open Debt Tickets Table */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Open Debt Tickets
                      </h4>
                      <div className="border border-slate-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 font-bold text-slate-600 uppercase text-[10px]">
                              <th className="p-2">Ticket #</th>
                              <th className="p-2">Date</th>
                              <th className="p-2 text-right">Original Total</th>
                              <th className="p-2 text-right">Remaining Due</th>
                              <th className="p-2 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {customerTickets.map(t => (
                              <tr key={t.id}>
                                <td className="p-2 font-mono font-bold text-slate-900">{t.ticket_number}</td>
                                <td className="p-2 text-slate-500">{formatDate(t.date)}</td>
                                <td className="p-2 text-right font-mono">{formatMoney(t.total_amount)}</td>
                                <td className="p-2 text-right font-mono font-bold text-amber-700">{formatMoney(t.remaining_amount)}</td>
                                <td className="p-2 text-center">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    t.is_overdue ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                                  }`}>
                                    {t.is_overdue ? 'Overdue >30d' : t.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {customerTickets.length === 0 && (
                              <tr>
                                <td colSpan={5} className="p-4 text-center text-slate-400">
                                  No open debt tickets for this customer.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-24 text-center text-slate-400 text-xs">
                    Select a customer on the left to view tickets and record payments.
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
                <h2 className="text-lg font-black text-slate-900">Suppliers & Purchases</h2>
                <p className="text-xs text-slate-500">Record incoming purchases, manage suppliers, and track debt repayments</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSupplierToEdit(null);
                    setIsCreateSupplierOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  New Supplier
                </button>
                <button
                  onClick={() => setIsPurchaseModalOpen(true)}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition-colors"
                >
                  <Truck className="w-4 h-4 text-emerald-400" />
                  New Purchase
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
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide px-1">
                  Supplier Directory
                </h3>
                {suppliers.map(s => (
                  <div
                    key={s.id}
                    onClick={() => handleSelectSupplierForTickets(s)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedSupplier?.id === s.id
                        ? 'border-emerald-500 bg-emerald-50/50 shadow-sm'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-xs text-slate-900">{s.name}</h4>
                        {s.phone && (
                          <span className="text-[10px] font-mono text-slate-500">
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
                          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
                          title="Edit Supplier"
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
                          title="Delete Supplier"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-2 text-[11px]">
                      <span className="text-slate-500">{s.address || 'No address'}</span>
                      <span className={`font-bold font-mono ${s.total_debt ? 'text-rose-700' : 'text-slate-400'}`}>
                        Debt: {formatMoney(s.total_debt)}
                      </span>
                    </div>
                  </div>
                ))}
                {suppliers.length === 0 && (
                  <div className="p-4 text-center text-slate-400 text-xs">
                    No suppliers yet. Click &quot;+ New Supplier&quot; above to create one.
                  </div>
                )}
              </div>

              {/* Supplier Detail & Debt Ledger */}
              <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
                {selectedSupplier ? (
                  <>
                    <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                      <div>
                        <h3 className="text-base font-black text-slate-900">{selectedSupplier.name}</h3>
                        <p className="text-xs text-slate-500">{selectedSupplier.phone || 'No phone'} • {selectedSupplier.address || 'No address'}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-500 block">Total Debt Owed:</span>
                        <span className="text-lg font-black text-rose-700 font-mono">
                          {formatMoney(selectedSupplier.total_debt)}
                        </span>
                      </div>
                    </div>

                    {/* FIFO Debt Repayment */}
                    <div className="bg-rose-50/70 p-3.5 rounded-xl border border-rose-200 space-y-2">
                      <span className="text-xs font-bold text-rose-900 block flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5" />
                        Record Debt Payment to Supplier (FIFO Oldest First)
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
                          className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-xs shrink-0 transition-colors shadow-sm"
                        >
                          {isPayingSupplierDebt ? 'Paying...' : 'Pay Supplier'}
                        </button>
                      </div>
                    </div>

                    {/* Open Debt Tickets Table */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Open Supplier Debt Tickets
                      </h4>
                      <div className="border border-slate-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 font-bold text-slate-600 uppercase text-[10px]">
                              <th className="p-2">Ticket #</th>
                              <th className="p-2">Date</th>
                              <th className="p-2">PO #</th>
                              <th className="p-2 text-right">Original Total</th>
                              <th className="p-2 text-right">Remaining Due</th>
                              <th className="p-2 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {supplierTickets.map(t => (
                              <tr key={t.id}>
                                <td className="p-2 font-mono font-bold text-slate-900">{t.ticket_number}</td>
                                <td className="p-2 text-slate-500">{formatDate(t.date)}</td>
                                <td className="p-2 text-slate-600 font-mono text-[11px]">{(t as any).purchase_number || '—'}</td>
                                <td className="p-2 text-right font-mono">{formatMoney(t.total_amount)}</td>
                                <td className="p-2 text-right font-mono font-bold text-rose-700">{formatMoney(t.remaining_amount)}</td>
                                <td className="p-2 text-center">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    t.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                  }`}>
                                    {t.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {supplierTickets.length === 0 && (
                              <tr>
                                <td colSpan={6} className="p-4 text-center text-slate-400">
                                  No open debt tickets for this supplier.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-24 text-center text-slate-400 text-xs">
                    Select a supplier on the left to view debt ledger and record repayments.
                  </div>
                )}
              </div>
            </div>

            {/* Purchase History Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-emerald-600" />
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    Purchase Intake History ({purchasesHistory.length})
                  </h3>
                </div>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase">
                      <th className="p-3">Purchase #</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Supplier</th>
                      <th className="p-3 text-center">Items</th>
                      <th className="p-3 text-right">Total TTC</th>
                      <th className="p-3 text-right">Paid</th>
                      <th className="p-3 text-right">Debt Added</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {purchasesHistory.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="p-3 font-mono font-bold text-slate-900">{p.purchase_number}</td>
                        <td className="p-3 text-slate-500 font-mono text-[11px]">{formatDate(p.date)}</td>
                        <td className="p-3 font-bold text-slate-900">{p.supplier_name}</td>
                        <td className="p-3 text-center font-mono font-semibold">{p.item_count || 1}</td>
                        <td className="p-3 text-right font-mono font-bold text-slate-900">{formatMoney(p.total_amount)}</td>
                        <td className="p-3 text-right font-mono font-bold text-emerald-700">{formatMoney(p.cash_paid)}</td>
                        <td className="p-3 text-right font-mono font-bold text-rose-700">{formatMoney(p.debt_amount)}</td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.payment_status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {p.payment_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {purchasesHistory.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400">
                          No purchases recorded yet. Click &quot;+ New Purchase&quot; above to log an invoice.
                        </td>
                      </tr>
                    )}
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
          </div>
        )}

        {/* 6. CONTAINERS TAB */}
        {activeTab === 'CONTAINERS' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">Returnable Container Tracking</h2>
                <p className="text-xs text-slate-500">Track consignments, loan containers to customers, and record returns</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setContainerTxInitialAction('GIVE');
                    setContainerTxInitialCustomerId(null);
                    setContainerTxInitialContainerTypeId(null);
                    setIsContainerTxOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition-colors"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  Record Give / Return
                </button>
                <button
                  onClick={() => {
                    setContainerTypeToEdit(null);
                    setIsCreateContainerOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  New Container Type
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
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Type de Contenant</span>
                        <h3 className="font-bold text-slate-900 text-sm mt-0.5">{ct.name}</h3>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setContainerTypeToEdit(ct);
                            setIsCreateContainerOpen(true);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Edit Container Type"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteContainerType(ct)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Delete Container Type"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-between items-center text-xs">
                      <span className="text-slate-500">Shop Stock (Empty):</span>
                      <span className="font-black font-mono text-emerald-700">{ct.stock_quantity}</span>
                    </div>
                    <div className="mt-1 flex justify-between items-center text-xs">
                      <span className="text-slate-500">Loaned to Customers:</span>
                      <span className="font-black font-mono text-amber-700">{ct.total_loaned_out || 0}</span>
                    </div>
                  </div>
                  <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-center gap-2">
                    <button
                      onClick={() => {
                        setContainerTxInitialAction('GIVE');
                        setContainerTxInitialContainerTypeId(ct.id);
                        setIsContainerTxOpen(true);
                      }}
                      className="flex-1 py-1.5 px-2 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1"
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
                      className="flex-1 py-1.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1"
                    >
                      <ArrowDownLeft className="w-3 h-3" />
                      Retour
                    </button>
                  </div>
                </div>
              ))}
              {containerTypes.length === 0 && (
                <div className="sm:col-span-3 p-8 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
                  No container types defined yet. Click &quot;+ New Container Type&quot; above to add one.
                </div>
              )}
            </div>

            {/* Active Customer Loans Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-600" />
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    Active Customer Container Loans ({customerContainerLoans.length})
                  </h3>
                </div>
              </div>
              {customerContainerLoans.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  Aucun prêt de contenant en cours. Tous les contenants sont restitués.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase">
                        <th className="p-3">Client</th>
                        <th className="p-3">Type de Contenant</th>
                        <th className="p-3 text-center">Quantité Due</th>
                        <th className="p-3 text-right">Action Rapide</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {customerContainerLoans.map(loan => (
                        <tr key={`${loan.customer_id}-${loan.container_type_id}`} className="hover:bg-slate-50">
                          <td className="p-3 font-bold text-slate-900">{loan.customer_name}</td>
                          <td className="p-3 text-slate-600">{loan.container_type_name || loan.container_name}</td>
                          <td className="p-3 text-center font-bold font-mono text-amber-700">{loan.quantity_owed}</td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => {
                                setContainerTxInitialAction('RETURN');
                                setContainerTxInitialCustomerId(loan.customer_id);
                                setContainerTxInitialContainerTypeId(loan.container_type_id);
                                setIsContainerTxOpen(true);
                              }}
                              className="py-1 px-3 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold text-xs rounded-lg transition-colors inline-flex items-center gap-1"
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
                    Recent Container Transaction Log ({containerTransactions.length})
                  </h3>
                </div>
              </div>
              {containerTransactions.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  Aucun mouvement de consigne enregistré.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase">
                        <th className="p-3">Date</th>
                        <th className="p-3">Client</th>
                        <th className="p-3">Contenant</th>
                        <th className="p-3 text-center">Opération</th>
                        <th className="p-3 text-center">Quantité</th>
                        <th className="p-3">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {containerTransactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-slate-50">
                          <td className="p-3 text-slate-500 text-[11px]">{formatDateTime(tx.date || tx.created_at)}</td>
                          <td className="p-3 font-bold text-slate-900">{tx.customer_name}</td>
                          <td className="p-3 text-slate-600">{tx.container_type_name}</td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              tx.action === 'GIVE'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {tx.action === 'GIVE' ? 'PRÊT (GIVE)' : 'RETOUR (RETURN)'}
                            </span>
                          </td>
                          <td className="p-3 text-center font-bold font-mono text-slate-800">{tx.quantity}</td>
                          <td className="p-3 text-slate-400 text-[11px]">{tx.notes || '—'}</td>
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
                <h2 className="text-lg font-black text-slate-900">Register Session Audit History</h2>
                <p className="text-xs text-slate-500">Track counter opening floats, cash sales totals, variances, and receipts</p>
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
                <span>Manage Counters ({counters.filter(c => c.is_active).length} Active)</span>
              </button>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px]">
                    <th className="p-3">Session #</th>
                    <th className="p-3">Counter</th>
                    <th className="p-3">Opened</th>
                    <th className="p-3">Closed</th>
                    <th className="p-3 text-center">Sales Count</th>
                    <th className="p-3 text-right">Sales Total</th>
                    <th className="p-3 text-right">Opening Float</th>
                    <th className="p-3 text-right">Counted Cash</th>
                    <th className="p-3 text-right">Variance</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sessions.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-slate-900">{s.session_number}</td>
                      <td className="p-3 text-slate-600">{s.counter_name}</td>
                      <td className="p-3 text-slate-500">{formatDateTime(s.opened_at)}</td>
                      <td className="p-3 text-slate-500">{formatDateTime(s.closed_at) || 'Active'}</td>
                      <td className="p-3 text-center font-mono font-bold text-slate-800">{(s as any).sale_count ?? 0}</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900">{formatMoney((s as any).sales_total ?? 0)}</td>
                      <td className="p-3 text-right font-mono">{formatMoney(s.opening_cash)}</td>
                      <td className="p-3 text-right font-mono">{formatMoney(s.closing_cash_counted)}</td>
                      <td className="p-3 text-right font-mono font-bold">
                        {s.variance !== null && s.variance !== undefined ? (
                          <span className={s.variance === 0 ? 'text-emerald-700' : s.variance > 0 ? 'text-blue-700' : 'text-rose-700'}>
                            {formatMoney(s.variance)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          s.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleOpenSessionDetail(s)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[11px] inline-flex items-center gap-1 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5 text-slate-500" />
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={11} className="p-8 text-center text-slate-400">
                        No register sessions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Session Drill-down Modal */}
            {isSessionDetailOpen && (
              <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col border border-slate-200">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-black text-slate-900">
                        Session Breakdown: {selectedSessionDetail?.session?.session_number || selectedSessionDetail?.session_number || 'Loading...'}
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        {selectedSessionDetail?.session?.counter_name || selectedSessionDetail?.counter_name} • Opened: {formatDateTime(selectedSessionDetail?.session?.opened_at || selectedSessionDetail?.opened_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => setIsSessionDetailOpen(false)}
                      className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-5 overflow-y-auto space-y-4">
                    {loadingSessionDetail ? (
                      <div className="text-center py-12 text-slate-400 text-xs">Loading session data...</div>
                    ) : selectedSessionDetail ? (
                      <>
                        {/* Live Cash Breakdown Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <span className="text-slate-500 text-[10px] uppercase font-bold block">Opening Float</span>
                            <span className="font-mono font-bold text-slate-900 text-sm">
                              {formatMoney(selectedSessionDetail?.session?.opening_cash ?? selectedSessionDetail?.opening_cash ?? 0)}
                            </span>
                          </div>
                          <div className="bg-emerald-50/70 p-3 rounded-xl border border-emerald-200">
                            <span className="text-emerald-700 text-[10px] uppercase font-bold block">Cash Sales Inflow</span>
                            <span className="font-mono font-bold text-emerald-800 text-sm">
                              {formatMoney(selectedSessionDetail?.live_cash_breakdown?.cash_sales ?? selectedSessionDetail?.cash_sales ?? 0)}
                            </span>
                          </div>
                          <div className="bg-blue-50/70 p-3 rounded-xl border border-blue-200">
                            <span className="text-blue-700 text-[10px] uppercase font-bold block">Expected Cash</span>
                            <span className="font-mono font-bold text-blue-800 text-sm">
                              {formatMoney(selectedSessionDetail?.live_cash_breakdown?.expected_cash ?? selectedSessionDetail?.session?.expected_cash ?? selectedSessionDetail?.expected_cash ?? 0)}
                            </span>
                          </div>
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <span className="text-slate-500 text-[10px] uppercase font-bold block">Counted / Variance</span>
                            <span className="font-mono font-bold text-slate-900 text-sm">
                              {(selectedSessionDetail?.session?.closing_cash_counted !== null && selectedSessionDetail?.session?.closing_cash_counted !== undefined)
                                ? `${formatMoney(selectedSessionDetail.session.closing_cash_counted)} (${formatMoney(selectedSessionDetail.session.variance || 0)})`
                                : (selectedSessionDetail?.closing_cash_counted !== null && selectedSessionDetail?.closing_cash_counted !== undefined)
                                ? `${formatMoney(selectedSessionDetail.closing_cash_counted)} (${formatMoney(selectedSessionDetail.variance || 0)})`
                                : 'Active Session'}
                            </span>
                          </div>
                        </div>

                        {/* Sales List Table */}
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 font-bold text-xs text-slate-700 uppercase tracking-wide">
                            Session Sales Receipts ({selectedSessionDetail.sales?.length || 0})
                          </div>
                          <div className="max-h-56 overflow-y-auto">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] uppercase border-b border-slate-200">
                                  <th className="p-2.5">Receipt #</th>
                                  <th className="p-2.5">Time</th>
                                  <th className="p-2.5">Customer</th>
                                  <th className="p-2.5 text-right">Total TTC</th>
                                  <th className="p-2.5 text-right">Cash Paid</th>
                                  <th className="p-2.5 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {selectedSessionDetail.sales?.map((sale: any) => (
                                  <tr key={sale.id} className="hover:bg-slate-50">
                                    <td className="p-2.5 font-mono font-bold text-slate-900">{sale.receipt_number}</td>
                                    <td className="p-2.5 text-slate-500 text-[11px]">{formatDateTime(sale.date)}</td>
                                    <td className="p-2.5 text-slate-700">{sale.customer_name || 'Walk-in'}</td>
                                    <td className="p-2.5 text-right font-mono font-bold text-slate-900">{formatMoney(sale.total_ttc)}</td>
                                    <td className="p-2.5 text-right font-mono text-emerald-700 font-bold">{formatMoney(sale.cash_paid)}</td>
                                    <td className="p-2.5 text-center">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                        sale.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                      }`}>
                                        {sale.status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                                {(!selectedSessionDetail.sales || selectedSessionDetail.sales.length === 0) && (
                                  <tr>
                                    <td colSpan={6} className="p-4 text-center text-slate-400 text-xs">
                                      No sales recorded during this session.
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
                              Cash Movements ({selectedSessionDetail.movements.length})
                            </div>
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] uppercase border-b border-slate-200">
                                  <th className="p-2">Type</th>
                                  <th className="p-2 text-right">Amount</th>
                                  <th className="p-2">Reason</th>
                                  <th className="p-2">Time</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {selectedSessionDetail.movements.map((m: any) => (
                                  <tr key={m.id}>
                                    <td className="p-2 font-bold">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                        m.type === 'CASH_IN' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                      }`}>
                                        {m.type}
                                      </span>
                                    </td>
                                    <td className="p-2 text-right font-mono font-bold">{formatMoney(m.amount)}</td>
                                    <td className="p-2 text-slate-600">{m.reason}</td>
                                    <td className="p-2 text-slate-500 text-[11px]">{formatDateTime(m.created_at || m.date)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
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
              <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-slate-200 text-slate-800 flex items-center justify-center">
                        <Settings className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-slate-900">Register / Counter Management</h3>
                        <p className="text-[11px] text-slate-500">Configure defined physical counters and mobile registers</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsCountersModalOpen(false)}
                      className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-5 space-y-4">
                    {/* Add Counter Form */}
                    <form onSubmit={handleCreateCounter} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="New register name (e.g. Counter 2, Drive-thru)..."
                        value={newCounterName}
                        onChange={e => setNewCounterName(e.target.value)}
                        className="flex-1 text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none"
                      />
                      <button
                        type="submit"
                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1 shadow-sm transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </form>
                    {counterError && (
                      <p className="text-xs text-rose-600 font-semibold">{counterError}</p>
                    )}

                    {/* Counters Table */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px]">
                            <th className="p-2.5">Counter Name</th>
                            <th className="p-2.5 text-center">Status</th>
                            <th className="p-2.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {counters.map(c => (
                            <tr key={c.id} className="hover:bg-slate-50">
                              <td className="p-2.5 font-bold text-slate-800">{c.name}</td>
                              <td className="p-2.5 text-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  c.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {c.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="p-2.5 text-right">
                                {c.is_active ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteCounter(c)}
                                    className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors"
                                    title="Deactivate / Delete"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-slate-400 italic">Deactivated</span>
                                )}
                              </td>
                            </tr>
                          ))}
                          {counters.length === 0 && (
                            <tr>
                              <td colSpan={3} className="p-4 text-center text-slate-400">
                                No counters configured.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 border-t border-slate-100 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsCountersModalOpen(false)}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100 transition-colors"
                    >
                      Close
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
                <h2 className="text-lg font-black text-slate-900">Cash Flow & Stock Valuation</h2>
                <p className="text-xs text-slate-500">Real-time ledger overview, cash movements, and asset valuation</p>
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
                  Stock Adjustment
                </button>
                <button
                  onClick={() => setIsCreateExpenseOpen(true)}
                  className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition-colors"
                >
                  <Receipt className="w-4 h-4" />
                  Record Expense
                </button>
              </div>
            </div>
            {accountingData && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Cash Flow Statement */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                  <h3 className="text-sm font-bold text-slate-900">Money In vs Money Out</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Total Sales Cash Inflow:</span>
                      <span className="font-mono font-bold text-emerald-700">
                        {formatMoney(accountingData.cashFlow?.money_in?.sales_cash || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Customer Debt Collections:</span>
                      <span className="font-mono font-bold text-emerald-700">
                        {formatMoney(accountingData.cashFlow?.money_in?.customer_debt_repayments || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Purchases Cash Outflow:</span>
                      <span className="font-mono font-bold text-rose-700">
                        {formatMoney(accountingData.cashFlow?.money_out?.paid_purchases || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>General Expenses Paid:</span>
                      <span className="font-mono font-bold text-rose-700">
                        {formatMoney(accountingData.cashFlow?.money_out?.general_expenses || 0)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-slate-200 flex justify-between text-sm font-black text-slate-900">
                      <span>Net Cash Position:</span>
                      <span className="font-mono text-base text-blue-700">
                        {formatMoney(accountingData.cashFlow?.net_cash_flow || 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Stock Valuation at Cost */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                  <h3 className="text-sm font-bold text-slate-900">Stock Valuation at Cost</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Raw Materials Stock Value:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {formatMoney(accountingData.stockValuation?.raw_materials_valuation || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Finished Products Stock Value:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {formatMoney(accountingData.stockValuation?.finished_goods_valuation || 0)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-slate-200 flex justify-between text-sm font-black text-slate-900">
                      <span>Total Inventory Asset Value:</span>
                      <span className="font-mono text-base text-emerald-700">
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
                    General Expenses Log ({expensesHistory.length})
                  </h3>
                </div>
                <button
                  onClick={() => setIsCreateExpenseOpen(true)}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-[11px] inline-flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add Expense
                </button>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase">
                      <th className="p-3">Date</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">Description</th>
                      <th className="p-3">Payment Source</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {expensesHistory.map(exp => (
                      <tr key={exp.id} className="hover:bg-slate-50">
                        <td className="p-3 text-slate-500 font-mono text-[11px]">{formatDateTime(exp.date || exp.created_at)}</td>
                        <td className="p-3">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                            {exp.category}
                          </span>
                        </td>
                        <td className="p-3 text-slate-800 font-medium">{exp.description || '—'}</td>
                        <td className="p-3 text-slate-500 font-mono text-[11px]">{exp.payment_source}</td>
                        <td className="p-3 text-right font-mono font-bold text-rose-700">{formatMoney(exp.amount)}</td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleDeleteExpense(exp)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors inline-flex items-center"
                            title="Delete Expense"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {expensesHistory.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400">
                          No general expenses recorded yet. Click &quot;+ Record Expense&quot; above to log rent, utility, or supply costs.
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
    </div>
  );
};
