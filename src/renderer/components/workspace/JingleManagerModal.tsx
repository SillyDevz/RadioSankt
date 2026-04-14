import { useEffect, useState, useRef } from 'react';
import { useStore } from '@/store';
import AudioEngine from '@/engine/AudioEngine';
import Tooltip from '@/components/Tooltip';
import CoachMark from '@/components/CoachMark';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function JingleManagerModal({ 
  mode = 'manage',
  onSelect,
  onClose
}: { 
  mode?: 'manage' | 'assign';
  onSelect?: (jingle: { id: number; name: string; filePath: string; durationMs: number }) => void;
  onClose?: () => void;
} = {}) {
  const isGlobalOpen = useStore((s) => s.jingleManagerOpen);
  const setGlobalOpen = useStore((s) => s.setJingleManagerOpen);
  
  const isOpen = mode === 'assign' ? true : isGlobalOpen;
  
  const handleClose = () => {
    if (mode === 'assign' && onClose) {
      onClose();
    } else {
      setGlobalOpen(false);
    }
  };

  const jingles = useStore((s) => s.jingles);
  const setJingles = useStore((s) => s.setJingles);
  const addJingle = useStore((s) => s.addJingle);
  const removeJingle = useStore((s) => s.removeJingle);
  const updateJingleName = useStore((s) => s.updateJingleName);
  const playingJingleId = useStore((s) => s.playingJingleId);
  const setPlayingJingleId = useStore((s) => s.setPlayingJingleId);
  const addToast = useStore((s) => s.addToast);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.electronAPI.getJingles().then(setJingles);
  }, [setJingles]);

  useEffect(() => {
    if (editingId !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  const handleAddJingle = async () => {
    const result = await window.electronAPI.openFileDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac'] }],
    });

    if (result.canceled || !result.filePaths.length) return;

    for (const filePath of result.filePaths) {
      try {
        const buffer = await window.electronAPI.readFileBuffer(filePath);
        const ctx = new AudioContext();
        const audioBuffer = await ctx.decodeAudioData(buffer);
        const durationMs = Math.round(audioBuffer.duration * 1000);
        await ctx.close();

        const name = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
        const jingle = await window.electronAPI.saveJingle(name, filePath, durationMs);
        addJingle(jingle);
      } catch {
        addToast(`Failed to add jingle: ${filePath.split('/').pop()}`, 'error');
      }
    }
  };

  const handlePlay = async (jingle: JingleRecord) => {
    const engine = AudioEngine.getOrInit();
    engine.resumeContextIfNeeded();

    if (playingJingleId === jingle.id) {
      engine.stopJingle();
      setPlayingJingleId(null);
      return;
    }

    try {
      setPlayingJingleId(jingle.id);
      engine.onJingleEnded(() => setPlayingJingleId(null));
      await engine.playJingle(jingle.filePath);
    } catch {
      setPlayingJingleId(null);
      addToast('Failed to play jingle', 'error');
    }
  };

  const handleDelete = async (id: number) => {
    const engine = AudioEngine.get();
    if (playingJingleId === id && engine) {
      engine.stopJingle();
      setPlayingJingleId(null);
    }
    await window.electronAPI.deleteJingle(id);
    removeJingle(id);
  };

  const startRename = (jingle: JingleRecord) => {
    setEditingId(jingle.id);
    setEditName(jingle.name);
  };

  const commitRename = async () => {
    if (editingId === null) return;
    const trimmed = editName.trim();
    if (trimmed && trimmed !== jingles.find((j) => j.id === editingId)?.name) {
      await window.electronAPI.renameJingle(editingId, trimmed);
      updateJingleName(editingId, trimmed);
    }
    setEditingId(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-8" onClick={handleClose}>
      <div 
        className="flex flex-col w-full max-w-[800px] h-[80vh] bg-bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-bg-elevated/20">
          <h2 className="text-lg font-bold text-text-primary">
            {mode === 'assign' ? 'Assign Jingle' : 'Jingle Manager'}
          </h2>
          <div className="flex items-center gap-4">
            <Tooltip content="Add MP3 or WAV files to use as jingles between songs in your automation" placement="bottom">
              <button
                onClick={handleAddJingle}
                data-coachmark="jingles-add-btn"
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded-lg transition-colors text-sm flex items-center gap-2 shadow-sm"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add Jingle
              </button>
            </Tooltip>
            <button 
              onClick={handleClose}
              className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-elevated rounded-lg transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {jingles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 max-w-md mx-auto text-center opacity-80">
            <div className="w-16 h-16 rounded-full bg-bg-elevated flex items-center justify-center text-accent mb-2">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-text-primary">No jingles yet</h3>
            <p className="text-text-secondary text-sm">
              Jingles are short audio clips — station IDs, sound effects, or ads — that play between songs or on the Cart Wall.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {jingles.map((jingle) => {
              const isPlaying = playingJingleId === jingle.id;
              const isEditing = editingId === jingle.id;

              return (
                <div
                  key={jingle.id}
                  className={`relative bg-bg-elevated/30 border rounded-xl p-5 flex flex-col gap-4 transition-all group ${
                    isPlaying
                      ? 'border-accent shadow-md bg-accent/5'
                      : 'border-border hover:border-text-muted/40 hover:shadow-md hover:-translate-y-0.5 hover:bg-bg-elevated/60'
                  }`}
                >
                  <span className="absolute top-3 right-3 text-[10px] font-medium bg-bg-surface border border-border text-text-secondary px-2 py-0.5 rounded-full font-mono shadow-sm">
                    {formatDuration(jingle.durationMs)}
                  </span>

                  <div className="flex items-center justify-center h-12 mt-2">
                    <svg width="40" height="40" viewBox="0 0 32 32" fill="none" className={isPlaying ? 'text-accent animate-pulse' : 'text-text-muted/60 group-hover:text-accent/60 transition-colors'}>
                      <rect x="4" y="12" width="3" height="8" rx="1.5" fill="currentColor" opacity="0.6" />
                      <rect x="9" y="8" width="3" height="16" rx="1.5" fill="currentColor" opacity="0.8" />
                      <rect x="14" y="4" width="3" height="24" rx="1.5" fill="currentColor" />
                      <rect x="19" y="8" width="3" height="16" rx="1.5" fill="currentColor" opacity="0.8" />
                      <rect x="24" y="12" width="3" height="8" rx="1.5" fill="currentColor" opacity="0.6" />
                    </svg>
                  </div>

                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="text-sm font-medium text-text-primary bg-bg-surface border border-accent rounded-md px-3 py-1.5 text-center outline-none shadow-sm"
                    />
                  ) : (
                    <span
                      onDoubleClick={() => startRename(jingle)}
                      className="text-sm font-medium text-text-primary text-center truncate cursor-text"
                      title={jingle.name}
                    >
                      {jingle.name}
                    </span>
                  )}

                  <div className="flex items-center justify-center gap-3 pt-2 border-t border-border/50">
                    <Tooltip content={isPlaying ? 'Stop' : 'Play'} placement="bottom">
                      <button
                        onClick={() => handlePlay(jingle)}
                        className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors shadow-sm ${
                          isPlaying
                            ? 'bg-accent text-bg-primary'
                            : 'bg-bg-surface text-text-secondary hover:text-text-primary hover:scale-105'
                        }`}
                        aria-label={isPlaying ? 'Stop jingle' : 'Play jingle'}
                      >
                        {isPlaying ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="4" width="4" height="16" />
                            <rect x="14" y="4" width="4" height="16" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="6 3 20 12 6 21 6 3" />
                          </svg>
                        )}
                      </button>
                    </Tooltip>

                    {mode === 'assign' ? (
                      <button
                        onClick={() => onSelect?.(jingle)}
                        className="px-4 py-1.5 bg-accent text-white text-xs font-bold rounded-lg hover:bg-accent-hover transition-colors shadow-sm"
                      >
                        ASSIGN
                      </button>
                    ) : (
                      <Tooltip content="Delete" placement="bottom">
                        <button
                          onClick={() => handleDelete(jingle.id)}
                          className="w-10 h-10 flex items-center justify-center rounded-full bg-bg-surface text-text-muted hover:text-danger hover:bg-danger/10 transition-colors opacity-0 group-hover:opacity-100"
                          aria-label="Delete jingle"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

        <CoachMark
          id="jingles-add"
          targetSelector="[data-coachmark='jingles-add-btn']"
          text="Add jingles to play between songs in your automation"
          placement="top"
        />
      </div>
    </div>
  );
}
