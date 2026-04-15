import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateAvailable: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },
  onUpdateDownloaded: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),

  // File system
  openFileDialog: (options: Record<string, unknown>) => ipcRenderer.invoke('open-file-dialog', options),
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),

  // Store
  saveToStore: (key: string, value: unknown) => ipcRenderer.invoke('save-to-store', key, value),
  getFromStore: (key: string) => ipcRenderer.invoke('get-from-store', key),

  // Spotify auth
  initiateSpotifyAuth: () => ipcRenderer.invoke('spotify-initiate-auth'),
  onSpotifyAuthComplete: (
    cb: (data: { accessToken: string; expiresIn: number; grantedScopes?: string }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { accessToken: string; expiresIn: number; grantedScopes?: string },
    ) => cb(data);
    ipcRenderer.on('spotify-auth-complete', handler);
    return () => ipcRenderer.removeListener('spotify-auth-complete', handler);
  },
  onSpotifyAuthError: (cb: (error: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) => cb(error);
    ipcRenderer.on('spotify-auth-error', handler);
    return () => ipcRenderer.removeListener('spotify-auth-error', handler);
  },
  onSpotifyScopeReset: (cb: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => cb(message);
    ipcRenderer.on('spotify-scope-reset', handler);
    return () => ipcRenderer.removeListener('spotify-scope-reset', handler);
  },
  getSpotifyToken: () => ipcRenderer.invoke('spotify-get-token'),
  refreshSpotifyToken: () => ipcRenderer.invoke('spotify-refresh-token'),
  onSpotifyTokenRefreshed: (cb: (data: { accessToken: string; expiresIn: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { accessToken: string; expiresIn: number }) => cb(data);
    ipcRenderer.on('spotify-token-refreshed', handler);
    return () => ipcRenderer.removeListener('spotify-token-refreshed', handler);
  },
  disconnectSpotify: () => ipcRenderer.invoke('spotify-disconnect'),
  getSpotifyClientId: () => ipcRenderer.invoke('spotify-get-client-id'),
  saveSpotifyClientId: (id: string) => ipcRenderer.invoke('spotify-save-client-id', id),
  getSpotifyLastGrantedScopes: () => ipcRenderer.invoke('spotify-get-last-granted-scopes'),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // File system - binary
  readFileBuffer: (path: string) => ipcRenderer.invoke('read-file-buffer', path),

  // Jingles
  saveJingle: (name: string, filePath: string, durationMs: number) =>
    ipcRenderer.invoke('save-jingle', name, filePath, durationMs),
  getJingles: () => ipcRenderer.invoke('get-jingles'),
  deleteJingle: (id: number) => ipcRenderer.invoke('delete-jingle', id),
  renameJingle: (id: number, name: string) => ipcRenderer.invoke('rename-jingle', id, name),

  // Ads
  saveAd: (name: string, filePath: string, durationMs: number) =>
    ipcRenderer.invoke('save-ad', name, filePath, durationMs),
  getAds: () => ipcRenderer.invoke('get-ads'),
  deleteAd: (id: number) => ipcRenderer.invoke('delete-ad', id),
  renameAd: (id: number, name: string) => ipcRenderer.invoke('rename-ad', id, name),

  // Automation Playlists
  savePlaylist: (name: string, steps: string) => ipcRenderer.invoke('save-playlist', name, steps),
  updatePlaylist: (id: number, name: string, steps: string) => ipcRenderer.invoke('update-playlist', id, name, steps),
  loadPlaylist: (id: number) => ipcRenderer.invoke('load-playlist', id),
  listPlaylists: () => ipcRenderer.invoke('list-playlists'),
  deletePlaylist: (id: number) => ipcRenderer.invoke('delete-playlist', id),

  listWeeklySlots: () => ipcRenderer.invoke('weekly-slots-list'),
  addWeeklySlot: (
    playlistId: number,
    dayOfWeek: number,
    startMinute: number,
    durationMinutes: number,
    maxDurationMs: number | null,
    label: string | null,
  ) => ipcRenderer.invoke('weekly-slots-add', playlistId, dayOfWeek, startMinute, durationMinutes, maxDurationMs, label),
  updateWeeklySlot: (
    id: number,
    playlistId: number,
    dayOfWeek: number,
    startMinute: number,
    durationMinutes: number,
    maxDurationMs: number | null,
    label: string | null,
  ) =>
    ipcRenderer.invoke('weekly-slots-update', id, playlistId, dayOfWeek, startMinute, durationMinutes, maxDurationMs, label),
  deleteWeeklySlot: (id: number) => ipcRenderer.invoke('weekly-slots-delete', id),
});
