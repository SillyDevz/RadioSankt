import { useEffect, lazy, Suspense } from 'react';
import { useStore } from '@/store';
import type { Page, CoachMarkId, AccentColor, ThemeMode, QuickFireSlot, ShortcutBinding } from '@/store';
import { ACCENT_COLORS } from '@/store';
import Sidebar from './Sidebar';
import NowPlayingBar from './NowPlayingBar';
import SpotifySearch from './SpotifySearch';
import ToastContainer from './Toast';
import OnboardingWizard from './OnboardingWizard';
import HelpPanel from './HelpPanel';
import type { ComponentType } from 'react';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

const LibraryPage = lazy(() => import('@/pages/LibraryPage'));
const AutomationPage = lazy(() => import('@/pages/AutomationPage'));
const LivePage = lazy(() => import('@/pages/LivePage'));
const JinglesPage = lazy(() => import('@/pages/JinglesPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

const pages: Record<Page, ComponentType> = {
  library: LibraryPage,
  automation: AutomationPage,
  live: LivePage,
  jingles: JinglesPage,
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
  const PageComponent = pages[currentPage];
  useAutoUpdate();
  useKeyboardShortcuts();

  // Load persisted settings from electron-store on mount
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.getFromStore('hasCompletedOnboarding').then((val) => {
      if (val === true) useStore.setState({ hasCompletedOnboarding: true });
    });
    api.getFromStore('seenCoachMarks').then((val) => {
      if (val && typeof val === 'object') useStore.setState({ seenCoachMarks: val as Record<CoachMarkId, boolean> });
    });

    // Settings
    api.getFromStore('theme').then((val) => { if (val) useStore.setState({ theme: val as ThemeMode }); });
    api.getFromStore('accentColor').then((val) => { if (val) useStore.setState({ accentColor: val as AccentColor }); });
    api.getFromStore('fadeInMs').then((val) => { if (typeof val === 'number') useStore.setState({ fadeInMs: val }); });
    api.getFromStore('fadeOutMs').then((val) => { if (typeof val === 'number') useStore.setState({ fadeOutMs: val }); });
    api.getFromStore('crossfadeMs').then((val) => { if (typeof val === 'number') useStore.setState({ crossfadeMs: val }); });
    api.getFromStore('duckLevel').then((val) => { if (typeof val === 'number') useStore.setState({ duckLevel: val }); });
    api.getFromStore('autoUpdate').then((val) => { if (typeof val === 'boolean') useStore.setState({ autoUpdate: val }); });
    api.getFromStore('githubRepo').then((val) => { if (typeof val === 'string') useStore.setState({ githubRepo: val }); });
    api.getFromStore('shortcuts').then((val) => { if (Array.isArray(val)) useStore.setState({ shortcuts: val as ShortcutBinding[] }); });
    api.getFromStore('quickFireSlots').then((val) => { if (Array.isArray(val) && val.length === 12) useStore.setState({ quickFireSlots: val as QuickFireSlot[] }); });

    // Restore Spotify session
    api.getSpotifyClientId().then((id) => {
      if (id) useStore.setState({ clientId: id });
    });
    api.getSpotifyToken().then(async (token) => {
      if (token) {
        useStore.setState({ token, connected: true });
      }
    });
  }, []);

  // Apply theme + accent whenever they change
  useEffect(() => {
    applyThemeVars(theme, accentColor);
  }, [theme, accentColor]);

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      {!hasCompletedOnboarding && <OnboardingWizard />}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Suspense fallback={<div className="flex items-center justify-center h-full"><span className="text-text-muted text-sm">Loading...</span></div>}>
            <div key={currentPage} className="animate-page-enter h-full">
              <PageComponent />
            </div>
          </Suspense>
        </main>
      </div>
      <NowPlayingBar />
      <SpotifySearch />
      <ToastContainer />
      <HelpPanel />
    </div>
  );
}

export default Layout;
