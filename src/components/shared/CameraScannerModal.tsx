import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, Flashlight, AlertCircle } from 'lucide-react';
import { playBeep } from '../../utils/audio.js';
import { Capacitor } from '@capacitor/core';

interface CameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
  title?: string;
}

export const CameraScannerModal: React.FC<CameraScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
  title = 'Scan Product Barcode'
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const scanningActive = useRef(false);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    setError(null);
    try {
      // Native shell: WebView getUserMedia needs the runtime camera grant first.
      let native = false;
      try {
        native = Capacitor.isNativePlatform();
      } catch {
        native = false;
      }
      if (native) {
        const { Camera: CapCamera } = await import('@capacitor/camera');
        const perm = await CapCamera.requestPermissions({ permissions: ['camera'] });
        if (perm.camera !== 'granted') {
          setError('Camera permission denied. Allow camera access in system settings.');
          return;
        }
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }

      // Check for torch capability
      const track = mediaStream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.() as any;
      if (capabilities && 'torch' in capabilities) {
        setHasTorch(true);
      }

      // Start scan detection loop
      scanningActive.current = true;
      scanFrame();
    } catch (err: any) {
      console.warn('Camera access failed:', err);
      setError(err.message || 'Camera permission denied or camera not found.');
    }
  };

  const stopCamera = () => {
    scanningActive.current = false;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsTorchOn(false);
  };

  const toggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    try {
      const newTorch = !isTorchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: newTorch }]
      });
      setIsTorchOn(newTorch);
    } catch (err) {
      console.warn('Torch toggle failed:', err);
    }
  };

  const scanFrame = async () => {
    if (!scanningActive.current || !videoRef.current) return;

    if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
      // Modern browser native BarcodeDetector
      if ('BarcodeDetector' in window) {
        try {
          const detector = new (window as any).BarcodeDetector({
            formats: ['code_128', 'ean_13', 'ean_8', 'qr_code', 'upc_a']
          });
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes.length > 0 && scanningActive.current) {
            const raw = barcodes[0].rawValue;
            if (raw) {
              playBeep();
              onScan(raw);
              onClose();
              return;
            }
          }
        } catch {
          // Native detector error or frame drop
        }
      }
    }

    if (scanningActive.current) {
      requestAnimationFrame(scanFrame);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="bg-slate-900 text-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden flex flex-col border border-slate-800">
        {/* Top Header */}
        <div className="p-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-sm">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            {hasTorch && (
              <button
                type="button"
                onClick={toggleTorch}
                className={`p-2 rounded-xl border transition-colors ${
                  isTorchOn
                    ? 'bg-amber-400 text-slate-950 border-amber-300'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                }`}
              >
                <Flashlight className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Viewfinder Container */}
        <div className="relative bg-black aspect-[3/4] flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Aiming Reticle with animated red/green laser line */}
          <div className="absolute inset-x-8 inset-y-16 border-2 border-dashed border-emerald-400/80 rounded-2xl pointer-events-none flex flex-col justify-center items-center shadow-[0_0_15px_rgba(52,211,153,0.3)]">
            <div className="w-full h-0.5 bg-red-500 shadow-[0_0_8px_red] animate-pulse"></div>
            <span className="text-[10px] font-semibold text-white/70 bg-black/60 px-2 py-0.5 rounded mt-4">
              Align barcode within frame
            </span>
          </div>

          {error && (
            <div className="absolute inset-4 bg-slate-900/90 rounded-2xl p-4 flex flex-col items-center justify-center text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-rose-500" />
              <p className="text-xs font-semibold text-slate-300">{error}</p>
            </div>
          )}
        </div>

        {/* Bottom Bar & Manual Entry Fallback */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 space-y-2">
          <p className="text-[11px] text-slate-400 text-center">
            Hold steady over bottle or box barcode
          </p>
          <form
            onSubmit={e => {
              e.preventDefault();
              const inputEl = e.currentTarget.querySelector('input') as HTMLInputElement;
              const val = (inputEl?.value || manualCode).trim();
              if (val) {
                playBeep();
                onScan(val);
                onClose();
              }
            }}
            className="flex gap-1.5"
          >
            <input
              type="text"
              placeholder="Or enter barcode manually..."
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-1 rounded-xl transition-colors"
            >
              Scan
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
