import { BrowserWindow, shell } from 'electron';
import { createServer, type Server } from 'http';
import { URL } from 'url';
import Store from 'electron-store';

const store = new Store();

const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  obtained_at: number;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let callbackServer: Server | null = null;

function base64URLEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function sha256(plain: string): Promise<Buffer> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(plain).digest();
}

function generateCodeVerifier(): string {
  const { randomBytes } = require('crypto');
  return base64URLEncode(randomBytes(32));
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await sha256(verifier);
  return base64URLEncode(hash);
}

export async function initiateAuth(mainWindow: BrowserWindow): Promise<void> {
  const clientId = store.get('spotify-client-id') as string | undefined;
  if (!clientId) {
    mainWindow.webContents.send('spotify-auth-error', 'No Client ID configured');
    return;
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store verifier for the exchange step
  store.set('spotify-code-verifier', codeVerifier);

  // Start temporary callback server
  await startCallbackServer(mainWindow, clientId, codeVerifier);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
  });

  const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;
  shell.openExternal(authUrl);
}

function startCallbackServer(
  mainWindow: BrowserWindow,
  clientId: string,
  codeVerifier: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Clean up any existing server
    if (callbackServer) {
      callbackServer.close();
      callbackServer = null;
    }

    callbackServer = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://127.0.0.1:8888`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body style="background:#0f0f0f;color:#ef4444;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h2>Authorization denied. You can close this tab.</h2></body></html>');
          mainWindow.webContents.send('spotify-auth-error', error);
          shutdownServer();
          return;
        }

        if (code) {
          try {
            const tokenData = await exchangeCode(code, clientId, codeVerifier);
            storeTokens(tokenData);
            startTokenRefreshTimer(mainWindow, clientId);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body style="background:#0f0f0f;color:#1DB954;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h2>Connected to Spotify! You can close this tab.</h2></body></html>');

            mainWindow.webContents.send('spotify-auth-complete', {
              accessToken: tokenData.access_token,
              expiresIn: tokenData.expires_in,
            });
          } catch (err) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body style="background:#0f0f0f;color:#ef4444;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h2>Token exchange failed. You can close this tab.</h2></body></html>');
            mainWindow.webContents.send('spotify-auth-error', String(err));
          }
          shutdownServer();
        }
      }
    });

    callbackServer.listen(8888, '127.0.0.1', () => resolve());
    callbackServer.on('error', reject);

    // Auto-close after 5 minutes if no callback
    setTimeout(() => shutdownServer(), 5 * 60 * 1000);
  });
}

function shutdownServer(): void {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
  }
}

async function exchangeCode(
  code: string,
  clientId: string,
  codeVerifier: string,
): Promise<TokenData> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as Omit<TokenData, 'obtained_at'>;
  return { ...data, obtained_at: Date.now() };
}

function storeTokens(data: Pick<TokenData, 'access_token' | 'refresh_token' | 'expires_in' | 'obtained_at'>): void {
  store.set('spotify-tokens', {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    obtained_at: data.obtained_at,
  });
}

export async function refreshToken(mainWindow: BrowserWindow | null): Promise<string | null> {
  const clientId = store.get('spotify-client-id') as string | undefined;
  const tokens = store.get('spotify-tokens') as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    obtained_at: number;
  } | undefined;

  if (!clientId || !tokens?.refresh_token) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  });

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as TokenData;
    storeTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_in: data.expires_in,
      obtained_at: Date.now(),
    });

    if (mainWindow) {
      mainWindow.webContents.send('spotify-token-refreshed', {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
      });
    }

    return data.access_token;
  } catch {
    return null;
  }
}

export function startTokenRefreshTimer(mainWindow: BrowserWindow, _clientId?: string): void {
  stopTokenRefreshTimer();

  // Check every 60 seconds if token needs refresh
  refreshTimer = setInterval(async () => {
    const tokens = store.get('spotify-tokens') as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      obtained_at: number;
    } | undefined;

    if (!tokens) return;

    const elapsed = (Date.now() - tokens.obtained_at) / 1000;
    const timeLeft = tokens.expires_in - elapsed;

    // Refresh 5 minutes before expiry
    if (timeLeft < 300) {
      await refreshToken(mainWindow);
    }
  }, 60_000);
}

export function stopTokenRefreshTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export function getStoredToken(): string | null {
  const tokens = store.get('spotify-tokens') as {
    access_token: string;
    expires_in: number;
    obtained_at: number;
  } | undefined;

  if (!tokens) return null;

  const elapsed = (Date.now() - tokens.obtained_at) / 1000;
  if (elapsed >= tokens.expires_in) return null;

  return tokens.access_token;
}

export function disconnect(): void {
  stopTokenRefreshTimer();
  store.delete('spotify-tokens');
  store.delete('spotify-code-verifier');
}

export function getClientId(): string | null {
  return (store.get('spotify-client-id') as string) || null;
}

export function setClientId(id: string): void {
  store.set('spotify-client-id', id);
}
