import { formatZReport, type ZReportSessionData } from './escpos.js';
import { webUsbPrinter } from './webusb.js';
import { webBluetoothPrinter } from './webbluetooth.js';
import { nativeSppPrinter } from './nativeSpp.js';

/**
 * Transmits a thermal Z-Report (clôture de caisse) to connected hardware printers.
 * Safe non-blocking execution: catches and handles all errors without throwing.
 */
export async function printZReportThermal(
  sessionData: ZReportSessionData,
  width: 58 | 80 = 58
): Promise<{ success: boolean; error?: string }> {
  try {
    const bytes = formatZReport(sessionData, width);

    // 1. WebUSB
    if (webUsbPrinter.getStatus().isConnected) {
      try {
        await webUsbPrinter.sendRaw(bytes);
        return { success: true };
      } catch (err: any) {
        console.warn('[Z-Report] WebUSB print error:', err);
      }
    }

    // 2. Native Bluetooth SPP (Android bonded printer)
    if (nativeSppPrinter.getStatus().isConnected) {
      try {
        await nativeSppPrinter.sendRaw(bytes);
        return { success: true };
      } catch (err: any) {
        console.warn('[Z-Report] Native SPP print error:', err);
      }
    }

    // 3. WebBluetooth
    if (webBluetoothPrinter.getStatus().isConnected) {
      try {
        await webBluetoothPrinter.sendRaw(bytes);
        return { success: true };
      } catch (err: any) {
        console.warn('[Z-Report] WebBluetooth print error:', err);
      }
    }

    // 4. Browser print fallback if available
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      try {
        window.print();
        return { success: true };
      } catch (err: any) {
        console.warn('[Z-Report] Window print fallback error:', err);
      }
    }

    return { success: false, error: 'Aucune imprimante thermique connectée' };
  } catch (err: any) {
    console.warn('[Z-Report] Print failed safely:', err);
    return { success: false, error: err.message || 'Erreur impression' };
  }
}
