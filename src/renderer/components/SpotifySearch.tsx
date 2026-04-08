import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store';
import {
  searchTracks,
  playTrack,
  playPlaylistContext,
  getMyPlaylists,
  getPlaylistTracks,
  type SpotifyPlaylistSummary,
} from '@/services/spotify-api';
import type { SpotifySearchResult } from '@/store';
import Tooltip from './Tooltip';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const stepDefaults = {
  transitionIn: 'immediate' as const,
  transitionOut: 'immediate' as const,
  overlapMs: 0,
  duckMusic: false,
  duckLevel: 0.2,
};

const PLAYLIST_PLACEHOLDER = '\u{1F4DC}';

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
  const [panel, setPanel] = useState<'search' | 'playlists'>('search');
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([]);
  const [playlistOffset, setPlaylistOffset] = useState(0);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsMore, setPlaylistsMore] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylistSummary | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<SpotifySearchResult[] | null>(null);
  const [playlistTracksLoading, setPlaylistTracksLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetPlaylistsState = useCallback(() => {
    setPlaylists([]);
    setPlaylistOffset(0);
    setPlaylistsMore(false);
    setSelectedPlaylist(null);
    setPlaylistTracks(null);
    setPlaylistTracksLoading(false);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSearchResults([]);
      setPanel('search');
      resetPlaylistsState();
    }
  }, [open, setSearchResults, resetPlaylistsState]);

  const loadPlaylistsPage = useCallback(
    async (offset: number, append: boolean) => {
      if (!connected) return;
      setPlaylistsLoading(true);
      try {
        const { items, next, rawPageLength } = await getMyPlaylists(50, offset);
        setPlaylists((prev) => (append ? [...prev, ...items] : items));
        setPlaylistOffset(offset + rawPageLength);
        setPlaylistsMore(next);
      } catch (err) {
        console.error(err);
        addToast(
          `Could not load playlists: ${err instanceof Error ? err.message : String(err)} — reconnect Spotify in Settings if you connected before this update.`,
          'error',
        );
      } finally {
        setPlaylistsLoading(false);
      }
    },
    [connected, addToast],
  );

  const openPlaylist = async (summary: SpotifyPlaylistSummary) => {
    setSelectedPlaylist(summary);
    setPlaylistTracks(null);
    setPlaylistTracksLoading(true);
    try {
      const tracks = await getPlaylistTracks(summary.id);
      setPlaylistTracks(tracks);
      if (tracks.length === 0) {
        addToast('This playlist has no playable Spotify tracks (local files are skipped).', 'warning');
      }
    } catch (err) {
      addToast(`Failed to load tracks: ${err instanceof Error ? err.message : String(err)}`, 'error');
      setSelectedPlaylist(null);
    } finally {
      setPlaylistTracksLoading(false);
    }
  };

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

  const waitForDeviceId = (timeoutMs: number) =>
    new Promise<string | null>((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const id = useStore.getState().deviceId;
        if (id) {
          resolve(id);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(null);
          return;
        }
        setTimeout(tick, 250);
      };
      tick();
    });

  const handlePlayNow = async (uri: string) => {
    window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));
    let devId = deviceId || (await waitForDeviceId(15_000));
    if (!devId) {
      addToast(
        'Web Playback is not connected — Spotify Premium is required. Wait for “Spotify player ready” or disconnect and reconnect Spotify in Settings.',
        'warning',
      );
      return;
    }
    try {
      await playTrack(uri, devId);
      setOpen(false);
    } catch {
      addToast('Failed to play track', 'error');
    }
  };

  const handlePlayPlaylistNow = async (contextUri: string) => {
    window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));
    let devId = deviceId || (await waitForDeviceId(15_000));
    if (!devId) {
      addToast(
        'Web Playback is not connected — Spotify Premium is required. Wait for “Spotify player ready” or disconnect and reconnect Spotify in Settings.',
        'warning',
      );
      return;
    }
    try {
      await playPlaylistContext(contextUri, devId);
      setOpen(false);
    } catch {
      addToast('Failed to play playlist', 'error');
    }
  };

  const handleAddTrackToAutomation = (result: SpotifySearchResult) => {
    const { addAutomationStep } = useStore.getState();
    addAutomationStep({
      id: crypto.randomUUID(),
      type: 'track',
      spotifyUri: result.uri,
      name: result.name,
      artist: result.artist,
      albumArt: result.albumArt,
      durationMs: result.durationMs,
      ...stepDefaults,
    });
    addToast(`Added "${result.name}" to program`, 'success');
  };

  const handleAddAllTracks = (tracks: SpotifySearchResult[]) => {
    if (tracks.length === 0) return;
    const { addAutomationStep } = useStore.getState();
    for (const t of tracks) {
      addAutomationStep({
        id: crypto.randomUUID(),
        type: 'track',
        spotifyUri: t.uri,
        name: t.name,
        artist: t.artist,
        albumArt: t.albumArt,
        durationMs: t.durationMs,
        ...stepDefaults,
      });
    }
    addToast(`Added ${tracks.length} tracks to program`, 'success');
  };

  const handleAddPlaylistStep = (summary: SpotifyPlaylistSummary, tracks: SpotifySearchResult[]) => {
    if (tracks.length === 0) return;
    const durationMs = tracks.reduce((s, t) => s + t.durationMs, 0);
    const { addAutomationStep } = useStore.getState();
    addAutomationStep({
      id: crypto.randomUUID(),
      type: 'playlist',
      spotifyPlaylistUri: summary.uri,
      name: summary.name,
      albumArt: summary.imageUrl,
      durationMs,
      trackCount: tracks.length,
      ...stepDefaults,
    });
    addToast(`Added playlist "${summary.name}" as one program step`, 'success');
  };

  const renderTrackRow = (track: SpotifySearchResult, key: string) => (
    <div
      key={key}
      onClick={() => handlePlayNow(track.uri)}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-elevated transition-colors group cursor-pointer"
    >
      <img
        src={track.albumArt}
        alt={track.album}
        className="w-10 h-10 rounded object-cover shrink-0 bg-bg-elevated"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{track.name}</div>
        <div className="text-xs text-text-secondary truncate">{track.artist}</div>
      </div>
      <span className="text-xs text-text-muted tabular-nums shrink-0">{formatDuration(track.durationMs)}</span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Tooltip content="Add to program" placement="top">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleAddTrackToAutomation(track);
            }}
            className="p-1.5 rounded hover:bg-bg-primary text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Add to program"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip content="Play now" placement="top">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePlayNow(track.uri);
            }}
            className="p-1.5 rounded hover:bg-accent/20 text-accent transition-colors"
            aria-label="Play now"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
        </Tooltip>
      </div>
    </div>
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/60" />

      <div
        className="relative w-full max-w-[600px] max-h-[85vh] flex flex-col bg-bg-surface border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {connected && (
          <div className="flex border-b border-border shrink-0">
            <button
              type="button"
              onClick={() => {
                setPanel('search');
                resetPlaylistsState();
              }}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                panel === 'search' ? 'bg-bg-elevated text-text-primary' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Search
            </button>
            <button
              type="button"
              onClick={() => {
                setPanel('playlists');
                setSelectedPlaylist(null);
                setPlaylistTracks(null);
                if (playlists.length === 0) void loadPlaylistsPage(0, false);
              }}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                panel === 'playlists' ? 'bg-bg-elevated text-text-primary' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Playlists you own
            </button>
          </div>
        )}

        {panel === 'search' && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
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
            <kbd className="px-1.5 py-0.5 bg-bg-elevated rounded text-[10px] text-text-muted font-mono">ESC</kbd>
          </div>
        )}

        {panel === 'playlists' && connected && (
          <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
            {selectedPlaylist ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPlaylist(null);
                    setPlaylistTracks(null);
                  }}
                  className="text-xs text-accent hover:underline shrink-0"
                >
                  ← Playlists
                </button>
                <span className="text-sm text-text-primary font-medium truncate">{selectedPlaylist.name}</span>
              </>
            ) : (
              <span className="text-sm font-medium text-text-primary">Playlists you own</span>
            )}
          </div>
        )}

        <div className="overflow-y-auto flex-1 min-h-0">
          {!connected && (
            <div className="py-8 text-center text-text-muted text-sm">Go to Settings to connect your Spotify account</div>
          )}

          {connected && panel === 'search' && (
            <>
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!loading && query && searchResults.length === 0 && (
                <div className="py-8 text-center text-text-muted text-sm">No tracks found</div>
              )}
              {!loading && !query && (
                <div className="py-8 text-center text-text-muted text-sm">Start typing to search Spotify</div>
              )}
              {searchResults.map((track) => renderTrackRow(track, track.uri))}
            </>
          )}

          {connected && panel === 'playlists' && !selectedPlaylist && (
            <>
              {playlistsLoading && playlists.length === 0 && (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!playlistsLoading && playlists.length === 0 && (
                <div className="px-4 py-6 text-center text-text-muted text-sm">
                  {playlistsMore
                    ? 'No playlists you own in this batch. Load more to keep scanning your library.'
                    : 'No playlists you own. Playlists you only follow are hidden (Spotify Web API).'}
                </div>
              )}
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => openPlaylist(pl)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-bg-elevated transition-colors text-left"
                >
                  {pl.imageUrl ? (
                    <img src={pl.imageUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0 bg-bg-elevated" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-bg-elevated shrink-0 flex items-center justify-center text-text-muted text-lg">
                      {PLAYLIST_PLACEHOLDER}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-primary truncate">{pl.name}</div>
                    <div className="text-xs text-text-muted">{pl.trackCount} tracks</div>
                  </div>
                </button>
              ))}
              {playlistsMore && !playlistsLoading && (
                <div className="p-4">
                  <button
                    type="button"
                    onClick={() => loadPlaylistsPage(playlistOffset, true)}
                    className="w-full py-2 text-xs text-accent hover:underline"
                  >
                    Load more
                  </button>
                </div>
              )}
            </>
          )}

          {connected && panel === 'playlists' && selectedPlaylist && (
            <>
              {playlistTracksLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!playlistTracksLoading && playlistTracks && playlistTracks.length > 0 && (
                <div className="sticky top-0 z-10 bg-bg-surface border-b border-border px-4 py-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleAddAllTracks(playlistTracks)}
                    className="px-2.5 py-1 rounded text-xs bg-bg-elevated hover:bg-border text-text-primary"
                  >
                    Add all tracks ({playlistTracks.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddPlaylistStep(selectedPlaylist, playlistTracks)}
                    className="px-2.5 py-1 rounded text-xs bg-accent hover:bg-accent-hover text-bg-primary font-medium"
                  >
                    Add as one playlist step
                  </button>
                  <Tooltip content="Play the whole playlist now on the in-app player" placement="bottom">
                    <button
                      type="button"
                      onClick={() => handlePlayPlaylistNow(selectedPlaylist.uri)}
                      className="px-2.5 py-1 rounded text-xs bg-bg-elevated hover:bg-border text-text-primary"
                    >
                      Play playlist now
                    </button>
                  </Tooltip>
                </div>
              )}
              {!playlistTracksLoading &&
                playlistTracks?.map((track) => renderTrackRow(track, `${selectedPlaylist.id}-${track.uri}`))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
