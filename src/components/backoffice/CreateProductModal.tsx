import React, { useState, useEffect } from 'react';
import { X, Package, AlertCircle, Plus, Edit2 } from 'lucide-react';
import type { Product, ProductFamily, Formulation, ContainerType } from '../../types/index.js';

interface CreateProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  families: ProductFamily[];
  formulations: Formulation[];
  containerTypes: ContainerType[];
  familyToEdit?: ProductFamily | null;
  productToEdit?: Product | null;
}

export const CreateProductModal: React.FC<CreateProductModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  families,
  formulations,
  containerTypes,
  familyToEdit,
  productToEdit
}) => {
  // Mode: create a brand new product family + initial SKU, or add a new SKU to an existing family
  const [mode, setMode] = useState<'NEW_FAMILY' | 'EXISTING_FAMILY'>('NEW_FAMILY');

  // Family fields
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [familyCategory, setFamilyCategory] = useState('Detergents');
  const [familyType, setFamilyType] = useState<'MANUFACTURED' | 'RESALE'>('MANUFACTURED');
  const [formulationId, setFormulationId] = useState('');

  // SKU fields
  const [skuName, setSkuName] = useState('');
  const [sizeLabel, setSizeLabel] = useState('1L');
  const [barcode, setBarcode] = useState('');
  const [retailPrice, setRetailPrice] = useState('3.500');
  const [wholesalePrice, setWholesalePrice] = useState('2.800');
  const [costReference, setCostReference] = useState('0.000');
  const [stockQuantity, setStockQuantity] = useState('0');
  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  const [containerTypeId, setContainerTypeId] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync fields when editing
  useEffect(() => {
    if (familyToEdit) {
      setFamilyName(familyToEdit.name);
      setFamilyCategory(familyToEdit.category || 'General');
      setFamilyType(familyToEdit.type || 'MANUFACTURED');
      setFormulationId(familyToEdit.formulation_id || '');
    } else if (productToEdit) {
      setSkuName(productToEdit.name);
      setSizeLabel(productToEdit.size_label || '');
      setBarcode(productToEdit.barcode || '');
      setRetailPrice(productToEdit.retail_price ? productToEdit.retail_price.toFixed(3) : '0.000');
      setWholesalePrice(productToEdit.wholesale_price ? productToEdit.wholesale_price.toFixed(3) : '0.000');
      setCostReference(productToEdit.cost_reference ? productToEdit.cost_reference.toFixed(3) : '0.000');
      setStockQuantity(String(productToEdit.stock_quantity ?? 0));
      setLowStockThreshold(String(productToEdit.low_stock_threshold ?? 5));
      setContainerTypeId(productToEdit.container_type_id || '');
      setSelectedFamilyId(productToEdit.family_id || '');
    } else {
      setFamilyName('');
      setFamilyCategory('Detergents');
      setFamilyType('MANUFACTURED');
      setFormulationId('');
      setSkuName('');
      setSizeLabel('1L');
      setBarcode('');
      setRetailPrice('3.500');
      setWholesalePrice('2.800');
      setCostReference('0.000');
      setStockQuantity('0');
      setLowStockThreshold('5');
      setContainerTypeId('');
    }
  }, [familyToEdit, productToEdit, isOpen]);

  // Auto-generate suggested SKU name based on family name & size
  useEffect(() => {
    if (familyToEdit || productToEdit) return;
    if (mode === 'NEW_FAMILY') {
      if (familyName.trim()) {
        setSkuName(`${familyName.trim()} ${sizeLabel}`.trim());
      }
    } else {
      const fam = families.find(f => f.id === selectedFamilyId);
      if (fam) {
        setSkuName(`${fam.name} ${sizeLabel}`.trim());
      }
    }
  }, [familyName, selectedFamilyId, sizeLabel, mode, families, familyToEdit, productToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (familyToEdit) {
        const finalFamilyName = familyName.trim();
        if (!finalFamilyName) throw new Error('Family name is required');
        const res = await fetch(`/api/products/families/${familyToEdit.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: finalFamilyName,
            category: familyCategory.trim() || 'General',
            type: familyType,
            formulation_id: familyType === 'MANUFACTURED' && formulationId ? formulationId : null
          })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update family');
        }
        onSuccess();
        onClose();
        return;
      }

      if (productToEdit) {
        const finalSkuName = skuName.trim();
        if (!finalSkuName) throw new Error('SKU name is required');
        const res = await fetch(`/api/products/${productToEdit.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: finalSkuName,
            size_label: sizeLabel.trim() || null,
            barcode: barcode.trim() || null,
            cost_reference: parseFloat(costReference) || 0,
            retail_price: parseFloat(retailPrice) || 0,
            wholesale_price: parseFloat(wholesalePrice) || 0,
            stock_quantity: parseFloat(stockQuantity) || 0,
            low_stock_threshold: parseFloat(lowStockThreshold) || 5,
            container_type_id: containerTypeId || null
          })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update product');
        }
        onSuccess();
        onClose();
        return;
      }

      let targetFamilyId = selectedFamilyId;
      // 1. If NEW_FAMILY mode, create family first
      if (mode === 'NEW_FAMILY') {
        const finalFamilyName = familyName.trim();
        if (!finalFamilyName) {
          throw new Error('Family name is required');
        }

        const famRes = await fetch('/api/products/families', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: finalFamilyName,
            category: familyCategory.trim() || 'General',
            type: familyType,
            formulation_id: familyType === 'MANUFACTURED' && formulationId ? formulationId : null
          })
        });

        if (!famRes.ok) {
          const data = await famRes.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to create product family');
        }

        const createdFamily = await famRes.json();
        targetFamilyId = createdFamily.id;
      }

      if (!targetFamilyId) {
        throw new Error('Target product family is required');
      }

      // 2. Create SKU under target family
      const finalSkuName = skuName.trim() || (mode === 'NEW_FAMILY' ? familyName.trim() : 'New SKU');
      const prodRes = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          family_id: targetFamilyId,
          name: finalSkuName,
          size_label: sizeLabel.trim() || null,
          barcode: barcode.trim() || null,
          cost_reference: parseFloat(costReference) || 0,
          retail_price: parseFloat(retailPrice) || 0,
          wholesale_price: parseFloat(wholesalePrice) || 0,
          stock_quantity: parseFloat(stockQuantity) || 0,
          low_stock_threshold: parseFloat(lowStockThreshold) || 5,
          container_type_id: containerTypeId || null
        })
      });

      if (!prodRes.ok) {
        const data = await prodRes.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create product SKU');
      }

      // Reset form
      setFamilyName('');
      setSkuName('');
      setBarcode('');
      setStockQuantity('0');
      setRetailPrice('3.500');
      setWholesalePrice('2.800');
      setCostReference('0.000');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error creating product');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              {familyToEdit || productToEdit ? <Edit2 className="w-4 h-4" /> : <Package className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                {familyToEdit ? `Edit Family: ${familyToEdit.name}` : productToEdit ? `Edit SKU: ${productToEdit.name}` : 'Add Product Family & SKU'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {familyToEdit ? 'Modify category, manufacturing type, or linked recipe' : productToEdit ? 'Update barcode, prices, packaging, and stock' : 'Configure catalog product family, sizing, barcodes, and pricing'}
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

        {/* Mode Toggle Tabs (only in create mode) */}
        {!familyToEdit && !productToEdit && (
          <div className="flex border-b border-slate-200 px-5 pt-3 gap-3 bg-slate-50/30 text-xs font-bold">
            <button
              type="button"
              onClick={() => setMode('NEW_FAMILY')}
              className={`pb-2.5 border-b-2 transition-colors ${
                mode === 'NEW_FAMILY'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              1. New Product Family + First SKU
            </button>
            {families.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMode('EXISTING_FAMILY');
                  if (!selectedFamilyId && families[0]) {
                    setSelectedFamilyId(families[0].id);
                  }
                }}
                className={`pb-2.5 border-b-2 transition-colors ${
                  mode === 'EXISTING_FAMILY'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                2. Add Size/SKU to Existing Family
              </button>
            )}
          </div>
        )}

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Section A: Product Family */}
          {(!productToEdit && (familyToEdit || mode === 'NEW_FAMILY')) && (
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
              <h4 className="text-xs font-black uppercase text-slate-500 tracking-wider">
                Product Family Details
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Family Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Eau de Javel, Liquide Vaisselle, Dégraissant Sol..."
                    value={familyName}
                    onChange={e => setFamilyName(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Category *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Detergents, Hygiene, Auto..."
                    value={familyCategory}
                    onChange={e => setFamilyCategory(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Product Type *
                  </label>
                  <select
                    value={familyType}
                    onChange={e => setFamilyType(e.target.value as any)}
                    className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="MANUFACTURED">Manufactured (In-House Batch)</option>
                    <option value="RESALE">Resale (Bought from Supplier)</option>
                  </select>
                </div>

                {familyType === 'MANUFACTURED' && (
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Linked Formulation (Optional)
                    </label>
                    <select
                      value={formulationId}
                      onChange={e => setFormulationId(e.target.value)}
                      className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    >
                      <option value="">None / Will link later</option>
                      {formulations.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Existing Family selector (only in create mode when mode === EXISTING_FAMILY) */}
          {!familyToEdit && !productToEdit && mode === 'EXISTING_FAMILY' && (
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Select Existing Product Family *
              </label>
              <select
                required
                value={selectedFamilyId}
                onChange={e => setSelectedFamilyId(e.target.value)}
                className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                {families.map(f => (
                  <option key={f.id} value={f.id}>{f.name} ({f.category})</option>
                ))}
              </select>
            </div>
          )}

          {/* Section B: Size Variant / SKU (rendered in create mode OR SKU edit mode) */}
          {!familyToEdit && (
            <div className="p-4 bg-blue-50/40 rounded-xl border border-blue-200/60 space-y-3">
              <h4 className="text-xs font-black uppercase text-blue-900 tracking-wider">
                SKU & Size Variant
              </h4>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    SKU Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Javel Bleach 1L"
                    value={skuName}
                    onChange={e => setSkuName(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Size Label (e.g. 1L, 5L, Piece) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="1L, 1.5L, 5L, Piece..."
                    value={sizeLabel}
                    onChange={e => setSizeLabel(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Barcode (Optional — auto-generated if left empty)
                  </label>
                  <input
                    type="text"
                    placeholder="Leave empty for auto-generated Code-128 barcode..."
                    value={barcode}
                    onChange={e => setBarcode(e.target.value)}
                    className="w-full text-xs font-mono font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  />
                </div>

                <div className="col-span-2 grid grid-cols-3 gap-2.5 p-3 bg-white rounded-xl border border-blue-200">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Cost Ref. (DT)
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={costReference}
                      onChange={e => setCostReference(e.target.value)}
                      placeholder="0.000"
                      className="w-full text-xs font-bold font-mono px-2.5 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    />
                    <span className="text-[10px] text-slate-400">Manual / initial cost</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Wholesale (DT) *
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      required
                      value={wholesalePrice}
                      onChange={e => setWholesalePrice(e.target.value)}
                      className="w-full text-xs font-bold font-mono px-2.5 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    />
                    <span className="text-[10px] text-slate-400">Gros price</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Retail (DT) *
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      required
                      value={retailPrice}
                      onChange={e => setRetailPrice(e.target.value)}
                      className="w-full text-xs font-bold font-mono px-2.5 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    />
                    <span className="text-[10px] text-slate-400">Détail price</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Initial Stock
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={stockQuantity}
                    onChange={e => setStockQuantity(e.target.value)}
                    className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Low Stock Threshold
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={lowStockThreshold}
                    onChange={e => setLowStockThreshold(e.target.value)}
                    className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Returnable Container Type (Optional)
                  </label>
                  <select
                    value={containerTypeId}
                    onChange={e => setContainerTypeId(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="">None (Single-use packaging)</option>
                    {containerTypes.map(ct => (
                      <option key={ct.id} value={ct.id}>{ct.name} ({ct.capacity_liters ? `${ct.capacity_liters}L` : 'Returnable'})</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

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
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-sm transition-colors flex items-center justify-center gap-1.5"
            >
              {familyToEdit || productToEdit ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              <span>
                {isSubmitting
                  ? 'Saving...'
                  : familyToEdit
                  ? 'Update Product Family'
                  : productToEdit
                  ? 'Update Product SKU'
                  : 'Create Product SKU'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
