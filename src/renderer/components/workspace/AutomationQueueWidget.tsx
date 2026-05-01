import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useStore, type AutomationStep } from '@/store';
import AutomationEngine from '@/engine/AutomationEngine';
import StepCard from '@/components/automation/StepCard';
import Tooltip from '@/components/Tooltip';
import EmptyState from '@/components/automation/EmptyState';
import SavePlaylistModal from '@/components/automation/SavePlaylistModal';
import LoadPlaylistModal from '@/components/automation/LoadPlaylistModal';
import { formatDurationCeil } from '@/utils/formatTime';

const checkboxClassName = 'shrink-0 cursor-pointer rounded border-border w-3.5 h-3.5 accent-accent';

function stepDurationMs(step: AutomationStep | undefined): number {
  if (!step || step.type === 'pause') return 0;
  return step.durationMs;
}

/** Isolated component that subscribes to the fast-ticking stepTimeRemaining store slice. */
function StepCountdown({ steps }: { steps: AutomationStep[] }) {
  const stepTimeRemaining = useStore((s) => s.stepTimeRemaining);
  const currentStepIndex = useStore((s) => s.currentStepIndex);
  const automationStatus = useStore((s) => s.automationStatus);

  const isPlaying = automationStatus === 'playing';
  const isPaused = automationStatus === 'paused';

  const currentStep = steps[currentStepIndex];
  const stepDur = stepDurationMs(currentStep);
  const withinStepFrac =
    (isPlaying || isPaused) && stepDur > 0
      ? Math.max(0, Math.min(1, (stepDur - stepTimeRemaining) / stepDur))
      : 0;
  const progressPct =
    steps.length > 0 ? ((currentStepIndex + withinStepFrac) / steps.length) * 100 : 0;

  return (
    <div className="flex-1 flex items-center gap-3 min-w-0 px-2">
      <span className="text-xs font-medium text-text-secondary whitespace-nowrap">
        Step {currentStepIndex + 1} of {steps.length}
      </span>
      <div className="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-300 rounded-full"
          style={{ width: `${Math.min(progressPct, 100)}%` }}
        />
      </div>
      {isPlaying && (
        <span className="text-xs font-medium text-text-secondary tabular-nums whitespace-nowrap">
          -{formatDurationCeil(stepTimeRemaining)}
        </span>
      )}
    </div>
  );
}

function QueueHeader() {
  const { t } = useTranslation();
  const setSavePlaylistModalOpen = useStore((s) => s.setSavePlaylistModalOpen);
  const setLoadPlaylistModalOpen = useStore((s) => s.setLoadPlaylistModalOpen);
  const breakRule = useStore((s) => s.breakRules[0]);
  const updateBreakRule = useStore((s) => s.updateBreakRule);
  const jingles = useStore((s) => s.jingles);
  const ads = useStore((s) => s.ads);
  const selectedJingleIds = breakRule?.selectedJingleIds ?? [];
  const selectedAdIds = breakRule?.selectedAdIds ?? [];
  const hasJingles = jingles.length > 0;
  const hasAds = ads.length > 0;
  const [showConfig, setShowConfig] = useState(false);
  const [showJinglePool, setShowJinglePool] = useState(false);
  const [showAdPool, setShowAdPool] = useState(false);

  return (
    <div className="px-6 py-4 border-b border-border bg-bg-elevated/20 shrink-0 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-text-primary">{t('automation.queue.title', { defaultValue: 'Automation Queue' })}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLoadPlaylistModalOpen(true)}
            className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded-lg text-xs font-medium transition-colors"
          >
            {t('automation.queue.loadSet', { defaultValue: 'Load set' })}
          </button>
          <button
            type="button"
            onClick={() => setSavePlaylistModalOpen(true)}
            className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded-lg text-xs font-medium transition-colors"
          >
            {t('automation.queue.saveSet', { defaultValue: 'Save set' })}
          </button>
        </div>
      </div>
      {breakRule && (
        <>
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between gap-3">
              <label className="flex min-w-0 cursor-pointer select-none items-center gap-2 text-text-secondary">
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={breakRule.enabled}
                  onChange={(e) => updateBreakRule(breakRule.id, { enabled: e.target.checked })}
                />
                <span className="shrink-0">{t('automation.queue.dynamicBreaks', { defaultValue: 'Dynamic breaks' })}</span>
              </label>
              <button
                type="button"
                onClick={() => setShowConfig((v) => !v)}
                className="shrink-0 rounded px-2 py-1 text-text-muted hover:bg-bg-elevated hover:text-text-primary"
              >
                {showConfig ? t('automation.queue.hide', { defaultValue: 'Hide' }) : t('automation.queue.configure', { defaultValue: 'Configure' })}
              </button>
            </div>
            <p className="text-text-muted pl-[calc(0.875rem+0.5rem)] leading-snug">
              {t('automation.queue.ruleSummary', {
                songs: breakRule.everySongs,
                clips: breakRule.itemsPerBreak,
                avoid: breakRule.avoidRecent,
                defaultValue: 'Every {{songs}} songs, play {{clips}} clips, avoid repeating last {{avoid}}',
              })}
            </p>
          </div>

          {showConfig && (
            <>
              {/* Rule numbers */}
              <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                <span className="text-text-muted">{t('automation.queue.every', { defaultValue: 'Every' })}</span>
                <input type="number" min={1} value={breakRule.everySongs} onChange={(e) => updateBreakRule(breakRule.id, { everySongs: Math.max(1, Number(e.target.value) || 1) })} className="w-14 bg-bg-elevated border border-border rounded px-2 py-1 text-text-primary" />
                <span className="text-text-muted">
                  {t('automation.queue.songsPlay', { defaultValue: 'songs, play' })}
                </span>
                <input type="number" min={1} value={breakRule.itemsPerBreak} onChange={(e) => updateBreakRule(breakRule.id, { itemsPerBreak: Math.max(1, Number(e.target.value) || 1) })} className="w-14 bg-bg-elevated border border-border rounded px-2 py-1 text-text-primary" />
                <span className="text-text-muted">
                  {t('automation.queue.clipsAvoid', { defaultValue: 'clips, avoid repeating last' })}
                </span>
                <input type="number" min={0} value={breakRule.avoidRecent} onChange={(e) => updateBreakRule(breakRule.id, { avoidRecent: Math.max(0, Number(e.target.value) || 0) })} className="w-14 bg-bg-elevated border border-border rounded px-2 py-1 text-text-primary" />
              </div>

              {/* Warnings */}
              {breakRule.enabled && selectedJingleIds.length + selectedAdIds.length === 0 && (
                <p className="text-xs text-amber-400">{t('automation.queue.pickOneClip', { defaultValue: 'Pick at least one clip in the pools' })}</p>
              )}
              {breakRule.enabled && !hasJingles && !hasAds && (
                <p className="text-xs text-text-muted">{t('automation.queue.noClipsYet', { defaultValue: 'No clips in the library yet - add jingles or ads from Search, then Manage.' })}</p>
              )}
              <p className="text-[11px] text-text-muted leading-snug">
                {t('automation.queue.breakHint', {
                  defaultValue:
                    'Breaks are inserted between tracks while automation is running. Add songs to the queue and press Play.',
                })}
              </p>

              {/* Pools — stacked below the phrase, each taking its own row. */}
              <div className="flex flex-col gap-2">
                <PoolSection
                  label={t('automation.queue.jinglePool', { count: selectedJingleIds.length, defaultValue: 'Jingle pool ({{count}})' })}
                  items={jingles}
                  selectedIds={selectedJingleIds}
                  expanded={showJinglePool}
                  onToggleExpanded={() => hasJingles && setShowJinglePool((v) => !v)}
                  disabled={!hasJingles}
                  onChange={(nextIds) => updateBreakRule(breakRule.id, { selectedJingleIds: nextIds })}
                />
                <PoolSection
                  label={t('automation.queue.adPool', { count: selectedAdIds.length, defaultValue: 'Ad pool ({{count}})' })}
                  items={ads}
                  selectedIds={selectedAdIds}
                  expanded={showAdPool}
                  onToggleExpanded={() => hasAds && setShowAdPool((v) => !v)}
                  disabled={!hasAds}
                  onChange={(nextIds) => updateBreakRule(breakRule.id, { selectedAdIds: nextIds })}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

interface PoolSectionProps {
  label: string;
  items: Array<{ id: number; name: string }>;
  selectedIds: number[];
  expanded: boolean;
  onToggleExpanded: () => void;
  disabled: boolean;
  onChange: (nextIds: number[]) => void;
}

function PoolSection({ label, items, selectedIds, expanded, onToggleExpanded, disabled, onChange }: PoolSectionProps) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated/30">
      <button
        type="button"
        onClick={onToggleExpanded}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate">{label}</span>
        {!disabled && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>
      {expanded && items.length > 0 && (
        <div className="border-t border-border px-3 py-2 grid grid-cols-2 gap-1 text-xs max-h-40 overflow-y-auto">
          {items.map((it) => {
            const checked = selectedIds.includes(it.id);
            const prettyName = /[\\/]/.test(it.name) ? it.name.split(/[\\/]+/).pop()?.replace(/\.[^.]+$/, '') ?? it.name : it.name;
            return (
              <label key={it.id} className="flex cursor-pointer select-none items-center gap-2 text-text-secondary">
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={checked}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...selectedIds, it.id] : selectedIds.filter((id) => id !== it.id))
                  }
                />
                <span className="truncate" title={prettyName}>{prettyName}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AutomationQueueWidget() {
  const { t } = useTranslation();
  const steps = useStore((s) => s.automationSteps);
  const currentStepIndex = useStore((s) => s.currentStepIndex);
  const selectedStepIndex = useStore((s) => s.selectedStepIndex);
  const automationStatus = useStore((s) => s.automationStatus);
  const isPlayingSpotify = useStore((s) => s.isPlaying);
  const reorderAutomationSteps = useStore((s) => s.reorderAutomationSteps);
  const removeAutomationStep = useStore((s) => s.removeAutomationStep);
  const clearAutomationSteps = useStore((s) => s.clearAutomationSteps);
  const setSelectedStepIndex = useStore((s) => s.setSelectedStepIndex);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const visibleStepIds = useMemo(() => {
    const seen = new Set<string>();
    return steps.filter((step) => {
      const isGrouped = step.type === 'track' && !!step.groupId;
      if (!isGrouped) return true;
      if (!seen.has(step.groupId!)) { seen.add(step.groupId!); return true; }
      return expandedGroups.has(step.groupId!);
    }).map((s) => s.id);
  }, [steps, expandedGroups]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = steps.findIndex((s) => s.id === active.id);
      const newIndex = steps.findIndex((s) => s.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderAutomationSteps(oldIndex, newIndex);
      }
    },
    [steps, reorderAutomationSteps],
  );

  const engine = AutomationEngine.getInstance();

  const handlePlay = () => engine.play();
  const handlePause = () => engine.pause();
  const handleStop = () => engine.stop();
  const handleContinue = () => engine.resume();

  const isPlaying = automationStatus === 'playing';
  const isPaused = automationStatus === 'paused';
  const isWaiting = automationStatus === 'waitingAtPause';
  const isStopped = automationStatus === 'stopped';

  const showPauseBtn = isPlaying || (isPaused && isPlayingSpotify);
  const showPlayBtn = isStopped || (isPaused && !isPlayingSpotify);

  return (
    <div className="flex flex-col h-full bg-bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
      <QueueHeader />

      {steps.length === 0 ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 flex items-center justify-center p-6 overflow-y-auto">
            <EmptyState />
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 px-6 py-3 border-b border-border shrink-0 bg-bg-surface">
            <div className="flex items-center gap-2 shrink-0">
              {showPlayBtn && (
                <Tooltip
                  content={isStopped ? t('automation.queue.start', { defaultValue: 'Start automation' }) : t('automation.queue.resume', { defaultValue: 'Resume automation' })}
                  placement="top"
                >
                  <button
                    type="button"
                    onClick={handlePlay}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-accent hover:bg-accent-hover text-bg-primary transition-colors shadow-sm hover:scale-105"
                    aria-label={isStopped ? t('automation.queue.start', { defaultValue: 'Start automation' }) : t('automation.queue.resume', { defaultValue: 'Resume automation' })}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="6 3 20 12 6 21 6 3" />
                    </svg>
                  </button>
                </Tooltip>
              )}

              {showPauseBtn && (
                <Tooltip content={t('automation.queue.pause', { defaultValue: 'Pause automation' })} placement="top">
                  <button
                    type="button"
                    onClick={handlePause}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-bg-elevated hover:bg-border text-text-primary transition-colors"
                    aria-label={t('automation.queue.pause', { defaultValue: 'Pause automation' })}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  </button>
                </Tooltip>
              )}

              {!isStopped && (
                <Tooltip content={t('automation.queue.stopReset', { defaultValue: 'Stop automation and reset to the beginning' })} placement="top">
                  <button
                    type="button"
                    onClick={handleStop}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-bg-elevated hover:bg-border text-text-primary transition-colors"
                    aria-label={t('automation.queue.stop', { defaultValue: 'Stop' })}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                  </button>
                </Tooltip>
              )}
            </div>

            {isWaiting && (
              <button
                type="button"
                onClick={handleContinue}
                className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-bg-primary font-bold rounded-lg text-sm transition-colors animate-pulse shadow-sm"
              >
                ▶ {t('common.continue').toUpperCase()}
              </button>
            )}

            <button
              type="button"
              onClick={clearAutomationSteps}
              className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded-lg text-xs font-medium transition-colors"
              aria-label={t('automation.queue.clear', { defaultValue: 'Clear' })}
            >
              {t('automation.queue.clear', { defaultValue: 'Clear' })}
            </button>

            <StepCountdown steps={steps} />
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-4 min-h-0 bg-bg-surface">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={visibleStepIds} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-2">
                    {steps.map((step, i) => {
                      const isGrouped = step.type === 'track' && !!step.groupId;
                      const isFirstInGroup = isGrouped && !steps.slice(0, i).some((s) => s.type === 'track' && s.groupId === step.groupId);
                      const isCollapsed = isGrouped && !expandedGroups.has(step.groupId!);

                      if (isGrouped && !isFirstInGroup && isCollapsed) return null;

                      const groupPlayingIndex = isFirstInGroup ? steps.findIndex((s, idx) => idx >= i && s.type === 'track' && s.groupId === step.groupId && idx === currentStepIndex) : -1;

                      return (
                        <React.Fragment key={step.id}>
                          {isFirstInGroup && (
                            <div
                              role="button"
                              tabIndex={0}
                              aria-expanded={!isCollapsed}
                              className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer select-none transition-colors ${groupPlayingIndex >= 0 ? 'bg-accent/10 border border-accent/30' : 'bg-bg-elevated/50 border border-border/50 hover:bg-bg-elevated'}`}
                              onClick={() => {
                                setExpandedGroups((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(step.groupId!)) next.delete(step.groupId!);
                                  else next.add(step.groupId!);
                                  return next;
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setExpandedGroups((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(step.groupId!)) next.delete(step.groupId!);
                                    else next.add(step.groupId!);
                                    return next;
                                  });
                                }
                              }}
                            >
                              <img src={step.groupArt || step.albumArt} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-text-primary truncate">{step.groupName || 'Playlist'}</div>
                                <div className="text-xs text-text-secondary">{step.groupTotal} tracks</div>
                              </div>
                              <span className="text-xs text-text-muted">{isCollapsed ? '▶' : '▼'}</span>
                            </div>
                          )}
                          {(!isGrouped || !isCollapsed) && (
                            <div className={isGrouped ? 'ml-4' : ''}>
                              <StepCard
                                step={step}
                                isPlaying={automationStatus === 'playing' && currentStepIndex === i}
                                isSelected={selectedStepIndex === i}
                                onSelect={() => setSelectedStepIndex(i)}
                                onDelete={() => removeAutomationStep(step.id)}
                                onPlayFromHere={() => {
                                  setSelectedStepIndex(i);
                                  void engine.playFromStep(i);
                                }}
                              />
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </>
      )}

      <SavePlaylistModal />
      <LoadPlaylistModal />
    </div>
  );
}
