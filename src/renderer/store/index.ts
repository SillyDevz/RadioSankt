import { create, StateCreator } from 'zustand';

// ── Types ──────────────────────────────────────────────────────────────

export type Page = 'studio' | 'program' | 'settings';

export type WidgetId = 'automationQueue' | 'cartWall' | 'search' | 'jingleManager';

export interface WidgetLayout {
  id: WidgetId;
  visible: boolean;
  width?: number;
  height?: number;
}

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumArt?: string;
  duration: number;
  uri?: string;
}

export interface SpotifySearchResult {
  uri: string;
  name: string;
  artist: string;
  album: string;
  albumArt: string;
  durationMs: number;
}

/** Lifecycle of the Spotify Connect remote-control link (see Settings for diagnostics). */
export type WebPlaybackPhase = 'idle' | 'initializing' | 'ready' | 'error';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  action?: { label: string; onClick: () => void };
}

// ── Automation types ──────────────────────────────────────────────────

export type TransitionIn = 'immediate' | 'fadeIn' | 'crossfade';
export type TransitionOut = 'immediate' | 'fadeOut';
export type SongTransitionMode = 'immediate' | 'fade' | 'crossfade';

export interface StepTransition {
  transitionIn: TransitionIn;
  transitionOut: TransitionOut;
  overlapMs: number;
  duckMusic: boolean;
  duckLevel: number;
}

export function buildSongStepTransition(
  mode: SongTransitionMode,
  crossfadeMs: number,
): Pick<StepTransition, 'transitionIn' | 'transitionOut' | 'overlapMs'> {
  if (mode === 'fade') return { transitionIn: 'fadeIn', transitionOut: 'fadeOut', overlapMs: 0 };
  if (mode === 'crossfade') return { transitionIn: 'crossfade', transitionOut: 'immediate', overlapMs: Math.max(0, crossfadeMs) };
  return { transitionIn: 'immediate', transitionOut: 'immediate', overlapMs: 0 };
}

export type AutomationStep = (
  | { type: 'track'; spotifyUri: string; name: string; artist: string; albumArt: string; durationMs: number }
  | {
      type: 'playlist';
      spotifyPlaylistUri: string;
      name: string;
      albumArt: string;
      durationMs: number;
      trackCount: number;
    }
  | { type: 'jingle'; jingleId: number; name: string; filePath: string; durationMs: number }
  | { type: 'ad'; adId: number; name: string; filePath: string; durationMs: number }
  | { type: 'pause'; label: string }
) & { id: string } & StepTransition;

export type AutomationStatus = 'stopped' | 'playing' | 'paused' | 'waitingAtPause';

export interface SavedPlaylist {
  id: number;
  name: string;
  stepCount: number;
  updatedAt: string;
}

export interface BreakRule {
  id: string;
  enabled: boolean;
  everySongs: number;
  itemsPerBreak: number;
  selectedJingleIds: number[];
  selectedAdIds: number[];
  avoidRecent: number;
}

// ── Live + Settings types ─────────────────────────────────────────────

export interface QuickFireSlot {
  id: string;
  name: string;
  color: string;
  jingleId: number | null;
  jinglePath: string | null;
  durationMs: number;
}

export type ThemeMode = 'dark' | 'light';
export type AccentColor = 'green' | 'blue' | 'purple' | 'orange' | 'red';
export type AppLanguage = 'en' | 'pt';

export const ACCENT_COLORS: Record<AccentColor, { primary: string; hover: string }> = {
  green: { primary: '#1DB954', hover: '#1ed760' },
  blue: { primary: '#3b82f6', hover: '#60a5fa' },
  purple: { primary: '#8b5cf6', hover: '#a78bfa' },
  orange: { primary: '#f97316', hover: '#fb923c' },
  red: { primary: '#ef4444', hover: '#f87171' },
};

export interface ShortcutBinding {
  id: string;
  label: string;
  key: string;
  modifiers: string[];
}

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { id: 'play-pause', label: 'Play / Pause automation', key: 'Space', modifiers: [] },
  { id: 'stop', label: 'Stop automation', key: 'S', modifiers: [] },
  { id: 'continue', label: 'Continue at pause', key: 'C', modifiers: [] },
  { id: 'search', label: 'Open Spotify search', key: 'K', modifiers: ['Meta'] },
  { id: 'live', label: 'Toggle live mode', key: 'L', modifiers: [] },
];

// ── Slice interfaces ───────────────────────────────────────────────────

interface UISlice {
  currentPage: Page;
  spotifySearchOpen: boolean;
  workspaceLayout: WidgetLayout[];
  setCurrentPage: (page: Page) => void;
  setSpotifySearchOpen: (open: boolean) => void;
  setWorkspaceLayout: (layout: WidgetLayout[]) => void;
}

interface SpotifySlice {
  connected: boolean;
  user: string | null;
  userAvatar: string | null;
  token: string | null;
  clientId: string | null;
  deviceId: string | null;
  /** Human-readable name of the active Spotify Connect device (e.g. "MacBook Pro"). */
  deviceName: string | null;
  sdkReady: boolean;
  webPlaybackPhase: WebPlaybackPhase;
  webPlaybackLastError: string | null;
  searchResults: SpotifySearchResult[];
  /** OAuth `scope` string from last login (also persisted under spotifyLastGrantedScopesDisplay). */
  spotifyGrantedScopes: string | null;
  setConnected: (connected: boolean) => void;
  setUser: (user: string | null) => void;
  setUserAvatar: (avatar: string | null) => void;
  setToken: (token: string | null) => void;
  setClientId: (id: string | null) => void;
  setDeviceId: (id: string | null) => void;
  setDeviceName: (name: string | null) => void;
  setSdkReady: (ready: boolean) => void;
  setWebPlaybackDiag: (phase: WebPlaybackPhase, lastError?: string | null) => void;
  setSearchResults: (results: SpotifySearchResult[]) => void;
  setSpotifyGrantedScopes: (scopes: string | null) => void;
  disconnectSpotify: () => void;
}

interface PlayerSlice {
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  position: number;
  duration: number;
  setCurrentTrack: (track: Track | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setVolume: (volume: number) => void;
  setPosition: (position: number) => void;
  setDuration: (duration: number) => void;
}

interface AutomationSlice {
  // Playlist state
  automationSteps: AutomationStep[];
  selectedStepIndex: number | null;
  automationStatus: AutomationStatus;
  currentStepIndex: number;
  currentPlaylistId: number | null;
  currentPlaylistName: string | null;
  stepTimeRemaining: number;
  savedPlaylists: SavedPlaylist[];
  jingleManagerOpen: boolean;
  savePlaylistModalOpen: boolean;
  loadPlaylistModalOpen: boolean;
  breakRules: BreakRule[];

  // Actions
  setAutomationSteps: (steps: AutomationStep[]) => void;
  addAutomationStep: (step: AutomationStep) => void;
  removeAutomationStep: (id: string) => void;
  clearAutomationSteps: () => void;
  reorderAutomationSteps: (fromIndex: number, toIndex: number) => void;
  updateAutomationStep: (id: string, updates: Partial<AutomationStep>) => void;
  setSelectedStepIndex: (index: number | null) => void;
  setAutomationStatus: (status: AutomationStatus) => void;
  setCurrentStepIndex: (index: number) => void;
  setCurrentPlaylistId: (id: number | null) => void;
  setCurrentPlaylistName: (name: string | null) => void;
  setStepTimeRemaining: (ms: number) => void;
  setSavedPlaylists: (playlists: SavedPlaylist[]) => void;
  setJingleManagerOpen: (open: boolean) => void;
  setSavePlaylistModalOpen: (open: boolean) => void;
  setLoadPlaylistModalOpen: (open: boolean) => void;
  setBreakRules: (rules: BreakRule[]) => void;
  updateBreakRule: (id: string, updates: Partial<BreakRule>) => void;
}

interface ToastSlice {
  toasts: Toast[];
  addToast: (message: string, variant?: ToastVariant, action?: Toast['action']) => void;
  removeToast: (id: string) => void;
}

interface JingleSlice {
  jingles: JingleRecord[];
  playingJingleId: number | null;
  setJingles: (jingles: JingleRecord[]) => void;
  addJingle: (jingle: JingleRecord) => void;
  removeJingle: (id: number) => void;
  updateJingleName: (id: number, name: string) => void;
  setPlayingJingleId: (id: number | null) => void;
}

interface AdSlice {
  ads: JingleRecord[];
  setAds: (ads: JingleRecord[]) => void;
  addAd: (ad: JingleRecord) => void;
  removeAd: (id: number) => void;
  updateAdName: (id: number, name: string) => void;
}

export type CoachMarkId = 'automation-drag' | 'automation-pause' | 'live-golive' | 'jingles-add';

interface LiveSlice {
  isLive: boolean;
  quickFireSlots: QuickFireSlot[];
  setIsLive: (live: boolean) => void;
  setQuickFireSlots: (slots: QuickFireSlot[]) => void;
  updateQuickFireSlot: (id: string, updates: Partial<QuickFireSlot>) => void;
  clearQuickFireSlot: (id: string) => void;
}

interface SettingsSlice {
  language: AppLanguage;
  theme: ThemeMode;
  accentColor: AccentColor;
  songTransitionMode: SongTransitionMode;
  fadeInMs: number;
  fadeOutMs: number;
  crossfadeMs: number;
  duckLevel: number;
  autoUpdate: boolean;
  /** When true, automation loads and plays the set for each weekly block at its start time (app must stay open). */
  followProgramSchedule: boolean;
  shortcuts: ShortcutBinding[];
  setTheme: (theme: ThemeMode) => void;
  setLanguage: (language: AppLanguage) => void;
  setAccentColor: (color: AccentColor) => void;
  setSongTransitionMode: (mode: SongTransitionMode) => void;
  setFadeInMs: (ms: number) => void;
  setFadeOutMs: (ms: number) => void;
  setCrossfadeMs: (ms: number) => void;
  setDuckLevel: (level: number) => void;
  setAutoUpdate: (auto: boolean) => void;
  setFollowProgramSchedule: (on: boolean) => void;
  setShortcuts: (shortcuts: ShortcutBinding[]) => void;
  updateShortcut: (id: string, key: string, modifiers: string[]) => void;
}

interface OnboardingSlice {
  hasCompletedOnboarding: boolean;
  onboardingStep: number;
  seenCoachMarks: Record<CoachMarkId, boolean>;
  setHasCompletedOnboarding: (done: boolean) => void;
  setOnboardingStep: (step: number) => void;
  markCoachMarkSeen: (id: CoachMarkId) => void;
}

// ── Combined store type ────────────────────────────────────────────────

type StoreState = UISlice & SpotifySlice & PlayerSlice & AutomationSlice & ToastSlice & JingleSlice & AdSlice & OnboardingSlice & LiveSlice & SettingsSlice;

// ── Slice creators ─────────────────────────────────────────────────────

const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set) => ({
  currentPage: 'studio',
  spotifySearchOpen: false,
  workspaceLayout: [
    { id: 'automationQueue', visible: true },
    { id: 'cartWall', visible: true },
    { id: 'search', visible: true },
  ],
  setCurrentPage: (page) => set({ currentPage: page }),
  setSpotifySearchOpen: (open) => set({ spotifySearchOpen: open }),
  setWorkspaceLayout: (layout) => {
    set({ workspaceLayout: layout });
    window.electronAPI?.saveToStore('workspaceLayout', layout);
  },
});

const createSpotifySlice: StateCreator<StoreState, [], [], SpotifySlice> = (set) => ({
  connected: false,
  user: null,
  userAvatar: null,
  token: null,
  clientId: null,
  deviceId: null,
  deviceName: null,
  sdkReady: false,
  webPlaybackPhase: 'idle',
  webPlaybackLastError: null,
  searchResults: [],
  spotifyGrantedScopes: null,
  setConnected: (connected) => set({ connected }),
  setUser: (user) => set({ user }),
  setUserAvatar: (avatar) => set({ userAvatar: avatar }),
  setToken: (token) => set({ token }),
  setClientId: (id) => set({ clientId: id }),
  setDeviceId: (id) => set({ deviceId: id }),
  setDeviceName: (name) => set({ deviceName: name }),
  setSdkReady: (ready) => set({ sdkReady: ready }),
  setWebPlaybackDiag: (phase, lastError = null) =>
    set({
      webPlaybackPhase: phase,
      webPlaybackLastError: lastError,
    }),
  setSearchResults: (results) => set({ searchResults: results }),
  setSpotifyGrantedScopes: (spotifyGrantedScopes) => set({ spotifyGrantedScopes }),
  disconnectSpotify: () =>
    set({
      connected: false,
      user: null,
      userAvatar: null,
      token: null,
      deviceId: null,
      deviceName: null,
      sdkReady: false,
      webPlaybackPhase: 'idle',
      webPlaybackLastError: null,
      searchResults: [],
      spotifyGrantedScopes: null,
    }),
});

const createPlayerSlice: StateCreator<StoreState, [], [], PlayerSlice> = (set) => ({
  currentTrack: null,
  isPlaying: false,
  volume: 0.8,
  position: 0,
  duration: 0,
  setCurrentTrack: (track) => set({ currentTrack: track }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setVolume: (volume) => set({ volume }),
  setPosition: (position) => set({ position }),
  setDuration: (duration) => set({ duration }),
});

const createAutomationSlice: StateCreator<StoreState, [], [], AutomationSlice> = (set, get) => ({
  automationSteps: [],
  selectedStepIndex: null,
  automationStatus: 'stopped',
  currentStepIndex: 0,
  currentPlaylistId: null,
  currentPlaylistName: null,
  stepTimeRemaining: 0,
  savedPlaylists: [],
  jingleManagerOpen: false,
  savePlaylistModalOpen: false,
  loadPlaylistModalOpen: false,
  breakRules: [
    {
      id: 'main',
      enabled: false,
      everySongs: 4,
      itemsPerBreak: 2,
      selectedJingleIds: [],
      selectedAdIds: [],
      avoidRecent: 2,
    },
  ],

  setAutomationSteps: (steps) => set({ automationSteps: steps }),
  addAutomationStep: (step) => set((s) => ({ automationSteps: [...s.automationSteps, step] })),
  removeAutomationStep: (id) =>
    set((s) => {
      const steps = s.automationSteps.filter((st) => st.id !== id);
      const sel = s.selectedStepIndex;
      return {
        automationSteps: steps,
        selectedStepIndex: sel !== null && sel >= steps.length ? (steps.length > 0 ? steps.length - 1 : null) : sel,
      };
    }),
  clearAutomationSteps: () =>
    set({
      automationSteps: [],
      selectedStepIndex: null,
      currentStepIndex: 0,
      automationStatus: 'stopped',
      stepTimeRemaining: 0,
    }),
  reorderAutomationSteps: (fromIndex, toIndex) =>
    set((s) => {
      const prev = [...s.automationSteps];
      const cur = s.currentStepIndex;
      const sel = s.selectedStepIndex;
      const currentId = cur >= 0 && cur < prev.length ? prev[cur].id : null;
      const selectedId =
        sel !== null && sel >= 0 && sel < prev.length ? prev[sel].id : null;

      const steps = [...prev];
      const [moved] = steps.splice(fromIndex, 1);
      steps.splice(toIndex, 0, moved);

      const clamp = (i: number) =>
        steps.length === 0 ? 0 : Math.max(0, Math.min(i, steps.length - 1));

      let nextCur = cur;
      if (currentId !== null) {
        const i = steps.findIndex((st) => st.id === currentId);
        if (i !== -1) nextCur = i;
      }

      let nextSel = sel;
      if (selectedId !== null) {
        const i = steps.findIndex((st) => st.id === selectedId);
        nextSel = i === -1 ? null : i;
      } else if (sel !== null) {
        nextSel = steps.length === 0 ? null : Math.min(sel, steps.length - 1);
      }

      return {
        automationSteps: steps,
        currentStepIndex: clamp(nextCur),
        selectedStepIndex: nextSel,
      };
    }),
  updateAutomationStep: (id, updates) =>
    set((s) => ({
      automationSteps: s.automationSteps.map((st) =>
        st.id === id ? ({ ...st, ...updates } as AutomationStep) : st,
      ),
    })),
  setSelectedStepIndex: (index) => set({ selectedStepIndex: index }),
  setAutomationStatus: (status) => set({ automationStatus: status }),
  setCurrentStepIndex: (index) => set({ currentStepIndex: index }),
  setCurrentPlaylistId: (id) => set({ currentPlaylistId: id }),
  setCurrentPlaylistName: (name) => set({ currentPlaylistName: name }),
  setStepTimeRemaining: (ms) => set({ stepTimeRemaining: ms }),
  setSavedPlaylists: (playlists) => set({ savedPlaylists: playlists }),
  setJingleManagerOpen: (open) => set({ jingleManagerOpen: open }),
  setSavePlaylistModalOpen: (open) => set({ savePlaylistModalOpen: open }),
  setLoadPlaylistModalOpen: (open) => set({ loadPlaylistModalOpen: open }),
  setBreakRules: (breakRules) => set({ breakRules }),
  updateBreakRule: (id, updates) =>
    set((state) => ({
      breakRules: state.breakRules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    })),
});

const createToastSlice: StateCreator<StoreState, [], [], ToastSlice> = (set) => ({
  toasts: [],
  addToast: (message, variant = 'info', action) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { id: crypto.randomUUID(), message, variant, action },
      ],
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
});

const createJingleSlice: StateCreator<StoreState, [], [], JingleSlice> = (set) => ({
  jingles: [],
  playingJingleId: null,
  setJingles: (jingles) => set({ jingles }),
  addJingle: (jingle) => set((state) => ({ jingles: [jingle, ...state.jingles] })),
  removeJingle: (id) => set((state) => ({ jingles: state.jingles.filter((j) => j.id !== id) })),
  updateJingleName: (id, name) =>
    set((state) => ({
      jingles: state.jingles.map((j) => (j.id === id ? { ...j, name } : j)),
    })),
  setPlayingJingleId: (id) => set({ playingJingleId: id }),
});

const createAdSlice: StateCreator<StoreState, [], [], AdSlice> = (set) => ({
  ads: [],
  setAds: (ads) => set({ ads }),
  addAd: (ad) => set((state) => ({ ads: [ad, ...state.ads] })),
  removeAd: (id) => set((state) => ({ ads: state.ads.filter((a) => a.id !== id) })),
  updateAdName: (id, name) =>
    set((state) => ({
      ads: state.ads.map((a) => (a.id === id ? { ...a, name } : a)),
    })),
});

const createOnboardingSlice: StateCreator<StoreState, [], [], OnboardingSlice> = (set) => ({
  hasCompletedOnboarding: false,
  onboardingStep: 0,
  seenCoachMarks: {
    'automation-drag': false,
    'automation-pause': false,
    'live-golive': false,
    'jingles-add': false,
  },
  setHasCompletedOnboarding: (done) => {
    set({ hasCompletedOnboarding: done });
    window.electronAPI?.saveToStore('hasCompletedOnboarding', done);
  },
  setOnboardingStep: (step) => set({ onboardingStep: step }),
  markCoachMarkSeen: (id) =>
    set((state) => {
      const updated = { ...state.seenCoachMarks, [id]: true };
      window.electronAPI?.saveToStore('seenCoachMarks', updated);
      return { seenCoachMarks: updated };
    }),
});

function createDefaultQuickFireSlots(): QuickFireSlot[] {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `qf-${i}`,
    name: '',
    color: '#2a2a2a',
    jingleId: null,
    jinglePath: null,
    durationMs: 0,
  }));
}

const createLiveSlice: StateCreator<StoreState, [], [], LiveSlice> = (set) => ({
  isLive: false,
  quickFireSlots: createDefaultQuickFireSlots(),
  setIsLive: (live) => set({ isLive: live }),
  setQuickFireSlots: (slots) => set({ quickFireSlots: slots }),
  updateQuickFireSlot: (id, updates) =>
    set((state) => {
      const slots = state.quickFireSlots.map((s) =>
        s.id === id ? { ...s, ...updates } : s,
      );
      window.electronAPI?.saveToStore('quickFireSlots', slots);
      return { quickFireSlots: slots };
    }),
  clearQuickFireSlot: (id) =>
    set((state) => {
      const slots = state.quickFireSlots.map((s) =>
        s.id === id ? { ...s, name: '', jingleId: null, jinglePath: null, durationMs: 0, color: '#2a2a2a' } : s,
      );
      window.electronAPI?.saveToStore('quickFireSlots', slots);
      return { quickFireSlots: slots };
    }),
});

const createSettingsSlice: StateCreator<StoreState, [], [], SettingsSlice> = (set) => ({
  language: 'en',
  theme: 'dark',
  accentColor: 'green',
  songTransitionMode: 'immediate',
  fadeInMs: 1500,
  fadeOutMs: 1500,
  crossfadeMs: 2000,
  duckLevel: 20,
  autoUpdate: true,
  followProgramSchedule: true,
  shortcuts: [...DEFAULT_SHORTCUTS],
  setLanguage: (language) => {
    set({ language });
    window.electronAPI?.saveToStore('language', language);
  },
  setTheme: (theme) => {
    set({ theme });
    window.electronAPI?.saveToStore('theme', theme);
  },
  setAccentColor: (color) => {
    set({ accentColor: color });
    window.electronAPI?.saveToStore('accentColor', color);
  },
  setSongTransitionMode: (mode) => {
    set((state) => ({
      songTransitionMode: mode,
      automationSteps: state.automationSteps.map((step) =>
        step.type === 'track' || step.type === 'playlist'
          ? { ...step, ...buildSongStepTransition(mode, state.crossfadeMs) }
          : step,
      ),
    }));
    window.electronAPI?.saveToStore('songTransitionMode', mode);
  },
  setFadeInMs: (ms) => {
    set({ fadeInMs: ms });
    window.electronAPI?.saveToStore('fadeInMs', ms);
  },
  setFadeOutMs: (ms) => {
    set({ fadeOutMs: ms });
    window.electronAPI?.saveToStore('fadeOutMs', ms);
  },
  setCrossfadeMs: (ms) => {
    set((state) => ({
      crossfadeMs: ms,
      automationSteps:
        state.songTransitionMode === 'crossfade'
          ? state.automationSteps.map((step) =>
              step.type === 'track' || step.type === 'playlist'
                ? { ...step, overlapMs: Math.max(0, ms) }
                : step,
            )
          : state.automationSteps,
    }));
    window.electronAPI?.saveToStore('crossfadeMs', ms);
  },
  setDuckLevel: (level) => {
    set({ duckLevel: level });
    window.electronAPI?.saveToStore('duckLevel', level);
  },
  setAutoUpdate: (auto) => {
    set({ autoUpdate: auto });
    window.electronAPI?.saveToStore('autoUpdate', auto);
  },
  setFollowProgramSchedule: (on) => {
    set({ followProgramSchedule: on });
    window.electronAPI?.saveToStore('followProgramSchedule', on);
  },
  setShortcuts: (shortcuts) => {
    set({ shortcuts });
    window.electronAPI?.saveToStore('shortcuts', shortcuts);
  },
  updateShortcut: (id, key, modifiers) =>
    set((state) => {
      const shortcuts = state.shortcuts.map((s) =>
        s.id === id ? { ...s, key, modifiers } : s,
      );
      window.electronAPI?.saveToStore('shortcuts', shortcuts);
      return { shortcuts };
    }),
});

// ── Store ──────────────────────────────────────────────────────────────

export const useStore = create<StoreState>()((...a) => ({
  ...createUISlice(...a),
  ...createSpotifySlice(...a),
  ...createPlayerSlice(...a),
  ...createAutomationSlice(...a),
  ...createToastSlice(...a),
  ...createJingleSlice(...a),
  ...createAdSlice(...a),
  ...createOnboardingSlice(...a),
  ...createLiveSlice(...a),
  ...createSettingsSlice(...a),
}));
