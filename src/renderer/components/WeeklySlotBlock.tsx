import type { PointerEvent as ReactPointerEvent } from 'react';

export interface ProgramWeeklySlot {
  id: number;
  playlistId: number;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  maxDurationMs: number | null;
  label: string | null;
  createdAt: string;
}

interface WeeklySlotBlockProps {
  topPx: number;
  heightPx: number;
  name: string;
  timeLabel: string;
  title: string;
  compact: boolean;
  slotLabel: string | null;
  showShortFill: boolean;
  shortFillTitle: string;
  weeklyWritesOk: boolean;
  isDragging: boolean;
  onResizePointerDown: (e: ReactPointerEvent<HTMLDivElement>, edge: 'top' | 'bottom') => void;
  onMovePointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

export function WeeklySlotBlock({
  topPx,
  heightPx,
  name,
  timeLabel,
  title,
  compact,
  slotLabel,
  showShortFill,
  shortFillTitle,
  weeklyWritesOk,
  isDragging,
  onResizePointerDown,
  onMovePointerDown,
}: WeeklySlotBlockProps) {
  return (
    <div
      className={`absolute left-2 right-2 z-[2] flex flex-col rounded-xl border border-border/65 bg-bg-elevated shadow-md touch-none select-none overflow-hidden ${
        isDragging ? 'ring-2 ring-accent/35 opacity-95' : ''
      } ${weeklyWritesOk ? '' : 'opacity-60'}`}
      style={{ top: topPx, height: heightPx }}
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-x-0 top-0 z-20 h-2.5 shrink-0 cursor-ns-resize hover:bg-accent/10"
        onPointerDown={(e) => {
          e.stopPropagation();
          if (!weeklyWritesOk) return;
          onResizePointerDown(e, 'top');
        }}
      />
      <div
        className="flex min-h-0 flex-1 flex-col gap-0.5 px-3 py-2 pt-3.5 pb-3.5 cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          e.stopPropagation();
          if (!weeklyWritesOk) return;
          onMovePointerDown(e);
        }}
      >
        <span
          className={`pointer-events-none font-semibold text-text-primary leading-snug ${
            compact ? 'text-xs truncate' : 'text-sm line-clamp-2'
          }`}
        >
          {name}
        </span>
        {!compact && slotLabel ? (
          <span className="pointer-events-none text-xs text-text-secondary truncate">{slotLabel}</span>
        ) : null}
        {showShortFill ? (
          <span
            className="pointer-events-none mt-0.5 inline-flex w-fit max-w-full items-center rounded border border-warning/35 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-warning"
            title={shortFillTitle}
          >
            May repeat / not fill
          </span>
        ) : null}
        <span
          className={`pointer-events-none text-text-secondary tabular-nums mt-auto font-medium ${
            compact ? 'text-[11px]' : 'text-xs'
          }`}
        >
          {timeLabel}
        </span>
      </div>
      <div
        className="absolute inset-x-0 bottom-0 z-20 h-2.5 shrink-0 cursor-ns-resize hover:bg-accent/10"
        onPointerDown={(e) => {
          e.stopPropagation();
          if (!weeklyWritesOk) return;
          onResizePointerDown(e, 'bottom');
        }}
      />
    </div>
  );
}
