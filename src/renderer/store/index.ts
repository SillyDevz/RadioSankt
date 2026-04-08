import { create, StateCreator } from 'zustand';

// ── Types ──────────────────────────────────────────────────────────────

export type Page = 'library' | 'automation' | 'live' | 'jingles' | 'settings';

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

/** Lifecycle of the embedded Spotify Web Playback SDK (see Settings for diagnostics). */
export type WebPlaybackPhase =
  | 'idle'
  | 'loading_sdk'
  | 'initializing'
  | 'connecting'
  | 'ready'
  | 'error';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  action?: { label: string; onClick: () => void };
}

// ── Automation types ──────────────────────────────────────────────────

export type TransitionIn = 'immediate' | 'fadeIn' | 'crossfade';
export type TransitionOut = 'immediate' | 'fadeOut';

export interface StepTransition {
  transitionIn: TransitionIn;
  transitionOut: TransitionOut;
  overlapMs: number;
  duckMusic: boolean;
  duckLevel: number;
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
  | { type: 'pause'; label: string }
) & { id: string } & StepTransition;

export type AutomationStatus = 'stopped' | 'playing' | 'paused' | 'waitingAtPause';

export interface SavedPlaylist {
  id: number;
  name: string;
  stepCount: number;
  updatedAt: string;
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
  { id: 'help', label: 'Open help panel', key: 'F1', modifiers: [] },
];

// ── Slice interfaces ───────────────────────────────────────────────────

interface UISlice {
  currentPage: Page;
  sidebarExpanded: boolean;
  spotifySearchOpen: boolean;
  setCurrentPage: (page: Page) => void;
  setSidebarExpanded: (expanded: boolean) => void;
  setSpotifySearchOpen: (open: boolean) => void;
}

interface SpotifySlice {
  connected: boolean;
  user: string | null;
  userAvatar: string | null;
  token: string | null;
  clientId: string | null;
  deviceId: string | null;
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
  jinglePickerOpen: boolean;
  savePlaylistModalOpen: boolean;
  loadPlaylistModalOpen: boolean;

  // Actions
  setAutomationSteps: (steps: AutomationStep[]) => void;
  addAutomationStep: (step: AutomationStep) => void;
  removeAutomationStep: (id: string) => void;
  reorderAutomationSteps: (fromIndex: number, toIndex: number) => void;
  updateAutomationStep: (id: string, updates: Partial<AutomationStep>) => void;
  setSelectedStepIndex: (index: number | null) => void;
  setAutomationStatus: (status: AutomationStatus) => void;
  setCurrentStepIndex: (index: number) => void;
  setCurrentPlaylistId: (id: number | null) => void;
  setCurrentPlaylistName: (name: string | null) => void;
  setStepTimeRemaining: (ms: number) => void;
  setSavedPlaylists: (playlists: SavedPlaylist[]) => void;
  setJinglePickerOpen: (open: boolean) => void;
  setSavePlaylistModalOpen: (open: boolean) => void;
  setLoadPlaylistModalOpen: (open: boolean) => void;
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

export type CoachMarkId = 'automation-drag' | 'automation-pause' | 'live-golive' | 'jingles-add';

interface LiveSlice {
  isLive: boolean;
  quickFireSlots: QuickFireSlot[];
  playingSlotId: string | null;
  playingSlotProgress: number;
  setIsLive: (live: boolean) => void;
  setQuickFireSlots: (slots: QuickFireSlot[]) => void;
  updateQuickFireSlot: (id: string, updates: Partial<QuickFireSlot>) => void;
  clearQuickFireSlot: (id: string) => void;
  setPlayingSlotId: (id: string | null) => void;
  setPlayingSlotProgress: (progress: number) => void;
}

interface SettingsSlice {
  theme: ThemeMode;
  accentColor: AccentColor;
  fadeInMs: number;
  fadeOutMs: number;
  crossfadeMs: number;
  duckLevel: number;
  autoUpdate: boolean;
  githubRepo: string;
  shortcuts: ShortcutBinding[];
  setTheme: (theme: ThemeMode) => void;
  setAccentColor: (color: AccentColor) => void;
  setFadeInMs: (ms: number) => void;
  setFadeOutMs: (ms: number) => void;
  setCrossfadeMs: (ms: number) => void;
  setDuckLevel: (level: number) => void;
  setAutoUpdate: (auto: boolean) => void;
  setGithubRepo: (repo: string) => void;
  setShortcuts: (shortcuts: ShortcutBinding[]) => void;
  updateShortcut: (id: string, key: string, modifiers: string[]) => void;
}

interface OnboardingSlice {
  hasCompletedOnboarding: boolean;
  onboardingStep: number;
  helpPanelOpen: boolean;
  seenCoachMarks: Record<CoachMarkId, boolean>;
  setHasCompletedOnboarding: (done: boolean) => void;
  setOnboardingStep: (step: number) => void;
  setHelpPanelOpen: (open: boolean) => void;
  markCoachMarkSeen: (id: CoachMarkId) => void;
}

// ── Combined store type ────────────────────────────────────────────────

type StoreState = UISlice & SpotifySlice & PlayerSlice & AutomationSlice & ToastSlice & JingleSlice & OnboardingSlice & LiveSlice & SettingsSlice;

// ── Slice creators ─────────────────────────────────────────────────────

const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set) => ({
  currentPage: 'library',
  sidebarExpanded: true,
  spotifySearchOpen: false,
  setCurrentPage: (page) => set({ currentPage: page }),
  setSidebarExpanded: (expanded) => set({ sidebarExpanded: expanded }),
  setSpotifySearchOpen: (open) => set({ spotifySearchOpen: open }),
});

const createSpotifySlice: StateCreator<StoreState, [], [], SpotifySlice> = (set) => ({
  connected: false,
  user: null,
  userAvatar: null,
  token: null,
  clientId: null,
  deviceId: null,
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
  jinglePickerOpen: false,
  savePlaylistModalOpen: false,
  loadPlaylistModalOpen: false,

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
  setJinglePickerOpen: (open) => set({ jinglePickerOpen: open }),
  setSavePlaylistModalOpen: (open) => set({ savePlaylistModalOpen: open }),
  setLoadPlaylistModalOpen: (open) => set({ loadPlaylistModalOpen: open }),
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

const createOnboardingSlice: StateCreator<StoreState, [], [], OnboardingSlice> = (set) => ({
  hasCompletedOnboarding: false,
  onboardingStep: 0,
  helpPanelOpen: false,
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
  setHelpPanelOpen: (open) => set({ helpPanelOpen: open }),
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
  playingSlotId: null,
  playingSlotProgress: 0,
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
  setPlayingSlotId: (id) => set({ playingSlotId: id }),
  setPlayingSlotProgress: (progress) => set({ playingSlotProgress: progress }),
});

const createSettingsSlice: StateCreator<StoreState, [], [], SettingsSlice> = (set) => ({
  theme: 'dark',
  accentColor: 'green',
  fadeInMs: 1500,
  fadeOutMs: 1500,
  crossfadeMs: 2000,
  duckLevel: 20,
  autoUpdate: true,
  githubRepo: 'radiosankt/radiosankt',
  shortcuts: [...DEFAULT_SHORTCUTS],
  setTheme: (theme) => {
    set({ theme });
    window.electronAPI?.saveToStore('theme', theme);
  },
  setAccentColor: (color) => {
    set({ accentColor: color });
    window.electronAPI?.saveToStore('accentColor', color);
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
    set({ crossfadeMs: ms });
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
  setGithubRepo: (repo) => {
    set({ githubRepo: repo });
    window.electronAPI?.saveToStore('githubRepo', repo);
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
  ...createOnboardingSlice(...a),
  ...createLiveSlice(...a),
  ...createSettingsSlice(...a),
}));
