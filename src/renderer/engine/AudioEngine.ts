/**
 * Local audio mixer for jingles, ads, and cart-wall hot keys.
 *
 * Prior to the Spotify Connect migration this engine also mixed the Spotify
 * Web Playback SDK's `<audio>` element on a second channel. In Spotify
 * Connect mode Spotify audio is rendered by the Spotify desktop app itself,
 * so the engine only needs one channel now.
 */

type Channel = 'A' | 'B';

class AudioEngine {
  private static instance: AudioEngine | null = null;

  private ctx: AudioContext;
  private masterGain: GainNode;

  private gainA: GainNode;
  private gainB: GainNode;
  private cartGain: GainNode;
  private analyserA: AnalyserNode;
  private analyserB: AnalyserNode;

  private preDuckVolume: Record<Channel, number> = { A: 1, B: 1 };
  private ducked: Record<Channel, boolean> = { A: false, B: false };
  private fadeGeneration: Record<Channel, number> = { A: 0, B: 0 };
  private fadingChannels: Record<Channel, boolean> = { A: false, B: false };

  // Single-voice jingle playback (used by the automation engine).
  private jingleSource: AudioBufferSourceNode | null = null;
  private jingleBuffer: AudioBuffer | null = null;
  private jingleStartTime = 0;
  private jinglePlaying = false;
  private jingleOnEnded: (() => void) | null = null;
  private jingleGeneration = 0;

  /** Cart-wall polyphony: multiple buffer sources mix in concurrently. */
  private cartVoices = new Map<string, AudioBufferSourceNode>();

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

    // Cart wall — bypasses gainB so automation fades/crossfades don't affect cart voices
    this.cartGain = ctx.createGain();
    this.cartGain.connect(this.masterGain);
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

  /** Spotify routes through this graph; browsers/Electron may suspend the context until resumed. */
  async resumeContextIfNeeded(): Promise<void> {
    if ((this.ctx.state as string) !== 'running') {
      await this.ctx.resume();
      if ((this.ctx.state as string) !== 'running') {
        await new Promise((r) => setTimeout(r, 100));
        await this.ctx.resume();
      }
    }
  }

  // ── Volume ──────────────────────────────────────────────────────────

  private getGainNode(channel: Channel): GainNode {
    return channel === 'A' ? this.gainA : this.gainB;
  }

  setVolume(channel: Channel, value: number): void {
    const gain = this.getGainNode(channel);
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(value, now);
    this.preDuckVolume[channel] = value;
    this.ducked[channel] = false;
    this.fadeGeneration[channel]++;
    this.fadingChannels[channel] = false;
  }

  setCartVolume(value: number): void {
    const now = this.ctx.currentTime;
    this.cartGain.gain.cancelScheduledValues(now);
    this.cartGain.gain.setValueAtTime(value, now);
  }

  fadeIn(channel: Channel, durationMs: number, targetGain = 1): Promise<void> {
    return new Promise((resolve) => {
      const gen = ++this.fadeGeneration[channel];
      this.fadingChannels[channel] = true;
      const gain = this.getGainNode(channel);
      const now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(targetGain, now + durationMs / 1000);
      setTimeout(() => {
        if (this.fadeGeneration[channel] === gen) {
          this.fadingChannels[channel] = false;
        }
        resolve();
      }, durationMs);
    });
  }

  fadeOut(channel: Channel, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.ducked[channel] = false;
      const gen = ++this.fadeGeneration[channel];
      this.fadingChannels[channel] = true;
      const gain = this.getGainNode(channel);
      const now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
      setTimeout(() => {
        if (this.fadeGeneration[channel] === gen) {
          this.fadingChannels[channel] = false;
        }
        resolve();
      }, durationMs);
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
      const gen = ++this.fadeGeneration[channel];
      this.fadingChannels[channel] = true;
      const gain = this.getGainNode(channel);
      if (!this.ducked[channel]) {
        this.preDuckVolume[channel] = gain.gain.value;
        this.ducked[channel] = true;
      }
      const now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(targetVolume, now + durationMs / 1000);
      setTimeout(() => {
        if (this.fadeGeneration[channel] === gen) {
          this.fadingChannels[channel] = false;
        }
        resolve();
      }, durationMs);
    });
  }

  unduck(channel: Channel, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      const gen = ++this.fadeGeneration[channel];
      this.fadingChannels[channel] = true;
      const gain = this.getGainNode(channel);
      const now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(this.preDuckVolume[channel], now + durationMs / 1000);
      this.ducked[channel] = false;
      setTimeout(() => {
        if (this.fadeGeneration[channel] === gen) {
          this.fadingChannels[channel] = false;
        }
        resolve();
      }, durationMs);
    });
  }

  // ── Levels ──────────────────────────────────────────────────────────

  isFading(channel: Channel): boolean {
    return this.fadingChannels[channel];
  }

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
    await this.resumeContextIfNeeded();
    this.stopJingle();
    const gen = ++this.jingleGeneration;

    const arrayBuffer = await window.electronAPI.readFileBuffer(filePath);
    if (gen !== this.jingleGeneration) return;

    this.jingleBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    if (gen !== this.jingleGeneration) return;

    this.jingleSource = this.ctx.createBufferSource();
    this.jingleSource.buffer = this.jingleBuffer;
    this.jingleSource.connect(this.gainB);

    this.jingleSource.onended = () => {
      if (this.jingleGeneration !== gen) return;
      this.jingleSource?.disconnect();
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
    await this.resumeContextIfNeeded();
    const arrayBuffer = await window.electronAPI.readFileBuffer(filePath);
    const buffer = await this.ctx.decodeAudioData(arrayBuffer);
    const id = crypto.randomUUID();
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.cartGain);
    source.onended = () => {
      source.disconnect();
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
      this.jingleSource.disconnect();
      this.jingleSource = null;
    }
    this.jinglePlaying = false;
    this.jingleOnEnded = null;
  }

  /** Stop all cart wall voices. Use only for full teardown, not from automation transport. */
  stopAllCartVoices(): void {
    this.cartVoices.forEach((src) => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      src.disconnect();
    });
    this.cartVoices.clear();
  }

  /** Stop automation/cart jingle voice only (cart-wall polyphony keeps playing). */
  stopAutomationJingle(): void {
    if (this.jingleSource) {
      try {
        this.jingleSource.stop();
      } catch {
        /* already stopped */
      }
      this.jingleSource.disconnect();
      this.jingleSource = null;
    }
    this.jingleBuffer = null;
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
