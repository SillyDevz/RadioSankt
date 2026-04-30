import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';

export default function SavePlaylistModal() {
  const open = useStore((s) => s.savePlaylistModalOpen);
  const setOpen = useStore((s) => s.setSavePlaylistModalOpen);
  const steps = useStore((s) => s.automationSteps);
  const currentPlaylistId = useStore((s) => s.currentPlaylistId);
  const currentPlaylistName = useStore((s) => s.currentPlaylistName);
  const setCurrentPlaylistId = useStore((s) => s.setCurrentPlaylistId);
  const setCurrentPlaylistName = useStore((s) => s.setCurrentPlaylistName);
  const addToast = useStore((s) => s.addToast);

  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setName(''); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  if (!open) return null;

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const playlistName = name.trim() || currentPlaylistName || t('automation.playlist.untitled', { defaultValue: 'Untitled Playlist' });
      const stepsJson = JSON.stringify(steps);

      if (currentPlaylistId) {
        await window.electronAPI.updatePlaylist(currentPlaylistId, playlistName, stepsJson);
        setCurrentPlaylistName(playlistName);
        addToast(t('automation.playlist.updated', { name: playlistName, defaultValue: 'Playlist "{{name}}" updated' }), 'success');
      } else {
        const row = await window.electronAPI.savePlaylist(playlistName, stepsJson);
        setCurrentPlaylistId(row.id);
        setCurrentPlaylistName(playlistName);
        addToast(t('automation.playlist.saved', { name: playlistName, defaultValue: 'Playlist "{{name}}" saved' }), 'success');
      }
      setName('');
      setOpen(false);
    } catch {
      addToast(t('automation.playlist.saveFailed', { defaultValue: 'Failed to save playlist' }), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { setOpen(false); setName(''); }}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-sm bg-bg-surface border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">
            {currentPlaylistId
              ? t('automation.playlist.updateSavedSet', { defaultValue: 'Update saved set' })
              : t('automation.playlist.saveAutomationSet', { defaultValue: 'Save automation set' })}
          </h2>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={currentPlaylistName || t('automation.playlist.namePlaceholder', { defaultValue: 'Playlist name' })}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          />
          <div className="text-xs text-text-muted">
            {t('automation.playlist.stepsCount', { count: steps.length, defaultValue: '{{count}} steps' })}
            {currentPlaylistId ? ` · ${t('automation.playlist.updateHint', { defaultValue: 'Load set restores the last saved version until you Update.' })}` : ''}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setOpen(false); setName(''); }}
              className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded text-xs transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded text-xs transition-colors disabled:opacity-50"
            >
              {currentPlaylistId
                ? t('automation.playlist.update', { defaultValue: 'Update' })
                : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
