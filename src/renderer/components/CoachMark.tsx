import { useEffect, useRef, useState } from 'react';
import { useStore, type CoachMarkId } from '@/store';

interface CoachMarkProps {
  id: CoachMarkId;
  targetSelector: string;
  text: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  showAfter?: CoachMarkId;
}

export default function CoachMark({ id, targetSelector, text, placement = 'bottom', showAfter }: CoachMarkProps) {
  const seen = useStore((s) => s.seenCoachMarks[id]);
  const prerequisiteSeen = useStore((s) => showAfter ? s.seenCoachMarks[showAfter] : true);
  const markSeen = useStore((s) => s.markCoachMarkSeen);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef(0);

  const shouldShow = !seen && prerequisiteSeen;

  useEffect(() => {
    if (!shouldShow) return;

    // Wait a tick for the target to render
    const timeout = setTimeout(() => {
      const el = document.querySelector(targetSelector);
      if (el) {
        setRect(el.getBoundingClientRect());
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [shouldShow, targetSelector]);

  // Update position on resize
  useEffect(() => {
    if (!shouldShow) return;

    const handleResize = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const el = document.querySelector(targetSelector);
        if (el) setRect(el.getBoundingClientRect());
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [shouldShow, targetSelector]);

  if (!shouldShow || !rect) return null;

  const pad = 8;
  const cutout = {
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.width + pad * 2,
    h: rect.height + pad * 2,
    rx: 8,
  };

  // Tooltip position
  let tooltipStyle: React.CSSProperties = {};
  const gap = 12;
  switch (placement) {
    case 'bottom':
      tooltipStyle = { top: cutout.y + cutout.h + gap, left: cutout.x + cutout.w / 2, transform: 'translateX(-50%)' };
      break;
    case 'top':
      tooltipStyle = { bottom: window.innerHeight - cutout.y + gap, left: cutout.x + cutout.w / 2, transform: 'translateX(-50%)' };
      break;
    case 'right':
      tooltipStyle = { top: cutout.y + cutout.h / 2, left: cutout.x + cutout.w + gap, transform: 'translateY(-50%)' };
      break;
    case 'left':
      tooltipStyle = { top: cutout.y + cutout.h / 2, right: window.innerWidth - cutout.x + gap, transform: 'translateY(-50%)' };
      break;
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* Dark backdrop with cutout */}
      <svg className="absolute inset-0 w-full h-full">
        <defs>
          <mask id={`coach-mask-${id}`}>
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={cutout.x}
              y={cutout.y}
              width={cutout.w}
              height={cutout.h}
              rx={cutout.rx}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.7)"
          mask={`url(#coach-mask-${id})`}
        />
        {/* Highlight ring */}
        <rect
          x={cutout.x}
          y={cutout.y}
          width={cutout.w}
          height={cutout.h}
          rx={cutout.rx}
          fill="none"
          stroke="#1DB954"
          strokeWidth="2"
          strokeOpacity="0.5"
        />
      </svg>

      {/* Tooltip */}
      <div
        className="absolute bg-bg-elevated border border-accent/30 rounded-lg px-4 py-3 shadow-xl max-w-[260px] z-10"
        style={tooltipStyle}
      >
        <p className="text-sm text-text-primary leading-relaxed">{text}</p>
        <button
          onClick={() => markSeen(id)}
          className="mt-2.5 px-3 py-1 bg-accent hover:bg-accent-hover text-bg-primary text-xs font-medium rounded transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
