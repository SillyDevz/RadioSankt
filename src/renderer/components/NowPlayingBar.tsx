import { useRef, useCallback } from 'react';
import { useStore, type Track } from '@/store';
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer';
import Tooltip from './Tooltip';

function playbackSource(track: Track): { label: string; tooltip: string; className: string } {
  if (track.uri?.startsWith('spotify:')) {
    return {
      label: 'Spotify',
      tooltip: 'Streaming from Spotify',
      className:
        'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold text-accent bg-accent/10',
    };
  }
  return {
    label: 'Local',
    tooltip: 'Playing a file from this computer (your library)',
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
  const currentTrack = useStore((s) => s.currentTrack);
  const isPlaying = useStore((s) => s.isPlaying);
  const volume = useStore((s) => s.volume);
  const position = useStore((s) => s.position);
  const duration = useStore((s) => s.duration);
  const setVolume = useStore((s) => s.setVolume);
  const isLive = useStore((s) => s.isLive);
  const automationStatus = useStore((s) => s.automationStatus);
  const automationTransport = automationStatus !== 'stopped';

  const { togglePlay, previousTrack, nextTrack, seek } = useSpotifyPlayer();
  const seekTrackRef = useRef<HTMLDivElement>(null);

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = seekTrackRef.current;
      if (!el || !duration) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      seek(pct * duration);
    },
    [duration, seek]
  );

  const onSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  };

  const onSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekFromClientX(e.clientX);
  };

  const onSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  if (!currentTrack) {
    return (
      <div className="flex h-16 w-full items-center justify-center border-t border-border bg-bg-surface">
        <span className="text-text-muted text-sm">No track playing</span>
      </div>
    );
  }

  const source = playbackSource(currentTrack);

  return (
    <div className="grid h-16 w-full grid-cols-[240px_minmax(0,1fr)_200px] items-center gap-x-4 bg-bg-surface border-t border-border px-4">
      {/* Left: Track info */}
      <div className="flex min-w-0 items-center gap-3">
        {currentTrack.albumArt ? (
          <img
            src={currentTrack.albumArt}
            alt={currentTrack.album || currentTrack.title}
            className="w-10 h-10 rounded object-cover shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded bg-bg-elevated shrink-0 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm text-text-primary truncate">{currentTrack.title}</div>
          <div className="text-xs text-text-secondary truncate">{currentTrack.artist}</div>
        </div>
        <Tooltip content={source.tooltip} placement="top">
          <span className={source.className}>{source.label}</span>
        </Tooltip>
      </div>

      {/* Center: stack under transport; Tooltip wrapper must be flex-1 on seek row or track collapses */}
      <div className="flex w-full min-w-0 justify-center">
        <div className="flex w-full max-w-[560px] flex-col items-center justify-center gap-1">
          {/* Transport controls */}
          <div className="flex items-center justify-center gap-3 shrink-0">
            <Tooltip
              content={automationTransport ? 'Previous automation step' : 'Previous track'}
              shortcut="Shift+P"
            >
              <button
                onClick={previousTrack}
                className="p-1.5 text-text-secondary hover:text-text-primary transition-colors"
                aria-label="Previous track"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
                </svg>
              </button>
            </Tooltip>

            <Tooltip content={isPlaying ? 'Pause' : 'Play'} shortcut="Space">
              <button
                onClick={togglePlay}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-text-primary text-bg-primary hover:scale-105 transition-transform"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6 3 20 12 6 21 6 3" />
                  </svg>
                )}
              </button>
            </Tooltip>

            <Tooltip
              content={automationTransport ? 'Next automation step' : 'Next track'}
              shortcut="Shift+N"
            >
              <button
                onClick={nextTrack}
                className="p-1.5 text-text-secondary hover:text-text-primary transition-colors"
                aria-label="Next track"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 6h2v12h-2zm-3.5 6L4 6v12z" />
                </svg>
              </button>
            </Tooltip>
          </div>

          {/* Seek bar */}
          <div className="flex w-full items-center gap-2 leading-none">
            <span className="shrink-0 text-[10px] text-text-muted tabular-nums w-9 text-right">
              {formatTime(position)}
            </span>
            <Tooltip
              content="Click or drag; far right goes to the end (last ~0.1s — Spotify limit)"
              placement="top"
              referenceClassName="min-w-0 flex-1 self-center"
            >
              <div
                ref={seekTrackRef}
                className="group relative flex w-full cursor-pointer items-center py-1.5 touch-none select-none"
                onPointerDown={onSeekPointerDown}
                onPointerMove={onSeekPointerMove}
                onPointerUp={onSeekPointerUp}
                onPointerCancel={onSeekPointerUp}
                role="slider"
                aria-label="Seek"
                aria-valuenow={position}
                aria-valuemin={0}
                aria-valuemax={duration}
              >
                <div className="relative h-1 w-full rounded-full bg-bg-elevated">
                  <div
                    className="relative h-full rounded-full bg-text-primary transition-colors group-hover:bg-accent"
                    style={{ width: `${progress}%` }}
                  >
                    <div className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-text-primary opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </div>
              </div>
            </Tooltip>
            <button
              type="button"
              className="shrink-0 w-9 cursor-pointer border-0 bg-transparent p-0 text-left text-[10px] tabular-nums text-text-muted hover:text-text-secondary"
              title="Double-click: jump near end (for testing transitions)"
              aria-label="Seek near end of track"
              onDoubleClick={() => duration > 0 && seek(duration)}
            >
              {formatTime(duration)}
            </button>
          </div>
        </div>
      </div>

      {/* Right: Volume + LIVE badge */}
      <div className="flex min-w-0 items-center justify-end gap-3 justify-self-end">
        {isLive && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-danger/15 border border-danger/30 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-danger animate-pulse-live" />
            <span className="text-[10px] font-bold text-danger tracking-wider">LIVE</span>
          </div>
        )}
        <Tooltip content="Master volume for Spotify playback" placement="top">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
              className="p-1 text-text-secondary hover:text-text-primary transition-colors"
              aria-label={volume > 0 ? 'Mute' : 'Unmute'}
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
              aria-label="Volume"
            />
          </div>
        </Tooltip>
      </div>
    </div>
  );
}
