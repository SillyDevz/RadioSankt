/**
 * Local audio mixer for jingles, ads, and cart-wall hot keys.
 *
 * Prior to the Spotify Connect migration this engine also mixed the Spotify
 * Web Playback SDK's `<audio>` element on a second channel. In Spotify
 * Connect mode Spotify audio is rendered by the Spotify desktop app itself,
 * so the engine only needs one channel now.
 */
class AudioEngine {
  private static instance: AudioEngine | null = null;

  private ctx: AudioContext;
  private masterGain: GainNode;

  private gain: GainNode;
  private cartGain: GainNode;
  private analyser: AnalyserNode;

  private preDuckVolume = 1;

  // Single-voice jingle playback (used by the automation engine).
  private jingleSource: AudioBufferSourceNode | null = null;
  private jingleBuffer: AudioBuffer | null = null;
  private jingleStartTime = 0;
  private jinglePlaying = false;
  private jingleOnEnded: (() => void) | null = null;

  /** Cart-wall polyphony: multiple buffer sources mix in concurrently. */
  private cartVoices = new Map<string, AudioBufferSourceNode>();

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.connect(ctx.destination);

    this.gain = ctx.createGain();
    this.cartGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.gain.connect(this.analyser);
    this.cartGain.connect(this.analyser);
    this.analyser.connect(this.masterGain);
  }

  static init(ctx: AudioContext): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine(ctx);
    }
    return AudioEngine.instance;
  }

  static get(): AudioEngine | null {
    return AudioEngine.instance;
  }

  static getOrInit(): AudioEngine {
    return AudioEngine.instance ?? AudioEngine.init(new AudioContext());
  }

  getContext(): AudioContext {
    return this.ctx;
  }

  /** Browsers / Electron may suspend the audio context until the user gestures. */
  resumeContextIfNeeded(): void {
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  // ── Volume / fades / ducking (single channel) ──────────────────────

  setVolume(value: number): void {
    this.gain.gain.value = value;
    this.preDuckVolume = value;
  }

  setCartVolume(value: number): void {
    this.cartGain.gain.value = value;
  }

  fadeIn(durationMs: number, targetGain = 1): Promise<void> {
    return new Promise((resolve) => {
      const now = this.ctx.currentTime;
      this.gain.gain.setValueAtTime(0, now);
      this.gain.gain.linearRampToValueAtTime(targetGain, now + durationMs / 1000);
      setTimeout(resolve, durationMs);
    });
  }

  fadeOut(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      const now = this.ctx.currentTime;
      this.gain.gain.setValueAtTime(this.gain.gain.value, now);
      this.gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
      setTimeout(resolve, durationMs);
    });
  }

  // ── Jingle playback ────────────────────────────────────────────────

  async playJingle(filePath: string): Promise<void> {
    this.stopJingle();

    const arrayBuffer = await window.electronAPI.readFileBuffer(filePath);
    this.jingleBuffer = await this.ctx.decodeAudioData(arrayBuffer);

    this.jingleSource = this.ctx.createBufferSource();
    this.jingleSource.buffer = this.jingleBuffer;
    this.jingleSource.connect(this.gain);

    this.jingleSource.onended = () => {
      this.jinglePlaying = false;
      this.jingleSource = null;
      this.jingleOnEnded?.();
      this.jingleOnEnded = null;
    };

    this.jingleStartTime = this.ctx.currentTime;
    this.jinglePlaying = true;
    this.jingleSource.start();
  }

  /** Extra cart voices; do not stop the automation jingle or other cart voices. */
  async playJingleVoice(filePath: string, onEnded?: () => void): Promise<{ id: string; durationMs: number }> {
    const arrayBuffer = await window.electronAPI.readFileBuffer(filePath);
    const buffer = await this.ctx.decodeAudioData(arrayBuffer);
    const id = crypto.randomUUID();
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.cartGain);
    source.onended = () => {
      this.cartVoices.delete(id);
      onEnded?.();
    };
    this.cartVoices.set(id, source);
    source.start();
    return { id, durationMs: buffer.duration * 1000 };
  }

  stopJingle(): void {
    if (this.jingleSource) {
      try {
        this.jingleSource.stop();
      } catch {
        // already stopped
      }
      this.jingleSource = null;
    }
    this.cartVoices.forEach((src) => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    });
    this.cartVoices.clear();
    this.jinglePlaying = false;
    this.jingleOnEnded = null;
  }

  stopCartVoices(): void {
    this.cartVoices.forEach((src) => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    });
    this.cartVoices.clear();
  }

  isJinglePlaying(): boolean {
    return this.jinglePlaying;
  }

  /** Must be called after `playJingle` has started — `playJingle` clears this via `stopJingle()` first. */
  onJingleEnded(cb: () => void): void {
    this.jingleOnEnded = cb;
  }

  getCurrentJingleDuration(): number {
    return this.jingleBuffer ? this.jingleBuffer.duration * 1000 : 0;
  }

  getCurrentJinglePosition(): number {
    if (!this.jinglePlaying) return 0;
    return (this.ctx.currentTime - this.jingleStartTime) * 1000;
  }
}

export default AudioEngine;
