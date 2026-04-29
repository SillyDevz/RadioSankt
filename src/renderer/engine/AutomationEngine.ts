import AudioEngine from './AudioEngine';
import { useStore } from '@/store';
import {
  playTrack,
  playPlaylistContext,
  remotePause,
  remoteSetVolumePercent,
  resumePlaybackBestEffort,
} from '@/services/spotify-api';
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
  /** How many intra-playlist track advances we've already credited to songsSinceBreak for the current playlist step.
   *  Subtracted from the whole-block credit when the block ends so we don't double count. */
  private intraPlaylistCreditedForStepId: string | null = null;
  private intraPlaylistCreditedCount = 0;
  /** Serializes intra-playlist break insertions so a rapid succession of track-change events doesn't race. */
  private intraPlaylistBreakInFlight = false;

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('radio-sankt:spotify-seek-sync', this.onSpotifySeekSync);
    window.addEventListener('radio-sankt:spotify-playlist-track-changed', this.onPlaylistTrackChanged);
  }

  private onSpotifySeekSync = (e: Event) => {
    const d = (e as CustomEvent<{ positionMs?: number; playbackUri?: string; contextUri?: string }>).detail;
    if (typeof d?.positionMs !== 'number') return;
    this.handleSpotifySeekSync(d.positionMs, d.playbackUri, d.contextUri);
  };

  private onPlaylistTrackChanged = (e: Event) => {
    const d = (e as CustomEvent<{
      stepId?: string;
      previousTrackUri?: string;
      newTrackUri?: string;
      newTrackDurationMs?: number;
    }>).detail;
    if (!d?.stepId || !d.newTrackUri) return;
    void this.handlePlaylistTrackChanged(d.stepId, d.newTrackUri);
  };

  /** A new song just started inside an active playlist step. Credit the finished one to
   *  the break counter, and if a break is due, pause Spotify, run the jingles, and resume. */
  private async handlePlaylistTrackChanged(stepId: string, newTrackUri: string): Promise<void> {
    if (this.intraPlaylistBreakInFlight) return;
    const store = this.getStore();
    if (store.automationStatus !== 'playing') return;

    const steps = this.getSteps();
    const idx = store.currentStepIndex;
    const step = steps[idx];
    if (!step || step.type !== 'playlist' || step.id !== stepId) return;

    // Track one more completed song within this playlist block.
    if (this.intraPlaylistCreditedForStepId !== stepId) {
      this.intraPlaylistCreditedForStepId = stepId;
      this.intraPlaylistCreditedCount = 0;
    }
    this.intraPlaylistCreditedCount += 1;
    this.songsSinceBreak += 1;

    const rule = store.breakRules.find((r) => r.enabled);
    const everySongs = rule ? Math.max(1, Math.floor(rule.everySongs)) : Infinity;
    if (!rule || this.songsSinceBreak < everySongs) return;

    // Time to insert a break between songs of the playlist.
    const picks = this.buildBreakPicks(rule);
    if (picks.length === 0) {
      // Avoid re-evaluating every track forever while the pool is misconfigured.
      this.songsSinceBreak = 0;
      return;
    }

    this.intraPlaylistBreakInFlight = true;
    this.songsSinceBreak = 0;

    try {
      this.advanceScheduleGen++;
      this.clearNextStepTimer();
      this.clearCountdown();

      const deviceId = store.deviceId;
      if (deviceId) {
        try {
          await remotePause(deviceId);
        } catch {
          /* ignore — resume will retry the same device */
        }
      }

      const audio = AudioEngine.getOrInit();
      audio.resumeContextIfNeeded();
      audio.setVolume(1);

      // Play jingles sequentially on the local audio channel.
      // Register onJingleEnded only after playJingle starts — playJingle calls stopJingle() first,
      // which clears any handler registered beforehand (otherwise we never resume Spotify).
      for (const pick of picks) {
        if (pick.type !== 'jingle' && pick.type !== 'ad') continue;
        try {
          await audio.playJingle(pick.filePath);
        } catch {
          /* skip failed clip */
        }
        await new Promise<void>((resolve) => {
          if (!audio.isJinglePlaying()) {
            resolve();
            return;
          }
          audio.onJingleEnded(() => resolve());
        });
      }

      // Re-check: user may have stopped automation while jingles played.
      const nowStore = this.getStore();
      if (nowStore.automationStatus !== 'playing') return;

      // Resume playback on Spotify (prefer cached device; fall back if id went stale).
      try {
        await resumePlaybackBestEffort(deviceId);
      } catch {
        window.dispatchEvent(new CustomEvent('radio-sankt:spotify-resume'));
      }

      // Reschedule using remaining block time — do not reset to full playlist duration or the
      // advance timer can fire immediately when summed durationMs is shorter than real playback.
      const newStore = this.getStore();
      const stepsNow = newStore.automationSteps;
      const stillIdx = newStore.currentStepIndex;
      const stillStep = stepsNow[stillIdx];
      if (stillStep && stillStep.type === 'playlist' && stillStep.id === stepId) {
        const dur = stillStep.durationMs;
        let remainingMs = newStore.stepTimeRemaining;
        if (remainingMs <= 0 || remainingMs > dur + 2000) {
          remainingMs = dur;
        } else {
          remainingMs = Math.min(dur, Math.max(0, remainingMs));
        }
        const elapsedIntoBlock = dur - remainingMs;
        this.currentStepStartTime = Date.now() - elapsedIntoBlock;
        this.startCountdown(stillStep, remainingMs);
        const nextStep = stepsNow[stillIdx + 1];
        const overlapMs = nextStep?.transitionIn === 'crossfade' ? nextStep.overlapMs : 0;
        this.scheduleAdvanceFromStep(stillStep, stillIdx, Math.max(remainingMs - overlapMs, 500));
      }
      // Silence the unused-param warning; newTrackUri is only used by the poller.
      void newTrackUri;
    } finally {
      this.intraPlaylistBreakInFlight = false;
    }
  }

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
      // Spotify reports progress within the current item only; playlist steps use summed block durationMs.
      return;
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
    this.intraPlaylistCreditedForStepId = null;
    this.intraPlaylistCreditedCount = 0;
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
      this.intraPlaylistCreditedForStepId = null;
      this.intraPlaylistCreditedCount = 0;
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
  }

  async skipBackward(): Promise<void> {
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
    } else if (step.type === 'playlist') {
      store.setCurrentTrack({
        id: step.spotifyPlaylistUri,
        title: step.name,
        artist: `Playlist · ${step.trackCount} tracks`,
        album: '',
        albumArt: step.albumArt,
        duration: step.durationMs,
        uri: step.spotifyPlaylistUri,
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
        await this.playPlaylistStep(step);
      } else if (step.type === 'jingle' || step.type === 'ad') {
        await this.playLocalAudioStep(step);
      }

      if (step.transitionIn === 'fadeIn') {
        if (step.type === 'jingle' || step.type === 'ad') {
          const audio = AudioEngine.get();
          if (audio) await audio.fadeIn(FADE_DURATION);
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
    window.dispatchEvent(new CustomEvent('radio-sankt:resume-audio-context'));
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
    window.dispatchEvent(new CustomEvent('radio-sankt:resume-audio-context'));
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
      audio.setVolume(0);
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
            if (audio) audio.fadeOut(FADE_DURATION);
          } else if (devId && (step.type === 'track' || step.type === 'playlist')) {
            void rampSpotifyRemoteVolume(devId, volumeToPercent(this.getStore().volume), 0, FADE_DURATION);
          }
        }
        if (nextStep?.transitionIn === 'crossfade') {
          // Crossfade fade-out for current step + fade-in for next step (via next step's execute path).
          if (isJingleLike(step)) {
            if (audio) audio.fadeOut(FADE_DURATION);
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
    return picks;
  }

  private maybeInsertBreakAfter(currentIndex: number, step: AutomationStep): number {
    if (step.type !== 'track' && step.type !== 'playlist') return currentIndex + 1;

    // For a playlist step, songs that already triggered intra-block breaks were
    // credited in handlePlaylistTrackChanged; subtract them so we don't double count.
    let stepCredit = step.type === 'playlist' ? Math.max(1, step.trackCount) : 1;
    if (
      step.type === 'playlist' &&
      this.intraPlaylistCreditedForStepId === step.id &&
      this.intraPlaylistCreditedCount > 0
    ) {
      stepCredit = Math.max(0, stepCredit - this.intraPlaylistCreditedCount);
    }
    this.songsSinceBreak += stepCredit;

    // Clear the intra-playlist credit bookkeeping once the block ends.
    if (step.type === 'playlist' && this.intraPlaylistCreditedForStepId === step.id) {
      this.intraPlaylistCreditedForStepId = null;
      this.intraPlaylistCreditedCount = 0;
    }

    const store = this.getStore();
    const rule = store.breakRules.find((r) => r.enabled);
    if (!rule) return currentIndex + 1;
    const everySongs = Math.max(1, Math.floor(rule.everySongs));
    if (this.songsSinceBreak < everySongs) return currentIndex + 1;
    this.songsSinceBreak = 0;

    const picks = this.buildBreakPicks(rule);
    if (picks.length === 0) return currentIndex + 1;

    const insertAt = currentIndex + 1;
    const steps = store.automationSteps;
    store.setAutomationSteps([...steps.slice(0, insertAt), ...picks, ...steps.slice(insertAt)]);
    return insertAt;
  }

  private scheduleNextStep(step: AutomationStep, currentIndex: number): void {
    if (step.type === 'pause') return;
    const durationMs = (step as { durationMs: number }).durationMs;
    if (!durationMs) {
      this.scheduleAdvanceFromStep(step, currentIndex, 0);
      return;
    }

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
    window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause'));
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
    this.intraPlaylistCreditedForStepId = null;
    this.intraPlaylistCreditedCount = 0;
    this.intraPlaylistBreakInFlight = false;

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
    window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause'));
  }
}

export default AutomationEngine;
