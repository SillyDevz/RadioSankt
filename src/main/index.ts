import { app, BrowserWindow, ipcMain, dialog, shell, components, session } from 'electron';
import { autoUpdater } from 'electron-updater';
import Store from 'electron-store';
import { join, resolve, normalize, dirname, sep } from 'path';
import { existsSync, promises as fs, appendFileSync, readFileSync, readdirSync, Dirent } from 'fs';
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

/** Spotify / Widevine need EME; denying unknown permission checks can block CDM registration. */
function allowPlaybackPermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true);
  });
  ses.setPermissionCheckHandler(() => true);
}

function appendWidevineDebugLog(message: string): void {
  if (process.platform !== 'win32') return;
  try {
    const logPath = join(app.getPath('userData'), 'widevine-debug.log');
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // Ignore logging failures; diagnostics must never block startup.
  }
}

function configureWidevineFrom(manifestPath: string, adapterPath: string, sourceLabel: string): boolean {
  if (!existsSync(manifestPath) || !existsSync(adapterPath)) {
    appendWidevineDebugLog(
      `[Widevine] candidate missing (${sourceLabel}) manifest=${manifestPath} adapter=${adapterPath}`,
    );
    return false;
  }

  try {
    const manifestRaw = readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw) as { version?: string };
    const version = manifest.version?.trim();
    if (!version) {
      appendWidevineDebugLog(`[Widevine] candidate invalid (${sourceLabel}) manifest has no version`);
      return false;
    }

    app.commandLine.appendSwitch('widevine-cdm-path', adapterPath);
    app.commandLine.appendSwitch('widevine-cdm-version', version);
    console.log('[Widevine] using bundled CDM:', { sourceLabel, adapterPath, version });
    appendWidevineDebugLog(
      `[Widevine] configured (${sourceLabel}) path=${adapterPath} version=${version}`,
    );
    return true;
  } catch (e) {
    console.warn('[Widevine] Failed to configure CDM candidate:', sourceLabel, e);
    appendWidevineDebugLog(
      `[Widevine] candidate threw (${sourceLabel}) error=${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`,
    );
    return false;
  }
}

function collectWidevineDllCandidates(rootDir: string, depth: number): string[] {
  if (depth < 0 || !existsSync(rootDir)) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const dlls: string[] = [];
  for (const entry of entries) {
    const full = join(rootDir, entry.name);
    if (
      entry.isFile() &&
      (entry.name.toLowerCase() === 'widevinecdmadapter.dll' || entry.name.toLowerCase() === 'widevinecdm.dll')
    ) {
      dlls.push(full);
      continue;
    }
    if (entry.isDirectory()) {
      dlls.push(...collectWidevineDllCandidates(full, depth - 1));
    }
  }
  return dlls;
}

function inferWidevineVersionFromDllPath(dllPath: string): string | null {
  const parts = dllPath.split(/[/\\]+/);
  for (const p of parts) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(p)) return p;
  }
  return null;
}

function configureWidevineFromRoot(rootDir: string, sourceLabel: string): boolean {
  const dllCandidates = collectWidevineDllCandidates(rootDir, 6);
  if (dllCandidates.length === 0) {
    appendWidevineDebugLog(`[Widevine] no Widevine DLL found under root (${sourceLabel}) root=${rootDir}`);
    return false;
  }

  // Prefer adapter DLL when available, otherwise fall back to widevinecdm.dll layouts.
  dllCandidates.sort((a, b) => {
    const aIsAdapter = a.toLowerCase().endsWith('widevinecdmadapter.dll');
    const bIsAdapter = b.toLowerCase().endsWith('widevinecdmadapter.dll');
    return Number(bIsAdapter) - Number(aIsAdapter);
  });

  for (const adapterPath of dllCandidates) {
    const normalized = adapterPath.replace(/\\/g, '/');
    const platformMarker = '/_platform_specific/win_x64/';
    const markerIdx = normalized.lastIndexOf(platformMarker);
    if (markerIdx === -1) continue;
    const baseDir = normalized.slice(0, markerIdx);
    const manifestPath = `${baseDir}/manifest.json`.replace(/\//g, sep);
    if (configureWidevineFrom(manifestPath, adapterPath, `${sourceLabel}:manifest-near-dll`)) {
      return true;
    }

    const inferred = inferWidevineVersionFromDllPath(adapterPath);
    if (inferred) {
      app.commandLine.appendSwitch('widevine-cdm-path', adapterPath);
      app.commandLine.appendSwitch('widevine-cdm-version', inferred);
      console.log('[Widevine] using inferred CDM version:', { sourceLabel, adapterPath, inferred });
      appendWidevineDebugLog(
        `[Widevine] configured (${sourceLabel}:inferred-version) path=${adapterPath} version=${inferred}`,
      );
      return true;
    }

    appendWidevineDebugLog(`[Widevine] dll found but no manifest/version (${sourceLabel}) path=${adapterPath}`);
  }

  return false;
}

function configureBundledWidevineCdm(): void {
  if (process.platform !== 'win32') return;

  // On some Windows installs, the default CDM resolution yields "CreateCdmFunc not available".
  // Try known ECS/component locations in priority order and log each attempt.
  const runtimeDir = dirname(process.execPath);
  const candidates: Array<{
    sourceLabel: string;
    manifestPath: string;
    adapterPath: string;
    fallbackPath: string;
    rootDir: string;
  }> = [
    {
      sourceLabel: 'runtimeDir',
      manifestPath: join(runtimeDir, 'WidevineCdm', 'manifest.json'),
      adapterPath: join(runtimeDir, 'WidevineCdm', '_platform_specific', 'win_x64', 'widevinecdmadapter.dll'),
      fallbackPath: join(runtimeDir, 'WidevineCdm', '_platform_specific', 'win_x64', 'widevinecdm.dll'),
      rootDir: join(runtimeDir, 'WidevineCdm'),
    },
    {
      sourceLabel: 'resourcesPath',
      manifestPath: join(process.resourcesPath, 'WidevineCdm', 'manifest.json'),
      adapterPath: join(process.resourcesPath, 'WidevineCdm', '_platform_specific', 'win_x64', 'widevinecdmadapter.dll'),
      fallbackPath: join(process.resourcesPath, 'WidevineCdm', '_platform_specific', 'win_x64', 'widevinecdm.dll'),
      rootDir: join(process.resourcesPath, 'WidevineCdm'),
    },
    {
      sourceLabel: 'userData',
      manifestPath: join(app.getPath('userData'), 'WidevineCdm', 'manifest.json'),
      adapterPath: join(app.getPath('userData'), 'WidevineCdm', '_platform_specific', 'win_x64', 'widevinecdmadapter.dll'),
      fallbackPath: join(app.getPath('userData'), 'WidevineCdm', '_platform_specific', 'win_x64', 'widevinecdm.dll'),
      rootDir: join(app.getPath('userData'), 'WidevineCdm'),
    },
  ];

  for (const candidate of candidates) {
    if (configureWidevineFrom(candidate.manifestPath, candidate.adapterPath, candidate.sourceLabel)) {
      return;
    }
    if (configureWidevineFrom(candidate.manifestPath, candidate.fallbackPath, `${candidate.sourceLabel}:fallback-cdm`)) {
      return;
    }
    if (configureWidevineFromRoot(candidate.rootDir, `${candidate.sourceLabel}:root-scan`)) {
      return;
    }
  }

  console.warn('[Widevine] No usable CDM candidate found; using default component updater path.');
  appendWidevineDebugLog('[Widevine] no candidate configured; default updater path will be used');
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

configureBundledWidevineCdm();

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
