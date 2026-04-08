import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store';
import type { QuickFireSlot } from '@/store';
import AudioEngine from '@/engine/AudioEngine';
import AutomationEngine from '@/engine/AutomationEngine';
import Tooltip from '@/components/Tooltip';
import CoachMark from '@/components/CoachMark';

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ── Quick-fire context menu ─────────────────────────────────────────

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
      className="fixed z-50 bg-bg-elevated border border-border rounded-lg shadow-xl py-1 min-w-[160px] animate-fade-in"
      style={{ left: x, top: y }}
    >
      <button onClick={onAssign} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-surface transition-colors">
        Assign jingle
      </button>
      {slot.jingleId && (
        <>
          <button onClick={onRename} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-surface transition-colors">
            Rename
          </button>
          <button onClick={onChangeColor} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-surface transition-colors">
            Change color
          </button>
          <div className="border-t border-border my-1" />
          <button onClick={onClear} className="w-full text-left px-3 py-2 text-sm text-danger hover:bg-bg-surface transition-colors">
            Clear
          </button>
        </>
      )}
    </div>
  );
}

// ── Color picker popover ────────────────────────────────────────────

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
    <div ref={ref} className="absolute z-50 bg-bg-elevated border border-border rounded-lg p-2 shadow-xl animate-fade-in">
      <div className="grid grid-cols-5 gap-1.5">
        {SLOT_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => { onSelect(c); onClose(); }}
            className="w-6 h-6 rounded-md border border-border hover:scale-110 transition-transform"
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Jingle assign modal ─────────────────────────────────────────────

function JingleAssignModal({ onSelect, onClose }: { onSelect: (jingle: { id: number; name: string; filePath: string; durationMs: number }) => void; onClose: () => void }) {
  const jingles = useStore((s) => s.jingles);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-bg-surface border border-border rounded-xl w-[400px] max-h-[500px] flex flex-col animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">Assign Jingle</span>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {jingles.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">No jingles in library. Add some from the Jingles page first.</p>
          ) : (
            jingles.map((j) => (
              <button
                key={j.id}
                onClick={() => onSelect({ id: j.id, name: j.name, filePath: j.filePath, durationMs: j.durationMs })}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-elevated transition-colors flex items-center gap-3"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent shrink-0">
                  <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
                <div className="min-w-0">
                  <div className="text-sm text-text-primary truncate">{j.name}</div>
                  <div className="text-xs text-text-muted">{formatTime(j.durationMs)}</div>
                </div>
              </button>
            ))
          )}
        </div>
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
}

function SlotButton({ slot, isPlaying, progress, onPlay, onContextMenu }: SlotButtonProps) {
  const isEmpty = !slot.jingleId;

  return (
    <button
      onClick={isEmpty ? onContextMenu : onPlay}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e); }}
      className="relative w-full aspect-square rounded-xl border border-border hover:border-text-muted transition-all duration-150 flex flex-col items-center justify-center gap-1 overflow-hidden group"
      style={{ backgroundColor: isEmpty ? undefined : slot.color + '20', borderColor: isPlaying ? slot.color : undefined }}
    >
      {isEmpty ? (
        <>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-muted group-hover:text-text-secondary transition-colors">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="text-[10px] text-text-muted group-hover:text-text-secondary transition-colors">Assign</span>
        </>
      ) : (
        <>
          <span className="text-xs font-medium text-text-primary truncate px-2 max-w-full">{slot.name}</span>
          <span className="text-[10px] text-text-secondary">{formatTime(slot.durationMs)}</span>
        </>
      )}

      {/* Progress bar */}
      {isPlaying && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-bg-elevated">
          <div
            className="h-full transition-all duration-200"
            style={{ width: `${progress}%`, backgroundColor: slot.color }}
          />
        </div>
      )}

      {/* Color indicator dot */}
      {!isEmpty && (
        <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: slot.color }} />
      )}
    </button>
  );
}

// ── Main LivePage ───────────────────────────────────────────────────

export default function LivePage() {
  const isLive = useStore((s) => s.isLive);
  const setIsLive = useStore((s) => s.setIsLive);
  const quickFireSlots = useStore((s) => s.quickFireSlots);
  const setQuickFireSlots = useStore((s) => s.setQuickFireSlots);
  const updateQuickFireSlot = useStore((s) => s.updateQuickFireSlot);
  const clearQuickFireSlot = useStore((s) => s.clearQuickFireSlot);
  const playingSlotId = useStore((s) => s.playingSlotId);
  const setPlayingSlotId = useStore((s) => s.setPlayingSlotId);
  const playingSlotProgress = useStore((s) => s.playingSlotProgress);
  const setPlayingSlotProgress = useStore((s) => s.setPlayingSlotProgress);
  const automationStatus = useStore((s) => s.automationStatus);
  const automationSteps = useStore((s) => s.automationSteps);
  const currentStepIndex = useStore((s) => s.currentStepIndex);
  const stepTimeRemaining = useStore((s) => s.stepTimeRemaining);
  const addToast = useStore((s) => s.addToast);
  const hasCompletedOnboarding = useStore((s) => s.hasCompletedOnboarding);
  const fadeOutMs = useStore((s) => s.fadeOutMs);
  const fadeInMs = useStore((s) => s.fadeInMs);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; slotId: string } | null>(null);
  const [assigningSlotId, setAssigningSlotId] = useState<string | null>(null);
  const [renamingSlotId, setRenamingSlotId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [colorPickerSlotId, setColorPickerSlotId] = useState<string | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load quick-fire slots from electron-store on mount
  useEffect(() => {
    window.electronAPI?.getFromStore('quickFireSlots').then((val) => {
      if (Array.isArray(val) && val.length === 12) {
        setQuickFireSlots(val as QuickFireSlot[]);
      }
    });
  }, [setQuickFireSlots]);

  // Clean up progress interval
  useEffect(() => {
    return () => {
      if (progressRef.current) clearInterval(progressRef.current);
    };
  }, []);

  const handleGoLive = useCallback(async () => {
    const audio = AudioEngine.get();
    if (!audio) return;

    if (isLive) {
      // End live — fade music back in, resume automation
      await audio.fadeIn('A', fadeInMs);
      const engine = AutomationEngine.getInstance();
      if (automationStatus === 'paused') {
        engine.resume();
      }
      setIsLive(false);
      addToast('Back to automation', 'info');
    } else {
      // Go live — fade out automation music
      await audio.fadeOut('A', fadeOutMs);
      const engine = AutomationEngine.getInstance();
      if (automationStatus === 'playing') {
        engine.pause();
      }
      setIsLive(true);
      addToast('You are LIVE', 'success');
    }
  }, [isLive, automationStatus, fadeInMs, fadeOutMs, setIsLive, addToast]);

  // Listen for keyboard shortcut toggle-live event
  useEffect(() => {
    const handler = () => { handleGoLive(); };
    window.addEventListener('radio-sankt:toggle-live', handler);
    return () => window.removeEventListener('radio-sankt:toggle-live', handler);
  }, [handleGoLive]);

  const handlePlaySlot = useCallback(async (slot: QuickFireSlot) => {
    if (!slot.jinglePath) return;
    const audio = AudioEngine.get();
    if (!audio) return;

    // Stop any currently playing slot jingle
    audio.stopJingle();
    if (progressRef.current) clearInterval(progressRef.current);

    setPlayingSlotId(slot.id);
    setPlayingSlotProgress(0);

    try {
      // Short fade in
      audio.setVolume('B', 0);
      await audio.playJingle(slot.jinglePath);
      await audio.fadeIn('B', 200);
    } catch {
      setPlayingSlotId(null);
      setPlayingSlotProgress(0);
      return;
    }

    // Track progress
    const startTime = Date.now();
    progressRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min((elapsed / slot.durationMs) * 100, 100);
      setPlayingSlotProgress(pct);
      if (pct >= 100) {
        if (progressRef.current) clearInterval(progressRef.current);
        setPlayingSlotId(null);
        setPlayingSlotProgress(0);
      }
    }, 50);

    audio.onJingleEnded(() => {
      if (progressRef.current) clearInterval(progressRef.current);
      setPlayingSlotId(null);
      setPlayingSlotProgress(0);
    });
  }, [setPlayingSlotId, setPlayingSlotProgress]);

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

  // Next 3 upcoming steps for the mini playlist
  const upcomingSteps = automationSteps.slice(currentStepIndex, currentStepIndex + 3);

  return (
    <div className="flex gap-6 h-full animate-page-enter">
      {/* Left column — Automation status */}
      <div className="w-[300px] shrink-0 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-text-primary">Automation</h2>

        {/* Status card */}
        <div className="bg-bg-surface border border-border rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${
              automationStatus === 'playing' ? 'bg-accent' :
              automationStatus === 'paused' || automationStatus === 'waitingAtPause' ? 'bg-warning' :
              'bg-text-muted'
            }`} />
            <span className="text-sm font-medium text-text-primary capitalize">
              {automationStatus === 'waitingAtPause' ? 'Waiting at pause' : automationStatus}
            </span>
            {stepTimeRemaining > 0 && automationStatus === 'playing' && (
              <span className="ml-auto text-xs text-text-muted tabular-nums">{formatTime(stepTimeRemaining)}</span>
            )}
          </div>

          {/* Mini playlist — next 3 steps */}
          {upcomingSteps.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-text-muted uppercase tracking-wider">Up next</span>
              {upcomingSteps.map((step, i) => (
                <div
                  key={step.id}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs ${
                    i === 0 ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary'
                  }`}
                >
                  <span className="w-4 text-text-muted">{currentStepIndex + i + 1}</span>
                  {(step.type === 'track' || step.type === 'playlist') && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-accent"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                  )}
                  {step.type === 'jingle' && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-warning"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /></svg>
                  )}
                  {step.type === 'pause' && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-muted"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                  )}
                  <span className="truncate">{'name' in step ? step.name : step.type === 'pause' ? step.label : ''}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">No steps in automation playlist</p>
          )}

          {/* Resume button */}
          {(automationStatus === 'paused' || automationStatus === 'waitingAtPause') && (
            <button
              onClick={() => {
                const engine = AutomationEngine.getInstance();
                engine.resume();
                if (isLive) {
                  const audio = AudioEngine.get();
                  audio?.fadeIn('A', fadeInMs);
                  setIsLive(false);
                }
              }}
              className="mt-1 px-4 py-2 bg-accent text-white font-medium rounded-lg text-sm hover:bg-accent-hover transition-colors"
            >
              Resume Automation
            </button>
          )}
        </div>
      </div>

      {/* Right column — Live controls */}
      <div className="flex-1 flex flex-col gap-6">
        {/* GO LIVE button */}
        <div className="flex items-center gap-4">
          <Tooltip content={isLive ? 'End live mode and resume automation' : 'Pauses automation and fades out music so you can speak or play content live'} placement="bottom">
            <button
              data-coachmark="go-live-btn"
              onClick={handleGoLive}
              className={`px-8 py-4 font-bold text-lg rounded-xl transition-all duration-200 min-w-[200px] ${
                isLive
                  ? 'bg-accent hover:bg-accent-hover text-white'
                  : 'bg-danger hover:bg-red-600 text-white'
              }`}
            >
              {isLive ? '⏹ END LIVE' : '🔴 GO LIVE'}
            </button>
          </Tooltip>

          {isLive && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-danger animate-pulse-live" />
              <span className="text-sm font-bold text-danger tracking-wider">ON AIR</span>
            </div>
          )}
        </div>

        {/* Quick-fire jingle grid */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-text-primary">Quick-fire Jingles</h2>
            <Tooltip content="Quick-fire buttons for instant jingle playback during your live segments" placement="right">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted cursor-help">
                <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />
              </svg>
            </Tooltip>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {quickFireSlots.map((slot) => (
              <div key={slot.id} className="relative">
                <SlotButton
                  slot={slot}
                  isPlaying={playingSlotId === slot.id}
                  progress={playingSlotId === slot.id ? playingSlotProgress : 0}
                  onPlay={() => handlePlaySlot(slot)}
                  onContextMenu={(e) => handleContextMenu(e, slot.id)}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setRenamingSlotId(null)}>
            <div className="bg-bg-surface border border-border rounded-xl p-4 w-[300px] animate-slide-up" onClick={(e) => e.stopPropagation()}>
              <label className="text-sm text-text-secondary mb-2 block">Rename slot</label>
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenamingSlotId(null); }}
                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent transition-colors"
                placeholder="Slot name"
              />
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => setRenamingSlotId(null)} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">Cancel</button>
                <button onClick={handleRenameSubmit} className="px-3 py-1.5 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors">Save</button>
              </div>
            </div>
          </div>
        )}
      </div>

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
        <JingleAssignModal
          onSelect={handleAssignJingle}
          onClose={() => setAssigningSlotId(null)}
        />
      )}

      {/* Coach mark */}
      {hasCompletedOnboarding && (
        <CoachMark
          id="live-golive"
          targetSelector="[data-coachmark='go-live-btn']"
          text="Click this to pause automation and take over the microphone"
          placement="bottom"
        />
      )}
    </div>
  );
}
