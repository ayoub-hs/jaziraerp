import React, { useState, useEffect, useMemo } from 'react';
import { X, Layers, Plus, Trash2, AlertCircle, Calculator, Eye, Play, AlertTriangle } from 'lucide-react';
import type { RawMaterial, Formulation } from '../../types/index.js';
import { formatMoney } from '../../utils/formatters.js';

interface CreateFormulationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  materials: RawMaterial[];
  formulationToEdit?: Formulation | null;
}

interface RecipeItemRow {
  id: string;
  material_id: string;
  quantity_required: string;
}

export const CreateFormulationModal: React.FC<CreateFormulationModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  materials,
  formulationToEdit
}) => {
  const [name, setName] = useState('');
  const [baseYieldQuantity, setBaseYieldQuantity] = useState('100');
  const [baseYieldUnit, setBaseYieldUnit] = useState('L');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<RecipeItemRow[]>([
    { id: '1', material_id: materials[0]?.id || '', quantity_required: '10' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Batch preview state
  const [previewUnits, setPreviewUnits] = useState('100');
  const [previewData, setPreviewData] = useState<any>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setPreviewData(null);
      setShowPreviewModal(false);

      if (formulationToEdit) {
        setName(formulationToEdit.name);
        setBaseYieldQuantity(String((formulationToEdit as any).base_yield_quantity || formulationToEdit.base_volume || 100));
        setBaseYieldUnit((formulationToEdit as any).base_yield_unit || 'L');
        setNotes(formulationToEdit.notes || '');
        setPreviewUnits(String((formulationToEdit as any).base_yield_quantity || formulationToEdit.base_volume || 100));

        // Fetch formulation recipe items with costing
        fetch(`/api/formulations/${formulationToEdit.id}`)
          .then(res => res.json())
          .then(data => {
            if (data.items && Array.isArray(data.items)) {
              setItems(
                data.items.map((item: any, idx: number) => ({
                  id: item.id || String(idx + 1),
                  material_id: item.material_id,
                  quantity_required: String(item.quantity_required)
                }))
              );
            }
          })
          .catch(() => setError('Error loading formulation items'));
      } else {
        setName('');
        setBaseYieldQuantity('100');
        setBaseYieldUnit('L');
        setNotes('');
        setItems([
          { id: '1', material_id: materials[0]?.id || '', quantity_required: '10' }
        ]);
      }
    }
  }, [isOpen, formulationToEdit, materials]);

  // Add new ingredient row
  const handleAddIngredient = () => {
    setItems(prev => [
      ...prev,
      { id: String(Date.now()), material_id: materials[0]?.id || '', quantity_required: '1' }
    ]);
  };

  // Remove row
  const handleRemoveIngredient = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  // Update row
  const handleUpdateItem = (id: string, field: 'material_id' | 'quantity_required', value: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  // Live Recipe Cost calculation
  const recipeCostSummary = useMemo(() => {
    let totalCost = 0;
    const yieldQty = parseFloat(baseYieldQuantity) || 1;

    items.forEach(item => {
      const mat = materials.find(m => m.id === item.material_id);
      const qty = parseFloat(item.quantity_required) || 0;
      const unitCost = mat?.latest_purchase_cost ?? mat?.current_cost_per_unit ?? 0;
      totalCost += qty * unitCost;
    });

    const costPerUnit = yieldQty > 0 ? totalCost / yieldQty : 0;
    return {
      totalCost,
      costPerUnit
    };
  }, [items, materials, baseYieldQuantity]);

  const handlePreviewBatch = async () => {
    setError(null);
    setIsPreviewLoading(true);
    try {
      const units = parseFloat(previewUnits) || 1;
      if (formulationToEdit) {
        const res = await fetch(`/api/formulations/${formulationToEdit.id}/preview-batch?target_units=${units}`);
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to calculate batch preview');
        }
        const data = await res.json();
        setPreviewData(data);
      } else {
        // Compute client preview for unsaved formulation
        const baseYield = parseFloat(baseYieldQuantity) || 1;
        const factor = units / baseYield;
        let totalCost = 0;
        const ingredients = items.map(i => {
          const mat = materials.find(m => m.id === i.material_id);
          const req = (parseFloat(i.quantity_required) || 0) * factor;
          const unitCost = mat?.latest_purchase_cost ?? mat?.current_cost_per_unit ?? 0;
          const cost = req * unitCost;
          totalCost += cost;
          const curStock = mat?.stock_quantity ?? 0;
          return {
            material_id: i.material_id,
            material_name: mat?.name || 'Unknown',
            material_unit: mat?.unit || 'kg',
            quantity_consumed: req,
            unit_cost: unitCost,
            total_cost: cost,
            current_stock: curStock,
            remaining_stock_after_batch: curStock - req
          };
        });
        setPreviewData({
          targetOutputUnits: units,
          scalingFactor: factor,
          totalBatchCost: totalCost,
          costPerUnit: units > 0 ? totalCost / units : 0,
          ingredients
        });
      }
      setShowPreviewModal(true);
    } catch (err: any) {
      setError(err.message || 'Error calculating preview');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!formulationToEdit) return;
    if (!window.confirm(`Delete formulation recipe "${formulationToEdit.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      setIsDeleting(true);
      setError(null);
      const res = await fetch(`/api/formulations/${formulationToEdit.id}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to delete formulation');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error deleting formulation');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const finalName = name.trim();
    if (!finalName) {
      setError('Formulation name is required');
      return;
    }

    const validItems = items
      .filter(i => i.material_id && parseFloat(i.quantity_required) > 0)
      .map(i => ({
        material_id: i.material_id,
        quantity_required: parseFloat(i.quantity_required)
      }));

    if (validItems.length === 0) {
      setError('At least one ingredient with a quantity > 0 is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const url = formulationToEdit ? `/api/formulations/${formulationToEdit.id}` : '/api/formulations';
      const method = formulationToEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalName,
          notes: notes.trim(),
          base_yield_quantity: parseFloat(baseYieldQuantity) || 1,
          base_yield_unit: baseYieldUnit.trim() || 'L',
          items: validItems
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${formulationToEdit ? 'update' : 'create'} formulation`);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error saving formulation');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                {formulationToEdit ? 'Formulation Recipe Editor' : 'Formulation Recipe Builder'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {formulationToEdit ? 'View, edit ingredients, preview batch scale, or delete formulation' : 'Define chemical recipe ingredients, yield, and auto-cost reference'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Formulation Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Nettoyant Sol Lavande Standard, Javel 12°..."
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Base Yield *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.1"
                  required
                  value={baseYieldQuantity}
                  onChange={e => setBaseYieldQuantity(e.target.value)}
                  className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Unit *
                </label>
                <select
                  value={baseYieldUnit}
                  onChange={e => setBaseYieldUnit(e.target.value)}
                  className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
                >
                  <option value="L">Liters (L)</option>
                  <option value="kg">Kilograms (kg)</option>
                  <option value="pcs">Pieces (pcs)</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Manufacturing Instructions / Notes
            </label>
            <input
              type="text"
              placeholder="e.g. Dilute surfactant first, stir at 40°C, add colorant last..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
            />
          </div>

          {/* Recipe Ingredients Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span>Recipe Ingredients & Packaging ({items.length})</span>
              </label>
              <button
                type="button"
                onClick={handleAddIngredient}
                className="flex items-center gap-1 text-purple-700 hover:text-purple-800 text-xs font-bold bg-purple-50 hover:bg-purple-100 px-2.5 py-1 rounded-lg transition-colors border border-purple-200"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Ingredient
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                    <th className="p-2.5">Raw Material / Component</th>
                    <th className="p-2.5 w-32">Qty for Base Yield</th>
                    <th className="p-2.5 text-right w-24">Unit Cost</th>
                    <th className="p-2.5 text-right w-28">Cost Subtotal</th>
                    <th className="p-2.5 text-center w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item, index) => {
                    const mat = materials.find(m => m.id === item.material_id);
                    const qty = parseFloat(item.quantity_required) || 0;
                    const unitCost = mat?.latest_purchase_cost ?? mat?.current_cost_per_unit ?? 0;
                    const subtotal = qty * unitCost;

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/50">
                        <td className="p-2">
                          <select
                            value={item.material_id}
                            onChange={e => handleUpdateItem(item.id, 'material_id', e.target.value)}
                            className="w-full text-xs font-semibold px-2 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                          >
                            {materials.map(m => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.unit}) — Stock: {m.stock_quantity}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="p-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="any"
                              min="0.001"
                              required
                              value={item.quantity_required}
                              onChange={e => handleUpdateItem(item.id, 'quantity_required', e.target.value)}
                              className="w-full text-xs font-bold font-mono px-2 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                            />
                            <span className="text-[11px] font-bold text-slate-500 w-8 text-left shrink-0">
                              {mat?.unit || ''}
                            </span>
                          </div>
                        </td>

                        <td className="p-2 text-right font-mono font-semibold text-slate-600">
                          {formatMoney(unitCost)}
                        </td>

                        <td className="p-2 text-right font-mono font-bold text-slate-900">
                          {formatMoney(subtotal)}
                        </td>

                        <td className="p-2 text-center">
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveIngredient(item.id)}
                              className="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                              title="Remove ingredient"
                            >
                              <Trash2 className="w-4 h-4" />
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

          {/* Live Cost Calculation Card */}
          <div className="p-4 bg-purple-50/70 rounded-xl border border-purple-200/80 flex items-center justify-between">
            <div className="flex items-center gap-2 text-purple-900">
              <Calculator className="w-5 h-5 text-purple-700" />
              <div>
                <span className="text-xs font-bold block">Live Recipe Costing</span>
                <span className="text-[11px] text-purple-700">Calculated from current raw material purchase costs</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-slate-500 block">Total Base Cost:</span>
              <span className="text-base font-black font-mono text-purple-950">
                {formatMoney(recipeCostSummary.totalCost)}
              </span>
              <span className="text-[11px] text-emerald-700 font-bold block font-mono">
                ≈ {formatMoney(recipeCostSummary.costPerUnit)} / {baseYieldUnit}
              </span>
            </div>
          </div>

          {/* Batch Preview Section */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-slate-600" />
              <span className="text-xs font-bold text-slate-700">Preview Batch Scale:</span>
              <input
                type="number"
                min="1"
                step="any"
                value={previewUnits}
                onChange={e => setPreviewUnits(e.target.value)}
                className="w-20 px-2 py-1 text-xs font-mono font-bold border border-slate-300 rounded-lg bg-white"
              />
              <span className="text-xs font-semibold text-slate-600">{baseYieldUnit}</span>
            </div>
            <button
              type="button"
              onClick={handlePreviewBatch}
              disabled={isPreviewLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 text-slate-700" />
              {isPreviewLoading ? 'Calculating...' : 'Preview Requirements & Stock'}
            </button>
          </div>

          {/* Preview Details Display */}
          {showPreviewModal && previewData && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2 text-xs animate-in fade-in duration-150">
              <div className="flex justify-between items-center font-bold text-blue-900 border-b border-blue-200/60 pb-1.5">
                <span>Batch Output: {previewData.targetOutputUnits} {baseYieldUnit}</span>
                <span>Total Expected Cost: {formatMoney(previewData.totalBatchCost)} ({formatMoney(previewData.costPerUnit)} / {baseYieldUnit})</span>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {previewData.ingredients?.map((ing: any) => {
                  const isShortage = ing.remaining_stock_after_batch < 0;
                  return (
                    <div key={ing.material_id} className="flex items-center justify-between text-[11px] py-0.5 border-b border-blue-100">
                      <span className="font-semibold text-slate-800">{ing.material_name}:</span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-slate-600">Requires {ing.quantity_consumed} {ing.material_unit} ({formatMoney(ing.total_cost)})</span>
                        <span className={`font-mono font-bold px-1 rounded ${isShortage ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                          {isShortage ? `Shortage: ${ing.remaining_stock_after_batch} ${ing.material_unit}` : `Remaining: ${ing.remaining_stock_after_batch} ${ing.material_unit}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Modal Footer */}
          <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
            {formulationToEdit ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-3.5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4 text-rose-600" />
                <span>{isDeleting ? 'Deleting...' : 'Delete Recipe'}</span>
              </button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || materials.length === 0}
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-sm transition-colors flex items-center justify-center gap-1.5"
              >
                <Layers className="w-4 h-4" />
                <span>{isSubmitting ? 'Saving...' : (formulationToEdit ? 'Save Changes' : 'Create Formulation')}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
