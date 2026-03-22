import { useState } from 'react';
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

  const [name, setName] = useState('');

  if (!open) return null;

  const handleSave = async () => {
    const playlistName = name.trim() || currentPlaylistName || 'Untitled Playlist';
    const stepsJson = JSON.stringify(steps);

    try {
      if (currentPlaylistId) {
        await window.electronAPI.updatePlaylist(currentPlaylistId, playlistName, stepsJson);
        setCurrentPlaylistName(playlistName);
        addToast(`Playlist "${playlistName}" updated`, 'success');
      } else {
        const row = await window.electronAPI.savePlaylist(playlistName, stepsJson);
        setCurrentPlaylistId(row.id);
        setCurrentPlaylistName(playlistName);
        addToast(`Playlist "${playlistName}" saved`, 'success');
      }
      setName('');
      setOpen(false);
    } catch {
      addToast('Failed to save playlist', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-sm bg-bg-surface border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">
            {currentPlaylistId ? 'Update Playlist' : 'Save Playlist'}
          </h2>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={currentPlaylistName || 'Playlist name'}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          />
          <div className="text-xs text-text-muted">{steps.length} steps</div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setOpen(false); setName(''); }}
              className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded text-xs transition-colors"
            >
              {currentPlaylistId ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
