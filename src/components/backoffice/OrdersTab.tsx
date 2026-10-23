import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, 
  Plus, 
  Filter, 
  Clock, 
  CheckCircle2, 
  Package, 
  Truck, 
  CheckCheck, 
  XCircle, 
  Edit2, 
  Printer, 
  AlertCircle, 
  RefreshCw, 
  X, 
  ChevronRight,
  ArrowRight,
  Trash2,
  DollarSign
} from 'lucide-react';
import type { 
  ClientOrder, 
  ClientOrderStatus, 
  Product, 
  Customer, 
  DeliveryZone, 
  ContainerType 
} from '../../types/index.js';
import { formatMoney, formatDateTime } from '../../utils/formatters.js';
import { useRequestKey } from '../../hooks/useRequestKey.js';

interface OrdersTabProps {
  products: Product[];
  customers: Customer[];
  containerTypes: ContainerType[];
  onConvertOrder?: (order: ClientOrder) => void;
  onPrintPreparationSlip?: (order: ClientOrder) => void;
}

export const OrdersTab: React.FC<OrdersTabProps> = ({
  products,
  customers,
  containerTypes,
  onConvertOrder,
  onPrintPreparationSlip
}) => {
  const { keyFor, clear: clearRequestKey } = useRequestKey();
  const [orders, setOrders] = useState<ClientOrder[]>([]);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | ClientOrderStatus>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal: Create / Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ClientOrder | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Fields
  const [isGuest, setIsGuest] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [phone, setPhone] = useState('');
  const [deliveryZoneId, setDeliveryZoneId] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [paymentPreference, setPaymentPreference] = useState('CASH');
  const [notes, setNotes] = useState('');
  const [orderItems, setOrderItems] = useState<Array<{ product_id: string; quantity: number }>>([]);
  const [containersReq, setContainersReq] = useState<Array<{ container_type_id: string; quantity: number }>>([]);

  // Modal: Cancel
  const [cancellingOrder, setCancellingOrder] = useState<ClientOrder | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    loadOrders();
    loadZones();
  }, []);

  const loadOrders = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch('/api/orders');
      if (!res.ok) {
        throw new Error('Erreur lors du chargement des commandes');
      }
      const data: ClientOrder[] = await res.json();
      setOrders(data);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du chargement des commandes');
    } finally {
      setIsLoading(false);
    }
  };

  const loadZones = async () => {
    try {
      const res = await fetch('/api/delivery-zones?active_only=true');
      if (res.ok) {
        const data: DeliveryZone[] = await res.json();
        setZones(data);
      }
    } catch {
      // non-blocking
    }
  };

  // Pending count: NEW, CONFIRMED, PREPARING, OUT_FOR_DELIVERY
  const pendingCount = orders.filter(o => 
    o.status === 'NEW' || o.status === 'CONFIRMED' || o.status === 'PREPARING' || o.status === 'OUT_FOR_DELIVERY'
  ).length;

  const openNewOrderModal = () => {
    setEditingOrder(null);
    setIsGuest(false);
    setCustomerId(customers[0]?.id || '');
    setGuestName('');
    const firstCust = customers[0];
    setPhone(firstCust?.phone || '');
    setDeliveryAddress(firstCust?.address || '');
    setDeliveryZoneId(zones[0]?.id || '');
    setExpectedDeliveryDate('');
    setPaymentPreference('CASH');
    setNotes('');
    setOrderItems(products.length > 0 ? [{ product_id: products[0].id, quantity: 1 }] : []);
    setContainersReq([]);
    setIsModalOpen(true);
    setError(null);
  };

  const openEditModal = (order: ClientOrder) => {
    if (order.status !== 'NEW' && order.status !== 'CONFIRMED') return;
    setEditingOrder(order);
    setIsGuest(!order.customer_id);
    setCustomerId(order.customer_id || '');
    setGuestName(order.guest_name || '');
    setPhone(order.phone || '');
    setDeliveryAddress(order.delivery_address || '');
    setDeliveryZoneId(order.delivery_zone_id || '');
    setExpectedDeliveryDate(order.expected_delivery_date || '');
    setPaymentPreference(order.payment_preference || 'CASH');
    setNotes(order.notes || '');
    setOrderItems(order.items?.map(i => ({ product_id: i.product_id, quantity: i.ordered_quantity })) || []);
    
    let parsedContainers: any[] = [];
    if (order.containers_requested) {
      if (typeof order.containers_requested === 'string') {
        try { parsedContainers = JSON.parse(order.containers_requested); } catch {}
      } else if (Array.isArray(order.containers_requested)) {
        parsedContainers = order.containers_requested;
      }
    }
    setContainersReq(parsedContainers);

    setIsModalOpen(true);
    setError(null);
  };

  const handleCustomerChange = (cid: string) => {
    setCustomerId(cid);
    const cust = customers.find(c => c.id === cid);
    if (cust) {
      if (cust.phone) setPhone(cust.phone);
      if (cust.address) setDeliveryAddress(cust.address);
    }
  };

  const handleAddItem = () => {
    if (products.length === 0) return;
    setOrderItems(prev => [...prev, { product_id: products[0].id, quantity: 1 }]);
  };

  const handleRemoveItem = (idx: number) => {
    setOrderItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx: number, field: 'product_id' | 'quantity', val: any) => {
    setOrderItems(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: val };
      return copy;
    });
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (orderItems.length === 0) {
      setError('La commande doit contenir au moins un article.');
      return;
    }

    if (isGuest) {
      if (!guestName.trim()) {
        setError('Le nom du client de passage est obligatoire.');
        return;
      }
      if (!/^[2459]\d{7}$/.test(phone.trim())) {
        setError('Le numéro de téléphone doit comporter exactement 8 chiffres (commençant par 2, 4, 5 ou 9).');
        return;
      }
    } else {
      if (!customerId) {
        setError('Veuillez sélectionner un compte client.');
        return;
      }
    }

    if (!deliveryZoneId) {
      setError('Veuillez sélectionner une zone de livraison.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload: any = {
        delivery_zone_id: deliveryZoneId,
        delivery_address: deliveryAddress.trim() || undefined,
        expected_delivery_date: expectedDeliveryDate || undefined,
        payment_preference: paymentPreference,
        notes: notes.trim() || undefined,
        items: orderItems.map(i => ({ product_id: i.product_id, quantity: Number(i.quantity) })),
        containers_requested: containersReq.filter(c => c.quantity > 0)
      };

      if (isGuest) {
        payload.guest_name = guestName.trim();
        payload.phone = phone.trim();
      } else {
        payload.customer_id = customerId;
        payload.phone = phone.trim() || undefined;
      }

      if (editingOrder) {
        const res = await fetch(`/api/orders/${editingOrder.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Erreur lors de la modification de la commande');
        }
        setSuccessMsg(`Commande ${editingOrder.order_number} modifiée avec succès.`);
      } else {
        const clientRequestId = keyFor(JSON.stringify(payload));
        payload.client_request_id = clientRequestId;
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Erreur lors de la création de la commande');
        }
        clearRequestKey();
        setSuccessMsg('Nouvelle commande enregistrée avec succès.');
      }

      setIsModalOpen(false);
      await loadOrders();
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'enregistrement de la commande");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusTransition = async (orderId: string, nextStatus: ClientOrderStatus) => {
    try {
      setError(null);
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors de la mise à jour du statut');
      }
      await loadOrders();
    } catch (err: any) {
      setError(err.message || 'Transition de statut refusée');
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancellingOrder) return;
    const trimmed = cancellationReason.trim();
    if (!trimmed) {
      setError("Le motif d'annulation est obligatoire.");
      return;
    }

    setIsCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${cancellingOrder.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: trimmed })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur lors de l'annulation de la commande");
      }
      setCancellingOrder(null);
      setCancellationReason('');
      setSuccessMsg(`Commande ${cancellingOrder.order_number} annulée.`);
      await loadOrders();
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'annulation");
    } finally {
      setIsCancelling(false);
    }
  };

  const filteredOrders = orders.filter(o => {
    if (statusFilter === 'ALL') return true;
    return o.status === statusFilter;
  });

  const getStatusBadge = (status: ClientOrderStatus) => {
    switch (status) {
      case 'NEW':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">Nouveau</span>;
      case 'CONFIRMED':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">Confirmé</span>;
      case 'PREPARING':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800">En préparation</span>;
      case 'OUT_FOR_DELIVERY':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800">En livraison</span>;
      case 'DELIVERED':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">Livré</span>;
      case 'CANCELLED':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">Annulé</span>;
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-slate-900">Commandes Clients</h1>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                {pendingCount} en attente
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Prise de commande, préparation, livraison et conversion en vente comptoir/livraison.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadOrders}
            disabled={isLoading}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={openNewOrderModal}
            className="min-h-[44px] flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Nouvelle commande</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span className="font-semibold">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-rose-600 hover:text-rose-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span className="font-semibold">{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-emerald-600 hover:text-emerald-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-bold">
        {[
          { key: 'ALL', label: 'Toutes les commandes' },
          { key: 'NEW', label: 'Nouveau' },
          { key: 'CONFIRMED', label: 'Confirmé' },
          { key: 'PREPARING', label: 'En préparation' },
          { key: 'OUT_FOR_DELIVERY', label: 'En livraison' },
          { key: 'DELIVERED', label: 'Livré' },
          { key: 'CANCELLED', label: 'Annulé' }
        ].map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusFilter(tab.key as any)}
            className={`min-h-[44px] px-3.5 py-2 rounded-xl transition-colors whitespace-nowrap ${
              statusFilter === tab.key
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Orders List Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                <th className="py-3 px-4">N° Commande</th>
                <th className="py-3 px-4">Client / Contact</th>
                <th className="py-3 px-4">Zone & Adresse</th>
                <th className="py-3 px-4">Total TTC</th>
                <th className="py-3 px-4">Statut</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 font-medium">
                    {isLoading ? 'Chargement des commandes...' : 'Aucune commande trouvée.'}
                  </td>
                </tr>
              ) : (
                filteredOrders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-bold text-slate-900">{order.order_number}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {formatDateTime(order.created_at)}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">
                        {order.customer_name || order.guest_name || 'Client de passage'}
                      </div>
                      <div className="font-mono text-slate-500 text-[11px] mt-0.5">
                        {order.phone}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 max-w-xs">
                      <div className="font-bold text-slate-800">{order.delivery_zone_name || 'Zone'}</div>
                      <div className="text-slate-500 text-[11px] truncate mt-0.5" title={order.delivery_address}>
                        {order.delivery_address}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-bold text-slate-900 text-sm">
                        {formatMoney(order.total_ttc)} DT
                      </div>
                      <div className="text-[11px] text-slate-500">
                        dont {formatMoney(order.delivery_fee)} DT livraison
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      {getStatusBadge(order.status)}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {/* Fiche de préparation */}
                        {onPrintPreparationSlip && (
                          <button
                            type="button"
                            onClick={() => onPrintPreparationSlip(order)}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Fiche de préparation"
                            aria-label="Fiche de préparation"
                          >
                            <Printer className="w-4 h-4 mr-1" />
                            <span>Fiche</span>
                          </button>
                        )}

                        {/* Edit at NEW or CONFIRMED */}
                        {(order.status === 'NEW' || order.status === 'CONFIRMED') && (
                          <button
                            type="button"
                            onClick={() => openEditModal(order)}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Modifier la commande"
                            aria-label="Modifier"
                          >
                            <Edit2 className="w-4 h-4 mr-1" />
                            <span>Modifier</span>
                          </button>
                        )}

                        {/* State transitions following server state machine */}
                        {order.status === 'NEW' && (
                          <button
                            type="button"
                            onClick={() => handleStatusTransition(order.id, 'CONFIRMED')}
                            className="min-h-[44px] flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg font-bold transition-colors"
                            aria-label="Confirmer la commande"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Confirmer</span>
                          </button>
                        )}

                        {order.status === 'CONFIRMED' && (
                          <button
                            type="button"
                            onClick={() => handleStatusTransition(order.id, 'PREPARING')}
                            className="min-h-[44px] flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-bold transition-colors"
                            aria-label="Préparer la commande"
                          >
                            <Package className="w-3.5 h-3.5" />
                            <span>Préparer</span>
                          </button>
                        )}

                        {order.status === 'PREPARING' && (
                          <button
                            type="button"
                            onClick={() => handleStatusTransition(order.id, 'OUT_FOR_DELIVERY')}
                            className="min-h-[44px] flex items-center gap-1 px-3 py-1.5 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg font-bold transition-colors"
                            aria-label="Expédier la commande"
                          >
                            <Truck className="w-3.5 h-3.5" />
                            <span>Expédier</span>
                          </button>
                        )}

                        {/* Conversion to Sale */}
                        {(order.status === 'CONFIRMED' || order.status === 'PREPARING' || order.status === 'OUT_FOR_DELIVERY') && onConvertOrder && (
                          <button
                            type="button"
                            onClick={() => onConvertOrder(order)}
                            className="min-h-[44px] flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-sm transition-colors"
                            aria-label="Convertir en vente"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            <span>Convertir</span>
                          </button>
                        )}

                        {/* Cancel Button */}
                        {order.status !== 'DELIVERED' && order.status !== 'CANCELLED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setCancellingOrder(order);
                              setCancellationReason('');
                            }}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors font-bold"
                            title="Annuler la commande"
                            aria-label="Annuler la commande"
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            <span>Annuler</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <ShoppingBag className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    {editingOrder ? `Modifier Commande ${editingOrder.order_number}` : 'Nouvelle Commande Client'}
                  </h3>
                  <p className="text-pos-badge text-slate-600">
                    {editingOrder ? 'Modification des articles et de la livraison' : 'Prise de commande comptoir ou livraison'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Fermer"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitOrder} className="flex-1 min-h-0 flex flex-col">
              <div className="p-5 space-y-4 text-xs flex-1 min-h-0 overflow-y-auto">
                {/* Customer Picker / Guest Toggle */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
                      <input
                        type="radio"
                        name="customerMode"
                        checked={!isGuest}
                        onChange={() => setIsGuest(false)}
                        className="text-amber-600 focus:ring-amber-500"
                      />
                      <span>Client Répertoire</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
                      <input
                        type="radio"
                        name="customerMode"
                        checked={isGuest}
                        onChange={() => setIsGuest(true)}
                        className="text-amber-600 focus:ring-amber-500"
                      />
                      <span>Client de passage (Invité)</span>
                    </label>
                  </div>

                  {!isGuest ? (
                    <div>
                      <label htmlFor="order-customer-select" className="block font-bold text-slate-700 mb-1">
                        Sélectionner le Client *
                      </label>
                      <select
                        id="order-customer-select"
                        aria-label="Client"
                        value={customerId}
                        onChange={e => handleCustomerChange(e.target.value)}
                        className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none bg-white"
                      >
                        {customers.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} {c.phone ? `(${c.phone})` : ''} - {c.type}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="order-guest-name" className="block font-bold text-slate-700 mb-1">
                          Nom du client invité *
                        </label>
                        <input
                          id="order-guest-name"
                          type="text"
                          required
                          placeholder="ex. Ahmed Trabelsi"
                          value={guestName}
                          onChange={e => setGuestName(e.target.value)}
                          className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none bg-white"
                        />
                      </div>
                      <div>
                        <label htmlFor="order-phone" className="block font-bold text-slate-700 mb-1">
                          Téléphone (8 chiffres) *
                        </label>
                        <input
                          id="order-phone"
                          type="tel"
                          required
                          placeholder="ex. 98123456"
                          value={phone}
                          onChange={e => setPhone(e.target.value)}
                          className="w-full font-mono font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none bg-white"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Zone & Delivery Address */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="order-zone-select" className="block font-bold text-slate-700 mb-1">
                      Zone de Livraison *
                    </label>
                    <select
                      id="order-zone-select"
                      value={deliveryZoneId}
                      onChange={e => setDeliveryZoneId(e.target.value)}
                      className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none bg-white"
                    >
                      {zones.map(z => (
                        <option key={z.id} value={z.id}>
                          {z.name} (+{formatMoney(z.fee)} DT, min {formatMoney(z.min_order_amount)} DT)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="order-address" className="block font-bold text-slate-700 mb-1">
                      Adresse de Livraison *
                    </label>
                    <input
                      id="order-address"
                      type="text"
                      required
                      placeholder="ex. Route Houmt Souk km 2, Midoun"
                      value={deliveryAddress}
                      onChange={e => setDeliveryAddress(e.target.value)}
                      className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
                    />
                  </div>
                </div>

                {/* Date & Payment Preference */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="order-delivery-date" className="block font-bold text-slate-700 mb-1">
                      Date de Livraison Souhaitée
                    </label>
                    <input
                      id="order-delivery-date"
                      type="date"
                      value={expectedDeliveryDate}
                      onChange={e => setExpectedDeliveryDate(e.target.value)}
                      className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="order-payment-pref" className="block font-bold text-slate-700 mb-1">
                      Préférence de Paiement
                    </label>
                    <select
                      id="order-payment-pref"
                      value={paymentPreference}
                      onChange={e => setPaymentPreference(e.target.value)}
                      className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none bg-white"
                    >
                      <option value="CASH">Espèces</option>
                      <option value="CHECK">Chèque</option>
                      <option value="CARD">Carte Bancaire</option>
                      <option value="TRANSFER">Virement</option>
                      <option value="WALLET" disabled={isGuest}>Portefeuille Client {isGuest ? '(Invité non autorisé)' : ''}</option>
                      <option value="CREDIT" disabled={isGuest}>Vente à Crédit {isGuest ? '(Invité non autorisé)' : ''}</option>
                    </select>
                  </div>
                </div>

                {/* Items Section */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="block font-black text-slate-800 uppercase tracking-wider text-[11px]">
                      Articles de la Commande *
                    </label>
                    <button
                      type="button"
                      onClick={handleAddItem}
                      className="min-h-[44px] flex items-center gap-1.5 px-3 py-1.5 text-amber-700 hover:bg-amber-50 font-bold rounded-lg transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Ajouter un article</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {orderItems.map((item, idx) => {
                      const prod = products.find(p => p.id === item.product_id);
                      return (
                        <div key={idx} className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                          <select
                            value={item.product_id}
                            onChange={e => handleItemChange(idx, 'product_id', e.target.value)}
                            className="flex-1 font-semibold px-2 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                          >
                            {products.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} {p.size_label ? `(${p.size_label})` : ''} — {formatMoney(p.retail_price)} DT
                              </option>
                            ))}
                          </select>

                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="0.001"
                              step="any"
                              value={item.quantity}
                              onChange={e => handleItemChange(idx, 'quantity', e.target.value)}
                              className="w-20 font-bold font-mono px-2 py-2 border border-slate-300 rounded-lg text-xs bg-white text-center"
                            />
                            <span className="text-[11px] text-slate-500 font-semibold px-1">
                              {prod?.size_label === 'Piece' ? 'pcs' : 'L'}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors"
                            aria-label="Supprimer la ligne"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label htmlFor="order-notes" className="block font-bold text-slate-700 mb-1">
                    Notes & Instructions
                  </label>
                  <textarea
                    id="order-notes"
                    rows={2}
                    placeholder="Instructions particulières de livraison ou préparation..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="shrink-0 flex gap-2.5 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 min-h-[44px] py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 min-h-[44px] py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
                >
                  <span>
                    {isSubmitting 
                      ? 'Enregistrement...' 
                      : (editingOrder ? 'Enregistrer les modifications' : 'Créer la commande')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Order Modal */}
      {cancellingOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-4 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
                <XCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900">Annuler la Commande</h3>
                <p className="text-[11px] text-slate-500 font-mono">{cancellingOrder.order_number}</p>
              </div>
            </div>

            <div>
              <label htmlFor="cancel-reason" className="block font-bold text-slate-700 text-xs mb-1">
                Motif d'annulation *
              </label>
              <textarea
                id="cancel-reason"
                required
                rows={3}
                placeholder="Raison obligatoire (ex. client indisponible, erreur d'adresse, désistement)..."
                value={cancellationReason}
                onChange={e => setCancellationReason(e.target.value)}
                className="w-full text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none"
              />
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCancellingOrder(null)}
                className="flex-1 min-h-[44px] py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
              >
                Retour
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={isCancelling || !cancellationReason.trim()}
                className="flex-1 min-h-[44px] py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-sm transition-colors flex items-center justify-center"
              >
                <span>{isCancelling ? 'Annulation...' : "Confirmer l'annulation"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
