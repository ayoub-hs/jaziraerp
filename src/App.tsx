import React, { useState, useEffect, useRef } from 'react';
import type { 
  Product, 
  ProductFamily, 
  Customer, 
  ContainerType, 
  RegisterSession 
} from './types/index.js';
import { syncManager, type SyncState } from './services/syncManager.js';
import { clientDb } from './db/clientDb.js';
import { Header } from './components/shared/Header.js';
import { DesktopPos } from './components/desktop/DesktopPos.js';
import { MobileRegister } from './components/mobile/MobileRegister.js';
import { Backoffice } from './components/backoffice/Backoffice.js';
import { SessionModal } from './components/shared/SessionModal.js';
import { CashMovementModal } from './components/shared/CashMovementModal.js';
import { ReceiptPrintModal } from './components/shared/ReceiptPrintModal.js';
import { InvoicePrintModal } from './components/shared/InvoicePrintModal.js';
import { LockScreenModal } from './components/shared/LockScreenModal.js';
import { webUsbPrinter } from './services/hardware/webusb.js';
import { webBluetoothPrinter } from './services/hardware/webbluetooth.js';
import { webSerialDrawer } from './services/hardware/webserial.js';
import { authService } from './services/authService.js';
import { fetchShopInfo } from './services/shopInfo.js';

export default function App() {
  const [currentView, setCurrentView] = useState<'DESKTOP_POS' | 'MOBILE_REGISTER' | 'BACKOFFICE'>('DESKTOP_POS');
  const [activeSession, setActiveSession] = useState<RegisterSession | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('ONLINE_SYNCED');
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [reviewSyncCount, setReviewSyncCount] = useState<number>(0);

  // Core Data
  const [products, setProducts] = useState<Product[]>([]);
  const [families, setFamilies] = useState<ProductFamily[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [containerTypes, setContainerTypes] = useState<ContainerType[]>([]);
  const [openSessions, setOpenSessions] = useState<RegisterSession[]>([]);

  // Modals
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [sessionModalMode, setSessionModalMode] = useState<'OPEN' | 'CLOSE'>('OPEN');
  const [isCashMovementOpen, setIsCashMovementOpen] = useState(false);
  const [printReceiptSaleId, setPrintReceiptSaleId] = useState<string | null>(null);
  const [printInvoiceSaleId, setPrintInvoiceSaleId] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState<boolean>(authService.isLocked());
  const prevSyncStateRef = useRef<SyncState>('ONLINE_SYNCED');

  // Subscribe to sync manager events & auth status
  useEffect(() => {
    const unsubscribe = syncManager.subscribe((state, count, reviewCount) => {
      setSyncState(state);
      setPendingSyncCount(count);
      setReviewSyncCount(reviewCount);
      if (state === 'ONLINE_SYNCED' && prevSyncStateRef.current !== 'ONLINE_SYNCED') {
        loadAllData();
      }
      prevSyncStateRef.current = state;
    });
    const unsubAuth = authService.subscribeLockState(setIsLocked);
    authService.syncStatus();

    return () => {
      unsubscribe();
      unsubAuth();
    };
  }, []);

  // Initial load
  useEffect(() => {
    loadAllData();
    fetchShopInfo();
  }, []);

  // Responsive default view detection (if mobile screen on load, default to MOBILE_REGISTER)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setCurrentView('MOBILE_REGISTER');
    }
  }, []);

  const loadAllData = async () => {
    try {
      // 1. Fetch active and open register sessions
      const [sessRes, openRes] = await Promise.all([
        fetch('/api/register/active'),
        fetch('/api/register/open-sessions').catch(() => null)
      ]);

      let allOpen: RegisterSession[] = [];
      if (openRes && openRes.ok) {
        allOpen = await openRes.json();
        setOpenSessions(allOpen);
      }

      if (sessRes.ok) {
        const sess = await sessRes.json();
        setActiveSession(prev => {
          if (prev && allOpen.some(s => s.id === prev.id)) {
            const updated = allOpen.find(s => s.id === prev.id);
            return updated || prev;
          }
          const preferredName = currentView === 'MOBILE_REGISTER' ? 'Mobile Register' : 'Countertop';
          const match = allOpen.find(s => s.counter_name === preferredName);
          return match || sess;
        });
      } else if (allOpen.length > 0) {
        const preferredName = currentView === 'MOBILE_REGISTER' ? 'Mobile Register' : 'Countertop';
        const match = allOpen.find(s => s.counter_name === preferredName);
        setActiveSession(match || allOpen[0]);
      } else {
        setActiveSession(null);
      }

      // 2. Fetch products and families
      const [prodRes, famRes, custRes, contRes] = await Promise.all([
        fetch('/api/products'),
        fetch('/api/products/families'),
        fetch('/api/customers'),
        fetch('/api/containers')
      ]);

      if (prodRes.ok) setProducts(await prodRes.json());
      if (famRes.ok) setFamilies(await famRes.json());
      if (custRes.ok) setCustomers(await custRes.json());
      if (contRes.ok) setContainerTypes(await contRes.json());

      // Pull into Dexie IndexedDB for offline capability
      await syncManager.pullMasterCatalog();
    } catch (err) {
      console.warn('Backend unreachable, falling back to local Dexie IndexedDB cache:', err);
      // Fallback to IndexedDB
      const localProducts = await clientDb.products.toArray();
      const localCustomers = await clientDb.customers.toArray();
      const localContainers = await clientDb.container_types.toArray();
      const localFamilies = await clientDb.product_families.toArray();

      if (localProducts.length > 0) setProducts(localProducts as any);
      if (localFamilies.length > 0) setFamilies(localFamilies as any);
      if (localCustomers.length > 0) setCustomers(localCustomers as any);
      if (localContainers.length > 0) setContainerTypes(localContainers as any);
    }
  };

  // Align active register session with current view if multiple registers are open
  useEffect(() => {
    if (openSessions.length > 1) {
      const preferredName = currentView === 'MOBILE_REGISTER' ? 'Mobile Register' : 'Countertop';
      const match = openSessions.find(s => s.counter_name === preferredName);
      if (match && activeSession?.id !== match.id) {
        setActiveSession(match);
      }
    }
  }, [currentView, openSessions]);

  const triggerDrawerIfCash = (cashPaid: number, sourceView = currentView) => {
    if (cashPaid > 0) {
      // ONLY trigger physical countertop cash drawer if sale originated from Desktop Countertop POS
      if (sourceView === 'DESKTOP_POS') {
        console.log('[Cash Drawer] Countertop cash sale — firing countertop USB drawer...');
        webSerialDrawer.kickDrawer().catch(err => console.warn('USB serial drawer kick error:', err));
        if (webUsbPrinter.getStatus().isConnected) {
          webUsbPrinter.kickDrawer().catch(err => console.warn('USB drawer kick error:', err));
        }
      } else {
        console.log('[Cash Drawer] Mobile cash sale — suppressing countertop drawer kick.');
        // If mobile device is paired via Bluetooth to a mobile printer with cash drawer, kick it
        if (webBluetoothPrinter.getStatus().isConnected) {
          webBluetoothPrinter.kickDrawer().catch(err => console.warn('BT drawer kick error:', err));
        }
      }
    }
  };

  const handleProcessSale = async (saleData: any): Promise<{ sale_id: string; receipt_number: string } | null> => {
    if (!activeSession || activeSession.status !== 'OPEN') {
      setSessionModalMode('OPEN');
      setIsSessionModalOpen(true);
      throw new Error('La caisse est fermée. Veuillez ouvrir une session de caisse avant de finaliser la vente.');
    }

    // Add active register session
    const fullPayload = {
      ...saleData,
      session_id: activeSession.id,
      register_session_id: activeSession.id
    };

    if (navigator.onLine) {
      let res: Response;
      try {
        res = await fetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fullPayload)
        });
      } catch (networkErr: any) {
        console.warn('Network error during sale, falling back to offline outbox queue:', networkErr);
        const tempId = await syncManager.queueOfflineSale(fullPayload);
        triggerDrawerIfCash(Number(fullPayload.cash_paid || 0), currentView);
        return {
          sale_id: tempId,
          receipt_number: 'REC-OFFLINE-' + tempId.slice(5, 13).toUpperCase()
        };
      }

      if (!res.ok) {
        let errorMsg = 'Sale failed';
        try {
          const errData = await res.json();
          errorMsg = errData.error || errorMsg;
        } catch {
          errorMsg = `Server error (${res.status})`;
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();
      triggerDrawerIfCash(Number(fullPayload.cash_paid || 0), currentView);
      return {
        sale_id: data.sale_id || data.id,
        receipt_number: data.receipt_number
      };
    } else {
      // Offline mode: queue in IndexedDB
      const tempId = await syncManager.queueOfflineSale(fullPayload);
      triggerDrawerIfCash(Number(fullPayload.cash_paid || 0), currentView);
      return {
        sale_id: tempId,
        receipt_number: 'REC-OFFLINE-' + tempId.slice(5, 13).toUpperCase()
      };
    }
  };

  const handlePopDrawer = async () => {
    console.log('[Cash Drawer] Manual drawer kick triggered.');
    // 1. USB Serial cash drawer (direct WebSerial & Linux /dev/ttyUSB0 trigger)
    await webSerialDrawer.kickDrawer().catch(err => console.warn('Serial drawer kick error:', err));

    // 2. Thermal printer DK port if connected
    if (webUsbPrinter.getStatus().isConnected) {
      await webUsbPrinter.kickDrawer().catch(err => console.warn('USB printer drawer kick error:', err));
    } else if (webBluetoothPrinter.getStatus().isConnected) {
      await webBluetoothPrinter.kickDrawer().catch(err => console.warn('BT printer drawer kick error:', err));
    }
  };

  const handleManualSync = async () => {
    try {
      await syncManager.flushSyncQueue();
      await loadAllData();
    } catch (err) {
      console.warn('Manual sync failed:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans select-none antialiased">
      {/* Shared App Header */}
      <Header
        currentView={currentView}
        onSelectView={setCurrentView}
        activeSession={activeSession}
        openSessions={openSessions}
        onSelectSession={sess => setActiveSession(sess)}
        syncState={syncState}
        pendingSyncCount={pendingSyncCount}
        reviewSyncCount={reviewSyncCount}
        onManualSync={handleManualSync}
        onPopDrawer={handlePopDrawer}
        onOpenCashMovement={() => setIsCashMovementOpen(true)}
        onOpenSessionModal={() => {
          setSessionModalMode('OPEN');
          setIsSessionModalOpen(true);
        }}
        onCloseSessionModal={() => {
          setSessionModalMode('CLOSE');
          setIsSessionModalOpen(true);
        }}
        onLockSession={() => authService.lock()}
      />

      {/* Main View Area */}
      <div className="flex-1 flex overflow-hidden">
        {currentView === 'DESKTOP_POS' && (
          <DesktopPos
            products={products}
            families={families}
            customers={customers}
            containerTypes={containerTypes}
            activeSession={activeSession}
            onOpenSessionModal={() => {
              setSessionModalMode('OPEN');
              setIsSessionModalOpen(true);
            }}
            onRefreshData={loadAllData}
            onPopDrawer={handlePopDrawer}
            onProcessSale={handleProcessSale}
            onPrintReceipt={saleId => setPrintReceiptSaleId(saleId)}
            onPrintInvoice={saleId => setPrintInvoiceSaleId(saleId)}
          />
        )}

        {currentView === 'MOBILE_REGISTER' && (
          <MobileRegister
            products={products}
            families={families}
            customers={customers}
            containerTypes={containerTypes}
            activeSession={activeSession}
            onOpenSessionModal={() => {
              setSessionModalMode('OPEN');
              setIsSessionModalOpen(true);
            }}
            onRefreshData={loadAllData}
            onProcessSale={handleProcessSale}
            onPrintReceipt={saleId => setPrintReceiptSaleId(saleId)}
            onPrintInvoice={saleId => setPrintInvoiceSaleId(saleId)}
          />
        )}

        {currentView === 'BACKOFFICE' && (
          <Backoffice
            products={products}
            families={families}
            customers={customers}
            containerTypes={containerTypes}
            activeSession={activeSession}
            onRefreshData={loadAllData}
          />
        )}
      </div>

      {/* Session Modal (Open / Close Session) */}
      <SessionModal
        isOpen={isSessionModalOpen}
        onClose={() => setIsSessionModalOpen(false)}
        mode={sessionModalMode}
        activeSession={activeSession}
        onSessionUpdated={loadAllData}
        currentView={currentView}
        onSelectSession={sess => setActiveSession(sess)}
      />

      {/* Cash Movement Modal (Float / Expense) */}
      <CashMovementModal
        isOpen={isCashMovementOpen}
        onClose={() => setIsCashMovementOpen(false)}
        activeSession={activeSession}
        onSuccess={loadAllData}
      />

      {/* Thermal Receipt Print Modal (58mm) */}
      <ReceiptPrintModal
        isOpen={Boolean(printReceiptSaleId)}
        onClose={() => setPrintReceiptSaleId(null)}
        saleId={printReceiptSaleId}
      />

      {/* A4 Invoice Print Modal */}
      <InvoicePrintModal
        isOpen={Boolean(printInvoiceSaleId)}
        onClose={() => setPrintInvoiceSaleId(null)}
        saleId={printInvoiceSaleId}
      />

      {/* Lock Screen & PIN Unlock Modal */}
      <LockScreenModal
        isLocked={isLocked}
        onUnlocked={() => setIsLocked(false)}
      />
    </div>
  );
}
