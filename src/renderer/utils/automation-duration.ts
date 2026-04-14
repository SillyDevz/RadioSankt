import type { AutomationStep } from '@/store';

export function stepDurationMs(step: AutomationStep): number {
  if (step.type === 'pause') return 0;
  return Math.max(0, step.durationMs);
}

export function sumAutomationStepsDurationMs(steps: AutomationStep[]): number {
  return steps.reduce((a, s) => a + stepDurationMs(s), 0);
}

/** Keep music steps until cumulative duration exceeds maxMs; pauses are skipped (trim is for airtime cap). */
export function trimStepsToMaxMs(steps: AutomationStep[], maxMs: number): AutomationStep[] {
  if (maxMs <= 0) return [];
  let total = 0;
  const out: AutomationStep[] = [];
  for (const s of steps) {
    if (s.type === 'pause') continue;
    const d = stepDurationMs(s);
    if (total + d > maxMs) break;
    out.push(s);
    total += d;
  }
  return out;
}
