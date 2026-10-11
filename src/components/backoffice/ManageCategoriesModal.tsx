import React, { useState, useEffect } from 'react';
import { X, Layers, Plus, Edit2, Check, Trash2, AlertCircle } from 'lucide-react';
import { useBackButton } from '../../utils/backButton.js';

interface CategoryItem {
  id: string;
  name: string;
  type: 'PRODUCT' | 'MATERIAL' | 'BOTH';
  product_count: number;
  material_count: number;
  total_count: number;
  created_at?: string;
}

interface ManageCategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ManageCategoriesModal: React.FC<ManageCategoriesModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Add new category
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'PRODUCT' | 'MATERIAL'>('PRODUCT');

  // Inline rename state
  const [editingCatName, setEditingCatName] = useState<string | null>(null);
  const [renamedValue, setRenamedValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  const loadCategories = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/categories');
      if (res.ok) {
        setCategories(await res.json());
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Échec du chargement des catégories');
      }
    } catch (err: any) {
      setError(err.message || 'Erreur réseau lors du chargement des catégories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessNotice(null);
      setEditingCatName(null);
      setNewCatName('');
      loadCategories();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newCatName.trim();
    if (!clean) return;
    setError(null);
    setSuccessNotice(null);

    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean, type: newCatType })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Échec de la création de la catégorie');
      }
      setNewCatName('');
      setSuccessNotice(`Catégorie « ${clean} » créée avec succès.`);
      await loadCategories();
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la création de la catégorie');
    }
  };

  const handleStartRename = (cat: CategoryItem) => {
    setEditingCatName(cat.name);
    setRenamedValue(cat.name);
    setError(null);
    setSuccessNotice(null);
  };

  const handleSaveRename = async (oldName: string) => {
    const cleanNew = renamedValue.trim();
    if (!cleanNew || cleanNew.toLowerCase() === oldName.toLowerCase()) {
      setEditingCatName(null);
      return;
    }

    setIsRenaming(true);
    setError(null);
    setSuccessNotice(null);

    try {
      const res = await fetch('/api/categories/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_name: oldName, new_name: cleanNew })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Échec du renommage de la catégorie');
      }

      const result = await res.json();
      setSuccessNotice(`Renommée de « ${oldName} » en « ${cleanNew} » (${result.updated_product_families} familles de produits, ${result.updated_materials} matières mises à jour).`);
      setEditingCatName(null);
      await loadCategories();
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Erreur lors du renommage de la catégorie');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDeleteCategory = async (cat: CategoryItem) => {
    if (cat.total_count > 0) {
      setError(`Impossible de supprimer « ${cat.name} » car elle est utilisée par ${cat.total_count} éléments. Veuillez renommer ou réassigner les éléments d'abord.`);
      return;
    }

    setError(null);
    setSuccessNotice(null);

    try {
      const res = await fetch(`/api/categories/${encodeURIComponent(cat.name)}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Échec de la suppression de la catégorie');
      }
      setSuccessNotice(`Catégorie « ${cat.name} » supprimée.`);
      await loadCategories();
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la suppression de la catégorie');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden border border-slate-200 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">Gestion Centrale des Catégories</h3>
              <p className="text-pos-badge text-slate-500">Gérer les catégories avec renommage en cascade sur les familles et matières</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successNotice && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{successNotice}</span>
            </div>
          )}

          {/* Add Category Form */}
          <form onSubmit={handleCreateCategory} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <label className="block text-pos-badge font-bold uppercase text-slate-700 tracking-wider">
              Ajouter une Nouvelle Catégorie
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                required
                placeholder="ex: Soin du linge, Désinfectants, Fragrances..."
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                className="flex-1 text-xs font-semibold px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-white"
              />
              <select
                value={newCatType}
                onChange={e => setNewCatType(e.target.value as any)}
                className="text-xs font-semibold px-2.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-white"
              >
                <option value="PRODUCT">Produits</option>
                <option value="MATERIAL">Matières</option>
              </select>
              <button
                type="submit"
                className="px-3.5 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-lg text-xs flex items-center gap-1 shadow-sm transition-colors shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Ajouter</span>
              </button>
            </div>
          </form>

          {/* Categories List */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 font-bold text-pos-caption text-slate-700 uppercase flex justify-between items-center">
              <span>Toutes les Catégories ({categories.length})</span>
              <span className="text-pos-badge text-slate-500 font-normal">Renommage en cascade automatique</span>
            </div>

            <div className="divide-y divide-slate-100">
              {loading ? (
                <div className="p-8 text-center text-slate-400 text-xs">Chargement des catégories...</div>
              ) : categories.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">Aucune catégorie trouvée.</div>
              ) : (
                categories.map(cat => (
                  <div key={cat.id || cat.name} className="p-3 hover:bg-slate-50 flex items-center justify-between gap-3 text-xs">
                    {editingCatName === cat.name ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="text"
                          value={renamedValue}
                          onChange={e => setRenamedValue(e.target.value)}
                          className="flex-1 text-xs font-bold px-2.5 py-1.5 border border-purple-400 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-white"
                          autoFocus
                        />
                        <button
                          type="button"
                          disabled={isRenaming}
                          onClick={() => handleSaveRename(cat.name)}
                          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold text-xs flex items-center gap-1 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{isRenaming ? 'Enregistrement...' : 'Appliquer'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCatName(null)}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-xs transition-colors"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <span className="font-bold text-slate-900 truncate">{cat.name}</span>
                          <span className={`px-2 py-0.5 rounded text-pos-badge font-bold shrink-0 ${
                            cat.type === 'PRODUCT'
                              ? 'bg-blue-100 text-blue-900'
                              : cat.type === 'MATERIAL'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-purple-100 text-purple-900'
                          }`}>
                            {cat.type === 'PRODUCT' ? 'PRODUIT' : cat.type === 'MATERIAL' ? 'MATIÈRE' : 'TOUT'}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-slate-600 text-pos-badge shrink-0">
                          <span>
                            {cat.product_count > 0 && `${cat.product_count} produit${cat.product_count > 1 ? 's' : ''}`}
                            {cat.product_count > 0 && cat.material_count > 0 && ' • '}
                            {cat.material_count > 0 && `${cat.material_count} matière${cat.material_count > 1 ? 's' : ''}`}
                            {cat.total_count === 0 && <span className="italic text-slate-500">Inutilisée</span>}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleStartRename(cat)}
                            className="p-1 hover:bg-purple-50 text-slate-400 hover:text-purple-600 rounded-lg transition-colors"
                            title="Renommer en cascade"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {cat.total_count === 0 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(cat)}
                              className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors"
                              title="Supprimer la catégorie inutilisée"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
