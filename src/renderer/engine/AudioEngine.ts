type Channel = 'A' | 'B';

class AudioEngine {
  private static instance: AudioEngine | null = null;

  private ctx: AudioContext;
  private masterGain: GainNode;

  private gainA: GainNode;
  private gainB: GainNode;
  private analyserA: AnalyserNode;
  private analyserB: AnalyserNode;

  private preDuckVolume: Record<Channel, number> = { A: 1, B: 1 };

  // Jingle playback state
  private jingleSource: AudioBufferSourceNode | null = null;
  private jingleBuffer: AudioBuffer | null = null;
  private jingleStartTime = 0;
  private jinglePlaying = false;
  private jingleOnEnded: (() => void) | null = null;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.connect(ctx.destination);

    // Channel A (Spotify)
    this.gainA = ctx.createGain();
    this.analyserA = ctx.createAnalyser();
    this.analyserA.fftSize = 256;
    this.gainA.connect(this.analyserA);
    this.analyserA.connect(this.masterGain);

    // Channel B (Jingles)
    this.gainB = ctx.createGain();
    this.analyserB = ctx.createAnalyser();
    this.analyserB.fftSize = 256;
    this.gainB.connect(this.analyserB);
    this.analyserB.connect(this.masterGain);
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

  getContext(): AudioContext {
    return this.ctx;
  }

  getGainNode(channel: Channel): GainNode {
    return channel === 'A' ? this.gainA : this.gainB;
  }

  // ── Volume ──────────────────────────────────────────────────────────

  setVolume(channel: Channel, value: number): void {
    const gain = this.getGainNode(channel);
    gain.gain.value = value;
    this.preDuckVolume[channel] = value;
  }

  // ── Fades ───────────────────────────────────────────────────────────

  fadeIn(channel: Channel, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      const gain = this.getGainNode(channel);
      const now = this.ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + durationMs / 1000);
      setTimeout(resolve, durationMs);
    });
  }

  fadeOut(channel: Channel, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      const gain = this.getGainNode(channel);
      const now = this.ctx.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
      setTimeout(resolve, durationMs);
    });
  }

  crossfade(from: Channel, to: Channel, durationMs: number): Promise<void> {
    return Promise.all([
      this.fadeOut(from, durationMs),
      this.fadeIn(to, durationMs),
    ]).then(() => {});
  }

  // ── Ducking ─────────────────────────────────────────────────────────

  duck(channel: Channel, targetVolume: number, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      const gain = this.getGainNode(channel);
      this.preDuckVolume[channel] = gain.gain.value;
      const now = this.ctx.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(targetVolume, now + durationMs / 1000);
      setTimeout(resolve, durationMs);
    });
  }

  unduck(channel: Channel, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      const gain = this.getGainNode(channel);
      const now = this.ctx.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(this.preDuckVolume[channel], now + durationMs / 1000);
      setTimeout(resolve, durationMs);
    });
  }

  // ── Levels ──────────────────────────────────────────────────────────

  getLevel(channel: Channel): number {
    const analyser = channel === 'A' ? this.analyserA : this.analyserB;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }

  // ── Jingle playback ────────────────────────────────────────────────

  async playJingle(filePath: string): Promise<void> {
    this.stopJingle();

    const arrayBuffer = await window.electronAPI.readFileBuffer(filePath);
    this.jingleBuffer = await this.ctx.decodeAudioData(arrayBuffer);

    this.jingleSource = this.ctx.createBufferSource();
    this.jingleSource.buffer = this.jingleBuffer;
    this.jingleSource.connect(this.gainB);

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

  stopJingle(): void {
    if (this.jingleSource) {
      try {
        this.jingleSource.stop();
      } catch {
        // already stopped
      }
      this.jingleSource = null;
    }
    this.jinglePlaying = false;
    this.jingleOnEnded = null;
  }

  isJinglePlaying(): boolean {
    return this.jinglePlaying;
  }

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
