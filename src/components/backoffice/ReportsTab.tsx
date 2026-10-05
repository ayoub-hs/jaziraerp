import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Calendar, 
  Download, 
  DollarSign, 
  Users, 
  Layers, 
  CreditCard, 
  Package, 
  RefreshCw,
  Search,
  Filter,
  ArrowUpRight
} from 'lucide-react';
import { formatMoney } from '../../utils/formatters.js';
import { exportToCsv } from '../../utils/csv.js';

type ReportType = 'SALES_CUSTOMER' | 'SALES_REGISTER' | 'DEBT_PAYMENTS' | 'INVENTORY_VALUATION';

export const ReportsTab: React.FC = () => {
  const [activeReport, setActiveReport] = useState<ReportType>('SALES_CUSTOMER');

  // Dates (default last 30 days)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Search filter inside table
  const [searchFilter, setSearchFilter] = useState('');

  // Report data states
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [salesByCustomerData, setSalesByCustomerData] = useState<any>(null);
  const [salesByRegisterData, setSalesByRegisterData] = useState<any>(null);
  const [debtPaymentsData, setDebtPaymentsData] = useState<any>(null);
  const [inventoryValuationData, setInventoryValuationData] = useState<any>(null);

  const fetchReportData = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      if (activeReport === 'SALES_CUSTOMER') {
        const res = await fetch(`/api/reports/sales-by-customer?start_date=${startDate}&end_date=${endDate}`);
        if (res.ok) setSalesByCustomerData(await res.json());
        else setFetchError(`Erreur chargement rapport (${res.status})`);
      } else if (activeReport === 'SALES_REGISTER') {
        const res = await fetch(`/api/reports/sales-by-register?start_date=${startDate}&end_date=${endDate}`);
        if (res.ok) setSalesByRegisterData(await res.json());
        else setFetchError(`Erreur chargement rapport (${res.status})`);
      } else if (activeReport === 'DEBT_PAYMENTS') {
        const res = await fetch(`/api/reports/customer-debt-payments?start_date=${startDate}&end_date=${endDate}`);
        if (res.ok) setDebtPaymentsData(await res.json());
        else setFetchError(`Erreur chargement rapport (${res.status})`);
      } else if (activeReport === 'INVENTORY_VALUATION') {
        const res = await fetch('/api/reports/inventory-valuation');
        if (res.ok) setInventoryValuationData(await res.json());
        else setFetchError(`Erreur chargement rapport (${res.status})`);
      }
    } catch (err: any) {
      console.error('Error fetching report:', err);
      setFetchError(err.message || 'Error fetching report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [activeReport, startDate, endDate]);

  const handleQuickDate = (type: 'TODAY' | 'THIS_MONTH' | 'LAST_30' | 'ALL_TIME') => {
    const now = new Date();
    if (type === 'TODAY') {
      const todayStr = now.toISOString().slice(0, 10);
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (type === 'THIS_MONTH') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const todayStr = now.toISOString().slice(0, 10);
      setStartDate(firstDay);
      setEndDate(todayStr);
    } else if (type === 'LAST_30') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setStartDate(d.toISOString().slice(0, 10));
      setEndDate(now.toISOString().slice(0, 10));
    } else if (type === 'ALL_TIME') {
      setStartDate('2025-01-01');
      setEndDate(now.toISOString().slice(0, 10));
    }
  };

  // CSV Export Dispatcher
  const handleExportCsv = () => {
    if (activeReport === 'SALES_CUSTOMER') {
      const rows = (salesByCustomerData?.customer_sales || []).map((c: any) => [
        c.customer_name,
        c.customer_phone || '—',
        c.sale_count,
        Number(c.total_ht || 0).toFixed(3),
        Number(c.total_tva || 0).toFixed(3),
        Number(c.gross_ttc ?? c.total_ttc ?? 0).toFixed(3),
        Number(c.refunded_amount || 0).toFixed(3),
        Number(c.net_ttc ?? c.total_ttc ?? 0).toFixed(3),
        Number(c.cash_paid || 0).toFixed(3),
        Number(c.wallet_paid || 0).toFixed(3),
        Number(c.credit_amount || 0).toFixed(3)
      ]);
      exportToCsv(
        `sales_by_customer_${startDate}_to_${endDate}`,
        ['Customer', 'Phone', 'Sales Count', 'Total HT (DT)', 'TVA (DT)', 'Gross TTC (DT)', 'Refunded (DT)', 'Net TTC (DT)', 'Cash (DT)', 'Wallet (DT)', 'Credit (DT)'],
        rows
      );
    } else if (activeReport === 'SALES_REGISTER') {
      const rows = (salesByRegisterData?.register_sales || []).map((r: any) => [
        r.counter_name,
        r.session_count,
        r.sale_count,
        Number(r.total_ht || 0).toFixed(3),
        Number(r.total_tva || 0).toFixed(3),
        Number(r.gross_ttc ?? r.total_ttc ?? 0).toFixed(3),
        Number(r.refunded_amount || 0).toFixed(3),
        Number(r.net_ttc ?? r.total_ttc ?? 0).toFixed(3),
        Number(r.cash_paid || 0).toFixed(3),
        Number(r.wallet_paid || 0).toFixed(3),
        Number(r.credit_amount || 0).toFixed(3)
      ]);
      exportToCsv(
        `sales_by_register_${startDate}_to_${endDate}`,
        ['Register / Counter', 'Sessions Count', 'Sales Count', 'Total HT (DT)', 'TVA (DT)', 'Gross TTC (DT)', 'Refunded (DT)', 'Net TTC (DT)', 'Cash (DT)', 'Wallet (DT)', 'Credit (DT)'],
        rows
      );
    } else if (activeReport === 'DEBT_PAYMENTS') {
      const rows = (debtPaymentsData?.payments || []).map((p: any) => [
        new Date(p.date).toLocaleString(),
        p.customer_name,
        p.customer_phone || '—',
        Number(p.amount || 0).toFixed(3),
        p.payment_method,
        p.notes || '—'
      ]);
      exportToCsv(
        `debt_payments_${startDate}_to_${endDate}`,
        ['Date', 'Customer', 'Phone', 'Amount Paid (DT)', 'Payment Method', 'Notes'],
        rows
      );
    } else if (activeReport === 'INVENTORY_VALUATION') {
      const productRows = (inventoryValuationData?.products || []).map((p: any) => [
        p.name,
        p.category,
        'Finished Product / SKU',
        p.stock_quantity,
        Number(p.unit_cost || 0).toFixed(3),
        Number(p.line_cost_valuation || 0).toFixed(3),
        Number(p.retail_price || 0).toFixed(3),
        Number(p.line_retail_valuation || 0).toFixed(3)
      ]);
      const materialRows = (inventoryValuationData?.materials || []).map((m: any) => [
        m.name,
        m.category,
        `Raw Material (${m.unit})`,
        m.stock_quantity,
        Number(m.unit_cost || 0).toFixed(3),
        Number(m.line_cost_valuation || 0).toFixed(3),
        '—',
        '—'
      ]);
      exportToCsv(
        `inventory_valuation_${new Date().toISOString().slice(0, 10)}`,
        ['Item Name', 'Category', 'Item Type', 'Current Stock', 'Unit Cost (DT)', 'Total Cost Valuation (DT)', 'Retail Unit Price (DT)', 'Retail Stock Value (DT)'],
        [...productRows, ...materialRows]
      );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header & Report Navigation */}
      <div className="flex flex-wrap justify-between items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            Financial & Operational Reports
          </h2>
          <p className="text-xs text-slate-500">Date-filtered sales performance, register activity, debt settlements, and inventory asset valuation</p>
        </div>

        {/* Export CSV Button */}
        <button
          type="button"
          onClick={handleExportCsv}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-colors shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Sub-Reports Selector Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2 text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveReport('SALES_CUSTOMER')}
          className={`px-3.5 py-2 rounded-xl flex items-center gap-2 transition-all ${
            activeReport === 'SALES_CUSTOMER'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>1. Sales by Customer</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveReport('SALES_REGISTER')}
          className={`px-3.5 py-2 rounded-xl flex items-center gap-2 transition-all ${
            activeReport === 'SALES_REGISTER'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>2. Sales by Register</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveReport('DEBT_PAYMENTS')}
          className={`px-3.5 py-2 rounded-xl flex items-center gap-2 transition-all ${
            activeReport === 'DEBT_PAYMENTS'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>3. Customer Debt Payments</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveReport('INVENTORY_VALUATION')}
          className={`px-3.5 py-2 rounded-xl flex items-center gap-2 transition-all ${
            activeReport === 'INVENTORY_VALUATION'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>4. Inventory Valuation</span>
        </button>
      </div>

      {/* Filter Control Bar (only for time-ranged reports) */}
      {activeReport !== 'INVENTORY_VALUATION' && (
        <div className="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Period:</span>
            </div>

            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
            />
            <span className="text-slate-400 font-bold">to</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
            />

            {/* Quick date presets */}
            <div className="flex gap-1 pl-2 border-l border-slate-200">
              <button
                type="button"
                onClick={() => handleQuickDate('TODAY')}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md text-[11px] font-semibold transition-colors"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('THIS_MONTH')}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md text-[11px] font-semibold transition-colors"
              >
                This Month
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('LAST_30')}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md text-[11px] font-semibold transition-colors"
              >
                Last 30 Days
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('ALL_TIME')}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md text-[11px] font-semibold transition-colors"
              >
                All Time
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search report rows..."
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500 w-48"
              />
            </div>

            <button
              type="button"
              onClick={fetchReportData}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-800 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {/* KPI Summary Cards */}
      {fetchError && (
        <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs font-bold">
          {fetchError}
        </div>
      )}
      {activeReport === 'SALES_CUSTOMER' && salesByCustomerData?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200">
            <span className="text-slate-500 text-[10px] uppercase font-bold block">Total Sales Count</span>
            <span className="font-mono font-bold text-slate-900 text-lg">{salesByCustomerData.summary.total_sales_count}</span>
          </div>
          <div className="bg-blue-50/70 p-3.5 rounded-2xl shadow-sm border border-blue-200">
            <span className="text-blue-700 text-[10px] uppercase font-bold block">Total Revenue (TTC)</span>
            <span className="font-mono font-bold text-blue-900 text-lg">{formatMoney(salesByCustomerData.summary.total_ttc)}</span>
          </div>
          <div className="bg-emerald-50/70 p-3.5 rounded-2xl shadow-sm border border-emerald-200">
            <span className="text-emerald-700 text-[10px] uppercase font-bold block">Cash Collected</span>
            <span className="font-mono font-bold text-emerald-900 text-lg">{formatMoney(salesByCustomerData.summary.total_cash)}</span>
          </div>
          <div className="bg-purple-50/70 p-3.5 rounded-2xl shadow-sm border border-purple-200">
            <span className="text-purple-700 text-[10px] uppercase font-bold block">Wallet Deductions</span>
            <span className="font-mono font-bold text-purple-900 text-lg">{formatMoney(salesByCustomerData.summary.total_wallet)}</span>
          </div>
          <div className="bg-amber-50/70 p-3.5 rounded-2xl shadow-sm border border-amber-200">
            <span className="text-amber-700 text-[10px] uppercase font-bold block">Customer Credit Issued</span>
            <span className="font-mono font-bold text-amber-900 text-lg">{formatMoney(salesByCustomerData.summary.total_credit)}</span>
          </div>
        </div>
      )}

      {activeReport === 'SALES_REGISTER' && salesByRegisterData?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200">
            <span className="text-slate-500 text-[10px] uppercase font-bold block">Total Sales Count</span>
            <span className="font-mono font-bold text-slate-900 text-lg">{salesByRegisterData.summary.total_sales_count}</span>
          </div>
          <div className="bg-blue-50/70 p-3.5 rounded-2xl shadow-sm border border-blue-200">
            <span className="text-blue-700 text-[10px] uppercase font-bold block">Total Sales Volume (TTC)</span>
            <span className="font-mono font-bold text-blue-900 text-lg">{formatMoney(salesByRegisterData.summary.total_ttc)}</span>
          </div>
          <div className="bg-emerald-50/70 p-3.5 rounded-2xl shadow-sm border border-emerald-200">
            <span className="text-emerald-700 text-[10px] uppercase font-bold block">Total Cash Inflow</span>
            <span className="font-mono font-bold text-emerald-900 text-lg">{formatMoney(salesByRegisterData.summary.total_cash)}</span>
          </div>
          <div className="bg-amber-50/70 p-3.5 rounded-2xl shadow-sm border border-amber-200">
            <span className="text-amber-700 text-[10px] uppercase font-bold block">Total Credit Tendered</span>
            <span className="font-mono font-bold text-amber-900 text-lg">{formatMoney(salesByRegisterData.summary.total_credit)}</span>
          </div>
        </div>
      )}

      {activeReport === 'DEBT_PAYMENTS' && debtPaymentsData?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200">
            <span className="text-slate-500 text-[10px] uppercase font-bold block">Payments Recorded</span>
            <span className="font-mono font-bold text-slate-900 text-lg">{debtPaymentsData.summary.total_payments_count}</span>
          </div>
          <div className="bg-emerald-50/70 p-3.5 rounded-2xl shadow-sm border border-emerald-200 col-span-2">
            <span className="text-emerald-700 text-[10px] uppercase font-bold block">Total Debt Repayments Collected</span>
            <span className="font-mono font-bold text-emerald-900 text-xl">{formatMoney(debtPaymentsData.summary.total_amount_paid)}</span>
          </div>
        </div>
      )}

      {activeReport === 'INVENTORY_VALUATION' && inventoryValuationData?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200">
            <span className="text-slate-500 text-[10px] uppercase font-bold block">Catalog Items</span>
            <span className="font-mono font-bold text-slate-900 text-lg">
              {inventoryValuationData.summary.product_count} SKUs • {inventoryValuationData.summary.material_count} Materials
            </span>
          </div>
          <div className="bg-amber-50/70 p-3.5 rounded-2xl shadow-sm border border-amber-200">
            <span className="text-amber-700 text-[10px] uppercase font-bold block">Raw Materials Value</span>
            <span className="font-mono font-bold text-amber-900 text-lg">{formatMoney(inventoryValuationData.summary.material_cost_valuation)}</span>
          </div>
          <div className="bg-blue-50/70 p-3.5 rounded-2xl shadow-sm border border-blue-200">
            <span className="text-blue-700 text-[10px] uppercase font-bold block">Products Cost Value</span>
            <span className="font-mono font-bold text-blue-900 text-lg">{formatMoney(inventoryValuationData.summary.product_cost_valuation)}</span>
          </div>
          <div className="bg-emerald-50/70 p-3.5 rounded-2xl shadow-sm border border-emerald-200">
            <span className="text-emerald-700 text-[10px] uppercase font-bold block">Total Inventory Asset Valuation</span>
            <span className="font-mono font-bold text-emerald-900 text-xl">{formatMoney(inventoryValuationData.summary.grand_total_cost_valuation)}</span>
          </div>
        </div>
      )}

      {/* Main Report Data Tables */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* 1. SALES BY CUSTOMER TABLE */}
        {activeReport === 'SALES_CUSTOMER' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px]">
                  <th className="p-3">Customer</th>
                  <th className="p-3">Phone</th>
                  <th className="p-3 text-center">Sales Count</th>
                  <th className="p-3 text-right">Subtotal HT</th>
                  <th className="p-3 text-right">TVA</th>
                  <th className="p-3 text-right">Gross TTC</th>
                  <th className="p-3 text-right text-red-600">Refunded</th>
                  <th className="p-3 text-right font-bold text-slate-900">Net TTC</th>
                  <th className="p-3 text-right text-emerald-700">Cash Paid</th>
                  <th className="p-3 text-right text-purple-700">Wallet Paid</th>
                  <th className="p-3 text-right text-amber-700">Credit (Due)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(salesByCustomerData?.customer_sales || [])
                  .filter((c: any) => !searchFilter || c.customer_name.toLowerCase().includes(searchFilter.toLowerCase()) || (c.customer_phone && c.customer_phone.includes(searchFilter)))
                  .map((c: any) => (
                    <tr key={c.customer_id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-800">{c.customer_name}</td>
                      <td className="p-3 font-mono text-slate-500">{c.customer_phone || '—'}</td>
                      <td className="p-3 text-center font-mono font-bold">{c.sale_count}</td>
                      <td className="p-3 text-right font-mono">{formatMoney(c.total_ht)}</td>
                      <td className="p-3 text-right font-mono text-slate-500">{formatMoney(c.total_tva)}</td>
                      <td className="p-3 text-right font-mono">{formatMoney(c.gross_ttc ?? c.total_ttc)}</td>
                      <td className="p-3 text-right font-mono text-red-600">{formatMoney(c.refunded_amount || 0)}</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900">{formatMoney(c.net_ttc ?? c.total_ttc)}</td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-700">{formatMoney(c.cash_paid)}</td>
                      <td className="p-3 text-right font-mono text-purple-700">{formatMoney(c.wallet_paid)}</td>
                      <td className="p-3 text-right font-mono font-bold text-amber-700">
                        {c.credit_amount > 0 ? formatMoney(c.credit_amount) : '0.000'}
                      </td>
                    </tr>
                  ))}
                {(!salesByCustomerData?.customer_sales || salesByCustomerData.customer_sales.length === 0) && (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-slate-400">
                      No sales found for the selected date range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 2. SALES BY REGISTER TABLE */}
        {activeReport === 'SALES_REGISTER' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px]">
                  <th className="p-3">Register / Counter</th>
                  <th className="p-3 text-center">Sessions Count</th>
                  <th className="p-3 text-center">Sales Count</th>
                  <th className="p-3 text-right">Subtotal HT</th>
                  <th className="p-3 text-right">TVA</th>
                  <th className="p-3 text-right">Gross TTC</th>
                  <th className="p-3 text-right text-red-600">Refunded</th>
                  <th className="p-3 text-right font-bold text-slate-900">Net Volume TTC</th>
                  <th className="p-3 text-right text-emerald-700">Cash Inflow</th>
                  <th className="p-3 text-right text-purple-700">Wallet Paid</th>
                  <th className="p-3 text-right text-amber-700">Credit Granted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(salesByRegisterData?.register_sales || [])
                  .filter((r: any) => !searchFilter || r.counter_name.toLowerCase().includes(searchFilter.toLowerCase()))
                  .map((r: any) => (
                    <tr key={r.counter_name} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-900">{r.counter_name}</td>
                      <td className="p-3 text-center font-mono">{r.session_count}</td>
                      <td className="p-3 text-center font-mono font-bold text-slate-800">{r.sale_count}</td>
                      <td className="p-3 text-right font-mono">{formatMoney(r.total_ht)}</td>
                      <td className="p-3 text-right font-mono text-slate-500">{formatMoney(r.total_tva)}</td>
                      <td className="p-3 text-right font-mono">{formatMoney(r.gross_ttc ?? r.total_ttc)}</td>
                      <td className="p-3 text-right font-mono text-red-600">{formatMoney(r.refunded_amount || 0)}</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900">{formatMoney(r.net_ttc ?? r.total_ttc)}</td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-700">{formatMoney(r.cash_paid)}</td>
                      <td className="p-3 text-right font-mono text-purple-700">{formatMoney(r.wallet_paid)}</td>
                      <td className="p-3 text-right font-mono font-bold text-amber-700">{formatMoney(r.credit_amount)}</td>
                    </tr>
                  ))}
                {(!salesByRegisterData?.register_sales || salesByRegisterData.register_sales.length === 0) && (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-slate-400">
                      No register sales found for the selected date range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 3. CUSTOMER DEBT PAYMENTS TABLE */}
        {activeReport === 'DEBT_PAYMENTS' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px]">
                  <th className="p-3">Payment Date</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Phone</th>
                  <th className="p-3 text-right">Amount Repaid</th>
                  <th className="p-3">Payment Method</th>
                  <th className="p-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(debtPaymentsData?.payments || [])
                  .filter((p: any) => !searchFilter || p.customer_name.toLowerCase().includes(searchFilter.toLowerCase()) || (p.notes && p.notes.toLowerCase().includes(searchFilter.toLowerCase())))
                  .map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono text-slate-500">{new Date(p.date).toLocaleString()}</td>
                      <td className="p-3 font-bold text-slate-900">{p.customer_name}</td>
                      <td className="p-3 font-mono text-slate-500">{p.customer_phone || '—'}</td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-700">{formatMoney(p.amount)}</td>
                      <td className="p-3 font-semibold text-slate-700">{p.payment_method}</td>
                      <td className="p-3 text-slate-500">{p.notes || '—'}</td>
                    </tr>
                  ))}
                {(!debtPaymentsData?.payments || debtPaymentsData.payments.length === 0) && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No customer debt payments found in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 4. INVENTORY VALUATION TABLE */}
        {activeReport === 'INVENTORY_VALUATION' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px]">
                  <th className="p-3">Item Name</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Classification</th>
                  <th className="p-3 text-center">Stock</th>
                  <th className="p-3 text-right">Unit Cost</th>
                  <th className="p-3 text-right font-bold text-slate-900">Total Asset Value</th>
                  <th className="p-3 text-right">Retail Price</th>
                  <th className="p-3 text-right text-blue-700">Retail Stock Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* Finished Products */}
                {(inventoryValuationData?.products || [])
                  .filter((p: any) => !searchFilter || p.name.toLowerCase().includes(searchFilter.toLowerCase()) || p.category.toLowerCase().includes(searchFilter.toLowerCase()))
                  .map((p: any) => (
                    <tr key={`p-${p.id}`} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-900">{p.name} {p.size_label && `(${p.size_label})`}</td>
                      <td className="p-3 text-slate-600">{p.category}</td>
                      <td className="p-3">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
                          PRODUCT SKU
                        </span>
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-slate-800">{p.stock_quantity}</td>
                      <td className="p-3 text-right font-mono">{formatMoney(p.unit_cost)}</td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-700">{formatMoney(p.line_cost_valuation)}</td>
                      <td className="p-3 text-right font-mono">{formatMoney(p.retail_price)}</td>
                      <td className="p-3 text-right font-mono text-blue-700">{formatMoney(p.line_retail_valuation)}</td>
                    </tr>
                  ))}

                {/* Raw Materials */}
                {(inventoryValuationData?.materials || [])
                  .filter((m: any) => !searchFilter || m.name.toLowerCase().includes(searchFilter.toLowerCase()) || m.category.toLowerCase().includes(searchFilter.toLowerCase()))
                  .map((m: any) => (
                    <tr key={`m-${m.id}`} className="hover:bg-slate-50 bg-amber-50/20">
                      <td className="p-3 font-bold text-slate-900">{m.name}</td>
                      <td className="p-3 text-slate-600">{m.category}</td>
                      <td className="p-3">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                          MATERIAL ({m.unit})
                        </span>
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-slate-800">{m.stock_quantity} {m.unit}</td>
                      <td className="p-3 text-right font-mono">{formatMoney(m.unit_cost)}</td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-700">{formatMoney(m.line_cost_valuation)}</td>
                      <td className="p-3 text-right font-mono text-slate-400">—</td>
                      <td className="p-3 text-right font-mono text-slate-400">—</td>
                    </tr>
                  ))}

                {(!inventoryValuationData?.products || (inventoryValuationData.products.length === 0 && inventoryValuationData.materials?.length === 0)) && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400">
                      No inventory items found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
