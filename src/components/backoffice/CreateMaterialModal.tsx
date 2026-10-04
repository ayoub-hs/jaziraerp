import React, { useState, useEffect } from 'react';
import { X, FlaskConical, AlertCircle } from 'lucide-react';
import type { Supplier, RawMaterial } from '../../types/index.js';

interface CreateMaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  suppliers: Supplier[];
  materialToEdit?: RawMaterial | null;
}

const COMMON_CATEGORIES = [
  { value: 'surfactant', label: 'Surfactant (Tensioactif)' },
  { value: 'alkali', label: 'Alkali (Base / Soude)' },
  { value: 'acid', label: 'Acid (Acide)' },
  { value: 'solvent', label: 'Solvent (Solvant / Alcool)' },
  { value: 'fragrance', label: 'Fragrance (Parfum)' },
  { value: 'colorant', label: 'Colorant' },
  { value: 'preservative', label: 'Preservative (Conservateur)' },
  { value: 'bottle', label: 'Packaging: Bottle / Bidon' },
  { value: 'cap', label: 'Packaging: Cap / Bouchon' },
  { value: 'label', label: 'Packaging: Label / Étiquette' },
  { value: 'box', label: 'Packaging: Box / Carton' },
  { value: 'other', label: 'Other' }
];

const COMMON_UNITS = [
  { value: 'kg', label: 'Kilogram (kg)' },
  { value: 'L', label: 'Liter (L)' },
  { value: 'pcs', label: 'Piece / Unité (pcs)' },
  { value: 'g', label: 'Gram (g)' },
  { value: 'ml', label: 'Milliliter (ml)' }
];

export const CreateMaterialModal: React.FC<CreateMaterialModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  suppliers,
  materialToEdit
}) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('surfactant');
  const [customCategory, setCustomCategory] = useState('');
  const [unit, setUnit] = useState('kg');
  const [stockQuantity, setStockQuantity] = useState('0');
  const [latestPurchaseCost, setLatestPurchaseCost] = useState('0.000');
  const [lowStockThreshold, setLowStockThreshold] = useState('10');
  const [supplierId, setSupplierId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (materialToEdit) {
        setName(materialToEdit.name);
        const isCommon = COMMON_CATEGORIES.some(c => c.value === materialToEdit.category);
        if (isCommon) {
          setCategory(materialToEdit.category || 'surfactant');
          setCustomCategory('');
        } else {
          setCategory('other');
          setCustomCategory(materialToEdit.category || '');
        }
        setUnit(materialToEdit.unit || 'kg');
        setStockQuantity(String(materialToEdit.stock_quantity ?? 0));
        setLatestPurchaseCost(String(materialToEdit.latest_purchase_cost ?? materialToEdit.current_cost_per_unit ?? '0.000'));
        setLowStockThreshold(String(materialToEdit.low_stock_threshold ?? 10));
        setSupplierId(materialToEdit.latest_supplier_id || '');
      } else {
        setName('');
        setCategory('surfactant');
        setCustomCategory('');
        setUnit('kg');
        setStockQuantity('0');
        setLatestPurchaseCost('0.000');
        setLowStockThreshold('10');
        setSupplierId('');
      }
    }
  }, [isOpen, materialToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const finalName = name.trim();
    if (!finalName) {
      setError('Material name is required');
      return;
    }

    const finalCategory = category === 'other' && customCategory.trim() 
      ? customCategory.trim().toLowerCase() 
      : category;

    setIsSubmitting(true);
    try {
      const url = materialToEdit ? `/api/materials/${materialToEdit.id}` : '/api/materials';
      const method = materialToEdit ? 'PUT' : 'POST';

      const payload = materialToEdit
        ? {
            name: finalName,
            category: finalCategory,
            unit: unit.trim(),
            low_stock_threshold: parseFloat(lowStockThreshold) || 0,
            latest_purchase_cost: parseFloat(latestPurchaseCost) || 0,
            latest_supplier_id: supplierId || null
          }
        : {
            name: finalName,
            category: finalCategory,
            unit: unit.trim(),
            stock_quantity: parseFloat(stockQuantity) || 0,
            latest_purchase_cost: parseFloat(latestPurchaseCost) || 0,
            low_stock_threshold: parseFloat(lowStockThreshold) || 0,
            latest_supplier_id: supplierId || null
          };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${materialToEdit ? 'update' : 'create'} raw material`);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error saving raw material');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-slate-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <FlaskConical className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                {materialToEdit ? 'Edit Raw Material / Packaging' : 'Add Raw Material or Packaging'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {materialToEdit ? 'Update properties and pricing' : 'Register new input ingredient, chemical, or packaging item'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Material Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Sulfonic Acid LABSA 96%, Flacon 1L PEHD..."
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Category *
              </label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                {COMMON_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Unit of Measurement *
              </label>
              <select
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                {COMMON_UNITS.map(u => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>

          {category === 'other' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Custom Category Name *
              </label>
              <input
                type="text"
                required
                placeholder="Enter custom category"
                value={customCategory}
                onChange={e => setCustomCategory(e.target.value)}
                className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Initial Stock
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={stockQuantity}
                onChange={e => setStockQuantity(e.target.value)}
                className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Initial / Last Purchase Cost (DT)
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={latestPurchaseCost}
                onChange={e => setLatestPurchaseCost(e.target.value)}
                className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Used only when there is no purchase this year; otherwise the average of this year's purchases is used.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Low Alert Threshold
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={lowStockThreshold}
                onChange={e => setLowStockThreshold(e.target.value)}
                className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Supplier (Optional)
            </label>
            <select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">None / Unspecified</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Modal Footer */}
          <div className="flex gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-sm transition-colors flex items-center justify-center gap-1.5"
            >
              <FlaskConical className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving...' : (materialToEdit ? 'Save Changes' : 'Create Material')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
