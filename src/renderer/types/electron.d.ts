interface JingleRecord {
  id: number;
  name: string;
  filePath: string;
  durationMs: number;
  createdAt: string;
}

interface AdRecord {
  id: number;
  name: string;
  filePath: string;
  durationMs: number;
  createdAt: string;
}

interface ElectronAPI {
  platform: NodeJS.Platform;

  // Updates
  checkForUpdates: () => Promise<
    | { ok: true; isUpdateAvailable: boolean; remoteVersion: string | null }
    | { ok: false; reason: 'development' | 'updater_inactive' | 'error'; message?: string }
  >;
  onUpdateAvailable: (cb: () => void) => () => void;
  onUpdateDownloaded: (cb: () => void) => () => void;
  getAppVersion: () => Promise<string>;
  quitAndInstall: () => Promise<void>;
  toggleDevTools: () => Promise<void>;

  // File system
  openFileDialog: (options: Record<string, unknown>) => Promise<Electron.OpenDialogReturnValue>;
  readFile: (path: string) => Promise<string>;

  // Store
  saveToStore: (key: string, value: unknown) => Promise<void>;
  getFromStore: (key: string) => Promise<unknown>;

  // Spotify auth
  initiateSpotifyAuth: () => Promise<void>;
  onSpotifyAuthComplete: (
    cb: (data: { accessToken: string; expiresIn: number; grantedScopes?: string }) => void,
  ) => () => void;
  onSpotifyAuthError: (cb: (error: string) => void) => () => void;
  /** Present on current preload; may be missing if the desktop build is stale. */
  onSpotifyScopeReset?: (cb: (message: string) => void) => () => void;
  getSpotifyToken: () => Promise<string | null>;
  refreshSpotifyToken: () => Promise<string | null>;
  onSpotifyTokenRefreshed: (cb: (data: { accessToken: string; expiresIn: number }) => void) => () => void;
  disconnectSpotify: () => Promise<void>;
  getSpotifyClientId: () => Promise<string | null>;
  saveSpotifyClientId: (id: string) => Promise<void>;
  getSpotifyLastGrantedScopes: () => Promise<string | null>;

  // Shell
  openExternal: (url: string) => Promise<void>;

  // File system - binary
  readFileBuffer: (path: string) => Promise<ArrayBuffer>;

  // Jingles
  saveJingle: (name: string, filePath: string, durationMs: number) => Promise<JingleRecord>;
  getJingles: () => Promise<JingleRecord[]>;
  deleteJingle: (id: number) => Promise<void>;
  renameJingle: (id: number, name: string) => Promise<void>;

  // Ads
  saveAd: (name: string, filePath: string, durationMs: number) => Promise<AdRecord>;
  getAds: () => Promise<AdRecord[]>;
  deleteAd: (id: number) => Promise<void>;
  renameAd: (id: number, name: string) => Promise<void>;

  // Automation Playlists
  savePlaylist: (name: string, steps: string) => Promise<{ id: number; name: string; steps: string; createdAt: string; updatedAt: string }>;
  updatePlaylist: (id: number, name: string, steps: string) => Promise<void>;
  loadPlaylist: (id: number) => Promise<{ id: number; name: string; steps: string; createdAt: string; updatedAt: string } | undefined>;
  listPlaylists: () => Promise<Array<{ id: number; name: string; stepCount: number; updatedAt: string }>>;
  deletePlaylist: (id: number) => Promise<void>;

  listWeeklySlots?: () => Promise<
    Array<{
      id: number;
      playlistId: number;
      dayOfWeek: number;
      startMinute: number;
      durationMinutes: number;
      maxDurationMs: number | null;
      label: string | null;
      createdAt: string;
    }>
  >;
  addWeeklySlot?: (
    playlistId: number,
    dayOfWeek: number,
    startMinute: number,
    durationMinutes: number,
    maxDurationMs: number | null,
    label: string | null,
  ) => Promise<{
    id: number;
    playlistId: number;
    dayOfWeek: number;
    startMinute: number;
    durationMinutes: number;
    maxDurationMs: number | null;
    label: string | null;
    createdAt: string;
  }>;
  updateWeeklySlot?: (
    id: number,
    playlistId: number,
    dayOfWeek: number,
    startMinute: number,
    durationMinutes: number,
    maxDurationMs: number | null,
    label: string | null,
  ) => Promise<void>;
  deleteWeeklySlot?: (id: number) => Promise<void>;
}

interface Window {
  electronAPI: ElectronAPI;
}
