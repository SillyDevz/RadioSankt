export const SCHEDULE_SNAP_MIN = 15;
export const SCHEDULE_RANGE_MIN = 24 * 60;

export function snapMinute(m: number): number {
  return Math.round(m / SCHEDULE_SNAP_MIN) * SCHEDULE_SNAP_MIN;
}

export function slotsOverlap(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  const aEnd = aStart + aDur;
  const bEnd = bStart + bDur;
  return aStart < bEnd && aEnd > bStart;
}

export interface WeeklySlotLike {
  id: number;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
}

export function hasWeeklyConflict(
  slots: WeeklySlotLike[],
  ignoreId: number,
  dow: number,
  start: number,
  dur: number,
): boolean {
  for (const s of slots) {
    if (s.id === ignoreId) continue;
    if (s.dayOfWeek !== dow) continue;
    if (slotsOverlap(start, dur, s.startMinute, s.durationMinutes)) return true;
  }
  return false;
}

/** Max duration from `start` until midnight or the next slot on the same day (exclusive of `ignoreId`). */
export function maxDurationBeforeNext(
  slots: WeeklySlotLike[],
  ignoreId: number,
  dow: number,
  start: number,
): number {
  let limit = SCHEDULE_RANGE_MIN - start;
  for (const s of slots) {
    if (s.id === ignoreId || s.dayOfWeek !== dow) continue;
    if (s.startMinute > start) limit = Math.min(limit, s.startMinute - start);
  }
  const snapped = Math.floor(limit / SCHEDULE_SNAP_MIN) * SCHEDULE_SNAP_MIN;
  return Math.max(SCHEDULE_SNAP_MIN, snapped);
}

/** Latest allowed start (snapped) for a block that ends at `endExclusive`, same day. */
export function minStartForEnd(
  slots: WeeklySlotLike[],
  ignoreId: number,
  dow: number,
  endExclusive: number,
): number {
  let lo = 0;
  for (const s of slots) {
    if (s.id === ignoreId || s.dayOfWeek !== dow) continue;
    const e = s.startMinute + s.durationMinutes;
    if (e <= endExclusive) lo = Math.max(lo, e);
  }
  return Math.ceil(lo / SCHEDULE_SNAP_MIN) * SCHEDULE_SNAP_MIN;
}

export function minuteFromClientY(gridRect: DOMRect, clientY: number, displayStartMin: number, rangeMin: number): number {
  const y = clientY - gridRect.top;
  const p = Math.min(1, Math.max(0, y / gridRect.height));
  return snapMinute(displayStartMin + p * rangeMin);
}
