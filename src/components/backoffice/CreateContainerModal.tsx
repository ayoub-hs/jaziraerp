import React, { useState, useEffect } from 'react';
import { X, Box, AlertCircle } from 'lucide-react';
import type { ContainerType } from '../../types/index.js';
import { useBackButton } from '../../utils/backButton.js';

interface CreateContainerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  containerTypeToEdit?: ContainerType | null;
}

export const CreateContainerModal: React.FC<CreateContainerModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  containerTypeToEdit
}) => {
  const [name, setName] = useState('');
  const [capacityLiters, setCapacityLiters] = useState('5');
  const [stockQuantity, setStockQuantity] = useState('0');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (containerTypeToEdit) {
        setName(containerTypeToEdit.name);
        setCapacityLiters(containerTypeToEdit.capacity_liters ? String(containerTypeToEdit.capacity_liters) : '');
        setStockQuantity(String(containerTypeToEdit.stock_quantity ?? 0));
      } else {
        setName('');
        setCapacityLiters('5');
        setStockQuantity('0');
      }
    }
  }, [isOpen, containerTypeToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const finalName = name.trim();
    if (!finalName) {
      setError('Le nom du type de contenant est requis');
      return;
    }

    setIsSubmitting(true);
    try {
      const url = containerTypeToEdit ? `/api/containers/types/${containerTypeToEdit.id}` : '/api/containers/types';
      const method = containerTypeToEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalName,
          capacity_liters: parseFloat(capacityLiters) || null,
          stock_quantity: parseInt(stockQuantity, 10) || 0
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Échec de ${containerTypeToEdit ? 'la mise à jour' : 'la création'} du contenant`);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'enregistrement du contenant");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center">
              <Box className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                {containerTypeToEdit ? 'Modifier le Type de Contenant' : 'Ajouter un Type de Contenant Consigné'}
              </h3>
              <p className="text-pos-badge text-slate-600">
                {containerTypeToEdit ? 'Mettre à jour les spécifications et le stock' : 'Enregistrer un bidon, casier ou fût consigné'}
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="p-5 space-y-3.5 text-xs flex-1 min-h-0 overflow-y-auto">
            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-1">Nom du Contenant *</label>
              <input
                type="text"
                required
                placeholder="ex. Bidon 5L Consigné, Fût 200L Plastique..."
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Capacité (Litres)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="5"
                  value={capacityLiters}
                  onChange={e => setCapacityLiters(e.target.value)}
                  className="w-full font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Stock Initial Magasin</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={stockQuantity}
                  onChange={e => setStockQuantity(e.target.value)}
                  className="w-full font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 flex gap-2.5 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
            >
              <Box className="w-4 h-4" />
              <span>{isSubmitting ? 'Enregistrement...' : (containerTypeToEdit ? 'Enregistrer' : 'Créer le contenant')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
