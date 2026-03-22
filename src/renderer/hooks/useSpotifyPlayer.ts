import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store';
import AudioEngine from '@/engine/AudioEngine';

let sourceNode: MediaElementAudioSourceNode | null = null;

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
    positionInterval.current = setInterval(async () => {
      const player = playerRef.current;
      if (!player) return;
      const state = await player.getCurrentState();
      if (state && !state.paused) {
        setPosition(state.position);
      }
    }, 500);
  }, [clearPositionTracking, setPosition]);

  // Route audio through Web Audio API
  const connectWebAudio = useCallback((player: SpotifyPlayer) => {
    // Find the SDK's audio element
    const playerId = player._options?.id;
    if (!playerId) return;

    // The SDK creates an audio element we can tap into
    const tryConnect = () => {
      const audioEl = document.querySelector(`audio[data-testid="audio-element"]`) as HTMLAudioElement
        || document.querySelector('audio') as HTMLAudioElement;

      if (!audioEl) {
        // Retry briefly - SDK may not have created it yet
        setTimeout(tryConnect, 500);
        return;
      }

      if (sourceNode) return; // Already connected

      try {
        const engine = AudioEngine.init(new AudioContext());
        const ctx = engine.getContext();

        sourceNode = ctx.createMediaElementSource(audioEl);
        sourceNode.connect(engine.getGainNode('A'));
        engine.setVolume('A', useStore.getState().volume);
      } catch {
        // May fail if already connected - that's fine
      }
    };

    tryConnect();
  }, []);

  // Load SDK script
  useEffect(() => {
    if (document.getElementById('spotify-sdk-script')) return;

    const script = document.createElement('script');
    script.id = 'spotify-sdk-script';
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  // Initialize player when token is available
  useEffect(() => {
    if (!token) return;

    const initPlayer = () => {
      if (playerRef.current) {
        playerRef.current.disconnect();
      }

      const player = new window.Spotify.Player({
        name: 'Radio Sankt',
        getOAuthToken: (cb) => {
          // Always get fresh token
          window.electronAPI.getSpotifyToken().then((t) => {
            cb(t || token);
          }).catch(() => cb(token));
        },
        volume: volume,
      });

      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        setDeviceId(device_id);
        setSdkReady(true);
        connectWebAudio(player);
        addToast('Spotify player ready', 'success');
      });

      player.addListener('not_ready', () => {
        setSdkReady(false);
        setDeviceId(null);
      });

      player.addListener('player_state_changed', (state: SpotifyPlaybackState | null) => {
        if (!state) {
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

      player.addListener('initialization_error', ({ message }: { message: string }) => {
        addToast(`Spotify init error: ${message}`, 'error');
      });

      player.addListener('authentication_error', ({ message }: { message: string }) => {
        addToast(`Spotify auth error: ${message}`, 'error');
      });

      player.addListener('account_error', ({ message }: { message: string }) => {
        addToast(`Spotify account error: ${message}`, 'error');
      });

      player.connect();
      playerRef.current = player;
    };

    if (window.Spotify) {
      initPlayer();
    } else {
      window.onSpotifyWebPlaybackSDKReady = initPlayer;
    }

    return () => {
      clearPositionTracking();
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for keyboard shortcut events
  useEffect(() => {
    const onToggle = () => { playerRef.current?.togglePlay(); };
    const onPrev = () => { playerRef.current?.previousTrack(); };
    const onNext = () => { playerRef.current?.nextTrack(); };

    window.addEventListener('radio-sankt:toggle-play', onToggle);
    window.addEventListener('radio-sankt:previous-track', onPrev);
    window.addEventListener('radio-sankt:next-track', onNext);

    return () => {
      window.removeEventListener('radio-sankt:toggle-play', onToggle);
      window.removeEventListener('radio-sankt:previous-track', onPrev);
      window.removeEventListener('radio-sankt:next-track', onNext);
    };
  }, []);

  // Sync volume to gain node
  useEffect(() => {
    const engine = AudioEngine.get();
    if (engine) {
      engine.setVolume('A', volume);
    }
    playerRef.current?.setVolume(volume).catch(() => {});
  }, [volume]);

  const togglePlay = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    await player.togglePlay();
  }, []);

  const previousTrack = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    await player.previousTrack();
  }, []);

  const nextTrack = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    await player.nextTrack();
  }, []);

  const seek = useCallback(async (positionMs: number) => {
    const player = playerRef.current;
    if (!player) return;
    await player.seek(positionMs);
    setPosition(positionMs);
  }, [setPosition]);

  return {
    player: playerRef.current,
    togglePlay,
    previousTrack,
    nextTrack,
    seek,
  };
}
