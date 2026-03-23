import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store';
import { searchTracks } from '@/services/spotify-api';
import { playTrack } from '@/services/spotify-api';
import Tooltip from './Tooltip';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function SpotifySearch() {
  const open = useStore((s) => s.spotifySearchOpen);
  const setOpen = useStore((s) => s.setSpotifySearchOpen);
  const connected = useStore((s) => s.connected);
  const deviceId = useStore((s) => s.deviceId);
  const searchResults = useStore((s) => s.searchResults);
  const setSearchResults = useStore((s) => s.setSearchResults);
  const addToast = useStore((s) => s.addToast);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // CMD+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSearchResults([]);
    }
  }, [open, setSearchResults]);

  // Debounced search
  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!value.trim()) {
        setSearchResults([]);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        try {
          const results = await searchTracks(value);
          setSearchResults(results);
        } catch (err) {
          console.error('Spotify search error:', err);
          addToast(`Search failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    [setSearchResults, addToast],
  );

  const handlePlayNow = async (uri: string) => {
    if (!deviceId) {
      addToast('Spotify player not ready', 'warning');
      return;
    }
    try {
      await playTrack(uri, deviceId);
      setOpen(false);
    } catch {
      addToast('Failed to play track', 'error');
    }
  };

  const handleAddToAutomation = (result: { uri: string; name: string; artist: string; album: string; albumArt: string; durationMs: number }) => {
    const { addAutomationStep } = useStore.getState();
    addAutomationStep({
      id: crypto.randomUUID(),
      type: 'track',
      spotifyUri: result.uri,
      name: result.name,
      artist: result.artist,
      albumArt: result.albumArt,
      durationMs: result.durationMs,
      transitionIn: 'immediate',
      transitionOut: 'immediate',
      overlapMs: 0,
      duckMusic: false,
      duckLevel: 0.2,
    });
    addToast(`Added "${result.name}" to automation`, 'success');
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative w-full max-w-[600px] bg-bg-surface border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-text-muted shrink-0"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={connected ? 'Search Spotify tracks...' : 'Connect Spotify first in Settings'}
            disabled={!connected}
            className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted disabled:opacity-50"
          />
          <kbd className="px-1.5 py-0.5 bg-bg-elevated rounded text-[10px] text-text-muted font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && query && searchResults.length === 0 && (
            <div className="py-8 text-center text-text-muted text-sm">
              No tracks found
            </div>
          )}

          {!loading && !query && connected && (
            <div className="py-8 text-center text-text-muted text-sm">
              Start typing to search Spotify
            </div>
          )}

          {!connected && (
            <div className="py-8 text-center text-text-muted text-sm">
              Go to Settings to connect your Spotify account
            </div>
          )}

          {searchResults.map((track) => (
            <div
              key={track.uri}
              onClick={() => handlePlayNow(track.uri)}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-elevated transition-colors group cursor-pointer"
            >
              {/* Album art */}
              <img
                src={track.albumArt}
                alt={track.album}
                className="w-10 h-10 rounded object-cover shrink-0"
              />

              {/* Track info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate">{track.name}</div>
                <div className="text-xs text-text-secondary truncate">{track.artist}</div>
              </div>

              {/* Duration */}
              <span className="text-xs text-text-muted tabular-nums shrink-0">
                {formatDuration(track.durationMs)}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <Tooltip content="Adds this track to your current automation playlist" placement="top">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAddToAutomation(track); }}
                    className="p-1.5 rounded hover:bg-bg-primary text-text-secondary hover:text-text-primary transition-colors"
                    aria-label="Add to Automation"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                  </button>
                </Tooltip>
                <Tooltip content="Play this track now" placement="top">
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePlayNow(track.uri); }}
                    className="p-1.5 rounded hover:bg-accent/20 text-accent transition-colors"
                    aria-label="Play Now"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
