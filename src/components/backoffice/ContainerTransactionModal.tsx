import React, { useState, useEffect } from 'react';
import { X, ArrowUpRight, ArrowDownLeft, AlertCircle, Package } from 'lucide-react';
import type { Customer, ContainerType } from '../../types/index.js';

interface ContainerTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  customers: Customer[];
  containerTypes: ContainerType[];
  initialAction?: 'GIVE' | 'RETURN';
  initialCustomerId?: string | null;
  initialContainerTypeId?: string | null;
}

export const ContainerTransactionModal: React.FC<ContainerTransactionModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  customers,
  containerTypes,
  initialAction = 'GIVE',
  initialCustomerId = null,
  initialContainerTypeId = null
}) => {
  const [action, setAction] = useState<'GIVE' | 'RETURN'>(initialAction);
  const [customerId, setCustomerId] = useState<string>(initialCustomerId || '');
  const [containerTypeId, setContainerTypeId] = useState<string>(initialContainerTypeId || '');
  const [quantity, setQuantity] = useState<number>(1);
  const [notes, setNotes] = useState<string>('');
  const [correction, setCorrection] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state when opened with initial props
  useEffect(() => {
    if (isOpen) {
      setAction(initialAction);
      setCustomerId(initialCustomerId || (customers[0]?.id || ''));
      setContainerTypeId(initialContainerTypeId || (containerTypes[0]?.id || ''));
      setQuantity(1);
      setNotes('');
      setError(null);
    }
  }, [isOpen, initialAction, initialCustomerId, initialContainerTypeId, customers, containerTypes]);

  if (!isOpen) return null;

  const selectedContainer = containerTypes.find(c => c.id === containerTypeId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      setError('Veuillez sélectionner un client.');
      return;
    }
    if (!containerTypeId) {
      setError('Veuillez sélectionner un type de contenant.');
      return;
    }
    if (!quantity || quantity <= 0) {
      setError('La quantité doit être un entier supérieur à zéro.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/containers/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          container_type_id: containerTypeId,
          action,
          quantity: Math.floor(quantity),
          correction: action === 'RETURN' ? correction : undefined,
          notes: notes.trim() || undefined
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Échec de l’enregistrement de la transaction');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-bold text-base">Consignes — Prêt / Restitution</h3>
              <p className="text-[11px] text-slate-400">Enregistrer un mouvement de contenant consigné</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Choice: GIVE vs RETURN */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-tight">
              Type d’opération *
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAction('GIVE')}
                className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border transition-all ${
                  action === 'GIVE'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>Prêt (Sortie client)</span>
              </button>
              <button
                type="button"
                onClick={() => setAction('RETURN')}
                className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border transition-all ${
                  action === 'RETURN'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <ArrowDownLeft className="w-4 h-4" />
                <span>Retour (Entrée magasin)</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {action === 'GIVE'
                ? 'Diminue le stock magasin et augmente la dette consigne du client.'
                : 'Augmente le stock magasin et diminue la dette consigne du client.'}
            </p>
          </div>

          {/* Customer Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Client concerné *
            </label>
            <select
              required
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
              className="w-full text-xs font-medium px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
            >
              <option value="">Sélectionner un client...</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.type}{c.phone ? ` • ${c.phone}` : ''})
                </option>
              ))}
            </select>
          </div>

          {/* Container Type Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Type de contenant *
            </label>
            <select
              required
              value={containerTypeId}
              onChange={e => setContainerTypeId(e.target.value)}
              className="w-full text-xs font-medium px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
            >
              <option value="">Sélectionner un type de contenant...</option>
              {containerTypes.map(ct => (
                <option key={ct.id} value={ct.id}>
                  {ct.name} {ct.capacity_liters ? `(${ct.capacity_liters}L)` : ''} — Stock magasin: {ct.stock_quantity}
                </option>
              ))}
            </select>
            {selectedContainer && (
              <div className="flex justify-between items-center mt-1 text-[11px] text-slate-500">
                <span>Stock vide disponible: <strong className="text-slate-800">{selectedContainer.stock_quantity}</strong></span>
                <span>Total actuellement prêté: <strong className="text-amber-800">{selectedContainer.total_loaned_out || 0}</strong></span>
              </div>
            )}
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Nombre de contenants *
            </label>
            <input
              type="number"
              min="1"
              required
              value={quantity}
              onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
            />
          </div>

          {/* Notes / Memo */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Remarque / Note (Facultatif)
            </label>
            <input
              type="text"
              placeholder="ex. Rendu propre avec bouchon, Échange direct..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
            />
          </div>

          {action === 'RETURN' && (
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={correction}
                onChange={e => setCorrection(e.target.checked)}
                className="w-4 h-4 accent-emerald-600"
              />
              Correction (autoriser un retour supérieur au dû client)
            </label>
          )}

          {/* Actions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-5 py-2 font-bold rounded-xl text-xs text-white shadow transition-all ${
                action === 'GIVE'
                  ? 'bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300'
                  : 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300'
              }`}
            >
              {isSubmitting
                ? 'Enregistrement...'
                : action === 'GIVE'
                ? 'Valider le prêt'
                : 'Valider le retour'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
