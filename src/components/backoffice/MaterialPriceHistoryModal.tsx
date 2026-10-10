import React, { useState, useEffect } from 'react';
import { X, History, TrendingUp, TrendingDown, Clock, Building2 } from 'lucide-react';
import type { RawMaterial } from '../../types/index.js';
import { formatMoney, formatDateTime } from '../../utils/formatters.js';
import { useBackButton } from '../../utils/backButton.js';

interface MaterialPriceHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  material: RawMaterial | null;
}

interface PriceHistoryEntry {
  id: string;
  material_id: string;
  supplier_id: string | null;
  cost_per_unit: number;
  date: string;
  purchase_id: string | null;
  supplier_name?: string;
}

export const MaterialPriceHistoryModal: React.FC<MaterialPriceHistoryModalProps> = ({
  isOpen,
  onClose,
  material
}) => {
  const [history, setHistory] = useState<PriceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  useEffect(() => {
    if (isOpen && material) {
      loadHistory();
    }
  }, [isOpen, material]);

  const loadHistory = async () => {
    if (!material) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/materials/${material.id}/history`);
      if (!res.ok) {
        throw new Error('Failed to load price history');
      }
      const data = await res.json();
      setHistory(data);
    } catch (err: any) {
      setError(err.message || 'Error loading history');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !material) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Price History</h3>
              <p className="text-xs text-slate-500 font-mono">
                {material.name} ({material.unit})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              Loading price history records...
            </div>
          ) : history.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              No historical price records found for this material.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                    <th className="p-3">Date</th>
                    <th className="p-3">Supplier</th>
                    <th className="p-3 text-right">Cost / Unit</th>
                    <th className="p-3 text-center">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((entry, idx) => {
                    const prev = idx < history.length - 1 ? history[idx + 1] : null;
                    const diff = prev ? entry.cost_per_unit - prev.cost_per_unit : 0;
                    return (
                      <tr key={entry.id || idx} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-medium text-slate-700 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          {formatDateTime(entry.date)}
                        </td>
                        <td className="p-3 text-slate-600">
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5 text-slate-400" />
                            {entry.supplier_name || 'Direct / Initial'}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-slate-900">
                          {formatMoney(entry.cost_per_unit)} DT
                        </td>
                        <td className="p-3 text-center">
                          {diff > 0.0001 ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                              <TrendingUp className="w-3 h-3" /> +{formatMoney(diff)}
                            </span>
                          ) : diff < -0.0001 ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                              <TrendingDown className="w-3 h-3" /> {formatMoney(diff)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-mono">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
