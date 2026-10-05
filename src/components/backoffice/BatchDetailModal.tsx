import React, { useState, useEffect } from 'react';
import { X, FlaskConical, Calendar, AlertCircle, RefreshCw } from 'lucide-react';
import { formatMoney, formatDate } from '../../utils/formatters.js';

interface ConsumedMaterial {
  id: string;
  material_id: string;
  material_name: string;
  material_category?: string | null;
  material_unit?: string | null;
  quantity_consumed: number;
  unit_cost: number;
  total_cost: number;
}

interface BatchDetail {
  id: string;
  batch_number: string;
  date: string;
  formulation_id: string;
  formulation_name: string;
  target_product_id: string;
  target_product_name: string;
  size_label?: string | null;
  units_produced: number;
  total_batch_cost: number;
  cost_per_unit: number;
  notes?: string | null;
  created_at: string;
  materials_consumed: ConsumedMaterial[];
}

interface BatchDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  batchId: string | null;
}

export const BatchDetailModal: React.FC<BatchDetailModalProps> = ({
  isOpen,
  onClose,
  batchId
}) => {
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && batchId) {
      loadBatchDetail();
    } else {
      setBatch(null);
      setError(null);
    }
  }, [isOpen, batchId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const loadBatchDetail = async () => {
    if (!batchId) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/production/batches/${batchId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors du chargement du lot');
      }
      setBatch(await res.json());
    } catch (err: any) {
      setError(err.message || 'Impossible de charger ce lot');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !batchId) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full flex flex-col border border-slate-200 max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/30 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black">Détail du Lot / Batch Details</h2>
                {batch && (
                  <span className="font-mono text-xs font-bold text-slate-300">
                    #{batch.batch_number}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {batch ? `${batch.formulation_name} → ${batch.target_product_name}${batch.size_label ? ` (${batch.size_label})` : ''}` : 'Chargement du lot...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadBatchDetail}
              disabled={isLoading}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title="Actualiser"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title="Fermer (Échap)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-800 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {isLoading ? (
            <div className="py-16 text-center">
              <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-500">Chargement des détails du lot...</p>
            </div>
          ) : !batch ? (
            <div className="py-16 text-center text-slate-400">
              <p className="text-sm font-semibold">Aucun détail disponible.</p>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Date</span>
                  <span className="text-xs font-semibold text-slate-800 mt-0.5 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {formatDate(batch.date)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Unités Produites</span>
                  <span className="text-sm font-black font-mono text-slate-900 mt-0.5 block">
                    {batch.units_produced}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Coût Total Lot</span>
                  <span className="text-sm font-black font-mono text-slate-900 mt-0.5 block">
                    {formatMoney(batch.total_batch_cost)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Coût / Unité</span>
                  <span className="text-sm font-black font-mono text-emerald-700 mt-0.5 block">
                    {formatMoney(batch.cost_per_unit)}
                  </span>
                </div>
              </div>

              {batch.notes && (
                <div className="text-xs text-slate-500 italic px-1">
                  Note: "{batch.notes}"
                </div>
              )}

              {/* Consumed Materials Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="px-4 py-2.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Matières & Emballages Consommés ({batch.materials_consumed?.length || 0})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[600px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="py-2.5 px-3">Matière</th>
                        <th className="py-2.5 px-3 text-right">Quantité</th>
                        <th className="py-2.5 px-3 text-right">Coût Unitaire (DT)</th>
                        <th className="py-2.5 px-3 text-right">Coût Total (DT)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {batch.materials_consumed?.map(item => (
                        <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            {item.material_name}
                            {item.material_category && (
                              <span className="text-[10px] text-slate-400 font-normal ml-1.5">
                                ({item.material_category})
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                            {item.quantity_consumed} {item.material_unit || ''}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-700">
                            {formatMoney(item.unit_cost)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                            {formatMoney(item.total_cost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-bold border-t border-slate-200 text-xs">
                      <tr>
                        <td colSpan={3} className="py-2.5 px-3 text-right text-slate-700">Coût total du lot :</td>
                        <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                          {formatMoney(batch.total_batch_cost)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>{batch?.materials_consumed?.length || 0} matière(s) consommée(s)</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 shadow-2xs transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
