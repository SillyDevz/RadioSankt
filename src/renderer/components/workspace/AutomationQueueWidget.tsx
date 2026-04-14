import { useCallback } from 'react';
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
  const addAutomationStep = useStore((s) => s.addAutomationStep);
  const setSavePlaylistModalOpen = useStore((s) => s.setSavePlaylistModalOpen);
  const setLoadPlaylistModalOpen = useStore((s) => s.setLoadPlaylistModalOpen);

  const handleAddPause = () => {
    addAutomationStep({
      id: crypto.randomUUID(),
      type: 'pause',
      label: 'Pause Point',
      transitionIn: 'immediate',
      transitionOut: 'immediate',
      overlapMs: 0,
      duckMusic: false,
      duckLevel: 0.2,
    });
  };

  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-elevated/20 shrink-0">
      <h2 className="text-base font-bold text-text-primary">Automation Queue</h2>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleAddPause}
          className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded-lg text-xs font-medium transition-colors"
        >
          Add Pause
        </button>
        <div className="w-px h-4 bg-border mx-1" />
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
