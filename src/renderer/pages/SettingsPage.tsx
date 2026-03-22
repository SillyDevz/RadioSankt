import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import type { AccentColor, ThemeMode } from '@/store';
import { ACCENT_COLORS } from '@/store';
import { getProfile } from '@/services/spotify-api';
import Tooltip from '@/components/Tooltip';

const ACCENT_SWATCHES: { id: AccentColor; label: string }[] = [
  { id: 'green', label: 'Spotify Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'purple', label: 'Purple' },
  { id: 'orange', label: 'Orange' },
  { id: 'red', label: 'Red' },
];

export default function SettingsPage() {
  const [version, setVersion] = useState('dev');
  const connected = useStore((s) => s.connected);
  const user = useStore((s) => s.user);
  const userAvatar = useStore((s) => s.userAvatar);
  const clientId = useStore((s) => s.clientId);
  const setConnected = useStore((s) => s.setConnected);
  const setUser = useStore((s) => s.setUser);
  const setUserAvatar = useStore((s) => s.setUserAvatar);
  const setToken = useStore((s) => s.setToken);
  const setClientId = useStore((s) => s.setClientId);
  const addToast = useStore((s) => s.addToast);

  // Settings state
  const theme = useStore((s) => s.theme);
  const accentColor = useStore((s) => s.accentColor);
  const fadeInMs = useStore((s) => s.fadeInMs);
  const fadeOutMs = useStore((s) => s.fadeOutMs);
  const crossfadeMs = useStore((s) => s.crossfadeMs);
  const duckLevel = useStore((s) => s.duckLevel);
  const autoUpdate = useStore((s) => s.autoUpdate);
  const githubRepo = useStore((s) => s.githubRepo);
  const shortcuts = useStore((s) => s.shortcuts);
  const setTheme = useStore((s) => s.setTheme);
  const setAccentColor = useStore((s) => s.setAccentColor);
  const setFadeInMs = useStore((s) => s.setFadeInMs);
  const setFadeOutMs = useStore((s) => s.setFadeOutMs);
  const setCrossfadeMs = useStore((s) => s.setCrossfadeMs);
  const setDuckLevel = useStore((s) => s.setDuckLevel);
  const setAutoUpdate = useStore((s) => s.setAutoUpdate);
  const setGithubRepo = useStore((s) => s.setGithubRepo);
  const updateShortcut = useStore((s) => s.updateShortcut);

  const [clientIdInput, setClientIdInput] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [githubRepoInput, setGithubRepoInput] = useState(githubRepo);
  const [rebindingId, setRebindingId] = useState<string | null>(null);

  // Load version
  useEffect(() => {
    window.electronAPI?.getAppVersion().then((v: string) => setVersion(v)).catch(() => {});
  }, []);

  // Load saved client ID
  useEffect(() => {
    window.electronAPI?.getSpotifyClientId().then((id) => {
      if (id) {
        setClientId(id);
        setClientIdInput(id);
      }
    }).catch(() => {});
  }, [setClientId]);

  // Check for existing token on mount
  useEffect(() => {
    window.electronAPI?.getSpotifyToken().then(async (token) => {
      if (token) {
        setToken(token);
        setConnected(true);
        try {
          const profile = await getProfile();
          setUser(profile.displayName);
          setUserAvatar(profile.avatar);
        } catch {
          // Token might be expired
        }
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for auth events
  useEffect(() => {
    const unsubComplete = window.electronAPI?.onSpotifyAuthComplete(async (data) => {
      setToken(data.accessToken);
      setConnected(true);
      addToast('Connected to Spotify', 'success');
      try {
        const profile = await getProfile();
        setUser(profile.displayName);
        setUserAvatar(profile.avatar);
      } catch {
        // Profile fetch failed
      }
    });

    const unsubError = window.electronAPI?.onSpotifyAuthError((error) => {
      addToast(`Spotify auth failed: ${error}`, 'error');
    });

    const unsubRefresh = window.electronAPI?.onSpotifyTokenRefreshed((data) => {
      setToken(data.accessToken);
    });

    return () => {
      unsubComplete?.();
      unsubError?.();
      unsubRefresh?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard rebinding listener
  useEffect(() => {
    if (!rebindingId) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRebindingId(null);
        return;
      }

      const modifiers: string[] = [];
      if (e.metaKey) modifiers.push('Meta');
      if (e.ctrlKey) modifiers.push('Ctrl');
      if (e.altKey) modifiers.push('Alt');
      if (e.shiftKey) modifiers.push('Shift');

      // Don't capture modifier-only presses
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;

      const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      updateShortcut(rebindingId, key, modifiers);
      setRebindingId(null);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [rebindingId, updateShortcut]);

  const handleSaveClientId = async () => {
    const trimmed = clientIdInput.trim();
    if (!trimmed) return;
    await window.electronAPI?.saveSpotifyClientId(trimmed);
    setClientId(trimmed);
    addToast('Client ID saved', 'success');
  };

  const handleConnect = async () => {
    if (!clientId) {
      addToast('Enter your Client ID first', 'warning');
      return;
    }
    await window.electronAPI?.initiateSpotifyAuth();
  };

  const handleDisconnect = async () => {
    await window.electronAPI?.disconnectSpotify();
    setConnected(false);
    setUser(null);
    setUserAvatar(null);
    setToken(null);
    useStore.getState().disconnectSpotify();
    addToast('Disconnected from Spotify', 'info');
  };

  function formatShortcut(shortcut: { key: string; modifiers: string[] }): string {
    const parts = [...shortcut.modifiers.map((m) => {
      if (m === 'Meta') return navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
      if (m === 'Ctrl') return 'Ctrl';
      if (m === 'Alt') return navigator.platform.includes('Mac') ? '⌥' : 'Alt';
      if (m === 'Shift') return '⇧';
      return m;
    }), shortcut.key];
    return parts.join('+');
  }

  return (
    <div className="max-w-[640px] mx-auto py-8 flex flex-col gap-6 animate-page-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Settings</h1>
        <span className="text-xs text-text-muted bg-bg-elevated px-2 py-1 rounded">v{version}</span>
      </div>

      {/* ── Spotify ─────────────────────────────────────────────────── */}
      <section className="bg-bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <svg width="20" height="20" viewBox="0 0 24 24" className="text-accent shrink-0">
            <path
              fill="currentColor"
              d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"
            />
          </svg>
          <span className="text-sm font-medium text-text-primary">Spotify</span>
          <div className="ml-auto flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-accent' : 'bg-danger'}`} />
            <span className="text-xs text-text-secondary">
              {connected ? `Connected as ${user || '...'}` : 'Not connected'}
            </span>
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Info box */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3 flex items-start gap-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <div className="flex-1">
              <p className="text-xs text-blue-300">
                You need a free Spotify Developer account to use this app. Click "How to connect" to learn more.
              </p>
              <button
                onClick={() => setShowHelp(!showHelp)}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
              >
                How to connect
              </button>
            </div>
          </div>

          {/* Help panel */}
          {showHelp && (
            <div className="bg-bg-elevated rounded-lg px-4 py-3 text-xs text-text-secondary flex flex-col gap-2">
              <p className="font-medium text-text-primary">Setup instructions:</p>
              <ol className="list-decimal list-inside flex flex-col gap-1.5 pl-1">
                <li>Go to <button onClick={() => window.electronAPI?.openExternal('https://developer.spotify.com/dashboard')} className="text-accent hover:underline">developer.spotify.com/dashboard</button></li>
                <li>Log in with your Spotify account (free or premium)</li>
                <li>Click "Create app"</li>
                <li>Set the Redirect URI to <code className="bg-bg-primary px-1 py-0.5 rounded text-text-muted">http://localhost:8888/callback</code></li>
                <li>Check "Web Playback SDK" under APIs used</li>
                <li>Copy the Client ID and paste it below</li>
                <li>Click "Connect"</li>
              </ol>
            </div>
          )}

          {/* Client ID input */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-text-secondary" htmlFor="spotify-client-id">Client ID</label>
              <Tooltip content="Your Spotify app's Client ID from developer.spotify.com/dashboard" placement="top">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted cursor-help">
                  <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />
                </svg>
              </Tooltip>
            </div>
            <div className="flex gap-2">
              <input
                id="spotify-client-id"
                type="text"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                placeholder="Paste your Client ID here"
                className="flex-1 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
              />
              <button
                onClick={handleSaveClientId}
                disabled={!clientIdInput.trim() || clientIdInput.trim() === clientId}
                className="px-3 py-2 bg-bg-elevated border border-border rounded-lg text-sm text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>

          {/* Connect / Disconnect */}
          <div className="flex items-center gap-3">
            {connected ? (
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 bg-danger/10 border border-danger/20 text-danger rounded-lg text-sm hover:bg-danger/20 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={!clientId}
                className="px-4 py-2 bg-accent text-white font-medium rounded-lg text-sm hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Connect
              </button>
            )}
            {connected && userAvatar && (
              <img src={userAvatar} alt={user || ''} className="w-7 h-7 rounded-full" />
            )}
          </div>
        </div>
      </section>

      {/* ── Audio Defaults ──────────────────────────────────────────── */}
      <section className="bg-bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <span className="text-sm font-medium text-text-primary">Audio Defaults</span>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-text-secondary" htmlFor="fade-in">Fade in (ms)</label>
                <Tooltip content="Default duration for fading audio in when a track starts" placement="top">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted cursor-help"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
                </Tooltip>
              </div>
              <input
                id="fade-in"
                type="number"
                min={0}
                max={10000}
                step={100}
                value={fadeInMs}
                onChange={(e) => setFadeInMs(Number(e.target.value))}
                className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent transition-colors w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-text-secondary" htmlFor="fade-out">Fade out (ms)</label>
                <Tooltip content="Default duration for fading audio out when a track ends" placement="top">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted cursor-help"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
                </Tooltip>
              </div>
              <input
                id="fade-out"
                type="number"
                min={0}
                max={10000}
                step={100}
                value={fadeOutMs}
                onChange={(e) => setFadeOutMs(Number(e.target.value))}
                className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent transition-colors w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-text-secondary" htmlFor="crossfade">Crossfade (ms)</label>
                <Tooltip content="Duration of the overlap when crossfading between two tracks" placement="top">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted cursor-help"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
                </Tooltip>
              </div>
              <input
                id="crossfade"
                type="number"
                min={0}
                max={10000}
                step={100}
                value={crossfadeMs}
                onChange={(e) => setCrossfadeMs(Number(e.target.value))}
                className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent transition-colors w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-text-secondary" htmlFor="duck-level">Duck level (%)</label>
                <Tooltip content="How much to reduce music volume when a jingle plays over it. Lower = quieter music." placement="top">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted cursor-help"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
                </Tooltip>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="duck-level"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={duckLevel}
                  onChange={(e) => setDuckLevel(Number(e.target.value))}
                  className="flex-1 h-1 accent-accent bg-bg-elevated rounded-full appearance-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
                />
                <span className="text-xs text-text-secondary tabular-nums w-8 text-right">{duckLevel}%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Updates ─────────────────────────────────────────────────── */}
      <section className="bg-bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <span className="text-sm font-medium text-text-primary">Updates</span>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">Current version</span>
              <span className="text-xs text-text-muted bg-bg-elevated px-2 py-0.5 rounded">v{version}</span>
            </div>
            <button
              onClick={() => window.electronAPI?.checkForUpdates()}
              className="px-3 py-1.5 bg-bg-elevated border border-border rounded-lg text-xs text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
            >
              Check for updates
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Auto-update on launch</span>
            <button
              onClick={() => setAutoUpdate(!autoUpdate)}
              className={`relative w-10 h-5 rounded-full transition-colors ${autoUpdate ? 'bg-accent' : 'bg-bg-elevated border border-border'}`}
              role="switch"
              aria-checked={autoUpdate}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoUpdate ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-text-secondary" htmlFor="github-repo">GitHub repository (owner/repo)</label>
            <div className="flex gap-2">
              <input
                id="github-repo"
                type="text"
                value={githubRepoInput}
                onChange={(e) => setGithubRepoInput(e.target.value)}
                placeholder="owner/repo"
                className="flex-1 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
              />
              <button
                onClick={() => { setGithubRepo(githubRepoInput.trim()); addToast('Repository saved', 'success'); }}
                disabled={!githubRepoInput.trim() || githubRepoInput.trim() === githubRepo}
                className="px-3 py-2 bg-bg-elevated border border-border rounded-lg text-sm text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Appearance ──────────────────────────────────────────────── */}
      <section className="bg-bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <span className="text-sm font-medium text-text-primary">Appearance</span>
        </div>
        <div className="px-5 py-4 flex flex-col gap-5">
          {/* Theme toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Theme</span>
            <div className="flex bg-bg-elevated rounded-lg p-0.5">
              {(['dark', 'light'] as ThemeMode[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                    theme === t ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Accent color */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Accent color</span>
            <div className="flex gap-2">
              {ACCENT_SWATCHES.map(({ id, label }) => (
                <Tooltip key={id} content={label} placement="top">
                  <button
                    onClick={() => setAccentColor(id)}
                    className={`w-7 h-7 rounded-full transition-all ${
                      accentColor === id ? 'ring-2 ring-offset-2 ring-offset-bg-surface scale-110' : 'hover:scale-105'
                    }`}
                    style={{
                      backgroundColor: ACCENT_COLORS[id].primary,
                      outlineColor: accentColor === id ? ACCENT_COLORS[id].primary : undefined,
                    }}
                    aria-label={label}
                  />
                </Tooltip>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Keyboard Shortcuts ──────────────────────────────────────── */}
      <section className="bg-bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <span className="text-sm font-medium text-text-primary">Keyboard Shortcuts</span>
        </div>
        <div className="divide-y divide-border">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.id} className="px-5 py-3 flex items-center justify-between">
              <span className="text-sm text-text-secondary">{shortcut.label}</span>
              <button
                onClick={() => setRebindingId(shortcut.id)}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                  rebindingId === shortcut.id
                    ? 'bg-accent/20 border border-accent text-accent animate-pulse'
                    : 'bg-bg-elevated border border-border text-text-primary hover:border-text-muted'
                }`}
              >
                {rebindingId === shortcut.id ? 'Press a key...' : formatShortcut(shortcut)}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
