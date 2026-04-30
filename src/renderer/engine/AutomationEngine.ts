import AudioEngine from './AudioEngine';
import { useStore } from '@/store';
import {
  getRemotePlaybackState,
  playTrack,
  playPlaylistContextAtOffset,
  remotePause,
  remoteSetVolumePercent,
} from '@/services/spotify-api';
import { startRecommendationsContinuation, stopRecommendationsContinuation } from '@/services/recommendations-queue';
import type { AutomationStep } from '@/store';

/** Spotify `/me/player/volume` rate-limits aggressively — throttle to ~8 calls/sec. */
const VOLUME_RAMP_MIN_INTERVAL_MS = 120;

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
        requestAnimationFrame(tick);
      } else if (lastSent !== toPct) {
        // Always land exactly on target.
        void remoteSetVolumePercent(toPct, deviceId).catch(() => {});
      }
    };
    requestAnimationFrame(tick);
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

/** Fire advance when this much track/block time is left so ~1.5s polls still catch before Spotify skips. */
export const AUTOMATION_SPOTIFY_NEAR_END_MS = 2200;

/** Extra slack after our remaining estimate before forcing advance if polls stall. */
const SPOTIFY_FALLBACK_SLACK_MS = 12_000;

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

/** Stable seed URI from the previous step (when `/me/player` is flaky). */
async function resolveRecommendationSeedFromPrevStep(prevStep: AutomationStep | undefined): Promise<string | null> {
  if (!prevStep) return null;
  if (prevStep.type === 'track') return prevStep.spotifyUri;
  return null;
}

/** Poll Spotify player between tracks (204/no item); fall back to playlist-derived seed. */
async function waitForSeedTrackUri(timeoutMs: number, fallbackUri: string | null): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remote = await getRemotePlaybackState();
    const uri = remote?.itemUri;
    if (uri?.startsWith('spotify:track:')) return uri;
    await new Promise((r) => setTimeout(r, 400));
  }
  return fallbackUri?.startsWith('spotify:track:') ? fallbackUri : null;
}

class AutomationEngine {
  private static instance: AutomationEngine | null = null;

  private listeners: Listener[] = [];
  private nextStepTimer: ReturnType<typeof setTimeout> | null = null;
  /** Spotify-only: fires if near-end sync never triggers (API/network gaps). */
  private playbackFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private currentStepStartTime = 0;
  /** While Spotify-backed step is playing but SDK not yet `isPlaying`, freeze step clock (countdown + elapsed). */
  private countdownHaltStartedAt: number | null = null;
  private breakRecentKeys: string[] = [];
  private songsSinceBreak = 0;
  /** Invalidates pending step-advance timeouts after skip/pause/seek-reschedule so stale callbacks cannot run. */
  private advanceScheduleGen = 0;
  private transportLock: Promise<void> = Promise.resolve();
  /** Single-flight guard so primary timeout + near-end poll cannot double-advance the same step. */
  private stepTransitionInFlight = false;
  /** Auto-recovery watchdog: retries resume after connectivity-related pauses. */
  private autoRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private autoRecoveryAttempts = 0;
  private static readonly AUTO_RECOVERY_DELAYS = [30_000, 60_000, 120_000];

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.transportLock;
    let resolve!: () => void;
    this.transportLock = new Promise<void>((r) => { resolve = r; });
    return prev.then(fn).finally(() => resolve());
  }

  private currentVolumePct(): number {
    return volumeToPercent(this.getStore().volume);
  }

  private async fadeOutCurrentStep(cur: AutomationStep, audio: AudioEngine | null, devId: string | null): Promise<void> {
    if (cur.type === 'jingle' || cur.type === 'ad') {
      if (audio) await audio.fadeOut('B', FADE_DURATION);
    } else if (devId && cur.type === 'track') {
      await rampSpotifyRemoteVolume(devId, this.currentVolumePct(), 0, FADE_DURATION);
    }
  }

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('radio-sankt:spotify-seek-sync', this.onSpotifySeekSync);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('radio-sankt:automation-spotify-near-end', this.onSpotifyNearEnd);
  }

  private onSpotifyNearEnd = (e: Event) => {
    const d = (e as CustomEvent<{ stepIndex?: number }>).detail;
    const store = this.getStore();
    if (store.automationStatus !== 'playing') return;
    if (typeof d?.stepIndex !== 'number' || d.stepIndex !== store.currentStepIndex) return;
    const step = store.automationSteps[store.currentStepIndex];
    if (!step || step.type !== 'track') return;
    const callerGen = this.advanceScheduleGen;
    void this.runStepTransition(step, store.currentStepIndex, callerGen);
  };

  private onSpotifySeekSync = (e: Event) => {
    const d = (e as CustomEvent<{ positionMs?: number; playbackUri?: string; contextUri?: string }>).detail;
    if (typeof d?.positionMs !== 'number') return;
    this.handleSpotifySeekSync(d.positionMs, d.playbackUri, d.contextUri);
  };

  private onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') return;
    const store = this.getStore();
    const curStep = store.automationSteps[store.currentStepIndex];
    const isLocalAudioStep = curStep?.type === 'jingle' || curStep?.type === 'ad';
    if (store.automationStatus === 'playing' && !store.isPlaying && !isLocalAudioStep) {
      this.invalidatePendingAdvance();
      this.clearCountdown();
      store.setAutomationStatus('paused');
      window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause-sdk'));
      this.emit({ type: 'error', message: 'Playback interrupted (system sleep or network issue). Automation paused.' });
      this.scheduleAutoRecovery();
    }
  };

  private scheduleAutoRecovery(): void {
    this.clearAutoRecovery();
    const delays = AutomationEngine.AUTO_RECOVERY_DELAYS;
    const delay = delays[Math.min(this.autoRecoveryAttempts, delays.length - 1)];
    this.autoRecoveryTimer = setTimeout(() => {
      this.autoRecoveryTimer = null;
      const store = this.getStore();
      if (store.automationStatus !== 'paused') return;
      this.autoRecoveryAttempts++;
      this.emit({ type: 'error', message: `Auto-recovery attempt ${this.autoRecoveryAttempts}...` });
      void this.resume().catch(() => {
        if (this.autoRecoveryAttempts < delays.length) {
          this.scheduleAutoRecovery();
        } else {
          this.emit({ type: 'error', message: 'Auto-recovery failed. Manual resume required.' });
        }
      });
    }, delay);
  }

  private clearAutoRecovery(): void {
    if (this.autoRecoveryTimer) {
      clearTimeout(this.autoRecoveryTimer);
      this.autoRecoveryTimer = null;
    }
    this.autoRecoveryAttempts = 0;
  }



  /** After user seek, realign wall-clock advance timer + countdown with Spotify position. */
  private handleSpotifySeekSync(positionMs: number, playbackUri?: string, _contextUri?: string): void {
    const store = this.getStore();
    if (store.automationStatus !== 'playing' && store.automationStatus !== 'paused') return;

    const idx = store.currentStepIndex;
    const steps = store.automationSteps;
    const step = steps[idx];
    if (!step || step.type !== 'track') return;

    if (!playbackUri || playbackUri !== step.spotifyUri) return;
    const durationMs = step.durationMs;
    if (!durationMs) return;

    const pos = Math.min(Math.max(0, Math.round(positionMs)), durationMs);
    this.currentStepStartTime = Date.now() - pos;
    store.setStepTimeRemaining(Math.max(0, durationMs - pos));

    if (store.automationStatus === 'playing') {
      const remaining = Math.max(0, durationMs - Math.min(Math.max(0, Math.round(positionMs)), durationMs));
      this.startCountdown(step, remaining);
      this.scheduleSpotifyStepAdvance(step, idx);
    }
  }

  /** Fade/spotify ramp where configured, insert breaks, then load next step. Single-flight per advance generation. */
  private async runStepTransition(
    finishingStep: AutomationStep,
    currentIndex: number,
    advanceGen: number,
  ): Promise<void> {
    if (advanceGen !== this.advanceScheduleGen) return;

    const store = this.getStore();
    if (store.automationStatus !== 'playing') return;
    if (store.currentStepIndex !== currentIndex) return;

    const steps = this.getSteps();
    const cur = steps[currentIndex];
    if (!cur || cur.id !== finishingStep.id) return;
    if (this.stepTransitionInFlight) return;

    this.stepTransitionInFlight = true;
    try {
      this.clearPlaybackTimersOnly();

      const nextMeta = steps[currentIndex + 1];
      const audio = AudioEngine.get();
      const devId = store.deviceId;

      const skipFadeForRec =
        !nextMeta &&
        store.continuePlaylistRecommendations &&
        cur.type === 'track';

      if (cur.transitionOut === 'fadeOut' && !skipFadeForRec) {
        await this.fadeOutCurrentStep(cur, audio, devId);
      }
      if (nextMeta?.transitionIn === 'crossfade') {
        await this.fadeOutCurrentStep(cur, audio, devId);
      }

      if (cur.type === 'jingle' || cur.type === 'ad') {
        AudioEngine.get()?.stopAutomationJingle();
      }

      if (advanceGen !== this.advanceScheduleGen) return;

      const nextIndex = this.maybeInsertBreakAfter(currentIndex, cur);
      if (advanceGen !== this.advanceScheduleGen) return;

      await this.executeStep(nextIndex);
    } catch (err) {
      this.emit({ type: 'error', message: `Step transition failed: ${err}` });
      this.scheduleNextStepImmediate(currentIndex);
    } finally {
      this.stepTransitionInFlight = false;
    }
  }

  /**
   * Spotify steps: advance from poll (`automation-spotify-near-end`) when possible;
   * fallback fires after remaining block/song time + slack if the API goes quiet.
   */
  private scheduleSpotifyStepAdvance(step: AutomationStep & { type: 'track' }, currentIndex: number): void {
    const store = this.getStore();
    if (store.automationStatus !== 'playing') return;

    const advanceGen = this.advanceScheduleGen;
    this.clearPlaybackTimersOnly();

    const remainingMs = Math.max(0, store.stepTimeRemaining);
    const fallbackMs = remainingMs + SPOTIFY_FALLBACK_SLACK_MS;

    if (this.playbackFallbackTimer) clearTimeout(this.playbackFallbackTimer);
    this.playbackFallbackTimer = setTimeout(() => {
      if (advanceGen !== this.advanceScheduleGen) return;
      const st = this.getStore();
      const live = st.automationSteps[currentIndex];
      if (!live || live.id !== step.id || st.currentStepIndex !== currentIndex) return;
      if (live.type !== 'track') return;
      void this.runStepTransition(live, currentIndex, advanceGen);
    }, fallbackMs);
  }

  /** Local clips: fallback timer if `onended` never fires. */
  private scheduleLocalAudioFallback(
    step: AutomationStep & { type: 'jingle' | 'ad' },
    currentIndex: number,
    advanceGen: number,
    decodedDurationMs: number,
  ): void {
    this.clearPlaybackTimersOnly();

    const fallbackMs = Math.max(decodedDurationMs, step.durationMs, 1000) + 4000;
    if (this.playbackFallbackTimer) clearTimeout(this.playbackFallbackTimer);
    this.playbackFallbackTimer = setTimeout(() => {
      if (advanceGen !== this.advanceScheduleGen) return;
      const st = this.getStore();
      const live = st.automationSteps[currentIndex];
      if (!live || live.id !== step.id || st.currentStepIndex !== currentIndex) return;
      if (live.type !== 'jingle' && live.type !== 'ad') return;
      void this.runStepTransition(live, currentIndex, advanceGen);
    }, fallbackMs);
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

  private clearPlaybackTimers(): void {
    if (this.nextStepTimer) {
      clearTimeout(this.nextStepTimer);
      this.nextStepTimer = null;
    }
    if (this.playbackFallbackTimer) {
      clearTimeout(this.playbackFallbackTimer);
      this.playbackFallbackTimer = null;
    }
    this.stepTransitionInFlight = false;
  }

  /** Cancel Spotify/jingle advance timeouts without invalidating callback generation (seek/resync paths). */
  private clearPlaybackTimersOnly(): void {
    if (this.nextStepTimer) {
      clearTimeout(this.nextStepTimer);
      this.nextStepTimer = null;
    }
    if (this.playbackFallbackTimer) {
      clearTimeout(this.playbackFallbackTimer);
      this.playbackFallbackTimer = null;
    }
  }

  /** Bump generation and cancel any pending advance timers (fallback + primary). */
  private invalidatePendingAdvance(): void {
    this.advanceScheduleGen++;
    this.clearPlaybackTimers();
  }

  private clearTransportForJump(): void {
    this.invalidatePendingAdvance();
    this.clearCountdown();
    AudioEngine.get()?.stopJingle();
  }

  /** Spotify track steps contribute 1 to `songsSinceBreak` when skipping back. */
  private breakProgressCreditForStep(step: AutomationStep | undefined): number {
    if (!step || step.type !== 'track') return 0;
    return 1;
  }

  async play(): Promise<void> {
    return this.serialized(async () => {
      const store = this.getStore();
      const steps = this.getSteps();
      if (steps.length === 0) return;

      if (store.automationStatus === 'paused') {
        await this.resumeFromPausedTransport();
        return;
      }
      if (store.automationStatus === 'stopped') {
        stopRecommendationsContinuation();
        this.breakRecentKeys = [];
        this.songsSinceBreak = 0;
      }

      // Start from current step index (or 0)
      store.setAutomationStatus('playing');
      await this.executeStep(store.currentStepIndex);
    });
  }

  /** Jump to a step and run automation from there (clears pending timers / jingle). */
  async playFromStep(index: number): Promise<void> {
    const steps = this.getSteps();
    if (index < 0 || index >= steps.length) return;

    this.clearTransportForJump();
    await this.executeStep(index);
  }

  async skipForward(): Promise<void> {
    return this.serialized(async () => {
      const store = this.getStore();
      if (store.automationStatus === 'stopped') return;

      window.dispatchEvent(new CustomEvent('radio-sankt:resume-audio-context'));

      const stepsBefore = this.getSteps();
      const lenBefore = stepsBefore.length;
      if (lenBefore === 0) return;

      const from = store.currentStepIndex;
      if (from < 0 || from >= lenBefore) return;

      const finishingStep = stepsBefore[from];

      this.clearTransportForJump();

      const nextAfterBreak = this.maybeInsertBreakAfter(from, finishingStep);
      const stepsNow = this.getSteps();
      if (stepsNow.length === 0) return;

      // Advance to next step index, or `steps.length` to finish (never wrap to 0 — that restarted the queue).
      const target = Math.max(0, Math.min(nextAfterBreak, stepsNow.length));
      await this.executeStep(target);
    });
  }

  async skipBackward(): Promise<void> {
    return this.serialized(async () => {
      const store = this.getStore();
      if (store.automationStatus === 'stopped') return;

      window.dispatchEvent(new CustomEvent('radio-sankt:resume-audio-context'));

      const steps = this.getSteps();
      if (steps.length === 0) return;

      const from = store.currentStepIndex;
      const cur = steps[from];

      const dec = this.breakProgressCreditForStep(cur);
      if (dec > 0) {
        this.songsSinceBreak = Math.max(0, this.songsSinceBreak - dec);
      }

      this.clearTransportForJump();

      const prev = from - 1;
      const target = prev < 0 ? steps.length - 1 : prev;
      await this.executeStep(target);
    });
  }

  async executeStep(index: number): Promise<void> {
    const steps = this.getSteps();
    const store = this.getStore();

    if (index >= steps.length) {
      this.emit({ type: 'finished' });
      const lastMusicStep = [...steps].reverse().find((s) => s.type === 'track');
      if (store.deviceId && lastMusicStep) {
        try {
          const fallbackSeed = await resolveRecommendationSeedFromPrevStep(lastMusicStep);
          const seedUri = await waitForSeedTrackUri(9000, fallbackSeed);
          if (seedUri) {
            await startRecommendationsContinuation(seedUri, store.deviceId);
            this.finishAutomationKeepingSpotifyPlaying();
            return;
          }
        } catch (err) {
          console.warn('[Automation] recommendations continuation failed:', err);
        }
      }
      // Non-stop: loop back to the beginning rather than stopping
      if (steps.length > 0) {
        this.emit({ type: 'error', message: 'Queue ended — looping from the start.' });
        await this.executeStep(0);
        return;
      }
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

    const genBefore = this.advanceScheduleGen;

    // Populate the NowPlaying bar immediately from the step's own metadata so the UI
    // reflects the active step before the Spotify state poll catches up. (The poll
    // will later overwrite this with the true track metadata from Spotify.)
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
      } else if (step.type === 'playlist') {
        throw new Error('Legacy playlist steps must be migrated to expanded tracks');
      } else if (step.type === 'jingle' || step.type === 'ad') {
        this.armAutomationJingleEnded(step, index, this.advanceScheduleGen, this.getStore().deviceId);
        await this.playLocalAudioStep(step);
      }

      if (genBefore !== this.advanceScheduleGen) return;

      if (step.transitionIn === 'fadeIn') {
        if (step.type === 'jingle' || step.type === 'ad') {
          const audio = AudioEngine.get();
          if (audio) await audio.fadeIn('B', FADE_DURATION);
        } else if (step.type === 'track') {
          const devId = this.getStore().deviceId;
          if (devId) {
            await rampSpotifyRemoteVolume(devId, 0, this.currentVolumePct(), FADE_DURATION);
          }
        }
      }

      if (genBefore !== this.advanceScheduleGen) return;

      this.invalidatePendingAdvance();

      if (step.type === 'track') {
        this.currentStepStartTime = Date.now();
        this.startCountdown(step);
        this.scheduleSpotifyStepAdvance(step, index);
      } else if (step.type === 'jingle' || step.type === 'ad') {
        const decodedMs = Math.round(AudioEngine.get()?.getCurrentJingleDuration() ?? step.durationMs);
        store.setDuration(Math.max(decodedMs, step.durationMs));
        const clipTotal = Math.max(decodedMs, step.durationMs);
        this.currentStepStartTime = Date.now();
        this.startCountdown(step, clipTotal, clipTotal);
        this.scheduleLocalAudioFallback(step, index, this.advanceScheduleGen, decodedMs);
      }
    } catch (err) {
      const stepName = 'name' in step ? step.name : '';
      const detail = err instanceof Error ? err.message : '';
      this.emit({
        type: 'error',
        message: detail ? `Failed to play step: ${stepName} — ${detail}` : `Failed to play step: ${stepName}`,
      });
      // If the error is connectivity/auth related, pause automation instead of rapid-skipping
      if (isConnectivityError(detail)) {
        store.setAutomationStatus('paused');
        window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause-sdk'));
        this.scheduleAutoRecovery();
        return;
      }
      // Skip to next step on non-connectivity errors (e.g. track removed from Spotify)
      this.invalidatePendingAdvance();
      this.scheduleNextStepImmediate(index);
    }
  }

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
      if (!sameGroup) {
        await playPlaylistContextAtOffset(step.groupContextUri, step.groupIndex ?? 0, deviceId);
      }
    } else {
      await playTrack(step.spotifyUri, deviceId);
    }
  }

  private async playLocalAudioStep(step: AutomationStep & { type: 'jingle' | 'ad' }): Promise<void> {
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

    try {
      await audio.playJingle(step.filePath);
    } catch (err) {
      if (step.duckMusic) {
        const deviceId = this.getStore().deviceId;
        if (deviceId) {
          const targetPct = this.currentVolumePct();
          const duckPct = Math.round(targetPct * Math.max(0, Math.min(1, step.duckLevel)));
          void rampSpotifyRemoteVolume(deviceId, duckPct, targetPct, 300);
        }
      }
      throw err;
    }
    // Duck restore + step advance share one `onJingleEnded` (AudioEngine allows a single handler).
  }

  private armAutomationJingleEnded(
    step: AutomationStep & { type: 'jingle' | 'ad' },
    currentIndex: number,
    gen: number,
    deviceId: string | null | undefined,
  ): void {
    const audio = AudioEngine.getOrInit();
    const stepId = step.id;
    audio.onJingleEnded(() => {
      if (gen !== this.advanceScheduleGen) return;
      const store = this.getStore();
      const currentStep = store.automationSteps[store.currentStepIndex];
      if (currentStep && currentStep.id !== stepId) return;
      if (step.duckMusic && deviceId) {
        const targetPct = this.currentVolumePct();
        const baseVol = targetPct;
        const duckPct = Math.round(baseVol * Math.max(0, Math.min(1, step.duckLevel)));
        void rampSpotifyRemoteVolume(deviceId, duckPct, targetPct, 300);
      }
      void this.runStepTransition(step, currentIndex, gen);
    });
  }

  static getInstance(): AutomationEngine {
    if (!AutomationEngine.instance) {
      AutomationEngine.instance = new AutomationEngine();
    }
    return AutomationEngine.instance;
  }

  private handlePauseStep(step: AutomationStep): void {
    this.getStore().setAutomationStatus('waitingAtPause');
    this.emit({ type: 'waitingAtPause', step });
    const pauseTimeout = 'durationMs' in step && step.durationMs > 0 ? step.durationMs : 30_000;
    const gen = this.advanceScheduleGen;
    this.nextStepTimer = setTimeout(() => {
      if (gen !== this.advanceScheduleGen) return;
      if (this.getStore().automationStatus !== 'waitingAtPause') return;
      this.emit({ type: 'error', message: 'Pause step timed out — auto-advancing.' });
      void this.resume();
    }, pauseTimeout);
  }

  async resume(options?: { skipGainRecovery?: boolean }): Promise<void> {
    this.clearAutoRecovery();
    const store = this.getStore();
    if (store.automationStatus === 'waitingAtPause') {
      const nextIndex = store.currentStepIndex + 1;
      await this.executeStep(nextIndex);
    } else if (store.automationStatus === 'paused') {
      await this.resumeFromPausedTransport(options);
    }
  }

  /** After transport pause: resume Spotify + timers without re-seeking the step (avoids restart). */
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
    this.startCountdown(step, remainingMs);

    if (step.type === 'track') {
      this.scheduleSpotifyStepAdvance(step, index);
    }
  }

  /** Build randomized break picks from the configured pool, respecting the avoid-recent window.
   *  Pure helper — updates breakRecentKeys but does not mutate the queue or counters. */
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

  private maybeInsertBreakAfter(currentIndex: number, step: AutomationStep): number {
    if (step.type !== 'track') return currentIndex + 1;

    this.songsSinceBreak += 1;

    const store = this.getStore();
    const rule = store.breakRules.find((r) => r.enabled);
    if (!rule) return currentIndex + 1;
    const everySongs = Math.max(1, Math.floor(rule.everySongs));
    if (this.songsSinceBreak < everySongs) return currentIndex + 1;

    // Skip break if next step is already a user-placed jingle or ad
    const steps = this.getSteps();
    const nextStep = steps[currentIndex + 1];
    if (nextStep && (nextStep.type === 'jingle' || nextStep.type === 'ad')) {
      this.songsSinceBreak = 0;
      return currentIndex + 1;
    }

    this.songsSinceBreak = 0;

    const picks = this.buildBreakPicks(rule);
    if (picks.length === 0) return currentIndex + 1;

    const insertAt = currentIndex + 1;
    const currentSteps = store.automationSteps;
    store.setAutomationSteps([...currentSteps.slice(0, insertAt), ...picks, ...currentSteps.slice(insertAt)]);
    return insertAt;
  }


  private scheduleNextStepImmediate(currentIndex: number): void {
    this.invalidatePendingAdvance();
    const gen = this.advanceScheduleGen;
    this.nextStepTimer = setTimeout(() => {
      if (gen !== this.advanceScheduleGen) return;
      this.executeStep(currentIndex + 1).catch((err) => {
        this.emit({ type: 'error', message: `Failed to advance: ${err}` });
      });
    }, 200);
  }

  private startCountdown(step: AutomationStep, initialRemainingMs?: number, countdownTotalMs?: number): void {
    this.clearCountdown();
    if (step.type === 'pause') return;

    const durationMs = countdownTotalMs ?? (step as { durationMs: number }).durationMs;
    const store = this.getStore();
    const shown =
      initialRemainingMs != null
        ? Math.min(durationMs, Math.max(0, initialRemainingMs))
        : durationMs;
    store.setStepTimeRemaining(shown);

    this.countdownTimer = setInterval(() => {
      const st = useStore.getState();
      const cur = st.automationSteps[st.currentStepIndex];
      const spotifyBacked = cur && cur.type === 'track';

      if (st.automationStatus !== 'playing') {
        this.countdownHaltStartedAt = null;
        return;
      }
      if (spotifyBacked && !st.isPlaying) {
        if (this.countdownHaltStartedAt == null) this.countdownHaltStartedAt = Date.now();
        return;
      }
      if (this.countdownHaltStartedAt != null) {
        const haltDuration = Date.now() - this.countdownHaltStartedAt;
        this.currentStepStartTime += haltDuration;
        this.countdownHaltStartedAt = null;

        // Reschedule advance timer with corrected remaining time
        const steps = st.automationSteps;
        const curStep = steps[st.currentStepIndex];
        const curDuration = (curStep as { durationMs?: number }).durationMs;
        if (curDuration && curStep.type === 'track') {
          const elapsed = Date.now() - this.currentStepStartTime;
          const remaining = Math.max(curDuration - elapsed, 0);
          st.setStepTimeRemaining(remaining);
          this.scheduleSpotifyStepAdvance(curStep, st.currentStepIndex);
        }
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

  async pause(options?: { skipFade?: boolean; autoRecover?: boolean }): Promise<void> {
    return this.serialized(async () => {
      const store = this.getStore();
      if (store.automationStatus !== 'playing') return;

      this.invalidatePendingAdvance();
      this.clearCountdown();

      const fadeMs = useStore.getState().fadeOutMs;
      const devId = store.deviceId;
      if (devId && !options?.skipFade) {
        await rampSpotifyRemoteVolume(devId, this.currentVolumePct(), 0, fadeMs);
      }

      store.setAutomationStatus('paused');
      window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause'));
      if (options?.autoRecover) {
        this.scheduleAutoRecovery();
      }
    });
  }

  async stop(): Promise<void> {
    return this.serialized(async () => {
      await this.stopInternal();
    });
  }

  /** Automation ended successfully but Spotify keeps playing (recommendations queue). */
  private finishAutomationKeepingSpotifyPlaying(): void {
    this.invalidatePendingAdvance();
    this.clearCountdown();
    this.breakRecentKeys = [];
    this.songsSinceBreak = 0;

    AudioEngine.get()?.stopJingle();

    const store = this.getStore();
    store.setAutomationStatus('stopped');
    store.setCurrentStepIndex(0);
    store.setStepTimeRemaining(0);
    store.setIsPlaying(true);
  }

  private async stopInternal(): Promise<void> {
    this.clearAutoRecovery();
    stopRecommendationsContinuation();
    this.invalidatePendingAdvance();
    this.clearCountdown();
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
}

export default AutomationEngine;
