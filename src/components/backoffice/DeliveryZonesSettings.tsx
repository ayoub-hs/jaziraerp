import React, { useState, useEffect } from 'react';
import { Truck, Plus, Edit2, Trash2, CheckCircle2, AlertCircle, RefreshCw, X, Power } from 'lucide-react';
import type { DeliveryZone } from '../../types/index.js';
import { formatMoney } from '../../utils/formatters.js';

export const DeliveryZonesSettings: React.FC = () => {
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal / Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<DeliveryZone | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneFee, setZoneFee] = useState('0.000');
  const [zoneMinOrder, setZoneMinOrder] = useState('0.000');
  const [zoneActive, setZoneActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete confirmation
  const [zoneToDelete, setZoneToDelete] = useState<DeliveryZone | null>(null);

  useEffect(() => {
    loadZones();
  }, []);

  const loadZones = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch('/api/delivery-zones');
      if (!res.ok) {
        throw new Error('Erreur lors du chargement des zones de livraison');
      }
      const data: DeliveryZone[] = await res.json();
      setZones(data);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du chargement des zones');
    } finally {
      setIsLoading(false);
    }
  };

  const openAddForm = () => {
    setEditingZone(null);
    setZoneName('');
    setZoneFee('0.000');
    setZoneMinOrder('0.000');
    setZoneActive(true);
    setIsFormOpen(true);
    setError(null);
    setSuccessMsg(null);
  };

  const openEditForm = (zone: DeliveryZone) => {
    setEditingZone(zone);
    setZoneName(zone.name);
    setZoneFee(String(zone.fee));
    setZoneMinOrder(String(zone.min_order_amount));
    setZoneActive(Boolean(zone.active));
    setIsFormOpen(true);
    setError(null);
    setSuccessMsg(null);
  };

  const handleToggleActive = async (zone: DeliveryZone) => {
    try {
      setError(null);
      setSuccessMsg(null);
      const newStatus = zone.active ? 0 : 1;
      const res = await fetch(`/api/delivery-zones/${zone.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newStatus })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors de la mise à jour du statut');
      }
      setSuccessMsg(`Zone "${zone.name}" ${newStatus ? 'activée' : 'désactivée'}.`);
      await loadZones();
    } catch (err: any) {
      setError(err.message || 'Erreur lors du changement de statut');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = zoneName.trim();
    if (!trimmedName) {
      setError('Le nom de la zone est requis.');
      return;
    }

    const feeNum = parseFloat(zoneFee);
    if (isNaN(feeNum) || feeNum < 0) {
      setError('Les frais de livraison doivent être un montant positif ou nul.');
      return;
    }

    const minOrderNum = parseFloat(zoneMinOrder);
    if (isNaN(minOrderNum) || minOrderNum < 0) {
      setError('Le montant minimum doit être un montant positif ou nul.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const url = editingZone ? `/api/delivery-zones/${editingZone.id}` : '/api/delivery-zones';
      const method = editingZone ? 'PUT' : 'POST';
      const payload = {
        name: trimmedName,
        fee: feeNum,
        min_order_amount: minOrderNum,
        active: zoneActive ? 1 : 0
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur lors de l'enregistrement de la zone");
      }

      setIsFormOpen(false);
      setSuccessMsg(editingZone ? 'Zone de livraison mise à jour.' : 'Zone de livraison créée.');
      await loadZones();
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'enregistrement de la zone");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!zoneToDelete) return;
    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/delivery-zones/${zoneToDelete.id}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors de la suppression de la zone');
      }

      setSuccessMsg(`Zone "${zoneToDelete.name}" supprimée avec succès.`);
      setZoneToDelete(null);
      await loadZones();
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la suppression');
      setZoneToDelete(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900">Zones de Livraison</h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Frais de livraison et montants minimums par zone géographique.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadZones}
            disabled={isLoading}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={openAddForm}
            className="min-h-[44px] flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Ajouter une zone</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span className="font-semibold">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-rose-600 hover:text-rose-800"
            aria-label="Fermer l'erreur"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span className="font-semibold">{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-emerald-600 hover:text-emerald-800"
            aria-label="Fermer le message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Zones List */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
              <th className="py-3 px-4">Zone</th>
              <th className="py-3 px-4">Frais de livraison</th>
              <th className="py-3 px-4">Commande minimum</th>
              <th className="py-3 px-4">Statut</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {zones.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400 font-medium">
                  {isLoading ? 'Chargement des zones...' : 'Aucune zone de livraison configurée.'}
                </td>
              </tr>
            ) : (
              zones.map(z => (
                <tr key={z.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-3 px-4 font-bold text-slate-900">{z.name}</td>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-700">
                    {formatMoney(z.fee)} DT
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-700">
                    {formatMoney(z.min_order_amount)} DT
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        z.active
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {z.active ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-1.5 justify-end">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(z)}
                        className={`min-h-[44px] min-w-[44px] flex items-center justify-center p-2 rounded-lg text-xs font-bold transition-colors ${
                          z.active
                            ? 'text-amber-700 hover:bg-amber-50'
                            : 'text-emerald-700 hover:bg-emerald-50'
                        }`}
                        title={z.active ? 'Désactiver la zone' : 'Activer la zone'}
                        aria-label={z.active ? 'Désactiver' : 'Activer'}
                      >
                        <Power className="w-4 h-4 mr-1" />
                        <span>{z.active ? 'Désactiver' : 'Activer'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditForm(z)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Modifier"
                        aria-label="Modifier"
                      >
                        <Edit2 className="w-4 h-4 mr-1" />
                        <span>Modifier</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setZoneToDelete(z)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors"
                        title="Supprimer"
                        aria-label="Supprimer"
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        <span>Supprimer</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center">
                  <Truck className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-black text-slate-900">
                  {editingZone ? 'Modifier la Zone de Livraison' : 'Ajouter une Zone de Livraison'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                aria-label="Fermer"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
              <div>
                <label htmlFor="zone-name-input" className="block font-bold text-slate-700 mb-1">
                  Nom de la zone *
                </label>
                <input
                  id="zone-name-input"
                  type="text"
                  required
                  placeholder="ex. Zone Midoun, Houmt Souk..."
                  value={zoneName}
                  onChange={e => setZoneName(e.target.value)}
                  className="w-full font-semibold px-3 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="zone-fee-input" className="block font-bold text-slate-700 mb-1">
                    Frais de livraison (DT) *
                  </label>
                  <input
                    id="zone-fee-input"
                    type="number"
                    min="0"
                    step="0.001"
                    required
                    value={zoneFee}
                    onChange={e => setZoneFee(e.target.value)}
                    className="w-full font-mono font-bold px-3 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="zone-min-order-input" className="block font-bold text-slate-700 mb-1">
                    Montant minimum (DT)
                  </label>
                  <input
                    id="zone-min-order-input"
                    type="number"
                    min="0"
                    step="0.001"
                    value={zoneMinOrder}
                    onChange={e => setZoneMinOrder(e.target.value)}
                    className="w-full font-mono font-bold px-3 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="zone-active-input"
                  checked={zoneActive}
                  onChange={e => setZoneActive(e.target.checked)}
                  className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300"
                />
                <label htmlFor="zone-active-input" className="font-bold text-slate-700 select-none cursor-pointer">
                  Zone active pour les commandes
                </label>
              </div>

              <div className="flex gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="flex-1 min-h-[44px] py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 min-h-[44px] py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
                >
                  <span>{isSubmitting ? 'Enregistrement...' : 'Enregistrer'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {zoneToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-4 border border-slate-200">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-black text-slate-900">Supprimer la zone</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Êtes-vous sûr de vouloir supprimer définitivement la zone de livraison{' '}
              <strong className="text-slate-900">"{zoneToDelete.name}"</strong> ?
            </p>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setZoneToDelete(null)}
                className="flex-1 min-h-[44px] py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSubmitting}
                className="flex-1 min-h-[44px] py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-sm transition-colors flex items-center justify-center"
              >
                <span>{isSubmitting ? 'Suppression...' : 'Confirmer la suppression'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
