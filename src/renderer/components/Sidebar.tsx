import { useState } from 'react';
import { useStore } from '@/store';
import type { Page } from '@/store';
import Tooltip from './Tooltip';

function LogoVinylIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.35" />
      <circle cx="10" cy="10" r="3.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}

const navItems: { page: Page; label: string; icon: JSX.Element }[] = [
  {
    page: 'library',
    label: 'Library',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    page: 'automation',
    label: 'Automation',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 6.5v7l5.5-3.5L8 6.5z" fill="currentColor" />
      </svg>
    ),
  },
  {
    page: 'live',
    label: 'Live',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="14" r="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 12V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 8a5.5 5.5 0 0 1 8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M3.5 5.5a9 9 0 0 1 13 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    page: 'jingles',
    label: 'Jingles',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M13 3v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M13 3l4-1v4l-4 1" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="10" cy="13" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 7h4M3 10h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    page: 'settings',
    label: 'Settings',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M16 4l-1.4 1.4M5.4 14.6L4 16M16 16l-1.4-1.4M5.4 5.4L4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  const currentPage = useStore((s) => s.currentPage);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const setSpotifySearchOpen = useStore((s) => s.setSpotifySearchOpen);

  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className="bg-bg-surface border-r border-border flex flex-col py-4 transition-all duration-300 ease-in-out overflow-hidden app-region-no-drag"
      style={{ width: expanded ? 220 : 64 }}
    >
      {/* Brand — vinyl mark + wordmark; inset matches search + nav */}
      <div className="px-2 mb-6 shrink-0 text-accent">
        {expanded ? (
          <div className="flex items-center h-8 px-3 min-w-0">
            <span className="shrink-0">
              <LogoVinylIcon />
            </span>
            <span className="text-base font-bold tracking-tight whitespace-nowrap truncate ml-3">
              Radio Sankt
            </span>
          </div>
        ) : (
          <Tooltip content="Radio Sankt" placement="right">
            <div className="flex items-center h-8 px-3 min-w-0">
              <span className="shrink-0">
                <LogoVinylIcon />
              </span>
            </div>
          </Tooltip>
        )}
      </div>

      {/* Search button */}
      <div className="px-2 mb-2">
        <Tooltip content="Search Spotify" shortcut="⌘K" placement="right">
          <button
            onClick={() => setSpotifySearchOpen(true)}
            className="flex items-center w-full rounded px-3 py-2.5 text-text-secondary hover:text-text-primary hover:bg-bg-elevated/50 transition-colors"
          >
            <span className="shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            {expanded && (
              <span className="text-sm font-medium ml-3 whitespace-nowrap">Search</span>
            )}
            {expanded && (
              <kbd className="ml-auto px-1.5 py-0.5 bg-bg-elevated rounded text-[10px] text-text-muted font-mono">
                ⌘K
              </kbd>
            )}
          </button>
        </Tooltip>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 px-2">
        {navItems.map(({ page, label, icon }) => {
          const isActive = currentPage === page;

          const button = (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              className={`flex items-center w-full rounded px-3 py-2.5 transition-colors relative ${
                isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated/50'
              }`}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent rounded-r" />
              )}
              <span className="shrink-0">{icon}</span>
              {expanded && (
                <span className="text-sm font-medium ml-3 whitespace-nowrap">
                  {label}
                </span>
              )}
            </button>
          );

          if (!expanded) {
            return (
              <Tooltip key={page} content={label} placement="right">
                {button}
              </Tooltip>
            );
          }

          return button;
        })}
      </nav>
    </aside>
  );
}

export default Sidebar;
