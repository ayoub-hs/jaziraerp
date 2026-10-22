import React, { useState, useEffect } from 'react';
import { X, FlaskConical, AlertCircle } from 'lucide-react';
import type { Supplier, RawMaterial } from '../../types/index.js';
import { useBackButton } from '../../utils/backButton.js';

interface CreateMaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  suppliers: Supplier[];
  materialToEdit?: RawMaterial | null;
}

const COMMON_CATEGORIES = [
  { value: 'surfactant', label: 'Tensioactif (Surfactant)' },
  { value: 'alkali', label: 'Base / Soude (Alcali)' },
  { value: 'acid', label: 'Acide' },
  { value: 'solvent', label: 'Solvant / Alcool' },
  { value: 'fragrance', label: 'Parfum / Fragrance' },
  { value: 'colorant', label: 'Colorant' },
  { value: 'preservative', label: 'Conservateur' },
  { value: 'bottle', label: 'Emballage : Bouteille / Bidon' },
  { value: 'cap', label: 'Emballage : Bouchon' },
  { value: 'label', label: 'Emballage : Étiquette' },
  { value: 'box', label: 'Emballage : Carton / Caisse' },
  { value: 'other', label: 'Autre' }
];

const COMMON_UNITS = [
  { value: 'kg', label: 'Kilogramme (kg)' },
  { value: 'L', label: 'Litre (L)' },
  { value: 'pcs', label: 'Pièce / Unité (pcs)' },
  { value: 'g', label: 'Gramme (g)' },
  { value: 'ml', label: 'Millilitre (ml)' }
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

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

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
      setError('Le nom de la matière est requis');
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
        throw new Error(data.error || `Échec de ${materialToEdit ? 'la mise à jour' : 'la création'} de la matière`);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'enregistrement de la matière");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden border border-slate-200">
        {/* Modal Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <FlaskConical className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                {materialToEdit ? 'Modifier la Matière / Emballage' : 'Ajouter une Matière ou Emballage'}
              </h3>
              <p className="text-pos-badge text-slate-600">
                {materialToEdit ? 'Mettre à jour les propriétés et coûts' : 'Enregistrer une nouvelle matière première, produit chimique ou emballage'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="p-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Nom de la Matière *
            </label>
            <input
              type="text"
              required
              placeholder="ex. Acide sulfonique LABSA 96%, Flacon 1L PEHD..."
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Catégorie *
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
                Unité de Mesure *
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
                Nom de la Catégorie Personnalisée *
              </label>
              <input
                type="text"
                required
                placeholder="Entrez la catégorie personnalisée"
                value={customCategory}
                onChange={e => setCustomCategory(e.target.value)}
                className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {materialToEdit ? 'Stock Actuel' : 'Stock Initial'}
              </label>
              {materialToEdit ? (
                <div className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-700 flex items-center justify-between">
                  <span>{stockQuantity} {unit}</span>
                  <span className="text-pos-badge text-slate-600 font-normal">Ajuster via Inventaire</span>
                </div>
              ) : (
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={stockQuantity}
                  onChange={e => setStockQuantity(e.target.value)}
                  className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Coût d'Achat Initial / Dernier (DT)
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={latestPurchaseCost}
                onChange={e => setLatestPurchaseCost(e.target.value)}
                className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <p className="text-pos-badge text-slate-600 mt-1">
                Utilisé uniquement s'il n'y a pas d'achat cette année ; sinon le coût moyen des achats est appliqué.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Seuil d'Alerte Stock Bas
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
              Fournisseur (Facultatif)
            </label>
            <select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">Aucun / Non spécifié</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          </div>

          {/* Modal Footer */}
          <div className="shrink-0 flex gap-2.5 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-sm transition-colors flex items-center justify-center gap-1.5"
            >
              <FlaskConical className="w-4 h-4" />
              <span>{isSubmitting ? 'Enregistrement...' : (materialToEdit ? 'Enregistrer' : 'Créer la matière')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
