import { useEffect, useCallback } from 'react';
import { useStore } from '@/store';
import AutomationEngine from '@/engine/AutomationEngine';
import PlaylistPanel from '@/components/automation/PlaylistPanel';
import StepInspector from '@/components/automation/StepInspector';
import EmptyState from '@/components/automation/EmptyState';
import JinglePickerModal from '@/components/automation/JinglePickerModal';
import SavePlaylistModal from '@/components/automation/SavePlaylistModal';
import LoadPlaylistModal from '@/components/automation/LoadPlaylistModal';
import CoachMark from '@/components/CoachMark';

export default function AutomationPage() {
  const steps = useStore((s) => s.automationSteps);
  const addToast = useStore((s) => s.addToast);
  const hasCompletedOnboarding = useStore((s) => s.hasCompletedOnboarding);

  useEffect(() => {
    const engine = AutomationEngine.getInstance();
    const unsub = engine.on((event) => {
      if (event.type === 'finished') {
        addToast('Automation playlist finished', 'info');
      } else if (event.type === 'error') {
        addToast(event.message, 'error');
      }
    });
    return unsub;
  }, [addToast]);

  if (steps.length === 0) {
    return (
      <>
        <EmptyState />
        <JinglePickerModal />
      </>
    );
  }

  return (
    <div className="flex gap-4 h-full">
      <div className="flex-[3] min-w-0 flex flex-col">
        <PlaylistPanel />
      </div>
      <div className="flex-[2] min-w-0">
        <StepInspector />
      </div>
      <JinglePickerModal />
      <SavePlaylistModal />
      <LoadPlaylistModal />
      {hasCompletedOnboarding && (
        <>
          <CoachMark
            id="automation-drag"
            targetSelector="[data-coachmark='drag-handle']"
            text="Drag steps to reorder your playlist"
            placement="right"
          />
          <CoachMark
            id="automation-pause"
            targetSelector="[data-coachmark='pause-step-btn']"
            text="Add a pause point to go live between songs"
            placement="bottom"
            showAfter="automation-drag"
          />
        </>
      )}
    </div>
  );
}
