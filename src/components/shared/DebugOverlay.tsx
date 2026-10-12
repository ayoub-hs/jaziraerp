import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export const DebugOverlay: React.FC = () => {
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('debug') === '1';
  });

  const [metrics, setMetrics] = useState({
    innerHeight: 0,
    scrollHeight: 0,
    visualViewportHeight: 0,
    sat: '0px',
    sab: '0px'
  });

  useEffect(() => {
    if (!visible) return;

    const updateMetrics = () => {
      const doc = document.documentElement;
      const computed = getComputedStyle(doc);
      setMetrics({
        innerHeight: window.innerHeight,
        scrollHeight: doc.scrollHeight,
        visualViewportHeight: window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight,
        sat: computed.getPropertyValue('--sat').trim() || '0px',
        sab: computed.getPropertyValue('--sab').trim() || '0px'
      });
    };

    updateMetrics();
    window.addEventListener('resize', updateMetrics);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateMetrics);
    }
    const interval = setInterval(updateMetrics, 500);

    return () => {
      window.removeEventListener('resize', updateMetrics);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateMetrics);
      }
      clearInterval(interval);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed top-16 left-2 z-50 bg-slate-950/90 text-emerald-400 border border-slate-700/80 rounded-xl p-2.5 shadow-2xl backdrop-blur-md font-mono text-[11px] leading-tight select-text pointer-events-auto"
      style={{ maxWidth: '240px' }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1 mb-1.5 text-slate-300 font-bold">
        <span>Debug Viewport</span>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="text-slate-400 hover:text-white p-0.5 rounded"
          title="Fermer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-0.5 text-slate-300">
        <div>innerH: <span className="font-bold text-white">{metrics.innerHeight}px</span></div>
        <div>scrollH: <span className="font-bold text-white">{metrics.scrollHeight}px</span></div>
        <div>vvH: <span className="font-bold text-white">{metrics.visualViewportHeight}px</span></div>
        <div>--sat: <span className="font-bold text-emerald-400">{metrics.sat}</span></div>
        <div>--sab: <span className="font-bold text-emerald-400">{metrics.sab}</span></div>
      </div>
    </div>
  );
};
