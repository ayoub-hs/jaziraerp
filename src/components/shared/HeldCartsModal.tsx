import React, { useState, useEffect } from 'react';
import { 
  X, 
  Clock, 
  Trash2, 
  Play, 
  User, 
  AlertCircle, 
  CheckCircle, 
  ShoppingBag,
  PauseCircle
} from 'lucide-react';
import { heldCartsService, type HeldCart, type PriceDiscrepancy } from '../../services/heldCartsService.js';
import type { CartItem, Customer, Product } from '../../types/index.js';
import { formatMoney } from '../../utils/formatters.js';
import { calculateCartTotals } from '../../utils/cart.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';
import { useBackButton } from '../../utils/backButton.js';

interface HeldCartsModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  currentCartItems: CartItem[];
  currentCustomer: Customer | null;
  currentSaleDiscount: number;
  onResumeCart: (
    cart: HeldCart,
    discrepancies: PriceDiscrepancy[]
  ) => void;
  onHoldCurrentCart?: () => void;
}

export const HeldCartsModal: React.FC<HeldCartsModalProps> = ({
  isOpen,
  onClose,
  products,
  currentCartItems,
  currentCustomer,
  currentSaleDiscount,
  onResumeCart,
  onHoldCurrentCart
}) => {
  useModalScanPause(isOpen);

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [confirmResumeCart, setConfirmResumeCart] = useState<HeldCart | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadCarts();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleChanged = () => {
      loadCarts();
    };
    window.addEventListener('held-carts-changed', handleChanged);
    return () => window.removeEventListener('held-carts-changed', handleChanged);
  }, []);

  const loadCarts = () => {
    setHeldCarts(heldCartsService.getHeldCarts());
  };

  const handleResume = (cart: HeldCart) => {
    // If current cart already has items, prompt the cashier
    if (currentCartItems.length > 0) {
      setConfirmResumeCart(cart);
      return;
    }

    doResume(cart);
  };

  const doResume = (cart: HeldCart) => {
    const discrepancies = heldCartsService.checkPriceDiscrepancies(cart, products);
    heldCartsService.resumeCart(cart.id);
    onResumeCart(cart, discrepancies);
    setConfirmResumeCart(null);
    onClose();
  };

  const handleHoldCurrentAndResume = (targetCart: HeldCart) => {
    if (onHoldCurrentCart) {
      onHoldCurrentCart();
    } else {
      heldCartsService.holdCart(currentCartItems, currentCustomer, currentSaleDiscount);
    }
    doResume(targetCart);
  };

  const handleDelete = (id: string) => {
    heldCartsService.deleteCart(id);
    setDeleteConfirmId(null);
    loadCarts();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col border border-slate-200 max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PauseCircle className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold">Paniers en attente ({heldCarts.length})</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Overwrite Confirmation Alert */}
        {confirmResumeCart && (
          <div className="p-4 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs space-y-3 animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Panier actif non vide ({currentCartItems.length} article(s))</span>
                <p className="mt-0.5 text-amber-800">
                  Que souhaitez-vous faire avec votre panier actuel avant de reprendre « {confirmResumeCart.label} » ?
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleHoldCurrentAndResume(confirmResumeCart)}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-xs transition-colors"
              >
                Mettre l'actuel en attente & Reprendre
              </button>
              <button
                type="button"
                onClick={() => doResume(confirmResumeCart)}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg shadow-xs transition-colors"
              >
                Écraser l'actuel
              </button>
              <button
                type="button"
                onClick={() => setConfirmResumeCart(null)}
                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Cart List */}
        <div className="p-4 overflow-y-auto flex-1 divide-y divide-slate-100 space-y-3">
          {heldCarts.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <ShoppingBag className="w-10 h-10 mx-auto stroke-1 text-slate-300" />
              <p className="text-sm font-semibold">Aucun panier en attente</p>
              <p className="text-xs text-slate-400">
                Utilisez le bouton « Mettre en attente » pour suspendre une vente.
              </p>
            </div>
          ) : (
            heldCarts.map(cart => {
              const totals = calculateCartTotals(cart.items, cart.saleDiscount);
              const isConfirmingDelete = deleteConfirmId === cart.id;

              return (
                <div
                  key={cart.id}
                  className="pt-3 first:pt-0 pb-1 rounded-xl bg-slate-50/70 p-3.5 border border-slate-200 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{cart.label}</span>
                        {cart.customer && (
                          <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
                            {cart.customer.type}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>
                          {new Date(cart.created_at).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                        <span>•</span>
                        <span>{totals.itemCount} art. ({totals.totalPieces} pcs)</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-base font-black font-mono text-emerald-700 block">
                        {formatMoney(totals.totalTTC)}
                      </span>
                      {cart.saleDiscount > 0 && (
                        <span className="text-[10px] text-rose-600 font-semibold">
                          Remise: -{formatMoney(cart.saleDiscount)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Summary of Items */}
                  <div className="bg-white rounded-lg p-2 border border-slate-100 text-[11px] text-slate-600 space-y-1">
                    {cart.items.slice(0, 3).map(item => (
                      <div key={item.cart_item_id} className="flex justify-between">
                        <span className="truncate max-w-[260px] font-medium">
                          {item.name} {item.pack_multiplier > 1 ? `(x${item.pack_multiplier})` : ''}
                        </span>
                        <span className="font-mono text-slate-800 shrink-0">
                          {item.quantity} × {formatMoney(item.unit_price)}
                        </span>
                      </div>
                    ))}
                    {cart.items.length > 3 && (
                      <div className="text-[10px] text-slate-400 italic">
                        + {cart.items.length - 3} autre(s) article(s)...
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex justify-between items-center pt-1">
                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-rose-600 font-bold">Supprimer ?</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(cart.id)}
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-bold"
                        >
                          Oui
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[11px]"
                        >
                          Non
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(cart.id)}
                        className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors flex items-center gap-1 text-xs"
                        title="Supprimer ce panier en attente"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Supprimer</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleResume(cart)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-colors"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Reprendre ce panier</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
          <div className="text-[11px] text-slate-500">
            Max 10 paniers mis en attente
          </div>
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-xs transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
