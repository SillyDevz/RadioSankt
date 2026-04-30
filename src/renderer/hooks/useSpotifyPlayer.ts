import { useEffect, useRef, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { useStore } from '@/store';
import AudioEngine from '@/engine/AudioEngine';
import AutomationEngine from '@/engine/AutomationEngine';

let sourceNode: MediaElementAudioSourceNode | null = null;

let liveRampRaf: number | null = null;

function cancelLiveRamp() {
  if (liveRampRaf !== null) {
    cancelAnimationFrame(liveRampRaf);
    liveRampRaf = null;
  }
}

function rampSpotifyPlayerVolume(player: SpotifyPlayer, from: number, to: number, durationMs: number) {
  cancelLiveRamp();
  const start = performance.now();
  const tick = () => {
    const t = durationMs <= 0 ? 1 : Math.min(1, (performance.now() - start) / durationMs);
    const v = from + (to - from) * t;
    player.setVolume(Math.min(1, Math.max(0, v))).catch(() => {});
    liveRampRaf = t < 1 ? requestAnimationFrame(tick) : null;
  };
  liveRampRaf = requestAnimationFrame(tick);
}

/** Latest init from the token effect; called when sdk.scdn.co finishes loading. */
let pendingSpotifyPlayerInit: (() => void) | null = null;

/** Bumped on effect cleanup so late SDK events from a torn-down player are ignored (e.g. React Strict Mode). */
let webPlaybackSessionGen = 0;

/** Detect large `position` jumps (user seek) vs same-track playback for automation resync. */
let lastSpotifySeekSyncSample: { trackId: string; position: number } | null = null;

function triggerSpotifyPlayerInit() {
  pendingSpotifyPlayerInit?.();
}

export function useSpotifyPlayer() {
  const {
    token,
    volume,
    isLive,
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

  const playerRef = useRef<SpotifyPlayer | null>(null);
  const positionInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const toggleInFlight = useRef(false);
  const cancelWebAudioPoll = useRef<(() => void) | null>(null);

  const clearPositionTracking = useCallback(() => {
    if (positionInterval.current) {
      clearInterval(positionInterval.current);
      positionInterval.current = null;
    }
  }, []);

  const startPositionTracking = useCallback(() => {
    clearPositionTracking();
    positionInterval.current = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      player.getCurrentState().then((state) => {
        if (state && !state.paused) {
          setPosition(state.position);
        }
      }).catch(() => {});
    }, 500);
  }, [clearPositionTracking, setPosition]);

  /** Main transport: when a set is loaded, align with Spotify `isPlaying` so we never call `play()` while audio is still running (that re-executes the step and “restarts”). */
  const togglePlayback = useCallback(async () => {
    if (toggleInFlight.current) return;
    const { isLive } = useStore.getState();
    if (isLive) return;
    toggleInFlight.current = true;
    try {
      AudioEngine.get()?.resumeContextIfNeeded();
      void playerRef.current?.activateElement().catch(() => {});
      const player = playerRef.current;
      const { automationStatus, automationSteps, isPlaying } = useStore.getState();

      if (automationStatus === 'waitingAtPause') {
        await AutomationEngine.getInstance().resume();
        return;
      }

      if (!player || automationStatus === 'stopped' || automationSteps.length === 0) {
        if (player) await player.togglePlay().catch(() => {});
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
    } finally {
      toggleInFlight.current = false;
    }
  }, []);

  const connectWebAudio = useCallback((_player: SpotifyPlayer): (() => void) => {
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds total
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tryConnect = () => {
      if (cancelled) return;
      const audioEl = document.querySelector(`audio[data-testid="audio-element"]`) as HTMLAudioElement
        || document.querySelector('audio') as HTMLAudioElement;

      if (!audioEl) {
        attempts++;
        if (attempts < maxAttempts) {
          timeoutId = setTimeout(tryConnect, 500);
        }
        return;
      }

      if (sourceNode) return; // Already connected

      try {
        const engine = AudioEngine.init(new AudioContext());
        const ctx = engine.getContext();

        sourceNode = ctx.createMediaElementSource(audioEl);
        sourceNode.connect(engine.getGainNode('A'));
        const st = useStore.getState();
        engine.setVolume('A', st.isLive ? 0 : st.volume);
        engine.resumeContextIfNeeded();
      } catch {
        // May fail if already connected - that's fine
      }
    };

    tryConnect();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
  }, []);

  useEffect(() => {
    window.onSpotifyWebPlaybackSDKReady = triggerSpotifyPlayerInit;

    if (!document.getElementById('spotify-sdk-script')) {
      const script = document.createElement('script');
      script.id = 'spotify-sdk-script';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;

      script.onerror = () => {
        const { setWebPlaybackDiag, addToast } = useStore.getState();
        setWebPlaybackDiag('error', 'Failed to load Spotify SDK');
        addToast('Could not load Spotify SDK — check your internet connection.', 'error');
      };

      document.body.appendChild(script);

      setTimeout(() => {
        if (!window.Spotify) {
          const { webPlaybackPhase, setWebPlaybackDiag, addToast } = useStore.getState();
          if (webPlaybackPhase === 'loading_sdk') {
            setWebPlaybackDiag('error', 'Spotify SDK load timed out');
            addToast('Spotify SDK took too long to load.', 'error');
          }
        }
      }, 15000);
    }
  }, []);

  useEffect(() => {
    const { setWebPlaybackDiag } = useStore.getState();

    if (!token) {
      pendingSpotifyPlayerInit = null;
      setWebPlaybackDiag('idle', null);
      return;
    }

    const initPlayer = () => {
      if (!window.Spotify) return;
      const myGen = ++webPlaybackSessionGen;
      setWebPlaybackDiag('initializing', null);

      if (playerRef.current) {
        playerRef.current.disconnect();
      }

      const player = new window.Spotify.Player({
        name: 'Radio Sankt',
        getOAuthToken: (cb) => {
          window.electronAPI.getSpotifyToken().then(async (t) => {
            const refreshed = t || await window.electronAPI.refreshSpotifyToken();
            const tok = refreshed || useStore.getState().token;
            if (!tok) {
              console.error('[Spotify Web Playback] No access token for SDK');
            }
            cb(tok || '');
          }).catch(() => cb(useStore.getState().token || ''));
        },
        volume: volume,
      });

      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        if (myGen !== webPlaybackSessionGen) return;
        setDeviceId(device_id);
        setSdkReady(true);
        setWebPlaybackDiag('ready', null);
        cancelWebAudioPoll.current?.();
        cancelWebAudioPoll.current = connectWebAudio(player);
      });

      player.addListener('not_ready', () => {
        if (myGen !== webPlaybackSessionGen) return;
        setSdkReady(false);
        setDeviceId(null);
      });

      player.addListener('player_state_changed', (state: SpotifyPlaybackState | null) => {
        if (myGen !== webPlaybackSessionGen) return;
        if (!state) {
          setIsPlaying(false);
          clearPositionTracking();
          lastSpotifySeekSyncSample = null;
          const { automationStatus } = useStore.getState();
          if (automationStatus === 'playing' || automationStatus === 'paused') {
            AutomationEngine.getInstance().pause();
            addToast('Playback moved to another device — automation paused.', 'warning');
          }
          return;
        }

        const st = useStore.getState();
        if (state.paused && st.automationStatus === 'stopped') {
          setIsPlaying(false);
          clearPositionTracking();
          lastSpotifySeekSyncSample = null;
          return;
        }

        const track = state.track_window.current_track;
        const newPos = state.position;
        const curStep = st.automationSteps[st.currentStepIndex];
        const prevSample = lastSpotifySeekSyncSample;
        const playbackMatchesStep =
          !!curStep &&
          ((curStep.type === 'track' && curStep.spotifyUri === track.uri) ||
            (curStep.type === 'playlist' && curStep.spotifyPlaylistUri === state.context?.uri));
        if (
          playbackMatchesStep &&
          st.automationStatus === 'playing' &&
          !state.paused &&
          curStep &&
          (curStep.type === 'track' || curStep.type === 'playlist') &&
          prevSample &&
          prevSample.trackId === track.id &&
          Math.abs(newPos - prevSample.position) > 2000 &&
          // Ignore backward jumps (track ended and position reset to 0)
          newPos > prevSample.position
        ) {
          AutomationEngine.getInstance();
          window.dispatchEvent(
            new CustomEvent('radio-sankt:spotify-seek-sync', {
              detail: {
                positionMs: newPos,
                playbackUri: track.uri,
                contextUri: state.context?.uri,
              },
            }),
          );
        }
        lastSpotifySeekSyncSample = { trackId: track.id, position: newPos };

        setCurrentTrack({
          id: track.id,
          title: track.name,
          artist: track.artists.map((a) => a.name).join(', '),
          album: track.album.name,
          albumArt: track.album.images[0]?.url,
          duration: track.duration_ms,
          uri: track.uri,
        });

        setDuration(track.duration_ms);
        setPosition(newPos);
        setIsPlaying(!state.paused);

        if (!state.paused) {
          startPositionTracking();
        } else {
          clearPositionTracking();
          lastSpotifySeekSyncSample = null;
        }
      });

      const reportSdkError = (label: string, message: string) => {
        if (myGen !== webPlaybackSessionGen) return;
        const full = `${label}: ${message}`;
        console.error('[Spotify Web Playback]', full);
        setWebPlaybackDiag('error', full);
        addToast(full, 'error');
      };

      player.addListener('initialization_error', ({ message }: { message: string }) => {
        reportSdkError('initialization_error', message);
      });

      player.addListener('authentication_error', ({ message }: { message: string }) => {
        if (myGen !== webPlaybackSessionGen) return;
        console.warn('[Spotify Web Playback] authentication_error — refreshing token and reconnecting', message);
        window.electronAPI.refreshSpotifyToken().then(async (t) => {
          if (myGen !== webPlaybackSessionGen) return;
          if (t) useStore.setState({ token: t });
          try {
            player.disconnect();
            const ok = await player.connect();
            if (!ok) reportSdkError('authentication_error', message);
          } catch {
            reportSdkError('authentication_error', message);
          }
        }).catch(() => reportSdkError('authentication_error', message));
      });

      player.addListener('account_error', ({ message }: { message: string }) => {
        reportSdkError('account_error', message);
        AutomationEngine.getInstance().stop();
        setSdkReady(false);
        setDeviceId(null);
        player.disconnect();
      });

      let lastPlaybackErrorToast = 0;
      player.addListener('playback_error', (d: { message: string }) => {
        if (myGen !== webPlaybackSessionGen) return;
        console.warn('[Spotify Web Playback] playback_error', d);
        setWebPlaybackDiag('error', d.message);
        const now = Date.now();
        if (now - lastPlaybackErrorToast > 20_000) {
          lastPlaybackErrorToast = now;
          addToast(`Playback interrupted: ${d.message}`, 'warning');
        }
      });

      setWebPlaybackDiag('connecting', null);
      player
        .connect()
        .then((connected) => {
          if (myGen !== webPlaybackSessionGen) return;
          if (!connected) {
            const msg =
              'player.connect() returned false — Widevine/DRM blocked or unsigned Electron build. Run: npm run evs:sign-electron-dist, restart, then reconnect Spotify (see docs/widevine-and-evs.md).';
            console.error('[Spotify Web Playback]', msg);
            setWebPlaybackDiag('error', msg);
            addToast(msg, 'error');
          }
        })
        .catch((err: unknown) => {
          if (myGen !== webPlaybackSessionGen) return;
          const msg = `connect failed: ${err}`;
          console.error('[Spotify Web Playback]', msg);
          setWebPlaybackDiag('error', msg);
          addToast(`Spotify ${msg}`, 'error');
        });
      playerRef.current = player;
    };

    if (!window.Spotify) {
      setWebPlaybackDiag('loading_sdk', null);
    }
    pendingSpotifyPlayerInit = initPlayer;
    if (window.Spotify) initPlayer();

    const onBeforeUnload = () => {
      playerRef.current?.disconnect();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      webPlaybackSessionGen++;
      lastSpotifySeekSyncSample = null;
      pendingSpotifyPlayerInit = null;
      clearPositionTracking();
      cancelLiveRamp();
      cancelWebAudioPoll.current?.();
      cancelWebAudioPoll.current = null;
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
      if (sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
      }
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const prime = () => {
      const engine = AudioEngine.get();
      engine?.resumeContextIfNeeded();
      playerRef.current?.activateElement().catch(() => {});
    };

    const onLiveAudio = (e: Event) => {
      const detail = (e as CustomEvent<{ goingLive?: boolean; fadeMs?: number }>).detail;
      if (typeof detail?.fadeMs !== 'number' || typeof detail.goingLive !== 'boolean') return;
      const { goingLive, fadeMs } = detail;
      const player = playerRef.current;
      const engine = AudioEngine.getOrInit();
      const vol = useStore.getState().volume;
      engine.resumeContextIfNeeded();
      cancelLiveRamp();
      if (goingLive) {
        void engine.fadeOut('A', fadeMs);
        if (player && !sourceNode) {
          rampSpotifyPlayerVolume(player, vol, 0, fadeMs);
        }
      } else {
        void engine.fadeIn('A', fadeMs, vol);
        if (player && !sourceNode) {
          rampSpotifyPlayerVolume(player, 0, vol, fadeMs);
        } else if (player) {
          player.setVolume(vol).catch(() => {});
        }
      }
    };

    const onToggle = () => {
      void togglePlayback();
    };

    const onSdkPause = () => {
      void playerRef.current?.pause().catch(() => {});
    };

    const onSdkResume = () => {
      void playerRef.current?.resume().catch(() => {});
    };

    window.addEventListener('radio-sankt:prime-spotify-playback', prime);
    window.addEventListener('radio-sankt:toggle-play', onToggle);
    window.addEventListener('radio-sankt:spotify-pause-sdk', onSdkPause);
    window.addEventListener('radio-sankt:spotify-resume-sdk', onSdkResume);
    window.addEventListener('radio-sankt:live-audio', onLiveAudio as EventListener);

    return () => {
      window.removeEventListener('radio-sankt:prime-spotify-playback', prime);
      window.removeEventListener('radio-sankt:toggle-play', onToggle);
      window.removeEventListener('radio-sankt:spotify-pause-sdk', onSdkPause);
      window.removeEventListener('radio-sankt:spotify-resume-sdk', onSdkResume);
      window.removeEventListener('radio-sankt:live-audio', onLiveAudio as EventListener);
      cancelLiveRamp();
    };
  }, [togglePlayback]);

  // Sync volume to gain node (channel A stays ducked while live; fade/live handler owns gain)
  useEffect(() => {
    if (isLive) return;
    const engine = AudioEngine.get();
    if (engine) {
      if (!engine.isFading?.('A')) {
        engine.setVolume('A', volume);
      }
    }
    playerRef.current?.setVolume(volume).catch(() => {});
  }, [volume, isLive]);

  const previousTrack = useCallback(async () => {
    if (useStore.getState().automationStatus !== 'stopped') {
      await AutomationEngine.getInstance().skipBackward();
      return;
    }
    const player = playerRef.current;
    if (!player) return;
    try { await player.previousTrack(); } catch { /* SDK disconnected */ }
  }, []);

  const nextTrack = useCallback(async () => {
    if (useStore.getState().automationStatus !== 'stopped') {
      await AutomationEngine.getInstance().skipForward();
      return;
    }
    const player = playerRef.current;
    if (!player) return;
    try { await player.nextTrack(); } catch { /* SDK disconnected */ }
  }, []);

  useEffect(() => {
    const prime = () => {
      AudioEngine.get()?.resumeContextIfNeeded();
      playerRef.current?.activateElement().catch(() => {});
    };
    const onPrev = () => {
      prime();
      void previousTrack();
    };
    const onNext = () => {
      prime();
      void nextTrack();
    };
    window.addEventListener('radio-sankt:previous-track', onPrev);
    window.addEventListener('radio-sankt:next-track', onNext);
    return () => {
      window.removeEventListener('radio-sankt:previous-track', onPrev);
      window.removeEventListener('radio-sankt:next-track', onNext);
    };
  }, [previousTrack, nextTrack]);

  const seek = useCallback(async (positionMs: number) => {
    const player = playerRef.current;
    if (!player) return;
    const duration = useStore.getState().duration;
    if (duration <= 0) return;
    // Spotify rejects seeks at/ past full duration; leave a tiny margin so "jump to end" works for testing.
    const maxSeek = Math.max(0, duration - 100);
    const clamped = Math.min(Math.max(0, Math.round(positionMs)), maxSeek);
    try {
      await player.seek(clamped);
      setPosition(clamped);
      const st = useStore.getState();
      const step = st.automationSteps[st.currentStepIndex];
      const sdkState = await player.getCurrentState();
      const uri = sdkState?.track_window?.current_track?.uri;
      const ctx = sdkState?.context?.uri;
      if (
        st.automationStatus === 'playing' &&
        sdkState &&
        !sdkState.paused &&
        step &&
        ((step.type === 'track' && uri === step.spotifyUri) ||
          (step.type === 'playlist' && ctx === step.spotifyPlaylistUri))
      ) {
        AutomationEngine.getInstance();
        window.dispatchEvent(
          new CustomEvent('radio-sankt:spotify-seek-sync', {
            detail: { positionMs: clamped, playbackUri: uri, contextUri: ctx },
          }),
        );
      }

      // Update stepTimeRemaining when seeking while automation is paused
      if (st.automationStatus === 'paused') {
        if (step && (step.type === 'track' || step.type === 'playlist')) {
          const durationMs = (step as { durationMs: number }).durationMs;
          if (durationMs) {
            st.setStepTimeRemaining(Math.max(0, durationMs - clamped));
          }
        }
      }
    } catch { /* SDK disconnected */ }
  }, [setPosition]);

  return {
    player: playerRef.current,
    togglePlay: togglePlayback,
    previousTrack,
    nextTrack,
    seek,
  };
}
