import { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { openExternal } from '@/utils/openExternal';

const STEPS = ['Welcome', 'Spotify', 'Jingles', 'Ready'];

export default function OnboardingWizard() {
  const step = useStore((s) => s.onboardingStep);
  const setStep = useStore((s) => s.setOnboardingStep);
  const setHasCompletedOnboarding = useStore((s) => s.setHasCompletedOnboarding);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[600px] max-h-[90vh] bg-bg-surface border border-border rounded-xl overflow-hidden flex flex-col shadow-2xl">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 pt-6 pb-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  i === step ? 'bg-accent scale-110' : i < step ? 'bg-accent/50' : 'bg-border'
                }`}
              />
              {i < STEPS.length - 1 && (
                <div className={`w-8 h-px ${i < step ? 'bg-accent/50' : 'bg-border'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-10 py-6">
          {step === 0 && <StepWelcome onNext={() => setStep(1)} />}
          {step === 1 && <StepSpotify onNext={() => setStep(2)} onSkip={() => setStep(2)} />}
          {step === 2 && <StepJingles onNext={() => setStep(3)} />}
          {step === 3 && (
            <StepReady
              onFinish={() => {
                setHasCompletedOnboarding(true);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Welcome ─────────────────────────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-5">
      {/* App icon */}
      <div className="w-20 h-20 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-accent">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 15V9l8 3-8 3z" fill="currentColor" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-text-primary">Welcome to Radio Sankt</h1>
      <p className="text-text-secondary text-sm leading-relaxed max-w-md">
        Build and broadcast your own radio station using your Spotify library. Automate your
        playlist, add jingles, and go live — all from one place.
      </p>

      <button
        onClick={onNext}
        className="mt-4 px-6 py-2.5 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded-lg transition-colors text-sm"
      >
        Get Started →
      </button>
    </div>
  );
}

// ── Step 2: Connect Spotify ─────────────────────────────────────────────

function StepSpotify({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const setClientId = useStore((s) => s.setClientId);
  const connected = useStore((s) => s.connected);
  const user = useStore((s) => s.user);
  const inElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const [clientIdInput, setClientIdInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Track auth results for local UI state (store updates handled by Layout)
  useEffect(() => {
    const unsubComplete = window.electronAPI?.onSpotifyAuthComplete(() => {
      setConnecting(false);
      setError('');
    });

    const unsubError = window.electronAPI?.onSpotifyAuthError((authError) => {
      setConnecting(false);
      setError(
        authError
          ? `Connection failed: ${authError}`
          : 'Connection failed — double-check your Client ID and make sure the Redirect URI is set correctly.',
      );
    });

    return () => {
      unsubComplete?.();
      unsubError?.();
    };
  }, []);

  const handleConnect = async () => {
    const trimmed = clientIdInput.trim();
    if (!trimmed || !window.electronAPI) return;

    try {
      await window.electronAPI.saveSpotifyClientId(trimmed);
      setClientId(trimmed);
      setConnecting(true);
      setError('');
      await window.electronAPI.initiateSpotifyAuth();
    } catch (err) {
      setConnecting(false);
      setError(`Failed to start Spotify auth: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText('http://127.0.0.1:8888/callback');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold text-text-primary text-center">Connect your Spotify account</h1>

      {!inElectron && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-xs text-amber-200 leading-relaxed">
          This screen is open in a normal browser tab, so Spotify login cannot run here (there is no Electron bridge).
          Close this preview and start the desktop shell from the project folder:{' '}
          <code className="bg-bg-primary/80 px-1.5 py-0.5 rounded font-mono text-text-primary">npm run electron:dev</code>
        </div>
      )}

      {/* Illustration */}
      <div className="flex items-center justify-center gap-4 py-3">
        <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-accent">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 15V9l8 3-8 3z" fill="currentColor" />
          </svg>
        </div>
        <div className="flex items-center gap-1 text-text-muted">
          <span className="text-xs">♪</span>
          <svg width="32" height="8" viewBox="0 0 32 8" className="text-accent/40">
            <path d="M0 4h28l-4-3M28 4l-4 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs">♪</span>
        </div>
        <div className="w-12 h-12 rounded-xl bg-[#1DB954]/10 border border-[#1DB954]/20 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" className="text-accent">
            <path
              fill="currentColor"
              d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"
            />
          </svg>
        </div>
      </div>

      {/* Explanation */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3 text-xs text-blue-300 leading-relaxed">
        This app uses the Spotify API to search and play music. You'll need a free Spotify Developer
        account to get a Client ID — it takes about 2 minutes.
      </div>

      {/* Numbered steps */}
      <ol className="flex flex-col gap-2.5 text-sm text-text-secondary">
        <li className="flex items-start gap-3">
          <span className="w-5 h-5 rounded-full bg-bg-elevated text-text-muted text-xs flex items-center justify-center shrink-0 mt-0.5">1</span>
          <span>
            Go to{' '}
            <button
              onClick={() => openExternal('https://developer.spotify.com/dashboard')}
              className="text-accent hover:underline"
            >
              developer.spotify.com/dashboard
            </button>
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="w-5 h-5 rounded-full bg-bg-elevated text-text-muted text-xs flex items-center justify-center shrink-0 mt-0.5">2</span>
          <span>Sign in and click "Create App"</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="w-5 h-5 rounded-full bg-bg-elevated text-text-muted text-xs flex items-center justify-center shrink-0 mt-0.5">3</span>
          <span>Fill in any name/description</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="w-5 h-5 rounded-full bg-bg-elevated text-text-muted text-xs flex items-center justify-center shrink-0 mt-0.5">4</span>
          <div className="flex flex-col gap-1.5">
            <span>In Redirect URIs, add:</span>
            <div className="flex items-center gap-2">
              <code className="bg-bg-primary border border-border px-3 py-1.5 rounded text-xs text-text-muted font-mono">
                http://127.0.0.1:8888/callback
              </code>
              <button
                onClick={handleCopy}
                className="px-2 py-1.5 bg-bg-elevated border border-border rounded text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <span className="w-5 h-5 rounded-full bg-bg-elevated text-text-muted text-xs flex items-center justify-center shrink-0 mt-0.5">5</span>
          <span>Save, then copy your Client ID from the app dashboard</span>
        </li>
      </ol>

      {/* Client ID input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={clientIdInput}
          onChange={(e) => setClientIdInput(e.target.value)}
          placeholder="Paste your Client ID here"
          className="flex-1 bg-bg-elevated border border-border rounded px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
          disabled={connected}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-danger/10 border border-danger/20 rounded-lg px-4 py-3 text-xs text-danger">
          {error}
        </div>
      )}

      {/* Connected state */}
      {connected && (
        <div className="flex items-center gap-2 text-sm text-accent">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          Connected as {user || '...'}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onSkip}
          className="text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          I'll do this later
        </button>

        {connected ? (
          <button
            onClick={onNext}
            className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded-lg transition-colors text-sm"
          >
            Continue →
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={!clientIdInput.trim() || connecting || !inElectron}
            className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded-lg transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {connecting ? 'Connecting...' : 'Connect Spotify'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step 3: Add Jingle ──────────────────────────────────────────────────

function StepJingles({ onNext }: { onNext: () => void }) {
  const addJingle = useStore((s) => s.addJingle);
  const [pickedFile, setPickedFile] = useState<{ name: string; durationMs: number } | null>(null);

  const handlePick = async () => {
    const result = await window.electronAPI.openFileDialog({
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac'] }],
    });

    if (result.canceled || !result.filePaths.length) return;

    const filePath = result.filePaths[0];
    try {
      const buffer = await window.electronAPI.readFileBuffer(filePath);
      const ctx = new AudioContext();
      const audioBuffer = await ctx.decodeAudioData(buffer);
      const durationMs = Math.round(audioBuffer.duration * 1000);
      await ctx.close();

      const name = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
      const jingle = await window.electronAPI.saveJingle(name, filePath, durationMs);
      addJingle(jingle);
      setPickedFile({ name, durationMs });
    } catch {
      // Failed to add
    }
  };

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center text-center gap-5">
      <h1 className="text-xl font-bold text-text-primary">Add a jingle or vinheta</h1>
      <p className="text-text-secondary text-sm leading-relaxed max-w-md">
        Jingles are short audio clips that play between songs — station IDs, sound effects, news
        tones, or ads. They're what makes it feel like a real radio station.
      </p>

      {pickedFile ? (
        <div className="w-full max-w-sm bg-bg-elevated border border-border rounded-lg p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm text-text-primary truncate">{pickedFile.name}</p>
            <p className="text-xs text-text-muted">{formatDuration(pickedFile.durationMs)}</p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
      ) : (
        <button
          onClick={handlePick}
          className="px-5 py-2.5 bg-bg-elevated border border-border rounded-lg text-sm text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors flex items-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add a jingle file
        </button>
      )}

      <div className="flex items-center gap-4 pt-4">
        <button
          onClick={onNext}
          className="text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          Skip for now →
        </button>
        {pickedFile && (
          <button
            onClick={onNext}
            className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded-lg transition-colors text-sm"
          >
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step 4: You're Ready ────────────────────────────────────────────────

const APP_SECTIONS = [
  {
    icon: '🎵',
    title: 'Library',
    desc: 'Browse and search your Spotify tracks',
    color: 'bg-purple-500/10 border-purple-500/20',
  },
  {
    icon: '⚙️',
    title: 'Automation',
    desc: 'Build your radio playlist with tracks and jingles',
    color: 'bg-blue-500/10 border-blue-500/20',
  },
  {
    icon: '🔴',
    title: 'Live',
    desc: 'Go live between automated segments',
    color: 'bg-red-500/10 border-red-500/20',
  },
  {
    icon: '⚙️',
    title: 'Settings',
    desc: 'Configure Spotify and app preferences',
    color: 'bg-amber-500/10 border-amber-500/20',
  },
];

function StepReady({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-5">
      <h1 className="text-xl font-bold text-text-primary">You're all set! 🎙</h1>

      <div className="grid grid-cols-2 gap-3 w-full">
        {APP_SECTIONS.map((s) => (
          <div
            key={s.title}
            className={`border rounded-lg p-4 flex flex-col items-center gap-2 text-center ${s.color}`}
          >
            <span className="text-2xl">{s.icon}</span>
            <span className="text-sm font-medium text-text-primary">{s.title}</span>
            <span className="text-xs text-text-secondary">{s.desc}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onFinish}
        className="mt-2 px-6 py-2.5 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded-lg transition-colors text-sm"
      >
        Open the app →
      </button>
    </div>
  );
}
