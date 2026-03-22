interface JingleRecord {
  id: number;
  name: string;
  filePath: string;
  durationMs: number;
  createdAt: string;
}

interface ElectronAPI {
  // Updates
  checkForUpdates: () => Promise<void>;
  onUpdateAvailable: (cb: () => void) => () => void;
  onUpdateDownloaded: (cb: () => void) => () => void;
  getAppVersion: () => Promise<string>;

  // File system
  openFileDialog: (options: Record<string, unknown>) => Promise<Electron.OpenDialogReturnValue>;
  readFile: (path: string) => Promise<string>;

  // Store
  saveToStore: (key: string, value: unknown) => Promise<void>;
  getFromStore: (key: string) => Promise<unknown>;

  // Spotify auth
  initiateSpotifyAuth: () => Promise<void>;
  onSpotifyAuthComplete: (cb: (data: { accessToken: string; expiresIn: number }) => void) => () => void;
  onSpotifyAuthError: (cb: (error: string) => void) => () => void;
  getSpotifyToken: () => Promise<string | null>;
  refreshSpotifyToken: () => Promise<string | null>;
  onSpotifyTokenRefreshed: (cb: (data: { accessToken: string; expiresIn: number }) => void) => () => void;
  disconnectSpotify: () => Promise<void>;
  getSpotifyClientId: () => Promise<string | null>;
  saveSpotifyClientId: (id: string) => Promise<void>;

  // Shell
  openExternal: (url: string) => Promise<void>;

  // File system - binary
  readFileBuffer: (path: string) => Promise<ArrayBuffer>;

  // Jingles
  saveJingle: (name: string, filePath: string, durationMs: number) => Promise<JingleRecord>;
  getJingles: () => Promise<JingleRecord[]>;
  deleteJingle: (id: number) => Promise<void>;
  renameJingle: (id: number, name: string) => Promise<void>;

  // Automation Playlists
  savePlaylist: (name: string, steps: string) => Promise<{ id: number; name: string; steps: string; createdAt: string; updatedAt: string }>;
  updatePlaylist: (id: number, name: string, steps: string) => Promise<void>;
  loadPlaylist: (id: number) => Promise<{ id: number; name: string; steps: string; createdAt: string; updatedAt: string } | undefined>;
  listPlaylists: () => Promise<Array<{ id: number; name: string; stepCount: number; updatedAt: string }>>;
  deletePlaylist: (id: number) => Promise<void>;
}

// Spotify Web Playback SDK types
interface SpotifyPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, callback: (data: any) => void) => boolean; // eslint-disable-line @typescript-eslint/no-explicit-any
  removeListener: (event: string, callback?: (data: any) => void) => boolean; // eslint-disable-line @typescript-eslint/no-explicit-any
  getCurrentState: () => Promise<SpotifyPlaybackState | null>;
  setName: (name: string) => Promise<void>;
  getVolume: () => Promise<number>;
  setVolume: (volume: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  togglePlay: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  previousTrack: () => Promise<void>;
  nextTrack: () => Promise<void>;
  activateElement: () => Promise<void>;
  _options?: { id?: string };
}

interface SpotifyPlaybackState {
  context: { uri: string; metadata: Record<string, unknown> };
  disallows: Record<string, boolean>;
  paused: boolean;
  position: number;
  duration: number;
  repeat_mode: number;
  shuffle: boolean;
  track_window: {
    current_track: SpotifyTrack;
    previous_tracks: SpotifyTrack[];
    next_tracks: SpotifyTrack[];
  };
}

interface SpotifyTrack {
  uri: string;
  id: string;
  type: string;
  media_type: string;
  name: string;
  is_playable: boolean;
  album: {
    uri: string;
    name: string;
    images: Array<{ url: string; height: number; width: number }>;
  };
  artists: Array<{ uri: string; name: string }>;
  duration_ms: number;
}

interface Window {
  electronAPI: ElectronAPI;
  Spotify: {
    Player: new (options: {
      name: string;
      getOAuthToken: (cb: (token: string) => void) => void;
      volume?: number;
    }) => SpotifyPlayer;
  };
  onSpotifyWebPlaybackSDKReady: () => void;
}
