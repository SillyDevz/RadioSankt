import type { CSSProperties } from 'react';

/**
 * macOS + frameless-style title bar: reserves space under traffic lights and
 * exposes a horizontal drag region (hiddenInset draws controls in this band).
 */
export default function MacTitleBarInset() {
  return (
    <header
      className="shrink-0 h-9 w-full bg-bg-primary border-b border-border flex items-stretch z-10"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      aria-hidden
    />
  );
}
