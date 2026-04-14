import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { useStore } from '@/store';
import type { Page, CoachMarkId, AccentColor, ThemeMode, QuickFireSlot, ShortcutBinding } from '@/store';
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
  const PageComponent = pages[currentPage];
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const prevFollowScheduleRef = useRef<boolean | null>(null);
  useAutoUpdate();
  useKeyboardShortcuts();

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

    Promise.all([
      api.getFromStore('hasCompletedOnboarding').then((val) => {
        if (val === true) useStore.setState({ hasCompletedOnboarding: true });
      }),
      api.getFromStore('seenCoachMarks').then((val) => {
        if (val && typeof val === 'object') useStore.setState({ seenCoachMarks: val as Record<CoachMarkId, boolean> });
      }),
      api.getFromStore('theme').then((val) => { if (val) useStore.setState({ theme: val as ThemeMode }); }),
      api.getFromStore('accentColor').then((val) => { if (val) useStore.setState({ accentColor: val as AccentColor }); }),
      api.getFromStore('fadeInMs').then((val) => { if (typeof val === 'number') useStore.setState({ fadeInMs: val }); }),
      api.getFromStore('fadeOutMs').then((val) => { if (typeof val === 'number') useStore.setState({ fadeOutMs: val }); }),
      api.getFromStore('crossfadeMs').then((val) => { if (typeof val === 'number') useStore.setState({ crossfadeMs: val }); }),
      api.getFromStore('duckLevel').then((val) => { if (typeof val === 'number') useStore.setState({ duckLevel: val }); }),
      api.getFromStore('autoUpdate').then((val) => { if (typeof val === 'boolean') useStore.setState({ autoUpdate: val }); }),
      api.getFromStore('followProgramSchedule').then((val) => {
        if (typeof val === 'boolean') useStore.setState({ followProgramSchedule: val });
      }),
      api.getFromStore('shortcuts').then((val) => { if (Array.isArray(val)) useStore.setState({ shortcuts: val as ShortcutBinding[] }); }),
      api.getFromStore('workspaceLayout').then((val) => { if (Array.isArray(val)) useStore.setState({ workspaceLayout: val as any }); }),
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
    ]).finally(() => setSettingsLoaded(true));

    return () => unsubPersist();
  }, []);

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
      useStore.getState().addToast('Connected to Spotify', 'success');
      try {
        const profile = await getProfile();
        useStore.setState({ user: profile.displayName, userAvatar: profile.avatar });
      } catch {
        // Profile fetch failed
      }
    });

    const unsubError = api.onSpotifyAuthError((error) => {
      useStore.getState().addToast(`Spotify auth failed: ${error}`, 'error');
    });

    const unsubScopeReset =
      typeof api.onSpotifyScopeReset === 'function'
        ? api.onSpotifyScopeReset((message) => {
            clearSpotifyUserIdCache();
            useStore.getState().disconnectSpotify();
            void api.saveToStore('spotifyLastGrantedScopesDisplay', '');
            useStore.getState().addToast(message, 'warning');
          })
        : () => {};

    const unsubRefresh = api.onSpotifyTokenRefreshed((data) => {
      useStore.setState({ token: data.accessToken });
    });

    return () => {
      unsubComplete();
      unsubError();
      unsubScopeReset();
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
            Browser preview only — Spotify and file access need Electron. Run{' '}
            <code className="px-1 py-0.5 rounded bg-bg-primary/50 font-mono text-text-primary">npm run electron:dev</code>
            {' '}(Vite + desktop; DevTools opens docked at the bottom).
          </p>
          <p>
            In this tab only, use <kbd className="px-1 py-0.5 rounded bg-bg-primary/50 font-mono">F12</kbd> or macOS{' '}
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
              <Suspense fallback={<div className="flex items-center justify-center min-h-[40vh]"><span className="text-text-muted text-sm">Loading...</span></div>}>
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
