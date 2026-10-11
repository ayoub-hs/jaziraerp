import React, { useState, useEffect, useRef } from 'react';
import { Database, Download, RefreshCw, Plus, CheckCircle2, AlertCircle, Clock, ShieldCheck, Upload, RotateCcw } from 'lucide-react';
import { formatDateTime } from '../../utils/formatters.js';

export interface BackupItem {
  filename: string;
  size_bytes: number;
  created_at: string;
}

export const BackupManager: React.FC = () => {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/backups');
      if (res.ok) {
        const data = await res.json();
        setBackups(data);
      }
    } catch (err: any) {
      console.warn('Failed to load backups:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setIsCreating(true);
      setStatusMsg(null);
      const res = await fetch('/api/backups', { method: 'POST' });
      if (res.ok) {
        const newBackup = await res.json();
        setStatusMsg({
          type: 'success',
          text: `Sauvegarde créée avec succès : ${newBackup.filename}`
        });
        await loadBackups();
      } else {
        const err = await res.json();
        setStatusMsg({ type: 'error', text: err.error || 'Échec de la création de la sauvegarde' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Erreur réseau lors de la sauvegarde' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleRestoreSnapshot = async (filename: string) => {
    if (!window.confirm(`Restaurer la base de données depuis l'instantané "${filename}" ? Les données actuelles seront remplacées.`)) {
      return;
    }

    try {
      setIsRestoring(true);
      setStatusMsg(null);
      const res = await fetch('/api/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });

      const data = await res.json();
      if (res.ok) {
        setStatusMsg({
          type: 'success',
          text: `Base de données restaurée avec succès depuis ${filename}. Actualisation en cours...`
        });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setStatusMsg({ type: 'error', text: data.error || 'Échec de la restauration de la sauvegarde' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Erreur réseau lors de la restauration' });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm(`Restaurer la base de données depuis le fichier téléversé "${file.name}" ? Les données actuelles seront remplacées.`)) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      setIsRestoring(true);
      setStatusMsg(null);

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = reader.result as string;
          const base64Data = result.split(',')[1] || result;

          const res = await fetch('/api/backups/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_data: base64Data, filename: file.name })
          });

          const data = await res.json();
          if (res.ok) {
            setStatusMsg({
              type: 'success',
              text: `Base de données restaurée avec succès depuis le fichier ${file.name}. Actualisation en cours...`
            });
            setTimeout(() => window.location.reload(), 1500);
          } else {
            setStatusMsg({ type: 'error', text: data.error || 'Échec de la restauration de la base depuis le fichier' });
          }
        } catch (innerErr: any) {
          setStatusMsg({ type: 'error', text: innerErr.message || 'Erreur lors du traitement du fichier téléversé' });
        } finally {
          setIsRestoring(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Erreur lors de la lecture du fichier' });
      setIsRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Header & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-black text-slate-900">Sauvegardes Automatiques Quotidiennes & Instantanés</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Instantanés complets de la base SQLite. Nettoyage automatique quotidien avec rétention de 30 jours.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".sqlite,.db"
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRestoring}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2 rounded-xl transition-colors border border-slate-300 disabled:opacity-50"
            title="Téléverser et restaurer un fichier de sauvegarde .sqlite"
          >
            <Upload className="w-4 h-4 text-slate-600" />
            {isRestoring ? 'Restauration...' : 'Restaurer depuis Fichier'}
          </button>

          <button
            type="button"
            onClick={loadBackups}
            disabled={loading}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors text-xs font-bold"
            title="Rafraîchir la liste"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={handleCreateBackup}
            disabled={isCreating}
            className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-sm transition-colors disabled:opacity-50"
          >
            {isCreating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Création de l'instantané...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Créer une Sauvegarde Maintenant
              </>
            )}
          </button>
        </div>
      </div>

      {/* Status Notice */}
      {statusMsg && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Snapshot List Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-280px)]">
        {loading && backups.length === 0 ? (
          <div className="p-8 text-center text-slate-600 text-xs">Chargement des instantanés de la base de données...</div>
        ) : backups.length === 0 ? (
          <div className="p-8 text-center text-slate-600 text-xs">
            Aucune sauvegarde trouvée. Cliquez sur « Créer une Sauvegarde Maintenant » pour générer un instantané immédiat.
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto flex-1">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-50 z-10 shadow-xs">
                <tr className="border-b border-slate-200 font-bold text-slate-700 uppercase text-pos-caption">
                  <th className="py-2.5 px-3">Fichier Instantané</th>
                  <th className="py-2.5 px-3">Taille</th>
                  <th className="py-2.5 px-3">Date & Heure de Création</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backups.map(item => (
                  <tr key={item.filename} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 font-mono font-bold text-slate-900 text-pos-body flex items-center gap-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      {item.filename}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-700 text-pos-body">{formatFileSize(item.size_bytes)}</td>
                    <td className="py-2 px-3 text-slate-700 text-pos-body flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {formatDateTime(item.created_at)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRestoreSnapshot(item.filename)}
                          disabled={isRestoring}
                          className="inline-flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-bold px-2.5 py-1 rounded-lg text-xs transition-colors disabled:opacity-50"
                          title="Restaurer cet instantané"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                          Restaurer
                        </button>
                        <a
                          href={`/api/backups/download/${encodeURIComponent(item.filename)}`}
                          download={item.filename}
                          className="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-1 rounded-lg text-xs transition-colors"
                          title="Télécharger le fichier SQLite"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-600" />
                          Télécharger
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
