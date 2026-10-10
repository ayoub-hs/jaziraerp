import React, { useState, useEffect } from 'react';
import { X, Truck, AlertCircle } from 'lucide-react';
import type { Supplier } from '../../types/index.js';
import { useBackButton } from '../../utils/backButton.js';

interface CreateSupplierModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  supplierToEdit?: Supplier | null;
}

export const CreateSupplierModal: React.FC<CreateSupplierModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  supplierToEdit
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (supplierToEdit) {
        setName(supplierToEdit.name);
        setPhone(supplierToEdit.phone || '');
        setAddress(supplierToEdit.address || '');
      } else {
        setName('');
        setPhone('');
        setAddress('');
      }
    }
  }, [isOpen, supplierToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const finalName = name.trim();
    if (!finalName) {
      setError('Supplier name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const url = supplierToEdit ? `/api/suppliers/${supplierToEdit.id}` : '/api/suppliers';
      const method = supplierToEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalName,
          phone: phone.trim() || null,
          address: address.trim() || null
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${supplierToEdit ? 'update' : 'create'} supplier`);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error saving supplier');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Truck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                {supplierToEdit ? 'Edit Supplier' : 'Add Supplier'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {supplierToEdit ? 'Update vendor details and contact' : 'Register chemical distributor or packaging vendor'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-700 mb-1">Supplier Company Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Chimique Tunisie, PlastPack Sfax..."
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Phone Number</label>
            <input
              type="tel"
              placeholder="e.g. +216 74 200 100"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Address / Location</label>
            <input
              type="text"
              placeholder="e.g. Route de Gabès Km 3, Sfax"
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* Footer */}
          <div className="flex gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
            >
              <Truck className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving...' : (supplierToEdit ? 'Save Changes' : 'Create Supplier')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
