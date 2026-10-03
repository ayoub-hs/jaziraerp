#!/usr/bin/env python3
"""
Direct libusb driver for POS thermal printers.
Matches Kotlin DesktopReceiptPrinter implementation:
  - Vendor ID: 0x0483
  - Product ID: 0x5840
  - Endpoint: 0x04 (Bulk OUT)
  - Auto-detaches kernel driver (usblp)
"""

import sys
import os
import json
import ctypes
from ctypes import c_int, c_uint8, c_uint16, c_void_p, c_char_p, POINTER, byref, Structure

VENDOR_ID = 0x0483
PRODUCT_ID = 0x5840
ENDPOINT = 0x04

# Load libusb-1.0
try:
    libusb = ctypes.CDLL('libusb-1.0.so.0')
except Exception as e:
    try:
        libusb = ctypes.CDLL('libusb-1.0.so')
    except Exception as e2:
        libusb = None

class DeviceDescriptor(Structure):
    _fields_ = [
        ('bLength', c_uint8),
        ('bDescriptorType', c_uint8),
        ('bcdUSB', c_uint16),
        ('bDeviceClass', c_uint8),
        ('bDeviceSubClass', c_uint8),
        ('bDeviceProtocol', c_uint8),
        ('bMaxPacketSize0', c_uint8),
        ('idVendor', c_uint16),
        ('idProduct', c_uint16),
        ('bcdDevice', c_uint16),
        ('iManufacturer', c_uint8),
        ('iProduct', c_uint8),
        ('iSerialNumber', c_uint8),
        ('bNumConfigurations', c_uint8)
    ]

def check_printer_status(vid=VENDOR_ID, pid=PRODUCT_ID):
    if not libusb:
        return {"connected": False, "error": "libusb-1.0 library not found on system"}
    
    ret = libusb.libusb_init(None)
    if ret < 0:
        return {"connected": False, "error": f"libusb_init failed with code {ret}"}
    
    try:
        dev_list = POINTER(c_void_p)()
        cnt = libusb.libusb_get_device_list(None, byref(dev_list))
        found = False
        detected_vid = None
        detected_pid = None
        
        for i in range(cnt):
            dev = dev_list[i]
            desc = DeviceDescriptor()
            libusb.libusb_get_device_descriptor(dev, byref(desc))
            if desc.idVendor == vid and desc.idProduct == pid:
                found = True
                detected_vid = desc.idVendor
                detected_pid = desc.idProduct
                break
        
        libusb.libusb_free_device_list(dev_list, 1)
        
        return {
            "connected": found,
            "vendor_id": f"0x{detected_vid:04X}" if detected_vid else f"0x{vid:04X}",
            "product_id": f"0x{detected_pid:04X}" if detected_pid else f"0x{pid:04X}",
            "device_name": "H313 POS 58mm Thermal Printer" if found else None,
            "endpoint": f"0x{ENDPOINT:02X}"
        }
    finally:
        libusb.libusb_exit(None)

def print_raw_escpos(data: bytes, vid=VENDOR_ID, pid=PRODUCT_ID, endpoint=ENDPOINT):
    if not libusb:
        return {"success": False, "error": "libusb-1.0 not found"}
    
    ret = libusb.libusb_init(None)
    if ret < 0:
        return {"success": False, "error": f"libusb_init failed ({ret})"}
    
    handle = None
    try:
        handle = libusb.libusb_open_device_with_vid_pid(None, vid, pid)
        if not handle:
            return {
                "success": False, 
                "error": f"Printer device not found (VID: 0x{vid:04X}, PID: 0x{pid:04X}). Please ensure the printer is turned ON and plugged in."
            }
        
        # Auto detach kernel driver (usblp)
        libusb.libusb_set_auto_detach_kernel_driver(handle, 1)
        
        # Claim interface 0
        claim_res = libusb.libusb_claim_interface(handle, 0)
        if claim_res < 0:
            return {"success": False, "error": f"Failed to claim USB interface 0 (error code: {claim_res})"}
        
        try:
            # Send bulk transfer
            transferred = c_int(0)
            data_buf = (c_uint8 * len(data))(*data)
            
            # libusb_bulk_transfer(handle, endpoint, data, length, actual_length, timeout)
            res = libusb.libusb_bulk_transfer(
                handle,
                c_uint8(endpoint),
                data_buf,
                c_int(len(data)),
                byref(transferred),
                c_int(5000) # 5 second timeout
            )
            
            if res < 0:
                return {"success": False, "error": f"Bulk transfer failed with error code: {res}"}
            
            return {
                "success": True,
                "bytes_transferred": transferred.value,
                "total_bytes": len(data)
            }
        finally:
            libusb.libusb_release_interface(handle, 0)
    finally:
        if handle:
            libusb.libusb_close(handle)
        libusb.libusb_exit(None)

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing command argument: status | print"}))
        sys.exit(1)
        
    cmd = sys.argv[1].lower()
    
    if cmd == 'status':
        status = check_printer_status()
        print(json.dumps(status))
    elif cmd == 'print':
        # Read payload from stdin
        raw_data = sys.stdin.buffer.read()
        if not raw_data:
            print(json.dumps({"success": False, "error": "No print data received on stdin"}))
            sys.exit(1)
        result = print_raw_escpos(raw_data)
        print(json.dumps(result))
    else:
        print(json.dumps({"error": f"Unknown command: {cmd}"}))
        sys.exit(1)

if __name__ == '__main__':
    main()
