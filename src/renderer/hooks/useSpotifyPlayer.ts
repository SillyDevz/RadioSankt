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
const DEVICE_DISCOVERY_POLL_MS = 4000;

let liveRampRaf: number | null = null;
let lastSpotifySeekSyncSample: { trackId: string; position: number } | null = null;

function cancelLiveRamp() {
  if (liveRampRaf !== null) {
    cancelAnimationFrame(liveRampRaf);
    liveRampRaf = null;
  }
}

function rampRemoteSpotifyVolume(deviceId: string, fromPct: number, toPct: number, durationMs: number) {
  cancelLiveRamp();
  const start = performance.now();
  let lastSent = -1;
  const tick = () => {
    const t = durationMs <= 0 ? 1 : Math.min(1, (performance.now() - start) / durationMs);
    const v = Math.round(fromPct + (toPct - fromPct) * t);
    // Throttle: Spotify volume endpoint rate-limits; only send on meaningful change.
    if (v !== lastSent) {
      lastSent = v;
      void remoteSetVolumePercent(v, deviceId).catch(() => {});
    }
    liveRampRaf = t < 1 ? requestAnimationFrame(tick) : null;
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
    setSdkReady,
    setIsPlaying,
    setCurrentTrack,
    setPosition,
    setDuration,
    addToast,
  } = useStore(
    (s) => ({
      token: s.token,
      volume: s.volume,
      isLive: s.isLive,
      deviceId: s.deviceId,
      setDeviceId: s.setDeviceId,
      setSdkReady: s.setSdkReady,
      setIsPlaying: s.setIsPlaying,
      setCurrentTrack: s.setCurrentTrack,
      setPosition: s.setPosition,
      setDuration: s.setDuration,
      addToast: s.addToast,
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
      else window.dispatchEvent(new CustomEvent('radio-sankt:spotify-pause-sdk'));
      return;
    }

    if (automationStatus === 'paused') await engine.play();
    else window.dispatchEvent(new CustomEvent('radio-sankt:spotify-resume-sdk'));
  }, []);

  // ── Device discovery + state poll ─────────────────────────────────────
  useEffect(() => {
    const { setWebPlaybackDiag } = useStore.getState();

    if (!token) {
      setWebPlaybackDiag('idle', null);
      setSdkReady(false);
      setDeviceId(null);
      setIsPlaying(false);
      setCurrentTrack(null);
      setPosition(0);
      setDuration(0);
      return;
    }

    let cancelled = false;
    let discoveryTimer: ReturnType<typeof setTimeout> | null = null;
    let stateTimer: ReturnType<typeof setInterval> | null = null;
    let noDeviceToastAt = 0;

    const pickDevice = async () => {
      if (cancelled) return;
      try {
        const devices = await listSpotifyDevices();
        if (cancelled) return;
        const picked = pickPreferredDevice(devices);
        if (picked) {
          if (deviceIdRef.current !== picked.id) {
            setDeviceId(picked.id);
            setSdkReady(true);
            setWebPlaybackDiag('ready', null);
          }
          // If the picked device isn't active yet, transfer to it silently.
          if (!picked.is_active) {
            try {
              await transferPlaybackToDevice(picked.id);
            } catch {
              /* ignore; user may intervene */
            }
          }
        } else {
          setDeviceId(null);
          setSdkReady(false);
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
          setIsPlaying(false);
          return;
        }

        setIsPlaying(state.isPlaying);

        if (state.deviceId && state.deviceId !== deviceIdRef.current) {
          setDeviceId(state.deviceId);
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
          if (
            playbackMatchesStep &&
            st.automationStatus === 'playing' &&
            state.isPlaying &&
            state.track.id &&
            prevSample &&
            prevSample.trackId === state.track.id &&
            Math.abs(state.progressMs - prevSample.position) > 2500
          ) {
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
          lastSpotifySeekSyncSample = state.track.id
            ? { trackId: state.track.id, position: state.progressMs }
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
      const devId = deviceIdRef.current;
      const { volume: curVolume } = useStore.getState();
      const vol = Math.max(0, Math.min(1, curVolume));
      if (!devId) return;
      if (detail.goingLive) {
        rampRemoteSpotifyVolume(devId, Math.round(vol * 100), 0, detail.fadeMs);
      } else {
        rampRemoteSpotifyVolume(devId, 0, Math.round(vol * 100), detail.fadeMs);
      }
    };

    const onPrime = () => {
      const engine = AudioEngine.get();
      engine?.resumeContextIfNeeded();
    };

    window.addEventListener('radio-sankt:prime-spotify-playback', onPrime);
    window.addEventListener('radio-sankt:toggle-play', onToggle);
    window.addEventListener('radio-sankt:spotify-pause-sdk', onSdkPause);
    window.addEventListener('radio-sankt:spotify-resume-sdk', onSdkResume);
    window.addEventListener('radio-sankt:live-audio', onLiveAudio as EventListener);

    return () => {
      window.removeEventListener('radio-sankt:prime-spotify-playback', onPrime);
      window.removeEventListener('radio-sankt:toggle-play', onToggle);
      window.removeEventListener('radio-sankt:spotify-pause-sdk', onSdkPause);
      window.removeEventListener('radio-sankt:spotify-resume-sdk', onSdkResume);
      window.removeEventListener('radio-sankt:live-audio', onLiveAudio as EventListener);
      cancelLiveRamp();
    };
  }, [togglePlayback]);

  // ── Volume sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    const devId = deviceIdRef.current;
    if (!devId) return;
    // While live, Spotify channel should stay ducked to 0 unless the live handler raises it.
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
