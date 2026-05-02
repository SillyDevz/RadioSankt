import { useStore } from '@/store';
import type { AutomationStep } from '@/store';
import type { BreakRule } from '@/store';
import AutomationEngine from '@/engine/AutomationEngine';
import { trimStepsToMaxMs } from '@/utils/automation-duration';

const SESSION_KEY = 'automationSession';

export interface AutomationSessionSnapshot {
  v: 1;
  automationSteps: AutomationStep[];
  currentPlaylistId: number | null;
  currentPlaylistName: string | null;
  breakRules?: BreakRule[];
}

const VALID_STEP_TYPES = new Set(['track', 'playlist', 'jingle', 'ad', 'pause']);

export function patchLegacySteps(steps: AutomationStep[]): AutomationStep[] {
  for (const s of steps) {
    if ((s.type === 'jingle' || s.type === 'ad') && typeof (s as any).crossfadeMs !== 'number') {
      (s as any).crossfadeMs = 0;
    }
  }
  return steps;
}

function parseSnapshot(raw: unknown): AutomationSessionSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || !Array.isArray(o.automationSteps)) return null;

  const validSteps = (o.automationSteps as unknown[]).filter((s): s is AutomationStep => {
    if (!s || typeof s !== 'object') return false;
    const step = s as Record<string, unknown>;
    if (typeof step.id !== 'string' || !step.id) return false;
    if (typeof step.type !== 'string' || !VALID_STEP_TYPES.has(step.type)) return false;
    if (step.type === 'track' && typeof step.spotifyUri !== 'string') return false;
    if (step.type === 'playlist' && typeof step.spotifyPlaylistUri !== 'string') return false;
    if ((step.type === 'jingle' || step.type === 'ad') && typeof step.filePath !== 'string') return false;
    return true;
  });

  const normalizedBreakRules = Array.isArray(o.breakRules)
    ? (o.breakRules as Array<Record<string, unknown>>).map((r, i) => ({
        id: typeof r.id === 'string' && r.id ? r.id : `rule-${i}`,
        enabled: r.enabled !== false,
        everySongs: typeof r.everySongs === 'number' ? r.everySongs : 4,
        itemsPerBreak: typeof r.itemsPerBreak === 'number' ? r.itemsPerBreak : 2,
        selectedJingleIds: Array.isArray(r.selectedJingleIds)
          ? r.selectedJingleIds.filter((v): v is number => typeof v === 'number')
          : [],
        selectedAdIds: Array.isArray(r.selectedAdIds)
          ? r.selectedAdIds.filter((v): v is number => typeof v === 'number')
          : [],
        avoidRecent: typeof r.avoidRecent === 'number' ? r.avoidRecent : 2,
      }))
    : undefined;
  return {
    v: 1,
    automationSteps: patchLegacySteps(validSteps),
    currentPlaylistId: typeof o.currentPlaylistId === 'number' ? o.currentPlaylistId : null,
    currentPlaylistName: typeof o.currentPlaylistName === 'string' ? o.currentPlaylistName : null,
    breakRules: normalizedBreakRules as BreakRule[] | undefined,
  };
}

async function readRaw(): Promise<unknown> {
  const api = window.electronAPI;
  if (api) return api.getFromStore(SESSION_KEY);
  try {
    const s = localStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

async function writeRaw(value: AutomationSessionSnapshot): Promise<void> {
  const api = window.electronAPI;
  if (api) {
    await api.saveToStore(SESSION_KEY, value);
    return;
  }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export async function loadAutomationSession(): Promise<AutomationSessionSnapshot | null> {
  const raw = await readRaw();
  return parseSnapshot(raw);
}

let skipNext = false;

/** Call before bulk setState so the restored snapshot is not treated as a user edit loop. */
export function prepareHydrateAutomationSession(): void {
  skipNext = true;
}

export function hydrateAutomationSession(s: AutomationSessionSnapshot): void {
  prepareHydrateAutomationSession();
  useStore.setState({
    automationSteps: s.automationSteps,
    currentPlaylistId: s.currentPlaylistId,
    currentPlaylistName: s.currentPlaylistName,
    ...(Array.isArray(s.breakRules) ? { breakRules: s.breakRules } : {}),
    selectedStepIndex: null,
    currentStepIndex: 0,
    automationStatus: 'stopped',
    stepTimeRemaining: 0,
  });
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lastSerialized: string | null = null;

const DEBOUNCE_MS = 450;

function snapshotFromState(): AutomationSessionSnapshot {
  const s = useStore.getState();
  return {
    v: 1,
    automationSteps: s.automationSteps,
    currentPlaylistId: s.currentPlaylistId,
    currentPlaylistName: s.currentPlaylistName,
    breakRules: s.breakRules,
  };
}

function schedulePersist(): void {
  if (skipNext) {
    skipNext = false;
    lastSerialized = JSON.stringify(snapshotFromState());
    return;
  }
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snap = snapshotFromState();
    const ser = JSON.stringify(snap);
    if (ser === lastSerialized) return;
    lastSerialized = ser;
    void writeRaw(snap);
  }, DEBOUNCE_MS);
}

/**
 * Flush any pending debounced session persist immediately.
 * Call on app quit or before auto-update restart to avoid data loss.
 */
export function flushSessionNow(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const snap = snapshotFromState();
  const ser = JSON.stringify(snap);
  if (ser !== lastSerialized) {
    lastSerialized = ser;
    window.electronAPI?.saveToStore(SESSION_KEY, snap);
  }
}

export function initAutomationSessionPersistence(): () => void {
  const unsub = useStore.subscribe((state, prev) => {
    if (
      prev !== undefined &&
      state.automationSteps === prev.automationSteps &&
      state.currentPlaylistId === prev.currentPlaylistId &&
      state.currentPlaylistName === prev.currentPlaylistName
      && state.breakRules === prev.breakRules
    ) {
      return;
    }
    schedulePersist();
  });

  window.addEventListener('beforeunload', flushSessionNow);

  return () => {
    unsub();
    window.removeEventListener('beforeunload', flushSessionNow);
    if (persistTimer) clearTimeout(persistTimer);
  };
}

interface WeeklySlotRow {
  id: number;
  playlistId: number;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  maxDurationMs: number | null;
  label: string | null;
  createdAt: string;
}

let weeklySlotsCache: { at: number; rows: WeeklySlotRow[] } | null = null;
const weeklyFiredKeys = new Set<string>();

/** Preload exposes IPC but main was not rebuilt — stop spamming invoke errors until app restart. */
let scheduleMainHandlersMissing = false;

function markScheduleInvokeError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('No handler registered')) {
    scheduleMainHandlersMissing = true;
  }
}

export function isScheduleMainHandlersMissing(): boolean {
  return scheduleMainHandlersMissing;
}

export function invalidateWeeklySlotsCache(): void {
  weeklySlotsCache = null;
}

/** Clears “already fired today” guards — call when turning Follow schedule on so a current block can start immediately. */
export function resetWeeklyScheduleFireKeys(): void {
  weeklyFiredKeys.clear();
}

const DAY_END_MIN = 24 * 60;

function scheduleDayKey(slotId: number, y: number, mo: number, d: number): string {
  return `${slotId}-${y}-${mo}-${d}`;
}

async function loadAndPlayFromPlaylist(
  playlistId: number,
  label: string | null,
  maxDurationMs: number | null,
): Promise<void> {
  // Stop any running automation first to clear stale timers
  await AutomationEngine.getInstance().stop();

  const api = window.electronAPI;
  if (!api) return;
  const pl = await api.loadPlaylist(playlistId);
  if (!pl) {
    useStore.getState().addToast('Scheduled set was deleted; skipped.', 'warning');
    return;
  }
  let steps: AutomationStep[];
  try {
    const parsed = JSON.parse(pl.steps);
    steps = (Array.isArray(parsed) ? parsed : []).filter((s: any): s is AutomationStep => {
      if (!s || typeof s !== 'object') return false;
      if (typeof s.id !== 'string' || !s.id) return false;
      if (typeof s.type !== 'string' || !VALID_STEP_TYPES.has(s.type)) return false;
      if (s.type === 'track' && typeof s.spotifyUri !== 'string') return false;
      if (s.type === 'playlist' && typeof s.spotifyPlaylistUri !== 'string') return false;
      if ((s.type === 'jingle' || s.type === 'ad') && typeof s.filePath !== 'string') return false;
      return true;
    });
    patchLegacySteps(steps);
  } catch {
    useStore.getState().addToast('Scheduled set data was invalid.', 'error');
    return;
  }
  if (maxDurationMs != null && maxDurationMs > 0) {
    steps = trimStepsToMaxMs(steps, maxDurationMs);
  }
  if (steps.length === 0) {
    useStore.getState().addToast('Nothing to play after max duration trim.', 'warning');
    return;
  }
  prepareHydrateAutomationSession();
  useStore.setState({
    automationSteps: steps,
    currentPlaylistId: pl.id,
    currentPlaylistName: pl.name,
    selectedStepIndex: null,
    currentStepIndex: 0,
    automationStatus: 'stopped',
    stepTimeRemaining: 0,
  });
  const t = label?.trim() || pl.name;
  useStore.getState().addToast(`Scheduled: ${t}`, 'success');
  void AutomationEngine.getInstance().play();
}

export async function runScheduleTick(): Promise<void> {
  const api = window.electronAPI;
  if (!api || scheduleMainHandlersMissing) return;

  if (!useStore.getState().followProgramSchedule) return;

  if (typeof api.listWeeklySlots !== 'function') return;

  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const mod = now.getHours() * 60 + now.getMinutes();

  try {
    if (!weeklySlotsCache || Date.now() - weeklySlotsCache.at > 8000) {
      try {
        const raw = await api.listWeeklySlots();
        weeklySlotsCache = { at: Date.now(), rows: Array.isArray(raw) ? raw : [] };
      } catch (err) {
        markScheduleInvokeError(err);
        weeklySlotsCache = { at: Date.now(), rows: [] };
      }
    }
    if (scheduleMainHandlersMissing) return;

    if (weeklyFiredKeys.size > 400) weeklyFiredKeys.clear();

    const y = now.getFullYear();
    const mo = now.getMonth() + 1;
    const d = now.getDate();
    const rows = weeklySlotsCache?.rows ?? [];

    for (const slot of rows) {
      if (slot.dayOfWeek !== dow || slot.startMinute !== mod) continue;
      const startKey = `${slot.id}-${y}-${mo}-${d}-${mod}`;
      if (weeklyFiredKeys.has(startKey)) continue;
      const dayKey = scheduleDayKey(slot.id, y, mo, d);
      if (weeklyFiredKeys.has(dayKey)) continue;
      const st0 = useStore.getState();
      if (st0.currentPlaylistId === slot.playlistId && st0.automationStatus !== 'stopped') {
        weeklyFiredKeys.add(startKey);
        weeklyFiredKeys.add(dayKey);
        continue;
      }
      weeklyFiredKeys.add(startKey);
      weeklyFiredKeys.add(dayKey);
      await loadAndPlayFromPlaylist(slot.playlistId, slot.label, slot.maxDurationMs);
      return;
    }

    const inside = rows
      .filter((s) => {
        if (s.dayOfWeek !== dow) return false;
        const end = Math.min(DAY_END_MIN, s.startMinute + s.durationMinutes);
        return mod >= s.startMinute && mod < end;
      })
      .sort((a, b) => a.startMinute - b.startMinute);

    for (const slot of inside) {
      const dayKey = scheduleDayKey(slot.id, y, mo, d);
      if (weeklyFiredKeys.has(dayKey)) continue;
      const st = useStore.getState();
      if (st.currentPlaylistId === slot.playlistId && st.automationStatus !== 'stopped') {
        weeklyFiredKeys.add(dayKey);
        continue;
      }
      weeklyFiredKeys.add(dayKey);
      await loadAndPlayFromPlaylist(slot.playlistId, slot.label, slot.maxDurationMs);
      return;
    }
  } catch (err) {
    markScheduleInvokeError(err);
    console.warn('[Radio Sankt] weekly schedule tick', err);
  }
}
