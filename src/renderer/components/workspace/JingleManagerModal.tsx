import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import AudioEngine from '@/engine/AudioEngine';
import Tooltip from '@/components/Tooltip';
import CoachMark from '@/components/CoachMark';
import i18n from '@/i18n';
import { basename } from '@/utils/path';

type LibraryKind = 'jingles' | 'ads';
type AudioAsset = { id: number; name: string; filePath: string; durationMs: number };

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export default function JingleManagerModal({
  mode = 'manage',
  onSelect,
  onClose,
}: {
  mode?: 'manage' | 'assign';
  onSelect?: (jingle: AudioAsset) => void;
  onClose?: () => void;
} = {}) {
  const { t } = useTranslation();
  const isGlobalOpen = useStore((s) => s.jingleManagerOpen);
  const setGlobalOpen = useStore((s) => s.setJingleManagerOpen);
  const jingles = useStore((s) => s.jingles);
  const ads = useStore((s) => s.ads);
  const setJingles = useStore((s) => s.setJingles);
  const setAds = useStore((s) => s.setAds);
  const addJingle = useStore((s) => s.addJingle);
  const addAd = useStore((s) => s.addAd);
  const removeJingle = useStore((s) => s.removeJingle);
  const removeAd = useStore((s) => s.removeAd);
  const updateJingleName = useStore((s) => s.updateJingleName);
  const updateAdName = useStore((s) => s.updateAdName);
  const playingJingleId = useStore((s) => s.playingJingleId);
  const setPlayingJingleId = useStore((s) => s.setPlayingJingleId);
  const addToast = useStore((s) => s.addToast);
  const [kind, setKind] = useState<LibraryKind>('jingles');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const isOpen = mode === 'assign' ? true : isGlobalOpen;
  const shownKind = mode === 'assign' ? 'jingles' : kind;
  const assets = shownKind === 'ads' ? ads : jingles;

  useEffect(() => {
    /** Before the cross-platform basename fix, Windows installs saved full file paths
     *  into the jingle/ad `name` column. Rewrite those to a friendly name on load. */
    const looksLikePath = (n: string) => /[\\/]/.test(n);
    const cleanup = (n: string) => basename(n).replace(/\.[^.]+$/, '') || n;

    window.electronAPI.getJingles().then(async (rows) => {
      const stale = rows.filter((r) => looksLikePath(r.name));
      for (const r of stale) {
        const fixed = cleanup(r.name);
        if (fixed && fixed !== r.name) {
          try {
            await window.electronAPI.renameJingle(r.id, fixed);
            r.name = fixed;
          } catch {
            /* ignore; UI will display the raw name until next try */
          }
        }
      }
      setJingles(rows);
    });

    window.electronAPI.getAds().then(async (rows) => {
      const stale = rows.filter((r) => looksLikePath(r.name));
      for (const r of stale) {
        const fixed = cleanup(r.name);
        if (fixed && fixed !== r.name) {
          try {
            await window.electronAPI.renameAd(r.id, fixed);
            r.name = fixed;
          } catch {
            /* ignore */
          }
        }
      }
      setAds(rows);
    });
  }, [setAds, setJingles]);

  useEffect(() => {
    if (editingId !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  const handleClose = () => (mode === 'assign' && onClose ? onClose() : setGlobalOpen(false));

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  const handleAddAsset = async () => {
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
        await ctx.close();
        const durationMs = Math.round(audioBuffer.duration * 1000);
        const name = basename(filePath).replace(/\.[^.]+$/, '') || 'Untitled';
        if (shownKind === 'ads') addAd(await window.electronAPI.saveAd(name, filePath, durationMs));
        else addJingle(await window.electronAPI.saveJingle(name, filePath, durationMs));
      } catch {
        addToast(`Failed to add ${shownKind === 'ads' ? 'ad' : 'jingle'}: ${basename(filePath)}`, 'error');
      }
    }
  };

  const handlePlay = async (asset: AudioAsset) => {
    const engine = AudioEngine.getOrInit();
    engine.resumeContextIfNeeded();
    if (playingJingleId === asset.id) {
      engine.stopJingle();
      setPlayingJingleId(null);
      return;
    }
    try {
      setPlayingJingleId(asset.id);
      await engine.playJingle(asset.filePath);
      engine.onJingleEnded(() => setPlayingJingleId(null));
    } catch {
      setPlayingJingleId(null);
      addToast(`Failed to play ${shownKind === 'ads' ? 'ad' : 'jingle'}`, 'error');
    }
  };

  const handleDelete = async (id: number) => {
    const engine = AudioEngine.get();
    if (playingJingleId === id && engine) {
      engine.stopJingle();
      setPlayingJingleId(null);
    }
    if (shownKind === 'ads') {
      await window.electronAPI.deleteAd(id);
      removeAd(id);
    } else {
      await window.electronAPI.deleteJingle(id);
      removeJingle(id);
    }

    // Remove from automation steps
    const { automationSteps } = useStore.getState();
    useStore.getState().setAutomationSteps(
      automationSteps.filter((s) =>
        !(s.type === 'jingle' && s.jingleId === id) &&
        !(s.type === 'ad' && s.adId === id)
      )
    );

    // Clear matching cart wall slots
    const { quickFireSlots, clearQuickFireSlot } = useStore.getState();
    quickFireSlots.forEach((slot) => {
      if (slot.jingleId === id) clearQuickFireSlot(slot.id);
    });

    // Scrub from break rules
    const { breakRules } = useStore.getState();
    breakRules.forEach((rule) => {
      if (shownKind === 'jingles' && rule.selectedJingleIds.includes(id)) {
        useStore.getState().updateBreakRule(rule.id, { selectedJingleIds: rule.selectedJingleIds.filter((x) => x !== id) });
      }
      if (shownKind === 'ads' && rule.selectedAdIds?.includes(id)) {
        useStore.getState().updateBreakRule(rule.id, { selectedAdIds: rule.selectedAdIds.filter((x) => x !== id) });
      }
    });
  };

  const commitRename = async () => {
    if (editingId === null) return;
    const trimmed = editName.trim();
    const currentName = assets.find((a) => a.id === editingId)?.name;
    if (trimmed && trimmed !== currentName) {
      if (shownKind === 'ads') {
        await window.electronAPI.renameAd(editingId, trimmed);
        updateAdName(editingId, trimmed);
      } else {
        await window.electronAPI.renameJingle(editingId, trimmed);
        updateJingleName(editingId, trimmed);
      }
    }
    setEditingId(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-8" onClick={handleClose}>
      <div className="flex flex-col w-full max-w-[800px] h-[80vh] bg-bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-bg-elevated/20">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-text-primary">
              {mode === 'assign'
                ? t('workspace.jingles.assignSoundboardClip', { defaultValue: 'Assign Soundboard Clip' })
                : t('workspace.jingles.libraryTitle', { defaultValue: 'Soundboard Library' })}
            </h2>
            {mode !== 'assign' && (
              <div className="flex rounded-lg bg-bg-elevated p-1">
                <button type="button" onClick={() => setKind('jingles')} className={`px-3 py-1 text-xs rounded ${shownKind === 'jingles' ? 'bg-bg-surface text-text-primary' : 'text-text-muted'}`}>{t('workspace.search.jinglesTab', { defaultValue: 'Jingles' })}</button>
                <button type="button" onClick={() => setKind('ads')} className={`px-3 py-1 text-xs rounded ${shownKind === 'ads' ? 'bg-bg-surface text-text-primary' : 'text-text-muted'}`}>{t('workspace.search.adsTab', { defaultValue: 'Ads' })}</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Tooltip content={t('workspace.jingles.addLocalFiles', { kind: shownKind, defaultValue: 'Add local files to your {{kind}} library' })} placement="bottom">
              <button onClick={handleAddAsset} data-coachmark="jingles-add-btn" className="px-4 py-2 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded-lg transition-colors text-sm flex items-center gap-2 shadow-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                {shownKind === 'ads'
                  ? t('workspace.jingles.addAd', { defaultValue: 'Add Ad' })
                  : t('workspace.jingles.addJingle', { defaultValue: 'Add Jingle' })}
              </button>
            </Tooltip>
            <button onClick={handleClose} className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-elevated rounded-lg transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 max-w-md mx-auto text-center opacity-80">
              <h3 className="text-lg font-bold text-text-primary">{t('workspace.jingles.noneYet', { kind: shownKind, defaultValue: 'No {{kind}} yet' })}</h3>
              <p className="text-text-secondary text-sm">
                {shownKind === 'ads'
                  ? t('workspace.jingles.adsHelp', { defaultValue: 'Ads are used by automation break rules.' })
                  : t('workspace.jingles.jinglesHelp', { defaultValue: 'Jingles can be used in automation and live soundboard slots.' })}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {assets.map((asset) => {
                const isPlaying = playingJingleId === asset.id;
                const isEditing = editingId === asset.id;
                return (
                  <div key={asset.id} className={`relative bg-bg-elevated/30 border rounded-xl p-5 flex flex-col gap-4 transition-all group ${isPlaying ? 'border-accent shadow-md bg-accent/5' : 'border-border hover:border-text-muted/40 hover:shadow-md hover:-translate-y-0.5 hover:bg-bg-elevated/60'}`}>
                    <span className="absolute top-3 right-3 text-[10px] font-medium bg-bg-surface border border-border text-text-secondary px-2 py-0.5 rounded-full font-mono shadow-sm">{formatDuration(asset.durationMs)}</span>
                    {isEditing ? (
                      <input ref={editInputRef} value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }} className="mt-8 text-sm font-medium text-text-primary bg-bg-surface border border-accent rounded-md px-3 py-1.5 text-center outline-none shadow-sm" />
                    ) : (
                      <span onDoubleClick={() => { setEditingId(asset.id); setEditName(asset.name); }} className="mt-8 text-sm font-medium text-text-primary text-center truncate cursor-text" title={asset.name}>{asset.name}</span>
                    )}
                    <div className="flex items-center justify-center gap-3 pt-2 border-t border-border/50">
                      <Tooltip content={isPlaying ? t('automation.queue.stop', { defaultValue: 'Stop' }) : t('nowPlaying.play', { defaultValue: 'Play' })} placement="bottom">
                        <button onClick={() => handlePlay(asset)} className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors shadow-sm ${isPlaying ? 'bg-accent text-bg-primary' : 'bg-bg-surface text-text-secondary hover:text-text-primary hover:scale-105'}`} aria-label={isPlaying ? 'Stop clip' : 'Play clip'}>
                          {isPlaying ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3" /></svg>}
                        </button>
                      </Tooltip>
                      {mode === 'assign' ? (
                        <button onClick={() => onSelect?.(asset)} className="px-4 py-1.5 bg-accent text-white text-xs font-bold rounded-lg hover:bg-accent-hover transition-colors shadow-sm">{t('workspace.jingles.assign', { defaultValue: 'ASSIGN' })}</button>
                      ) : (
                        <Tooltip content={t('common.delete')} placement="bottom">
                          <button onClick={() => handleDelete(asset.id)} className="w-10 h-10 flex items-center justify-center rounded-full bg-bg-surface text-text-muted hover:text-danger hover:bg-danger/10 transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={t('workspace.jingles.deleteClip', { defaultValue: 'Delete clip' })}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
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
        <CoachMark id="jingles-add" targetSelector="[data-coachmark='jingles-add-btn']" text="Add jingles and ads for automation breaks and live use" placement="top" />
      </div>
    </div>
  );
}
