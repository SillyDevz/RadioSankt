import { useRef, useCallback, useState } from 'react';
import { useStore, type Page, type Track } from '@/store';
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer';
import Tooltip from './Tooltip';
import { useTranslation } from 'react-i18next';

function MainNav() {
  const { t } = useTranslation();
  const currentPage = useStore((s) => s.currentPage);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  return (
    <div className="flex items-center gap-0.5 shrink-0" role="navigation" aria-label={t('nav.main')}>
      {(['studio', 'program', 'settings'] as const).map((page) => (
        <button
          key={page}
          type="button"
          onClick={() => setCurrentPage(page)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            currentPage === page
              ? 'bg-bg-elevated text-text-primary'
              : 'text-text-muted hover:text-text-secondary hover:bg-bg-elevated/60'
          }`}
        >
          {t(`nav.${page}`)}
        </button>
      ))}
    </div>
  );
}

function playbackSource(track: Track, t: (key: string) => string): { label: string; tooltip: string; className: string } {
  if (track.uri?.startsWith('spotify:')) {
    return {
      label: t('nowPlaying.source.spotify'),
      tooltip: t('nowPlaying.source.spotifyTooltip'),
      className:
        'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold text-accent bg-accent/10',
    };
  }
  return {
    label: t('nowPlaying.source.local'),
    tooltip: t('nowPlaying.source.localTooltip'),
    className:
      'shrink-0 rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-[9px] font-semibold text-text-secondary',
  };
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function NowPlayingBar() {
  const { t } = useTranslation();
  const currentTrack = useStore((s) => s.currentTrack);
  const isPlaying = useStore((s) => s.isPlaying);
  const volume = useStore((s) => s.volume);
  const position = useStore((s) => s.position);
  const duration = useStore((s) => s.duration);
  const setVolume = useStore((s) => s.setVolume);
  const isLive = useStore((s) => s.isLive);
  const automationStatus = useStore((s) => s.automationStatus);
  const hasAutomationSteps = useStore((s) => s.automationSteps.length > 0);
  const automationTransport = automationStatus !== 'stopped';
  const hasAutomationQueue = hasAutomationSteps && automationStatus !== 'stopped';
  /** Button shows a pause icon whenever Spotify (or the automation) is actively producing audio.
   *  - Automation on-air (playing) or paused-with-sound-still-playing → pause icon.
   *  - 'waitingAtPause' explicitly uses a play icon (Continue). */
  const transportShowsPause =
    automationStatus !== 'waitingAtPause' &&
    (hasAutomationQueue
      ? automationStatus === 'playing' || (automationStatus === 'paused' && isPlaying)
      : isPlaying);

  const { togglePlay, previousTrack, nextTrack, seek } = useSpotifyPlayer();
  const seekTrackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const prevVolumeRef = useRef(0.8);

  const guardedAction = useCallback(async (action: () => Promise<void>) => {
    if (transitioning) return;
    setTransitioning(true);
    try { await action(); }
    finally { setTransitioning(false); }
  }, [transitioning]);

  const displayPosition = dragPosition ?? position;
  const progress = duration > 0 ? (displayPosition / duration) * 100 : 0;

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = seekTrackRef.current;
      const currentDuration = useStore.getState().duration;
      if (!el || !currentDuration) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const pos = pct * currentDuration;
      if (isDragging.current) {
        setDragPosition(pos);
      } else {
        seek(pos);
      }
    },
    [seek]
  );

  const onSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    seekFromClientX(e.clientX);
  };

  const onSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekFromClientX(e.clientX);
  };

  const onSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (dragPosition != null) {
        seek(dragPosition);
      }
      isDragging.current = false;
      setDragPosition(null);
    }
  };

  const toggleMute = () => {
    if (volume > 0) {
      prevVolumeRef.current = volume;
      setVolume(0);
    } else {
      setVolume(prevVolumeRef.current);
    }
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  if (!currentTrack) {
    return (
      <div className="grid h-now-playing w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 border-t border-border bg-bg-surface px-6">
        <span className="text-sm font-semibold text-text-primary truncate">Radio Sankt</span>
        <span className="text-text-muted text-sm text-center justify-self-center">{t('nowPlaying.none')}</span>
        <div className="justify-self-end">
          <MainNav />
        </div>
      </div>
    );
  }

  const source = playbackSource(currentTrack, t);

  return (
    <div className="grid h-now-playing w-full grid-cols-[280px_minmax(0,1fr)_280px] items-stretch gap-x-4 bg-bg-surface border-t border-border px-6">
      {/* Left: Track info */}
      <div className="flex h-full min-h-0 min-w-0 items-center gap-4">
        {currentTrack.albumArt ? (
          <img
            src={currentTrack.albumArt}
            alt={currentTrack.album || currentTrack.title}
            className="w-14 h-14 rounded-md object-cover shadow-sm shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-md bg-bg-elevated shrink-0 flex items-center justify-center shadow-sm">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <div className="text-base font-semibold text-text-primary truncate leading-tight mb-0.5">{currentTrack.title}</div>
          <div className="text-sm text-text-secondary truncate">{currentTrack.artist}</div>
        </div>
        <Tooltip content={source.tooltip} placement="top">
          <span className={source.className}>{source.label}</span>
        </Tooltip>
      </div>

      {/* Center: seek pinned bottom; transport vertically centered in space above it */}
      <div className="flex h-full min-h-0 min-w-0 justify-center">
        <div className="flex h-full w-full max-w-[640px] flex-col items-center gap-1.5">
          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center pt-1.5">
            <div className="flex h-10 w-full max-w-[280px] translate-y-[7.5px] items-center justify-center gap-x-1">
              <div className="flex h-10 min-w-0 flex-1 items-center justify-end">
              <Tooltip
                content={automationTransport ? t('nowPlaying.prevStep') : t('nowPlaying.prevTrack')}
                referenceClassName="size-10 shrink-0"
              >
                <button
                  type="button"
                  onClick={() => guardedAction(previousTrack)}
                  disabled={transitioning}
                  className={`grid size-10 shrink-0 place-items-center rounded-full leading-none text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary${transitioning ? ' opacity-50 pointer-events-none' : ''}`}
                  aria-label={t('nowPlaying.prevTrack')}
                >
                  <svg className="block shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
                  </svg>
                </button>
              </Tooltip>
              </div>

              <div className="flex h-10 shrink-0 items-center justify-center">
              <Tooltip
                content={
                  automationStatus === 'waitingAtPause'
                    ? t('nowPlaying.continueAutomation')
                    : hasAutomationQueue
                      ? transportShowsPause
                        ? t('nowPlaying.pauseAutomation')
                        : t('nowPlaying.resumeAutomation')
                      : isPlaying
                        ? t('nowPlaying.pause')
                        : t('nowPlaying.play')
                }
                shortcut="Space"
                referenceClassName="size-10 shrink-0"
              >
                <button
                  type="button"
                  onClick={() => guardedAction(togglePlay)}
                  disabled={transitioning}
                  className={`grid size-10 shrink-0 place-items-center rounded-full leading-none bg-text-primary text-bg-primary shadow-sm transition-transform hover:scale-105${transitioning ? ' opacity-50 pointer-events-none' : ''}`}
                  aria-label={
                    automationStatus === 'waitingAtPause'
                      ? t('nowPlaying.continueAutomation')
                      : transportShowsPause
                        ? t('nowPlaying.pause')
                        : t('nowPlaying.play')
                  }
                >
                  {transportShowsPause ? (
                    <svg className="block shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg className="block shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <polygon points="6 3 20 12 6 21 6 3" />
                    </svg>
                  )}
                </button>
              </Tooltip>
              </div>

              <div className="flex h-10 min-w-0 flex-1 items-center justify-start">
              <Tooltip
                content={automationTransport ? t('nowPlaying.nextStep') : t('nowPlaying.nextTrack')}
                referenceClassName="size-10 shrink-0"
              >
                <button
                  type="button"
                  onClick={() => guardedAction(nextTrack)}
                  disabled={transitioning}
                  className={`grid size-10 shrink-0 place-items-center rounded-full leading-none text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary${transitioning ? ' opacity-50 pointer-events-none' : ''}`}
                  aria-label={t('nowPlaying.nextTrack')}
                >
                  <svg className="block shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M16 6h2v12h-2zm-3.5 6L4 6v12z" />
                  </svg>
                </button>
              </Tooltip>
              </div>
            </div>
          </div>

          {/* Seek bar */}
          <div className="flex w-full shrink-0 min-h-8 items-center gap-2.5 leading-none">
            <span className="flex h-8 shrink-0 items-center text-xs font-medium tabular-nums text-text-muted w-10 justify-end">
              {formatTime(displayPosition)}
            </span>
            <Tooltip
              content={t('nowPlaying.seekHelp')}
              placement="top"
              referenceClassName="min-w-0 flex-1 self-stretch"
            >
              <div
                ref={seekTrackRef}
                className="group relative flex h-8 w-full cursor-pointer items-center touch-none select-none"
                onPointerDown={onSeekPointerDown}
                onPointerMove={onSeekPointerMove}
                onPointerUp={onSeekPointerUp}
                onPointerCancel={onSeekPointerUp}
                role="slider"
                aria-label={t('nowPlaying.seek')}
                aria-valuenow={position}
                aria-valuemin={0}
                aria-valuemax={duration}
              >
                <div className="relative h-1.5 w-full rounded-full bg-bg-elevated overflow-hidden">
                  <div
                    className="relative h-full rounded-full bg-text-primary transition-colors group-hover:bg-accent"
                    style={{ width: `${progress}%` }}
                  >
                  </div>
                </div>
                <div 
                  className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -ml-1.5 rounded-full bg-text-primary opacity-0 transition-opacity group-hover:opacity-100 shadow-sm"
                  style={{ left: `${progress}%` }} 
                />
              </div>
            </Tooltip>
            <button
              type="button"
              className="flex h-8 w-10 shrink-0 cursor-pointer items-center justify-start border-0 bg-transparent p-0 text-left text-xs font-medium tabular-nums text-text-muted transition-colors hover:text-text-secondary"
              title={t('nowPlaying.seekNearEndTitle')}
              aria-label={t('nowPlaying.seekNearEnd')}
              onDoubleClick={() => duration > 0 && seek(duration)}
            >
              {formatTime(duration)}
            </button>
          </div>
        </div>
      </div>

      {/* Right: Volume, LIVE, then page nav */}
      <div className="flex h-full min-h-0 min-w-0 items-center justify-end gap-3 justify-self-end">
        <Tooltip content={t('nowPlaying.masterVolumeTooltip')} placement="top">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className="p-1 text-text-secondary hover:text-text-primary transition-colors"
              aria-label={volume > 0 ? t('nowPlaying.mute') : t('nowPlaying.unmute')}
            >
              {volume === 0 ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : volume < 0.5 ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={handleVolume}
              className="h-3 w-20 shrink-0 cursor-pointer appearance-none bg-transparent accent-text-primary
                [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-bg-elevated
                [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-text-primary [&::-webkit-slider-thumb]:transition-colors
                hover:[&::-webkit-slider-thumb]:bg-accent
                [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:border-0 [&::-moz-range-track]:bg-bg-elevated
                [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-text-primary"
              aria-label={t('nowPlaying.volume')}
            />
          </div>
        </Tooltip>
        {isLive && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-danger/15 border border-danger/30 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-danger animate-pulse-live" />
            <span className="text-[10px] font-bold text-danger tracking-wider">LIVE</span>
          </div>
        )}
        <MainNav />
      </div>
    </div>
  );
}
