import React, { useState, useEffect, useMemo } from 'react';
import { X, ShoppingBag, Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Supplier, RawMaterial, Product } from '../../types/index.js';

export interface PurchaseLineItem {
  id: string;
  item_type: 'RAW_MATERIAL' | 'RESALE_PRODUCT';
  item_id: string;
  quantity: number;
  unit_cost: number;
}

interface CreatePurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  suppliers: Supplier[];
  materials: RawMaterial[];
  products: Product[];
  initialSupplierId?: string | null;
}

export const CreatePurchaseModal: React.FC<CreatePurchaseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  suppliers,
  materials,
  products,
  initialSupplierId
}) => {
  const [supplierId, setSupplierId] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [cashPaid, setCashPaid] = useState<number>(0);
  const [items, setItems] = useState<PurchaseLineItem[]>([
    {
      id: '1',
      item_type: 'RAW_MATERIAL',
      item_id: '',
      quantity: 1,
      unit_cost: 0
    }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize or reset on open
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSupplierId(initialSupplierId || (suppliers.length > 0 ? suppliers[0].id : ''));
      setPurchaseDate(new Date().toISOString().slice(0, 10));
      setNotes('');
      setCashPaid(0);

      // Default first row
      const firstMat = materials.length > 0 ? materials[0] : null;
      setItems([
        {
          id: Math.random().toString(),
          item_type: 'RAW_MATERIAL',
          item_id: firstMat ? firstMat.id : '',
          quantity: 1,
          unit_cost: firstMat ? (firstMat.latest_purchase_cost || 0) : 0
        }
      ]);
    }
  }, [isOpen, initialSupplierId, suppliers, materials]);

  // Calculate totals
  const totalAmount = useMemo(() => {
    return items.reduce((sum, item) => {
      const q = Number(item.quantity) || 0;
      const c = Number(item.unit_cost) || 0;
      return sum + (q * c);
    }, 0);
  }, [items]);

  const remainingDebt = useMemo(() => {
    const paid = Number(cashPaid) || 0;
    return Math.max(0, totalAmount - paid);
  }, [totalAmount, cashPaid]);

  const selectedSupplier = useMemo(() => {
    return suppliers.find(s => s.id === supplierId);
  }, [suppliers, supplierId]);

  if (!isOpen) return null;

  const handleAddItem = () => {
    const firstMat = materials.length > 0 ? materials[0] : null;
    setItems(prev => [
      ...prev,
      {
        id: Math.random().toString(),
        item_type: 'RAW_MATERIAL',
        item_id: firstMat ? firstMat.id : '',
        quantity: 1,
        unit_cost: firstMat ? (firstMat.latest_purchase_cost || 0) : 0
      }
    ]);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const handleItemTypeChange = (id: string, newType: 'RAW_MATERIAL' | 'RESALE_PRODUCT') => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      if (newType === 'RAW_MATERIAL') {
        const mat = materials[0];
        return {
          ...item,
          item_type: 'RAW_MATERIAL',
          item_id: mat ? mat.id : '',
          unit_cost: mat ? (mat.latest_purchase_cost || 0) : 0
        };
      } else {
        const prod = products[0];
        return {
          ...item,
          item_type: 'RESALE_PRODUCT',
          item_id: prod ? prod.id : '',
          unit_cost: prod ? (prod.cost_reference || 0) : 0
        };
      }
    }));
  };

  const handleItemSelect = (id: string, selectedItemId: string) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      let defaultCost = item.unit_cost;
      if (item.item_type === 'RAW_MATERIAL') {
        const found = materials.find(m => m.id === selectedItemId);
        if (found && (found.latest_purchase_cost || 0) > 0) {
          defaultCost = found.latest_purchase_cost || 0;
        }
      } else {
        const found = products.find(p => p.id === selectedItemId);
        if (found && (found.cost_reference || 0) > 0) {
          defaultCost = found.cost_reference || 0;
        }
      }
      return {
        ...item,
        item_id: selectedItemId,
        unit_cost: defaultCost
      };
    }));
  };

  const handleQuantityChange = (id: string, qty: number) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, quantity: qty } : item));
  };

  const handleUnitCostChange = (id: string, cost: number) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, unit_cost: cost } : item));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!supplierId) {
      setError('Please select a supplier.');
      return;
    }

    if (items.length === 0) {
      setError('At least one item is required.');
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.item_id) {
        setError(`Item row #${i + 1} has no material/product selected.`);
        return;
      }
      if (it.quantity <= 0) {
        setError(`Item row #${i + 1} quantity must be greater than 0.`);
        return;
      }
      if (it.unit_cost < 0) {
        setError(`Item row #${i + 1} unit cost cannot be negative.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = {
        supplier_id: supplierId,
        date: purchaseDate ? new Date(purchaseDate).toISOString() : new Date().toISOString(),
        notes: notes.trim(),
        cash_paid: Number(cashPaid) || 0,
        items: items.map(it => ({
          item_type: it.item_type,
          material_id: it.item_type === 'RAW_MATERIAL' ? it.item_id : null,
          product_id: it.item_type === 'RESALE_PRODUCT' ? it.item_id : null,
          quantity: Number(it.quantity),
          unit_cost: Number(it.unit_cost)
        }))
      };

      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to record purchase');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error recording purchase intake');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-200 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">Record Purchase Intake</h3>
              <p className="text-[11px] text-slate-500">
                Log vendor deliveries: raw materials or resale products with immediate inventory updates
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-semibold">{error}</span>
            </div>
          )}

          {/* Top Bar: Supplier, Date, Notes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Supplier <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={supplierId}
                onChange={e => setSupplierId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
              >
                <option value="">-- Choose Supplier --</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.phone ? `(${s.phone})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Purchase Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={purchaseDate}
                onChange={e => setPurchaseDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Invoice / Reference #</label>
              <input
                type="text"
                placeholder="e.g. Facture #8841"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
              />
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                Delivered Items ({items.length})
              </span>
              <button
                type="button"
                onClick={handleAddItem}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg font-bold text-xs transition-colors border border-emerald-200"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Item
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
              <div className="overflow-x-auto max-h-60 overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold text-[10px] uppercase sticky top-0">
                    <tr>
                      <th className="p-2.5 pl-3 w-36">Type</th>
                      <th className="p-2.5">Item Name</th>
                      <th className="p-2.5 w-24 text-right">Quantity</th>
                      <th className="p-2.5 w-28 text-right">Unit Cost (DT)</th>
                      <th className="p-2.5 w-24 text-right">Line Total</th>
                      <th className="p-2.5 w-10 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {items.map((item) => {
                      const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_cost) || 0);

                      return (
                        <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="p-2 pl-3">
                            <select
                              value={item.item_type}
                              onChange={e => handleItemTypeChange(item.id, e.target.value as any)}
                              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 bg-white"
                            >
                              <option value="RAW_MATERIAL">Raw Material</option>
                              <option value="RESALE_PRODUCT">Resale Product</option>
                            </select>
                          </td>

                          <td className="p-2">
                            {item.item_type === 'RAW_MATERIAL' ? (
                              <select
                                value={item.item_id}
                                onChange={e => handleItemSelect(item.id, e.target.value)}
                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 bg-white"
                              >
                                <option value="">-- Choose Material --</option>
                                {materials.map(m => (
                                  <option key={m.id} value={m.id}>
                                    {m.name} ({m.category}) — stock: {m.stock_quantity} {m.unit}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <select
                                value={item.item_id}
                                onChange={e => handleItemSelect(item.id, e.target.value)}
                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 bg-white"
                              >
                                <option value="">-- Choose Resale Product --</option>
                                {products.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} {p.size_label ? `(${p.size_label})` : ''} — stock: {p.stock_quantity}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>

                          <td className="p-2">
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              required
                              value={item.quantity}
                              onChange={e => handleQuantityChange(item.id, parseFloat(e.target.value) || 0)}
                              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono text-right bg-white"
                            />
                          </td>

                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              required
                              value={item.unit_cost}
                              onChange={e => handleUnitCostChange(item.id, parseFloat(e.target.value) || 0)}
                              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono text-right bg-white"
                            />
                          </td>

                          <td className="p-2 text-right font-mono font-bold text-slate-800">
                            {lineTotal.toFixed(3)}
                          </td>

                          <td className="p-2 text-center">
                            {items.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(item.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
                                title="Remove line item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Payment & Debt Section */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                Payment Allocation
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCashPaid(totalAmount)}
                  className="px-2 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded font-bold text-[10px] transition-colors"
                >
                  Pay Full in Cash
                </button>
                <button
                  type="button"
                  onClick={() => setCashPaid(0)}
                  className="px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded font-bold text-[10px] transition-colors"
                >
                  All on Credit (0 DT)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Invoice</span>
                <span className="text-base font-mono font-black text-slate-900">
                  {totalAmount.toFixed(3)} <span className="text-xs font-normal text-slate-500">DT</span>
                </span>
              </div>

              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <label className="text-[10px] uppercase font-bold text-slate-700 block mb-1">
                  Cash Paid Upfront
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={cashPaid}
                    onChange={e => setCashPaid(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-mono font-bold text-emerald-700 text-sm"
                  />
                  <span className="absolute right-2 top-1 text-slate-400 font-mono text-xs">DT</span>
                </div>
              </div>

              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Remaining Balance</span>
                <span className={`text-base font-mono font-black ${remainingDebt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {remainingDebt.toFixed(3)} <span className="text-xs font-normal text-slate-500">DT</span>
                </span>
              </div>
            </div>

            {remainingDebt > 0 ? (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-800 text-[11px]">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                <span>
                  A supplier debt ticket of <strong>{remainingDebt.toFixed(3)} DT</strong> will be recorded for{' '}
                  <strong>{selectedSupplier?.name || 'the supplier'}</strong>.
                </span>
              </div>
            ) : (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-800 text-[11px]">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>Invoice fully settled upfront in cash. No open debt ticket will be created.</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || totalAmount <= 0}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2"
            >
              {isSubmitting ? 'Recording...' : 'Save & Record Purchase'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
