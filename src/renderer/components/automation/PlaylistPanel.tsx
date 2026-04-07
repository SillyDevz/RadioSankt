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
import { useStore } from '@/store';
import AutomationEngine from '@/engine/AutomationEngine';
import StepCard from './StepCard';
import Tooltip from '@/components/Tooltip';

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PlaylistPanel() {
  const steps = useStore((s) => s.automationSteps);
  const currentStepIndex = useStore((s) => s.currentStepIndex);
  const selectedStepIndex = useStore((s) => s.selectedStepIndex);
  const automationStatus = useStore((s) => s.automationStatus);
  const stepTimeRemaining = useStore((s) => s.stepTimeRemaining);
  const reorderAutomationSteps = useStore((s) => s.reorderAutomationSteps);
  const removeAutomationStep = useStore((s) => s.removeAutomationStep);
  const setSelectedStepIndex = useStore((s) => s.setSelectedStepIndex);
  const addAutomationStep = useStore((s) => s.addAutomationStep);
  const setSpotifySearchOpen = useStore((s) => s.setSpotifySearchOpen);
  const setJinglePickerOpen = useStore((s) => s.setJinglePickerOpen);
  const setSavePlaylistModalOpen = useStore((s) => s.setSavePlaylistModalOpen);
  const setLoadPlaylistModalOpen = useStore((s) => s.setLoadPlaylistModalOpen);

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

  const engine = AutomationEngine.getInstance();

  const handlePlay = () => engine.play();
  const handlePause = () => engine.pause();
  const handleStop = () => engine.stop();
  const handleContinue = () => engine.resume();

  const isPlaying = automationStatus === 'playing';
  const isPaused = automationStatus === 'paused';
  const isWaiting = automationStatus === 'waitingAtPause';
  const isStopped = automationStatus === 'stopped';

  const progressPct = steps.length > 0 ? ((currentStepIndex + (isPlaying ? 0.5 : 0)) / steps.length) * 100 : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 pb-3 border-b border-border mb-3 flex-wrap">
        <button
          onClick={() => setSpotifySearchOpen(true)}
          className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded text-xs transition-colors"
        >
          Add Track
        </button>
        <Tooltip content="Pick a jingle from your library to add to the playlist" placement="bottom">
          <button
            onClick={() => setJinglePickerOpen(true)}
            className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded text-xs transition-colors"
          >
            Add Jingle
          </button>
        </Tooltip>
        <Tooltip content="Automation will stop here and wait for you to click Continue — perfect for live segments" placement="bottom">
          <button
            onClick={handleAddPause}
            data-coachmark="pause-step-btn"
            className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded text-xs transition-colors"
          >
            Add Pause Point
          </button>
        </Tooltip>

        <div className="w-px h-5 bg-border mx-1" />

        <button
          onClick={() => setSavePlaylistModalOpen(true)}
          className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded text-xs transition-colors"
        >
          Save Playlist
        </button>
        <button
          onClick={() => setLoadPlaylistModalOpen(true)}
          className="px-3 py-1.5 bg-bg-elevated hover:bg-border text-text-primary rounded text-xs transition-colors"
        >
          Load Playlist
        </button>
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-3 pb-3 mb-3 border-b border-border">
        <div className="flex items-center gap-1.5">
          {/* Play */}
          {(isStopped || isPaused) && (
            <Tooltip content="Start automation from the current position" placement="top">
              <button
                onClick={handlePlay}
                className="p-2 rounded-full bg-accent hover:bg-accent-hover text-bg-primary transition-colors"
                aria-label="Play"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 3 20 12 6 21 6 3" />
                </svg>
              </button>
            </Tooltip>
          )}

          {/* Pause */}
          {isPlaying && (
            <button
              onClick={handlePause}
              className="p-2 rounded-full bg-bg-elevated hover:bg-border text-text-primary transition-colors"
              aria-label="Pause"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            </button>
          )}

          {/* Stop */}
          {!isStopped && (
            <Tooltip content="Stop automation and reset to the beginning" placement="top">
              <button
                onClick={handleStop}
                className="p-2 rounded-full bg-bg-elevated hover:bg-border text-text-primary transition-colors"
                aria-label="Stop"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            </Tooltip>
          )}
        </div>

        {/* Continue button for pause steps */}
        {isWaiting && (
          <button
            onClick={handleContinue}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-bg-primary font-bold rounded text-sm transition-colors animate-pulse"
          >
            ▶ CONTINUE
          </button>
        )}

        {/* Progress info */}
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <span className="text-xs text-text-muted whitespace-nowrap">
            Step {currentStepIndex + 1} of {steps.length}
          </span>
          <div className="flex-1 h-1 bg-bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(progressPct, 100)}%` }}
            />
          </div>
          {isPlaying && (
            <span className="text-xs text-text-muted tabular-nums whitespace-nowrap">
              -{formatTime(stepTimeRemaining)}
            </span>
          )}
        </div>
      </div>

      {/* Step list */}
      <div className="flex-1 overflow-y-auto -mx-1 px-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-1">
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
  );
}
