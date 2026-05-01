import AudioEngine from './AudioEngine';
import { useStore } from '@/store';
import {
  getRemotePlaybackState,
  playTrack,
  playPlaylistContextAtOffset,
  remotePause,
  remoteSetVolumePercent,
  addTrackToQueue,
  waitForActiveTrackUri,
} from '@/services/spotify-api';
import type { AutomationStep } from '@/store';

/** Spotify `/me/player/volume` rate-limits aggressively — throttle to ~8 calls/sec. */
const VOLUME_RAMP_MIN_INTERVAL_MS = 120;

/** Prevents concurrent ramp animations from stacking on top of each other. */
let activeRampRaf: number | null = null;

/**
 * Animate Spotify Connect device volume between two percentages over `durationMs`.
 * Used in place of Web Audio gain ramps now that audio plays through Spotify's native app.
 * Non-blocking: the promise resolves when the full duration has elapsed even if the
 * underlying REST calls are still in flight, matching AudioEngine.fade* semantics.
 */
function rampSpotifyRemoteVolume(
  deviceId: string,
  fromPct: number,
  toPct: number,
  durationMs: number,
): Promise<void> {
  if (activeRampRaf !== null) {
    cancelAnimationFrame(activeRampRaf);
    activeRampRaf = null;
  }
  return new Promise((resolve) => {
    if (durationMs <= 0) {
      void remoteSetVolumePercent(toPct, deviceId).catch(() => {});
      resolve();
      return;
    }
    const start = performance.now();
    let lastSent = -1;
    let lastSentAt = 0;
    const tick = () => {
      const now = performance.now();
      const t = Math.min(1, (now - start) / durationMs);
      const v = Math.round(fromPct + (toPct - fromPct) * t);
      const throttled = now - lastSentAt < VOLUME_RAMP_MIN_INTERVAL_MS;
      if (v !== lastSent && !throttled) {
        lastSent = v;
        lastSentAt = now;
        void remoteSetVolumePercent(v, deviceId).catch(() => {});
      }
      if (t < 1) {
        activeRampRaf = requestAnimationFrame(tick);
      } else {
        activeRampRaf = null;
        if (lastSent !== toPct) {
          void remoteSetVolumePercent(toPct, deviceId).catch(() => {});
        }
      }
    };
    activeRampRaf = requestAnimationFrame(tick);
    setTimeout(resolve, durationMs);
  });
}

function volumeToPercent(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

function isConnectivityError(message: string): boolean {
  return (
    message.includes('Web Playback is not connected') ||
    message.includes('No Spotify device') ||
    message.includes('aborted') ||
    message.includes('network') ||
    message.includes('Failed to fetch') ||
    message.includes('Premium') ||
    message.includes('401') ||
    message.includes('403') ||
    message.includes('429') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('RATE_LIMITED')
  );
}

type AutomationEvent =
  | { type: 'stepChanged'; index: number }
  | { type: 'waitingAtPause'; step: AutomationStep }
  | { type: 'finished' }
  | { type: 'error'; message: string };

type Listener = (event: AutomationEvent) => void;

const FADE_DURATION = 800;

/** Fire advance when this much track/block time is left. */
export const AUTOMATION_SPOTIFY_NEAR_END_MS = 3000;

/** Reconciliation loop interval. */
const LOOP_INTERVAL_MS = 2000;

/** After issuing a Spotify command, skip reconciliation for this long. */
const COMMAND_COOLDOWN_MS = 3500;

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
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private currentStepStartTime = 0;
  private breakRecentKeys: string[] = [];
  private songsSinceBreak = 0;
  /** Single busy flag — loop skips while true, public methods set it. */
  private busy = false;
  /** Timestamp of last Spotify command — loop skips reconciliation during cooldown. */
  private lastCommandAt = 0;
  /** URI preloaded into Spotify's native queue for gapless transition. */
  private preloadedNextUri: string | null = null;
  /** Forces the next playTrackStep to call the Spotify API even if the step is in the same group. */
  private forceNextPlayback = false;
  /** Consecutive ticks where Spotify reports not playing (for silence detection). */
  private silentTicks = 0;
  /** Whether the queue has ended and we're monitoring for silence to loop. */
  private postQueueEnd = false;

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('radio-sankt:spotify-seek-sync', this.onSpotifySeekSync);
  }

  // ─── Public API ──────────────────────────────────────────────────────

  static getInstance(): AutomationEngine {
    if (!AutomationEngine.instance) {
      AutomationEngine.instance = new AutomationEngine();
    }
    return AutomationEngine.instance;
  }

  get isTransitioning(): boolean {
    return this.busy;
  }

  on(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  async play(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const store = this.getStore();
      const steps = this.getSteps();
      if (steps.length === 0) return;

      if (store.automationStatus === 'paused') {
        await this.resumeFromPausedTransport();
        return;
      }
      if (store.automationStatus === 'stopped') {
        this.breakRecentKeys = [];
        this.songsSinceBreak = 0;
        this.silentTicks = 0;
        this.postQueueEnd = false;
      }

      store.setAutomationStatus('playing');
      this.startLoop();
      await this.executeStep(store.currentStepIndex);
    } finally {
      this.busy = false;
    }
  }

  async playFromStep(index: number): Promise<void> {
    const steps = this.getSteps();
    if (index < 0 || index >= steps.length) return;
    if (this.busy) return;
    this.busy = true;
    try {
      this.clearForJump();
      this.getStore().setAutomationStatus('playing');
      this.startLoop();
      await this.executeStep(index);
    } finally {
      this.busy = false;
    }
  }

  async skipForward(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const store = this.getStore();
      if (store.automationStatus === 'stopped') return;

      window.dispatchEvent(new CustomEvent('radio-sankt:resume-audio-context'));

      const steps = this.getSteps();
      if (steps.length === 0) return;

      const from = store.currentStepIndex;
      if (from < 0 || from >= steps.length) return;

      this.clearForJump();
      const target = Math.min(from + 1, steps.length);
      await this.executeStep(target);
    } finally {
      this.busy = false;
    }
  }

  async skipBackward(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const store = this.getStore();
      if (store.automationStatus === 'stopped') return;

      window.dispatchEvent(new CustomEvent('radio-sankt:resume-audio-context'));

      const steps = this.getSteps();
      if (steps.length === 0) return;

      const from = store.currentStepIndex;
      const cur = steps[from];

      if (cur?.type === 'track') {
        this.songsSinceBreak = Math.max(0, this.songsSinceBreak - 1);
      }

      this.clearForJump();
      const prev = from - 1;
      const target = prev < 0 ? steps.length - 1 : prev;
      await this.executeStep(target);
    } finally {
      this.busy = false;
    }
  }

  async pause(options?: { skipFade?: boolean; autoRecover?: boolean }): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const store = this.getStore();
      if (store.automationStatus !== 'playing') return;

      const fadeMs = useStore.getState().fadeOutMs;
      const devId = store.deviceId;
      if (devId && !options?.skipFade) {
        await rampSpotifyRemoteVolume(devId, this.currentVolumePct(), 0, fadeMs);
      }

      store.setAutomationStatus('paused');
      window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause'));
    } finally {
      this.busy = false;
    }
  }

  async resume(options?: { skipGainRecovery?: boolean }): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const store = this.getStore();
      if (store.automationStatus === 'waitingAtPause') {
        const nextIndex = store.currentStepIndex + 1;
        await this.executeStep(nextIndex);
      } else if (store.automationStatus === 'paused') {
        await this.resumeFromPausedTransport(options);
      }
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.stopInternal();
    } finally {
      this.busy = false;
    }
  }

  // ─── Reconciliation Loop ─────────────────────────────────────────────

  private startLoop(): void {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => void this.tick(), LOOP_INTERVAL_MS);
  }

  private stopLoop(): void {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return;

    const store = this.getStore();
    const status = store.automationStatus;

    // Post-queue-end monitoring: if Spotify goes silent for 2 ticks, loop from start
    if (this.postQueueEnd) {
      await this.tickPostQueueEnd();
      return;
    }

    // Only reconcile while playing
    if (status !== 'playing') return;

    // Cooldown after issuing commands — don't fight our own actions
    if (Date.now() - this.lastCommandAt < COMMAND_COOLDOWN_MS) return;

    const steps = store.automationSteps;
    const idx = store.currentStepIndex;
    const step = steps[idx];
    if (!step) return;

    if (step.type === 'jingle' || step.type === 'ad') {
      this.tickLocalAudio(step, idx);
      return;
    }

    if (step.type === 'track') {
      await this.tickSpotifyTrack(step, idx);
      return;
    }
  }

  private tickLocalAudio(step: AutomationStep & { type: 'jingle' | 'ad' }, idx: number): void {
    const audio = AudioEngine.get();
    if (!audio) return;

    // Update countdown from actual audio position
    const position = audio.getCurrentJinglePosition();
    const duration = audio.getCurrentJingleDuration() || step.durationMs;
    const remaining = Math.max(0, duration - position);
    this.getStore().setStepTimeRemaining(remaining);

    // If jingle ended (not playing anymore), advance
    if (!audio.isJinglePlaying() && position > 0) {
      void this.advanceFromStep(step, idx);
    }
  }

  private async tickSpotifyTrack(step: AutomationStep & { type: 'track' }, idx: number): Promise<void> {
    let state;
    try {
      state = await getRemotePlaybackState();
    } catch {
      // Transient network error — skip this tick
      return;
    }

    // Null = 204 (transient) — skip
    if (!state) return;

    const store = this.getStore();
    // Re-check status after async call
    if (store.automationStatus !== 'playing') return;
    if (store.currentStepIndex !== idx) return;

    const expectedUri = step.spotifyUri;

    if (state.isPlaying) {
      this.silentTicks = 0;

      // Update countdown from Spotify's actual position (no drift)
      if (state.track?.uri === expectedUri) {
        const durationMs = state.track.durationMs ?? step.durationMs;
        const remaining = Math.max(0, durationMs - (state.progressMs ?? 0));
        store.setStepTimeRemaining(remaining);
        this.currentStepStartTime = Date.now() - (state.progressMs ?? 0);

        // Near-end detection — trigger transition
        if (remaining < AUTOMATION_SPOTIFY_NEAR_END_MS && remaining > 0) {
          void this.advanceFromStep(step, idx);
        }
      } else {
        // Spotify is playing a different track — check if it auto-advanced to the next step
        const steps = this.getSteps();
        const nextStep = steps[idx + 1];
        if (
          nextStep?.type === 'track' &&
          state.track?.uri === nextStep.spotifyUri &&
          nextStep.groupId && nextStep.groupId === step.groupId
        ) {
          // Spotify auto-advanced within the group — trigger proper transition (includes break check)
          void this.advanceFromStep(step, idx);
        } else if (
          nextStep?.type === 'track' &&
          state.track?.uri === nextStep.spotifyUri
        ) {
          // Spotify auto-advanced to the next step (cross-group or standalone)
          // Treat as a natural transition
          void this.advanceFromStep(step, idx);
        } else {
          // Genuinely wrong track — but only force-replay if the current step hasn't elapsed
          const elapsed = Date.now() - this.currentStepStartTime;
          if (elapsed >= step.durationMs - AUTOMATION_SPOTIFY_NEAR_END_MS) {
            // Current step likely ended — advance instead of replaying
            void this.advanceFromStep(step, idx);
          } else {
            await this.forcePlayCurrentStep(step);
          }
        }
      }
    } else {
      // Spotify not playing but we expect it to be
      this.silentTicks++;
      if (this.silentTicks >= 2) {
        this.silentTicks = 0;
        await this.forcePlayCurrentStep(step);
      }
    }
  }

  private async tickPostQueueEnd(): Promise<void> {
    let state;
    try {
      state = await getRemotePlaybackState();
    } catch {
      return;
    }
    if (state?.isPlaying) {
      this.silentTicks = 0;
      return;
    }
    this.silentTicks++;
    if (this.silentTicks >= 2) {
      this.silentTicks = 0;
      this.postQueueEnd = false;
      this.emit({ type: 'error', message: 'Silence detected — restarting playback.' });
      this.busy = true;
      try {
        const store = this.getStore();
        store.setAutomationStatus('playing');
        store.setIsPlaying(true);
        this.forceNextPlayback = true;
        this.preloadedNextUri = null;
        await this.executeStep(0);
      } finally {
        this.busy = false;
      }
    }
  }

  private async forcePlayCurrentStep(step: AutomationStep & { type: 'track' }): Promise<void> {
    this.busy = true;
    try {
      this.forceNextPlayback = true;
      this.preloadedNextUri = null;
      await this.playTrackStep(step);
      this.markCommand();
    } catch (err) {
      const detail = err instanceof Error ? err.message : '';
      if (isConnectivityError(detail)) {
        this.getStore().setAutomationStatus('paused');
        this.emit({ type: 'error', message: `Connectivity issue — automation paused: ${detail}` });
      }
    } finally {
      this.busy = false;
    }
  }

  // ─── Step Execution ──────────────────────────────────────────────────

  private async executeStep(index: number): Promise<void> {
    const steps = this.getSteps();
    const store = this.getStore();

    if (index >= steps.length) {
      this.emit({ type: 'finished' });
      // Let Spotify continue; monitor for silence to loop back
      if (steps.length > 0) {
        store.setAutomationStatus('stopped');
        store.setIsPlaying(true);
        this.postQueueEnd = true;
        this.silentTicks = 0;
        return;
      }
      await this.stopInternal();
      return;
    }

    const step = steps[index];
    store.setCurrentStepIndex(index);
    store.setAutomationStatus('playing');
    this.startLoop();
    this.emit({ type: 'stepChanged', index });

    if (step.type === 'pause') {
      this.handlePauseStep(step);
      return;
    }

    // Populate NowPlaying bar immediately from step metadata
    if (step.type === 'track') {
      store.setCurrentTrack({
        id: step.spotifyUri,
        title: step.name,
        artist: step.artist,
        album: '',
        albumArt: step.albumArt,
        duration: step.durationMs,
        uri: step.spotifyUri,
      });
      store.setDuration(step.durationMs);
      store.setPosition(0);
    } else if (step.type === 'jingle' || step.type === 'ad') {
      store.setCurrentTrack({
        id: String(step.type === 'jingle' ? step.jingleId : step.adId),
        title: step.name,
        artist: step.type === 'jingle' ? 'Jingle' : 'Ad',
        album: '',
        albumArt: '',
        duration: step.durationMs,
      });
      store.setDuration(step.durationMs);
      store.setPosition(0);
    }

    try {
      if (step.type === 'track') {
        await this.playTrackStep(step);
        this.markCommand();
        this.currentStepStartTime = Date.now();
        store.setStepTimeRemaining(step.durationMs);
        this.preloadNextTrack(step, index);

        if (step.transitionIn === 'fadeIn') {
          const devId = store.deviceId;
          if (devId) {
            await rampSpotifyRemoteVolume(devId, 0, this.currentVolumePct(), FADE_DURATION);
          }
        }
      } else if (step.type === 'playlist') {
        throw new Error('Legacy playlist steps must be migrated to expanded tracks');
      } else if (step.type === 'jingle' || step.type === 'ad') {
        await this.playLocalAudioStep(step, index);
        this.currentStepStartTime = Date.now();
        const decodedMs = Math.round(AudioEngine.get()?.getCurrentJingleDuration() ?? step.durationMs);
        const clipTotal = Math.max(decodedMs, step.durationMs);
        store.setDuration(clipTotal);
        store.setStepTimeRemaining(clipTotal);

        if (step.transitionIn === 'fadeIn') {
          const audio = AudioEngine.get();
          if (audio) await audio.fadeIn('B', FADE_DURATION);
        }
      }
    } catch (err) {
      const stepName = 'name' in step ? step.name : '';
      const detail = err instanceof Error ? err.message : '';
      this.emit({
        type: 'error',
        message: detail ? `Failed to play step: ${stepName} — ${detail}` : `Failed to play step: ${stepName}`,
      });
      if (isConnectivityError(detail)) {
        store.setAutomationStatus('paused');
        return;
      }
      // Skip to next on non-connectivity errors
      await this.executeStep(index + 1);
    }
  }

  // ─── Transitions ─────────────────────────────────────────────────────

  private async advanceFromStep(step: AutomationStep, currentIndex: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const store = this.getStore();
      if (store.automationStatus !== 'playing') return;
      if (store.currentStepIndex !== currentIndex) return;

      const steps = this.getSteps();
      const cur = steps[currentIndex];
      if (!cur || cur.id !== step.id) return;

      // Fade out current step if configured
      const nextMeta = steps[currentIndex + 1];
      const audio = AudioEngine.get();
      const devId = store.deviceId;

      if (cur.transitionOut === 'fadeOut' || nextMeta?.transitionIn === 'crossfade') {
        await this.fadeOutCurrentStep(cur, audio, devId);
      }

      if (cur.type === 'jingle' || cur.type === 'ad') {
        AudioEngine.get()?.stopAutomationJingle();
      }

      // Play inline break jingles if due
      const breakPicks = this.getBreakPicksIfDue(currentIndex, cur);
      if (breakPicks.length > 0 && devId) {
        this.preloadedNextUri = null;
        await remotePause(devId).catch(() => {});
        await remoteSetVolumePercent(this.currentVolumePct(), devId).catch(() => {});
        const breakAudio = AudioEngine.getOrInit();
        breakAudio.resumeContextIfNeeded();
        breakAudio.setVolume('B', 1);
        for (const pick of breakPicks) {
          if (pick.type !== 'jingle' && pick.type !== 'ad') continue;
          try {
            await breakAudio.playJingle(pick.filePath);
            await new Promise<void>((resolve) => {
              if (!breakAudio.isJinglePlaying()) { resolve(); return; }
              const timeout = setTimeout(() => resolve(), (pick.durationMs || 30_000) + 5_000);
              breakAudio.onJingleEnded(() => { clearTimeout(timeout); resolve(); });
            });
          } catch { /* skip failed clip */ }
        }
        // Re-check state after breaks
        if (this.getStore().automationStatus !== 'playing') return;
        this.forceNextPlayback = true;
      }

      await this.executeStep(currentIndex + 1);
    } catch (err) {
      this.emit({ type: 'error', message: `Step transition failed: ${err}` });
      // Attempt to advance anyway
      try {
        const store = this.getStore();
        await this.executeStep(store.currentStepIndex + 1);
      } catch { /* give up */ }
    } finally {
      this.busy = false;
    }
  }

  // ─── Playback Helpers ────────────────────────────────────────────────

  private async playTrackStep(step: AutomationStep & { type: 'track' }): Promise<void> {
    window.dispatchEvent(new CustomEvent('radio-sankt:resume-audio-context'));
    const deviceId = await this.ensureSpotifyDevice();
    const store = this.getStore();

    if (step.transitionIn === 'fadeIn') {
      await remoteSetVolumePercent(0, deviceId).catch(() => {});
    } else {
      await remoteSetVolumePercent(this.currentVolumePct(), deviceId).catch(() => {});
    }

    if (step.groupId && step.groupContextUri) {
      const prevStep = store.automationSteps[store.currentStepIndex - 1];
      const sameGroup = prevStep?.type === 'track' && prevStep.groupId === step.groupId;
      if (!sameGroup || this.forceNextPlayback) {
        this.forceNextPlayback = false;
        this.preloadedNextUri = null;
        await playPlaylistContextAtOffset(step.groupContextUri, step.groupIndex ?? 0, deviceId);
      } else {
        // Same group — Spotify should auto-advance. Verify it did.
        const state = await getRemotePlaybackState().catch(() => null);
        if (!state?.isPlaying || state.track?.uri !== step.spotifyUri) {
          await playPlaylistContextAtOffset(step.groupContextUri, step.groupIndex ?? 0, deviceId);
        }
      }
    } else if (this.preloadedNextUri === step.spotifyUri) {
      this.preloadedNextUri = null;
      this.forceNextPlayback = false;
      try {
        await waitForActiveTrackUri(step.spotifyUri, 3_000);
      } catch {
        await playTrack(step.spotifyUri, deviceId);
      }
    } else {
      this.forceNextPlayback = false;
      this.preloadedNextUri = null;
      try {
        await playTrack(step.spotifyUri, deviceId);
      } catch (err) {
        if (err instanceof Error && err.message.includes('did not switch')) {
          console.warn('[AutomationEngine] Track confirmation timed out, assuming playback started');
        } else {
          throw err;
        }
      }
    }
  }

  private async playLocalAudioStep(step: AutomationStep & { type: 'jingle' | 'ad' }, currentIndex: number): Promise<void> {
    const audio = AudioEngine.getOrInit();
    audio.resumeContextIfNeeded();
    const deviceId = this.getStore().deviceId;

    if (deviceId && !step.duckMusic) {
      await remotePause(deviceId).catch(() => {});
    }

    if (step.duckMusic && deviceId) {
      const baseVol = this.currentVolumePct();
      const duckPct = Math.round(baseVol * Math.max(0, Math.min(1, step.duckLevel)));
      await rampSpotifyRemoteVolume(deviceId, baseVol, duckPct, 300);
    }

    if (step.transitionIn === 'fadeIn') {
      audio.setVolume('B', 0);
    }

    // Arm the onJingleEnded handler for duck restore + advance
    this.armJingleEnded(step, currentIndex, deviceId);

    try {
      await audio.playJingle(step.filePath);
    } catch (err) {
      if (step.duckMusic && deviceId) {
        const targetPct = this.currentVolumePct();
        const duckPct = Math.round(targetPct * Math.max(0, Math.min(1, step.duckLevel)));
        void rampSpotifyRemoteVolume(deviceId, duckPct, targetPct, 300);
      }
      throw err;
    }
  }

  private armJingleEnded(
    step: AutomationStep & { type: 'jingle' | 'ad' },
    currentIndex: number,
    deviceId: string | null | undefined,
  ): void {
    const audio = AudioEngine.getOrInit();
    const stepId = step.id;
    audio.onJingleEnded(() => {
      const store = this.getStore();
      const currentStep = store.automationSteps[store.currentStepIndex];
      if (currentStep && currentStep.id !== stepId) return;
      if (step.duckMusic && deviceId) {
        const targetPct = this.currentVolumePct();
        const duckPct = Math.round(targetPct * Math.max(0, Math.min(1, step.duckLevel)));
        void rampSpotifyRemoteVolume(deviceId, duckPct, targetPct, 300);
      }
      void this.advanceFromStep(step, currentIndex);
    });
  }

  private preloadNextTrack(currentStep: AutomationStep & { type: 'track' }, currentIndex: number): void {
    const steps = this.getSteps();
    const next = steps[currentIndex + 1];
    if (!next || next.type !== 'track') {
      this.preloadedNextUri = null;
      return;
    }
    if (next.groupId && next.groupContextUri) {
      this.preloadedNextUri = null;
      return;
    }
    if (currentStep.groupId && currentStep.groupId === next.groupId) {
      this.preloadedNextUri = null;
      return;
    }
    this.preloadedNextUri = next.spotifyUri;
    void addTrackToQueue(next.spotifyUri).catch(() => {
      this.preloadedNextUri = null;
    });
  }

  // ─── Internal Helpers ────────────────────────────────────────────────

  private async ensureSpotifyDevice(): Promise<string> {
    let deviceId = this.getStore().deviceId;
    if (!deviceId) {
      deviceId = await waitForSpotifyDeviceId(15_000);
    }
    if (!deviceId) {
      throw new Error(
        'No Spotify device available — open the Spotify app on this computer (or any device) and make sure you are signed in.',
      );
    }
    return deviceId;
  }

  private handlePauseStep(step: AutomationStep): void {
    this.getStore().setAutomationStatus('waitingAtPause');
    this.emit({ type: 'waitingAtPause', step });
    const pauseTimeout = 'durationMs' in step && step.durationMs > 0 ? step.durationMs : 30_000;
    setTimeout(() => {
      if (this.getStore().automationStatus !== 'waitingAtPause') return;
      this.emit({ type: 'error', message: 'Pause step timed out — auto-advancing.' });
      void this.resume();
    }, pauseTimeout);
  }

  private async resumeFromPausedTransport(options?: { skipGainRecovery?: boolean }): Promise<void> {
    const store = this.getStore();
    const steps = this.getSteps();
    const index = store.currentStepIndex;
    const step = steps[index];
    if (!step) return;

    if (step.type === 'pause') {
      await this.executeStep(index);
      return;
    }

    if (step.type === 'jingle' || step.type === 'ad') {
      await this.executeStep(index);
      return;
    }

    const durationMs = (step as { durationMs: number }).durationMs;
    const remainingMs = store.stepTimeRemaining;
    if (remainingMs <= 0 || remainingMs > durationMs + 2000) {
      window.dispatchEvent(new CustomEvent('radio-sankt:spotify-resume'));
      await this.executeStep(index);
      return;
    }

    store.setAutomationStatus('playing');
    this.startLoop();
    this.emit({ type: 'stepChanged', index });

    window.dispatchEvent(new CustomEvent('radio-sankt:spotify-resume'));

    if (!options?.skipGainRecovery) {
      const devId = store.deviceId;
      if (devId) {
        if (step.transitionIn === 'fadeIn') {
          await rampSpotifyRemoteVolume(devId, 0, this.currentVolumePct(), FADE_DURATION);
        } else {
          await remoteSetVolumePercent(this.currentVolumePct(), devId).catch(() => {});
        }
      }
    }

    const elapsedMs = durationMs - remainingMs;
    this.currentStepStartTime = Date.now() - elapsedMs;
    this.markCommand();
  }

  private async stopInternal(): Promise<void> {
    this.stopLoop();
    this.postQueueEnd = false;
    this.silentTicks = 0;
    this.breakRecentKeys = [];
    this.songsSinceBreak = 0;

    const audio = AudioEngine.get();
    if (audio) {
      audio.stopJingle();
    }

    const store = this.getStore();
    const devId = store.deviceId;
    if (devId) {
      await rampSpotifyRemoteVolume(devId, this.currentVolumePct(), 0, FADE_DURATION).catch(() => {});
    }

    store.setAutomationStatus('stopped');
    store.setCurrentStepIndex(0);
    store.setStepTimeRemaining(0);
    store.setCurrentTrack(null);
    store.setPosition(0);
    store.setDuration(0);
    store.setIsPlaying(false);
    window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause'));
  }

  private async fadeOutCurrentStep(cur: AutomationStep, audio: AudioEngine | null, devId: string | null): Promise<void> {
    if (cur.type === 'jingle' || cur.type === 'ad') {
      if (audio) await audio.fadeOut('B', FADE_DURATION);
    } else if (devId && cur.type === 'track') {
      await rampSpotifyRemoteVolume(devId, this.currentVolumePct(), 0, FADE_DURATION);
    }
  }

  private clearForJump(): void {
    this.forceNextPlayback = true;
    this.preloadedNextUri = null;
    this.silentTicks = 0;
    AudioEngine.get()?.stopJingle();
  }

  private markCommand(): void {
    this.lastCommandAt = Date.now();
  }

  private currentVolumePct(): number {
    return volumeToPercent(this.getStore().volume);
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

  // ─── Break Logic ─────────────────────────────────────────────────────

  private getBreakPicksIfDue(currentIndex: number, step: AutomationStep): AutomationStep[] {
    if (step.type !== 'track') return [];

    this.songsSinceBreak += 1;

    const store = this.getStore();
    const rule = store.breakRules.find((r) => r.enabled);
    if (!rule) return [];
    const everySongs = Math.max(1, Math.floor(rule.everySongs));
    if (this.songsSinceBreak < everySongs) return [];

    // Skip break if next step is already a user-placed jingle or ad
    const steps = this.getSteps();
    const nextStep = steps[currentIndex + 1];
    if (nextStep && (nextStep.type === 'jingle' || nextStep.type === 'ad')) {
      this.songsSinceBreak = 0;
      return [];
    }

    this.songsSinceBreak = 0;
    return this.buildBreakPicks(rule);
  }

  private buildBreakPicks(rule: {
    selectedJingleIds: number[];
    selectedAdIds: number[];
    itemsPerBreak: number;
    avoidRecent: number;
  }): AutomationStep[] {
    const store = this.getStore();
    const selectedJingles = new Set(rule.selectedJingleIds ?? []);
    const selectedAds = new Set(rule.selectedAdIds ?? []);
    const pool: Array<{ kind: 'jingle' | 'ad'; id: number; name: string; filePath: string; durationMs: number }> = [
      ...store.jingles.filter((j) => selectedJingles.has(j.id)).map((j) => ({ kind: 'jingle' as const, ...j })),
      ...store.ads.filter((a) => selectedAds.has(a.id)).map((a) => ({ kind: 'ad' as const, ...a })),
    ];
    if (pool.length === 0) return [];

    const pickCount = Math.max(1, Math.floor(rule.itemsPerBreak));
    const avoidRecent = Math.max(0, Math.floor(rule.avoidRecent));
    const picks: AutomationStep[] = [];
    const pickedKeys = new Set<string>();

    for (let i = 0; i < pickCount; i += 1) {
      const candidates = pool.filter((p) => {
        const k = `${p.kind}:${p.id}`;
        return !this.breakRecentKeys.includes(k) && !pickedKeys.has(k);
      });
      const fallback = pool.filter((p) => !pickedKeys.has(`${p.kind}:${p.id}`));
      const source = candidates.length > 0 ? candidates : fallback;
      if (source.length === 0) break;
      const pick = source[Math.floor(Math.random() * source.length)];
      const key = `${pick.kind}:${pick.id}`;
      pickedKeys.add(key);
      this.breakRecentKeys = [key, ...this.breakRecentKeys].slice(0, avoidRecent);
      picks.push({
        id: crypto.randomUUID(),
        type: pick.kind,
        ...(pick.kind === 'ad' ? { adId: pick.id } : { jingleId: pick.id }),
        name: pick.name,
        filePath: pick.filePath,
        durationMs: pick.durationMs,
        transitionIn: 'immediate',
        transitionOut: 'immediate',
        overlapMs: 0,
        duckMusic: false,
        duckLevel: 0.2,
      } as AutomationStep);
    }
    return picks;
  }

  // ─── External Events ─────────────────────────────────────────────────

  private onSpotifySeekSync = (e: Event) => {
    const d = (e as CustomEvent<{ positionMs?: number; playbackUri?: string; contextUri?: string }>).detail;
    if (typeof d?.positionMs !== 'number') return;
    this.handleSpotifySeekSync(d.positionMs, d.playbackUri);
  };

  private handleSpotifySeekSync(positionMs: number, playbackUri?: string): void {
    const store = this.getStore();
    if (store.automationStatus !== 'playing' && store.automationStatus !== 'paused') return;

    const idx = store.currentStepIndex;
    const step = store.automationSteps[idx];
    if (!step || step.type !== 'track') return;
    if (!playbackUri || playbackUri !== step.spotifyUri) return;

    const durationMs = step.durationMs;
    if (!durationMs) return;

    const pos = Math.min(Math.max(0, Math.round(positionMs)), durationMs);
    this.currentStepStartTime = Date.now() - pos;
    store.setStepTimeRemaining(Math.max(0, durationMs - pos));
  }
}

export default AutomationEngine;
