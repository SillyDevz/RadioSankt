import { useEffect, useRef, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { useStore } from '@/store';
import AudioEngine from '@/engine/AudioEngine';
import AutomationEngine, { AUTOMATION_SPOTIFY_NEAR_END_MS } from '@/engine/AutomationEngine';
import {
  getRemotePlaybackState,
  listSpotifyDevices,
  pickPreferredDevice,
  remoteNext,
  remotePause,
  remotePrevious,
  remoteResume,
  remoteSeek,
  remoteSetVolumePercent,
  transferPlaybackToDevice,
} from '@/services/spotify-api';

/**
 * Spotify Connect remote-control mode.
 *
 * Radio Sankt does NOT play audio itself anymore. Instead it drives whichever Spotify
 * device the user has active (desktop app, phone, speakers, etc.) via the Web API.
 * This avoids Widevine/EME entirely — works on any OS where Spotify's native app runs.
 *
 * Mixing/ducking with jingles is done via Spotify's `setVolume` endpoint (ramp in JS),
 * not via Web Audio gain nodes.
 */

const STATE_POLL_MS = 1500;
const DEVICE_DISCOVERY_POLL_MS = 8000;

/** Treat a `progress_ms` jump as a user seek only if it deviates from natural progression
 *  by more than this many milliseconds (poll cadence + Spotify clock jitter tolerance). */
const SEEK_DEVIATION_THRESHOLD_MS = 4000;

/** During automation, detect seeks sooner than idle playback so timers stay aligned. */
const AUTOMATION_SEEK_DEVIATION_MS = 900;

/** Avoid spamming near-end while polls stay in the tail window (single-flight is engine-side too). */
let automationNearEndCooldownUntil = 0;

/** Minimum gap between Spotify `/me/player/volume` calls during a ramp (API rate-limits). */
const VOLUME_RAMP_MIN_CALL_INTERVAL_MS = 120;

let liveRampRaf: number | null = null;
let liveRampLastSent: { at: number; value: number } | null = null;
let lastSpotifySeekSyncSample:
  | { trackId: string; position: number; at: number }
  | null = null;

/** Keeps last track info so we can restore display if Spotify returns a transient null. */
let cachedDiscoveredDeviceId: string | null = null;

function cancelLiveRamp() {
  if (liveRampRaf !== null) {
    cancelAnimationFrame(liveRampRaf);
    liveRampRaf = null;
  }
  liveRampLastSent = null;
}

function rampRemoteSpotifyVolume(deviceId: string, fromPct: number, toPct: number, durationMs: number) {
  cancelLiveRamp();
  const start = performance.now();
  let lastVolumeSent = -1;
  const tick = () => {
    const t = durationMs <= 0 ? 1 : Math.min(1, (performance.now() - start) / durationMs);
    const v = Math.round(fromPct + (toPct - fromPct) * t);
    const now = performance.now();
    const tooSoon =
      liveRampLastSent !== null &&
      now - liveRampLastSent.at < VOLUME_RAMP_MIN_CALL_INTERVAL_MS;
    if (v !== lastVolumeSent && !tooSoon) {
      lastVolumeSent = v;
      liveRampLastSent = { at: now, value: v };
      void remoteSetVolumePercent(v, deviceId).catch(() => {});
    }
    if (t < 1) {
      liveRampRaf = requestAnimationFrame(tick);
    } else {
      // Always send the final value so we land exactly on target even if throttled earlier.
      if (lastVolumeSent !== toPct) {
        lastVolumeSent = toPct;
        liveRampLastSent = { at: now, value: toPct };
        void remoteSetVolumePercent(toPct, deviceId).catch(() => {});
      }
      liveRampRaf = null;
    }
  };
  liveRampRaf = requestAnimationFrame(tick);
}

export function useSpotifyPlayer() {
  const {
    token,
    volume,
    isLive,
    deviceId,
    setDeviceId,
    setDeviceName,
    setSdkReady,
    setIsPlaying,
    setCurrentTrack,
    setPosition,
    setDuration,
  } = useStore(
    (s) => ({
      token: s.token,
      volume: s.volume,
      isLive: s.isLive,
      deviceId: s.deviceId,
      setDeviceId: s.setDeviceId,
      setDeviceName: s.setDeviceName,
      setSdkReady: s.setSdkReady,
      setIsPlaying: s.setIsPlaying,
      setCurrentTrack: s.setCurrentTrack,
      setPosition: s.setPosition,
      setDuration: s.setDuration,
    }),
    shallow,
  );

  const deviceIdRef = useRef<string | null>(deviceId);
  deviceIdRef.current = deviceId;
  const toggleInFlight = useRef(false);

  const togglePlayback = useCallback(async () => {
    if (toggleInFlight.current) return;
    const { isLive } = useStore.getState();
    if (isLive) return;
    toggleInFlight.current = true;
    try {
      const { automationStatus, automationSteps, isPlaying } = useStore.getState();

      if (automationStatus === 'waitingAtPause') {
        await AutomationEngine.getInstance().resume();
        return;
      }

      if (automationStatus === 'stopped' || automationSteps.length === 0) {
        const devId = deviceIdRef.current;
        if (!devId) return;
        try {
          if (isPlaying) await remotePause(devId);
          else await remoteResume(devId);
        } catch {
          /* transport will refresh via state poll */
        }
        return;
      }

      const engine = AutomationEngine.getInstance();
      const curAutoStep = automationSteps[useStore.getState().currentStepIndex];
      const isLocalAudio = curAutoStep?.type === 'jingle' || curAutoStep?.type === 'ad';

      if (isPlaying || (automationStatus === 'playing' && isLocalAudio)) {
        if (automationStatus === 'playing') await engine.pause();
        else window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause'));
        return;
      }

      if (automationStatus === 'paused') await engine.play();
      else window.dispatchEvent(new CustomEvent('radio-sankt:spotify-resume'));
    } finally {
      toggleInFlight.current = false;
    }
  }, []);

  // ── Device discovery + state poll ─────────────────────────────────────
  useEffect(() => {
    const { setWebPlaybackDiag } = useStore.getState();

    if (!token) {
      setWebPlaybackDiag('idle', null);
      setSdkReady(false);
      setDeviceId(null);
      setDeviceName(null);
      setIsPlaying(false);
      setCurrentTrack(null);
      setPosition(0);
      setDuration(0);
      cachedDiscoveredDeviceId = null;
      return;
    }

    let cancelled = false;
    let discoveryTimer: ReturnType<typeof setTimeout> | null = null;
    let stateTimer: ReturnType<typeof setInterval> | null = null;
    let noDeviceToastAt = 0;
    /** Only issue `transferPlaybackToDevice` when we discover a NEW device id; never re-transfer
     *  the one we're already using — that can cause mid-track interruptions. */
    let transferAttemptedFor: string | null = null;

    const pickDevice = async () => {
      if (cancelled) return;
      try {
        const devices = await listSpotifyDevices();
        if (cancelled) return;
        const picked = pickPreferredDevice(devices);
        if (picked) {
          const deviceChanged = deviceIdRef.current !== picked.id;
          if (deviceChanged) {
            setDeviceId(picked.id);
            setDeviceName(picked.name);
            setSdkReady(true);
            setWebPlaybackDiag('ready', null);
            cachedDiscoveredDeviceId = picked.id;
          }
          // Transfer only once per discovered device id, and only when not already active.
          if (!picked.is_active && transferAttemptedFor !== picked.id) {
            transferAttemptedFor = picked.id;
            try {
              await transferPlaybackToDevice(picked.id);
            } catch {
              /* ignore; user may intervene */
            }
          }
          if (picked.is_active) {
            // Mark as already-transferred once Spotify confirms it's active.
            transferAttemptedFor = picked.id;
          }
        } else {
          if (deviceIdRef.current !== null) {
            setDeviceId(null);
            setDeviceName(null);
            setSdkReady(false);
            const { automationStatus } = useStore.getState();
            if (automationStatus === 'playing') {
              AutomationEngine.getInstance().pause({ autoRecover: true });
            }
          }
          transferAttemptedFor = null;
          const now = Date.now();
          if (now - noDeviceToastAt > 30_000) {
            noDeviceToastAt = now;
            setWebPlaybackDiag(
              'error',
              'No Spotify device found — open the Spotify app on this computer (or any device) and try again.',
            );
          }
        }
      } catch (err) {
        if (cancelled) return;
        setWebPlaybackDiag('error', `device discovery: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (!cancelled) {
          discoveryTimer = setTimeout(pickDevice, DEVICE_DISCOVERY_POLL_MS);
        }
      }
    };

    const pollState = async () => {
      if (cancelled) return;
      let state;
      try {
        state = await getRemotePlaybackState();
      } catch {
        return; // transient network error, next tick retries
      }
      if (cancelled) return;
      if (!state) {
        // Transient null — Spotify sometimes returns 204 between tracks. Don't wipe UI state.
        return;
      }

      // Playback-stolen detection: if Spotify reports paused but automation thinks it's
      // playing, another device/user paused playback — pause automation to stay in sync.
      // Skip when the current step is a jingle/ad or during intra-playlist breaks
      // (we intentionally pause Spotify for those).
      const stBefore = useStore.getState();
      const curAutoStep = stBefore.automationSteps[stBefore.currentStepIndex];
      const isLocalAudioStep = curAutoStep?.type === 'jingle' || curAutoStep?.type === 'ad';
      const engine = AutomationEngine.getInstance();
      if (
        !state.isPlaying &&
        stBefore.isPlaying &&
        (stBefore.automationStatus === 'playing') &&
        !isLocalAudioStep
      ) {
        engine.pause();
      }

      if (state.isPlaying !== useStore.getState().isPlaying) setIsPlaying(state.isPlaying);

      if (state.deviceId && state.deviceId !== deviceIdRef.current) {
        setDeviceId(state.deviceId);
        if (state.deviceName) setDeviceName(state.deviceName);
        setSdkReady(true);
      }

      if (state.track) {
        if (state.track.uri !== useStore.getState().currentTrack?.uri) {
          setCurrentTrack({
            id: state.track.id ?? state.track.uri,
            title: state.track.name,
            artist: state.track.artists,
            album: state.track.albumName,
            albumArt: state.track.albumArt,
            duration: state.track.durationMs,
            uri: state.track.uri,
          });
        }
        if (state.track.durationMs !== useStore.getState().duration) setDuration(state.track.durationMs);
        if (Math.abs(state.progressMs - useStore.getState().position) > 500) setPosition(state.progressMs);

        const st = useStore.getState();
        const curStep = st.automationSteps[st.currentStepIndex];
        const playbackMatchesStep =
          !!curStep &&
          ((curStep.type === 'track' && curStep.spotifyUri === state.track.uri) ||
            (curStep.type === 'playlist' && curStep.spotifyPlaylistUri === state.contextUri));

        const prevSample = lastSpotifySeekSyncSample;
        const now = Date.now();

        if (
          playbackMatchesStep &&
          st.automationStatus === 'playing' &&
          state.isPlaying &&
          state.track.id &&
          prevSample &&
          prevSample.trackId === state.track.id
        ) {
          // Expected forward delta ≈ wall-clock elapsed since the previous sample.
          // Only call it a seek if Spotify reports a position that deviates from
          // natural progression by more than the threshold. This avoids false
          // positives from polling jitter and rate limiting.
          const wallElapsed = now - prevSample.at;
          const observedDelta = state.progressMs - prevSample.position;
          const deviation = Math.abs(observedDelta - wallElapsed);
          const seekThreshold =
            curStep?.type === 'track' || curStep?.type === 'playlist'
              ? AUTOMATION_SEEK_DEVIATION_MS
              : SEEK_DEVIATION_THRESHOLD_MS;
          if (deviation > seekThreshold) {
            window.dispatchEvent(
              new CustomEvent('radio-sankt:spotify-seek-sync', {
                detail: {
                  positionMs: state.progressMs,
                  playbackUri: state.track.uri,
                  contextUri: state.contextUri ?? undefined,
                },
              }),
            );
          }
        }

        if (
          playbackMatchesStep &&
          st.automationStatus === 'playing' &&
          state.isPlaying &&
          curStep?.type === 'playlist' &&
          curStep.spotifyPlaylistUri === state.contextUri
        ) {
          const stAfter = useStore.getState();
          const remainingBlock = stAfter.stepTimeRemaining;
          const nextOv =
            stAfter.automationSteps[stAfter.currentStepIndex + 1]?.transitionIn === 'crossfade'
              ? stAfter.automationSteps[stAfter.currentStepIndex + 1]?.overlapMs ?? 0
              : 0;
          const tailMs = AUTOMATION_SPOTIFY_NEAR_END_MS + nextOv;
          const nowMs = Date.now();
          if (remainingBlock <= tailMs && nowMs >= automationNearEndCooldownUntil) {
            automationNearEndCooldownUntil = nowMs + 3500;
            window.dispatchEvent(
              new CustomEvent('radio-sankt:automation-spotify-near-end', {
                detail: { stepIndex: st.currentStepIndex },
              }),
            );
          }
        }

        if (
          playbackMatchesStep &&
          st.automationStatus === 'playing' &&
          state.isPlaying &&
          curStep?.type === 'track' &&
          curStep.spotifyUri === state.track.uri
        ) {
          const spotifyRemaining = Math.max(0, state.track.durationMs - state.progressMs);
          const stAfter = useStore.getState();
          stAfter.setStepTimeRemaining(Math.min(curStep.durationMs, spotifyRemaining));
          const nextOv =
            stAfter.automationSteps[stAfter.currentStepIndex + 1]?.transitionIn === 'crossfade'
              ? stAfter.automationSteps[stAfter.currentStepIndex + 1]?.overlapMs ?? 0
              : 0;
          const tailMs = AUTOMATION_SPOTIFY_NEAR_END_MS + nextOv;
          const nowMs = Date.now();
          if (spotifyRemaining <= tailMs && nowMs >= automationNearEndCooldownUntil) {
            automationNearEndCooldownUntil = nowMs + 3500;
            window.dispatchEvent(
              new CustomEvent('radio-sankt:automation-spotify-near-end', {
                detail: { stepIndex: st.currentStepIndex },
              }),
            );
          }
        }
        lastSpotifySeekSyncSample = state.track.id
          ? { trackId: state.track.id, position: state.progressMs, at: now }
          : null;
      }
    };

    setWebPlaybackDiag('initializing', null);
    void pickDevice();
    stateTimer = setInterval(pollState, STATE_POLL_MS);
    void pollState();

    const onBeforeUnload = () => {
      cancelled = true;
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      cancelled = true;
      if (discoveryTimer) clearTimeout(discoveryTimer);
      if (stateTimer) clearInterval(stateTimer);
      cancelLiveRamp();
      lastSpotifySeekSyncSample = null;
      automationNearEndCooldownUntil = 0;
    };
  }, [
    token,
    setDeviceId,
    setDeviceName,
    setSdkReady,
    setIsPlaying,
    setCurrentTrack,
    setPosition,
    setDuration,
  ]);

  // ── Transport & automation event bus ───────────────────────────────────
  useEffect(() => {
    const onToggle = () => {
      void togglePlayback();
    };

    const onSdkPause = () => {
      const devId = deviceIdRef.current;
      if (!devId) return;
      void remotePause(devId).catch(() => {});
    };

    const onSdkResume = () => {
      const devId = deviceIdRef.current;
      if (!devId) return;
      void remoteResume(devId).catch(() => {});
    };

    const onLiveAudio = (e: Event) => {
      const detail = (e as CustomEvent<{ goingLive?: boolean; fadeMs?: number }>).detail;
      if (typeof detail?.fadeMs !== 'number' || typeof detail.goingLive !== 'boolean') return;
      const devId = deviceIdRef.current ?? cachedDiscoveredDeviceId;
      const { volume: curVolume } = useStore.getState();
      const vol = Math.max(0, Math.min(1, curVolume));
      if (!devId) {
        // No device: fall back to hard pause/resume so going live still silences music.
        if (detail.goingLive) {
          void remotePause('').catch(() => {});
        }
        return;
      }
      if (detail.goingLive) {
        rampRemoteSpotifyVolume(devId, Math.round(vol * 100), 0, detail.fadeMs);
      } else {
        rampRemoteSpotifyVolume(devId, 0, Math.round(vol * 100), detail.fadeMs);
      }
    };

    const onResumeAudioCtx = () => {
      const engine = AudioEngine.get();
      engine?.resumeContextIfNeeded();
    };

    window.addEventListener('radio-sankt:resume-audio-context', onResumeAudioCtx);
    window.addEventListener('radio-sankt:toggle-play', onToggle);
    window.addEventListener('radio-sankt:spotify-pause', onSdkPause);
    window.addEventListener('radio-sankt:spotify-resume', onSdkResume);
    window.addEventListener('radio-sankt:live-audio', onLiveAudio as EventListener);

    return () => {
      window.removeEventListener('radio-sankt:resume-audio-context', onResumeAudioCtx);
      window.removeEventListener('radio-sankt:toggle-play', onToggle);
      window.removeEventListener('radio-sankt:spotify-pause', onSdkPause);
      window.removeEventListener('radio-sankt:spotify-resume', onSdkResume);
      window.removeEventListener('radio-sankt:live-audio', onLiveAudio as EventListener);
      cancelLiveRamp();
    };
  }, [togglePlayback]);

  // ── Volume sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    // While live, Spotify device should stay silent; the live handler ramps volume on Live exit.
    if (isLive) return;
    // Skip volume sync while a fade ramp is in progress to avoid fighting the ramp.
    if (liveRampRaf !== null) return;
    const devId = deviceIdRef.current;
    if (!devId) return;
    const pct = Math.round(Math.max(0, Math.min(1, volume)) * 100);
    void remoteSetVolumePercent(pct, devId).catch(() => {});
  }, [volume, isLive]);

  // ── Transport imperative API ───────────────────────────────────────────
  const previousTrack = useCallback(async () => {
    if (useStore.getState().automationStatus !== 'stopped') {
      await AutomationEngine.getInstance().skipBackward();
      return;
    }
    const devId = deviceIdRef.current;
    if (!devId) return;
    try {
      await remotePrevious(devId);
    } catch {
      useStore.getState().addToast('Skip failed — check Spotify connection', 'error');
    }
  }, []);

  const nextTrack = useCallback(async () => {
    if (useStore.getState().automationStatus !== 'stopped') {
      await AutomationEngine.getInstance().skipForward();
      return;
    }
    const devId = deviceIdRef.current;
    if (!devId) return;
    try {
      await remoteNext(devId);
    } catch {
      useStore.getState().addToast('Skip failed — check Spotify connection', 'error');
    }
  }, []);

  const seek = useCallback(
    async (positionMs: number) => {
      const devId = deviceIdRef.current;
      if (!devId) return;
      const duration = useStore.getState().duration;
      if (duration <= 0) return;
      const maxSeek = Math.max(0, duration - 100);
      const clamped = Math.min(Math.max(0, Math.round(positionMs)), maxSeek);
      try {
        await remoteSeek(clamped, devId);
        setPosition(clamped);
        const st = useStore.getState();
        if (st.automationStatus === 'playing' || st.automationStatus === 'paused') {
          const cur = st.automationSteps[st.currentStepIndex];
          if (cur?.type === 'track') {
            window.dispatchEvent(
              new CustomEvent('radio-sankt:spotify-seek-sync', {
                detail: {
                  positionMs: clamped,
                  playbackUri: cur.spotifyUri,
                },
              }),
            );
          }

          // Update stepTimeRemaining when seeking while automation is paused
          if (st.automationStatus === 'paused') {
            if (cur && (cur.type === 'track' || cur.type === 'playlist')) {
              const stepDurationMs = (cur as { durationMs: number }).durationMs;
              if (stepDurationMs) {
                st.setStepTimeRemaining(Math.max(0, stepDurationMs - clamped));
              }
            }
          }
        }
      } catch {
        useStore.getState().addToast('Skip failed — check Spotify connection', 'error');
      }
    },
    [setPosition],
  );

  return {
    player: null,
    togglePlay: togglePlayback,
    previousTrack,
    nextTrack,
    seek,
  };
}
