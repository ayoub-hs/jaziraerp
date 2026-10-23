import React from 'react';
import { X, Printer, PackageCheck, ClipboardList, CheckSquare } from 'lucide-react';
import type { ClientOrder, ClientOrderRequestedContainer } from '../../types/index.js';
import { formatDate, formatDateTime } from '../../utils/formatters.js';
import { getShopInfo } from '../../services/shopInfo.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';

interface PreparationSlipModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: ClientOrder | null;
}

export const PreparationSlipModal: React.FC<PreparationSlipModalProps> = ({
  isOpen,
  onClose,
  order
}) => {
  useModalScanPause(isOpen);
  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  if (!isOpen || !order) return null;

  const shop = getShopInfo();

  let containers: ClientOrderRequestedContainer[] = [];
  if (order.containers_requested) {
    if (typeof order.containers_requested === 'string') {
      try {
        containers = JSON.parse(order.containers_requested);
      } catch {}
    } else if (Array.isArray(order.containers_requested)) {
      containers = order.containers_requested;
    }
  }

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Controls (Hidden in Print) */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50 print:hidden">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">Fiche de Préparation</h3>
              <p className="text-[11px] font-mono text-slate-500">{order.order_number}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="min-h-[44px] flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
              aria-label="Imprimer la fiche"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimer la fiche</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Preparation Slip Area */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 bg-white print:p-0 print:overflow-visible">
          <div className="max-w-2xl mx-auto space-y-6 text-slate-900">
            {/* Header */}
            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
              <div>
                <h1 className="text-lg font-black uppercase tracking-wide text-slate-900">
                  {shop.shop_name || 'Société Al Jazira SHSP'}
                </h1>
                <p className="text-xs text-slate-600 font-medium">
                  {shop.shop_subtitle || 'Détergents & Produits d’Hygiène'}
                </p>
                {shop.shop_phone && (
                  <p className="text-xs text-slate-600 font-mono mt-0.5">Tél : {shop.shop_phone}</p>
                )}
              </div>
              <div className="text-right">
                <div className="inline-block bg-slate-900 text-white px-3 py-1 rounded text-xs font-black uppercase tracking-wider">
                  Fiche de Préparation
                </div>
                <div className="text-base font-black font-mono text-slate-900 mt-1">
                  {order.order_number}
                </div>
                <div className="text-xs text-slate-500">
                  Émis le : {formatDateTime(order.created_at)}
                </div>
              </div>
            </div>

            {/* Destination & Order Info Box */}
            <div className="grid grid-cols-2 gap-4 p-4 rounded-xl border border-slate-300 bg-slate-50/50 text-xs">
              <div className="space-y-1">
                <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Client / Destinataire :</span>
                <div className="font-black text-sm text-slate-900">
                  {order.customer_name || order.guest_name || 'Client de passage'}
                </div>
                <div className="font-mono font-semibold text-slate-700">
                  Tél : {order.phone}
                </div>
                <div className="text-slate-600 mt-1">
                  <span className="font-bold">Adresse : </span>{order.delivery_address}
                </div>
              </div>

              <div className="space-y-1 text-right">
                <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Détails Livraison :</span>
                <div>
                  <span className="font-bold text-slate-700">Zone : </span>
                  <span className="font-black text-slate-900">{order.delivery_zone_name || 'Zone standard'}</span>
                </div>
                {order.expected_delivery_date && (
                  <div>
                    <span className="font-bold text-slate-700">Date souhaitée : </span>
                    <span className="font-mono font-bold text-slate-900">{formatDate(order.expected_delivery_date)}</span>
                  </div>
                )}
                <div>
                  <span className="font-bold text-slate-700">Règlement prévu : </span>
                  <span className="font-bold text-slate-900">{order.payment_preference}</span>
                </div>
              </div>
            </div>

            {/* Items to Pick Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-black text-xs uppercase tracking-wider text-slate-800">
                  Articles à Préparer ({order.items?.length || 0})
                </h3>
                <span className="text-[11px] text-slate-500 italic">Cocher après mise en caisse/palette</span>
              </div>
              <table className="w-full text-xs border border-slate-300 border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-2 px-3 text-left w-12 text-center">N°</th>
                    <th className="py-2 px-3 text-left">Désignation du Produit</th>
                    <th className="py-2 px-3 text-center w-24">Format</th>
                    <th className="py-2 px-3 text-center w-24">Quantité</th>
                    <th className="py-2 px-3 text-center w-20">Contrôle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {order.items && order.items.length > 0 ? (
                    order.items.map((it, idx) => (
                      <tr key={it.id || idx} className="hover:bg-slate-50">
                        <td className="py-2 px-3 text-center font-mono text-slate-500">{idx + 1}</td>
                        <td className="py-2 px-3 font-bold text-slate-900">
                          {it.product_name || 'Produit'}
                        </td>
                        <td className="py-2 px-3 text-center text-slate-600 font-medium">
                          {it.size_label || '—'}
                        </td>
                        <td className="py-2 px-3 text-center font-mono font-black text-base text-slate-900">
                          {it.ordered_quantity}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <div className="w-5 h-5 mx-auto border-2 border-slate-400 rounded"></div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-slate-400 italic">
                        Aucun article dans cette commande
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Containers Requested */}
            {containers.length > 0 && (
              <div>
                <h3 className="font-black text-xs uppercase tracking-wider text-slate-800 mb-2">
                  Emballages / Consignes à Charger
                </h3>
                <table className="w-full text-xs border border-slate-300 border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                      <th className="py-2 px-3 text-left">Type de Consigne</th>
                      <th className="py-2 px-3 text-center w-24">Quantité</th>
                      <th className="py-2 px-3 text-center w-20">Contrôle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {containers.map((c, idx) => (
                      <tr key={idx}>
                        <td className="py-2 px-3 font-semibold text-slate-800">
                          {c.container_name || 'Consigne'}
                        </td>
                        <td className="py-2 px-3 text-center font-mono font-black text-base text-slate-900">
                          {c.quantity}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <div className="w-5 h-5 mx-auto border-2 border-slate-400 rounded"></div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Notes Section */}
            {order.notes && (
              <div className="p-3.5 rounded-xl border border-amber-300 bg-amber-50/60 text-xs">
                <span className="font-bold text-amber-900 uppercase tracking-wider text-[10px] block mb-0.5">
                  Instructions de Préparation & Livraison :
                </span>
                <p className="text-slate-800 font-medium whitespace-pre-wrap">{order.notes}</p>
              </div>
            )}

            {/* Signature & Validation Box */}
            <div className="grid grid-cols-2 gap-6 pt-4 border-t-2 border-slate-900">
              <div className="border border-slate-300 rounded-xl p-3 h-28 flex flex-col justify-between bg-slate-50/50">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider text-center">
                  Signature et visa préparation
                </span>
                <div className="border-t border-dashed border-slate-300 pt-1 text-[10px] text-slate-500 text-center">
                  Nom & Date du magasinier
                </div>
              </div>

              <div className="border border-slate-300 rounded-xl p-3 h-28 flex flex-col justify-between bg-slate-50/50">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider text-center">
                  Prise en charge livraison
                </span>
                <div className="border-t border-dashed border-slate-300 pt-1 text-[10px] text-slate-500 text-center">
                  Nom & Signature du chauffeur
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
