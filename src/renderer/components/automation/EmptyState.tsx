import { useStore } from '@/store';
import Tooltip from '@/components/Tooltip';

export default function EmptyState() {
  const setSpotifySearchOpen = useStore((s) => s.setSpotifySearchOpen);
  const setJinglePickerOpen = useStore((s) => s.setJinglePickerOpen);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="bg-bg-surface border border-border rounded-lg p-8 flex flex-col items-center gap-4 max-w-md text-center">
        {/* Radio tower SVG */}
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" className="text-accent">
          <path d="M32 56V24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M32 24l-12 32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M32 24l12 32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M24 44h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="32" cy="20" r="4" stroke="currentColor" strokeWidth="2" />
          <path d="M22 14a14 14 0 0 1 20 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6" />
          <path d="M18 10a20 20 0 0 1 28 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.3" />
        </svg>

        <h1 className="text-2xl font-bold text-text-primary">Your automation playlist is empty.</h1>
        <p className="text-text-secondary text-sm">
          Add Spotify tracks and jingles to build your broadcast.
        </p>

        <div className="flex gap-3 mt-2">
          <button
            onClick={() => setSpotifySearchOpen(true)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-bg-primary font-medium rounded transition-colors text-sm"
          >
            Add a Track
          </button>
          <Tooltip content="Pick a jingle from your library to add to the playlist" placement="bottom">
            <button
              onClick={() => setJinglePickerOpen(true)}
              className="px-4 py-2 bg-bg-elevated hover:bg-border text-text-primary font-medium rounded transition-colors text-sm"
            >
              Add a Jingle
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
