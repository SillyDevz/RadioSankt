import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import type { AutomationStep } from '@/store';

export default function LoadPlaylistModal() {
  const { t, i18n } = useTranslation();
  const open = useStore((s) => s.loadPlaylistModalOpen);
  const setOpen = useStore((s) => s.setLoadPlaylistModalOpen);
  const savedPlaylists = useStore((s) => s.savedPlaylists);
  const setSavedPlaylists = useStore((s) => s.setSavedPlaylists);
  const setAutomationSteps = useStore((s) => s.setAutomationSteps);
  const setCurrentPlaylistId = useStore((s) => s.setCurrentPlaylistId);
  const setCurrentPlaylistName = useStore((s) => s.setCurrentPlaylistName);
  const setSelectedStepIndex = useStore((s) => s.setSelectedStepIndex);
  const addToast = useStore((s) => s.addToast);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      window.electronAPI.listPlaylists().then(setSavedPlaylists);
    }
  }, [open, setSavedPlaylists]);

  if (!open) return null;

  const handleLoad = async (id: number) => {
    try {
      const row = await window.electronAPI.loadPlaylist(id);
      if (!row) {
        addToast(t('automation.playlist.notFound', { defaultValue: 'Playlist not found' }), 'error');
        return;
      }
      const steps: AutomationStep[] = JSON.parse(row.steps);
      const jingleIds = new Set(useStore.getState().jingles.map((j) => j.id));
      const adIds = new Set(useStore.getState().ads.map((a) => a.id));
      const validSteps = steps.filter((s) => {
        if (s.type === 'jingle') return jingleIds.has(s.jingleId);
        if (s.type === 'ad') return adIds.has(s.adId);
        return true;
      });
      const { default: AutomationEngine } = await import('@/engine/AutomationEngine');
      AutomationEngine.getInstance().stop();
      setAutomationSteps(validSteps);
      setCurrentPlaylistId(row.id);
      setCurrentPlaylistName(row.name);
      setSelectedStepIndex(null);
      addToast(t('automation.playlist.loaded', { name: row.name, defaultValue: 'Loaded "{{name}}"' }), 'success');
      setOpen(false);
    } catch {
      addToast(t('automation.playlist.loadFailed', { defaultValue: 'Failed to load playlist' }), 'error');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await window.electronAPI.deletePlaylist(id);
      setSavedPlaylists(useStore.getState().savedPlaylists.filter((p) => p.id !== id));
      if (useStore.getState().currentPlaylistId === id) {
        useStore.setState({ currentPlaylistId: null, currentPlaylistName: null });
      }
      addToast(t('automation.playlist.deleted', { defaultValue: 'Set deleted' }), 'info');
    } catch {
      addToast(t('automation.playlist.deleteFailed', { defaultValue: 'Failed to delete set' }), 'error');
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const locale = i18n.language.startsWith('pt') ? 'pt-PT' : 'en-US';
      return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md bg-bg-surface border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">{t('automation.playlist.modalTitle', { defaultValue: 'Automation sets' })}</h2>
          <button onClick={() => setOpen(false)} className="text-text-muted hover:text-text-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {savedPlaylists.length === 0 && (
            <div className="py-8 text-center text-text-muted text-sm">
              {t('automation.playlist.noneYet', { defaultValue: 'No saved sets yet. Use "Save set" to store one.' })}
            </div>
          )}

          {savedPlaylists.map((playlist) => (
            <div
              key={playlist.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-bg-elevated transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate">{playlist.name}</div>
                <div className="text-xs text-text-muted">
                  {t('automation.playlist.stepsCount', { count: playlist.stepCount, defaultValue: '{{count}} steps' })} · {formatDate(playlist.updatedAt)}
                </div>
              </div>
              <button
                onClick={() => handleLoad(playlist.id)}
                className="px-3 py-1 bg-accent hover:bg-accent-hover text-bg-primary rounded text-xs font-medium transition-colors"
              >
                {t('automation.playlist.load', { defaultValue: 'Load' })}
              </button>
              <button
                onClick={() => handleDelete(playlist.id)}
                className="p-1 rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t('automation.playlist.deleteAria', { defaultValue: 'Delete playlist' })}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
