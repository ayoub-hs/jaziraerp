import React, { useState } from 'react';
import { X, Plus, Tag } from 'lucide-react';
import type { CartItem } from '../../types/index.js';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddItem: (item: CartItem) => void;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({
  isOpen,
  onClose,
  onAddItem
}) => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrice = parseFloat(price);
    const parsedQty = parseFloat(quantity);

    if (!name.trim()) {
      setError('Item description is required');
      return;
    }
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      setError('Price must be greater than 0 DT');
      return;
    }
    if (isNaN(parsedQty) || parsedQty <= 0) {
      setError('Quantity must be greater than 0');
      return;
    }

    const newItem: CartItem = {
      cart_item_id: 'quick_' + Date.now(),
      name: name.trim(),
      unit_price: parsedPrice,
      quantity: parsedQty,
      pack_multiplier: 1,
      is_quick_add: true
    };

    onAddItem(newItem);
    setName('');
    setPrice('');
    setQuantity('1');
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold">Quick-Add Uncataloged Item</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Item Description / Name *
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Special Degreaser Sample 500ml"
              className="w-full text-sm font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Price (TTC in DT) *
              </label>
              <input
                type="number"
                step="0.001"
                min="0.001"
                required
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="5.000"
                className="w-full text-base font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Quantity *
              </label>
              <input
                type="number"
                step="1"
                min="1"
                required
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="1"
                className="w-full text-base font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-600 font-semibold bg-rose-50 border border-rose-200 p-2 rounded-lg">
              {error}
            </p>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm shadow transition-colors flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Add to Cart
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
