import type { SpotifySearchResult } from '@/store';

const API_BASE = 'https://api.spotify.com/v1';

async function getToken(): Promise<string> {
  const token = await window.electronAPI.getSpotifyToken();
  if (!token) throw new Error('No Spotify token available');
  return token;
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    // Try refresh once
    const newToken = await window.electronAPI.refreshSpotifyToken();
    if (newToken) {
      return fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${newToken}`,
          ...options.headers,
        },
      });
    }
  }

  return res;
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
  return (data.tracks?.items || []).map((track: {
    uri: string;
    name: string;
    artists: Array<{ name: string }>;
    album: { name: string; images: Array<{ url: string }> };
    duration_ms: number;
  }) => ({
    uri: track.uri,
    name: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
    album: track.album.name,
    albumArt: track.album.images[0]?.url || '',
    durationMs: track.duration_ms,
  }));
}

export interface SpotifyProfile {
  displayName: string;
  avatar: string | null;
}

export async function getProfile(): Promise<SpotifyProfile> {
  const res = await apiFetch('/me');
  if (!res.ok) throw new Error('Failed to fetch profile');

  const data = await res.json();
  return {
    displayName: data.display_name || data.id,
    avatar: data.images?.[0]?.url || null,
  };
}

export async function playTrack(uri: string, deviceId: string): Promise<void> {
  const res = await apiFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri] }),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`Play failed ${res.status}: ${body}`);
  }
}
