import { app, BrowserWindow, ipcMain, dialog, shell, components } from 'electron';
import { autoUpdater } from 'electron-updater';
import Store from 'electron-store';
import { join, resolve, normalize } from 'path';
import { promises as fs } from 'fs';
import {
  saveJingle,
  getJingles,
  deleteJingle,
  renameJingle,
  getDatabase,
  savePlaylist,
  updatePlaylist,
  loadPlaylist,
  listPlaylists,
  deletePlaylist,
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
} from './spotify-auth';

const store = new Store();
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
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
  ipcMain.handle('check-for-updates', () => {
    if (!app.isPackaged) return null;
    return autoUpdater.checkForUpdates();
  });

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
    return getStoredToken();
  });

  ipcMain.handle('spotify-refresh-token', async () => {
    return refreshToken(mainWindow);
  });

  ipcMain.handle('spotify-disconnect', () => {
    disconnect();
  });

  ipcMain.handle('spotify-get-client-id', () => {
    return getClientId();
  });

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
}

app.whenReady().then(async () => {
  try {
    await components.whenReady();
    console.log('Widevine CDM loaded');
  } catch (e) {
    console.warn('Widevine CDM not available:', e);
  }
  getDatabase();
  registerIpcHandlers();
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
