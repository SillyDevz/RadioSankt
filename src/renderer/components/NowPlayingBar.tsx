import { useStore } from '@/store';
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer';
import Tooltip from './Tooltip';
import VUMeter from './VUMeter';

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
  const connected = useStore((s) => s.connected);
  const isLive = useStore((s) => s.isLive);

  const { togglePlay, previousTrack, nextTrack, seek } = useSpotifyPlayer();

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    seek(Math.floor(pct * duration));
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  if (!currentTrack) {
    return (
      <div className="h-[64px] w-full bg-bg-surface border-t border-border flex items-center justify-center">
        <span className="text-text-muted text-sm">No track playing</span>
      </div>
    );
  }

  return (
    <div className="h-[64px] w-full bg-bg-surface border-t border-border flex items-center px-4 gap-4">
      {/* Left: Track info */}
      <div className="flex items-center gap-3 w-[240px] shrink-0">
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
        {connected && (
          <Tooltip content="Playing from Spotify" placement="top">
            <span className="text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded shrink-0">
              SP
            </span>
          </Tooltip>
        )}
      </div>

      {/* Center: Controls + seek */}
      <div className="flex-1 flex flex-col items-center gap-1 max-w-[600px] mx-auto">
        {/* Transport controls */}
        <div className="flex items-center gap-3">
          <Tooltip content="Previous track" shortcut="Shift+P">
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

          <Tooltip content="Next track" shortcut="Shift+N">
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
        <div className="w-full flex items-center gap-2">
          <span className="text-[10px] text-text-muted tabular-nums w-8 text-right">
            {formatTime(position)}
          </span>
          <Tooltip content="Click anywhere to jump to that position in the track" placement="top">
            <div
              className="flex-1 h-1 bg-bg-elevated rounded-full cursor-pointer group relative"
              onClick={handleSeek}
              role="slider"
              aria-label="Seek"
              aria-valuenow={position}
              aria-valuemin={0}
              aria-valuemax={duration}
            >
              <div
                className="h-full bg-text-primary group-hover:bg-accent rounded-full transition-colors relative"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-text-primary rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          </Tooltip>
          <span className="text-[10px] text-text-muted tabular-nums w-8">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Right: VU Meters + Volume + LIVE badge */}
      <div className="flex items-center gap-3 w-[260px] shrink-0 justify-end">
        {isLive && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-danger/15 border border-danger/30 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-danger animate-pulse-live" />
            <span className="text-[10px] font-bold text-danger tracking-wider">LIVE</span>
          </div>
        )}
        <VUMeter channel="A" />
        <VUMeter channel="B" />
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
              className="w-20 h-1 accent-text-primary bg-bg-elevated rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-text-primary
                [&::-webkit-slider-thumb]:hover:bg-accent [&::-webkit-slider-thumb]:transition-colors"
              aria-label="Volume"
            />
          </div>
        </Tooltip>
      </div>
    </div>
  );
}
