import { useStore, type SpotifySearchResult } from '@/store';

async function resolveRecordedOAuthScopes(): Promise<string> {
  const fromState = useStore.getState().spotifyGrantedScopes;
  if (fromState) return fromState;
  const api = window.electronAPI;
  if (api?.getFromStore) {
    try {
      const v = await api.getFromStore('spotifyLastGrantedScopesDisplay');
      if (typeof v === 'string' && v.length > 0) return v;
    } catch {
      /* ignore */
    }
  }
  if (typeof api?.getSpotifyLastGrantedScopes === 'function') {
    const s = await api.getSpotifyLastGrantedScopes().catch(() => null);
    if (s) return s;
  }
  return '(not recorded — connect again; run npm run electron:dev so preload rebuilds)';
}

const API_BASE = 'https://api.spotify.com/v1';

/** Deduplicates concurrent token refresh calls from the renderer process. */
let refreshPromise: Promise<string | null> | null = null;

function refreshTokenOnce(): Promise<string | null> {
  if (!window.electronAPI?.refreshSpotifyToken) return Promise.resolve(null);
  if (!refreshPromise) {
    refreshPromise = window.electronAPI.refreshSpotifyToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** Cleared on Spotify disconnect so the next session resolves the correct user id. */
let spotifyUserIdCache: string | null = null;

export function clearSpotifyUserIdCache(): void {
  spotifyUserIdCache = null;
}

async function getToken(): Promise<string> {
  if (!window.electronAPI?.getSpotifyToken) throw new Error('Electron API not available');
  const token = await window.electronAPI.getSpotifyToken();
  if (!token) throw new Error('No Spotify token available');
  return token.trim();
}

function spotifyBearerInit(token: string, options: RequestInit = {}): RequestInit {
  return {
    ...options,
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      Accept: 'application/json',
      ...options.headers,
    },
  };
}

/** JWT user tokens include `scp`; opaque tokens return null. */
function scopesFromAccessTokenJwt(accessToken: string): string[] | null {
  const parts = accessToken.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(b64 + pad)) as { scp?: unknown; scope?: unknown };
    if (Array.isArray(payload.scp)) return payload.scp.map(String);
    if (typeof payload.scope === 'string') return payload.scope.split(/\s+/).filter(Boolean);
    return null;
  } catch {
    return null;
  }
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...spotifyBearerInit(token, options),
      signal: controller.signal,
    });

    if (res.status === 401) {
      clearTimeout(timeout);
      const newToken = await refreshTokenOnce();
      if (newToken) {
        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), 15000);
        try {
          return await fetch(`${API_BASE}${path}`, {
            ...spotifyBearerInit(newToken, options),
            signal: retryController.signal,
          });
        } finally {
          clearTimeout(retryTimeout);
        }
      }
    }

    if (res.status === 429) {
      clearTimeout(timeout);
      const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      const retryController = new AbortController();
      const retryTimeout = setTimeout(() => retryController.abort(), 15000);
      try {
        return await fetch(`${API_BASE}${path}`, {
          ...spotifyBearerInit(token, options),
          signal: retryController.signal,
        });
      } finally {
        clearTimeout(retryTimeout);
      }
    }

    return res;
  } finally {
    clearTimeout(timeout);
  }
}

function mapTrackItem(track: {
  uri: string;
  name: string;
  artists?: Array<{ name: string }> | null;
  album?: { name?: string; images?: Array<{ url: string }> } | null;
  duration_ms?: number;
}): SpotifySearchResult {
  return {
    uri: track.uri,
    name: track.name || '',
    artist: Array.isArray(track.artists) ? track.artists.map((a) => a.name).join(', ') : '',
    album: track.album?.name || '',
    albumArt: track.album?.images?.[0]?.url || '',
    durationMs: track.duration_ms ?? 0,
  };
}

/** GET /playlists/{id}/items uses `item`; legacy /tracks used `track`. */
function rowPlaybackEntity(row: { track?: unknown; item?: unknown }): unknown {
  return row.item ?? row.track;
}

function formatPlaylistItemsError(status: number, body: string): string {
  let detail = body;
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    if (typeof j.error?.message === 'string') detail = j.error.message;
  } catch {
    /* use raw body */
  }
  const base = `Spotify playlist items ${status}: ${detail}`;
  if (status === 403) {
    return `${base} — Spotify may forbid listing items for playlists you do not own (or are not a collaborator on) in Development Mode.`;
  }
  return base;
}

export async function searchTracks(query: string): Promise<SpotifySearchResult[]> {
  if (!query.trim()) return [];

  const params = new URLSearchParams({
    q: query,
    type: 'track',
    limit: '10',
  });

  const res = await apiFetch(`/search?${params.toString()}`);
  if (!res.ok) {
    const errorBody = await res.text();
    console.error('Spotify search error:', res.status, errorBody);
    throw new Error(`Spotify API ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  return (data.tracks?.items || [])
    .filter((t: { type?: string }) => t.type === 'track')
    .map(mapTrackItem);
}

export interface SpotifyProfile {
  id: string;
  displayName: string;
  avatar: string | null;
  /** ISO 3166-1 alpha-2 from Spotify; required for playlist item availability when token market is ambiguous. */
  country: string | null;
}

export async function getProfile(): Promise<SpotifyProfile> {
  const res = await apiFetch('/me');
  if (!res.ok) throw new Error('Failed to fetch profile');

  const data = await res.json();
  const country = typeof data.country === 'string' ? data.country : null;
  return {
    id: data.id,
    displayName: data.display_name || data.id,
    avatar: data.images?.[0]?.url || null,
    country: country && country.length === 2 ? country : null,
  };
}

/** Move active playback to the Web Playback SDK device (required when another device was last active). */
export async function transferPlaybackToDevice(deviceId: string): Promise<void> {
  const res = await apiFetch('/me/player', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`Transfer failed ${res.status}: ${body}`);
  }
}

export type ActivePlaybackUris = { itemUri: string | null; contextUri: string | null };

/** Active playback on whatever device Spotify is using (should match Web Playback when connected). */
export async function getActivePlaybackUris(): Promise<ActivePlaybackUris | null> {
  const res = await apiFetch('/me/player');
  if (res.status === 204) return null;
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
    throw new Error(`RATE_LIMITED:${retryAfter}`);
  }
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { item?: { uri?: string }; context?: { uri?: string } };
    return {
      itemUri: typeof data.item?.uri === 'string' ? data.item.uri : null,
      contextUri: typeof data.context?.uri === 'string' ? data.context.uri : null,
    };
  } catch {
    return null;
  }
}

async function waitForActiveTrackUri(expectedUri: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return;
    try {
      const snap = await getActivePlaybackUris();
      if (signal?.aborted) return;
      if (snap?.itemUri === expectedUri) return;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('RATE_LIMITED:')) {
        const secs = parseInt(err.message.split(':')[1], 10) || 2;
        await new Promise((r) => setTimeout(r, secs * 1000));
      }
      // continue loop
    }
    await new Promise((r) => setTimeout(r, 280));
    if (signal?.aborted) return;
  }
  throw new Error(
    'Spotify did not switch to the requested track (Web Playback offline, wrong device, or Premium issue).',
  );
}

async function waitForActivePlaylistContext(expectedContextUri: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return;
    try {
      const snap = await getActivePlaybackUris();
      if (signal?.aborted) return;
      if (snap?.contextUri === expectedContextUri) return;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('RATE_LIMITED:')) {
        const secs = parseInt(err.message.split(':')[1], 10) || 2;
        await new Promise((r) => setTimeout(r, secs * 1000));
      }
      // continue loop
    }
    await new Promise((r) => setTimeout(r, 280));
    if (signal?.aborted) return;
  }
  throw new Error(
    'Spotify did not start the requested playlist (Web Playback offline, wrong device, or Premium issue).',
  );
}

export async function playTrack(uri: string, deviceId: string, signal?: AbortSignal): Promise<void> {
  try {
    await transferPlaybackToDevice(deviceId);
  } catch (err) {
    console.warn('[Spotify] transfer before play (ignored):', err);
  }
  if (signal?.aborted) return;
  const res = await apiFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri] }),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`Play failed ${res.status}: ${body}`);
  }
  await waitForActiveTrackUri(uri, 12_000, signal);
  // Disable repeat so single-track queues don't loop when the track ends
  apiFetch('/me/player/repeat?state=off', { method: 'PUT' }).catch(() => {});
}

export async function playPlaylistContext(contextUri: string, deviceId: string, signal?: AbortSignal): Promise<void> {
  try {
    await transferPlaybackToDevice(deviceId);
  } catch (err) {
    console.warn('[Spotify] transfer before play (ignored):', err);
  }
  if (signal?.aborted) return;
  const res = await apiFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context_uri: contextUri, offset: { position: 0 } }),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`Play failed ${res.status}: ${body}`);
  }
  await waitForActivePlaylistContext(contextUri, 12_000, signal);
  // Disable repeat so the playlist doesn't loop when it finishes
  apiFetch('/me/player/repeat?state=off', { method: 'PUT' }).catch(() => {});
  // Disable shuffle so the DJ's intended track order is respected
  apiFetch('/me/player/shuffle?state=false', { method: 'PUT' }).catch(() => {});
}

export interface SpotifyPlaylistSummary {
  id: string;
  uri: string;
  name: string;
  imageUrl: string;
  trackCount: number;
}

export async function getMyPlaylists(
  limit = 50,
  offset = 0,
): Promise<{ items: SpotifyPlaylistSummary[]; next: boolean; rawPageLength: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const query = `?${params.toString()}`;

  let myId = spotifyUserIdCache;
  if (!myId) {
    const profile = await getProfile();
    myId = profile.id;
    spotifyUserIdCache = myId;
  }

  let token = await getToken();
  const jwtScopes = scopesFromAccessTokenJwt(token);
  if (jwtScopes && !jwtScopes.includes('playlist-read-private')) {
    console.error(
      '[Radio Sankt] Spotify token JWT `scp` is missing playlist-read-private (OAuth may disagree). scp:',
      jwtScopes,
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/me/playlists${query}`, spotifyBearerInit(token));

    if (res.status === 401 || res.status === 403) {
      const refreshed = await refreshTokenOnce();
      if (refreshed) {
        token = refreshed.trim();
        res = await fetch(`${API_BASE}/me/playlists${query}`, spotifyBearerInit(token));
      }
    }

    if (res.status === 403) {
      const meRes = await fetch(`${API_BASE}/me`, spotifyBearerInit(token));
      if (meRes.ok) {
        const me = (await meRes.json()) as { id?: string };
        if (me.id) {
          const alt = await fetch(
            `${API_BASE}/users/${encodeURIComponent(me.id)}/playlists${query}`,
            spotifyBearerInit(token),
          );
          if (alt.ok) res = alt;
        }
      }
    }
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('Network error: unable to reach Spotify.');
    }
    throw err;
  }

  if (!res.ok) {
    const errorBody = await res.text();
    const last = await resolveRecordedOAuthScopes();
    if (res.status === 403 && errorBody.includes('scope')) {
      const hasPrivate = typeof last === 'string' && last.includes('playlist-read-private');
      throw new Error(
        hasPrivate
          ? `Spotify returned 403 for playlists even though your last login scope string includes playlist-read-private: "${last}". ` +
            'Check DevTools Console for a JWT scp warning. Try another network/VPN, or create a fresh app on developer.spotify.com (Web API + Web Playback, redirect http://127.0.0.1:8888/callback).'
          : `Spotify blocked playlists (403). Last OAuth scopes recorded: ${last}. ` +
            'Reconnect once; if playlist-read-private is missing there, revoke the app at spotify.com/account/apps.',
      );
    }
    throw new Error(`Spotify playlists ${res.status}: ${errorBody}`);
  }
  const data = await res.json();
  const raw = (data.items || []) as Array<{
    id: string;
    uri: string;
    name: string;
    owner?: { id?: string };
    images: Array<{ url: string }>;
    items?: { total?: number };
    tracks?: { total?: number };
  }>;
  const items = raw
    .filter((p) => p.owner?.id === myId)
    .map((p) => {
      const n = p.items?.total ?? p.tracks?.total;
      return {
        id: p.id,
        uri: p.uri,
        name: p.name,
        imageUrl: p.images[0]?.url || '',
        trackCount: typeof n === 'number' && Number.isFinite(n) ? n : 0,
      };
    });
  return {
    items,
    next: Boolean(data.next),
    rawPageLength: raw.length,
  };
}

/** Playable Spotify tracks only (skips local files, episodes, removed tracks). */
export async function getPlaylistTracks(playlistId: string): Promise<SpotifySearchResult[]> {
  const profile = await getProfile();
  const market = profile.country ?? undefined;

  const out: SpotifySearchResult[] = [];
  let offset = 0;
  const limit = 50;
  const pathBase = `/playlists/${encodeURIComponent(playlistId)}/items`;

  while (true) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (market) params.set('market', market);

    let token = await getToken();
    let res: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      res = await fetch(`${API_BASE}${pathBase}?${params}`, {
        ...spotifyBearerInit(token),
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        const refreshed = await refreshTokenOnce();
        if (refreshed) {
          token = refreshed.trim();
          clearTimeout(timeout);
          const retryController = new AbortController();
          const retryTimeout = setTimeout(() => retryController.abort(), 15000);
          try {
            res = await fetch(`${API_BASE}${pathBase}?${params}`, {
              ...spotifyBearerInit(token),
              signal: retryController.signal,
            });
          } finally {
            clearTimeout(retryTimeout);
          }
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof TypeError) {
        throw new Error('Network error: unable to reach Spotify.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(formatPlaylistItemsError(res.status, errorBody));
    }
    const data = await res.json();
    const batch = data.items || [];
    for (const row of batch) {
      const t = rowPlaybackEntity(row);
      if (!t || typeof t !== 'object') continue;
      const tr = t as { type?: string; uri?: string; is_playable?: boolean };
      if (tr.type !== 'track' || !tr.uri) continue;
      if (tr.is_playable === false) continue;
      out.push(mapTrackItem(t as Parameters<typeof mapTrackItem>[0]));
    }
    offset += batch.length;
    if (!data.next || batch.length === 0) break;
  }

  return out;
}
