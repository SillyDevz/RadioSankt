import { useStore } from '@/store';
import type { AutomationStep, TransitionIn, TransitionOut } from '@/store';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function StepInspectorWidget() {
  const steps = useStore((s) => s.automationSteps);
  const selectedStepIndex = useStore((s) => s.selectedStepIndex);
  const updateAutomationStep = useStore((s) => s.updateAutomationStep);

  if (selectedStepIndex === null || !steps[selectedStepIndex]) {
    return (
      <div className="flex flex-col h-full bg-bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-bg-elevated/20 shrink-0">
          <h2 className="text-base font-bold text-text-primary">Step Inspector</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted/30 mb-4">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
          <p className="text-text-secondary text-sm">Select a step in the queue<br/>to edit its settings</p>
        </div>
      </div>
    );
  }

  const step = steps[selectedStepIndex];

  const update = (updates: Partial<AutomationStep>) => {
    updateAutomationStep(step.id, updates);
  };

  return (
    <div className="flex flex-col h-full bg-bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-bg-elevated/20 shrink-0">
        <h2 className="text-base font-bold text-text-primary">Step Inspector</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        {/* Step info */}
        <div className="mb-6 pb-6 border-b border-border">
          <div className="inline-flex items-center px-2 py-1 rounded bg-bg-elevated text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-3">
            {step.type === 'track'
              ? 'Spotify Track'
              : step.type === 'playlist'
                ? 'Spotify Playlist'
                : step.type === 'jingle'
                  ? 'Jingle'
                  : 'Pause Point'}
          </div>
          <div className="text-lg text-text-primary font-bold truncate leading-tight">
            {step.type === 'pause' ? step.label || 'Pause Point' : step.name}
          </div>
          {step.type === 'track' && (
            <div className="text-sm text-text-secondary truncate mt-1">{step.artist}</div>
          )}
          {step.type === 'playlist' && (
            <div className="text-sm text-text-secondary mt-1">
              {step.trackCount} tracks · {formatDuration(step.durationMs)} total
            </div>
          )}
        </div>

        {/* Pause label */}
        {step.type === 'pause' && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-text-primary mb-2">Pause Label</label>
            <input
              type="text"
              value={step.label}
              onChange={(e) => update({ label: e.target.value } as Partial<AutomationStep>)}
              placeholder="e.g. Live news break"
              className="w-full bg-bg-elevated border border-border rounded-lg px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent transition-colors"
            />
          </div>
        )}

        {/* Transition In */}
        {step.type !== 'pause' && (
          <>
            <div className="mb-6">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary mb-2">
                Transition In
                <span className="text-text-muted cursor-help" title="How this step starts playing. Crossfade overlaps with the previous step.">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
                </span>
              </label>
              <div className="flex gap-2 bg-bg-elevated p-1 rounded-lg">
                {(['immediate', 'fadeIn', 'crossfade'] as TransitionIn[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => update({ transitionIn: t })}
                    className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                      step.transitionIn === t
                        ? 'bg-bg-surface text-text-primary shadow-sm'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {t === 'fadeIn' ? 'Fade In' : t === 'crossfade' ? 'Crossfade' : 'Immediate'}
                  </button>
                ))}
              </div>
            </div>

            {/* Overlap (only for crossfade) */}
            {step.transitionIn === 'crossfade' && (
              <div className="mb-6 animate-fade-in">
                <label className="flex items-center gap-2 text-sm font-medium text-text-primary mb-2">
                  Overlap Duration (ms)
                  <span className="text-text-muted cursor-help" title="How many milliseconds before the current step ends to start this one">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
                  </span>
                </label>
                <input
                  type="number"
                  value={step.overlapMs}
                  onChange={(e) => update({ overlapMs: Math.max(0, parseInt(e.target.value) || 0) })}
                  min={0}
                  max={10000}
                  step={100}
                  className="w-full bg-bg-elevated border border-border rounded-lg px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent transition-colors tabular-nums"
                />
              </div>
            )}

            {/* Transition Out */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-text-primary mb-2">Transition Out</label>
              <div className="flex gap-2 bg-bg-elevated p-1 rounded-lg">
                {(['immediate', 'fadeOut'] as TransitionOut[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => update({ transitionOut: t })}
                    className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                      step.transitionOut === t
                        ? 'bg-bg-surface text-text-primary shadow-sm'
                        : 'text-text-secondary hover:text-text-primary'
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
          <div className="bg-bg-elevated/50 border border-border rounded-lg p-4">
            <div className="mb-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={step.duckMusic}
                    onChange={(e) => update({ duckMusic: e.target.checked })}
                    className="peer appearance-none w-5 h-5 border-2 border-border rounded bg-bg-surface checked:bg-accent checked:border-accent transition-colors cursor-pointer"
                  />
                  <svg className="absolute w-3 h-3 pointer-events-none hidden peer-checked:block text-white left-1 top-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-text-primary flex items-center gap-2">
                    Duck music
                    <span className="text-text-muted cursor-help" title="Automatically lower the music volume while this jingle plays">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
                    </span>
                  </span>
                </div>
              </label>
            </div>

            {step.duckMusic && (
              <div className="animate-slide-up pl-8">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text-secondary">Duck Level</label>
                  <span className="text-sm font-bold text-accent">{Math.round(step.duckLevel * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(step.duckLevel * 100)}
                  onChange={(e) => update({ duckLevel: parseInt(e.target.value) / 100 })}
                  className="w-full h-1.5 bg-border rounded-full appearance-none cursor-pointer accent-accent 
                    [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:appearance-none 
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-md"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
