import React, { useState, useEffect } from 'react';
import { X, RefreshCw, CheckCircle2, AlertTriangle, ArrowRight, Calculator, Scale, Layers } from 'lucide-react';
import { formatMoney } from '../../utils/formatters.js';
import { useBackButton } from '../../utils/backButton.js';

interface BatchCostBackfillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface BackfillCandidate {
  id: string;
  name: string;
  family_id: string;
  family_name: string;
  size_label?: string | null;
  size_volume?: number | null;
  suggested_size_volume?: number | null;
  stock_quantity: number;
  current_cost: number;
  current_valuation: number;
  // UI input state
  inputVolume: string;
  isSelected: boolean;
}

interface CostPreviewItem {
  id: string;
  name: string;
  family_id: string;
  family_name: string;
  size_label?: string | null;
  size_volume?: number | null;
  stock_quantity: number;
  current_cost: number;
  current_valuation: number;
  status: 'ok' | 'size_manquante' | 'error';
  calculated_cost: number | null;
  bulk_part: number | null;
  packaging_part: number | null;
  new_valuation: number;
  delta_valuation: number;
  warning?: string | null;
  // UI selection
  isSelected: boolean;
}

export const BatchCostBackfillModal: React.FC<BatchCostBackfillModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [activeTab, setActiveTab] = useState<'BACKFILL_SIZES' | 'BATCH_COSTS'>('BACKFILL_SIZES');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successReport, setSuccessReport] = useState<{
    message: string;
    updated_count: number;
    total_valuation?: number;
    valuation_unchanged?: boolean;
    old_valuation?: number;
    new_valuation?: number;
    delta_valuation?: number;
  } | null>(null);

  // Backfill state
  const [candidates, setCandidates] = useState<BackfillCandidate[]>([]);

  // Cost update state
  const [costItems, setCostItems] = useState<CostPreviewItem[]>([]);

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessReport(null);
      if (activeTab === 'BACKFILL_SIZES') {
        loadBackfillPreview();
      } else {
        loadCostPreview();
      }
    }
  }, [isOpen, activeTab]);

  const loadBackfillPreview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/products/backfill-size-preview', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors du chargement des tailles à rattraper');
      }
      const data = await res.json();
      const mapped: BackfillCandidate[] = (data.candidates || []).map((c: any) => ({
        ...c,
        inputVolume: c.suggested_size_volume !== null && c.suggested_size_volume !== undefined
          ? String(c.suggested_size_volume)
          : '',
        isSelected: c.suggested_size_volume !== null && c.suggested_size_volume !== undefined && c.suggested_size_volume > 0
      }));
      setCandidates(mapped);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCostPreview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/products/batch-cost-preview', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors du calcul prévisionnel des coûts');
      }
      const data = await res.json();
      const mapped: CostPreviewItem[] = (data.items || []).map((item: any) => ({
        ...item,
        isSelected: item.status === 'ok'
      }));
      setCostItems(mapped);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Backfill handlers
  const handleToggleCandidate = (id: string) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, isSelected: !c.isSelected } : c));
  };

  const handleVolumeChange = (id: string, val: string) => {
    setCandidates(prev => prev.map(c => {
      if (c.id === id) {
        const num = parseFloat(val);
        const hasValid = !isNaN(num) && num > 0;
        return { ...c, inputVolume: val, isSelected: hasValid ? c.isSelected : false };
      }
      return c;
    }));
  };

  const handleSelectAllCandidates = (selected: boolean) => {
    setCandidates(prev => prev.map(c => {
      const num = parseFloat(c.inputVolume);
      const hasValid = !isNaN(num) && num > 0;
      return { ...c, isSelected: selected && hasValid };
    }));
  };

  const handleConfirmBackfill = async () => {
    const selected = candidates.filter(c => c.isSelected);
    if (selected.length === 0) {
      setError('Veuillez sélectionner au moins un article avec une taille valide.');
      return;
    }

    const payload = {
      items: selected.map(c => ({
        id: c.id,
        size_volume: parseFloat(c.inputVolume)
      }))
    };

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/products/backfill-size-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la mise à jour des tailles');

      setSuccessReport({
        message: `${data.updated_count} article(s) mis à jour avec succès.`,
        updated_count: data.updated_count,
        total_valuation: data.total_valuation,
        valuation_unchanged: data.valuation_unchanged
      });
      onSuccess();
      loadBackfillPreview();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cost items handlers
  const handleToggleCostItem = (id: string) => {
    setCostItems(prev => prev.map(item => item.id === id ? { ...item, isSelected: !item.isSelected } : item));
  };

  const handleSelectAllCostItems = (selected: boolean) => {
    setCostItems(prev => prev.map(item => ({
      ...item,
      isSelected: selected && item.status === 'ok'
    })));
  };

  const handleConfirmBatchCosts = async () => {
    const selected = costItems.filter(i => i.isSelected && i.calculated_cost !== null);
    if (selected.length === 0) {
      setError('Veuillez sélectionner au moins un article dont le coût est calculé avec succès.');
      return;
    }

    const payload = {
      items: selected.map(i => ({
        id: i.id,
        new_cost: i.calculated_cost!
      }))
    };

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/products/batch-cost-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la confirmation des coûts');

      setSuccessReport({
        message: `${data.updated_count} coût(s) de référence mis à jour avec succès en une seule transaction.`,
        updated_count: data.updated_count,
        old_valuation: data.old_valuation,
        new_valuation: data.new_valuation,
        delta_valuation: data.delta_valuation
      });
      onSuccess();
      loadCostPreview();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // Selected totals for Cost update
  const selectedCostItems = costItems.filter(i => i.isSelected && i.calculated_cost !== null);
  const selectedOldValuation = selectedCostItems.reduce((acc, i) => acc + i.current_valuation, 0);
  const selectedNewValuation = selectedCostItems.reduce((acc, i) => acc + i.new_valuation, 0);
  const selectedDeltaValuation = Math.round((selectedNewValuation - selectedOldValuation + Number.EPSILON) * 1000) / 1000;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92dvh] flex flex-col overflow-hidden border border-slate-200">
        
        {/* Modal Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Calculator className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                Gestion des Tailles & Coûts de Fabrication
              </h3>
              <p className="text-pos-badge text-slate-600">
                Rattrapage des formats manquants et mise à jour collective des coûts de revient
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

        {/* Navigation Tabs */}
        <div className="shrink-0 flex border-b border-slate-200 px-5 pt-3 gap-3 bg-slate-50/40 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setActiveTab('BACKFILL_SIZES');
              setSuccessReport(null);
            }}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'BACKFILL_SIZES'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>1. Rattrapage Tailles Manquantes ({candidates.length})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('BATCH_COSTS');
              setSuccessReport(null);
            }}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'BATCH_COSTS'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>2. Mise à Jour Coûts de Revient ({costItems.length})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          
          {/* Error Banner */}
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Report Banner */}
          {successReport && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-2">
              <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>{successReport.message}</span>
              </div>
              {successReport.valuation_unchanged ? (
                <div className="pt-2 border-t border-emerald-200/80 font-mono text-xs flex items-center justify-between">
                  <span className="text-slate-600">Valorisation du stock :</span>
                  <span className="font-bold text-slate-800">
                    {formatMoney(successReport.total_valuation ?? 0)}
                    <span className="text-slate-500 font-sans ml-1.5 font-normal">(inchangée — aucun coût modifié)</span>
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-emerald-200/80 font-mono text-xs">
                  <div>
                    <span className="text-slate-600 block text-pos-badge">Ancienne valorisation :</span>
                    <span className="font-bold text-slate-800">{formatMoney(successReport.old_valuation ?? 0)}</span>
                  </div>
                  <div>
                    <span className="text-slate-600 block text-pos-badge">Nouvelle valorisation :</span>
                    <span className="font-bold text-slate-800">{formatMoney(successReport.new_valuation ?? 0)}</span>
                  </div>
                  <div>
                    <span className="text-slate-600 block text-pos-badge">Variation totale :</span>
                    <span className={`font-bold ${(successReport.delta_valuation ?? 0) >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {(successReport.delta_valuation ?? 0) >= 0 ? '+' : ''}{formatMoney(successReport.delta_valuation ?? 0)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 1: BACKFILL SIZES */}
          {activeTab === 'BACKFILL_SIZES' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  Rattrapage du volume unitaire (L ou kg)
                </p>
                <p className="text-pos-badge text-amber-800">
                  Les articles fabriqués doivent avoir une taille numérique positive pour permettre le calcul de formule vrac.
                  Cette action enregistre uniquement les tailles et ne modifie aucun coût existant.
                </p>
              </div>

              {isLoading ? (
                <div className="p-8 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                  Chargement des articles sans taille...
                </div>
              ) : candidates.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <p className="font-bold text-xs text-slate-800">Aucun article fabriqué sans taille !</p>
                  <p className="text-pos-badge text-slate-500">Tous vos articles fabriqués possèdent déjà un volume unitaire configuré.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectAllCandidates(true)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-pos-badge"
                      >
                        Tout sélectionner
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectAllCandidates(false)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-pos-badge"
                      >
                        Tout désélectionner
                      </button>
                    </div>
                    <span className="font-bold text-slate-600">
                      {candidates.filter(c => c.isSelected).length} sur {candidates.length} sélectionné(s)
                    </span>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase text-pos-caption font-bold">
                        <tr>
                          <th className="py-2.5 px-3 w-8"></th>
                          <th className="py-2.5 px-3">Article</th>
                          <th className="py-2.5 px-3">Famille</th>
                          <th className="py-2.5 px-3">Format Libellé</th>
                          <th className="py-2.5 px-3 text-right">Stock</th>
                          <th className="py-2.5 px-3 text-right">Coût Actuel</th>
                          <th className="py-2.5 px-3 w-40 text-right">Taille (L ou kg) *</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {candidates.map(c => {
                          const num = parseFloat(c.inputVolume);
                          const isValid = !isNaN(num) && num > 0;
                          return (
                            <tr key={c.id} className={c.isSelected ? 'bg-blue-50/30' : 'hover:bg-slate-50'}>
                              <td className="py-2.5 px-3">
                                <input
                                  type="checkbox"
                                  checked={c.isSelected}
                                  disabled={!isValid}
                                  onChange={() => handleToggleCandidate(c.id)}
                                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                                />
                              </td>
                              <td className="py-2.5 px-3 font-bold text-slate-900">{c.name}</td>
                              <td className="py-2.5 px-3 text-slate-600">{c.family_name}</td>
                              <td className="py-2.5 px-3">
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-pos-badge">
                                  {c.size_label || '—'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums">{c.stock_quantity}</td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatMoney(c.current_cost)}</td>
                              <td className="py-2.5 px-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <input
                                    type="number"
                                    step="0.001"
                                    min="0.001"
                                    placeholder="ex: 1.5"
                                    value={c.inputVolume}
                                    onChange={e => handleVolumeChange(c.id, e.target.value)}
                                    className={`w-24 text-right px-2 py-1 border rounded-lg font-mono text-xs outline-none ${
                                      isValid ? 'border-slate-300 focus:ring-2 focus:ring-blue-500' : 'border-amber-400 bg-amber-50/40'
                                    }`}
                                  />
                                  {c.suggested_size_volume !== null && c.suggested_size_volume !== undefined && (
                                    <span className="text-pos-badge text-emerald-700 font-bold" title="Taille déduite du libellé">
                                      ✓
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      disabled={isSubmitting || candidates.filter(c => c.isSelected).length === 0}
                      onClick={handleConfirmBackfill}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                      {isSubmitting ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      Enregistrer les tailles ({candidates.filter(c => c.isSelected).length})
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: BATCH COSTS */}
          {activeTab === 'BATCH_COSTS' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs text-blue-900 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <Calculator className="w-4 h-4 text-blue-700 shrink-0" />
                  Mise à jour collective du coût de revient
                </p>
                <p className="text-pos-badge text-blue-800">
                  Calcule le coût de chaque article fabriqué selon la formule de chimie au prorata de son volume + le coût de ses emballages spécifiques.
                  La validation met à jour les coûts en une seule transaction.
                </p>
              </div>

              {isLoading ? (
                <div className="p-8 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                  Calcul des coûts prévisionnels...
                </div>
              ) : costItems.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500">
                  Aucun article fabriqué trouvé.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectAllCostItems(true)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-pos-badge"
                      >
                        Tout sélectionner
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectAllCostItems(false)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-pos-badge"
                      >
                        Tout désélectionner
                      </button>
                    </div>
                    <span className="font-bold text-slate-600">
                      {selectedCostItems.length} sur {costItems.length} article(s) sélectionné(s)
                    </span>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto max-h-[50vh]">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 uppercase text-pos-caption font-bold z-10 shadow-xs">
                        <tr>
                          <th className="py-2.5 px-3 w-8"></th>
                          <th className="py-2.5 px-3">Article</th>
                          <th className="py-2.5 px-3">Taille</th>
                          <th className="py-2.5 px-3 text-right">Stock</th>
                          <th className="py-2.5 px-3 text-right">Coût Actuel</th>
                          <th className="py-2.5 px-3 text-right">Nouveau Coût</th>
                          <th className="py-2.5 px-3 text-right">Écart Unitaire</th>
                          <th className="py-2.5 px-3 text-right">Impact Stock</th>
                          <th className="py-2.5 px-3 text-center">Statut</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {costItems.map(item => {
                          const isOk = item.status === 'ok';
                          const unitDelta = item.calculated_cost !== null
                            ? Math.round((item.calculated_cost - item.current_cost + Number.EPSILON) * 1000) / 1000
                            : null;

                          return (
                            <tr key={item.id} className={item.isSelected ? 'bg-blue-50/20' : 'hover:bg-slate-50'}>
                              <td className="py-2.5 px-3">
                                <input
                                  type="checkbox"
                                  checked={item.isSelected}
                                  disabled={!isOk}
                                  onChange={() => handleToggleCostItem(item.id)}
                                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                                />
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-900">{item.name}</div>
                                <div className="text-pos-badge text-slate-500">{item.family_name}</div>
                              </td>
                              <td className="py-2.5 px-3 font-mono">
                                {item.size_volume !== null && item.size_volume !== undefined
                                  ? `${item.size_volume} L`
                                  : <span className="text-amber-800 font-bold">Manquante</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums">{item.stock_quantity}</td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatMoney(item.current_cost)}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-blue-900">
                                {item.calculated_cost !== null ? (
                                  <div>
                                    <span>{formatMoney(item.calculated_cost)}</span>
                                    <div className="text-[10px] text-slate-500 font-normal">
                                      {item.bulk_part?.toFixed(3)} + {item.packaging_part?.toFixed(3)}
                                    </div>
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                {unitDelta !== null ? (
                                  <span className={unitDelta >= 0 ? 'text-emerald-700' : 'text-amber-700'}>
                                    {unitDelta >= 0 ? '+' : ''}{formatMoney(unitDelta)}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                {item.calculated_cost !== null ? (
                                  <span className={item.delta_valuation >= 0 ? 'text-emerald-700' : 'text-amber-700'}>
                                    {item.delta_valuation >= 0 ? '+' : ''}{formatMoney(item.delta_valuation)}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                {item.status === 'ok' ? (
                                  <span className="px-2 py-0.5 rounded-full text-pos-badge font-bold bg-emerald-100 text-emerald-800">
                                    Prêt
                                  </span>
                                ) : item.status === 'size_manquante' ? (
                                  <button
                                    type="button"
                                    onClick={() => setActiveTab('BACKFILL_SIZES')}
                                    className="px-2 py-0.5 rounded-full text-pos-badge font-bold bg-amber-100 text-amber-900 hover:bg-amber-200 transition-colors"
                                  >
                                    ⚠️ Size manquante
                                  </button>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-pos-badge font-bold bg-rose-100 text-rose-800" title={item.warning || undefined}>
                                    ⚠️ Erreur
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary Bar */}
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
                    <div>
                      <span className="text-slate-500 block text-pos-badge">Valorisation Actuelle (sélection) :</span>
                      <span className="font-bold text-slate-800">{formatMoney(selectedOldValuation)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-pos-badge">Nouvelle Valorisation :</span>
                      <span className="font-bold text-slate-800">{formatMoney(selectedNewValuation)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-pos-badge">Impact Net sur le Stock :</span>
                      <span className={`font-black ${selectedDeltaValuation >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {selectedDeltaValuation >= 0 ? '+' : ''}{formatMoney(selectedDeltaValuation)}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      disabled={isSubmitting || selectedCostItems.length === 0}
                      onClick={handleConfirmBatchCosts}
                      className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                      {isSubmitting ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ArrowRight className="w-3.5 h-3.5" />
                      )}
                      Appliquer les nouveaux coûts ({selectedCostItems.length} articles)
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/70">
          <span className="text-pos-badge text-slate-500">
            Toutes les mises à jour sont exécutées de manière atomique en transaction SQLite.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-bold rounded-xl text-xs transition-colors"
          >
            Fermer
          </button>
        </div>

      </div>
    </div>
  );
};
