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
  KeyRound
} from 'lucide-react';
import type { RegisterSession } from '../../types/index.js';
import type { SyncState } from '../../services/syncManager.js';
import { formatMoney } from '../../utils/formatters.js';
import { webUsbPrinter, type UsbPrinterStatus } from '../../services/hardware/webusb.js';
import { webBluetoothPrinter, type BluetoothPrinterStatus } from '../../services/hardware/webbluetooth.js';
import { AuthCredentialsModal } from './AuthCredentialsModal.js';

interface HeaderProps {
  currentView: 'DESKTOP_POS' | 'MOBILE_REGISTER' | 'BACKOFFICE';
  onSelectView: (view: 'DESKTOP_POS' | 'MOBILE_REGISTER' | 'BACKOFFICE') => void;
  activeSession: RegisterSession | null;
  syncState: SyncState;
  pendingSyncCount: number;
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
  const [serialPortInfo, setSerialPortInfo] = useState<string | null>(null);
  const [printerHardwareInfo, setPrinterHardwareInfo] = useState<{ connected: boolean; device_name?: string; driver_type?: string } | null>(null);
  const [drawerKicking, setDrawerKicking] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useEffect(() => {
    const unsubUsb = webUsbPrinter.subscribeStatus(setUsbStatus);
    const unsubBt = webBluetoothPrinter.subscribeStatus(setBtStatus);

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
    };
  }, []);

  const handleDrawerClick = async () => {
    setDrawerKicking(true);
    try {
      await onPopDrawer();
    } finally {
      setTimeout(() => setDrawerKicking(false), 1200);
    }
  };
  return (
    <header className="bg-slate-900 text-white shadow-md select-none sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2">
        {/* Brand & View Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center font-black text-lg text-white shadow-inner">
              J
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white leading-tight">
                Al Jazira SHSP
              </h1>
              <p className="text-[10px] text-slate-400 font-medium">
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
                  ? 'bg-emerald-600 text-white shadow-sm'
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
                  ? 'bg-emerald-600 text-white shadow-sm'
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
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Backoffice</span>
            </button>
          </nav>
        </div>

        {/* Center/Right: Session Status, Sync Badge, Cash Actions */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Active Session Badge & Switcher */}
          {activeSession && activeSession.status === 'OPEN' ? (
            <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 px-2.5 py-1 rounded-lg text-xs">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              {openSessions && openSessions.length > 1 ? (
                <select
                  value={activeSession.id}
                  onChange={(e) => {
                    const target = openSessions.find(s => s.id === e.target.value);
                    if (target && onSelectSession) onSelectSession(target);
                  }}
                  className="bg-slate-900 text-emerald-400 font-semibold text-xs border border-slate-600 rounded px-1.5 py-0.5 outline-none cursor-pointer hover:border-emerald-500"
                  title="Changer de caisse active"
                >
                  {openSessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.counter_name} ({s.session_number})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-medium text-slate-200">
                  {activeSession.session_number} ({activeSession.counter_name})
                </span>
              )}
              <span className="text-slate-400 border-l border-slate-700 pl-2 hidden sm:inline">
                Float: {formatMoney(activeSession.opening_cash)}
              </span>
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
                  <option key={s.id} value={s.id}>
                    {s.counter_name} ({s.session_number})
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

          {/* USB Printer (Desktop) */}
          <button
            onClick={async () => {
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
            }}
            title={
              printerHardwareInfo?.connected
                ? `H313 POS Imprimante Connectée (${printerHardwareInfo.driver_type}) — Cliquez pour tester`
                : usbStatus.isConnected
                ? `Connecté: ${usbStatus.deviceName}`
                : 'Connecter l\'imprimante thermique USB 58mm (H313 POS)'
            }
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold border transition-colors ${
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
          {btStatus.isSupported && (
            <button
              onClick={async () => {
                if (!btStatus.isConnected) {
                  try {
                    await webBluetoothPrinter.requestAndConnect();
                  } catch (err: any) {
                    alert(err.message || 'Failed to connect Bluetooth printer');
                  }
                }
              }}
              title={btStatus.isConnected ? `Connected: ${btStatus.deviceName}` : 'Pair 58mm Bluetooth Receipt Printer'}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                btStatus.isConnected
                  ? 'bg-emerald-950/60 border-emerald-600 text-emerald-400'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              }`}
            >
              <Bluetooth className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden lg:inline">{btStatus.isConnected ? 'BT Ready' : 'Pair BT'}</span>
            </button>
          )}

          {/* Quick Drawer & Cash Movement Actions */}
          <button
            onClick={handleDrawerClick}
            title={
              drawerKicking
                ? 'Solenoid pulse sent!'
                : serialPortInfo
                ? `Pop Cash Drawer (USB Serial: ${serialPortInfo})`
                : 'Pop Cash Drawer'
            }
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
              drawerKicking
                ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold scale-95 shadow-md'
                : serialPortInfo
                ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/40 hover:text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700'
            }`}
          >
            <Archive className={`w-3.5 h-3.5 text-amber-400 ${drawerKicking ? 'animate-bounce' : ''}`} />
            <span className="hidden md:inline">{drawerKicking ? 'Popped!' : 'Drawer'}</span>
            {serialPortInfo && !drawerKicking && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title={`Connected on ${serialPortInfo}`} />
            )}
          </button>

          {activeSession?.status === 'OPEN' && (
            <>
              <button
                onClick={onOpenCashMovement}
                title="Cash In / Cash Out float movement"
                className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-700 transition-colors"
              >
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden md:inline">Cash In/Out</span>
              </button>

              <button
                onClick={onCloseSessionModal}
                title="Close Register Session and audit cash"
                className="flex items-center gap-1 bg-rose-900/40 hover:bg-rose-900/60 text-rose-300 hover:text-rose-100 px-2 sm:px-2.5 py-1 rounded-lg text-xs font-semibold border border-rose-800/60 transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
                <span className="inline">Close</span>
              </button>
            </>
          )}

          {/* Security Settings Button */}
          <button
            onClick={() => setIsAuthModalOpen(true)}
            title="Security Settings (Change PIN / Master Password)"
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-700 transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden md:inline">Security</span>
          </button>

          {/* Lock Counter Screen Button */}
          <button
            onClick={onLockSession}
            title="Lock Counter (Requires PIN to unlock)"
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-700 transition-colors"
          >
            <Lock className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Lock</span>
          </button>
        </div>
      </div>

      <AuthCredentialsModal
        isOpen={isAuthModalOpen}
        mode="CHANGE"
        onClose={() => setIsAuthModalOpen(false)}
      />
    </header>
  );
};
