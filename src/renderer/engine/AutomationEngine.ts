import AudioEngine from './AudioEngine';
import { useStore } from '@/store';
import { playTrack, playPlaylistContext, remoteSetVolumePercent } from '@/services/spotify-api';
import type { AutomationStep } from '@/store';

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
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      const v = Math.round(fromPct + (toPct - fromPct) * t);
      if (v !== lastSent) {
        lastSent = v;
        void remoteSetVolumePercent(v, deviceId).catch(() => {});
      }
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(resolve, durationMs);
  });
}

function volumeToPercent(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

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
  private breakRecentKeys: string[] = [];
  private songsSinceBreak = 0;
  /** Invalidates pending step-advance timeouts after skip/pause/seek-reschedule so stale callbacks cannot run. */
  private advanceScheduleGen = 0;

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('radio-sankt:spotify-seek-sync', this.onSpotifySeekSync);
  }

  private onSpotifySeekSync = (e: Event) => {
    const d = (e as CustomEvent<{ positionMs?: number; playbackUri?: string; contextUri?: string }>).detail;
    if (typeof d?.positionMs !== 'number') return;
    this.handleSpotifySeekSync(d.positionMs, d.playbackUri, d.contextUri);
  };

  /** After user seek, realign wall-clock advance timer + countdown with Spotify position. */
  private handleSpotifySeekSync(positionMs: number, playbackUri?: string, contextUri?: string): void {
    const store = this.getStore();
    if (store.automationStatus !== 'playing') return;

    const idx = store.currentStepIndex;
    const steps = store.automationSteps;
    const step = steps[idx];
    if (!step || (step.type !== 'track' && step.type !== 'playlist')) return;

    if (step.type === 'track') {
      if (!playbackUri || playbackUri !== step.spotifyUri) return;
    } else if (step.type === 'playlist') {
      if (!contextUri || contextUri !== step.spotifyPlaylistUri) return;
    }

    const durationMs = (step as { durationMs: number }).durationMs;
    if (!durationMs) return;

    const pos = Math.min(Math.max(0, Math.round(positionMs)), durationMs);
    this.currentStepStartTime = Date.now() - pos;
    store.setStepTimeRemaining(Math.max(0, durationMs - pos));

    const nextStep = steps[idx + 1];
    const overlapMs = nextStep?.transitionIn === 'crossfade' ? nextStep.overlapMs : 0;
    const delay = Math.max(durationMs - pos - overlapMs, 500);
    this.scheduleAdvanceFromStep(step, idx, delay);
  }

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

  private clearTransportForJump(): void {
    this.advanceScheduleGen++;
    this.clearNextStepTimer();
    this.clearCountdown();
    AudioEngine.get()?.stopJingle();
  }

  /** Spotify/playlist steps contribute this much to `songsSinceBreak` when skipping back. */
  private breakProgressCreditForStep(step: AutomationStep | undefined): number {
    if (!step || (step.type !== 'track' && step.type !== 'playlist')) return 0;
    return step.type === 'playlist' ? Math.max(1, step.trackCount) : 1;
  }

  async play(): Promise<void> {
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
    }

    // Start from current step index (or 0)
    store.setAutomationStatus('playing');
    await this.executeStep(store.currentStepIndex);
  }

  /** Jump to a step and run automation from there (clears pending timers / jingle). */
  async playFromStep(index: number): Promise<void> {
    const steps = this.getSteps();
    if (index < 0 || index >= steps.length) return;

    this.clearTransportForJump();
    await this.executeStep(index);
  }

  async skipForward(): Promise<void> {
    const store = this.getStore();
    if (store.automationStatus === 'stopped') return;

    window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));

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

    const inserted = stepsNow.length > lenBefore;
    const target = !inserted && nextAfterBreak >= lenBefore ? 0 : nextAfterBreak;
    await this.executeStep(Math.max(0, Math.min(target, stepsNow.length - 1)));
  }

  async skipBackward(): Promise<void> {
    const store = this.getStore();
    if (store.automationStatus === 'stopped') return;

    window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));

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
      } else if (step.type === 'jingle' || step.type === 'ad') {
        await this.playLocalAudioStep(step);
      }

      if (step.transitionIn === 'fadeIn') {
        if (step.type === 'jingle' || step.type === 'ad') {
          const audio = AudioEngine.get();
          if (audio) await audio.fadeIn('B', FADE_DURATION);
        } else if (step.type === 'track' || step.type === 'playlist') {
          const devId = this.getStore().deviceId;
          if (devId) {
            await rampSpotifyRemoteVolume(devId, 0, volumeToPercent(this.getStore().volume), FADE_DURATION);
          }
        }
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
    window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));
    const deviceId = await this.ensureSpotifyDevice();
    const store = this.getStore();

    if (step.transitionIn === 'fadeIn') {
      await remoteSetVolumePercent(0, deviceId).catch(() => {});
    } else {
      await remoteSetVolumePercent(volumeToPercent(store.volume), deviceId).catch(() => {});
    }

    await playTrack(step.spotifyUri, deviceId);
  }

  private async playPlaylistStep(step: AutomationStep & { type: 'playlist' }): Promise<void> {
    window.dispatchEvent(new CustomEvent('radio-sankt:prime-spotify-playback'));
    const deviceId = await this.ensureSpotifyDevice();
    const store = this.getStore();

    if (step.transitionIn === 'fadeIn') {
      await remoteSetVolumePercent(0, deviceId).catch(() => {});
    } else {
      await remoteSetVolumePercent(volumeToPercent(store.volume), deviceId).catch(() => {});
    }

    await playPlaylistContext(step.spotifyPlaylistUri, deviceId);
  }

  private async playLocalAudioStep(step: AutomationStep & { type: 'jingle' | 'ad' }): Promise<void> {
    const audio = AudioEngine.getOrInit();
    audio.resumeContextIfNeeded();
    const deviceId = this.getStore().deviceId;

    if (step.duckMusic && deviceId) {
      const baseVol = volumeToPercent(this.getStore().volume);
      const duckPct = Math.round(baseVol * Math.max(0, Math.min(1, step.duckLevel)));
      await rampSpotifyRemoteVolume(deviceId, baseVol, duckPct, 300);
    }

    if (step.transitionIn === 'fadeIn') {
      audio.setVolume('B', 0);
    }

    await audio.playJingle(step.filePath);

    if (step.duckMusic && deviceId) {
      audio.onJingleEnded(() => {
        const targetPct = volumeToPercent(this.getStore().volume);
        const baseVol = targetPct;
        const duckPct = Math.round(baseVol * Math.max(0, Math.min(1, step.duckLevel)));
        void rampSpotifyRemoteVolume(deviceId, duckPct, targetPct, 300);
      });
    }
  }

  private handlePauseStep(step: AutomationStep): void {
    this.getStore().setAutomationStatus('waitingAtPause');
    this.emit({ type: 'waitingAtPause', step });
  }

  async resume(options?: { skipGainRecovery?: boolean }): Promise<void> {
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
      window.dispatchEvent(new CustomEvent('radio-sankt:spotify-resume-sdk'));
      await this.executeStep(index);
      return;
    }

    store.setAutomationStatus('playing');
    this.emit({ type: 'stepChanged', index });

    window.dispatchEvent(new CustomEvent('radio-sankt:spotify-resume-sdk'));

    if (!options?.skipGainRecovery) {
      const devId = store.deviceId;
      if (devId) {
        if (step.transitionIn === 'fadeIn') {
          await rampSpotifyRemoteVolume(devId, 0, volumeToPercent(store.volume), FADE_DURATION);
        } else {
          await remoteSetVolumePercent(volumeToPercent(store.volume), devId).catch(() => {});
        }
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
    this.advanceScheduleGen++;
    const gen = this.advanceScheduleGen;
    const nextStep = this.getSteps()[currentIndex + 1];
    this.nextStepTimer = setTimeout(async () => {
      if (gen !== this.advanceScheduleGen) return;
      try {
        const audio = AudioEngine.get();
        const devId = this.getStore().deviceId;
        const isJingleLike = (s: AutomationStep | undefined) => s?.type === 'jingle' || s?.type === 'ad';

        if (step.transitionOut === 'fadeOut') {
          if (isJingleLike(step)) {
            if (audio) audio.fadeOut('B', FADE_DURATION);
          } else if (devId && (step.type === 'track' || step.type === 'playlist')) {
            void rampSpotifyRemoteVolume(devId, volumeToPercent(this.getStore().volume), 0, FADE_DURATION);
          }
        }
        if (nextStep?.transitionIn === 'crossfade') {
          // Crossfade fade-out for current step + fade-in for next step (via next step's execute path).
          if (isJingleLike(step)) {
            if (audio) audio.fadeOut('B', FADE_DURATION);
          } else if (devId && (step.type === 'track' || step.type === 'playlist')) {
            void rampSpotifyRemoteVolume(devId, volumeToPercent(this.getStore().volume), 0, FADE_DURATION);
          }
        }
        const nextIndex = this.maybeInsertBreakAfter(currentIndex, step);
        if (gen !== this.advanceScheduleGen) return;
        await this.executeStep(nextIndex);
      } catch (err) {
        this.emit({ type: 'error', message: `Step transition failed: ${err}` });
        this.scheduleNextStepImmediate(currentIndex);
      }
    }, delayMs);
  }

  private maybeInsertBreakAfter(currentIndex: number, step: AutomationStep): number {
    if (step.type !== 'track' && step.type !== 'playlist') return currentIndex + 1;
    this.songsSinceBreak += step.type === 'playlist' ? Math.max(1, step.trackCount) : 1;
    const store = this.getStore();
    const rule = store.breakRules.find((r) => r.enabled);
    if (!rule) return currentIndex + 1;
    const everySongs = Math.max(1, Math.floor(rule.everySongs));
    if (this.songsSinceBreak < everySongs) return currentIndex + 1;
    this.songsSinceBreak = 0;

    const selectedJingles = new Set(rule.selectedJingleIds ?? []);
    const selectedAds = new Set(rule.selectedAdIds ?? []);
    const pool: Array<{ kind: 'jingle' | 'ad'; id: number; name: string; filePath: string; durationMs: number }> = [
      ...store.jingles.filter((j) => selectedJingles.has(j.id)).map((j) => ({ kind: 'jingle' as const, ...j })),
      ...store.ads.filter((a) => selectedAds.has(a.id)).map((a) => ({ kind: 'ad' as const, ...a })),
    ];
    if (pool.length === 0) return currentIndex + 1;

    const pickCount = Math.max(1, Math.floor(rule.itemsPerBreak));
    const avoidRecent = Math.max(0, Math.floor(rule.avoidRecent));
    const picks: AutomationStep[] = [];

    for (let i = 0; i < pickCount; i += 1) {
      const candidates = pool.filter((p) => !this.breakRecentKeys.includes(`${p.kind}:${p.id}`));
      const source = (candidates.length > 0 ? candidates : pool)[Math.floor(Math.random() * (candidates.length > 0 ? candidates.length : pool.length))];
      if (!source) continue;
      const key = `${source.kind}:${source.id}`;
      this.breakRecentKeys = [key, ...this.breakRecentKeys].slice(0, avoidRecent);
      picks.push({
        id: crypto.randomUUID(),
        type: source.kind,
        ...(source.kind === 'ad' ? { adId: source.id } : { jingleId: source.id }),
        name: source.name,
        filePath: source.filePath,
        durationMs: source.durationMs,
        transitionIn: 'immediate',
        transitionOut: 'immediate',
        overlapMs: 0,
        duckMusic: false,
        duckLevel: 0.2,
      } as AutomationStep);
    }

    if (picks.length === 0) return currentIndex + 1;
    const insertAt = currentIndex + 1;
    const steps = store.automationSteps;
    store.setAutomationSteps([...steps.slice(0, insertAt), ...picks, ...steps.slice(insertAt)]);
    return insertAt;
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
    this.advanceScheduleGen++;
    const gen = this.advanceScheduleGen;
    this.nextStepTimer = setTimeout(() => {
      if (gen !== this.advanceScheduleGen) return;
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

    this.advanceScheduleGen++;
    this.clearNextStepTimer();
    this.clearCountdown();

    const fadeMs = useStore.getState().fadeOutMs;
    const devId = store.deviceId;
    if (devId && !options?.skipFade) {
      await rampSpotifyRemoteVolume(devId, volumeToPercent(store.volume), 0, fadeMs);
    }

    store.setAutomationStatus('paused');
    window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause-sdk'));
  }

  async stop(): Promise<void> {
    await this.stopInternal();
  }

  private async stopInternal(): Promise<void> {
    this.advanceScheduleGen++;
    this.clearNextStepTimer();
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
      await rampSpotifyRemoteVolume(devId, volumeToPercent(store.volume), 0, FADE_DURATION).catch(() => {});
    }

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
