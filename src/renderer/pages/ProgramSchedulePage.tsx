import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useStore } from '@/store';
import {
  invalidateWeeklySlotsCache,
  isScheduleMainHandlersMissing,
  resetWeeklyScheduleFireKeys,
} from '@/services/automation-session';
import { REBUILD_SCHEDULE_IPC_HINT } from '@/utils/electron-schedule-ipc';
import { sumAutomationStepsDurationMs } from '@/utils/automation-duration';
import type { AutomationStep } from '@/store';
import { WeeklySlotBlock, type ProgramWeeklySlot as WeeklySlot } from '@/components/WeeklySlotBlock';
import {
  SCHEDULE_SNAP_MIN as SNAP_MIN,
  SCHEDULE_RANGE_MIN as RANGE_MIN,
  minuteFromClientY,
  hasWeeklyConflict,
  maxDurationBeforeNext,
  minStartForEnd,
  snapMinute,
} from '@/utils/weekly-schedule-geometry';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';

const DISPLAY_START_MIN = 0;
const DISPLAY_END_MIN = 24 * 60;
const QUARTERS_PER_DAY = RANGE_MIN / SNAP_MIN;
/** Vertical space per hour — larger = clearer 15m bands + short blocks (scrolls more). */
const HOUR_PX = 112;
/** Floor only so 1–5m slots stay clickable; keep well below a quarter-hour (~HOUR_PX/4). */
const SLOT_MIN_HEIGHT_PX = 16;

const DOW_KEYS = [
  'schedule.weekday.mon',
  'schedule.weekday.tue',
  'schedule.weekday.wed',
  'schedule.weekday.thu',
  'schedule.weekday.fri',
  'schedule.weekday.sat',
  'schedule.weekday.sun',
] as const;

/** Hour + half-hour guides; skip only the 00:00 hour line (header already marks the top). Keep 00:30 dashed. */
function ScheduleDayGridLines() {
  return (
    <>
      {Array.from({ length: 24 }, (_, h) => {
        if (h === 0) return null;
        return (
          <div
            key={`hr-${h}`}
            className="absolute left-0 right-0 pointer-events-none border-t border-border/22"
            style={{ top: `${((h * 60) / RANGE_MIN) * 100}%` }}
          />
        );
      })}
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={`half-${h}`}
          className="absolute left-0 right-0 pointer-events-none border-t border-dashed border-border/12"
          style={{ top: `${((h * 60 + 30) / RANGE_MIN) * 100}%` }}
        />
      ))}
    </>
  );
}

/** Very soft alternating 15-minute bands — matches click snap without loud contrast */
function scheduleFifteenMinuteStripeStyle(): CSSProperties {
  const q = 100 / QUARTERS_PER_DAY;
  return {
    background: `repeating-linear-gradient(
      to bottom,
      color-mix(in srgb, var(--border) 9%, transparent) 0,
      color-mix(in srgb, var(--border) 9%, transparent) ${q}%,
      transparent ${q}%,
      transparent ${q * 2}%
    )`,
  };
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const offset = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - offset);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatMinAsClock(m: number): string {
  const h = Math.floor(m / 60);
  const mi = m % 60;
  return `${h.toString().padStart(2, '0')}:${mi.toString().padStart(2, '0')}`;
}

function formatMsHuman(ms: number): string {
  if (ms <= 0) return '0m';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function timeInputToMinute(s: string): number {
  const [a, b] = s.split(':').map((x) => Number(x));
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.min(1439, Math.max(0, a * 60 + b));
}

interface PlaylistOpt {
  id: number;
  name: string;
}

const DRAG_THRESHOLD_PX = 5;

type DragKind = 'move' | 'resize-top' | 'resize-bottom';

interface ActiveSlotDrag {
  pointerId: number;
  kind: DragKind;
  slotId: number;
  playlistId: number;
  label: string | null;
  maxDurationMs: number | null;
  origDow: number;
  origStart: number;
  origDur: number;
  previewDow: number;
  previewStart: number;
  previewDur: number;
  startClientX: number;
  startClientY: number;
  startIntraMinuteOffset: number;
  bottomLockStart?: number;
  topLockEnd?: number;
  didMove: boolean;
}

function dowUnderClient(clientX: number, clientY: number): number | null {
  const top = document.elementFromPoint(clientX, clientY);
  if (!top) return null;
  const host = top.closest('[data-schedule-dow]');
  const v = host?.getAttribute('data-schedule-dow');
  return v != null ? Number(v) : null;
}

function slotShowsShortFill(slot: WeeklySlot, blockDurationMin: number, rawEstMs: number | undefined): boolean {
  if (rawEstMs == null) return false;
  const capped = slot.maxDurationMs != null ? Math.min(rawEstMs, slot.maxDurationMs) : rawEstMs;
  return capped + 8000 < blockDurationMin * 60000;
}

export default function ProgramSchedulePage() {
  const { t } = useTranslation();
  const locale = i18n.language.startsWith('pt') ? 'pt-PT' : 'en-US';
  const addToast = useStore((s) => s.addToast);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const followProgramSchedule = useStore((s) => s.followProgramSchedule);
  const setFollowProgramSchedule = useStore((s) => s.setFollowProgramSchedule);

  const [workWeekOnly, setWorkWeekOnly] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [playlists, setPlaylists] = useState<PlaylistOpt[]>([]);
  const [weeklySlots, setWeeklySlots] = useState<WeeklySlot[]>([]);

  const [modal, setModal] = useState<
    | null
    | { mode: 'new'; dayOfWeek: number; startMinute: number }
    | { mode: 'edit'; slot: WeeklySlot }
  >(null);

  const [scheduleIpcBroken, setScheduleIpcBroken] = useState(false);
  const [playlistContentMs, setPlaylistContentMs] = useState<Record<number, number>>({});
  const [slotDragPreview, setSlotDragPreview] = useState<{
    slotId: number;
    dow: number;
    start: number;
    dur: number;
  } | null>(null);
  const dragRef = useRef<ActiveSlotDrag | null>(null);
  /** After slot pointer-up, a synthetic click can hit the grid under the cursor (slot moved away) — skip "new block". */
  const suppressScheduleGridClickRef = useRef(false);
  const weeklySlotsRef = useRef<WeeklySlot[]>([]);
  weeklySlotsRef.current = weeklySlots;

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;

    let w: WeeklySlot[] = [];
    if (typeof api.listWeeklySlots === 'function') {
      try {
        const raw = await api.listWeeklySlots();
        w = Array.isArray(raw) ? (raw as WeeklySlot[]) : [];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('No handler registered')) setScheduleIpcBroken(true);
      }
    }

    let pls: Array<{ id: number; name: string }> = [];
    try {
      const list = await api.listPlaylists();
      pls = list.map((p) => ({ id: p.id, name: p.name }));
    } catch {
      useStore.getState().addToast(i18n.t('schedule.couldNotLoadSets', { defaultValue: 'Could not load saved sets.' }), 'error');
    }

    setWeeklySlots(w);
    setPlaylists(pls);
    if (isScheduleMainHandlersMissing()) setScheduleIpcBroken(true);
    invalidateWeeklySlotsCache();

    const est: Record<number, number> = {};
    const ids = [...new Set(w.map((s) => s.playlistId))];
    await Promise.all(
      ids.map(async (pid) => {
        try {
          const row = await api.loadPlaylist(pid);
          if (!row) return;
          const steps = JSON.parse(row.steps) as AutomationStep[];
          est[pid] = sumAutomationStepsDurationMs(steps);
        } catch {
          /* ignore */
        }
      }),
    );
    setPlaylistContentMs(est);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const monday = useMemo(() => {
    const base = startOfWeekMonday(new Date());
    base.setDate(base.getDate() + weekOffset * 7);
    return base;
  }, [weekOffset]);

  const dayColumns = useMemo(() => {
    const n = workWeekOnly ? 5 : 7;
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return {
        dow: i,
        date: d,
        label: t(DOW_KEYS[i], { defaultValue: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] }),
        dayNum: d.getDate(),
      };
    });
  }, [locale, monday, t, workWeekOnly]);

  const gridHeightPx = ((DISPLAY_END_MIN - DISPLAY_START_MIN) / 60) * HOUR_PX;

  const playlistName = (id: number) => playlists.find((p) => p.id === id)?.name ?? `#${id}`;

  const maxDow = workWeekOnly ? 4 : 6;

  const weeklyWritesOk =
    typeof window.electronAPI?.addWeeklySlot === 'function' &&
    typeof window.electronAPI?.updateWeeklySlot === 'function';

  const beginSlotDrag = useCallback(
    (slot: WeeklySlot, kind: DragKind, e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!weeklyWritesOk) return;
      const host = (e.target as HTMLElement).closest('[data-schedule-dow]');
      const gridRect = host?.getBoundingClientRect();
      if (!host || !gridRect) return;
      const anchorM = minuteFromClientY(gridRect, e.clientY, DISPLAY_START_MIN, RANGE_MIN);
      const startIntra = kind === 'move' ? anchorM - slot.startMinute : 0;
      const d: ActiveSlotDrag = {
        pointerId: e.pointerId,
        kind,
        slotId: slot.id,
        playlistId: slot.playlistId,
        label: slot.label,
        maxDurationMs: slot.maxDurationMs,
        origDow: slot.dayOfWeek,
        origStart: slot.startMinute,
        origDur: slot.durationMinutes,
        previewDow: slot.dayOfWeek,
        previewStart: slot.startMinute,
        previewDur: slot.durationMinutes,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startIntraMinuteOffset: startIntra,
        bottomLockStart: kind === 'resize-bottom' ? slot.startMinute : undefined,
        topLockEnd: kind === 'resize-top' ? slot.startMinute + slot.durationMinutes : undefined,
        didMove: false,
      };
      dragRef.current = d;
      setSlotDragPreview({ slotId: slot.id, dow: d.previewDow, start: d.previewStart, dur: d.previewDur });

      const applyPreview = (next: Partial<ActiveSlotDrag>) => {
        const cur = dragRef.current;
        if (!cur) return;
        const merged = { ...cur, ...next };
        dragRef.current = merged;
        setSlotDragPreview({
          slotId: merged.slotId,
          dow: merged.previewDow,
          start: merged.previewStart,
          dur: merged.previewDur,
        });
      };

      const onMove = (ev: PointerEvent) => {
        const cur = dragRef.current;
        if (!cur || ev.pointerId !== cur.pointerId) return;
        const moved =
          Math.abs(ev.clientX - cur.startClientX) > DRAG_THRESHOLD_PX ||
          Math.abs(ev.clientY - cur.startClientY) > DRAG_THRESHOLD_PX;
        if (moved && !cur.didMove) {
          dragRef.current = { ...cur, didMove: true };
        }
        const slots = weeklySlotsRef.current;
        const curAfterMove = dragRef.current;
        if (!curAfterMove) return;
        if (curAfterMove.kind === 'move') {
          const nd = Math.max(
            0,
            Math.min(maxDow, dowUnderClient(ev.clientX, ev.clientY) ?? curAfterMove.previewDow),
          );
          const g = document.querySelector(`[data-schedule-dow="${nd}"]`)?.getBoundingClientRect();
          if (!g) return;
          const rawStart =
            minuteFromClientY(g, ev.clientY, DISPLAY_START_MIN, RANGE_MIN) -
            curAfterMove.startIntraMinuteOffset;
          let ns = snapMinute(rawStart);
          ns = Math.max(0, Math.min(RANGE_MIN - curAfterMove.previewDur, ns));
          if (hasWeeklyConflict(slots, curAfterMove.slotId, nd, ns, curAfterMove.previewDur)) return;
          applyPreview({
            previewDow: nd,
            previewStart: ns,
            previewDur: curAfterMove.origDur,
            didMove: curAfterMove.didMove || moved,
          });
        } else if (curAfterMove.kind === 'resize-bottom' && curAfterMove.bottomLockStart != null) {
          const g = document
            .querySelector(`[data-schedule-dow="${curAfterMove.previewDow}"]`)
            ?.getBoundingClientRect();
          if (!g) return;
          const endSn = snapMinute(minuteFromClientY(g, ev.clientY, DISPLAY_START_MIN, RANGE_MIN));
          const cap = maxDurationBeforeNext(
            slots,
            curAfterMove.slotId,
            curAfterMove.previewDow,
            curAfterMove.bottomLockStart,
          );
          let ndur = Math.max(SNAP_MIN, Math.min(cap, endSn - curAfterMove.bottomLockStart));
          ndur = snapMinute(ndur);
          applyPreview({
            previewStart: curAfterMove.bottomLockStart,
            previewDur: ndur,
            didMove: curAfterMove.didMove || moved,
          });
        } else if (curAfterMove.kind === 'resize-top' && curAfterMove.topLockEnd != null) {
          const g = document
            .querySelector(`[data-schedule-dow="${curAfterMove.previewDow}"]`)
            ?.getBoundingClientRect();
          if (!g) return;
          const end = curAfterMove.topLockEnd;
          const lo = minStartForEnd(slots, curAfterMove.slotId, curAfterMove.previewDow, end);
          let ns = snapMinute(minuteFromClientY(g, ev.clientY, DISPLAY_START_MIN, RANGE_MIN));
          ns = Math.max(lo, Math.min(end - SNAP_MIN, ns));
          const ndur = end - ns;
          applyPreview({
            previewStart: ns,
            previewDur: ndur,
            didMove: curAfterMove.didMove || moved,
          });
        }
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
      };

      const onUp = async (ev: PointerEvent) => {
        const cur = dragRef.current;
        if (cur && ev.pointerId === cur.pointerId) {
          suppressScheduleGridClickRef.current = true;
          window.setTimeout(() => {
            suppressScheduleGridClickRef.current = false;
          }, 0);
        }
        cleanup();
        dragRef.current = null;
        setSlotDragPreview(null);
        if (!cur || ev.pointerId !== cur.pointerId) return;
        const slots = weeklySlotsRef.current;
        const hitSlot = slots.find((s) => s.id === cur.slotId);
        if (!hitSlot) return;
        const previewUnchangedFromStart =
          cur.previewDow === cur.origDow &&
          cur.previewStart === cur.origStart &&
          cur.previewDur === cur.origDur;
        if (cur.kind === 'move' && !cur.didMove && previewUnchangedFromStart) {
          setModal({ mode: 'edit', slot: hitSlot });
          return;
        }
        const same =
          cur.previewDow === hitSlot.dayOfWeek &&
          cur.previewStart === hitSlot.startMinute &&
          cur.previewDur === hitSlot.durationMinutes;
        if (same) return;
        if (hasWeeklyConflict(slots, cur.slotId, cur.previewDow, cur.previewStart, cur.previewDur)) {
          addToast(t('schedule.overlapNotSaved', { defaultValue: 'Overlaps another block - not saved.' }), 'warning');
          return;
        }
        try {
          const api = window.electronAPI?.updateWeeklySlot;
          if (typeof api !== 'function') {
            addToast(REBUILD_SCHEDULE_IPC_HINT, 'warning');
            return;
          }
          await api(
            cur.slotId,
            cur.playlistId,
            cur.previewDow,
            cur.previewStart,
            cur.previewDur,
            cur.maxDurationMs,
            cur.label,
          );
          invalidateWeeklySlotsCache();
          resetWeeklyScheduleFireKeys();
          await refresh();
        } catch {
          addToast(t('schedule.couldNotUpdate', { defaultValue: 'Could not update block.' }), 'error');
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    },
    [addToast, maxDow, refresh, weeklyWritesOk],
  );

  if (!window.electronAPI) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
        <p className="text-text-secondary text-sm max-w-md">
          {t('schedule.desktopOnly')}
        </p>
        <button
          type="button"
          onClick={() => setCurrentPage('studio')}
          className="px-4 py-2 rounded-lg bg-accent text-bg-primary text-sm font-medium"
        >
          {t('schedule.backToStudio')}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-5 text-text-primary animate-page-enter">
      {(scheduleIpcBroken || isScheduleMainHandlersMissing()) && (
        <div className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-100/95">
          {REBUILD_SCHEDULE_IPC_HINT}
        </div>
      )}
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t('schedule.title')}</h1>
          <p className="text-sm text-text-secondary max-w-xl leading-relaxed">
            {t('schedule.description', {
              defaultValue:
                'Weekly blocks repeat each week. Turn on "Follow schedule" so automation loads the set for the current block (including if you open the app mid-block). The app must stay open.',
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer select-none rounded-lg border border-border bg-bg-elevated px-3 py-2">
            <input
              type="checkbox"
              checked={followProgramSchedule}
              onChange={(e) => setFollowProgramSchedule(e.target.checked)}
              className="rounded border-border w-3.5 h-3.5 accent-accent"
            />
              <span className="font-medium">{t('schedule.follow')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={workWeekOnly}
              onChange={(e) => setWorkWeekOnly(e.target.checked)}
              className="rounded border-border w-3.5 h-3.5 accent-accent"
            />
            {t('schedule.workweekOnly', { defaultValue: 'Mon-Fri only' })}
          </label>
          <div className="flex items-center rounded-lg border border-border bg-bg-elevated p-0.5">
            <button
              type="button"
              onClick={() => setWeekOffset((o) => o - 1)}
              className="px-2.5 py-1.5 text-sm text-text-secondary rounded-md hover:bg-bg-surface hover:text-text-primary transition-colors"
              aria-label={t('schedule.previousWeek')}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="px-3 py-1.5 text-xs font-medium text-text-primary rounded-md hover:bg-bg-surface transition-colors"
            >
              {t('schedule.thisWeek')}
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset((o) => o + 1)}
              className="px-2.5 py-1.5 text-sm text-text-secondary rounded-md hover:bg-bg-surface hover:text-text-primary transition-colors"
              aria-label={t('schedule.nextWeek')}
            >
              ›
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col min-h-0">
        <section className="flex-1 min-h-[440px] flex flex-col rounded-2xl border border-border bg-bg-surface overflow-hidden">
          <div className="shrink-0 px-4 py-3 border-b border-border/30 bg-bg-elevated/25 flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-text-primary">
              {t('schedule.weekOf')}{' '}
              <span className="text-text-secondary font-normal">
                {monday.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            </span>
            <span className="text-xs text-text-muted hidden sm:inline">{t('schedule.clickHint')}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="flex min-w-[800px]">
              <div
                className="shrink-0 w-[4.5rem] flex flex-col bg-bg-elevated/15 border-r border-border/22 self-stretch"
                style={{ minHeight: `calc(3.25rem + ${gridHeightPx}px)` }}
              >
                <div className="h-[3.25rem] shrink-0 border-b border-border/25" aria-hidden />
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    style={{ height: HOUR_PX }}
                    className="border-t border-border/22 text-xs text-text-muted tabular-nums text-right pr-2.5 pt-1 font-medium leading-none first:border-t-0"
                  >
                    {formatMinAsClock(h * 60)}
                  </div>
                ))}
              </div>
              <div className="flex flex-1 min-w-0 self-stretch">
                {dayColumns.map((col) => {
                  const slotsForDay = weeklySlots.filter((s) => {
                    const pre = slotDragPreview;
                    if (pre && pre.slotId === s.id) return pre.dow === col.dow;
                    return s.dayOfWeek === col.dow;
                  });
                  const dateShort = col.date.toLocaleDateString(locale, { month: 'short' });
                  return (
                    <div
                      key={col.dow}
                      className={
                        col.dow === dayColumns[dayColumns.length - 1]?.dow
                          ? 'flex-1 min-w-[118px] flex flex-col self-stretch'
                          : 'flex-1 min-w-[118px] flex flex-col self-stretch border-r border-border/18'
                      }
                      style={{ minHeight: `calc(3.25rem + ${gridHeightPx}px)` }}
                    >
                      <div className="h-[3.25rem] shrink-0 px-2 flex flex-col items-center justify-center border-b border-border/25 bg-bg-elevated/20">
                        <span className="text-sm font-semibold text-text-primary tracking-wide">{col.label}</span>
                        <span className="text-xs text-text-secondary tabular-nums mt-0.5">
                          {dateShort} {col.dayNum}
                        </span>
                      </div>
                      <div
                        data-schedule-dow={col.dow}
                        className="relative shrink-0 mx-1.5 mb-1.5 mt-0.5 rounded-xl bg-bg-primary/30 cursor-pointer hover:bg-bg-elevated/25 transition-colors"
                        style={{ height: gridHeightPx }}
                        onClick={(e) => {
                          if (suppressScheduleGridClickRef.current) {
                            e.preventDefault();
                            return;
                          }
                          if (!weeklyWritesOk) {
                            addToast(REBUILD_SCHEDULE_IPC_HINT, 'warning');
                            return;
                          }
                          const r = e.currentTarget.getBoundingClientRect();
                          const y = e.clientY - r.top;
                          const pct = Math.min(1, Math.max(0, y / r.height));
                          const raw = DISPLAY_START_MIN + pct * RANGE_MIN;
                          const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
                          const startMinute = Math.min(DISPLAY_END_MIN - SNAP_MIN, Math.max(DISPLAY_START_MIN, snapped));
                          setModal({ mode: 'new', dayOfWeek: col.dow, startMinute });
                        }}
                        role="presentation"
                      >
                        <div
                          className="absolute inset-0 z-0 rounded-xl pointer-events-none"
                          style={scheduleFifteenMinuteStripeStyle()}
                          aria-hidden
                        />
                        <div className="absolute inset-0 z-[1] pointer-events-none rounded-xl overflow-hidden">
                          <ScheduleDayGridLines />
                        </div>
                        {slotsForDay.map((slot) => {
                          const pre =
                            slotDragPreview?.slotId === slot.id ? slotDragPreview : null;
                          const startMin = pre?.start ?? slot.startMinute;
                          const durMin = pre?.dur ?? slot.durationMinutes;
                          const topPx = ((startMin - DISPLAY_START_MIN) / RANGE_MIN) * gridHeightPx;
                          const rawH = (durMin / RANGE_MIN) * gridHeightPx;
                          const hPx = Math.min(gridHeightPx - topPx, Math.max(SLOT_MIN_HEIGHT_PX, rawH));
                          const name = playlistName(slot.playlistId);
                          const compact = hPx < HOUR_PX * 1.05;
                          const rawEst = playlistContentMs[slot.playlistId];
                          const showShortFill = slotShowsShortFill(slot, durMin, rawEst);
                          const cappedEst =
                            rawEst == null
                              ? 0
                              : slot.maxDurationMs != null
                                ? Math.min(rawEst, slot.maxDurationMs)
                                : rawEst;
                          const shortFillTitle = showShortFill
                            ? `About ${formatMsHuman(cappedEst)} of content in this set vs ${durMin} min block — may repeat or not fill the slot.`
                            : '';
                          const blockTitle = `${name}${slot.label ? ` — ${slot.label}` : ''} · ${formatMinAsClock(startMin)}–${formatMinAsClock(startMin + durMin)}`;
                          const dragging = Boolean(pre);
                          return (
                            <WeeklySlotBlock
                              key={slot.id}
                              topPx={topPx}
                              heightPx={hPx}
                              name={name}
                              timeLabel={`${formatMinAsClock(startMin)} · ${durMin} min`}
                              title={blockTitle}
                              compact={compact}
                              slotLabel={slot.label}
                              showShortFill={showShortFill}
                              shortFillTitle={shortFillTitle}
                              weeklyWritesOk={weeklyWritesOk}
                              isDragging={dragging}
                              onMovePointerDown={(ev) => beginSlotDrag(slot, 'move', ev)}
                              onResizePointerDown={(ev, edge) =>
                                beginSlotDrag(slot, edge === 'top' ? 'resize-top' : 'resize-bottom', ev)
                              }
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>

      {modal && (
        <WeeklySlotModal
          playlists={playlists}
          initial={
            modal.mode === 'new'
              ? {
                  id: null,
                  playlistId: playlists[0]?.id ?? 0,
                  dayOfWeek: modal.dayOfWeek,
                  startMinute: modal.startMinute,
                  durationMinutes: 60,
                  maxDurationMs: null,
                  label: null,
                }
              : {
                  id: modal.slot.id,
                  playlistId: modal.slot.playlistId,
                  dayOfWeek: modal.slot.dayOfWeek,
                  startMinute: modal.slot.startMinute,
                  durationMinutes: modal.slot.durationMinutes,
                  maxDurationMs: modal.slot.maxDurationMs,
                  label: modal.slot.label,
                }
          }
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function WeeklySlotModal({
  playlists,
  initial,
  onClose,
  onSaved,
}: {
  playlists: PlaylistOpt[];
  initial: {
    id: number | null;
    playlistId: number;
    dayOfWeek: number;
    startMinute: number;
    durationMinutes: number;
    maxDurationMs: number | null;
    label: string | null;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const addToast = useStore((s) => s.addToast);
  const [playlistId, setPlaylistId] = useState(initial.playlistId);
  const [dayOfWeek, setDayOfWeek] = useState(initial.dayOfWeek);
  const [startMinute, setStartMinute] = useState(initial.startMinute);
  const [durationMinutes, setDurationMinutes] = useState(initial.durationMinutes);
  const [maxAirMin, setMaxAirMin] = useState(
    initial.maxDurationMs != null ? String(Math.round(initial.maxDurationMs / 60000)) : '',
  );
  const [label, setLabel] = useState(initial.label ?? '');
  const [estimatedMs, setEstimatedMs] = useState<number | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api || !playlistId) {
      setEstimatedMs(null);
      return;
    }
    void api.loadPlaylist(playlistId).then((row) => {
      if (!row) {
        setEstimatedMs(null);
        return;
      }
      try {
        const steps = JSON.parse(row.steps) as AutomationStep[];
        setEstimatedMs(sumAutomationStepsDurationMs(steps));
      } catch {
        setEstimatedMs(null);
      }
    });
  }, [playlistId]);

  const save = async () => {
    const api = window.electronAPI;
    if (!api || playlists.length === 0) return;
    let maxMs: number | null = null;
    if (maxAirMin.trim() !== '') {
      const n = Number(maxAirMin);
      if (Number.isNaN(n) || n <= 0) {
        addToast(i18n.t('schedule.maxAirtimeInvalid', { defaultValue: 'Max airtime must be a positive number of minutes or empty.' }), 'warning');
        return;
      }
      maxMs = Math.round(n * 60000);
    }
    try {
      if (initial.id == null) {
        const addW = api.addWeeklySlot;
        if (typeof addW !== 'function') {
          addToast(REBUILD_SCHEDULE_IPC_HINT, 'warning');
          return;
        }
        await addW(
          playlistId,
          dayOfWeek,
          startMinute,
          Math.max(5, durationMinutes),
          maxMs,
          label.trim() || null,
        );
      } else {
        const upd = api.updateWeeklySlot;
        if (typeof upd !== 'function') {
          addToast(REBUILD_SCHEDULE_IPC_HINT, 'warning');
          return;
        }
        await upd(
          initial.id,
          playlistId,
          dayOfWeek,
          startMinute,
          Math.max(5, durationMinutes),
          maxMs,
          label.trim() || null,
        );
      }
      addToast(i18n.t('schedule.slotSaved', { defaultValue: 'Weekly slot saved.' }), 'success');
      invalidateWeeklySlotsCache();
      resetWeeklyScheduleFireKeys();
      onSaved();
    } catch {
      addToast(i18n.t('schedule.couldNotSaveSlot', { defaultValue: 'Could not save slot.' }), 'error');
    }
  };

  const remove = async () => {
    if (initial.id == null) {
      onClose();
      return;
    }
    const del = window.electronAPI?.deleteWeeklySlot;
    if (typeof del !== 'function') {
      addToast(REBUILD_SCHEDULE_IPC_HINT, 'warning');
      return;
    }
    try {
      await del(initial.id);
      addToast(i18n.t('schedule.removed', { defaultValue: 'Removed.' }), 'info');
      invalidateWeeklySlotsCache();
      resetWeeklyScheduleFireKeys();
      onSaved();
    } catch {
      addToast(i18n.t('schedule.couldNotRemove', { defaultValue: 'Could not remove.' }), 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md bg-bg-surface border border-border rounded-xl shadow-2xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">
          {initial.id == null
            ? i18n.t('schedule.modal.newWeeklySlot', { defaultValue: 'New weekly slot' })
            : i18n.t('schedule.modal.editWeeklySlot', { defaultValue: 'Edit weekly slot' })}
        </h2>
        <label className="block text-[11px] text-text-muted">{i18n.t('schedule.modal.savedSet', { defaultValue: 'Saved set' })}</label>
        <select
          value={String(playlistId)}
          onChange={(e) => setPlaylistId(Number(e.target.value))}
          className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {estimatedMs != null && (
          <p className="text-[11px] text-text-secondary">
            {i18n.t('schedule.modal.estimatedLength', {
              length: formatMsHuman(estimatedMs),
              defaultValue: 'Estimated length: {{length}} - use max airtime to trim if the slot is shorter.',
            })}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-text-muted mb-0.5">{i18n.t('schedule.modal.day', { defaultValue: 'Day' })}</label>
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
            >
              {DOW_KEYS.map((d, i) => (
                <option key={d} value={i}>
                  {i18n.t(`schedule.weekdayFull.${d.split('.').pop()}`, {
                    defaultValue: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
                  })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-text-muted mb-0.5">{i18n.t('schedule.modal.start', { defaultValue: 'Start' })}</label>
            <input
              type="time"
              value={formatMinAsClock(startMinute)}
              onChange={(e) => setStartMinute(timeInputToMinute(e.target.value))}
              className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-text-muted mb-0.5">{i18n.t('schedule.modal.blockLength', { defaultValue: 'Block length (min)' })}</label>
            <input
              type="number"
              min={5}
              max={24 * 60}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-[11px] text-text-muted mb-0.5">{i18n.t('schedule.modal.maxAirtime', { defaultValue: 'Max airtime (min, optional)' })}</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder={i18n.t('schedule.modal.trimQueue', { defaultValue: 'Trim queue' })}
              value={maxAirMin}
              onChange={(e) => setMaxAirMin(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-0.5">{i18n.t('schedule.modal.labelOptional', { defaultValue: 'Label (optional)' })}</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="flex justify-between gap-2 pt-1">
          {initial.id != null ? (
            <button type="button" onClick={() => void remove()} className="text-xs text-danger hover:underline">
              {i18n.t('schedule.modal.deleteSlot', { defaultValue: 'Delete slot' })}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-bg-elevated text-xs text-text-primary hover:bg-border"
            >
              {i18n.t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={playlists.length === 0}
              className="px-3 py-1.5 rounded-lg bg-accent text-bg-primary text-xs font-medium disabled:opacity-40"
            >
              {i18n.t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
