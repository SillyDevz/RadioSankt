import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import type { AutomationStep } from '@/store';
import Tooltip from '@/components/Tooltip';
import { basename, stripExtension } from '@/utils/path';
import { formatDuration } from '@/utils/formatTime';

const fallbackIcons: Record<string, string> = {
  track: '\u{1F3B5}',
  playlist: '\u{1F4DC}',
  jingle: '\u{1F399}',
  ad: '\u{1F4E2}',
  pause: '\u23F8',
};

interface StepCardProps {
  step: AutomationStep;
  isPlaying: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onPlayFromHere: () => void;
}

const StepCard = React.memo(function StepCard({ step, isPlaying, isSelected, onSelect, onDelete, onPlayFromHere }: StepCardProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const rawName = step.type === 'pause' ? step.label || t('automation.step.pausePoint') : step.name;
  // Legacy records on Windows may have a full file path in `name`; show a clean filename.
  const name = (step.type === 'jingle' || step.type === 'ad') && /[\\/]/.test(rawName)
    ? stripExtension(basename(rawName))
    : rawName;
  const subtitle =
    step.type === 'track'
      ? step.artist
      : step.type === 'playlist'
        ? t('automation.step.playlistTracks', { count: step.trackCount, defaultValue: 'Playlist · {{count}} tracks' })
        : step.type === 'jingle'
          ? t('automation.step.jingle')
          : step.type === 'ad'
            ? t('automation.step.adBreak')
          : t('automation.step.pausesHere');
  const duration = step.type !== 'pause' ? formatDuration(step.durationMs) : '--:--';

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all group ${
        isSelected ? 'bg-bg-elevated ring-1 ring-accent/40' : 'hover:bg-bg-elevated/60'
      } ${isPlaying ? 'border-l-2 border-l-accent' : 'border-l-2 border-l-transparent'}`}
    >
      {/* Drag handle */}
      <Tooltip content={t('automation.step.dragReorder')} placement="left">
        <button
          {...attributes}
          {...listeners}
          data-coachmark="drag-handle"
          className="shrink-0 cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary p-0.5"
          aria-label={t('automation.step.dragReorder')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
      </Tooltip>

      <Tooltip content={t('automation.step.playFromHere')} placement="top">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPlayFromHere();
          }}
          className="shrink-0 p-1.5 rounded-full text-accent hover:bg-accent/15 transition-colors"
          aria-label={t('automation.step.playFromHere')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
        </button>
      </Tooltip>

      {(step.type === 'track' || step.type === 'playlist') && step.albumArt?.trim() ? (
        <img
          src={step.albumArt}
          alt=""
          className="h-10 w-10 rounded-md object-cover shrink-0 bg-bg-elevated"
          loading="lazy"
        />
      ) : (
        <div className="h-10 w-10 rounded-md bg-bg-elevated flex items-center justify-center shrink-0 text-base leading-none">
          {fallbackIcons[step.type]}
        </div>
      )}

      {/* Playing indicator */}
      {isPlaying && (
        <span className="shrink-0 w-2 h-2 rounded-full bg-accent animate-pulse" />
      )}

      {/* Name + subtitle */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{name}</div>
        <div className="text-xs text-text-muted truncate">{subtitle}</div>
      </div>

      {/* Duration */}
      <span className="text-xs text-text-muted tabular-nums shrink-0">{duration}</span>

      {/* Delete */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="shrink-0 p-1 rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-colors opacity-0 group-hover:opacity-100"
        aria-label={t('automation.step.remove')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
});

export default StepCard;
