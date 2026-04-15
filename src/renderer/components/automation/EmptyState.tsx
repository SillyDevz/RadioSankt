export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 w-full">
      <div className="bg-bg-elevated/30 border border-border/50 rounded-2xl p-8 flex flex-col items-center gap-4 w-full max-w-sm text-center">
        {/* Radio tower SVG */}
        <div className="w-16 h-16 rounded-full bg-bg-surface flex items-center justify-center text-accent shadow-sm mb-2">
          <svg width="32" height="32" viewBox="0 0 64 64" fill="none" className="text-accent">
            <path d="M32 56V24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path d="M32 24l-12 32" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path d="M32 24l12 32" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path d="M24 44h16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <circle cx="32" cy="20" r="5" stroke="currentColor" strokeWidth="3" />
            <path d="M22 14a14 14 0 0 1 20 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.6" />
            <path d="M18 10a20 20 0 0 1 28 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.3" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-text-primary">Your automation playlist is empty</h1>
        <p className="text-text-secondary text-sm">
          Use Search to add tracks, jingles, or ads, or Load set to open a saved automation. The queue is restored after restart.
        </p>
      </div>
    </div>
  );
}
