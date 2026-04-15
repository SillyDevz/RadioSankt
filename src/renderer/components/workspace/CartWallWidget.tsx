import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store';
import type { QuickFireSlot } from '@/store';
import AudioEngine from '@/engine/AudioEngine';
import AutomationEngine from '@/engine/AutomationEngine';
import Tooltip from '@/components/Tooltip';

import JingleManagerModal from './JingleManagerModal';

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ── Context menu & Modals ──────────────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  slot: QuickFireSlot;
  onAssign: () => void;
  onRename: () => void;
  onChangeColor: () => void;
  onClear: () => void;
  onClose: () => void;
}

function ContextMenu({ x, y, slot, onAssign, onRename, onChangeColor, onClear, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-bg-elevated border border-border rounded-lg shadow-xl py-1.5 min-w-[160px] animate-fade-in"
      style={{ left: x, top: y }}
    >
      <button onClick={onAssign} className="w-full text-left px-3 py-2 text-sm font-medium text-text-primary hover:bg-bg-surface transition-colors">
        Assign jingle
      </button>
      {slot.jingleId && (
        <>
          <button onClick={onRename} className="w-full text-left px-3 py-2 text-sm font-medium text-text-primary hover:bg-bg-surface transition-colors">
            Rename
          </button>
          <button onClick={onChangeColor} className="w-full text-left px-3 py-2 text-sm font-medium text-text-primary hover:bg-bg-surface transition-colors">
            Change color
          </button>
          <div className="border-t border-border my-1.5" />
          <button onClick={onClear} className="w-full text-left px-3 py-2 text-sm font-medium text-danger hover:bg-bg-surface transition-colors">
            Clear
          </button>
        </>
      )}
    </div>
  );
}

const SLOT_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#3b82f6',
  '#8b5cf6', '#ec4899', '#06b6d4', '#2a2a2a', '#525252',
];

function ColorPicker({ onSelect, onClose }: { onSelect: (color: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute z-50 bg-bg-elevated border border-border rounded-xl p-2.5 shadow-xl animate-fade-in top-full left-1/2 -translate-x-1/2 mt-2">
      <div className="grid grid-cols-5 gap-2">
        {SLOT_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => { onSelect(c); onClose(); }}
            className="w-7 h-7 rounded-md border border-border hover:scale-110 transition-transform shadow-sm"
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Quick-fire slot button ──────────────────────────────────────────

interface SlotButtonProps {
  slot: QuickFireSlot;
  isPlaying: boolean;
  progress: number;
  onPlay: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onAssignClick: () => void;
}

function SlotButton({ slot, isPlaying, progress, onPlay, onContextMenu, onAssignClick }: SlotButtonProps) {
  const isEmpty = !slot.jingleId;

  return (
    <button
      onClick={isEmpty ? onAssignClick : onPlay}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e); }}
      className={`relative h-[122px] w-full overflow-hidden rounded-2xl border p-3 text-left transition-all duration-150 ${
        isEmpty
          ? 'border-border/70 bg-bg-primary hover:border-accent/40 hover:bg-bg-elevated/40'
          : 'shadow-sm hover:-translate-y-0.5 hover:shadow-md'
      } ${isPlaying ? 'scale-[0.99] ring-2 ring-accent/40' : ''}`}
      style={!isEmpty ? { 
        backgroundColor: isPlaying ? slot.color : `${slot.color}33`,
        borderColor: `${slot.color}99`,
      } : {}}
    >
      {isEmpty ? (
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-bg-elevated text-text-muted">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-text-secondary">Assign clip</span>
        </div>
      ) : (
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-start justify-between gap-2">
            <span className={`max-w-[80%] truncate text-sm font-semibold ${isPlaying ? 'text-white' : 'text-text-primary'}`}>
              {slot.name}
            </span>
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${isPlaying ? 'bg-white/20 text-white' : 'bg-bg-surface/80 text-text-secondary'}`}>
              {formatTime(slot.durationMs)}
            </span>
          </div>
          <span className={`text-xs font-medium ${isPlaying ? 'text-white/90' : 'text-text-secondary'}`}>
            {isPlaying ? 'Trigger again to replay' : 'Click to trigger'}
          </span>
        </div>
      )}

      {/* Progress bar */}
      {isPlaying && (
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/20">
          <div
            className="h-full bg-white transition-all duration-75"
            style={{ width: `${progress}%`, backgroundColor: 'white' }}
          />
        </div>
      )}
    </button>
  );
}

// ── Widget Component ────────────────────────────────────────────────

export default function CartWallWidget() {
  const isLive = useStore((s) => s.isLive);
  const setIsLive = useStore((s) => s.setIsLive);
  const quickFireSlots = useStore((s) => s.quickFireSlots);
  const setQuickFireSlots = useStore((s) => s.setQuickFireSlots);
  const updateQuickFireSlot = useStore((s) => s.updateQuickFireSlot);
  const clearQuickFireSlot = useStore((s) => s.clearQuickFireSlot);
  const automationStatus = useStore((s) => s.automationStatus);
  const addToast = useStore((s) => s.addToast);
  const fadeOutMs = useStore((s) => s.fadeOutMs);
  const fadeInMs = useStore((s) => s.fadeInMs);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; slotId: string } | null>(null);
  const [assigningSlotId, setAssigningSlotId] = useState<string | null>(null);
  const [renamingSlotId, setRenamingSlotId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [colorPickerSlotId, setColorPickerSlotId] = useState<string | null>(null);
  const [activeSlotIds, setActiveSlotIds] = useState<Set<string>>(() => new Set());
  const [slotProgress, setSlotProgress] = useState<Record<string, number>>({});
  const slotVoiceCountsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    window.electronAPI?.getFromStore('quickFireSlots').then((val) => {
      if (Array.isArray(val) && val.length === 12) {
        setQuickFireSlots(val as QuickFireSlot[]);
      }
    });
  }, [setQuickFireSlots]);

  const handleGoLive = useCallback(async () => {
    const engine = AutomationEngine.getInstance();
    const waitFade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    if (isLive) {
      window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));
      if (automationStatus === 'paused') {
        await engine.resume({ skipGainRecovery: true });
      } else {
        window.dispatchEvent(new CustomEvent('radio-sankt:spotify-resume-sdk'));
      }
      window.dispatchEvent(
        new CustomEvent('radio-sankt:live-audio', { detail: { goingLive: false, fadeMs: fadeInMs } }),
      );
      await waitFade(fadeInMs);
      setIsLive(false);
      addToast('Back to automation', 'info');
    } else {
      setIsLive(true);
      window.dispatchEvent(
        new CustomEvent('radio-sankt:live-audio', { detail: { goingLive: true, fadeMs: fadeOutMs } }),
      );
      await waitFade(fadeOutMs);
      if (automationStatus === 'playing') {
        await engine.pause({ skipFade: true });
      } else {
        window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause-sdk'));
      }
      addToast('You are LIVE', 'success');
    }
  }, [isLive, automationStatus, fadeInMs, fadeOutMs, setIsLive, addToast]);

  const handlePlaySlot = useCallback(async (slot: QuickFireSlot) => {
    if (!slot.jinglePath) return;

    const audio = AudioEngine.getOrInit();
    audio.resumeContextIfNeeded();
    audio.setVolume('B', 1);

    slotVoiceCountsRef.current[slot.id] = (slotVoiceCountsRef.current[slot.id] || 0) + 1;
    setActiveSlotIds((prev) => new Set(prev).add(slot.id));

    try {
      const { durationMs } = await audio.playJingleVoice(slot.jinglePath, () => {
        slotVoiceCountsRef.current[slot.id] = (slotVoiceCountsRef.current[slot.id] || 1) - 1;
        if (slotVoiceCountsRef.current[slot.id] <= 0) {
          delete slotVoiceCountsRef.current[slot.id];
          setActiveSlotIds((prev) => {
            const n = new Set(prev);
            n.delete(slot.id);
            return n;
          });
          setSlotProgress((p) => {
            const next = { ...p };
            delete next[slot.id];
            return next;
          });
        }
      });

      const start = Date.now();
      const run = () => {
        if (!slotVoiceCountsRef.current[slot.id]) return;
        const pct = Math.min(100, ((Date.now() - start) / durationMs) * 100);
        setSlotProgress((p) => ({ ...p, [slot.id]: pct }));
        if (pct < 100) requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    } catch {
      slotVoiceCountsRef.current[slot.id] = (slotVoiceCountsRef.current[slot.id] || 1) - 1;
      if (slotVoiceCountsRef.current[slot.id] <= 0) {
        delete slotVoiceCountsRef.current[slot.id];
        setActiveSlotIds((prev) => {
          const n = new Set(prev);
          n.delete(slot.id);
          return n;
        });
      }
      addToast('Failed to play cart jingle', 'error');
    }
  }, [addToast]);

  const handleContextMenu = (e: React.MouseEvent, slotId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, slotId });
  };

  const handleAssignJingle = (jingle: { id: number; name: string; filePath: string; durationMs: number }) => {
    if (!assigningSlotId) return;
    updateQuickFireSlot(assigningSlotId, {
      jingleId: jingle.id,
      jinglePath: jingle.filePath,
      name: jingle.name,
      durationMs: jingle.durationMs,
    });
    setAssigningSlotId(null);
  };

  const handleRenameSubmit = () => {
    if (renamingSlotId && renameValue.trim()) {
      updateQuickFireSlot(renamingSlotId, { name: renameValue.trim() });
    }
    setRenamingSlotId(null);
    setRenameValue('');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-sm">
      {/* Header with Go Live button */}
      <div className="shrink-0 border-b border-border bg-bg-elevated/20 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-text-primary">Soundboard</h2>
            <p className="text-xs text-text-muted">Quick-fire clips for live moments</p>
          </div>
        <Tooltip content={isLive ? 'End live mode and resume automation' : 'Pauses automation and fades out music so you can speak or play content live'} placement="bottom">
          <button
            onClick={handleGoLive}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold tracking-wide transition-all duration-200 ${
              isLive
                ? 'bg-accent text-white shadow-md hover:bg-accent-hover'
                : 'bg-danger text-white hover:bg-red-600'
            }`}
          >
            {isLive ? (
              <>
                <div className="h-2 w-2 rounded-full bg-white animate-pulse-live" />
                ON AIR
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10" />
                </svg>
                GO LIVE
              </>
            )}
          </button>
        </Tooltip>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
          {quickFireSlots.map((slot) => (
            <div key={slot.id} className="relative">
              <SlotButton
                slot={slot}
                isPlaying={activeSlotIds.has(slot.id)}
                progress={slotProgress[slot.id] ?? 0}
                onPlay={() => handlePlaySlot(slot)}
                onContextMenu={(e) => handleContextMenu(e, slot.id)}
                onAssignClick={() => setAssigningSlotId(slot.id)}
              />
              {colorPickerSlotId === slot.id && (
                <ColorPicker
                  onSelect={(color) => updateQuickFireSlot(slot.id, { color })}
                  onClose={() => setColorPickerSlotId(null)}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Rename inline input */}
      {renamingSlotId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setRenamingSlotId(null)}>
          <div className="bg-bg-surface border border-border rounded-2xl p-5 w-[320px] shadow-2xl animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <label className="text-sm font-medium text-text-primary mb-3 block">Rename slot</label>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenamingSlotId(null); }}
              className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent transition-colors"
              placeholder="Slot name"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setRenamingSlotId(null)} className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors">Cancel</button>
              <button onClick={handleRenameSubmit} className="px-4 py-2 bg-accent text-bg-primary text-sm font-bold rounded-xl hover:bg-accent-hover transition-colors shadow-sm">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          slot={quickFireSlots.find((s) => s.id === contextMenu.slotId) || quickFireSlots[0]}
          onAssign={() => { setAssigningSlotId(contextMenu.slotId); setContextMenu(null); }}
          onRename={() => {
            const slot = quickFireSlots.find((s) => s.id === contextMenu.slotId);
            setRenameValue(slot?.name || '');
            setRenamingSlotId(contextMenu.slotId);
            setContextMenu(null);
          }}
          onChangeColor={() => { setColorPickerSlotId(contextMenu.slotId); setContextMenu(null); }}
          onClear={() => { clearQuickFireSlot(contextMenu.slotId); setContextMenu(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Jingle assign modal */}
      {assigningSlotId && (
        <JingleManagerModal
          mode="assign"
          onSelect={handleAssignJingle}
          onClose={() => setAssigningSlotId(null)}
        />
      )}
    </div>
  );
}
