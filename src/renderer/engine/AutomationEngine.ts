import AudioEngine from './AudioEngine';
import { useStore } from '@/store';
import { playTrack } from '@/services/spotify-api';
import type { AutomationStep } from '@/store';

type AutomationEvent =
  | { type: 'stepChanged'; index: number }
  | { type: 'waitingAtPause'; step: AutomationStep }
  | { type: 'finished' }
  | { type: 'error'; message: string };

type Listener = (event: AutomationEvent) => void;

const FADE_DURATION = 800;

class AutomationEngine {
  private static instance: AutomationEngine | null = null;

  private listeners: Listener[] = [];
  private nextStepTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private currentStepStartTime = 0;

  static getInstance(): AutomationEngine {
    if (!AutomationEngine.instance) {
      AutomationEngine.instance = new AutomationEngine();
    }
    return AutomationEngine.instance;
  }

  on(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: AutomationEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  private getStore() {
    return useStore.getState();
  }

  private getSteps(): AutomationStep[] {
    return this.getStore().automationSteps;
  }

  async play(): Promise<void> {
    const store = this.getStore();
    const steps = this.getSteps();
    if (steps.length === 0) return;

    if (store.automationStatus === 'paused') {
      // Resume from paused position
      await this.executeStep(store.currentStepIndex);
      return;
    }

    // Start from current step index (or 0)
    store.setAutomationStatus('playing');
    await this.executeStep(store.currentStepIndex);
  }

  async executeStep(index: number): Promise<void> {
    const steps = this.getSteps();
    const store = this.getStore();

    if (index >= steps.length) {
      this.emit({ type: 'finished' });
      this.stopInternal(false);
      return;
    }

    const step = steps[index];
    store.setCurrentStepIndex(index);
    store.setAutomationStatus('playing');
    this.emit({ type: 'stepChanged', index });

    if (step.type === 'pause') {
      this.handlePauseStep(step);
      return;
    }

    try {
      if (step.type === 'track') {
        await this.playTrackStep(step);
      } else if (step.type === 'jingle') {
        await this.playJingleStep(step);
      }

      // Apply transition in
      const audio = AudioEngine.get();
      if (audio && step.transitionIn === 'fadeIn') {
        await audio.fadeIn(step.type === 'jingle' ? 'B' : 'A', FADE_DURATION);
      }

      this.currentStepStartTime = Date.now();
      this.startCountdown(step);
      this.scheduleNextStep(step, index);
    } catch (err) {
      const stepName = 'name' in step ? step.name : '';
      this.emit({ type: 'error', message: `Failed to play step: ${stepName}` });
      // Skip to next step on error
      this.scheduleNextStepImmediate(index);
    }
  }

  private async playTrackStep(step: AutomationStep & { type: 'track' }): Promise<void> {
    const store = this.getStore();
    const deviceId = store.deviceId;
    if (!deviceId) throw new Error('Spotify player not ready');

    const audio = AudioEngine.get();
    if (audio && step.transitionIn === 'fadeIn') {
      audio.setVolume('A', 0);
    }

    await playTrack(step.spotifyUri, deviceId);
  }

  private async playJingleStep(step: AutomationStep & { type: 'jingle' }): Promise<void> {
    const audio = AudioEngine.get();
    if (!audio) throw new Error('Audio engine not ready');

    if (step.duckMusic) {
      await audio.duck('A', step.duckLevel, 300);
    }

    if (step.transitionIn === 'fadeIn') {
      audio.setVolume('B', 0);
    }

    await audio.playJingle(step.filePath);

    // Set up unduck when jingle ends
    if (step.duckMusic) {
      audio.onJingleEnded(() => {
        audio.unduck('A', 300);
      });
    }
  }

  private handlePauseStep(step: AutomationStep): void {
    this.getStore().setAutomationStatus('waitingAtPause');
    this.emit({ type: 'waitingAtPause', step });
  }

  async resume(): Promise<void> {
    const store = this.getStore();
    if (store.automationStatus === 'waitingAtPause') {
      const nextIndex = store.currentStepIndex + 1;
      await this.executeStep(nextIndex);
    } else if (store.automationStatus === 'paused') {
      await this.executeStep(store.currentStepIndex);
    }
  }

  private scheduleNextStep(step: AutomationStep, currentIndex: number): void {
    this.clearNextStepTimer();

    const durationMs = step.type === 'pause' ? 0 : (step as { durationMs: number }).durationMs;
    if (!durationMs) return;

    const nextStep = this.getSteps()[currentIndex + 1];
    const overlapMs = nextStep?.transitionIn === 'crossfade' ? nextStep.overlapMs : 0;
    const delay = Math.max(durationMs - overlapMs, 500);

    this.nextStepTimer = setTimeout(async () => {
      try {
        const audio = AudioEngine.get();

        // Apply transition out on current step
        if (step.transitionOut === 'fadeOut' && audio) {
          const channel = step.type === 'jingle' ? 'B' : 'A';
          audio.fadeOut(channel, FADE_DURATION);
        }

        // If next step is crossfade, start it overlapping
        if (nextStep?.transitionIn === 'crossfade' && audio) {
          const fromChannel = step.type === 'jingle' ? 'B' : 'A';
          const toChannel = nextStep.type === 'jingle' ? 'B' : 'A';
          if (fromChannel !== toChannel) {
            audio.crossfade(fromChannel, toChannel, FADE_DURATION);
          }
        }

        await this.executeStep(currentIndex + 1);
      } catch (err) {
        this.emit({ type: 'error', message: `Step transition failed: ${err}` });
        this.scheduleNextStepImmediate(currentIndex);
      }
    }, delay);
  }

  private scheduleNextStepImmediate(currentIndex: number): void {
    this.clearNextStepTimer();
    this.nextStepTimer = setTimeout(() => {
      this.executeStep(currentIndex + 1).catch((err) => {
        this.emit({ type: 'error', message: `Failed to advance: ${err}` });
      });
    }, 200);
  }

  private startCountdown(step: AutomationStep): void {
    this.clearCountdown();
    if (step.type === 'pause') return;

    const durationMs = (step as { durationMs: number }).durationMs;
    const store = this.getStore();
    store.setStepTimeRemaining(durationMs);

    this.countdownTimer = setInterval(() => {
      const elapsed = Date.now() - this.currentStepStartTime;
      const remaining = Math.max(durationMs - elapsed, 0);
      useStore.getState().setStepTimeRemaining(remaining);

      if (remaining <= 0) {
        this.clearCountdown();
      }
    }, 250);
  }

  private clearCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private clearNextStepTimer(): void {
    if (this.nextStepTimer) {
      clearTimeout(this.nextStepTimer);
      this.nextStepTimer = null;
    }
  }

  async pause(): Promise<void> {
    const store = this.getStore();
    if (store.automationStatus !== 'playing') return;

    this.clearNextStepTimer();
    this.clearCountdown();

    const audio = AudioEngine.get();
    if (audio) {
      await audio.fadeOut('A', FADE_DURATION);
    }

    store.setAutomationStatus('paused');
  }

  async stop(): Promise<void> {
    await this.stopInternal(true);
  }

  private async stopInternal(resetPosition: boolean): Promise<void> {
    this.clearNextStepTimer();
    this.clearCountdown();

    const audio = AudioEngine.get();
    if (audio) {
      audio.stopJingle();
      await audio.fadeOut('A', FADE_DURATION).catch(() => {});
    }

    const store = this.getStore();
    store.setAutomationStatus('stopped');
    store.setStepTimeRemaining(0);
    if (resetPosition) {
      store.setCurrentStepIndex(0);
    }
  }
}

export default AutomationEngine;
