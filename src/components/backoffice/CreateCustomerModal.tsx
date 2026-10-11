import React, { useState, useEffect } from 'react';
import { X, Users, AlertCircle } from 'lucide-react';
import type { Customer } from '../../types/index.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';

interface CreateCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  customerToEdit?: Customer | null;
}

export const CreateCustomerModal: React.FC<CreateCustomerModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  customerToEdit
}) => {
  useModalScanPause(isOpen);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState<'RETAIL' | 'WHOLESALE' | 'RESELLER'>('RETAIL');
  const [resellerDiscountPercent, setResellerDiscountPercent] = useState('0');
  const [walletBalance, setWalletBalance] = useState('0.000');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (customerToEdit) {
        setName(customerToEdit.name);
        setPhone(customerToEdit.phone || '');
        setAddress(customerToEdit.address || '');
        setType(customerToEdit.type || 'RETAIL');
        setResellerDiscountPercent(String(customerToEdit.reseller_discount_percent || 0));
        setWalletBalance(String(customerToEdit.wallet_balance || '0.000'));
      } else {
        setName('');
        setPhone('');
        setAddress('');
        setType('RETAIL');
        setResellerDiscountPercent('0');
        setWalletBalance('0.000');
      }
    }
  }, [isOpen, customerToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const finalName = name.trim();
    if (!finalName) {
      setError('Le nom du client est requis');
      return;
    }

    setIsSubmitting(true);
    try {
      const url = customerToEdit ? `/api/customers/${customerToEdit.id}` : '/api/customers';
      const method = customerToEdit ? 'PUT' : 'POST';

      const payload = customerToEdit
        ? {
            name: finalName,
            phone: phone.trim() || null,
            address: address.trim() || null,
            type,
            reseller_discount_percent: type === 'RESELLER' ? parseFloat(resellerDiscountPercent) || 0 : 0
          }
        : {
            name: finalName,
            phone: phone.trim() || null,
            address: address.trim() || null,
            type,
            reseller_discount_percent: type === 'RESELLER' ? parseFloat(resellerDiscountPercent) || 0 : 0,
            wallet_balance: parseFloat(walletBalance) || 0
          };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Échec de ${customerToEdit ? 'la mise à jour' : 'la création'} du client`);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'enregistrement du client");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                {customerToEdit ? 'Modifier la Fiche Client' : 'Ajouter un Client'}
              </h3>
              <p className="text-pos-badge text-slate-600">
                {customerToEdit ? 'Mettre à jour les informations et la grille tarifaire' : 'Créer un profil client détail, gros ou revendeur'}
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
            <label className="block font-bold text-slate-700 mb-1">Nom Complet du Client *</label>
            <input
              type="text"
              required
              placeholder="ex. Société Al Baraka, Ahmed Trabelsi..."
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Numéro de Téléphone</label>
              <input
                type="tel"
                placeholder="ex. +216 98 123 456"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Tarification *</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as any)}
                className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
              >
                <option value="RETAIL">Détail (Prix standard)</option>
                <option value="WHOLESALE">Gros (Prix grossiste)</option>
                <option value="RESELLER">Revendeur (Remise %)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Adresse de Livraison</label>
            <input
              type="text"
              placeholder="ex. Zone Industrielle Poudrière 2, Sfax"
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>

          <div className={!customerToEdit ? "grid grid-cols-2 gap-3" : ""}>
            {type === 'RESELLER' ? (
              <div>
                <label className="block font-bold text-slate-700 mb-1">Remise Revendeur %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={resellerDiscountPercent}
                  onChange={e => setResellerDiscountPercent(e.target.value)}
                  className="w-full font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>
            ) : (
              <div>
                <label className="block font-bold text-slate-400 mb-1">Remise Revendeur %</label>
                <input
                  type="text"
                  disabled
                  value={type === 'WHOLESALE' ? 'N/A (Prix de gros appliqué)' : 'N/A (Prix détail)'}
                  className="w-full font-semibold text-slate-400 px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 cursor-not-allowed"
                />
              </div>
            )}

            {!customerToEdit && (
              <div>
                <label className="block font-bold text-slate-700 mb-1">Solde Initial Acompte (DT)</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={walletBalance}
                  onChange={e => setWalletBalance(e.target.value)}
                  className="w-full font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>
            )}
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
              className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
            >
              <Users className="w-4 h-4" />
              <span>{isSubmitting ? 'Enregistrement...' : (customerToEdit ? 'Enregistrer' : 'Créer le client')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
