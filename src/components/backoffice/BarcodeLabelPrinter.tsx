import React, { useEffect, useRef, useState } from 'react';
import { X, Printer, Barcode as BarcodeIcon, Layers } from 'lucide-react';
import type { Product } from '../../types/index.js';
import { renderCode128Barcode } from '../../services/hardware/barcode.js';
import { formatMoney } from '../../utils/formatters.js';
import { getShopInfo } from '../../services/shopInfo.js';

interface BarcodeLabelPrinterProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  initialProduct?: Product | null;
}

export const BarcodeLabelPrinter: React.FC<BarcodeLabelPrinterProps> = ({
  isOpen,
  onClose,
  products,
  initialProduct
}) => {
  const shop = getShopInfo();
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [copies, setCopies] = useState<number>(12);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialProduct) {
        setSelectedProductId(initialProduct.id);
      } else if (products.length > 0) {
        setSelectedProductId(products[0].id);
      }
    }
  }, [isOpen, initialProduct, products]);

  const selectedProduct = products.find(p => p.id === selectedProductId) || null;

  // Render barcodes whenever selection or copies change
  useEffect(() => {
    if (!isOpen || !selectedProduct?.barcode || !containerRef.current) return;

    const svgElements = containerRef.current.querySelectorAll<SVGSVGElement>('svg.barcode-svg');
    svgElements.forEach(svg => {
      renderCode128Barcode(svg, selectedProduct.barcode!, {
        width: 1.5,
        height: 35,
        fontSize: 10,
        margin: 2
      });
    });
  }, [isOpen, selectedProduct, copies]);

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto print:p-0 print:bg-white print:static print:overflow-visible">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col border border-slate-200 print:border-none print:shadow-none print:w-full print:max-w-none print:max-h-none">
        {/* Modal Header */}
        <div className="shrink-0 bg-slate-900 text-white px-6 py-4 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <BarcodeIcon className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold">Imprimer les Étiquettes Code-barres Code-128</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Configuration Bar */}
        <div className="shrink-0 p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3 print:hidden">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Sélectionner l'article *
            </label>
            <select
              value={selectedProductId}
              onChange={e => setSelectedProductId(e.target.value)}
              className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.size_label || 'Pièce'}) — {p.barcode || 'Sans code-barres'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Nombre d'étiquettes à imprimer
            </label>
            <input
              type="number"
              min="1"
              max="200"
              value={copies}
              onChange={e => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full text-xs font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Printable Label Grid Preview */}
        <div className="p-6 overflow-y-auto flex-1 min-h-0 bg-slate-100 flex justify-center">
          {selectedProduct ? (
            <div
              ref={containerRef}
              className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-xl print:m-0 print:p-0"
            >
              {Array.from({ length: copies }).map((_, idx) => (
                <div
                  key={idx}
                  className="bg-white p-2.5 rounded-lg border border-slate-300 shadow-sm flex flex-col items-center justify-between text-center min-h-[110px] print:border-black print:shadow-none"
                >
                  <div className="w-full">
                    <span className="text-pos-badge font-bold text-slate-500 uppercase tracking-tight block">
                      {shop.shop_name || 'Al Jazira SHSP'}
                    </span>
                    <h4 className="text-pos-caption font-bold text-slate-900 truncate leading-tight mt-0.5">
                      {selectedProduct.name}
                    </h4>
                  </div>

                  {/* Code-128 Barcode Canvas/SVG */}
                  <div className="my-1 flex justify-center w-full overflow-hidden">
                    <svg className="barcode-svg max-w-full" />
                  </div>

                  <div className="w-full flex justify-between items-center text-pos-badge border-t border-slate-100 pt-1 font-mono">
                    <span className="bg-slate-100 px-1 rounded text-pos-badge font-bold text-slate-700">
                      {selectedProduct.size_label || 'Pièce'}
                    </span>
                    <span className="font-bold text-emerald-800">
                      {formatMoney(selectedProduct.retail_price)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-400">
              Sélectionnez un article ci-dessus pour générer les étiquettes.
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="shrink-0 p-4 bg-white border-t border-slate-200 flex justify-end gap-3 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="py-2.5 px-5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl text-xs shadow transition-colors flex items-center gap-2"
          >
            <Printer className="w-4 h-4" />
            Imprimer {copies} étiquettes
          </button>
        </div>
      </div>
    </div>
  );
};
