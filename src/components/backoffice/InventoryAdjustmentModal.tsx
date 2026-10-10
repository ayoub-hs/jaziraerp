import React, { useState, useMemo } from 'react';
import { X, Scale, AlertCircle } from 'lucide-react';
import type { RawMaterial, Product } from '../../types/index.js';
import { useBackButton } from '../../utils/backButton.js';

interface InventoryAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  materials: RawMaterial[];
  products: Product[];
  initialType?: 'RAW_MATERIAL' | 'PRODUCT';
}

export const InventoryAdjustmentModal: React.FC<InventoryAdjustmentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  materials,
  products,
  initialType = 'PRODUCT'
}) => {
  const [itemType, setItemType] = useState<'RAW_MATERIAL' | 'PRODUCT'>(initialType);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantityDelta, setQuantityDelta] = useState('-1');
  const [reason, setReason] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  React.useEffect(() => {
    if (isOpen && initialType) {
      setItemType(initialType);
    }
  }, [isOpen, initialType]);

  // Set default selected item
  React.useEffect(() => {
    if (itemType === 'RAW_MATERIAL') {
      if (materials.length > 0 && (!selectedItemId || !materials.some(m => m.id === selectedItemId))) {
        setSelectedItemId(materials[0].id);
      }
    } else {
      if (products.length > 0 && (!selectedItemId || !products.some(p => p.id === selectedItemId))) {
        setSelectedItemId(products[0].id);
      }
    }
  }, [itemType, materials, products]);

  // Current item info & projected stock calculation
  const currentItemInfo = useMemo(() => {
    if (itemType === 'RAW_MATERIAL') {
      const mat = materials.find(m => m.id === selectedItemId);
      return {
        name: mat?.name || '',
        unit: mat?.unit || '',
        currentStock: mat?.stock_quantity ?? 0
      };
    } else {
      const prod = products.find(p => p.id === selectedItemId);
      return {
        name: prod ? `${prod.name} (${prod.size_label || 'Piece'})` : '',
        unit: prod?.size_label || 'pcs',
        currentStock: prod?.stock_quantity ?? 0
      };
    }
  }, [itemType, selectedItemId, materials, products]);

  const projectedStock = useMemo(() => {
    const delta = parseFloat(quantityDelta) || 0;
    return currentItemInfo.currentStock + delta;
  }, [currentItemInfo.currentStock, quantityDelta]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedItemId) {
      setError('Please select an item to adjust');
      return;
    }

    const delta = parseFloat(quantityDelta);
    if (isNaN(delta) || delta === 0) {
      setError('Quantity delta must be a non-zero number');
      return;
    }

    const finalReason = reason.trim();
    if (!finalReason) {
      setError('Adjustment reason is required for audit trail');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/inventory/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_type: itemType,
          item_id: selectedItemId,
          quantity_delta: delta,
          reason: finalReason
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to record inventory adjustment');
      }

      setQuantityDelta('-1');
      setReason('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error recording adjustment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">Manual Stock Adjustment</h3>
              <p className="text-[11px] text-slate-500">Record breakage, shrinkage, spill, or physical inventory count</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-700 mb-1">Item Category Type *</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setItemType('PRODUCT')}
                className={`py-2 px-3 rounded-xl font-bold border transition-colors ${
                  itemType === 'PRODUCT'
                    ? 'border-orange-600 bg-orange-50 text-orange-900'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Finished Product SKU
              </button>
              <button
                type="button"
                onClick={() => setItemType('RAW_MATERIAL')}
                className={`py-2 px-3 rounded-xl font-bold border transition-colors ${
                  itemType === 'RAW_MATERIAL'
                    ? 'border-orange-600 bg-orange-50 text-orange-900'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Raw Material / Packaging
              </button>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Select Item *</label>
            <select
              value={selectedItemId}
              onChange={e => setSelectedItemId(e.target.value)}
              className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
            >
              {itemType === 'PRODUCT' ? (
                products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.size_label || 'Piece'}) — Current: {p.stock_quantity}
                  </option>
                ))
              ) : (
                materials.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.category || m.type}) — Current: {m.stock_quantity} {m.unit}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Current Stock vs Projected */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 grid grid-cols-3 gap-2 text-center">
            <div>
              <span className="text-[10px] text-slate-500 font-bold block uppercase">Current</span>
              <span className="font-mono font-bold text-slate-800 text-sm">{currentItemInfo.currentStock}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-bold block uppercase">Delta</span>
              <span className={`font-mono font-bold text-sm ${parseFloat(quantityDelta) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {parseFloat(quantityDelta) > 0 ? `+${quantityDelta}` : quantityDelta}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-bold block uppercase">New Stock</span>
              <span className="font-mono font-black text-sm text-blue-700">{projectedStock}</span>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Quantity Delta (Negative for loss/breakage, Positive for found/correction) *
            </label>
            <input
              type="number"
              step="any"
              required
              placeholder="-5 or +10"
              value={quantityDelta}
              onChange={e => setQuantityDelta(e.target.value)}
              className="w-full font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Adjustment Reason / Audit Note *</label>
            <input
              type="text"
              required
              placeholder="e.g. Sac déchiré déchargement, Casse rayon, Écart inventaire physique..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
            />
          </div>

          {/* Footer */}
          <div className="flex gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
            >
              <Scale className="w-4 h-4" />
              <span>{isSubmitting ? 'Adjusting...' : 'Record Adjustment'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
