import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import type { AccentColor, SongTransitionMode, ThemeMode, WebPlaybackPhase } from '@/store';
import { ACCENT_COLORS } from '@/store';
import Tooltip from '@/components/Tooltip';
import { openExternal } from '@/utils/openExternal';
import { clearSpotifyUserIdCache } from '@/services/spotify-api';
import { useTranslation } from 'react-i18next';

function webPlaybackHelp(t: (key: string) => string): Record<WebPlaybackPhase, string> {
  return {
    idle: t('settings.spotify.webPlayback.idle'),
    loading_sdk: t('settings.spotify.webPlayback.loadingSdk'),
    initializing: t('settings.spotify.webPlayback.initializing'),
    connecting: t('settings.spotify.webPlayback.connecting'),
    ready: t('settings.spotify.webPlayback.ready'),
    error: t('settings.spotify.webPlayback.error'),
  };
}

function accentSwatches(t: (key: string) => string): { id: AccentColor; label: string }[] {
  return [
    { id: 'green', label: t('settings.accent.green') },
    { id: 'blue', label: t('settings.accent.blue') },
    { id: 'purple', label: t('settings.accent.purple') },
    { id: 'orange', label: t('settings.accent.orange') },
    { id: 'red', label: t('settings.accent.red') },
  ];
}

function songTransitions(t: (key: string) => string): { id: SongTransitionMode; label: string }[] {
  return [
    { id: 'immediate', label: t('settings.transition.immediate') },
    { id: 'fade', label: t('settings.transition.fade') },
    { id: 'crossfade', label: t('settings.transition.crossfade') },
  ];
}

function shortcutLabel(id: string, t: (key: string, options?: { defaultValue?: string }) => string, fallback: string): string {
  if (id === 'play-pause') return t('settings.shortcuts.playPause', { defaultValue: fallback });
  if (id === 'stop') return t('settings.shortcuts.stop', { defaultValue: fallback });
  if (id === 'continue') return t('settings.shortcuts.continueAtPause', { defaultValue: fallback });
  if (id === 'search') return t('settings.shortcuts.openSpotifySearch', { defaultValue: fallback });
  if (id === 'live') return t('settings.shortcuts.toggleLiveMode', { defaultValue: fallback });
  return fallback;
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const WEB_PLAYBACK_HELP = webPlaybackHelp(t);
  const ACCENT_SWATCHES = accentSwatches(t);
  const SONG_TRANSITIONS = songTransitions(t);
  const [version, setVersion] = useState('dev');
  const connected = useStore((s) => s.connected);
  const webPlaybackPhase = useStore((s) => s.webPlaybackPhase);
  const webPlaybackLastError = useStore((s) => s.webPlaybackLastError);
  const user = useStore((s) => s.user);
  const userAvatar = useStore((s) => s.userAvatar);
  const clientId = useStore((s) => s.clientId);
  const setClientId = useStore((s) => s.setClientId);
  const addToast = useStore((s) => s.addToast);

  // Settings state
  const theme = useStore((s) => s.theme);
  const accentColor = useStore((s) => s.accentColor);
  const songTransitionMode = useStore((s) => s.songTransitionMode);
  const fadeInMs = useStore((s) => s.fadeInMs);
  const fadeOutMs = useStore((s) => s.fadeOutMs);
  const crossfadeMs = useStore((s) => s.crossfadeMs);
  const duckLevel = useStore((s) => s.duckLevel);
  const autoUpdate = useStore((s) => s.autoUpdate);
  const shortcuts = useStore((s) => s.shortcuts);
  const setTheme = useStore((s) => s.setTheme);
  const language = useStore((s) => s.language);
  const setLanguage = useStore((s) => s.setLanguage);
  const setAccentColor = useStore((s) => s.setAccentColor);
  const setSongTransitionMode = useStore((s) => s.setSongTransitionMode);
  const setFadeInMs = useStore((s) => s.setFadeInMs);
  const setFadeOutMs = useStore((s) => s.setFadeOutMs);
  const setCrossfadeMs = useStore((s) => s.setCrossfadeMs);
  const setDuckLevel = useStore((s) => s.setDuckLevel);
  const setAutoUpdate = useStore((s) => s.setAutoUpdate);
  const updateShortcut = useStore((s) => s.updateShortcut);

  const [clientIdInput, setClientIdInput] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const checkUpdateInFlight = useRef(false);
  const [rebindingId, setRebindingId] = useState<string | null>(null);
  const spotifyGrantedScopes = useStore((s) => s.spotifyGrantedScopes);
  const setCurrentPage = useStore((s) => s.setCurrentPage);

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
    // If connected, disconnect since the old session is now invalid
    if (connected) {
      await window.electronAPI?.disconnectSpotify();
      await window.electronAPI?.saveToStore('spotifyLastGrantedScopesDisplay', '');
      clearSpotifyUserIdCache();
      useStore.getState().disconnectSpotify();
      addToast(t('settings.spotify.saveClientIdSuccess', { defaultValue: 'Client ID saved. Spotify disconnected — please reconnect.' }), 'warning');
    } else {
      addToast(t('settings.spotify.saveClientIdSuccess', { defaultValue: 'Client ID saved.' }), 'success');
    }
  };

  const handleConnect = async () => {
    if (!clientId) {
      addToast(t('settings.spotify.enterClientId'), 'warning');
      return;
    }
    await window.electronAPI?.initiateSpotifyAuth();
  };

  const handleCheckForUpdates = async () => {
    const api = window.electronAPI;
    if (!api?.checkForUpdates || checkUpdateInFlight.current) return;
    checkUpdateInFlight.current = true;
    setCheckingUpdate(true);
    try {
      const r = await api.checkForUpdates();
      if (r == null || typeof r !== 'object' || typeof (r as { ok?: unknown }).ok !== 'boolean') {
        addToast(t('settings.updates.invalidResponse'), 'warning');
        return;
      }
      if (!r.ok) {
        if (r.reason === 'development') {
          addToast(t('settings.updates.devOnly'), 'info');
        } else if (r.reason === 'error') {
          addToast(r.message || t('settings.updates.couldNotCheck'), 'error');
        } else {
          addToast(t('settings.updates.unavailable'), 'warning');
        }
        return;
      }
      if (!r.isUpdateAvailable) {
        addToast(
          r.remoteVersion
            ? t('settings.updates.upToDateWithVersion', { version: r.remoteVersion })
            : t('settings.updates.upToDate'),
          'success',
        );
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : t('settings.updates.couldNotCheck'), 'error');
    } finally {
      checkUpdateInFlight.current = false;
      setCheckingUpdate(false);
    }
  };

  const handleDisconnect = async () => {
    await window.electronAPI?.disconnectSpotify();
    await window.electronAPI?.saveToStore('spotifyLastGrantedScopesDisplay', '');
    clearSpotifyUserIdCache();
    useStore.getState().disconnectSpotify();
    addToast(t('settings.spotify.disconnected'), 'info');
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
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setCurrentPage('studio')}
            className="shrink-0 p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            aria-label={t('settings.backToStudio')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-semibold text-text-primary truncate">{t('settings.title')}</h1>
        </div>
        <span className="text-xs text-text-muted bg-bg-elevated px-2 py-1 rounded shrink-0">v{version}</span>
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
          <span className="text-sm font-medium text-text-primary">{t('settings.sections.spotify')}</span>
          <div className="ml-auto flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-accent' : 'bg-danger'}`} />
            <span className="text-xs text-text-secondary">
              {connected ? t('settings.spotify.connectedAs', { user: user || '...' }) : t('settings.spotify.notConnected')}
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
              <p className="text-xs text-blue-300">{t('settings.spotify.infoBox')}</p>
              <button
                onClick={() => setShowHelp(!showHelp)}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
              >
                {t('settings.spotify.howToConnect')}
              </button>
            </div>
          </div>

          {/* Help panel */}
          {showHelp && (
            <div className="bg-bg-elevated rounded-lg px-4 py-3 text-xs text-text-secondary flex flex-col gap-2">
              <p className="font-medium text-text-primary">{t('settings.spotify.setupInstructions')}</p>
              <ol className="list-decimal list-inside flex flex-col gap-1.5 pl-1">
                <li>{t('settings.spotify.setup.step1')} <button onClick={() => openExternal('https://developer.spotify.com/dashboard')} className="text-accent hover:underline">developer.spotify.com/dashboard</button></li>
                <li>{t('settings.spotify.setup.step2')}</li>
                <li>{t('settings.spotify.setup.step3')}</li>
                <li>{t('settings.spotify.setup.step4')} <code className="bg-bg-primary px-1 py-0.5 rounded text-text-muted">http://127.0.0.1:8888/callback</code> {t('settings.spotify.setup.step4Suffix')}</li>
                <li>{t('settings.spotify.setup.step5')}</li>
                <li>{t('settings.spotify.setup.step6')}</li>
                <li>{t('settings.spotify.setup.step7')}</li>
                <li>{t('settings.spotify.setup.step8')}</li>
              </ol>
            </div>
          )}

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-100/95 leading-snug">
            {t('settings.spotify.warningText')}
          </div>

          {/* Client ID input */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-text-secondary" htmlFor="spotify-client-id">{t('settings.spotify.clientId')}</label>
              <Tooltip content={t('settings.spotify.clientIdTooltip')} placement="top">
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
                placeholder={t('onboarding.spotify.placeholder')}
                className="flex-1 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
              />
              <button
                onClick={handleSaveClientId}
                disabled={!clientIdInput.trim() || clientIdInput.trim() === clientId}
                className="px-3 py-2 bg-bg-elevated border border-border rounded-lg text-sm text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {t('common.save')}
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
                {t('settings.spotify.disconnect')}
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={!clientId}
                className="px-4 py-2 bg-accent text-white font-medium rounded-lg text-sm hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {t('settings.spotify.connect')}
              </button>
            )}
            {connected && userAvatar && (
              <img src={userAvatar} alt={user || ''} className="w-7 h-7 rounded-full" />
            )}
          </div>

          {connected && (
            <div className="text-[10px] leading-snug space-y-2">
              <p className="text-text-secondary">{t('settings.spotify.scopesHint')}</p>
              {spotifyGrantedScopes ? (
                <>
                  <textarea
                    readOnly
                    value={spotifyGrantedScopes}
                    rows={4}
                    className="w-full resize-y min-h-[4.5rem] bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-[10px] font-mono text-text-primary"
                    aria-label={t('settings.spotify.oauthScopesAria')}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(spotifyGrantedScopes).then(() => {
                        addToast(t('settings.spotify.scopesCopied'), 'success');
                      });
                    }}
                    className="text-[10px] text-accent hover:underline"
                  >
                    {t('settings.spotify.copyScopes')}
                  </button>
                </>
              ) : (
                <p className="text-text-muted text-[10px]">{t('settings.spotify.scopesNotLoaded')}</p>
              )}
            </div>
          )}

          {connected && (
            <div className="rounded-lg border border-border bg-bg-elevated/50 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-text-primary">{t('settings.spotify.inAppWebPlayer')}</span>
                <span
                  className={`text-[10px] uppercase tracking-wide font-semibold ${
                    webPlaybackPhase === 'ready'
                      ? 'text-accent'
                      : webPlaybackPhase === 'error'
                        ? 'text-danger'
                        : 'text-text-muted'
                  }`}
                >
                  {webPlaybackPhase.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-[11px] text-text-secondary leading-snug">{WEB_PLAYBACK_HELP[webPlaybackPhase]}</p>
              {webPlaybackLastError && (
                <pre className="text-[11px] text-danger/90 whitespace-pre-wrap break-words font-mono bg-bg-primary/80 rounded p-2 max-h-32 overflow-y-auto border border-danger/20">
                  {webPlaybackLastError}
                </pre>
              )}
              {window.electronAPI?.toggleDevTools ? (
                <button
                  type="button"
                  onClick={() => window.electronAPI.toggleDevTools()}
                  className="text-[11px] text-accent hover:underline underline-offset-2"
                >
                  {t('settings.spotify.openDevTools')}
                </button>
              ) : (
                <p className="text-[11px] text-text-muted">
                  {t('settings.spotify.devtoolsBrowserHelp')}{' '}
                  <kbd className="px-1 rounded bg-bg-primary font-mono text-text-secondary">F12</kbd> /{' '}
                  <kbd className="px-1 rounded bg-bg-primary font-mono text-text-secondary">⌥⌘I</kbd>.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Audio Defaults ──────────────────────────────────────────── */}
      <section className="bg-bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <span className="text-sm font-medium text-text-primary">{t('settings.sections.audioDefaults')}</span>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-text-secondary">{t('settings.transition.label')}</span>
              <Tooltip content={t('settings.transition.tooltip')} placement="top">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted cursor-help"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
              </Tooltip>
            </div>
            <div className="flex bg-bg-elevated rounded-lg p-0.5">
              {SONG_TRANSITIONS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSongTransitionMode(t.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    songTransitionMode === t.id ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-text-secondary" htmlFor="fade-in">{t('settings.transition.fadeInMs')}</label>
                <Tooltip content={t('settings.transition.fadeInTooltip')} placement="top">
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
                <label className="text-xs text-text-secondary" htmlFor="fade-out">{t('settings.transition.fadeOutMs')}</label>
                <Tooltip content={t('settings.transition.fadeOutTooltip')} placement="top">
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
                <label className="text-xs text-text-secondary" htmlFor="crossfade">{t('settings.transition.crossfadeMs')}</label>
                <Tooltip content={t('settings.transition.crossfadeTooltip')} placement="top">
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
                <label className="text-xs text-text-secondary" htmlFor="duck-level">{t('settings.transition.duckLevel')}</label>
                <Tooltip content={t('settings.transition.duckTooltip')} placement="top">
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
          <span className="text-sm font-medium text-text-primary">{t('settings.sections.updates')}</span>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">{t('settings.updates.currentVersion')}</span>
              <span className="text-xs text-text-muted bg-bg-elevated px-2 py-0.5 rounded">v{version}</span>
            </div>
            <button
              type="button"
              onClick={() => void handleCheckForUpdates()}
              disabled={checkingUpdate}
              className="px-3 py-1.5 bg-bg-elevated border border-border rounded-lg text-xs text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {checkingUpdate ? t('settings.updates.checking') : t('settings.updates.check')}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">{t('settings.updates.autoUpdateOnLaunch')}</span>
            <button
              onClick={() => setAutoUpdate(!autoUpdate)}
              className={`relative w-10 h-5 rounded-full transition-colors ${autoUpdate ? 'bg-accent' : 'bg-bg-elevated border border-border'}`}
              role="switch"
              aria-checked={autoUpdate}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoUpdate ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Appearance ──────────────────────────────────────────────── */}
      <section className="bg-bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <span className="text-sm font-medium text-text-primary">{t('settings.sections.appearance')}</span>
        </div>
        <div className="px-5 py-4 flex flex-col gap-5">
          {/* Theme toggle */}
          <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">{t('settings.theme.label', { defaultValue: 'Theme' })}</span>
            <div className="flex bg-bg-elevated rounded-lg p-0.5">
              {(['dark', 'light'] as ThemeMode[]).map((themeOption) => (
                <button
                  key={themeOption}
                  onClick={() => setTheme(themeOption)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                    theme === themeOption ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {t(`settings.theme.${themeOption}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">{t('settings.language.label')}</span>
            <div className="flex bg-bg-elevated rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => {
                  setLanguage('en');
                  void i18n.changeLanguage('en');
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  language === 'en' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                🇺🇸 {t('settings.language.en')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLanguage('pt');
                  void i18n.changeLanguage('pt');
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  language === 'pt' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                🇵🇹 {t('settings.language.pt')}
              </button>
            </div>
          </div>

          {/* Accent color */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">{t('settings.accentColor', { defaultValue: 'Accent color' })}</span>
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
          <span className="text-sm font-medium text-text-primary">{t('settings.sections.shortcuts')}</span>
        </div>
        <div className="divide-y divide-border">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.id} className="px-5 py-3 flex items-center justify-between">
              <span className="text-sm text-text-secondary">{shortcutLabel(shortcut.id, t, shortcut.label)}</span>
              <button
                onClick={() => setRebindingId(shortcut.id)}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                  rebindingId === shortcut.id
                    ? 'bg-accent/20 border border-accent text-accent animate-pulse'
                    : 'bg-bg-elevated border border-border text-text-primary hover:border-text-muted'
                }`}
              >
                {rebindingId === shortcut.id ? t('settings.shortcuts.pressKey') : formatShortcut(shortcut)}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
