import React, { useState, useEffect, useRef } from 'react';
import { X, Package, AlertCircle, Plus, Edit2, Trash2 } from 'lucide-react';
import type { Product, ProductFamily, Formulation, ContainerType, PackSize } from '../../types/index.js';
import { formatMoney } from '../../utils/formatters.js';

interface CreateProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  families: ProductFamily[];
  formulations: Formulation[];
  containerTypes: ContainerType[];
  familyToEdit?: ProductFamily | null;
  productToEdit?: Product | null;
  onSwitchToEdit?: (product: Product) => void;
}

const DEFAULT_CATEGORIES = ['Detergents', 'Hygiene', 'Auto', 'Papier', 'Resale Goods'];

const STANDARD_SIZE_UNITS = [
  // Volumes
  '1L', '5L', '1.5L', '2L', '3L', '4L', '10L', '20L', '250ml', '500ml', '750ml',
  // Poids
  '1kg', '2kg', '3kg', '5kg', '10kg', '25kg', '100g', '250g', '500g',
  // Unités / Conditionnements
  'Piece', 'Paquet', 'Carton', 'Boîte', 'Rouleau', 'Flacon', 'Bidon'
];

export const CreateProductModal: React.FC<CreateProductModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  families,
  formulations,
  containerTypes,
  familyToEdit,
  productToEdit,
  onSwitchToEdit
}) => {
  // Mode: create a brand new product family + initial SKU, or add a new SKU to an existing family
  const [mode, setMode] = useState<'NEW_FAMILY' | 'EXISTING_FAMILY'>('NEW_FAMILY');

  // Family fields
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [familyCategory, setFamilyCategory] = useState('Detergents');
  const [availableCategories, setAvailableCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const [familyType, setFamilyType] = useState<'MANUFACTURED' | 'RESALE'>('MANUFACTURED');
  const [formulationId, setFormulationId] = useState('');

  // SKU fields
  const [skuName, setSkuName] = useState('');
  const [sizeLabel, setSizeLabel] = useState('1L');
  const [isCustomSize, setIsCustomSize] = useState(false);
  const [customSizeInput, setCustomSizeInput] = useState('');
  const [barcode, setBarcode] = useState('');
  const [retailPrice, setRetailPrice] = useState('3.500');
  const [wholesalePrice, setWholesalePrice] = useState('2.800');
  const [costReference, setCostReference] = useState('0.000');
  const [stockQuantity, setStockQuantity] = useState('0');
  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  const [containerTypeId, setContainerTypeId] = useState('');

  // Active toggles for edit mode
  const [familyActive, setFamilyActive] = useState(true);
  const [skuActive, setSkuActive] = useState(true);

  // Pack sizes repeater state
  const [existingPacks, setExistingPacks] = useState<PackSize[]>([]);
  const [pendingPacks, setPendingPacks] = useState<any[]>([]);
  const [newPackLabel, setNewPackLabel] = useState('');
  const [newPackMultiplier, setNewPackMultiplier] = useState('6');
  const [newPackPriceOverride, setNewPackPriceOverride] = useState('');
  const [newPackBarcode, setNewPackBarcode] = useState('');
  const [isAddingPack, setIsAddingPack] = useState(false);
  const isAddingPackRef = useRef(false);
  const [packError, setPackError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Price markup suggestions
  const [retailMarkup, setRetailMarkup] = useState('');
  const [wholesaleMarkup, setWholesaleMarkup] = useState('');

  // Prefill default markup percentages from shop settings and load categories
  useEffect(() => {
    if (isOpen) {
      fetch('/api/settings/shop')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            setRetailMarkup(data.default_retail_markup_percent ? String(data.default_retail_markup_percent) : '');
            setWholesaleMarkup(data.default_wholesale_markup_percent ? String(data.default_wholesale_markup_percent) : '');
          }
        })
        .catch(() => {});

      // Fetch dynamic categories from API
      fetch('/api/categories')
        .then(res => res.ok ? res.json() : [])
        .then((data: any[]) => {
          const productCats = data
            .filter((c: any) => c.type !== 'MATERIAL')
            .map((c: any) => c.name);
          const famCats = (families || []).map(f => f.category).filter(Boolean);
          const combined = Array.from(new Set([...DEFAULT_CATEGORIES, ...productCats, ...famCats]));
          setAvailableCategories(combined);
        })
        .catch(() => {
          const famCats = (families || []).map(f => f.category).filter(Boolean);
          const combined = Array.from(new Set([...DEFAULT_CATEGORIES, ...famCats]));
          setAvailableCategories(combined);
        });
    }
  }, [isOpen, families]);

  const costNum = parseFloat(costReference);
  const isCostValid = !isNaN(costNum) && costNum > 0;

  const retailMarkupNum = parseFloat(retailMarkup);
  const isRetailMarkupValid = !isNaN(retailMarkupNum) && retailMarkup.trim() !== '';
  const canSuggestRetail = isCostValid && isRetailMarkupValid;
  const retailHint = !isCostValid
    ? "Renseignez le coût d'abord (> 0)"
    : !isRetailMarkupValid
    ? "Renseignez la marge détail (%)"
    : `Suggérer: ${(Math.round(((costNum * (1 + retailMarkupNum / 100)) + Number.EPSILON) * 1000) / 1000).toFixed(3)} DT`;

  const wholesaleMarkupNum = parseFloat(wholesaleMarkup);
  const isWholesaleMarkupValid = !isNaN(wholesaleMarkupNum) && wholesaleMarkup.trim() !== '';
  const canSuggestWholesale = isCostValid && isWholesaleMarkupValid;
  const wholesaleHint = !isCostValid
    ? "Renseignez le coût d'abord (> 0)"
    : !isWholesaleMarkupValid
    ? "Renseignez la marge gros (%)"
    : `Suggérer: ${(Math.round(((costNum * (1 + wholesaleMarkupNum / 100)) + Number.EPSILON) * 1000) / 1000).toFixed(3)} DT`;

  const handleSuggestRetail = () => {
    if (!canSuggestRetail) return;
    const rounded = Math.round(((costNum * (1 + retailMarkupNum / 100)) + Number.EPSILON) * 1000) / 1000;
    setRetailPrice(rounded.toFixed(3));
  };

  const handleSuggestWholesale = () => {
    if (!canSuggestWholesale) return;
    const rounded = Math.round(((costNum * (1 + wholesaleMarkupNum / 100)) + Number.EPSILON) * 1000) / 1000;
    setWholesalePrice(rounded.toFixed(3));
  };

  // Sync fields when editing
  useEffect(() => {
    if (familyToEdit) {
      setFamilyName(familyToEdit.name);
      const cat = familyToEdit.category || 'General';
      setFamilyCategory(cat);
      setIsCustomCategory(!DEFAULT_CATEGORIES.includes(cat) && !availableCategories.includes(cat));
      setCustomCategoryInput(cat);
      setFamilyType(familyToEdit.type || 'MANUFACTURED');
      setFormulationId(familyToEdit.formulation_id || '');
      setFamilyActive(familyToEdit.active !== 0);
      setExistingPacks([]);
      setPendingPacks([]);
      setPackError(null);
    } else if (productToEdit) {
      setSkuName(productToEdit.name);
      const sz = productToEdit.size_label || '';
      setSizeLabel(sz);
      if (sz && !STANDARD_SIZE_UNITS.includes(sz)) {
        setIsCustomSize(true);
        setCustomSizeInput(sz);
      } else {
        setIsCustomSize(false);
        setCustomSizeInput('');
      }
      setBarcode(productToEdit.barcode || '');
      setRetailPrice(productToEdit.retail_price ? productToEdit.retail_price.toFixed(3) : '0.000');
      setWholesalePrice(productToEdit.wholesale_price ? productToEdit.wholesale_price.toFixed(3) : '0.000');
      setCostReference(productToEdit.cost_reference ? productToEdit.cost_reference.toFixed(3) : '0.000');
      setStockQuantity(String(productToEdit.stock_quantity ?? 0));
      setLowStockThreshold(String(productToEdit.low_stock_threshold ?? 5));
      setContainerTypeId(productToEdit.container_type_id || '');
      setSelectedFamilyId(productToEdit.family_id || '');
      setSkuActive(productToEdit.active !== 0);
      setPendingPacks([]);
      setPackError(null);

      // Fetch latest pack sizes from server
      fetch(`/api/products/${productToEdit.id}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.pack_sizes) setExistingPacks(data.pack_sizes);
          else setExistingPacks(productToEdit.pack_sizes || []);
        })
        .catch(() => setExistingPacks(productToEdit.pack_sizes || []));
    } else {
      setFamilyName('');
      setFamilyCategory('Detergents');
      setIsCustomCategory(false);
      setCustomCategoryInput('');
      setFamilyType('MANUFACTURED');
      setFormulationId('');
      setSkuName('');
      setSizeLabel('1L');
      setIsCustomSize(false);
      setCustomSizeInput('');
      setBarcode('');
      setRetailPrice('3.500');
      setWholesalePrice('2.800');
      setCostReference('0.000');
      setStockQuantity('0');
      setLowStockThreshold('5');
      setContainerTypeId('');
      setFamilyActive(true);
      setSkuActive(true);
      setExistingPacks([]);
      setPendingPacks([]);
      setPackError(null);
    }
  }, [familyToEdit, productToEdit, isOpen]);

  // Pack size actions
  const handleAddPack = async () => {
    if (!newPackLabel.trim()) {
      setPackError('Le libellé du pack est requis (ex: Pack de 6)');
      return;
    }
    const mult = parseInt(newPackMultiplier, 10);
    if (isNaN(mult) || mult < 2) {
      setPackError('Le multiplicateur doit être supérieur ou égal à 2');
      return;
    }
    const override = newPackPriceOverride.trim() ? parseFloat(newPackPriceOverride) : null;
    if (override !== null && (isNaN(override) || override <= 0)) {
      setPackError('Le prix spécifique doit être un montant strictement positif (vide = aucun)');
      return;
    }

    setPackError(null);

    if (productToEdit) {
      if (isAddingPackRef.current) return;
      isAddingPackRef.current = true;
      setIsAddingPack(true);
      try {
        const res = await fetch(`/api/products/${productToEdit.id}/pack-sizes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pack_label: newPackLabel.trim(),
            multiplier: mult,
            price_override: override,
            barcode: newPackBarcode.trim() || null
          })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Erreur lors de l\'ajout du pack');
        }
        const created = await res.json();
        setExistingPacks(prev => [...prev, created]);
        setNewPackLabel('');
        setNewPackMultiplier('6');
        setNewPackPriceOverride('');
        setNewPackBarcode('');
      } catch (err: any) {
        setPackError(err.message || 'Erreur lors de l\'ajout du pack');
      } finally {
        setIsAddingPack(false);
        isAddingPackRef.current = false;
      }
    } else {
      setPendingPacks(prev => [
        ...prev,
        {
          id: `pending-${Date.now()}-${Math.random()}`,
          pack_label: newPackLabel.trim(),
          multiplier: mult,
          price_override: override,
          barcode: newPackBarcode.trim() || null
        }
      ]);
      setNewPackLabel('');
      setNewPackMultiplier('6');
      setNewPackPriceOverride('');
      setNewPackBarcode('');
    }
  };

  const handleDeletePack = async (packId: string) => {
    setPackError(null);
    if (productToEdit) {
      try {
        const res = await fetch(`/api/products/pack-sizes/${packId}`, {
          method: 'DELETE'
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Erreur lors de la suppression');
        }
        setExistingPacks(prev => prev.filter(p => p.id !== packId));
      } catch (err: any) {
        setPackError(err.message || 'Erreur lors de la suppression du pack');
      }
    } else {
      setPendingPacks(prev => prev.filter(p => p.id !== packId));
    }
  };

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
            formulation_id: familyType === 'MANUFACTURED' && formulationId ? formulationId : null,
            active: familyActive ? 1 : 0
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
            container_type_id: containerTypeId || null,
            active: skuActive ? 1 : 0
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

      const createdProd = await prodRes.json();
      // Save pending packs one by one, tracking failures instead of dropping them.
      const failedPacks: { label: string; reason: string }[] = [];
      const savedPacks: PackSize[] = [];
      if (pendingPacks.length > 0) {
        for (const p of pendingPacks) {
          try {
            const packRes = await fetch(`/api/products/${createdProd.id}/pack-sizes`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pack_label: p.pack_label,
                multiplier: p.multiplier,
                price_override: p.price_override,
                barcode: p.barcode
              })
            });
            const data = await packRes.json().catch(() => ({}));
            if (!packRes.ok) {
              failedPacks.push({ label: p.pack_label, reason: data.error || `Erreur ${packRes.status}` });
            } else if (data?.id) {
              savedPacks.push(data);
            }
          } catch (err: any) {
            failedPacks.push({ label: p.pack_label, reason: err.message || 'Erreur réseau' });
          }
        }
      }

      if (failedPacks.length > 0) {
        // Keep the modal open in edit mode for the created product so the
        // user can fix and retry the failed packs.
        setExistingPacks(savedPacks);
        setPendingPacks([]);
        setPackError(
          `Packs non enregistrés : ${failedPacks.map(f => `« ${f.label} » (${f.reason})`).join('; ')}`
        );
        onSuccess();
        onSwitchToEdit?.(createdProd);
        return;
      }

      // Reset form
      setFamilyName('');
      setSkuName('');
      setBarcode('');
      setStockQuantity('0');
      setRetailPrice('3.500');
      setWholesalePrice('2.800');
      setCostReference('0.000');
      setPendingPacks([]);
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Category *
                    </label>
                    {!isCustomCategory ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomCategory(true);
                          setCustomCategoryInput('');
                        }}
                        className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold underline"
                      >
                        + Saisir autre
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomCategory(false);
                          setFamilyCategory(availableCategories[0] || 'Detergents');
                        }}
                        className="text-[11px] text-slate-500 hover:text-slate-700 font-semibold underline"
                      >
                        Choisir liste
                      </button>
                    )}
                  </div>
                  {!isCustomCategory ? (
                    <select
                      value={familyCategory}
                      onChange={e => {
                        if (e.target.value === '__NEW__') {
                          setIsCustomCategory(true);
                          setCustomCategoryInput('');
                        } else {
                          setFamilyCategory(e.target.value);
                        }
                      }}
                      className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white cursor-pointer"
                    >
                      {availableCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      <option value="__NEW__">+ Nouvelle catégorie...</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      placeholder="Nom de la nouvelle catégorie..."
                      value={customCategoryInput}
                      onChange={e => {
                        setCustomCategoryInput(e.target.value);
                        setFamilyCategory(e.target.value);
                      }}
                      className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                      autoFocus
                    />
                  )}
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

                {familyToEdit && (
                  <div className="col-span-2 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={familyActive}
                        onChange={e => setFamilyActive(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                      />
                      <span className="text-xs font-bold text-slate-700">Actif (Famille active)</span>
                    </label>
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
                {productToEdit && (
                  <div className="col-span-2 pb-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={skuActive}
                        onChange={e => setSkuActive(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                      />
                      <span className="text-xs font-bold text-slate-700">Actif (SKU actif pour la vente et le stock)</span>
                    </label>
                  </div>
                )}

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
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Unité / Taille (Size Label) *
                    </label>
                    {!isCustomSize ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomSize(true);
                          setCustomSizeInput('');
                        }}
                        className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold underline"
                      >
                        + Autre unité
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomSize(false);
                          setSizeLabel('1L');
                        }}
                        className="text-[11px] text-slate-500 hover:text-slate-700 font-semibold underline"
                      >
                        Choisir liste
                      </button>
                    )}
                  </div>
                  {!isCustomSize ? (
                    <select
                      value={sizeLabel}
                      onChange={e => {
                        if (e.target.value === '__CUSTOM__') {
                          setIsCustomSize(true);
                          setCustomSizeInput('');
                        } else {
                          setSizeLabel(e.target.value);
                        }
                      }}
                      className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white cursor-pointer"
                    >
                      <optgroup label="Volumes (Liquides)">
                        <option value="1L">1L</option>
                        <option value="5L">5L</option>
                        <option value="1.5L">1.5L</option>
                        <option value="2L">2L</option>
                        <option value="3L">3L</option>
                        <option value="4L">4L</option>
                        <option value="10L">10L</option>
                        <option value="20L">20L</option>
                        <option value="250ml">250ml</option>
                        <option value="500ml">500ml</option>
                        <option value="750ml">750ml</option>
                      </optgroup>
                      <optgroup label="Poids (Poudre / Solide)">
                        <option value="1kg">1kg</option>
                        <option value="2kg">2kg</option>
                        <option value="3kg">3kg</option>
                        <option value="5kg">5kg</option>
                        <option value="10kg">10kg</option>
                        <option value="25kg">25kg</option>
                        <option value="100g">100g</option>
                        <option value="250g">250g</option>
                        <option value="500g">500g</option>
                      </optgroup>
                      <optgroup label="Unités / Conditionnements">
                        <option value="Piece">Piece (Unité)</option>
                        <option value="Paquet">Paquet</option>
                        <option value="Carton">Carton</option>
                        <option value="Boîte">Boîte</option>
                        <option value="Rouleau">Rouleau</option>
                        <option value="Flacon">Flacon</option>
                        <option value="Bidon">Bidon</option>
                      </optgroup>
                      <option value="__CUSTOM__">+ Autre / Saisie personnalisée...</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      placeholder="ex: 1.25L, 330ml, Lot de 3..."
                      value={customSizeInput}
                      onChange={e => {
                        setCustomSizeInput(e.target.value);
                        setSizeLabel(e.target.value);
                      }}
                      className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                      autoFocus
                    />
                  )}
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

                <div className="col-span-2 p-3 bg-white rounded-xl border border-blue-200 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700">
                        Coût de référence / Cost Ref. (DT)
                      </label>
                      <span className="text-[10px] text-slate-400">Coût d'achat ou de revient unitaire (DT)</span>
                    </div>
                    <div className="w-full sm:w-40">
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={costReference}
                        onChange={e => setCostReference(e.target.value)}
                        placeholder="0.000"
                        className="w-full text-xs font-bold font-mono px-2.5 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-right"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                    {/* Wholesale */}
                    <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">Prix Gros / Wholesale (DT) *</span>
                        <button
                          type="button"
                          onClick={handleSuggestWholesale}
                          disabled={!canSuggestWholesale}
                          title={wholesaleHint}
                          className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors shadow-sm cursor-pointer disabled:cursor-not-allowed"
                        >
                          Suggérer
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                            Marge Gros (%)
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="1000"
                            value={wholesaleMarkup}
                            onChange={e => setWholesaleMarkup(e.target.value)}
                            placeholder="ex: 20"
                            className="w-full text-xs font-mono font-semibold px-2 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                            Prix Gros (DT) *
                          </label>
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            required
                            value={wholesalePrice}
                            onChange={e => setWholesalePrice(e.target.value)}
                            className="w-full text-xs font-bold font-mono px-2 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                          />
                        </div>
                      </div>
                      {!canSuggestWholesale && (
                        <p className="text-[10px] text-slate-400 italic">{wholesaleHint}</p>
                      )}
                    </div>

                    {/* Retail */}
                    <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">Prix Détail / Retail (DT) *</span>
                        <button
                          type="button"
                          onClick={handleSuggestRetail}
                          disabled={!canSuggestRetail}
                          title={retailHint}
                          className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors shadow-sm cursor-pointer disabled:cursor-not-allowed"
                        >
                          Suggérer
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                            Marge Détail (%)
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="1000"
                            value={retailMarkup}
                            onChange={e => setRetailMarkup(e.target.value)}
                            placeholder="ex: 30"
                            className="w-full text-xs font-mono font-semibold px-2 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                            Prix Détail (DT) *
                          </label>
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            required
                            value={retailPrice}
                            onChange={e => setRetailPrice(e.target.value)}
                            className="w-full text-xs font-bold font-mono px-2 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                          />
                        </div>
                      </div>
                      {!canSuggestRetail && (
                        <p className="text-[10px] text-slate-400 italic">{retailHint}</p>
                      )}
                    </div>
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

                {/* Packs & Multipliers Repeater */}
                <div className="col-span-2 pt-3 border-t border-slate-200">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">Conditionnements / Packs (Multiplicateurs)</h4>
                      <p className="text-[10px] text-slate-500">Packs de pièces partageant le stock de base (ex: Carton de 12 pcs)</p>
                    </div>
                  </div>

                  {packError && (
                    <div className="p-2 mb-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{packError}</span>
                    </div>
                  )}

                  {/* List of packs */}
                  {((productToEdit ? existingPacks : pendingPacks).length > 0) && (
                    <div className="mb-3 border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                            <th className="p-2">Libellé</th>
                            <th className="p-2 text-center">Multiplicateur</th>
                            <th className="p-2 text-right">Prix Pack</th>
                            <th className="p-2">Code-barres</th>
                            <th className="p-2 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(productToEdit ? existingPacks : pendingPacks).map((p: any) => {
                            const unitP = parseFloat(retailPrice) || 0;
                            const calcPrice = p.price_override !== null && p.price_override !== undefined
                              ? p.price_override
                              : unitP * p.multiplier;
                            return (
                              <tr key={p.id} className="hover:bg-slate-50/50">
                                <td className="p-2 font-bold text-slate-800">{p.pack_label}</td>
                                <td className="p-2 text-center font-mono">×{p.multiplier}</td>
                                <td className="p-2 text-right font-mono font-bold text-slate-900">
                                  {formatMoney(calcPrice)}
                                  {p.price_override !== null && p.price_override !== undefined ? (
                                    <span className="text-[10px] text-blue-600 block">(forfaitaire)</span>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 block">(auto)</span>
                                  )}
                                </td>
                                <td className="p-2 font-mono text-[11px] text-slate-500">{p.barcode || '—'}</td>
                                <td className="p-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePack(p.id)}
                                    className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                                    title="Supprimer ce pack"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Add pack row */}
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs items-end">
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Libellé Pack *</label>
                      <input
                        type="text"
                        placeholder="ex: Carton de 12"
                        value={newPackLabel}
                        onChange={e => setNewPackLabel(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Mult. (≥ 2) *</label>
                      <input
                        type="number"
                        min="2"
                        value={newPackMultiplier}
                        onChange={e => setNewPackMultiplier(e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-center outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Prix Spécifique (DT)</label>
                      <input
                        type="number"
                        step="0.001"
                        placeholder="Auto"
                        value={newPackPriceOverride}
                        onChange={e => setNewPackPriceOverride(e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-right outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={handleAddPack}
                        disabled={isAddingPack}
                        className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1 shadow-sm transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Ajouter</span>
                      </button>
                    </div>
                  </div>
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
