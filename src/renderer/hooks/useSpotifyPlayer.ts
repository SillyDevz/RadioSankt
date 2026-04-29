import { useEffect, useRef, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { useStore } from '@/store';
import AudioEngine from '@/engine/AudioEngine';
import AutomationEngine from '@/engine/AutomationEngine';
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

/** Minimum gap between Spotify `/me/player/volume` calls during a ramp (API rate-limits). */
const VOLUME_RAMP_MIN_CALL_INTERVAL_MS = 120;

let liveRampRaf: number | null = null;
let liveRampLastSent: { at: number; value: number } | null = null;
let lastSpotifySeekSyncSample:
  | { trackId: string; position: number; at: number }
  | null = null;

/** Keeps last track info so we can restore display if Spotify returns a transient null. */
let cachedDiscoveredDeviceId: string | null = null;

/** Track URI Spotify was reporting the last time we sampled while the current automation
 *  step was a playlist. Used to detect intra-playlist track advances (so dynamic breaks
 *  can fire between songs inside a playlist block, not only when the whole block ends). */
let lastPlaylistTrackUriSample: { stepId: string; trackUri: string } | null = null;

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

  const togglePlayback = useCallback(async () => {
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

    if (isPlaying) {
      if (automationStatus === 'playing') await engine.pause();
      else window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause'));
      return;
    }

    if (automationStatus === 'paused') await engine.play();
    else window.dispatchEvent(new CustomEvent('radio-sankt:spotify-resume'));
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
      try {
        const state = await getRemotePlaybackState();
        if (cancelled) return;
        if (!state) {
          // Transient null — Spotify sometimes returns 204 between tracks. Don't wipe UI state.
          return;
        }

        setIsPlaying(state.isPlaying);

        if (state.deviceId && state.deviceId !== deviceIdRef.current) {
          setDeviceId(state.deviceId);
          if (state.deviceName) setDeviceName(state.deviceName);
          setSdkReady(true);
        }

        if (state.track) {
          setCurrentTrack({
            id: state.track.id ?? state.track.uri,
            title: state.track.name,
            artist: state.track.artists,
            album: state.track.albumName,
            albumArt: state.track.albumArt,
            duration: state.track.durationMs,
            uri: state.track.uri,
          });
          setDuration(state.track.durationMs);
          setPosition(state.progressMs);

          const st = useStore.getState();
          const curStep = st.automationSteps[st.currentStepIndex];
          const playbackMatchesStep =
            !!curStep &&
            ((curStep.type === 'track' && curStep.spotifyUri === state.track.uri) ||
              (curStep.type === 'playlist' && curStep.spotifyPlaylistUri === state.contextUri));

          const prevSample = lastSpotifySeekSyncSample;
          const now = Date.now();

          // Intra-playlist advance: when the active step is a playlist block and the
          // underlying Spotify track URI changes, let the automation engine run its
          // break-rule logic between songs (not only when the block ends).
          if (
            curStep &&
            curStep.type === 'playlist' &&
            state.contextUri === curStep.spotifyPlaylistUri &&
            st.automationStatus === 'playing' &&
            state.track.uri
          ) {
            if (
              lastPlaylistTrackUriSample &&
              lastPlaylistTrackUriSample.stepId === curStep.id &&
              lastPlaylistTrackUriSample.trackUri !== state.track.uri
            ) {
              window.dispatchEvent(
                new CustomEvent('radio-sankt:spotify-playlist-track-changed', {
                  detail: {
                    stepId: curStep.id,
                    previousTrackUri: lastPlaylistTrackUriSample.trackUri,
                    newTrackUri: state.track.uri,
                    newTrackDurationMs: state.track.durationMs,
                  },
                }),
              );
            }
            lastPlaylistTrackUriSample = { stepId: curStep.id, trackUri: state.track.uri };
          } else if (!curStep || curStep.type !== 'playlist') {
            lastPlaylistTrackUriSample = null;
          }

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
            if (deviation > SEEK_DEVIATION_THRESHOLD_MS) {
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
          lastSpotifySeekSyncSample = state.track.id
            ? { trackId: state.track.id, position: state.progressMs, at: now }
            : null;
        }
      } catch {
        /* transient network errors are fine; next tick will retry */
      }
    };

    setWebPlaybackDiag('initializing', null);
    void pickDevice();
    stateTimer = setInterval(pollState, STATE_POLL_MS);
    void pollState();

    return () => {
      cancelled = true;
      if (discoveryTimer) clearTimeout(discoveryTimer);
      if (stateTimer) clearInterval(stateTimer);
      cancelLiveRamp();
      lastSpotifySeekSyncSample = null;
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
    const devId = deviceIdRef.current;
    if (!devId) return;
    // While live, Spotify device should stay silent; the live handler ramps volume on Live exit.
    if (isLive) return;
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
      /* ignore */
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
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onPrev = () => {
      void previousTrack();
    };
    const onNext = () => {
      void nextTrack();
    };
    window.addEventListener('radio-sankt:previous-track', onPrev);
    window.addEventListener('radio-sankt:next-track', onNext);
    return () => {
      window.removeEventListener('radio-sankt:previous-track', onPrev);
      window.removeEventListener('radio-sankt:next-track', onNext);
    };
  }, [previousTrack, nextTrack]);

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
        if (st.automationStatus === 'playing') {
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
        }
      } catch {
        /* ignore */
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
