import { useCallback, useState } from 'react';
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

const checkboxClassName = 'shrink-0 cursor-pointer rounded border-border w-3.5 h-3.5 accent-accent';

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function stepDurationMs(step: AutomationStep | undefined): number {
  if (!step || step.type === 'pause') return 0;
  return step.durationMs;
}

function QueueHeader() {
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
        <h2 className="text-base font-bold text-text-primary">Automation Queue</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLoadPlaylistModalOpen(true)}
            className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded-lg text-xs font-medium transition-colors"
          >
            Load set
          </button>
          <button
            type="button"
            onClick={() => setSavePlaylistModalOpen(true)}
            className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded-lg text-xs font-medium transition-colors"
          >
            Save set
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
                <span className="shrink-0">Dynamic breaks</span>
              </label>
              <button
                type="button"
                onClick={() => setShowConfig((v) => !v)}
                className="shrink-0 rounded px-2 py-1 text-text-muted hover:bg-bg-elevated hover:text-text-primary"
              >
                {showConfig ? 'Hide' : 'Configure'}
              </button>
            </div>
            <p className="text-text-muted pl-[calc(0.875rem+0.5rem)] leading-snug">
              Every {breakRule.everySongs} songs, <span className="lowercase">play</span> {breakRule.itemsPerBreak} clips,{' '}
              <span className="lowercase">avoid</span> repeating last {breakRule.avoidRecent}
            </p>
          </div>
          {showConfig && (
            <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
              <span className="text-text-muted">Every</span>
              <input type="number" min={1} value={breakRule.everySongs} onChange={(e) => updateBreakRule(breakRule.id, { everySongs: Math.max(1, Number(e.target.value) || 1) })} className="w-14 bg-bg-elevated border border-border rounded px-2 py-1 text-text-primary" />
              <span className="text-text-muted">
                songs, <span className="lowercase">play</span>
              </span>
              <input type="number" min={1} value={breakRule.itemsPerBreak} onChange={(e) => updateBreakRule(breakRule.id, { itemsPerBreak: Math.max(1, Number(e.target.value) || 1) })} className="w-14 bg-bg-elevated border border-border rounded px-2 py-1 text-text-primary" />
              <span className="text-text-muted">
                clips, <span className="lowercase">avoid</span> repeating last
              </span>
              <input type="number" min={0} value={breakRule.avoidRecent} onChange={(e) => updateBreakRule(breakRule.id, { avoidRecent: Math.max(0, Number(e.target.value) || 0) })} className="w-14 bg-bg-elevated border border-border rounded px-2 py-1 text-text-primary" />
              <button
                type="button"
                onClick={() => hasJingles && setShowJinglePool((v) => !v)}
                disabled={!hasJingles}
                className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Jingle pool ({selectedJingleIds.length})
              </button>
              <button
                type="button"
                onClick={() => hasAds && setShowAdPool((v) => !v)}
                disabled={!hasAds}
                className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Ad pool ({selectedAdIds.length})
              </button>
              {breakRule.enabled && selectedJingleIds.length + selectedAdIds.length === 0 && (
                <span className="text-amber-400">Pick at least one clip in the pools</span>
              )}
              {breakRule.enabled && !hasJingles && !hasAds && (
                <span className="text-text-muted">No clips in the library yet — add jingles or ads from Search, then Manage.</span>
              )}
            </div>
          )}
        </>
      )}
      {breakRule && showConfig && showJinglePool && hasJingles && (
        <div className="max-h-36 overflow-y-auto rounded border border-border p-2 grid grid-cols-2 gap-1 text-xs">
          {jingles.map((j) => {
            const checked = selectedJingleIds.includes(j.id);
            return (
              <label key={j.id} className="flex cursor-pointer select-none items-center gap-2 text-text-secondary">
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={checked}
                  onChange={(e) =>
                    updateBreakRule(breakRule.id, {
                      selectedJingleIds: e.target.checked
                        ? [...selectedJingleIds, j.id]
                        : selectedJingleIds.filter((id) => id !== j.id),
                    })
                  }
                />
                <span className="truncate">{j.name}</span>
              </label>
            );
          })}
        </div>
      )}
      {breakRule && showConfig && showAdPool && hasAds && (
        <div className="max-h-36 overflow-y-auto rounded border border-border p-2 grid grid-cols-2 gap-1 text-xs">
          {ads.map((a) => {
            const checked = selectedAdIds.includes(a.id);
            return (
              <label key={a.id} className="flex cursor-pointer select-none items-center gap-2 text-text-secondary">
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={checked}
                  onChange={(e) =>
                    updateBreakRule(breakRule.id, {
                      selectedAdIds: e.target.checked
                        ? [...selectedAdIds, a.id]
                        : selectedAdIds.filter((id) => id !== a.id),
                    })
                  }
                />
                <span className="truncate">{a.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AutomationQueueWidget() {
  const steps = useStore((s) => s.automationSteps);
  const currentStepIndex = useStore((s) => s.currentStepIndex);
  const selectedStepIndex = useStore((s) => s.selectedStepIndex);
  const automationStatus = useStore((s) => s.automationStatus);
  const isPlayingSpotify = useStore((s) => s.isPlaying);
  const stepTimeRemaining = useStore((s) => s.stepTimeRemaining);
  const reorderAutomationSteps = useStore((s) => s.reorderAutomationSteps);
  const removeAutomationStep = useStore((s) => s.removeAutomationStep);
  const setSelectedStepIndex = useStore((s) => s.setSelectedStepIndex);

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

  const currentStep = steps[currentStepIndex];
  const stepDur = stepDurationMs(currentStep);
  const withinStepFrac =
    (isPlaying || isPaused) && stepDur > 0
      ? Math.max(0, Math.min(1, (stepDur - stepTimeRemaining) / stepDur))
      : 0;
  const progressPct =
    steps.length > 0 ? ((currentStepIndex + withinStepFrac) / steps.length) * 100 : 0;

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
                  content={isStopped ? 'Start automation' : 'Resume automation'}
                  placement="top"
                >
                  <button
                    type="button"
                    onClick={handlePlay}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-accent hover:bg-accent-hover text-bg-primary transition-colors shadow-sm hover:scale-105"
                    aria-label={isStopped ? 'Start automation' : 'Resume automation'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="6 3 20 12 6 21 6 3" />
                    </svg>
                  </button>
                </Tooltip>
              )}

              {showPauseBtn && (
                <Tooltip content="Pause automation" placement="top">
                  <button
                    type="button"
                    onClick={handlePause}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-bg-elevated hover:bg-border text-text-primary transition-colors"
                    aria-label="Pause automation"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  </button>
                </Tooltip>
              )}

              {!isStopped && (
                <Tooltip content="Stop automation and reset to the beginning" placement="top">
                  <button
                    type="button"
                    onClick={handleStop}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-bg-elevated hover:bg-border text-text-primary transition-colors"
                    aria-label="Stop"
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
                ▶ CONTINUE
              </button>
            )}

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
                  -{formatTime(stepTimeRemaining)}
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-4 min-h-0 bg-bg-surface">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-2">
                    {steps.map((step, i) => (
                      <StepCard
                        key={step.id}
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
                    ))}
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
