package com.jazira.erp.printer;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import android.Manifest;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

/**
 * Bluetooth Classic (SPP) ESC/POS printer bridge.
 * The shop MPT-II bonds as a Classic SPP device (no BLE GATT), so the
 * WebBluetooth path can never reach it. This plugin opens the standard
 * SPP RFCOMM socket and streams raw ESC/POS bytes.
 */
@CapacitorPlugin(
    name = "ErpSppPrinter",
    permissions = {
        @Permission(
            strings = { Manifest.permission.BLUETOOTH_CONNECT },
            alias = "bluetooth"
        )
    }
)
public class ErpSppPrinterPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private BluetoothSocket socket;
    private OutputStream out;
    private String connectedAddress;

    @PluginMethod
    public void listBonded(PluginCall call) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                call.reject("Bluetooth not available on this device");
                return;
            }
            JSArray devices = new JSArray();
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice device : bonded) {
                    JSObject entry = new JSObject();
                    entry.put("name", device.getName());
                    entry.put("address", device.getAddress());
                    devices.put(entry);
                }
            }
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        } catch (SecurityException se) {
            call.reject("Bluetooth permission denied: " + se.getMessage());
        } catch (Exception e) {
            call.reject("listBonded failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("address is required");
            return;
        }
        closeQuietly();
        Exception lastError = null;
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                call.reject("Bluetooth not available on this device");
                return;
            }
            if (!adapter.isEnabled()) {
                call.reject("Bluetooth is off");
                return;
            }
            BluetoothDevice device = adapter.getRemoteDevice(address);
            adapter.cancelDiscovery();

            // 1) Standard secure SPP socket (works for most bonded printers).
            try {
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
            } catch (Exception e1) {
                lastError = e1;
                closeQuietly();
                // 2) Insecure SPP socket (older printer firmware).
                try {
                    socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                    socket.connect();
                } catch (Exception e2) {
                    lastError = e2;
                    closeQuietly();
                    // 3) Reflection on channel 1 (classic workaround for
                    // cached/stale SDP channel on cheap SPP modules).
                    try {
                        socket = (BluetoothSocket) device.getClass()
                                .getMethod("createRfcommSocket", int.class)
                                .invoke(device, 1);
                        socket.connect();
                    } catch (Exception e3) {
                        lastError = e3;
                        closeQuietly();
                    }
                }
            }

            if (socket == null || !socket.isConnected()) {
                call.reject("SPP connect failed: " + (lastError != null ? lastError.getMessage() : "unknown"));
                return;
            }
            out = socket.getOutputStream();
            connectedAddress = address;
            JSObject ret = new JSObject();
            ret.put("name", device.getName());
            ret.put("address", address);
            call.resolve(ret);
        } catch (SecurityException se) {
            closeQuietly();
            call.reject("Bluetooth permission denied: " + se.getMessage());
        } catch (Exception e) {
            closeQuietly();
            call.reject("SPP connect failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("data (base64) is required");
            return;
        }
        if (out == null || socket == null || !socket.isConnected()) {
            call.reject("SPP printer is not connected");
            return;
        }
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            int off = 0;
            while (off < bytes.length) {
                int len = Math.min(1024, bytes.length - off);
                out.write(bytes, off, len);
                out.flush();
                off += len;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("SPP write failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeQuietly();
        call.resolve();
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ok = socket != null && socket.isConnected();
        ret.put("connected", ok);
        if (ok && connectedAddress != null) {
            ret.put("address", connectedAddress);
        }
        call.resolve(ret);
    }

    private void closeQuietly() {
        try {
            if (out != null) out.close();
        } catch (Exception ignored) {}
        try {
            if (socket != null) socket.close();
        } catch (Exception ignored) {}
        out = null;
        socket = null;
        connectedAddress = null;
    }
}
