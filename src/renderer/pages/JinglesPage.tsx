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

export default function JinglesPage() {
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

  // Load jingles on mount
  useEffect(() => {
    window.electronAPI.getJingles().then(setJingles);
  }, [setJingles]);

  // Focus input when editing
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
        // Read file and decode to get duration
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
    const engine = AudioEngine.get();
    if (!engine) {
      addToast('Audio engine not ready', 'warning');
      return;
    }

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

  // Empty state
  if (jingles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="bg-bg-surface border border-border rounded-lg p-8 flex flex-col items-center gap-4 max-w-md text-center">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          <h1 className="text-2xl font-bold text-text-primary">No jingles yet</h1>
          <p className="text-text-secondary text-sm">
            Jingles are short audio clips — station IDs, sound effects, or ads — that play between songs.
          </p>
          <Tooltip content="Add MP3 or WAV files to use as jingles between songs in your automation" placement="bottom">
            <button
              onClick={handleAddJingle}
              className="mt-2 px-4 py-2 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded transition-colors text-sm"
            >
              Add Jingle
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">Jingles</h1>
        <Tooltip content="Add MP3 or WAV files to use as jingles between songs in your automation" placement="left">
          <button
            onClick={handleAddJingle}
            data-coachmark="jingles-add-btn"
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded transition-colors text-sm flex items-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Jingle
          </button>
        </Tooltip>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {jingles.map((jingle) => {
          const isPlaying = playingJingleId === jingle.id;
          const isEditing = editingId === jingle.id;

          return (
            <div
              key={jingle.id}
              className={`relative bg-[#1a1a1a] border rounded-lg p-4 flex flex-col gap-3 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 group ${
                isPlaying
                  ? 'border-accent animate-pulse-border'
                  : 'border-border hover:border-text-muted/30'
              }`}
            >
              {/* Duration badge */}
              <span className="absolute top-2 right-2 text-[10px] bg-bg-elevated text-text-secondary px-1.5 py-0.5 rounded-full font-mono">
                {formatDuration(jingle.durationMs)}
              </span>

              {/* Waveform icon */}
              <div className="flex items-center justify-center h-10">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className={isPlaying ? 'text-accent' : 'text-text-muted'}>
                  <rect x="4" y="12" width="2" height="8" rx="1" fill="currentColor" opacity="0.6" />
                  <rect x="8" y="8" width="2" height="16" rx="1" fill="currentColor" opacity="0.8" />
                  <rect x="12" y="10" width="2" height="12" rx="1" fill="currentColor" />
                  <rect x="16" y="6" width="2" height="20" rx="1" fill="currentColor" />
                  <rect x="20" y="10" width="2" height="12" rx="1" fill="currentColor" />
                  <rect x="24" y="8" width="2" height="16" rx="1" fill="currentColor" opacity="0.8" />
                  <rect x="28" y="12" width="2" height="8" rx="1" fill="currentColor" opacity="0.6" />
                </svg>
              </div>

              {/* Name */}
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
                  className="text-sm text-text-primary bg-bg-elevated border border-border rounded px-2 py-1 text-center outline-none focus:border-accent"
                />
              ) : (
                <span
                  onDoubleClick={() => startRename(jingle)}
                  className="text-sm text-text-primary text-center truncate cursor-default"
                  title={jingle.name}
                >
                  {jingle.name}
                </span>
              )}

              {/* Actions */}
              <div className="flex items-center justify-center gap-2">
                <Tooltip content={isPlaying ? 'Stop' : 'Play'} placement="top">
                  <button
                    onClick={() => handlePlay(jingle)}
                    className={`p-2 rounded-full transition-colors ${
                      isPlaying
                        ? 'bg-accent text-bg-primary'
                        : 'bg-bg-elevated text-text-secondary hover:text-text-primary hover:bg-bg-elevated/80'
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

                <Tooltip content="Delete" placement="top">
                  <button
                    onClick={() => handleDelete(jingle.id)}
                    className="p-2 rounded-full bg-bg-elevated text-text-muted hover:text-danger hover:bg-danger/10 transition-colors opacity-0 group-hover:opacity-100"
                    aria-label="Delete jingle"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
      <CoachMark
        id="jingles-add"
        targetSelector="[data-coachmark='jingles-add-btn']"
        text="Add jingles to play between songs in your automation"
        placement="bottom"
      />
    </div>
  );
}
