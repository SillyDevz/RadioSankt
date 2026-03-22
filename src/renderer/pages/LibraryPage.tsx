export default function LibraryPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="bg-bg-surface border border-border rounded-lg p-8 flex flex-col items-center gap-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-accent"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <h1 className="text-2xl font-bold text-text-primary">Library</h1>
        <p className="text-text-secondary">Your music library — coming soon</p>
      </div>
    </div>
  );
}
