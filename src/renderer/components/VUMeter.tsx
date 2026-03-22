import { useRef, useEffect, useState } from 'react';
import AudioEngine from '@/engine/AudioEngine';

interface VUMeterProps {
  channel: 'A' | 'B';
}

export default function VUMeter({ channel }: VUMeterProps) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      const engine = AudioEngine.get();
      if (engine) {
        // Scale RMS (typically 0-0.5) to 0-1 range for display
        const raw = engine.getLevel(channel);
        setLevel(Math.min(raw * 2, 1));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [channel]);

  const pct = Math.round(level * 100);
  const label = channel === 'A' ? 'MUSIC' : 'JINGLE';

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-3 h-16 bg-bg-elevated rounded-sm overflow-hidden">
        {/* Meter fill */}
        <div
          className="absolute bottom-0 left-0 right-0 transition-[height] duration-75"
          style={{
            height: `${pct}%`,
            background:
              pct > 90
                ? '#ef4444'
                : pct > 70
                  ? '#f59e0b'
                  : '#1DB954',
          }}
        />
        {/* Threshold markers */}
        <div className="absolute left-0 right-0 bottom-[70%] h-px bg-white/10" />
        <div className="absolute left-0 right-0 bottom-[90%] h-px bg-white/10" />
      </div>
      <span className="text-[9px] text-text-muted font-medium tracking-wider">
        {label}
      </span>
    </div>
  );
}
