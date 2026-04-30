import { app, BrowserWindow, ipcMain, dialog, shell, components, session } from 'electron';
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
  shutdownServer,
} from './spotify-auth';

const store = new Store({ clearInvalidConfig: true });
let mainWindow: BrowserWindow | null = null;

type MainLocale = 'en' | 'pt';
type MainI18nKey =
  | 'spotify.scopeReset'
  | 'widevine.title'
  | 'widevine.message'
  | 'widevine.commonCauses'
  | 'widevine.versionHint';

const MAIN_I18N: Record<MainLocale, Record<MainI18nKey, string>> = {
  en: {
    'spotify.scopeReset':
      'Spotify login was reset: this version needs playlist permission. Open Settings and connect again.',
    'widevine.title': 'Widevine (DRM)',
    'widevine.message':
      'The Widevine CDM is not usable. Spotify in-app playback needs a working CDM from Google Component Updater.',
    'widevine.commonCauses':
      'Common causes:\n• Using an old Electron/Chromium line.\n• Network / proxy blocking component downloads.\n• Linux: after first CDM download, fully quit and reopen the app.',
    'widevine.versionHint':
      'Your node_modules/electron package should show a 41.x.x+wvcus style version in package.json.',
  },
  pt: {
    'spotify.scopeReset':
      'O login do Spotify foi redefinido: esta versão precisa de permissão de playlist. Abra Configurações e conecte novamente.',
    'widevine.title': 'Widevine (DRM)',
    'widevine.message':
      'O CDM Widevine não está utilizável. A reprodução no Spotify dentro do app precisa do CDM do Google Component Updater.',
    'widevine.commonCauses':
      'Causas comuns:\n• Usar uma versão antiga de Electron/Chromium.\n• Rede/proxy bloqueando download de componentes.\n• Linux: após o primeiro download do CDM, feche totalmente e abra novamente.',
    'widevine.versionHint':
      'Seu pacote node_modules/electron deve mostrar versão no formato 41.x.x+wvcus no package.json.',
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

/** macOS Dock shows Electron’s icon in dev unless we set it (BrowserWindow `icon` does not). */
function applyDarwinDockIcon(): void {
  if (process.platform !== 'darwin') return;
  const icon = windowIconPath();
  if (!icon) return;
  app.dock?.setIcon(icon);
}

/** Spotify / Widevine need EME; only grant playback-related permissions. */
function allowPlaybackPermissions(): void {
  const ALLOWED_PERMISSIONS = new Set(['media', 'mediaKeySystem', 'protected-media-identifier']);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

/** Restrict file reads to safe directories (userData, music, home). */
function isAllowedReadPath(filePath: string): boolean {
  const resolved = resolve(normalize(filePath));
  const userData = app.getPath('userData');
  const home = app.getPath('home');
  const musicDir = app.getPath('music');
  return resolved.startsWith(userData) || resolved.startsWith(musicDir) || resolved.startsWith(home);
}

function createWindow(): void {
  const icon = windowIconPath();
  mainWindow = new BrowserWindow({
    ...(icon ? { icon } : {}),
    width: 1280,
    height: 800,
    minWidth: 1080,
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
      // Widevine / EME (Spotify Web Playback) does not initialize with a sandboxed renderer on ECS.
      sandbox: false,
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
    shutdownServer();
    mainWindow = null;
    stopTokenRefreshTimer();
  });

  // Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) {
      const urlPath = decodeURI(new URL(url).pathname);
      const normalizedUrlPath = resolve(urlPath);
      const normalizedAppDir = resolve(app.getAppPath());
      if (normalizedUrlPath.startsWith(normalizedAppDir)) return;
    }
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

  const autoUpdateEnabled = store.get('autoUpdate');
  if (autoUpdateEnabled === false) return;

  autoUpdater.autoInstallOnAppQuit = false;
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
        const result = await autoUpdater.checkForUpdates();
        if (result == null) return { ok: false, reason: 'updater_inactive' };
        return {
          ok: true,
          isUpdateAvailable: result.isUpdateAvailable,
          remoteVersion: result.updateInfo?.version ?? null,
        };
      } catch (e) {
        return {
          ok: false,
          reason: 'error',
          message: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle('quit-and-install', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app-will-quit');
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  const ALLOWED_DIALOG_PROPS = new Set(['openFile', 'multiSelections', 'openDirectory']);

  ipcMain.handle('open-file-dialog', async (_event, options) => {
    const properties = (options?.properties || ['openFile']).filter((p: string) =>
      ALLOWED_DIALOG_PROPS.has(p),
    );
    return dialog.showOpenDialog({ properties, filters: options?.filters, title: options?.title });
  });

  ipcMain.handle('read-file', async (_event, filePath: string) => {
    if (!isAllowedReadPath(filePath)) throw new Error('Access denied');
    return fs.readFile(filePath, 'utf-8');
  });

  const RENDERER_WRITABLE_KEYS = new Set([
    'language',
    'theme',
    'accentColor',
    'volume',
    'shortcuts',
    'cartWall',
    'workspaceLayout',
    'hasCompletedOnboarding',
    'seenCoachMarks',
    'quickFireSlots',
    'songTransitionMode',
    'fadeInMs',
    'fadeOutMs',
    'crossfadeMs',
    'duckLevel',
    'autoUpdate',
    'followProgramSchedule',
    'spotifyLastGrantedScopesDisplay',
    'automationSession',
  ]);

  ipcMain.handle('save-to-store', (_event, key: string, value: unknown) => {
    if (!RENDERER_WRITABLE_KEYS.has(key)) return;
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
    if (!app.isPackaged) {
      mainWindow?.webContents.toggleDevTools();
    }
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
    if (!isAllowedReadPath(filePath)) throw new Error('Access denied');
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

function formatWidevineFailure(e: unknown): string {
  const lines: string[] = [];
  const walk = (x: unknown, indent: string): void => {
    if (x == null) {
      lines.push(`${indent}${String(x)}`);
      return;
    }
    if (x instanceof Error) {
      lines.push(`${indent}${x.name}: ${x.message}`);
      const ext = x as Error & { detail?: unknown; errors?: unknown[] };
      if (ext.detail !== undefined) {
        lines.push(`${indent}detail:`);
        walk(ext.detail, `${indent}  `);
      }
      if (Array.isArray(ext.errors)) {
        ext.errors.forEach((sub, i) => {
          lines.push(`${indent}[${i}]`);
          walk(sub, `${indent}  `);
        });
      }
      return;
    }
    if (typeof x === 'object') {
      try {
        lines.push(`${indent}${JSON.stringify(x, null, 2).split('\n').join(`\n${indent}`)}`);
      } catch {
        lines.push(`${indent}${Object.prototype.toString.call(x)}`);
      }
      return;
    }
    lines.push(`${indent}${String(x)}`);
  };
  walk(e, '');
  return lines.join('\n');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  allowPlaybackPermissions();
  getDatabase();
  registerIpcHandlers();

  const widevineId = components.WIDEVINE_CDM_ID;
  console.log('[Widevine] userData:', app.getPath('userData'));
  console.log('[Widevine] WIDEVINE_CDM_ID:', widevineId);
  console.log('[Widevine] component updates enabled:', components.updatesEnabled);

  try {
    await components.whenReady([widevineId]);
    const st = components.status()[widevineId];
    console.log('[Widevine] component status:', st);
    if (!st?.version) {
      throw new Error(
        `Widevine CDM has no version (status: ${JSON.stringify(st)}). Component Updater could not install DRM — often fixed by upgrading to a supported Castlabs Electron line (see package.json).`,
      );
    }
  } catch (e) {
    console.error('[Widevine] CDM setup failed:', e);
    const detail = formatWidevineFailure(e);
    void dialog.showMessageBox({
      type: 'warning',
      title: tr('widevine.title'),
      message: tr('widevine.message'),
      detail: `${detail}

${tr('widevine.commonCauses')}

${tr('widevine.versionHint')}`,
    });
  }

  applyDarwinDockIcon();
  createWindow();
  setupAutoUpdater();

  app.on('before-quit', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app-will-quit');
    }
  });

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
