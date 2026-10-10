import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  X,
  Package,
  Barcode as BarcodeIcon,
  AlertTriangle,
  CheckCircle2,
  Tag,
  ArrowRight,
  Layers,
  Plus,
  HelpCircle,
  Building2,
  UserCheck
} from 'lucide-react';
import type { Product, ProductFamily, Customer, PackSize } from '../../types/index.js';
import { formatMoney, roundMoney } from '../../utils/formatters.js';
import { getProductPriceForCustomer, getProductPackPrice } from '../../utils/cart.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';

export interface QuickPriceLookupModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  families?: ProductFamily[];
  customer?: Customer | null;
  onAddToCart?: (
    product: Product,
    packMultiplier?: number,
    packLabel?: string,
    packSize?: PackSize | null
  ) => void;
}

export const QuickPriceLookupModal: React.FC<QuickPriceLookupModalProps> = ({
  isOpen,
  onClose,
  products,
  families = [],
  customer = null,
  onAddToCart
}) => {
  // Pause keyboard wedge scanner while lookup modal is open so scans don't add to cart behind it
  useModalScanPause(isOpen);

  // Hardware back button support
  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Esc key listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Auto-focus input on open and reset query
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Filter products by name, barcode, family, category, or pack barcodes
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return products.slice(0, 30);
    }

    return products
      .map(product => {
        const matchesMainBarcode = product.barcode?.toLowerCase() === q;
        const matchesPackBarcode = product.pack_sizes?.some(
          ps => ps.barcode?.toLowerCase() === q
        );
        const nameMatches = product.name.toLowerCase().includes(q);
        const sizeMatches = product.size_label?.toLowerCase().includes(q);
        const catMatches = product.category?.toLowerCase().includes(q);
        const barcodeIncludes = product.barcode?.toLowerCase().includes(q);
        const packBarcodeIncludes = product.pack_sizes?.some(
          ps => ps.barcode?.toLowerCase().includes(q) || ps.pack_label.toLowerCase().includes(q)
        );

        let score = 0;
        if (matchesMainBarcode || matchesPackBarcode) score = 100;
        else if (barcodeIncludes || packBarcodeIncludes) score = 50;
        else if (nameMatches) score = 30;
        else if (sizeMatches) score = 20;
        else if (catMatches) score = 10;

        return { product, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.product);
  }, [products, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Vérification Prix & Stock</h2>
                <span className="text-[11px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono border border-slate-700">
                  F3 / Ctrl+L / Esc
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Consultez instantanément les prix détaillés, remises et stocks sans modifier le panier en cours.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar & Customer Context Indicator */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3 shrink-0">
          <div className="relative">
            <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-3" />
            <input
              ref={inputRef}
              autoFocus
              data-scanner-input="true"
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Scanner un code-barres ou saisir le nom/référence du produit... [Esc pour fermer]"
              className="w-full pl-11 pr-10 py-2.5 text-sm font-medium border-2 border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 focus:outline-none transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  inputRef.current?.focus();
                }}
                className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 p-0.5 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Customer Context Alert if customer is loaded */}
          {customer && (
            <div className="flex items-center justify-between text-xs bg-indigo-50 border border-indigo-200 text-indigo-900 px-3.5 py-2 rounded-xl">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>
                  <strong>Client en cours :</strong> {customer.name}{' '}
                  <span className="font-semibold text-indigo-700">
                    ({customer.type === 'RESELLER' ? `Revendeur -${customer.reseller_discount_percent}%` : customer.type === 'WHOLESALE' ? 'Grossiste' : 'Détail'})
                  </span>
                </span>
              </div>
              <span className="text-[11px] font-medium text-indigo-600 hidden sm:inline">
                Les prix effectifs ci-dessous sont ajustés pour ce client
              </span>
            </div>
          )}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 divide-y divide-slate-100">
          {filteredProducts.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <Package className="w-12 h-12 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-600">Aucun produit trouvé</p>
              <p className="text-xs text-slate-400">
                Vérifiez le code-barres ou modifiez les termes de recherche.
              </p>
            </div>
          ) : (
            filteredProducts.map(product => {
              const effectivePrice = getProductPriceForCustomer(product, customer);
              const isRupture = product.stock_quantity <= 0;
              const isLowStock = !isRupture && product.stock_quantity <= product.low_stock_threshold;
              
              // Standard reseller tiers for quick quotation
              const wholesaleBase = Number(product.wholesale_price) || 0;
              const resellerMinus5 = roundMoney(wholesaleBase * 0.95);
              const resellerMinus10 = roundMoney(wholesaleBase * 0.90);
              const resellerMinus15 = roundMoney(wholesaleBase * 0.85);

              return (
                <div key={product.id} className="pt-4 first:pt-0 space-y-3">
                  {/* Product Header */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                          {product.category || 'Général'}
                        </span>
                        {product.size_label && (
                          <span className="text-[10px] font-extrabold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded">
                            {product.size_label}
                          </span>
                        )}
                        {product.barcode && (
                          <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                            <BarcodeIcon className="w-3 h-3 text-slate-400" />
                            {product.barcode}
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mt-1">
                        {product.name}
                      </h3>
                    </div>

                    {/* Stock Status Badge */}
                    <div className="flex items-center gap-2 self-start">
                      <div
                        className={`px-3 py-1.5 rounded-xl border flex items-center gap-1.5 text-xs font-bold ${
                          isRupture
                            ? 'bg-rose-50 border-rose-200 text-rose-700'
                            : isLowStock
                            ? 'bg-amber-50 border-amber-200 text-amber-800'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        }`}
                      >
                        {isRupture ? (
                          <>
                            <AlertTriangle className="w-4 h-4 text-rose-600" />
                            <span>Rupture de stock (0)</span>
                          </>
                        ) : isLowStock ? (
                          <>
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                            <span>Stock faible ({product.stock_quantity})</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span>En stock ({product.stock_quantity})</span>
                          </>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono hidden sm:inline" title="Stock magasin / dépôt">
                        (Dépôt : {product.stock_quantity})
                      </span>
                    </div>
                  </div>

                  {/* Price Cards Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {/* Retail Price */}
                    <div
                      className={`p-2.5 rounded-xl border transition-all ${
                        !customer || customer.type === 'RETAIL'
                          ? 'bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-200'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="text-[10px] font-bold text-slate-500 uppercase">
                        Prix Détail (TTC)
                      </div>
                      <div className="text-base font-black text-slate-900 font-mono mt-0.5">
                        {formatMoney(product.retail_price)}
                      </div>
                      {(!customer || customer.type === 'RETAIL') && (
                        <span className="text-[10px] font-semibold text-emerald-700 flex items-center gap-0.5 mt-0.5">
                          ✓ Tarif appliqué
                        </span>
                      )}
                    </div>

                    {/* Wholesale Price */}
                    <div
                      className={`p-2.5 rounded-xl border transition-all ${
                        customer?.type === 'WHOLESALE'
                          ? 'bg-blue-50/70 border-blue-300 ring-1 ring-blue-200'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="text-[10px] font-bold text-slate-500 uppercase">
                        Prix Gros (TTC)
                      </div>
                      <div className="text-base font-black text-slate-900 font-mono mt-0.5">
                        {formatMoney(product.wholesale_price)}
                      </div>
                      {customer?.type === 'WHOLESALE' && (
                        <span className="text-[10px] font-semibold text-blue-700 flex items-center gap-0.5 mt-0.5">
                          ✓ Tarif appliqué
                        </span>
                      )}
                    </div>

                    {/* Customer Reseller Price if customer is RESELLER */}
                    {customer?.type === 'RESELLER' ? (
                      <div className="col-span-2 p-2.5 rounded-xl border bg-purple-50/70 border-purple-300 ring-1 ring-purple-200">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold text-purple-700 uppercase">
                            Tarif Revendeur Client (-{customer.reseller_discount_percent}%)
                          </div>
                          <span className="text-[10px] font-bold text-purple-700">
                            ✓ Appliqué
                          </span>
                        </div>
                        <div className="text-base font-black text-purple-900 font-mono mt-0.5">
                          {formatMoney(effectivePrice)}
                        </div>
                        <div className="text-[10px] text-purple-600 mt-0.5">
                          Calculé sur base gros {formatMoney(product.wholesale_price)}
                        </div>
                      </div>
                    ) : (
                      /* Standard Reseller Tiers */
                      <div className="col-span-2 p-2.5 rounded-xl border bg-slate-50 border-slate-200">
                        <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">
                          Barème Revendeurs (Gros remise)
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 text-center">
                          <div className="bg-white p-1 rounded-lg border border-slate-200">
                            <span className="text-[10px] text-slate-500 block font-medium">-5%</span>
                            <span className="text-xs font-bold text-slate-800 font-mono">
                              {formatMoney(resellerMinus5)}
                            </span>
                          </div>
                          <div className="bg-white p-1 rounded-lg border border-slate-200">
                            <span className="text-[10px] text-slate-500 block font-medium">-10%</span>
                            <span className="text-xs font-bold text-slate-800 font-mono">
                              {formatMoney(resellerMinus10)}
                            </span>
                          </div>
                          <div className="bg-white p-1 rounded-lg border border-slate-200">
                            <span className="text-[10px] text-slate-500 block font-medium">-15%</span>
                            <span className="text-xs font-bold text-slate-800 font-mono">
                              {formatMoney(resellerMinus15)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Pack Sizes available */}
                  {product.pack_sizes && product.pack_sizes.length > 0 && (
                    <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200 space-y-2">
                      <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-slate-500" />
                        <span>Conditionnements & Packs disponibles :</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {product.pack_sizes.map(ps => {
                          const packPrice = getProductPackPrice(product, customer, ps, ps.multiplier);
                          return (
                            <div
                              key={ps.id}
                              className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between gap-2 shadow-sm"
                            >
                              <div>
                                <div className="font-bold text-xs text-slate-900">
                                  {ps.pack_label || `Pack ×${ps.multiplier}`}
                                </div>
                                <div className="text-[11px] font-mono text-emerald-700 font-bold">
                                  {formatMoney(packPrice)}
                                  {ps.price_override != null && (!customer || customer.type === 'RETAIL') && (
                                    <span className="ml-1 text-[9px] text-emerald-600 bg-emerald-50 px-1 rounded font-sans">
                                      promo
                                    </span>
                                  )}
                                </div>
                                {ps.barcode && (
                                  <div className="text-[9px] font-mono text-slate-400">
                                    {ps.barcode}
                                  </div>
                                )}
                              </div>
                              {onAddToCart && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onAddToCart(product, ps.multiplier, ps.pack_label, ps);
                                    onClose();
                                  }}
                                  className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors shrink-0"
                                >
                                  Ajouter {ps.pack_label}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Add Unit to Cart Action */}
                  {onAddToCart && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          onAddToCart(product, 1, undefined, null);
                          onClose();
                        }}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Ajouter au panier ({formatMoney(effectivePrice)})</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-1">
            <span>Appuyez sur <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-mono font-bold text-slate-700">Échap</kbd> pour revenir au panier</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
