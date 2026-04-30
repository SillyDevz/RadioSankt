import { BrowserWindow, shell } from 'electron';
import { createServer, type Server } from 'http';
import { URL } from 'url';
import Store from 'electron-store';

const store = new Store({ clearInvalidConfig: true });

const REDIRECT_URI = 'http://127.0.0.1:8888/callback';

/** Bump when `SCOPES` changes so stored tokens are discarded (refresh cannot widen scopes). */
const SPOTIFY_AUTH_SCOPE_VERSION = 3;

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  obtained_at: number;
}

/** Spotify can silently reuse an old consent unless we force the approval UI. */
function assertGrantIncludesPlaylistRead(scope: string | undefined, context: string): void {
  const parts = scope?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) {
    throw new Error(
      `${context}: Spotify returned no scopes. Remove this app at https://www.spotify.com/account/apps/ then connect again.`,
    );
  }
  if (!parts.includes('playlist-read-private')) {
    throw new Error(
      `${context}: Spotify did not grant playlist-read-private (got: ${scope?.trim() || '(empty)'}). Remove this app at https://www.spotify.com/account/apps/ then connect again so all permissions are requested.`,
    );
  }
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function initiateAuth(mainWindow: BrowserWindow): Promise<void> {
  const clientId = store.get('spotify-client-id') as string | undefined;
  if (!clientId) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('spotify-auth-error', 'No Client ID configured');
    }
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
    show_dialog: 'true',
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
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('spotify-auth-error', error);
          }
          shutdownServer();
          return;
        }

        if (code) {
          try {
            const tokenData = await exchangeCode(code, clientId, codeVerifier);
            storeTokens(tokenData);
            startTokenRefreshTimer(mainWindow, clientId);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            const scopeBlock = escapeHtml(tokenData.scope);
            res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Spotify connected</title></head><body style="margin:0;padding:28px;background:#0f0f0f;color:#e5e5e5;font-family:system-ui,sans-serif;box-sizing:border-box">
<h1 style="color:#1DB954;font-size:1.35rem;margin:0 0 12px">Connected to Spotify</h1>
<p style="font-size:14px;line-height:1.55;margin:0 0 14px;max-width:52ch">Spotify returned this <strong>scope</strong> list (what your access token may do). For “Your playlists” in the app, check that <code style="background:#262626;padding:2px 6px;border-radius:4px;color:#bef264">playlist-read-private</code> appears.</p>
<pre style="margin:0 0 18px;padding:14px;background:#161616;border:1px solid #2a2a2a;border-radius:10px;white-space:pre-wrap;word-break:break-all;font-size:12px;line-height:1.45;color:#d4d4d4;max-width:100%">${scopeBlock}</pre>
<p style="font-size:13px;color:#a3a3a3;margin:0">Keep this tab open until you’ve read it — then close it. The Radio Sankt window is already connected.</p>
</body></html>`);

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('spotify-auth-complete', {
                accessToken: tokenData.access_token,
                expiresIn: tokenData.expires_in,
                grantedScopes: tokenData.scope,
              });
            }
          } catch (err) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body style="background:#0f0f0f;color:#ef4444;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h2>Token exchange failed. You can close this tab.</h2></body></html>');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('spotify-auth-error', String(err));
            }
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

export function shutdownServer(): void {
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

  let res: Response;
  try {
    res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    throw new Error('Network error during Spotify login. Check your connection and try again.');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope?: string;
  };
  assertGrantIncludesPlaylistRead(data.scope, 'Spotify login');
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    token_type: data.token_type,
    scope: data.scope!,
    obtained_at: Date.now(),
  };
}

const SPOTIFY_SCOPE_PURGE_NOTICE = 'spotify-scope-purge-notice';

function purgeSpotifyCredentials(): void {
  stopTokenRefreshTimer();
  store.delete('spotify-tokens');
  store.delete('spotify-code-verifier');
  store.delete('spotify-auth-scope-version');
  store.delete('spotify-last-granted-scopes');
}

/** Drops sessions authorized before `SPOTIFY_AUTH_SCOPE_VERSION` (refresh cannot add scopes). */
function ensureCurrentSpotifyScopesOrLogout(): void {
  if (storedScopeVersionOk()) return;
  const hadTokens = Boolean(store.get('spotify-tokens'));
  purgeSpotifyCredentials();
  if (hadTokens) store.set(SPOTIFY_SCOPE_PURGE_NOTICE, true);
}

function storeTokens(
  data: Pick<TokenData, 'access_token' | 'refresh_token' | 'expires_in' | 'obtained_at'> & { scope?: string },
): void {
  store.set('spotify-tokens', {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    obtained_at: data.obtained_at,
  });
  store.set('spotify-auth-scope-version', SPOTIFY_AUTH_SCOPE_VERSION);
  if (data.scope != null && data.scope !== '') {
    store.set('spotify-last-granted-scopes', data.scope);
  }
}

function storedScopeVersionOk(): boolean {
  return (store.get('spotify-auth-scope-version') as number | undefined) === SPOTIFY_AUTH_SCOPE_VERSION;
}

export function consumeSpotifyScopePurgeNotice(): boolean {
  if (!store.get(SPOTIFY_SCOPE_PURGE_NOTICE)) return false;
  store.delete(SPOTIFY_SCOPE_PURGE_NOTICE);
  return true;
}

let refreshInFlight: Promise<string | null> | null = null;

export async function refreshToken(mainWindow: BrowserWindow | null): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefreshToken(mainWindow);
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function doRefreshToken(mainWindow: BrowserWindow | null): Promise<string | null> {
  ensureCurrentSpotifyScopesOrLogout();

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

    if (!res.ok) {
      if (res.status === 400 || res.status === 401) {
        // Refresh token revoked — force re-auth
        store.delete('spotify-tokens');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('spotify-auth-revoked');
        }
      }
      return null;
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };
    if (data.scope != null && data.scope !== '') {
      try {
        assertGrantIncludesPlaylistRead(data.scope, 'Spotify token refresh');
      } catch {
        const had = Boolean(store.get('spotify-tokens'));
        if (had) store.set(SPOTIFY_SCOPE_PURGE_NOTICE, true);
        purgeSpotifyCredentials();
        return null;
      }
    }
    storeTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_in: data.expires_in,
      obtained_at: Date.now(),
      scope: data.scope,
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
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
  ensureCurrentSpotifyScopesOrLogout();

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
  purgeSpotifyCredentials();
  store.delete(SPOTIFY_SCOPE_PURGE_NOTICE);
}

export function getClientId(): string | null {
  return (store.get('spotify-client-id') as string) || null;
}

/** Read from the same Store instance that `storeTokens` writes (main process must not use a second Store). */
export function getLastGrantedScopes(): string | null {
  return (store.get('spotify-last-granted-scopes') as string | undefined) ?? null;
}

export function setClientId(id: string): void {
  store.set('spotify-client-id', id);
}
