import AudioEngine from './AudioEngine';
import { useStore } from '@/store';
import { playTrack, playPlaylistContext } from '@/services/spotify-api';
import type { AutomationStep } from '@/store';

type AutomationEvent =
  | { type: 'stepChanged'; index: number }
  | { type: 'waitingAtPause'; step: AutomationStep }
  | { type: 'finished' }
  | { type: 'error'; message: string };

type Listener = (event: AutomationEvent) => void;

const FADE_DURATION = 800;

function waitForSpotifyDeviceId(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const id = useStore.getState().deviceId;
      if (id) {
        resolve(id);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(null);
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

class AutomationEngine {
  private static instance: AutomationEngine | null = null;

  private listeners: Listener[] = [];
  private nextStepTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private currentStepStartTime = 0;
  /** While Spotify-backed step is playing but SDK not yet `isPlaying`, freeze step clock (countdown + elapsed). */
  private countdownHaltStartedAt: number | null = null;

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
      await this.resumeFromPausedTransport();
      return;
    }

    // Start from current step index (or 0)
    store.setAutomationStatus('playing');
    await this.executeStep(store.currentStepIndex);
  }

  /** Jump to a step and run automation from there (clears pending timers / jingle). */
  async playFromStep(index: number): Promise<void> {
    const steps = this.getSteps();
    if (index < 0 || index >= steps.length) return;

    this.clearNextStepTimer();
    this.clearCountdown();
    AudioEngine.get()?.stopJingle();

    await this.executeStep(index);
  }

  async skipForward(): Promise<void> {
    const store = this.getStore();
    if (store.automationStatus === 'stopped') return;

    window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));

    const steps = this.getSteps();
    if (steps.length === 0) return;
    const next = store.currentStepIndex + 1;
    await this.playFromStep(next >= steps.length ? 0 : next);
  }

  async skipBackward(): Promise<void> {
    const store = this.getStore();
    if (store.automationStatus === 'stopped') return;

    window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));

    const steps = this.getSteps();
    if (steps.length === 0) return;
    const prev = store.currentStepIndex - 1;
    await this.playFromStep(prev < 0 ? steps.length - 1 : prev);
  }

  async executeStep(index: number): Promise<void> {
    const steps = this.getSteps();
    const store = this.getStore();

    if (index >= steps.length) {
      this.emit({ type: 'finished' });
      this.stopInternal();
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
      } else if (step.type === 'playlist') {
        await this.playPlaylistStep(step);
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
      const detail = err instanceof Error ? err.message : '';
      this.emit({
        type: 'error',
        message: detail ? `Failed to play step: ${stepName} — ${detail}` : `Failed to play step: ${stepName}`,
      });
      // Skip to next step on error
      this.scheduleNextStepImmediate(index);
    }
  }

  private async playTrackStep(step: AutomationStep & { type: 'track' }): Promise<void> {
    window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));
    let deviceId = this.getStore().deviceId;
    if (!deviceId) {
      deviceId = await waitForSpotifyDeviceId(15_000);
    }
    if (!deviceId) {
      throw new Error(
        'Web Playback is not connected (Spotify Premium required). Wait for “Spotify player ready” or reconnect Spotify in Settings.',
      );
    }

    const audio = AudioEngine.get();
    if (audio) {
      if (step.transitionIn === 'fadeIn') {
        audio.setVolume('A', 0);
      } else {
        audio.setVolume('A', this.getStore().volume);
      }
    }

    await playTrack(step.spotifyUri, deviceId);
  }

  private async playPlaylistStep(step: AutomationStep & { type: 'playlist' }): Promise<void> {
    window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));
    let deviceId = this.getStore().deviceId;
    if (!deviceId) {
      deviceId = await waitForSpotifyDeviceId(15_000);
    }
    if (!deviceId) {
      throw new Error(
        'Web Playback is not connected (Spotify Premium required). Wait for “Spotify player ready” or reconnect Spotify in Settings.',
      );
    }

    const audio = AudioEngine.get();
    if (audio) {
      if (step.transitionIn === 'fadeIn') {
        audio.setVolume('A', 0);
      } else {
        audio.setVolume('A', this.getStore().volume);
      }
    }

    await playPlaylistContext(step.spotifyPlaylistUri, deviceId);
  }

  private async playJingleStep(step: AutomationStep & { type: 'jingle' }): Promise<void> {
    const audio = AudioEngine.getOrInit();
    audio.resumeContextIfNeeded();

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
      await this.resumeFromPausedTransport();
    }
  }

  /** After transport pause: resume Spotify + timers without re-seeking the step (avoids restart). */
  private async resumeFromPausedTransport(): Promise<void> {
    const store = this.getStore();
    const steps = this.getSteps();
    const index = store.currentStepIndex;
    const step = steps[index];
    if (!step) return;

    if (step.type === 'pause') {
      await this.executeStep(index);
      return;
    }

    if (step.type === 'jingle') {
      await this.executeStep(index);
      return;
    }

    const durationMs = (step as { durationMs: number }).durationMs;
    const remainingMs = store.stepTimeRemaining;
    if (remainingMs <= 0 || remainingMs > durationMs + 2000) {
      window.dispatchEvent(new CustomEvent('radio-sankt:spotify-resume-sdk'));
      await this.executeStep(index);
      return;
    }

    store.setAutomationStatus('playing');
    this.emit({ type: 'stepChanged', index });

    window.dispatchEvent(new CustomEvent('radio-sankt:spotify-resume-sdk'));

    const audio = AudioEngine.get();
    if (audio) {
      if (step.transitionIn === 'fadeIn') {
        await audio.fadeIn('A', FADE_DURATION, store.volume);
      } else {
        audio.setVolume('A', store.volume);
      }
    }

    const elapsedMs = durationMs - remainingMs;
    this.currentStepStartTime = Date.now() - elapsedMs;
    this.startCountdown(step, remainingMs);

    const nextStep = steps[index + 1];
    const overlapMs = nextStep?.transitionIn === 'crossfade' ? nextStep.overlapMs : 0;
    const delay = Math.max(remainingMs - overlapMs, 500);
    this.scheduleAdvanceFromStep(step, index, delay);
  }

  private scheduleAdvanceFromStep(step: AutomationStep, currentIndex: number, delayMs: number): void {
    this.clearNextStepTimer();
    const nextStep = this.getSteps()[currentIndex + 1];
    this.nextStepTimer = setTimeout(async () => {
      try {
        const audio = AudioEngine.get();
        if (step.transitionOut === 'fadeOut' && audio) {
          const channel = step.type === 'jingle' ? 'B' : 'A';
          audio.fadeOut(channel, FADE_DURATION);
        }
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
    }, delayMs);
  }

  private scheduleNextStep(step: AutomationStep, currentIndex: number): void {
    const durationMs = step.type === 'pause' ? 0 : (step as { durationMs: number }).durationMs;
    if (!durationMs) return;

    const nextStep = this.getSteps()[currentIndex + 1];
    const overlapMs = nextStep?.transitionIn === 'crossfade' ? nextStep.overlapMs : 0;
    const delay = Math.max(durationMs - overlapMs, 500);
    this.scheduleAdvanceFromStep(step, currentIndex, delay);
  }

  private scheduleNextStepImmediate(currentIndex: number): void {
    this.clearNextStepTimer();
    this.nextStepTimer = setTimeout(() => {
      this.executeStep(currentIndex + 1).catch((err) => {
        this.emit({ type: 'error', message: `Failed to advance: ${err}` });
      });
    }, 200);
  }

  private startCountdown(step: AutomationStep, initialRemainingMs?: number): void {
    this.clearCountdown();
    if (step.type === 'pause') return;

    const durationMs = (step as { durationMs: number }).durationMs;
    const store = this.getStore();
    const shown =
      initialRemainingMs != null
        ? Math.min(durationMs, Math.max(0, initialRemainingMs))
        : durationMs;
    store.setStepTimeRemaining(shown);

    this.countdownTimer = setInterval(() => {
      const st = useStore.getState();
      const cur = st.automationSteps[st.currentStepIndex];
      const spotifyBacked = cur && (cur.type === 'track' || cur.type === 'playlist');

      if (st.automationStatus !== 'playing') {
        this.countdownHaltStartedAt = null;
        return;
      }
      if (spotifyBacked && !st.isPlaying) {
        if (this.countdownHaltStartedAt == null) this.countdownHaltStartedAt = Date.now();
        return;
      }
      if (this.countdownHaltStartedAt != null) {
        this.currentStepStartTime += Date.now() - this.countdownHaltStartedAt;
        this.countdownHaltStartedAt = null;
      }

      const elapsed = Date.now() - this.currentStepStartTime;
      const remaining = Math.max(durationMs - elapsed, 0);
      st.setStepTimeRemaining(remaining);

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
    this.countdownHaltStartedAt = null;
  }

  private clearNextStepTimer(): void {
    if (this.nextStepTimer) {
      clearTimeout(this.nextStepTimer);
      this.nextStepTimer = null;
    }
  }

  async pause(options?: { skipFade?: boolean }): Promise<void> {
    const store = this.getStore();
    if (store.automationStatus !== 'playing') return;

    this.clearNextStepTimer();
    this.clearCountdown();

    const audio = AudioEngine.get();
    const fadeMs = useStore.getState().fadeOutMs;
    if (audio && !options?.skipFade) {
      await audio.fadeOut('A', fadeMs);
    }

    store.setAutomationStatus('paused');
    window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause-sdk'));
  }

  async stop(): Promise<void> {
    await this.stopInternal();
  }

  private async stopInternal(): Promise<void> {
    this.clearNextStepTimer();
    this.clearCountdown();

    const audio = AudioEngine.get();
    if (audio) {
      audio.stopJingle();
      await audio.fadeOut('A', FADE_DURATION).catch(() => {});
    }

    const store = this.getStore();
    store.setAutomationStatus('stopped');
    store.setCurrentStepIndex(0);
    store.setStepTimeRemaining(0);
    store.setCurrentTrack(null);
    store.setPosition(0);
    store.setDuration(0);
    store.setIsPlaying(false);
    window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause-sdk'));
  }
}

export default AutomationEngine;
