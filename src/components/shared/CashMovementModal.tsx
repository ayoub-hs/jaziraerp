import React, { useState } from 'react';
import { X, ArrowDownRight, ArrowUpRight, AlertCircle, Check } from 'lucide-react';
import type { RegisterSession } from '../../types/index.js';
import { syncManager } from '../../services/syncManager.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';
import { useRequestKey } from '../../hooks/useRequestKey.js';

interface CashMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSession: RegisterSession | null;
  onSuccess: () => void;
}

export const CashMovementModal: React.FC<CashMovementModalProps> = ({
  isOpen,
  onClose,
  activeSession,
  onSuccess
}) => {
  useModalScanPause(isOpen);
  const { keyFor, clear: clearRequestKey } = useRequestKey();

  const [type, setType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_OUT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) {
      setError('Aucune session de caisse active trouvée');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Le montant doit être supérieur à 0 DT');
      return;
    }
    if (!reason.trim()) {
      setError('Le motif / justificatif est requis');
      return;
    }

    setSubmitting(true);
    setError(null);

    const movementBase = {
      session_id: activeSession.id,
      type,
      amount: parsedAmount,
      reason: reason.trim(),
      date: new Date().toISOString()
    };
    const clientRequestId = keyFor(JSON.stringify(movementBase));
    const movementPayload = {
      ...movementBase,
      client_request_id: clientRequestId
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      try {
        await syncManager.queueOfflineAction('CASH_MOVEMENT', movementPayload, clientRequestId);
        clearRequestKey();
        onSuccess();
        onClose();
        return;
      } catch (err: any) {
        setError(err.message || 'Erreur lors de la mise en attente hors ligne du mouvement de caisse');
        setSubmitting(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/register/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(movementPayload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Échec de l\'enregistrement du mouvement de caisse');
      }

      clearRequestKey();
      onSuccess();
      onClose();
    } catch (err: any) {
      if (err.name === 'TypeError' || err.message?.includes('fetch')) {
        try {
          await syncManager.queueOfflineAction('CASH_MOVEMENT', movementPayload, clientRequestId);
          clearRequestKey();
          onSuccess();
          onClose();
          return;
        } catch (queueErr: any) {
          setError(queueErr.message || 'Échec de la mise en attente hors ligne du mouvement de caisse');
          return;
        }
      }
      setError(err.message || 'Erreur lors de l\'enregistrement du mouvement de caisse');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="my-auto bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[calc(100dvh-1rem)] flex flex-col overflow-hidden border border-slate-200">
        <div className="shrink-0 bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <h2 className="text-base font-bold">Mouvement de Caisse (Entrée / Sortie)</h2>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="text-slate-300 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
            {/* Movement Type Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setType('CASH_OUT')}
                className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  type === 'CASH_OUT'
                    ? 'bg-white text-rose-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowUpRight className="w-4 h-4" />
                Décaissement (Dépense / Retrait)
              </button>
              <button
                type="button"
                onClick={() => setType('CASH_IN')}
                className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  type === 'CASH_IN'
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowDownRight className="w-4 h-4" />
                Encaissement (Ajout fond de caisse)
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Montant (DT) *
              </label>
              <input
                type="number"
                step="0.001"
                min="0.001"
                required
                autoFocus
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="10.000"
                className="w-full text-pos-input font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Motif / Justificatif de dépense *
              </label>
              <input
                type="text"
                required
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={type === 'CASH_OUT' ? 'ex. Café, fournitures, entretien...' : 'ex. Ajout de 50 DT en monnaie...'}
                className="w-full text-sm px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="shrink-0 p-3 sm:p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`flex-1 min-h-[44px] py-2.5 text-white font-bold rounded-xl text-sm shadow transition-colors ${
                type === 'CASH_OUT'
                  ? 'bg-rose-700 hover:bg-rose-800'
                  : 'bg-emerald-700 hover:bg-emerald-800'
              }`}
            >
              {submitting
                ? 'Enregistrement...'
                : type === 'CASH_OUT'
                ? 'Enregistrer Décaissement'
                : 'Enregistrer Encaissement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
