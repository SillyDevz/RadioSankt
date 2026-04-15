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
import { buildSongStepTransition, type SpotifySearchResult } from '@/store';
import Tooltip from '@/components/Tooltip';
import AudioEngine from '@/engine/AudioEngine';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const PLAYLIST_PLACEHOLDER = '\u{1F4DC}';

export default function SearchWidget() {
  const connected = useStore((s) => s.connected);
  const addToast = useStore((s) => s.addToast);
  const jingles = useStore((s) => s.jingles);
  const ads = useStore((s) => s.ads);
  const songTransitionMode = useStore((s) => s.songTransitionMode);
  const crossfadeMs = useStore((s) => s.crossfadeMs);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [panel, setPanel] = useState<'spotify' | 'playlists' | 'jingles' | 'ads'>('spotify');
  
  // Spotify Search state
  const [searchResults, setSearchResults] = useState<SpotifySearchResult[]>([]);
  
  // Playlists state
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([]);
  const [playlistOffset, setPlaylistOffset] = useState(0);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsMore, setPlaylistsMore] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylistSummary | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<SpotifySearchResult[] | null>(null);
  const [playlistTracksLoading, setPlaylistTracksLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.electronAPI.getJingles().then((rows) => useStore.getState().setJingles(rows));
    window.electronAPI.getAds().then((rows) => useStore.getState().setAds(rows));
  }, []);

  const resetPlaylistsState = useCallback(() => {
    setPlaylists([]);
    setPlaylistOffset(0);
    setPlaylistsMore(false);
    setSelectedPlaylist(null);
    setPlaylistTracks(null);
    setPlaylistTracksLoading(false);
  }, []);

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

      if (panel === 'spotify') {
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
      }
    },
    [panel, addToast],
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
    let devId = useStore.getState().deviceId || (await waitForDeviceId(15_000));
    if (!devId) {
      addToast(
        'Web Playback is not connected — Spotify Premium is required. Wait until the in-app player connects, or disconnect and reconnect Spotify in Settings.',
        'warning',
      );
      return;
    }
    try {
      await playTrack(uri, devId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[SearchWidget] playTrack', msg);
      addToast(msg.length > 160 ? `${msg.slice(0, 157)}…` : msg, 'error');
    }
  };

  const handlePlayPlaylistNow = async (contextUri: string) => {
    window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));
    let devId = useStore.getState().deviceId || (await waitForDeviceId(15_000));
    if (!devId) {
      addToast(
        'Web Playback is not connected — Spotify Premium is required. Wait until the in-app player connects, or disconnect and reconnect Spotify in Settings.',
        'warning',
      );
      return;
    }
    try {
      await playPlaylistContext(contextUri, devId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[SearchWidget] playPlaylistContext', msg);
      addToast(msg.length > 160 ? `${msg.slice(0, 157)}…` : msg, 'error');
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
      ...buildSongStepTransition(songTransitionMode, crossfadeMs),
      duckMusic: false,
      duckLevel: 0.2,
    });
    addToast(`Added "${result.name}" to program`, 'success');
  };

  const handleAddJingleToAutomation = (jingle: { id: number; name: string; filePath: string; durationMs: number }) => {
    const { addAutomationStep } = useStore.getState();
    addAutomationStep({
      id: crypto.randomUUID(),
      type: 'jingle',
      jingleId: jingle.id,
      name: jingle.name,
      filePath: jingle.filePath,
      durationMs: jingle.durationMs,
      transitionIn: 'immediate',
      transitionOut: 'immediate',
      overlapMs: 0,
      duckMusic: false,
      duckLevel: 0.2,
    });
    addToast(`Added jingle "${jingle.name}" to program`, 'success');
  };

  const handleAddAdToAutomation = (ad: { id: number; name: string; filePath: string; durationMs: number }) => {
    const { addAutomationStep } = useStore.getState();
    addAutomationStep({
      id: crypto.randomUUID(),
      type: 'ad',
      adId: ad.id,
      name: ad.name,
      filePath: ad.filePath,
      durationMs: ad.durationMs,
      transitionIn: 'immediate',
      transitionOut: 'immediate',
      overlapMs: 0,
      duckMusic: false,
      duckLevel: 0.2,
    });
    addToast(`Added ad "${ad.name}" to program`, 'success');
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
        ...buildSongStepTransition(songTransitionMode, crossfadeMs),
        duckMusic: false,
        duckLevel: 0.2,
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
      ...buildSongStepTransition(songTransitionMode, crossfadeMs),
      duckMusic: false,
      duckLevel: 0.2,
    });
    addToast(`Added playlist "${summary.name}" as one program step`, 'success');
  };

  const renderTrackRow = (track: SpotifySearchResult, key: string) => (
    <div
      key={key}
      onDoubleClick={() => handlePlayNow(track.uri)}
      className="flex items-center gap-3 px-4 py-2 hover:bg-bg-elevated transition-colors group cursor-default"
    >
      <img
        src={track.albumArt}
        alt={track.album}
        className="w-10 h-10 rounded object-cover shadow-sm shrink-0 bg-bg-elevated"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate">{track.name}</div>
        <div className="text-xs text-text-secondary truncate">{track.artist}</div>
      </div>
      <span className="text-xs text-text-muted tabular-nums shrink-0">{formatDuration(track.durationMs)}</span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Tooltip content="Add to queue" placement="top">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleAddTrackToAutomation(track);
            }}
            className="p-1.5 rounded-md hover:bg-bg-primary text-text-secondary hover:text-text-primary transition-colors"
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
            className="p-1.5 rounded-md hover:bg-accent/20 text-accent transition-colors"
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

  const renderJingleRow = (jingle: { id: number; name: string; filePath: string; durationMs: number }) => (
    <div
      key={jingle.id}
      onDoubleClick={async () => {
        const audio = AudioEngine.get();
        if (audio) await audio.playJingle(jingle.filePath);
      }}
      className="flex items-center gap-3 px-4 py-2 hover:bg-bg-elevated transition-colors group cursor-default"
    >
      <div className="w-10 h-10 rounded bg-bg-elevated shrink-0 flex items-center justify-center text-accent">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate">{jingle.name}</div>
        <div className="text-xs text-text-secondary truncate">Local Audio</div>
      </div>
      <span className="text-xs text-text-muted tabular-nums shrink-0">{formatDuration(jingle.durationMs)}</span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Tooltip content="Add to queue" placement="top">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleAddJingleToAutomation(jingle);
            }}
            className="p-1.5 rounded-md hover:bg-bg-primary text-text-secondary hover:text-text-primary transition-colors"
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
            onClick={async (e) => {
              e.stopPropagation();
              const audio = AudioEngine.get();
              if (audio) await audio.playJingle(jingle.filePath);
            }}
            className="p-1.5 rounded-md hover:bg-accent/20 text-accent transition-colors"
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

  const filteredJingles = jingles.filter((j) => j.name.toLowerCase().includes(query.toLowerCase()));
  const filteredAds = ads.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex flex-col h-full bg-bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
      {/* Tabs */}
      <div className="flex border-b border-border shrink-0 bg-bg-elevated/50 p-1 gap-1">
        <button
          type="button"
          onClick={() => { setPanel('spotify'); resetPlaylistsState(); }}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            panel === 'spotify' ? 'bg-bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface/50'
          }`}
        >
          Spotify
        </button>
        <button
          type="button"
          onClick={() => { setPanel('jingles'); resetPlaylistsState(); }}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            panel === 'jingles' ? 'bg-bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface/50'
          }`}
        >
          Jingles
        </button>
        <button
          type="button"
          onClick={() => { setPanel('ads'); resetPlaylistsState(); }}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            panel === 'ads' ? 'bg-bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface/50'
          }`}
        >
          Ads
        </button>
        {connected && (
          <button
            type="button"
            onClick={() => {
              setPanel('playlists');
              setSelectedPlaylist(null);
              setPlaylistTracks(null);
              if (playlists.length === 0) void loadPlaylistsPage(0, false);
            }}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              panel === 'playlists' ? 'bg-bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface/50'
            }`}
          >
            Playlists
          </button>
        )}
      </div>

      {/* Search Input */}
      {(panel === 'spotify' || panel === 'jingles' || panel === 'ads') && (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 bg-bg-surface">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted shrink-0">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={panel === 'spotify'
              ? (connected ? 'Search Spotify...' : 'Connect Spotify first in Settings')
              : panel === 'ads'
                ? 'Search local ads...'
                : 'Search local jingles...'}
            disabled={panel === 'spotify' && !connected}
            className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted disabled:opacity-50"
          />
          {(panel === 'jingles' || panel === 'ads') && (
            <button 
              onClick={() => useStore.getState().setJingleManagerOpen(true)}
              className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded-lg text-xs font-medium transition-colors shrink-0 shadow-sm"
            >
              Manage
            </button>
          )}
        </div>
      )}

      {/* Playlists Header */}
      {panel === 'playlists' && connected && (
        <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0 bg-bg-surface">
          {selectedPlaylist ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setSelectedPlaylist(null);
                  setPlaylistTracks(null);
                }}
                className="text-xs font-medium text-accent hover:text-accent-hover transition-colors shrink-0 flex items-center gap-1"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6"/>
                </svg>
                Back
              </button>
              <div className="w-px h-4 bg-border mx-1" />
              <span className="text-sm text-text-primary font-medium truncate">{selectedPlaylist.name}</span>
            </>
          ) : (
            <span className="text-sm font-medium text-text-primary">Playlists you own</span>
          )}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {panel === 'spotify' && !connected && (
          <div className="py-8 px-4 text-center text-text-muted text-sm flex flex-col items-center gap-3">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted/50">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            Go to Settings to connect your Spotify account
          </div>
        )}

        {panel === 'spotify' && connected && (
          <div className="py-1">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!loading && query && searchResults.length === 0 && (
              <div className="py-8 text-center text-text-muted text-sm">No tracks found</div>
            )}
            {!loading && !query && (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-text-muted">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted/50">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <span className="text-sm">Search Spotify</span>
              </div>
            )}
            {searchResults.map((track) => renderTrackRow(track, track.uri))}
          </div>
        )}

        {panel === 'jingles' && (
          <div className="py-1">
            {jingles.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-text-muted">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted/50">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                </svg>
                <span className="text-sm">No jingles added yet. Add them from the Manage Jingles menu.</span>
                <button
                  onClick={() => useStore.getState().setJingleManagerOpen(true)}
                  className="mt-2 px-4 py-2 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded-lg transition-colors text-xs flex items-center gap-2 shadow-sm"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Manage Jingles
                </button>
              </div>
            ) : filteredJingles.length === 0 ? (
              <div className="py-8 text-center text-text-muted text-sm">No jingles match your search</div>
            ) : (
              filteredJingles.map((jingle) => renderJingleRow(jingle))
            )}
          </div>
        )}

        {panel === 'ads' && (
          <div className="py-1">
            {ads.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-text-muted">
                <span className="text-sm">No ads added yet. Add them from the Manage menu.</span>
                <button
                  onClick={() => useStore.getState().setJingleManagerOpen(true)}
                  className="mt-2 px-4 py-2 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded-lg transition-colors text-xs shadow-sm"
                >
                  Manage Library
                </button>
              </div>
            ) : filteredAds.length === 0 ? (
              <div className="py-8 text-center text-text-muted text-sm">No ads match your search</div>
            ) : (
              filteredAds.map((ad) => (
                <div key={ad.id} className="flex items-center gap-3 px-4 py-2 hover:bg-bg-elevated transition-colors group cursor-default">
                  <div className="w-10 h-10 rounded bg-bg-elevated shrink-0 flex items-center justify-center text-accent">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 11h18M8 7h8M8 15h8" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{ad.name}</div>
                    <div className="text-xs text-text-secondary truncate">Ad clip</div>
                  </div>
                  <span className="text-xs text-text-muted tabular-nums shrink-0">{formatDuration(ad.durationMs)}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <Tooltip content="Add to queue" placement="top">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddAdToAutomation(ad);
                        }}
                        className="p-1.5 rounded-md hover:bg-bg-primary text-text-secondary hover:text-text-primary transition-colors"
                        aria-label="Add ad to program"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </button>
                    </Tooltip>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {panel === 'playlists' && connected && !selectedPlaylist && (
          <div className="py-1">
            {playlistsLoading && playlists.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!playlistsLoading && playlists.length === 0 && (
              <div className="px-4 py-8 text-center text-text-muted text-sm">
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
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-bg-elevated transition-colors text-left group"
              >
                {pl.imageUrl ? (
                  <img src={pl.imageUrl} alt="" className="w-12 h-12 rounded-md object-cover shadow-sm shrink-0 bg-bg-elevated group-hover:shadow-md transition-shadow" />
                ) : (
                  <div className="w-12 h-12 rounded-md bg-bg-elevated shrink-0 flex items-center justify-center text-text-muted text-xl shadow-sm group-hover:shadow-md transition-shadow">
                    {PLAYLIST_PLACEHOLDER}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{pl.name}</div>
                  <div className="text-xs text-text-secondary">{pl.trackCount} tracks</div>
                </div>
              </button>
            ))}
            {playlistsMore && !playlistsLoading && (
              <div className="p-4">
                <button
                  type="button"
                  onClick={() => loadPlaylistsPage(playlistOffset, true)}
                  className="w-full py-2.5 rounded-lg bg-bg-elevated hover:bg-border text-sm font-medium text-text-primary transition-colors"
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        )}

        {panel === 'playlists' && connected && selectedPlaylist && (
          <div className="py-1">
            {playlistTracksLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!playlistTracksLoading && playlistTracks && playlistTracks.length > 0 && (
              <div className="sticky top-0 z-10 bg-bg-surface/95 backdrop-blur-sm border-b border-border px-4 py-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleAddAllTracks(playlistTracks)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-bg-elevated hover:bg-border text-text-primary transition-colors"
                >
                  Add all ({playlistTracks.length})
                </button>
                <button
                  type="button"
                  onClick={() => handleAddPlaylistStep(selectedPlaylist, playlistTracks)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent hover:bg-accent-hover text-bg-primary transition-colors shadow-sm"
                >
                  Add as block
                </button>
                <Tooltip content="Play the whole playlist now on the in-app player" placement="bottom">
                  <button
                    type="button"
                    onClick={() => handlePlayPlaylistNow(selectedPlaylist.uri)}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-bg-elevated hover:bg-border text-text-primary transition-colors ml-auto"
                  >
                    Play now
                  </button>
                </Tooltip>
              </div>
            )}
            {!playlistTracksLoading &&
              playlistTracks?.map((track) => renderTrackRow(track, `${selectedPlaylist.id}-${track.uri}`))}
          </div>
        )}
      </div>
    </div>
  );
}
