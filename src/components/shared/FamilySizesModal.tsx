import React from 'react';
import { X, Layers, AlertTriangle } from 'lucide-react';
import type { Product, Customer, PackSize } from '../../types/index.js';
import { getProductPriceForCustomer, getProductPackPrice } from '../../utils/cart.js';
import { formatMoney } from '../../utils/formatters.js';

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold">Select Size — {familyName}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 divide-y divide-slate-100 max-h-96 overflow-y-auto">
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
                      <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-medium">1 pc</span>
                      {isLowStock && (
                        <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-semibold flex items-center gap-1">
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
                    <div className="font-bold text-emerald-700 font-mono text-sm">
                      {formatMoney(effectivePrice)}
                    </div>
                    {customer && customer.type !== 'RETAIL' && (
                      <div className="text-[10px] text-slate-400 line-through font-mono">
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
                          <span className="font-mono text-blue-700 font-bold">{formatMoney(packPrice)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 text-right">
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-4 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
