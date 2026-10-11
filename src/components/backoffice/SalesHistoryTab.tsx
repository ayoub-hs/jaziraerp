import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Printer, 
  FileText, 
  RotateCcw, 
  Eye, 
  X, 
  AlertCircle, 
  Calendar,
  Filter,
  RefreshCw,
  Plus,
  Truck
} from 'lucide-react';
import { formatMoney, formatDateTime } from '../../utils/formatters.js';
import { RefundModal } from '../shared/RefundModal.js';

interface SalesHistoryTabProps {
  onPrintReceipt: (saleId: string) => void;
  onPrintInvoice: (saleId: string) => void;
  onPrintDeliveryNote?: (saleId: string) => void;
}

export const SalesHistoryTab: React.FC<SalesHistoryTabProps> = ({
  onPrintReceipt,
  onPrintInvoice,
  onPrintDeliveryNote
}) => {
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState('ALL');
  
  // Pagination
  const [limit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const isFetchingRef = useRef(false);

  // Detail Modal
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [saleDetail, setSaleDetail] = useState<any | null>(null);
  const [saleRefunds, setSaleRefunds] = useState<any[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Refund Modal
  const [refundModalSaleId, setRefundModalSaleId] = useState<string | null>(null);

  const fetchSales = async (currentOffset = 0, append = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (fromDate) params.append('from_date', fromDate);
      if (toDate) params.append('to_date', toDate);
      if (status !== 'ALL') params.append('status', status);
      params.append('limit', String(limit));
      params.append('offset', String(currentOffset));

      const res = await fetch(`/api/sales?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load sales (${res.status})`);
      }
      const data: any[] = await res.json();
      if (append) {
        setSales(prev => [...prev, ...data]);
      } else {
        setSales(data);
      }
      setHasMore(data.length === limit);
      setOffset(currentOffset);
    } catch (err: any) {
      setError(err.message || 'Error loading sales');
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    fetchSales(0, false);
  }, [fromDate, toDate, status]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchSales(0, false);
  };

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      fetchSales(offset + limit, true);
    }
  };

  const handleOpenDetail = async (sale: any) => {
    setSelectedSaleId(sale.id);
    setLoadingDetail(true);
    setDetailError(null);
    setSaleDetail(null);
    setSaleRefunds([]);

    try {
      const [detailRes, refundsRes] = await Promise.all([
        fetch(`/api/sales/${sale.id}`),
        fetch(`/api/sales/${sale.id}/refunds`)
      ]);

      if (!detailRes.ok) throw new Error('Failed to load sale details');
      const detailData = await detailRes.json();
      setSaleDetail(detailData);

      if (refundsRes.ok) {
        setSaleRefunds(await refundsRes.json());
      }
    } catch (err: any) {
      setDetailError(err.message || 'Failed to load sale detail');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleRefundSuccess = () => {
    fetchSales(0, false);
    if (selectedSaleId) {
      handleOpenDetail({ id: selectedSaleId });
    }
  };

  return (
    <>
      <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">Historique des Ventes</h2>
          <p className="text-xs text-slate-500">Rechercher les reçus, réimprimer, imprimer facture A4 et traiter les remboursements</p>
        </div>
        <button
          type="button"
          onClick={() => fetchSales(0, false)}
          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualiser</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-2.5 items-stretch md:items-center text-xs">
        <form onSubmit={handleSearchSubmit} className="flex-1 flex gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Recherche par reçu (REC-...) ou nom client..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl"
          >
            Filtrer
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1">
            <Calendar className="w-3 h-3 text-slate-400" />
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="bg-transparent text-slate-700 text-xs focus:outline-none"
              title="Date de début"
            />
            <span className="text-slate-400">à</span>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="bg-transparent text-slate-700 text-xs focus:outline-none"
              title="Date de fin"
            />
          </div>

          <div className="flex items-center gap-1">
            <Filter className="w-3 h-3 text-slate-400" />
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-emerald-500 font-medium"
            >
              <option value="ALL">Tous les statuts</option>
              <option value="COMPLETED">Complétée</option>
              <option value="PARTIALLY_REFUNDED">Partiellement remboursée</option>
              <option value="FULLY_REFUNDED">Totalement remboursée</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Sales Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-280px)]">
        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className="w-full text-left border-collapse text-xs min-w-[760px]">
            <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
              <tr className="border-b border-slate-200 font-bold text-slate-700 uppercase text-pos-caption">
                <th className="py-2.5 px-3">N° Reçu</th>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Client</th>
                <th className="py-2.5 px-3">Caisse</th>
                <th className="py-2.5 px-3 text-right">Total TTC</th>
                <th className="py-2.5 px-3 text-right">Règlement (Esp/Port/Créd)</th>
                <th className="py-2.5 px-3 text-center">Statut</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sales.map(s => {
                const isPartRefund = s.status === 'PARTIALLY_REFUNDED';
                const isFullRefund = s.status === 'FULLY_REFUNDED';
                return (
                  <tr 
                    key={s.id} 
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    onClick={() => handleOpenDetail(s)}
                  >
                    <td className="py-2 px-3 font-mono font-bold text-slate-900 group-hover:text-emerald-700 text-pos-body">
                      {s.receipt_number}
                    </td>
                    <td className="py-2 px-3 text-slate-600 whitespace-nowrap text-pos-body">
                      {formatDateTime(s.date)}
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-900 text-pos-body">
                      {s.customer_name || <span className="text-slate-400 italic">Passager</span>}
                    </td>
                    <td className="py-2 px-3 text-slate-600 text-pos-body">
                      {s.counter_name || s.session_number || '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap text-pos-body tabular-nums">
                      {formatMoney(s.total_ttc)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-pos-badge text-slate-700 whitespace-nowrap tabular-nums">
                      <span>{formatMoney(s.cash_paid || 0)}</span>
                      <span className="text-slate-400 mx-1">/</span>
                      <span className="text-purple-800 font-bold">{formatMoney(s.wallet_paid || 0)}</span>
                      <span className="text-slate-400 mx-1">/</span>
                      <span className="text-amber-800 font-bold">{formatMoney(s.credit_amount || 0)}</span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-pos-badge font-bold ${
                        isFullRefund 
                          ? 'bg-rose-100 text-rose-800' 
                          : isPartRefund 
                            ? 'bg-amber-100 text-amber-800' 
                            : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {isFullRefund ? 'Remboursé' : isPartRefund ? 'Partiel' : 'Payé'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onPrintReceipt(s.id)}
                          title="Réimprimer ticket thermique"
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onPrintInvoice(s.id)}
                          title="Facture A4 professionnelle"
                          className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                        {onPrintDeliveryNote && (
                          <button
                            type="button"
                            onClick={() => onPrintDeliveryNote(s.id)}
                            title="Bon de Livraison (BL)"
                            className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                          >
                            <Truck className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setRefundModalSaleId(s.id)}
                          disabled={isFullRefund}
                          title={isFullRefund ? 'Vente déjà totalement remboursée' : 'Remboursement'}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isFullRefund
                              ? 'text-slate-300 cursor-not-allowed'
                              : 'text-slate-500 hover:text-rose-700 hover:bg-rose-50'
                          }`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(s)}
                          title="Détails de la vente"
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sales.length === 0 && !loading && (
          <div className="py-12 text-center text-slate-400 text-xs">
            Aucune vente trouvée avec ces filtres.
          </div>
        )}

        {/* Pager / Plus control */}
        {hasMore && (
          <div className="p-3 border-t border-slate-100 bg-slate-50 text-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loading}
              className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 text-xs rounded-xl shadow-sm inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Plus de ventes</span>
            </button>
          </div>
        )}
      </div>
      </div>

      {/* Sale Detail Modal */}
      {selectedSaleId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden">
            <div className="shrink-0 px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-700" />
                <h3 className="font-bold text-slate-900 text-sm">
                  Détail Vente : {saleDetail?.receipt_number || 'Chargement...'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSaleId(null)}
                aria-label="Fermer"
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1 min-h-0">
              {loadingDetail && (
                <div className="py-8 text-center text-slate-400">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-400" />
                  Chargement des lignes et remboursements...
                </div>
              )}

              {detailError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  <span>{detailError}</span>
                </div>
              )}

              {saleDetail && (
                <>
                  {/* Meta info grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <div>
                      <span className="text-pos-badge text-slate-600 block uppercase font-bold">Date</span>
                      <span className="font-medium text-slate-700 text-pos-body">{formatDateTime(saleDetail.date)}</span>
                    </div>
                    <div>
                      <span className="text-pos-badge text-slate-600 block uppercase font-bold">Client</span>
                      <span className="font-medium text-slate-700 text-pos-body">{saleDetail.customer_name || 'Passager'}</span>
                    </div>
                    <div>
                      <span className="text-pos-badge text-slate-600 block uppercase font-bold">Caisse</span>
                      <span className="font-medium text-slate-700 text-pos-body">{saleDetail.session_number || '—'}</span>
                    </div>
                    <div>
                      <span className="text-pos-badge text-slate-600 block uppercase font-bold">Statut</span>
                      <span className="font-bold text-slate-900 text-pos-body">{saleDetail.status}</span>
                    </div>
                  </div>

                  {/* Line Items Table */}
                  <div>
                    <h4 className="font-bold text-slate-700 mb-2">Articles ({saleDetail.items?.length || 0})</h4>
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-pos-caption uppercase font-bold text-slate-700">
                            <th className="py-2.5 px-3">Article</th>
                            <th className="py-2.5 px-3 text-center">Qté</th>
                            <th className="py-2.5 px-3 text-right">P.U.</th>
                            <th className="py-2.5 px-3 text-center">Remise</th>
                            <th className="py-2.5 px-3 text-right">Total</th>
                            <th className="py-2.5 px-3 text-center">Remboursé</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {saleDetail.items?.map((item: any) => (
                            <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-2 px-3 font-medium text-slate-900 text-pos-body">
                                {item.catalog_product_name || item.quick_add_name || item.name || 'Article'}
                              </td>
                              <td className="py-2 px-3 text-center font-mono text-pos-body">{item.quantity}</td>
                              <td className="py-2 px-3 text-right font-mono text-pos-body tabular-nums">{formatMoney(item.unit_price)}</td>
                              <td className="py-2 px-3 text-center font-mono text-pos-body">
                                {item.discount_percent ? `${item.discount_percent}%` : '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 text-pos-body tabular-nums">
                                {formatMoney(item.line_total)}
                              </td>
                              <td className="py-2 px-3 text-center font-mono text-pos-body">
                                {item.quantity_refunded > 0 ? (
                                  <span className="text-rose-700 font-bold">-{item.quantity_refunded}</span>
                                ) : '0'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Payment Breakdown */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                    <div className="flex justify-between font-medium">
                      <span className="text-slate-600">Sous-total HT:</span>
                      <span className="font-mono">{formatMoney(saleDetail.subtotal_ht || 0)}</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span className="text-slate-600">TVA (19%):</span>
                      <span className="font-mono">{formatMoney(saleDetail.tva_amount || 0)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900 text-sm pt-1 border-t border-slate-200">
                      <span>Total TTC:</span>
                      <span className="font-mono">{formatMoney(saleDetail.total_ttc)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-2 text-pos-badge border-t border-slate-200 text-slate-700">
                      <div>Espèces: <span className="font-bold text-slate-900">{formatMoney(saleDetail.cash_paid || 0)}</span></div>
                      <div>Portefeuille: <span className="font-bold text-purple-800">{formatMoney(saleDetail.wallet_paid || 0)}</span></div>
                      <div>Crédit: <span className="font-bold text-amber-800">{formatMoney(saleDetail.credit_amount || 0)}</span></div>
                    </div>
                  </div>

                  {/* Past Refunds on this sale */}
                  {saleRefunds.length > 0 && (
                    <div>
                      <h4 className="font-bold text-rose-800 mb-2">Historique des remboursements</h4>
                      <div className="space-y-2">
                        {saleRefunds.map(rf => (
                          <div key={rf.id} className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl">
                            <div className="flex justify-between font-bold text-rose-900">
                              <span>{rf.refund_number} ({formatDateTime(rf.date)})</span>
                              <span className="font-mono">-{formatMoney(rf.total_refunded)}</span>
                            </div>
                            <div className="text-pos-badge text-rose-800 mt-1">
                              Raison : {rf.reason || 'Retour article'} • Espèces: {formatMoney(rf.cash_refunded)} • Crédit réduit: {formatMoney(rf.credit_reduced)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="shrink-0 px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (saleDetail) onPrintReceipt(saleDetail.id);
                  }}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Imprimer Ticket</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (saleDetail) onPrintInvoice(saleDetail.id);
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Facture A4</span>
                </button>
                {onPrintDeliveryNote && (
                  <button
                    type="button"
                    onClick={() => {
                      if (saleDetail) onPrintDeliveryNote(saleDetail.id);
                    }}
                    className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm"
                  >
                    <Truck className="w-3.5 h-3.5" />
                    <span>Bon de Livraison</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {saleDetail && saleDetail.status !== 'FULLY_REFUNDED' && (
                  <button
                    type="button"
                    onClick={() => {
                      setRefundModalSaleId(saleDetail.id);
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Rembourser</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedSaleId(null)}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      <RefundModal
        isOpen={Boolean(refundModalSaleId)}
        onClose={() => setRefundModalSaleId(null)}
        onRefundCompleted={handleRefundSuccess}
        initialSaleId={refundModalSaleId}
      />
    </>
  );
};
