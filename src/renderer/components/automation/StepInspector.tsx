import { useStore } from '@/store';
import type { AutomationStep, TransitionIn, TransitionOut } from '@/store';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function StepInspector() {
  const steps = useStore((s) => s.automationSteps);
  const selectedStepIndex = useStore((s) => s.selectedStepIndex);
  const updateAutomationStep = useStore((s) => s.updateAutomationStep);

  if (selectedStepIndex === null || !steps[selectedStepIndex]) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-text-muted text-sm">Select a step to edit its settings</p>
      </div>
    );
  }

  const step = steps[selectedStepIndex];

  const update = (updates: Partial<AutomationStep>) => {
    updateAutomationStep(step.id, updates);
  };

  return (
    <div className="bg-bg-surface border border-border rounded-lg p-4 h-full overflow-y-auto">
      <h2 className="text-sm font-semibold text-text-primary mb-4">Step Settings</h2>

      {/* Step info */}
      <div className="mb-4 pb-4 border-b border-border">
        <div className="text-xs text-text-muted mb-1">
          {step.type === 'track'
            ? 'Spotify Track'
            : step.type === 'playlist'
              ? 'Spotify Playlist'
              : step.type === 'jingle'
                ? 'Jingle'
                : 'Pause Point'}
        </div>
        <div className="text-sm text-text-primary font-medium truncate">
          {step.type === 'pause' ? step.label || 'Pause Point' : step.name}
        </div>
        {step.type === 'track' && (
          <div className="text-xs text-text-secondary truncate mt-0.5">{step.artist}</div>
        )}
        {step.type === 'playlist' && (
          <div className="text-xs text-text-secondary mt-0.5">
            {step.trackCount} tracks · {formatDuration(step.durationMs)} total (snapshot when added)
          </div>
        )}
      </div>

      {/* Pause label */}
      {step.type === 'pause' && (
        <div className="mb-4">
          <label className="block text-xs text-text-secondary mb-1.5">Pause Label</label>
          <input
            type="text"
            value={step.label}
            onChange={(e) => update({ label: e.target.value } as Partial<AutomationStep>)}
            placeholder="e.g. Live news break"
            className="w-full bg-bg-elevated border border-border rounded px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
          />
        </div>
      )}

      {/* Transition In */}
      {step.type !== 'pause' && (
        <>
          <div className="mb-4">
            <label className="block text-xs text-text-secondary mb-1.5">
              Transition In
              <span className="ml-1 text-text-muted" title="How this step starts playing. Crossfade overlaps with the previous step.">?</span>
            </label>
            <div className="flex gap-2">
              {(['immediate', 'fadeIn', 'crossfade'] as TransitionIn[]).map((t) => (
                <button
                  key={t}
                  onClick={() => update({ transitionIn: t })}
                  className={`flex-1 px-2 py-1.5 rounded text-xs transition-colors ${
                    step.transitionIn === t
                      ? 'bg-accent text-bg-primary font-medium'
                      : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {t === 'fadeIn' ? 'Fade In' : t === 'crossfade' ? 'Crossfade' : 'Immediate'}
                </button>
              ))}
            </div>
          </div>

          {/* Overlap (only for crossfade) */}
          {step.transitionIn === 'crossfade' && (
            <div className="mb-4">
              <label className="block text-xs text-text-secondary mb-1.5">
                Overlap (ms)
                <span className="ml-1 text-text-muted" title="How many milliseconds before the current step ends to start this one">?</span>
              </label>
              <input
                type="number"
                value={step.overlapMs}
                onChange={(e) => update({ overlapMs: Math.max(0, parseInt(e.target.value) || 0) })}
                min={0}
                max={10000}
                step={100}
                className="w-full bg-bg-elevated border border-border rounded px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent tabular-nums"
              />
            </div>
          )}

          {/* Transition Out */}
          <div className="mb-4">
            <label className="block text-xs text-text-secondary mb-1.5">Transition Out</label>
            <div className="flex gap-2">
              {(['immediate', 'fadeOut'] as TransitionOut[]).map((t) => (
                <button
                  key={t}
                  onClick={() => update({ transitionOut: t })}
                  className={`flex-1 px-2 py-1.5 rounded text-xs transition-colors ${
                    step.transitionOut === t
                      ? 'bg-accent text-bg-primary font-medium'
                      : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {t === 'fadeOut' ? 'Fade Out' : 'Immediate'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Duck music (jingle only) */}
      {step.type === 'jingle' && (
        <>
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={step.duckMusic}
                onChange={(e) => update({ duckMusic: e.target.checked })}
                className="accent-accent"
              />
              <span className="text-xs text-text-secondary">
                Duck music
                <span className="ml-1 text-text-muted" title="Automatically lower the music volume while this jingle plays">?</span>
              </span>
            </label>
          </div>

          {step.duckMusic && (
            <div className="mb-4">
              <label className="block text-xs text-text-secondary mb-1.5">
                Duck Level: {Math.round(step.duckLevel * 100)}%
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(step.duckLevel * 100)}
                onChange={(e) => update({ duckLevel: parseInt(e.target.value) / 100 })}
                className="w-full accent-accent"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
