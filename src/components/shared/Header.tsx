import React, { useState, useEffect } from 'react';
import { 
  Monitor, 
  Smartphone, 
  Settings, 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  DollarSign, 
  Archive, 
  Lock, 
  Unlock,
  Printer,
  Usb,
  Bluetooth,
  AlertCircle,
  X,
  MoreVertical,
  ArrowLeft,
  Check
} from 'lucide-react';
import type { RegisterSession } from '../../types/index.js';
import { syncManager, type SyncState } from '../../services/syncManager.js';
import type { PendingSyncItem } from '../../db/clientDb.js';
import { formatMoney } from '../../utils/formatters.js';
import { webUsbPrinter, type UsbPrinterStatus } from '../../services/hardware/webusb.js';
import { webBluetoothPrinter, type BluetoothPrinterStatus } from '../../services/hardware/webbluetooth.js';
import { nativeSppPrinter, type SppPrinterStatus } from '../../services/hardware/nativeSpp.js';
import { AuthCredentialsModal } from './AuthCredentialsModal.js';
import { authService } from '../../services/authService.js';

interface HeaderProps {
  currentView: 'DESKTOP_POS' | 'MOBILE_REGISTER' | 'BACKOFFICE';
  onSelectView: (view: 'DESKTOP_POS' | 'MOBILE_REGISTER' | 'BACKOFFICE') => void;
  activeSession: RegisterSession | null;
  syncState: SyncState;
  pendingSyncCount: number;
  reviewSyncCount?: number;
  onManualSync: () => void;
  onPopDrawer: () => void;
  onOpenCashMovement: () => void;
  onOpenSessionModal: () => void;
  onCloseSessionModal: () => void;
  onLockSession: () => void;
  openSessions?: RegisterSession[];
  onSelectSession?: (session: RegisterSession) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  onSelectView,
  activeSession,
  syncState,
  pendingSyncCount,
  reviewSyncCount = 0,
  onManualSync,
  onPopDrawer,
  onOpenCashMovement,
  onOpenSessionModal,
  onCloseSessionModal,
  onLockSession,
  openSessions = [],
  onSelectSession
}) => {
  const [usbStatus, setUsbStatus] = useState<UsbPrinterStatus>(webUsbPrinter.getStatus());
  const [btStatus, setBtStatus] = useState<BluetoothPrinterStatus>(webBluetoothPrinter.getStatus());
  const [sppStatus, setSppStatus] = useState<SppPrinterStatus>(nativeSppPrinter.getStatus());
  const [serialPortInfo, setSerialPortInfo] = useState<string | null>(null);
  const [printerHardwareInfo, setPrinterHardwareInfo] = useState<{ connected: boolean; device_name?: string; driver_type?: string } | null>(null);
  const [drawerKicking, setDrawerKicking] = useState(false);
  const [drawerCooldown, setDrawerCooldown] = useState(false);
  const [printCooldown, setPrintCooldown] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAuthConfigured, setIsAuthConfigured] = useState<boolean>(authService.isConfigured());
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<PendingSyncItem[]>([]);
  const [isRetryingReview, setIsRetryingReview] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    authService.syncStatus().then(st => setIsAuthConfigured(st.configured));
  }, []);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMobileMenuOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isMobileMenuOpen]);

  useEffect(() => {
    const unsubUsb = webUsbPrinter.subscribeStatus(setUsbStatus);
    const unsubBt = webBluetoothPrinter.subscribeStatus(setBtStatus);
    const unsubSpp = nativeSppPrinter.subscribeStatus(setSppStatus);

    // Check for connected USB Serial Cash Drawer on /dev/ttyUSB*
    fetch('/api/hardware/drawer/status')
      .then(res => res.json())
      .then(data => {
        if (data.detected && data.port) {
          setSerialPortInfo(data.port);
        }
      })
      .catch(() => {});

    // Check for connected USB POS Thermal Printer (matches Kotlin DesktopReceiptPrinter)
    fetch('/api/hardware/printer/status')
      .then(res => res.json())
      .then(data => {
        if (data.connected) {
          setPrinterHardwareInfo(data);
        }
      })
      .catch(() => {});

    return () => {
      unsubUsb();
      unsubBt();
      unsubSpp();
    };
  }, []);

  const handleDrawerClick = async () => {
    if (drawerCooldown) return;
    setDrawerCooldown(true);
    setDrawerKicking(true);
    try {
      await onPopDrawer();
    } finally {
      setTimeout(() => {
        setDrawerKicking(false);
        setDrawerCooldown(false);
      }, 1000);
    }
  };

  const handlePrintClick = async () => {
    if (printCooldown) return;
    setPrintCooldown(true);
    setTimeout(() => setPrintCooldown(false), 1000);

    if (printerHardwareInfo?.connected) {
      // Printer is already connected via direct libusb driver! Print a quick test slip
      try {
        const res = await fetch('/api/hardware/printer/print', { method: 'POST' });
        if (res.ok) {
          alert('Ticket de test envoyé à l\'imprimante H313 POS !');
        } else {
          const data = await res.json();
          alert(data.error || 'Erreur impression');
        }
      } catch (e: any) {
        alert(e.message || 'Erreur de communication imprimante');
      }
      return;
    }
    if (usbStatus.isSupported && !usbStatus.isConnected) {
      try {
        await webUsbPrinter.requestAndConnect();
      } catch (err: any) {
        if (err?.name !== 'NotFoundError' && !err?.message?.includes('No device selected')) {
          alert(err.message || 'Failed to connect USB printer');
        }
      }
    }
  };
  return (
    <header className="bg-slate-900 text-white shadow-md select-none sticky top-0 z-30 shrink-0 pt-[var(--sat)]">
      {/* Compact Mobile Header (<640px only) */}
      <div className="flex sm:hidden w-full px-3 h-14 max-h-[56px] items-center justify-between gap-2 relative">
        {/* [back to register when in Backoffice | logo/short company name] */}
        {currentView === 'BACKOFFICE' && (
          <button
            onClick={() => onSelectView('MOBILE_REGISTER')}
            className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl bg-emerald-700 text-white text-sm font-bold shrink-0"
            aria-label="Retour à la caisse"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Caisse</span>
          </button>
        )}
        <div className={`${currentView === 'BACKOFFICE' ? 'hidden' : 'flex'} items-center gap-2 min-w-0 shrink`}>
          <div className="w-7 h-7 rounded-lg bg-emerald-700 flex items-center justify-center font-black text-sm text-white shadow-inner shrink-0">
            J
          </div>
          <span className="text-sm font-bold tracking-tight text-white truncate whitespace-nowrap">
            Al Jazira
          </span>
        </div>

        {/* [session name, truncate] */}
        <div className="min-w-0 flex-1 flex justify-center px-1">
          {activeSession && activeSession.status === 'OPEN' ? (
            <div
              className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 px-2 py-1 rounded-lg text-xs max-w-full"
              title={activeSession.session_number}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
              <span className="font-semibold text-emerald-400 truncate whitespace-nowrap">
                {activeSession.counter_name}
              </span>
            </div>
          ) : openSessions && openSessions.length > 0 ? (
            <div
              className="flex items-center gap-1 bg-amber-950/40 border border-amber-500/40 px-2 py-1 rounded-lg text-xs max-w-full"
              title={openSessions[0].session_number}
            >
              <span className="text-amber-300 font-medium truncate whitespace-nowrap">
                {openSessions[0].counter_name}
              </span>
            </div>
          ) : (
            <button
              onClick={onOpenSessionModal}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-2.5 py-1 rounded-lg text-xs truncate whitespace-nowrap"
            >
              Ouvrir
            </button>
          )}
        </div>

        {/* [⋮ menu] (44px target) */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="w-11 h-11 flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          title="Menu des options"
          aria-label="Menu"
        >
          <MoreVertical className="w-5 h-5" />
        </button>

        {/* ⋮ Menu dropdown */}
        {isMobileMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <div className="absolute top-full right-2 mt-1 z-50 w-64 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl py-1.5 text-xs text-slate-200 divide-y divide-slate-800 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="p-1 space-y-0.5">
                <p className="px-3 pt-1 pb-0.5 text-pos-badge font-bold uppercase tracking-wide text-slate-400">Aller à</p>
                {([
                  ['MOBILE_REGISTER', 'Caisse'],
                  ['DESKTOP_POS', 'Comptoir'],
                  ['BACKOFFICE', 'Backoffice']
                ] as const).map(([view, label]) => (
                  <button
                    key={view}
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onSelectView(view);
                    }}
                    className={`w-full flex items-center justify-between gap-2.5 px-3 min-h-[44px] rounded-xl hover:bg-slate-800 font-semibold text-left transition-colors ${
                      currentView === view ? 'text-emerald-400' : 'text-slate-200'
                    }`}
                  >
                    <span>{label}</span>
                    {currentView === view && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="p-1 space-y-0.5">
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onOpenCashMovement();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-800 font-semibold text-slate-200 transition-colors text-left"
                >
                  <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Mouvement de caisse</span>
                </button>

                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    if (activeSession?.status === 'OPEN') {
                      onCloseSessionModal();
                    } else {
                      onOpenSessionModal();
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-800 font-semibold text-slate-200 transition-colors text-left"
                >
                  <Archive className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{activeSession?.status === 'OPEN' ? 'Clôturer la caisse' : 'Ouvrir la caisse'}</span>
                </button>

                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    handleDrawerClick();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-800 font-semibold text-slate-200 transition-colors text-left"
                >
                  <Archive className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Ouvrir le tiroir</span>
                </button>

                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    handlePrintClick();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-800 font-semibold text-slate-200 transition-colors text-left"
                >
                  <Printer className="w-4 h-4 text-blue-400 shrink-0" />
                  <span>Imprimante</span>
                </button>

                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    if (!isAuthConfigured) {
                      setIsAuthModalOpen(true);
                    } else {
                      onLockSession();
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-800 font-semibold text-slate-200 transition-colors text-left"
                >
                  <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Verrouiller</span>
                </button>

                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onSelectView('BACKOFFICE');
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-800 font-semibold text-slate-200 transition-colors text-left"
                >
                  <Settings className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>Paramètres</span>
                </button>
              </div>

              <div className="p-2.5 flex items-center justify-between text-pos-badge text-slate-400">
                <span>Statut Sync:</span>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onManualSync();
                  }}
                  className="flex items-center gap-1 font-bold text-slate-300 hover:text-white"
                >
                  {syncState === 'ONLINE_SYNCED' ? (
                    <span className="text-emerald-400">En ligne</span>
                  ) : syncState === 'SYNCING' ? (
                    <span className="text-blue-400">Sync...</span>
                  ) : (
                    <span className="text-amber-400">Hors ligne ({pendingSyncCount})</span>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Desktop / Tablet Header (>=640px) */}
      <div className="hidden sm:flex w-full px-3 sm:px-4 py-1.5 items-center justify-between gap-2 overflow-x-auto">
        {/* Brand & View Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-700 flex items-center justify-center font-black text-lg text-white shadow-inner">
              J
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white leading-tight">
                Al Jazira SHSP
              </h1>
              <p className="text-xs text-slate-400 font-medium">
                Detergents & Hygiène ERP
              </p>
            </div>
          </div>

          {/* Nav Tabs */}
          <nav className="flex items-center bg-slate-800 p-0.5 rounded-lg text-xs font-semibold ml-2">
            <button
              onClick={() => onSelectView('DESKTOP_POS')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${
                currentView === 'DESKTOP_POS'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Countertop</span>
            </button>
            <button
              onClick={() => onSelectView('MOBILE_REGISTER')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${
                currentView === 'MOBILE_REGISTER'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Mobile</span>
            </button>
            <button
              onClick={() => onSelectView('BACKOFFICE')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${
                currentView === 'BACKOFFICE'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Backoffice</span>
            </button>
          </nav>
        </div>

        {/* Center/Right: Session Status, Sync Badge, Cash Actions */}
        <div className="flex items-center gap-2 sm:gap-2.5 flex-nowrap shrink-0">
          {/* Active Session Badge & Switcher */}
          {activeSession && activeSession.status === 'OPEN' ? (
            <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 px-2.5 py-1 rounded-lg text-xs" title={activeSession.session_number}>
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              {openSessions && openSessions.length > 1 ? (
                <select
                  value={activeSession.id}
                  onChange={(e) => {
                    const target = openSessions.find(s => s.id === e.target.value);
                    if (target && onSelectSession) onSelectSession(target);
                  }}
                  className="bg-slate-900 text-emerald-400 font-semibold text-xs border border-slate-600 rounded px-1.5 py-0.5 outline-none cursor-pointer hover:border-emerald-500"
                  title={activeSession.session_number}
                >
                  {openSessions.map(s => (
                    <option key={s.id} value={s.id} title={s.session_number}>
                      {s.counter_name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-medium text-slate-200" title={activeSession.session_number}>
                  {activeSession.counter_name}
                </span>
              )}
            </div>
          ) : openSessions && openSessions.length > 0 ? (
            <div className="flex items-center gap-1.5 bg-amber-950/40 border border-amber-500/40 px-2 py-1 rounded-lg text-xs">
              <span className="text-amber-300 font-medium hidden sm:inline">Caisse dispo:</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const target = openSessions.find(s => s.id === e.target.value);
                  if (target && onSelectSession) onSelectSession(target);
                }}
                className="bg-slate-900 text-amber-300 font-semibold text-xs border border-amber-600/50 rounded px-1.5 py-0.5 outline-none cursor-pointer"
              >
                <option value="" disabled>Sélectionner caisse...</option>
                {openSessions.map(s => (
                  <option key={s.id} value={s.id} title={s.session_number}>
                    {s.counter_name}
                  </option>
                ))}
              </select>
              <button
                onClick={onOpenSessionModal}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-2 py-0.5 rounded text-xs ml-1"
                title="Ouvrir une nouvelle session"
              >
                +
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenSessionModal}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-3 py-1 rounded-lg text-xs shadow-sm transition-all"
            >
              <Unlock className="w-3.5 h-3.5" />
              Open Session
            </button>
          )}

          {/* Sync Status Badge */}
          <div
            onClick={onManualSync}
            title="Click to trigger manual synchronization"
            className="cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border font-medium transition-colors"
            style={{
              backgroundColor:
                syncState === 'ONLINE_SYNCED'
                  ? 'rgba(16, 185, 129, 0.1)'
                  : syncState === 'SYNCING'
                  ? 'rgba(59, 130, 246, 0.1)'
                  : 'rgba(245, 158, 11, 0.1)',
              borderColor:
                syncState === 'ONLINE_SYNCED'
                  ? 'rgba(16, 185, 129, 0.4)'
                  : syncState === 'SYNCING'
                  ? 'rgba(59, 130, 246, 0.4)'
                  : 'rgba(245, 158, 11, 0.4)',
              color:
                syncState === 'ONLINE_SYNCED'
                  ? '#34d399'
                  : syncState === 'SYNCING'
                  ? '#60a5fa'
                  : '#fbbf24'
            }}
          >
            {syncState === 'ONLINE_SYNCED' ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span>Online</span>
              </>
            ) : syncState === 'SYNCING' ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                <span>Syncing...</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span>Offline ({pendingSyncCount})</span>
              </>
            )}
          </div>

          {/* Review items badge */}
          {reviewSyncCount > 0 && (
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                const items = await syncManager.getReviewItems();
                setReviewItems(items);
                setIsReviewModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-colors shrink-0"
              title="Cliquer pour afficher les opérations nécessitant une vérification"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
              <span>{reviewSyncCount} à vérifier</span>
            </button>
          )}

          {/* USB Printer (Desktop) */}
          <button
            disabled={printCooldown}
            onClick={handlePrintClick}
            title={
              printerHardwareInfo?.connected
                ? `H313 POS Imprimante Connectée (${printerHardwareInfo.driver_type}) — Cliquez pour tester`
                : usbStatus.isConnected
                ? `Connecté: ${usbStatus.deviceName}`
                : 'Connecter l\'imprimante thermique USB 58mm (H313 POS)'
            }
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold border transition-colors ${
              printCooldown ? 'opacity-50 cursor-not-allowed ' : ''
            }${
              printerHardwareInfo?.connected || usbStatus.isConnected
                ? 'bg-emerald-950/60 border-emerald-600 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            {(printerHardwareInfo?.connected || usbStatus.isConnected) ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            ) : (
              <Usb className="w-3.5 h-3.5 text-blue-400" />
            )}
            <span className="hidden lg:inline">
              {printerHardwareInfo?.connected ? 'Imprimante Prête' : usbStatus.isConnected ? 'USB Prêt' : 'Imprimante'}
            </span>
          </button>

          {/* Bluetooth Printer (Mobile) */}
          {(btStatus.isSupported || sppStatus.isSupported) && (
            <button
              onClick={async () => {
                const anyConnected = btStatus.isConnected || sppStatus.isConnected;
                if (!anyConnected) {
                  try {
                    // Classic SPP first: bonded serial printers (MPT-II) connect
                    // deterministically with no scan. Only fall back to the BLE
                    // shim when there is nothing bonded to try.
                    if (sppStatus.isSupported) {
                      try {
                        await nativeSppPrinter.autoConnect();
                        return;
                      } catch (sppErr: any) {
                        if (sppErr?.code === 'NO_BONDED' || sppErr?.code === 'NOT_NATIVE') {
                          console.warn('[Header] No SPP candidate, trying BLE:', sppErr);
                        } else {
                          alert(sppErr.message || 'Failed to connect Bluetooth printer');
                          return;
                        }
                      }
                    }
                    await webBluetoothPrinter.requestAndConnect();
                  } catch (err: any) {
                    alert(err.message || 'Failed to connect Bluetooth printer');
                  }
                }
              }}
              title={
                sppStatus.isConnected
                  ? `Connected (SPP): ${sppStatus.deviceName}`
                  : btStatus.isConnected
                  ? `Connected: ${btStatus.deviceName}`
                  : 'Pair 58mm Bluetooth Receipt Printer'
              }
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                btStatus.isConnected || sppStatus.isConnected
                  ? 'bg-emerald-950/60 border-emerald-600 text-emerald-400'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              }`}
            >
              <Bluetooth className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden lg:inline">{btStatus.isConnected || sppStatus.isConnected ? 'BT Ready' : 'Pair BT'}</span>
            </button>
          )}

          {/* Quick Drawer & Cash Movement Actions */}
          <button
            disabled={drawerCooldown || drawerKicking}
            onClick={handleDrawerClick}
            title={
              drawerKicking
                ? 'Solenoid pulse sent!'
                : serialPortInfo
                ? `Pop Cash Drawer (USB Serial: ${serialPortInfo})`
                : 'Pop Cash Drawer'
            }
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
              drawerCooldown ? 'opacity-50 cursor-not-allowed ' : ''
            }${
              drawerKicking
                ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold scale-95 shadow-md'
                : serialPortInfo
                ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/40 hover:text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700'
            }`}
          >
            <Archive className={`w-3.5 h-3.5 text-amber-400 ${drawerKicking ? 'animate-bounce' : ''}`} />
            <span className="hidden md:inline">{drawerKicking ? 'Ouvert !' : 'Tiroir'}</span>
            {serialPortInfo && !drawerKicking && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title={`Connected on ${serialPortInfo}`} />
            )}
          </button>

          {activeSession?.status === 'OPEN' && (
            <>
              <button
                onClick={onOpenCashMovement}
                title="Mouvement de caisse (Entrée / Sortie)"
                className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-700 transition-colors"
              >
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden md:inline">Mouvement</span>
              </button>

              <button
                onClick={onCloseSessionModal}
                title="Clôturer la session de caisse et auditer les espèces"
                className="flex items-center gap-1 bg-rose-900/40 hover:bg-rose-900/60 text-rose-300 hover:text-rose-100 px-2 sm:px-2.5 py-1 rounded-lg text-xs font-semibold border border-rose-800/60 transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
                <span className="inline">Clôturer</span>
              </button>
            </>
          )}

          {/* Lock Counter Screen Button */}
          <button
            onClick={() => {
              if (!isAuthConfigured) {
                setIsAuthModalOpen(true);
              } else {
                onLockSession();
              }
            }}
            title={isAuthConfigured ? "Lock Counter (Requires PIN to unlock)" : "Configurer le code PIN pour verrouiller"}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-700 transition-colors"
          >
            <Lock className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Lock</span>
          </button>
        </div>
      </div>

      <AuthCredentialsModal
        isOpen={isAuthModalOpen}
        mode={isAuthConfigured ? 'CHANGE' : 'SETUP'}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={() => {
          setIsAuthConfigured(true);
          setIsAuthModalOpen(false);
        }}
      />

      {/* Sync Review Items Modal */}
      {isReviewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 text-slate-100 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-rose-400" />
                <h3 className="font-bold text-sm">Opérations à vérifier ({reviewItems.length})</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsReviewModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2">
              {reviewItems.map(item => (
                <div key={item.temp_client_id} className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 text-xs space-y-1">
                  <div className="flex justify-between font-mono font-bold text-slate-300">
                    <span>{item.action_type}</span>
                    <span className="text-pos-badge text-slate-400">{item.temp_client_id}</span>
                  </div>
                  <div className="text-rose-400 font-semibold text-xs">
                    Erreur: {item.error || 'Vérification requise'}
                  </div>
                </div>
              ))}
              {reviewItems.length === 0 && (
                <div className="text-center py-6 text-slate-400 text-xs">
                  Aucune opération en attente de vérification.
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsReviewModalOpen(false)}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 font-bold rounded-xl text-xs text-slate-300 transition-colors"
              >
                Fermer
              </button>
              <button
                type="button"
                disabled={isRetryingReview || reviewItems.length === 0}
                onClick={async () => {
                  setIsRetryingReview(true);
                  try {
                    await syncManager.retryReviewItems();
                    setIsReviewModalOpen(false);
                  } finally {
                    setIsRetryingReview(false);
                  }
                }}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 font-bold rounded-xl text-xs text-white transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRetryingReview ? 'animate-spin' : ''}`} />
                <span>{isRetryingReview ? 'Nouvel essai...' : 'Réessayer'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
