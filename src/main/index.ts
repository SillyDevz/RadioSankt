import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';
import { autoUpdater } from 'electron-updater';
import Store from 'electron-store';
import { join, resolve, normalize } from 'path';
import { existsSync, promises as fs } from 'fs';
import {
  saveJingle,
  getJingles,
  deleteJingle,
  renameJingle,
  saveAd,
  getAds,
  deleteAd,
  renameAd,
  getDatabase,
  savePlaylist,
  updatePlaylist,
  loadPlaylist,
  listPlaylists,
  deletePlaylist,
  listWeeklySlots,
  addWeeklySlot,
  updateWeeklySlot,
  deleteWeeklySlot,
} from './database';
import {
  initiateAuth,
  refreshToken,
  getStoredToken,
  disconnect,
  getClientId,
  setClientId,
  startTokenRefreshTimer,
  stopTokenRefreshTimer,
  consumeSpotifyScopePurgeNotice,
  getLastGrantedScopes,
} from './spotify-auth';

const store = new Store();
let mainWindow: BrowserWindow | null = null;
const GITHUB_OWNER = 'SillyDevz';
const GITHUB_REPO = 'RadioSankt';

type MainLocale = 'en' | 'pt';
type MainI18nKey = 'spotify.scopeReset';

const MAIN_I18N: Record<MainLocale, Record<MainI18nKey, string>> = {
  en: {
    'spotify.scopeReset':
      'Spotify login was reset: this version needs playlist permission. Open Settings and connect again.',
  },
  pt: {
    'spotify.scopeReset':
      'O login do Spotify foi redefinido: esta versão precisa de permissão de playlist. Abra Configurações e conecte novamente.',
  },
};

function currentLocale(): MainLocale {
  return store.get('language') === 'pt' ? 'pt' : 'en';
}

function tr(key: MainI18nKey): string {
  return MAIN_I18N[currentLocale()][key];
}

function windowIconPath(): string | undefined {
  const fromBuild = join(__dirname, '../renderer/icon.png');
  if (existsSync(fromBuild)) return fromBuild;
  const fromPublic = join(app.getAppPath(), 'public/icon.png');
  if (existsSync(fromPublic)) return fromPublic;
  return undefined;
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function compareSemver(a: string, b: string): number {
  const parse = (value: string) =>
    normalizeVersion(value)
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const [a0, a1, a2] = parse(a);
  const [b0, b1, b2] = parse(b);
  if (a0 !== b0) return a0 - b0;
  if (a1 !== b1) return a1 - b1;
  return a2 - b2;
}

function isGithubLatest404(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('404') && /github\.com/i.test(message);
}

async function resolveLatestReleaseVersion(): Promise<string | null> {
  const userAgent = `${app.getName()}/${app.getVersion()}`;
  const releasesUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=20`;
  const latestApiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  const latestWebUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': userAgent };
  try {
    const releasesRes = await fetch(releasesUrl, { headers });
    logUpdater(`[updater] fallback releases api status=${releasesRes.status}`);
    if (releasesRes.ok) {
      const releases = (await releasesRes.json()) as Array<{
        draft?: boolean;
        prerelease?: boolean;
        tag_name?: string;
      }>;
      const release = releases.find((item) => !item.draft && !item.prerelease && typeof item.tag_name === 'string');
      if (release?.tag_name) return normalizeVersion(release.tag_name);
    }
  } catch (error) {
    logUpdater(`[updater] fallback releases api error=${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const latestApiRes = await fetch(latestApiUrl, { headers });
    logUpdater(`[updater] fallback latest api status=${latestApiRes.status}`);
    if (latestApiRes.ok) {
      const latest = (await latestApiRes.json()) as { tag_name?: string };
      if (latest.tag_name) return normalizeVersion(latest.tag_name);
    }
  } catch (error) {
    logUpdater(`[updater] fallback latest api error=${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const latestWebRes = await fetch(latestWebUrl, {
      headers: { 'User-Agent': userAgent },
      redirect: 'manual',
    });
    logUpdater(`[updater] fallback latest web status=${latestWebRes.status}`);
    const location = latestWebRes.headers.get('location');
    if (location) {
      const match = location.match(/\/tag\/([^/?#]+)/i);
      if (match?.[1]) return normalizeVersion(decodeURIComponent(match[1]));
    }
  } catch (error) {
    logUpdater(`[updater] fallback latest web error=${error instanceof Error ? error.message : String(error)}`);
  }
  return null;
}

function logUpdater(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.info(line);
  void fs
    .appendFile(join(app.getPath('userData'), 'updater.log'), `${line}\n`, 'utf-8')
    .catch(() => {});
}

/** macOS Dock shows Electron’s icon in dev unless we set it (BrowserWindow `icon` does not). */
function applyDarwinDockIcon(): void {
  if (process.platform !== 'darwin') return;
  const icon = windowIconPath();
  if (!icon) return;
  app.dock?.setIcon(icon);
}

/** Radio Sankt uses Spotify Connect remote-control (not Web Playback SDK), so no EME/DRM
 *  permissions are required. This handler simply leaves defaults intact for Spotify's
 *  OAuth popup and local file previews. */
function allowPlaybackPermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true);
  });
  ses.setPermissionCheckHandler(() => true);
}

function createWindow(): void {
  const icon = windowIconPath();
  mainWindow = new BrowserWindow({
    ...(icon ? { icon } : {}),
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 14, y: 12 },
        }
      : {}),
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopTokenRefreshTimer();
  });

  // Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' as const }));

  // Start token refresh if we have stored tokens
  if (getStoredToken()) {
    startTokenRefreshTimer(mainWindow);
  }
}

// Auto-update (only in packaged builds)
function setupAutoUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', info);
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', info);
  });
}

// IPC handlers
function registerIpcHandlers(): void {
  ipcMain.handle(
    'check-for-updates',
    async (): Promise<
      | { ok: true; isUpdateAvailable: boolean; remoteVersion: string | null }
      | { ok: false; reason: 'development' | 'updater_inactive' | 'error'; message?: string }
    > => {
      if (!app.isPackaged) return { ok: false, reason: 'development' };
      try {
        logUpdater('[updater] manual check started');
        const result = await autoUpdater.checkForUpdates();
        logUpdater(
          `[updater] autoUpdater response available=${String(result?.isUpdateAvailable)} version=${result?.updateInfo?.version ?? 'null'}`,
        );
        if (result == null) return { ok: false, reason: 'updater_inactive' };
        return {
          ok: true,
          isUpdateAvailable: result.isUpdateAvailable,
          remoteVersion: result.updateInfo?.version ?? null,
        };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        logUpdater(`[updater] manual check error ${errorMessage}`);
        if (isGithubLatest404(e)) {
          logUpdater('[updater] github 404 detected, trying fallback');
          const remoteVersion = await resolveLatestReleaseVersion();
          if (remoteVersion) {
            logUpdater(
              `[updater] fallback resolved remoteVersion=${remoteVersion} currentVersion=${app.getVersion()}`,
            );
            return {
              ok: true,
              isUpdateAvailable: compareSemver(app.getVersion(), remoteVersion) < 0,
              remoteVersion,
            };
          }
          logUpdater('[updater] fallback did not resolve any release version');
        }
        return {
          ok: false,
          reason: 'error',
          message: errorMessage,
        };
      }
    },
  );

  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('open-file-dialog', async (_event, options) => {
    // Only allow safe options from the renderer
    return dialog.showOpenDialog({
      properties: options?.properties || ['openFile'],
      filters: options?.filters,
      title: options?.title,
    });
  });

  ipcMain.handle('read-file', async (_event, filePath: string) => {
    return fs.readFile(filePath, 'utf-8');
  });

  ipcMain.handle('save-to-store', (_event, key: string, value: unknown) => {
    store.set(key, value);
  });

  ipcMain.handle('get-from-store', (_event, key: string) => {
    return store.get(key);
  });

  // Spotify IPC
  ipcMain.handle('spotify-initiate-auth', async () => {
    if (mainWindow) await initiateAuth(mainWindow);
  });

  ipcMain.handle('spotify-get-token', () => {
    const token = getStoredToken();
    if (consumeSpotifyScopePurgeNotice()) {
      mainWindow?.webContents.send('spotify-scope-reset', tr('spotify.scopeReset'));
    }
    return token;
  });

  ipcMain.handle('toggle-devtools', () => {
    mainWindow?.webContents.toggleDevTools();
  });

  ipcMain.handle('spotify-refresh-token', async () => {
    const token = await refreshToken(mainWindow);
    if (consumeSpotifyScopePurgeNotice()) {
      mainWindow?.webContents.send('spotify-scope-reset', tr('spotify.scopeReset'));
    }
    return token;
  });

  ipcMain.handle('spotify-disconnect', () => {
    disconnect();
    store.delete('spotifyLastGrantedScopesDisplay');
  });

  ipcMain.handle('spotify-get-client-id', () => {
    return getClientId();
  });

  ipcMain.handle('spotify-get-last-granted-scopes', () => getLastGrantedScopes());

  ipcMain.handle('spotify-save-client-id', (_event, id: string) => {
    setClientId(id);
  });

  ipcMain.handle('open-external', (_event, url: string) => {
    // Only allow http/https URLs
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return shell.openExternal(url);
      }
    } catch {
      // Invalid URL
    }
    return Promise.resolve();
  });

  // File system - binary
  ipcMain.handle('read-file-buffer', async (_event, filePath: string) => {
    const buf = await fs.readFile(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  // Jingles
  ipcMain.handle('save-jingle', (_event, name: string, filePath: string, durationMs: number) => {
    return saveJingle(name, filePath, durationMs);
  });

  ipcMain.handle('get-jingles', () => {
    return getJingles();
  });

  ipcMain.handle('delete-jingle', (_event, id: number) => {
    deleteJingle(id);
  });

  ipcMain.handle('rename-jingle', (_event, id: number, name: string) => {
    renameJingle(id, name);
  });

  // Ads
  ipcMain.handle('save-ad', (_event, name: string, filePath: string, durationMs: number) => {
    return saveAd(name, filePath, durationMs);
  });

  ipcMain.handle('get-ads', () => {
    return getAds();
  });

  ipcMain.handle('delete-ad', (_event, id: number) => {
    deleteAd(id);
  });

  ipcMain.handle('rename-ad', (_event, id: number, name: string) => {
    renameAd(id, name);
  });

  // Automation Playlists
  ipcMain.handle('save-playlist', (_event, name: string, steps: string) => {
    return savePlaylist(name, steps);
  });

  ipcMain.handle('update-playlist', (_event, id: number, name: string, steps: string) => {
    updatePlaylist(id, name, steps);
  });

  ipcMain.handle('load-playlist', (_event, id: number) => {
    return loadPlaylist(id);
  });

  ipcMain.handle('list-playlists', () => {
    return listPlaylists();
  });

  ipcMain.handle('delete-playlist', (_event, id: number) => {
    deletePlaylist(id);
  });

  ipcMain.handle('weekly-slots-list', () => listWeeklySlots());

  ipcMain.handle(
    'weekly-slots-add',
    (
      _event,
      playlistId: number,
      dayOfWeek: number,
      startMinute: number,
      durationMinutes: number,
      maxDurationMs: number | null,
      label: string | null,
    ) => addWeeklySlot(playlistId, dayOfWeek, startMinute, durationMinutes, maxDurationMs, label),
  );

  ipcMain.handle(
    'weekly-slots-update',
    (
      _event,
      id: number,
      playlistId: number,
      dayOfWeek: number,
      startMinute: number,
      durationMinutes: number,
      maxDurationMs: number | null,
      label: string | null,
    ) => updateWeeklySlot(id, playlistId, dayOfWeek, startMinute, durationMinutes, maxDurationMs, label),
  );

  ipcMain.handle('weekly-slots-delete', (_event, id: number) => {
    deleteWeeklySlot(id);
  });
}

app.whenReady().then(async () => {
  allowPlaybackPermissions();
  getDatabase();
  registerIpcHandlers();

  applyDarwinDockIcon();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
