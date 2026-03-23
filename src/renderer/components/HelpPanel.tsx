import { useState } from 'react';
import { useStore } from '@/store';

export default function HelpPanel() {
  const open = useStore((s) => s.helpPanelOpen);
  const setOpen = useStore((s) => s.setHelpPanelOpen);

  return (
    <>
      {/* Floating ? button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-24 right-4 z-40 w-10 h-10 rounded-full bg-bg-elevated border border-border text-text-secondary hover:text-text-primary hover:border-text-muted shadow-lg transition-all flex items-center justify-center text-sm font-medium"
        aria-label="Help"
      >
        ?
      </button>

      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[380px] bg-bg-surface border-l border-border shadow-2xl transition-transform duration-300 ease-out flex flex-col ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-text-primary">Help</h2>
          <button
            onClick={() => setOpen(false)}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
            aria-label="Close help"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Accordion sections */}
        <div className="flex-1 overflow-y-auto">
          <AccordionSection title="How to connect Spotify">
            <ol className="flex flex-col gap-2 text-xs text-text-secondary leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="text-text-muted shrink-0">1.</span>
                <span>
                  Go to{' '}
                  <button
                    onClick={() => window.electronAPI?.openExternal('https://developer.spotify.com/dashboard')}
                    className="text-accent hover:underline"
                  >
                    developer.spotify.com/dashboard
                  </button>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-text-muted shrink-0">2.</span>
                <span>Sign in and click "Create App"</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-text-muted shrink-0">3.</span>
                <span>Fill in any name and description</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-text-muted shrink-0">4.</span>
                <span>
                  Set Redirect URI to{' '}
                  <code className="bg-bg-primary px-1 py-0.5 rounded text-text-muted font-mono">
                    http://127.0.0.1:8888/callback
                  </code>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-text-muted shrink-0">5.</span>
                <span>Copy the Client ID and paste it in Settings</span>
              </li>
            </ol>
          </AccordionSection>

          <AccordionSection title="What are jingles?">
            <div className="text-xs text-text-secondary leading-relaxed flex flex-col gap-2">
              <p>
                Jingles are short audio clips that play between songs in your automation playlist.
                They can be station IDs, sound effects, news tones, ads, or anything else.
              </p>
              <p className="text-text-muted">
                Supported formats: MP3, WAV, OGG, FLAC
              </p>
            </div>
          </AccordionSection>

          <AccordionSection title="How does automation work?">
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text-secondary leading-relaxed">
                Build a playlist of tracks, jingles, and pause points. The automation engine plays
                them in sequence with crossfades and transitions.
              </p>
              {/* Flowchart SVG */}
              <svg viewBox="0 0 340 48" className="w-full" fill="none">
                {/* Track */}
                <rect x="0" y="12" width="52" height="24" rx="4" fill="#1DB954" fillOpacity="0.15" stroke="#1DB954" strokeOpacity="0.3" />
                <text x="26" y="28" textAnchor="middle" fill="#a3a3a3" fontSize="9" fontFamily="Inter, sans-serif">Track</text>
                {/* Arrow */}
                <path d="M56 24h12" stroke="#525252" strokeWidth="1" />
                <text x="62" y="10" textAnchor="middle" fill="#525252" fontSize="7" fontFamily="Inter, sans-serif">fade</text>
                {/* Jingle */}
                <rect x="72" y="12" width="52" height="24" rx="4" fill="#f59e0b" fillOpacity="0.15" stroke="#f59e0b" strokeOpacity="0.3" />
                <text x="98" y="28" textAnchor="middle" fill="#a3a3a3" fontSize="9" fontFamily="Inter, sans-serif">Jingle</text>
                {/* Arrow */}
                <path d="M128 24h12" stroke="#525252" strokeWidth="1" />
                {/* Track */}
                <rect x="144" y="12" width="52" height="24" rx="4" fill="#1DB954" fillOpacity="0.15" stroke="#1DB954" strokeOpacity="0.3" />
                <text x="170" y="28" textAnchor="middle" fill="#a3a3a3" fontSize="9" fontFamily="Inter, sans-serif">Track</text>
                {/* Arrow */}
                <path d="M200 24h12" stroke="#525252" strokeWidth="1" />
                {/* Pause */}
                <rect x="216" y="12" width="52" height="24" rx="4" fill="#ef4444" fillOpacity="0.15" stroke="#ef4444" strokeOpacity="0.3" />
                <text x="242" y="28" textAnchor="middle" fill="#a3a3a3" fontSize="8" fontFamily="Inter, sans-serif">Pause</text>
                {/* Arrow */}
                <path d="M272 24h12" stroke="#525252" strokeWidth="1" />
                {/* Live */}
                <rect x="288" y="12" width="52" height="24" rx="4" fill="#ef4444" fillOpacity="0.15" stroke="#ef4444" strokeOpacity="0.3" />
                <text x="314" y="28" textAnchor="middle" fill="#a3a3a3" fontSize="9" fontFamily="Inter, sans-serif">Live</text>
              </svg>
            </div>
          </AccordionSection>

          <AccordionSection title="Keyboard shortcuts">
            <div className="flex flex-col gap-2">
              {[
                ['Space', 'Play / Pause'],
                ['S', 'Stop'],
                ['C', 'Continue (at pause point)'],
                ['⌘K', 'Search Spotify'],
                ['L', 'Toggle Live mode'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">{desc}</span>
                  <kbd className="px-2 py-0.5 bg-bg-primary border border-border rounded text-[10px] text-text-muted font-mono">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </AccordionSection>

          <AccordionSection title="Report a bug">
            <p className="text-xs text-text-secondary">
              Found an issue? Report it on{' '}
              <button
                onClick={() => window.electronAPI?.openExternal('https://github.com/anthropics/claude-code/issues')}
                className="text-accent hover:underline"
              >
                GitHub Issues
              </button>
              .
            </p>
          </AccordionSection>
        </div>
      </div>
    </>
  );
}

// ── Accordion ───────────────────────────────────────────────────────────

function AccordionSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-sm text-text-primary hover:bg-bg-elevated/50 transition-colors"
      >
        {title}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}
