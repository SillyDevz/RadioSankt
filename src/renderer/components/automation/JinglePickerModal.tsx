import { useEffect } from 'react';
import { useStore } from '@/store';

export default function JinglePickerModal() {
  const open = useStore((s) => s.jinglePickerOpen);
  const setOpen = useStore((s) => s.setJinglePickerOpen);
  const jingles = useStore((s) => s.jingles);
  const setJingles = useStore((s) => s.setJingles);
  const addAutomationStep = useStore((s) => s.addAutomationStep);
  const addToast = useStore((s) => s.addToast);

  useEffect(() => {
    if (open) {
      window.electronAPI.getJingles().then(setJingles);
    }
  }, [open, setJingles]);

  if (!open) return null;

  const handlePick = (jingle: JingleRecord) => {
    addAutomationStep({
      id: crypto.randomUUID(),
      type: 'jingle',
      jingleId: jingle.id,
      name: jingle.name,
      filePath: jingle.filePath,
      durationMs: jingle.durationMs,
      transitionIn: 'immediate',
      transitionOut: 'immediate',
      overlapMs: 0,
      duckMusic: false,
      duckLevel: 0.2,
    });
    addToast(`Added jingle "${jingle.name}"`, 'success');
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md bg-bg-surface border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Pick a Jingle</h2>
          <button onClick={() => setOpen(false)} className="text-text-muted hover:text-text-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {jingles.length === 0 && (
            <div className="py-8 text-center text-text-muted text-sm">
              No jingles yet. Add some in the Jingles page first.
            </div>
          )}

          {jingles.map((jingle) => (
            <button
              key={jingle.id}
              onClick={() => handlePick(jingle)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-bg-elevated transition-colors text-left"
            >
              <span className="text-base">🎙</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate">{jingle.name}</div>
              </div>
              <span className="text-xs text-text-muted tabular-nums">
                {Math.floor(jingle.durationMs / 60000)}:{String(Math.floor((jingle.durationMs % 60000) / 1000)).padStart(2, '0')}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
