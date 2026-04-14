import { useEffect, useRef, useCallback } from 'react';
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

function triggerSpotifyPlayerInit() {
  pendingSpotifyPlayerInit?.();
}

export function useSpotifyPlayer() {
  const token = useStore((s) => s.token);
  const volume = useStore((s) => s.volume);
  const setDeviceId = useStore((s) => s.setDeviceId);
  const setSdkReady = useStore((s) => s.setSdkReady);
  const setIsPlaying = useStore((s) => s.setIsPlaying);
  const setCurrentTrack = useStore((s) => s.setCurrentTrack);
  const setPosition = useStore((s) => s.setPosition);
  const setDuration = useStore((s) => s.setDuration);
  const addToast = useStore((s) => s.addToast);

  const playerRef = useRef<SpotifyPlayer | null>(null);
  const positionInterval = useRef<ReturnType<typeof setInterval> | null>(null);

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
  }, []);

  const connectWebAudio = useCallback((_player: SpotifyPlayer) => {
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds total

    const tryConnect = () => {
      const audioEl = document.querySelector(`audio[data-testid="audio-element"]`) as HTMLAudioElement
        || document.querySelector('audio') as HTMLAudioElement;

      if (!audioEl) {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(tryConnect, 500);
        }
        return;
      }

      if (sourceNode) return; // Already connected

      try {
        const engine = AudioEngine.init(new AudioContext());
        const ctx = engine.getContext();

        sourceNode = ctx.createMediaElementSource(audioEl);
        sourceNode.connect(engine.getGainNode('A'));
        engine.setVolume('A', useStore.getState().volume);
        engine.resumeContextIfNeeded();
      } catch {
        // May fail if already connected - that's fine
      }
    };

    tryConnect();
  }, []);

  useEffect(() => {
    window.onSpotifyWebPlaybackSDKReady = triggerSpotifyPlayerInit;

    if (!document.getElementById('spotify-sdk-script')) {
      const script = document.createElement('script');
      script.id = 'spotify-sdk-script';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      document.body.appendChild(script);
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
        connectWebAudio(player);
        addToast('Spotify player ready', 'success');
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
          return;
        }

        const st = useStore.getState();
        if (state.paused && st.automationStatus === 'stopped') {
          setIsPlaying(false);
          clearPositionTracking();
          return;
        }

        const track = state.track_window.current_track;
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
        setPosition(state.position);
        setIsPlaying(!state.paused);

        if (!state.paused) {
          startPositionTracking();
        } else {
          clearPositionTracking();
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

    return () => {
      webPlaybackSessionGen++;
      pendingSpotifyPlayerInit = null;
      clearPositionTracking();
      cancelLiveRamp();
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
      sourceNode = null;
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
        if (!sourceNode && player) {
          rampSpotifyPlayerVolume(player, vol, 0, fadeMs);
        } else if (player) {
          player.setVolume(vol).catch(() => {});
        }
      } else {
        void engine.fadeIn('A', fadeMs, vol);
        if (!sourceNode && player) {
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

  // Sync volume to gain node
  useEffect(() => {
    const engine = AudioEngine.get();
    if (engine) {
      engine.setVolume('A', volume);
    }
    playerRef.current?.setVolume(volume).catch(() => {});
  }, [volume]);

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
