import React from 'react';
import { X, Layers, AlertTriangle } from 'lucide-react';
import type { Product, Customer, PackSize } from '../../types/index.js';
import { getProductPriceForCustomer, getProductPackPrice } from '../../utils/cart.js';
import { formatMoney } from '../../utils/formatters.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';

interface FamilySizesModalProps {
  isOpen: boolean;
  onClose: () => void;
  familyName: string;
  products: Product[];
  customer: Customer | null;
  onSelectProduct: (product: Product, packMultiplier?: number, packLabel?: string, packSize?: PackSize | null) => void;
}

export const FamilySizesModal: React.FC<FamilySizesModalProps> = ({
  isOpen,
  onClose,
  familyName,
  products,
  customer,
  onSelectProduct
}) => {
  useModalScanPause(isOpen);

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden border border-slate-200 flex flex-col">
        <div className="shrink-0 bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold">Select Size — {familyName}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 divide-y divide-slate-100 overflow-y-auto flex-1 min-h-0">
          {products.map(product => {
            const effectivePrice = getProductPriceForCustomer(product, customer);
            const isLowStock = product.stock_quantity <= product.low_stock_threshold;
            return (
              <div key={product.id} className="py-3 px-1 space-y-2">
                <div
                  onClick={() => {
                    onSelectProduct(product, 1, undefined, null);
                    onClose();
                  }}
                  className="p-2 flex items-center justify-between hover:bg-emerald-50 rounded-xl cursor-pointer transition-colors"
                >
                  <div>
                    <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                      <span>{product.size_label || product.name}</span>
                      <span className="text-pos-badge text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded font-medium">1 pc</span>
                      {isLowStock && (
                        <span className="text-pos-badge bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Stock: {product.stock_quantity}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">
                      {product.barcode || 'No barcode'}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-bold text-emerald-800 font-mono text-sm">
                      {formatMoney(effectivePrice)}
                    </div>
                    {customer && customer.type !== 'RETAIL' && (
                      <div className="text-pos-badge text-slate-500 line-through font-mono">
                        {formatMoney(product.retail_price)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Pack sizes for this SKU if configured */}
                {product.pack_sizes && product.pack_sizes.length > 0 && (
                  <div className="pl-4 pr-1 flex flex-wrap gap-1.5">
                    {product.pack_sizes.map(ps => {
                      const packPrice = getProductPackPrice(product, customer, ps, ps.multiplier);
                      return (
                        <button
                          key={ps.id}
                          type="button"
                          onClick={() => {
                            onSelectProduct(product, ps.multiplier, ps.pack_label, ps);
                            onClose();
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 rounded-lg font-medium transition-colors"
                          title={`Ajouter ${ps.pack_label || `pack x${ps.multiplier}`}`}
                        >
                          <span className="font-bold">{ps.pack_label || `x${ps.multiplier} pcs`}</span>
                          <span className="font-mono text-blue-800 font-bold">{formatMoney(packPrice)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="shrink-0 px-5 py-3 bg-slate-50/50 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
