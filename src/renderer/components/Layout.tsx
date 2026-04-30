import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { useStore, WidgetLayout } from '@/store';
import type { Page, CoachMarkId, AccentColor, ThemeMode, SongTransitionMode } from '@/store';
import { ACCENT_COLORS } from '@/store';
import { clearSpotifyUserIdCache, getProfile } from '@/services/spotify-api';
import MacTitleBarInset from './MacTitleBarInset';
import NowPlayingBar from './NowPlayingBar';
import ToastContainer from './Toast';
import OnboardingWizard from './OnboardingWizard';
import type { ComponentType } from 'react';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import {
  hydrateAutomationSession,
  initAutomationSessionPersistence,
  loadAutomationSession,
  resetWeeklyScheduleFireKeys,
  runScheduleTick,
} from '@/services/automation-session';
import AutomationEngine from '@/engine/AutomationEngine';
import '@/services/recommendations-queue';
import i18n, { isAppLanguage } from '@/i18n';
import { useTranslation } from 'react-i18next';

const Workspace = lazy(() => import('@/components/workspace/Workspace'));
const ProgramSchedulePage = lazy(() => import('@/pages/ProgramSchedulePage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

const pages: Record<Page, ComponentType> = {
  studio: Workspace,
  program: ProgramSchedulePage,
  settings: SettingsPage,
};

function applyThemeVars(theme: ThemeMode, accent: AccentColor) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  const colors = ACCENT_COLORS[accent];
  root.style.setProperty('--accent', colors.primary);
  root.style.setProperty('--accent-hover', colors.hover);
}

function Layout() {
  const currentPage = useStore((s) => s.currentPage);
  const hasCompletedOnboarding = useStore((s) => s.hasCompletedOnboarding);
  const theme = useStore((s) => s.theme);
  const accentColor = useStore((s) => s.accentColor);
  const followProgramSchedule = useStore((s) => s.followProgramSchedule);
  const language = useStore((s) => s.language);
  const PageComponent = pages[currentPage];
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const prevFollowScheduleRef = useRef<boolean | null>(null);
  useAutoUpdate();
  useKeyboardShortcuts();
  const { t } = useTranslation();

  // Persisted settings + last automation queue (session)
  useEffect(() => {
    const unsubPersist = initAutomationSessionPersistence();
    const api = window.electronAPI;

    const loadAutomation = () =>
      loadAutomationSession().then((s) => {
        if (s) hydrateAutomationSession(s);
      });

    if (!api) {
      void loadAutomation().finally(() => setSettingsLoaded(true));
      return () => unsubPersist();
    }

    Promise.allSettled([
      api.getFromStore('hasCompletedOnboarding').then((val) => {
        if (val === true) useStore.setState({ hasCompletedOnboarding: true });
      }),
      api.getFromStore('seenCoachMarks').then((val) => {
        if (val && typeof val === 'object') useStore.setState({ seenCoachMarks: val as Record<CoachMarkId, boolean> });
      }),
      api.getFromStore('theme').then((val) => {
        if (val === 'dark' || val === 'light') useStore.setState({ theme: val });
      }),
      api.getFromStore('language').then((val) => {
        if (isAppLanguage(val)) useStore.setState({ language: val });
      }),
      api.getFromStore('accentColor').then((val) => {
        if (val && typeof val === 'string' && val in ACCENT_COLORS) {
          useStore.setState({ accentColor: val as AccentColor });
        }
      }),
      api.getFromStore('songTransitionMode').then((val) => {
        if (val === 'immediate' || val === 'fade' || val === 'crossfade') {
          useStore.setState({ songTransitionMode: val as SongTransitionMode });
        }
      }),
      api.getFromStore('fadeInMs').then((val) => { if (typeof val === 'number') useStore.setState({ fadeInMs: val }); }),
      api.getFromStore('fadeOutMs').then((val) => { if (typeof val === 'number') useStore.setState({ fadeOutMs: val }); }),
      api.getFromStore('crossfadeMs').then((val) => { if (typeof val === 'number') useStore.setState({ crossfadeMs: val }); }),
      api.getFromStore('duckLevel').then((val) => { if (typeof val === 'number') useStore.setState({ duckLevel: val }); }),
      api.getFromStore('autoUpdate').then((val) => { if (typeof val === 'boolean') useStore.setState({ autoUpdate: val }); }),
      api.getFromStore('followProgramSchedule').then((val) => {
        if (typeof val === 'boolean') useStore.setState({ followProgramSchedule: val });
      }),
      api.getFromStore('continuePlaylistRecommendations').then((val) => {
        if (typeof val === 'boolean') useStore.setState({ continuePlaylistRecommendations: val });
      }),
      api.getFromStore('workspaceLayout').then((val) => {
        if (Array.isArray(val)) {
          const valid = val.filter(
            (item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.visible === 'boolean'
          );
          if (valid.length > 0) useStore.setState({ workspaceLayout: valid as WidgetLayout[] });
        }
      }),
      api.getFromStore('soundboardVolume').then((val) => {
        if (typeof val === 'number') useStore.setState({ soundboardVolume: Math.max(0, Math.min(1, val)) });
      }),
      api.getSpotifyClientId().then((id) => {
        if (id) useStore.setState({ clientId: id });
      }),
      api.getSpotifyToken().then(async (token) => {
        if (token) {
          useStore.setState({ token, connected: true });
          try {
            const saved = await api.getFromStore('spotifyLastGrantedScopesDisplay');
            if (typeof saved === 'string' && saved.length > 0) {
              useStore.setState({ spotifyGrantedScopes: saved });
            }
          } catch {
            /* ignore */
          }
          try {
            const profile = await getProfile();
            useStore.setState({ user: profile.displayName, userAvatar: profile.avatar });
          } catch {
            // Token might be expired — will be refreshed
          }
        }
      }),
      loadAutomation(),
    ]).then(() => setSettingsLoaded(true));

    return () => unsubPersist();
  }, []);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    if (!settingsLoaded) return;
    prevFollowScheduleRef.current = useStore.getState().followProgramSchedule;
  }, [settingsLoaded]);

  useEffect(() => {
    if (!window.electronAPI || !settingsLoaded) return;
    const id = window.setInterval(() => void runScheduleTick(), 5000);
    void runScheduleTick();
    return () => clearInterval(id);
  }, [settingsLoaded]);

  useEffect(() => {
    let lastErrorToast = 0;
    const unsub = AutomationEngine.getInstance().on((event) => {
      if (event.type === 'error') {
        const now = Date.now();
        if (now - lastErrorToast > 5000) {
          lastErrorToast = now;
          useStore.getState().addToast(event.message, 'error');
        }
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!window.electronAPI || !settingsLoaded) return;
    const prev = prevFollowScheduleRef.current;
    prevFollowScheduleRef.current = followProgramSchedule;
    if (followProgramSchedule && prev === false) {
      resetWeeklyScheduleFireKeys();
      void runScheduleTick();
    }
  }, [followProgramSchedule, settingsLoaded]);

  // Centralized Spotify auth event listeners
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const unsubComplete = api.onSpotifyAuthComplete(async (data) => {
      clearSpotifyUserIdCache();
      const granted = typeof data.grantedScopes === 'string' && data.grantedScopes ? data.grantedScopes : null;
      useStore.setState({
        token: data.accessToken,
        connected: true,
        spotifyGrantedScopes: granted,
      });
      if (granted) {
        void api.saveToStore('spotifyLastGrantedScopesDisplay', granted);
      }
      useStore.getState().addToast(t('layout.auth.connectedSpotify'), 'success');
      try {
        const profile = await getProfile();
        useStore.setState({ user: profile.displayName, userAvatar: profile.avatar });
      } catch {
        // Profile fetch failed
      }
    });

    const unsubError = api.onSpotifyAuthError((error) => {
      useStore.getState().addToast(t('layout.auth.spotifyFailed', { error }), 'error');
    });

    const unsubScopeReset =
      typeof api.onSpotifyScopeReset === 'function'
        ? api.onSpotifyScopeReset((message) => {
            clearSpotifyUserIdCache();
            AutomationEngine.getInstance().stop();
            useStore.getState().disconnectSpotify();
            void api.saveToStore('spotifyLastGrantedScopesDisplay', '');
            useStore.getState().addToast(message, 'warning');
          })
        : () => {};

    const cleanupRevoked = api.onSpotifyAuthRevoked?.(() => {
      AutomationEngine.getInstance().stop();
      useStore.getState().disconnectSpotify();
      useStore.getState().addToast('Spotify session expired. Please reconnect from Settings.', 'warning');
    });

    const unsubRefresh = api.onSpotifyTokenRefreshed((data) => {
      useStore.setState({ token: data.accessToken });
    });

    return () => {
      unsubComplete();
      unsubError();
      unsubScopeReset();
      cleanupRevoked?.();
      unsubRefresh();
    };
  }, []);

  // Apply theme + accent whenever they change
  useEffect(() => {
    applyThemeVars(theme, accentColor);
  }, [theme, accentColor]);

  const showWebPreviewBanner = typeof window !== 'undefined' && !window.electronAPI;
  const showMacTitleInset = Boolean(window.electronAPI?.platform === 'darwin');

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      {showWebPreviewBanner && (
        <div className="shrink-0 z-[60] px-4 py-2 text-center text-xs text-amber-100 bg-amber-900/40 border-b border-amber-500/30 leading-snug space-y-1">
          <p>
            {t('layout.browserPreview.line1', { command: '' })}
            {' '}
            <code className="px-1 py-0.5 rounded bg-bg-primary/50 font-mono text-text-primary">npm run electron:dev</code>
          </p>
          <p>
            {t('layout.browserPreview.line2', { f12: '', macShortcut: '' })}
            {' '}
            <kbd className="px-1 py-0.5 rounded bg-bg-primary/50 font-mono">F12</kbd>
            {' / '}
            <kbd className="px-1 py-0.5 rounded bg-bg-primary/50 font-mono">⌥⌘I</kbd> for DevTools.
          </p>
        </div>
      )}
      {!settingsLoaded ? (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {showMacTitleInset && <MacTitleBarInset />}
          <div className="flex flex-1 items-center justify-center min-h-0">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      ) : (
        <>
          {!hasCompletedOnboarding && <OnboardingWizard />}
          <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
            {showMacTitleInset && <MacTitleBarInset />}
            <div className="flex flex-1 min-h-0 overflow-hidden">
            <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6">
              <Suspense fallback={<div className="flex items-center justify-center min-h-[40vh]"><span className="text-text-muted text-sm">{t('common.loading')}</span></div>}>
                <div key={currentPage} className="animate-page-enter min-h-0 h-full">
                  <PageComponent />
                </div>
              </Suspense>
            </main>
            </div>
          </div>
          <NowPlayingBar />
          <ToastContainer />
        </>
      )}
    </div>
  );
}

export default Layout;
