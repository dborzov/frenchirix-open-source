// The microphone, imperatively: open it (inside a tap), record through Web Audio (an AudioWorklet,
// or a ScriptProcessor where worklets are missing), report a live level from the same samples (no
// second AudioContext, no AnalyserNode), stop on a button, after a silence once a voice was heard, or
// at the take's limit (never more than LISTEN_MAX_MS, 10 s), then resample to 16 kHz mono and encode
// a WAV. Every browser sends the same thing; MediaRecorder formats are never used.
//
// iPhone / iPad (not testable on this machine, coded defensively):
// - getUserMedia and the AudioContext are created inside the tap that starts recording;
// - the context runs at the device rate (44.1 or 48 kHz); we resample ourselves;
// - the audio session is 'play-and-record' only while the mic is open (audio.setMicOpen), back to
//   'playback' after, so practices are not muted by the silent switch;
// - the tracks are stopped after each take so the mic indicator goes off;
// - going to the background (visibilitychange) cuts the take: onCut tells the owner (useRecorder drops
//   it, like Pause: nothing sent, no try spent, back to idle). An 'interrupted' or closed context while
//   the page is in view (a call, a broken audio session) ends the take as an automatic stop with what
//   was recorded so far, so a microphone that is cut every time still reaches the 'deaf' notice and its
//   way out. A take is never dropped silently: the view waiting for it would stay 'recording' with a
//   dead stop button.

import { captureStartMs } from '../../../shared/karaoke';
import { LISTEN_MAX_MS } from '../../../shared/puzzles/speak-core';
import { audio } from '../audio';
import { encodeWav, judgeRecording, LiveVoice, lookAt, resample, rms, SPEECH_RATE, trimToVoice, type RecordingProblem } from './wav';

export interface Take {
  wav: Blob; // trimmed to the voice (with a margin) when there is one
  url: string; // object URL of the WAV, for listening back (revoke when done)
  durationMs: number; // of the WAV
  problem: RecordingProblem; // no voice, or too little (wav.ts, the voice gate): never sent
  /** When the WAV's first sample reached the microphone, in performance.now() ms (best estimate; untrimmed takes only). */
  capturedAt?: number;
}

/** End of speech: the take stops after this much silence once a voice was heard (unless the view asks otherwise). */
export const SILENCE_MS = 1500;

export type MicFailure = 'denied' | 'unsupported' | 'error';

export class MicError extends Error {
  readonly kind: MicFailure;
  constructor(kind: MicFailure, message?: string) {
    super(message ?? kind);
    this.name = 'MicError';
    this.kind = kind;
  }
}

export interface RecordOptions {
  /** The take's limit; clamped to LISTEN_MAX_MS (or capMs). */
  maxMs: number;
  /** Another ceiling than LISTEN_MAX_MS (a karaoke take lasts its song). */
  capMs?: number;
  /** Keep the whole take, not trimmed to its voice (a karaoke take must keep its timing). */
  whole?: boolean;
  /** Stop after this much silence once a voice was heard (default SILENCE_MS). */
  silenceMs?: number;
  /** The live level, 0..1 on a loudness scale, and whether it is loud enough to be a voice; about 20 times a second. */
  onLevel?: (level: number, voice: boolean) => void;
  /** Called when the recorder stops by itself (silence, the limit, the context interrupted; the page hidden without onCut). */
  onAutoStop?: () => void;
  /** The page was hidden during the take: the owner drops it (cancel()). */
  onCut?: () => void;
}

/** The take's limit as the recorder applies it. */
export const takeLimitMs = (maxMs: number, capMs = LISTEN_MAX_MS) => Math.max(1000, Math.min(capMs, maxMs));

/** A sample block's RMS as a 0..1 level for the meter: -50 dB is 0, -10 dB is 1 (quiet voices still move it). */
export function meterLevel(r: number): number {
  if (r <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(r) + 50) / 40));
}

// Each block of 2048 samples goes to the page with `t`, the context time of its first sample (the
// karaoke places a take on its song with it).
const WORKLET_SRC = `
class FrxRec extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; this.t = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        if (this.n === 0) this.t = currentTime + i / sampleRate;
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage({ b: this.buf.slice(0), t: this.t }); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('frx-rec', FrxRec);
`;

type Ctor = typeof AudioContext;
function contextCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function micSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!contextCtor();
}

/** One take at a time. Create, start() inside a tap, stop() or wait for the auto stop. */
export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private chunks: Float32Array[] = [];
  private rate = 48000;
  private startedAt = 0;
  private heardVoice = false;
  private lastVoiceAt = 0;
  private live = new LiveVoice();
  private timer: number | null = null;
  private opts: RecordOptions | null = null;
  private finishing: Promise<Take | null> | null = null;
  private resolveDone: ((t: Take | null) => void) | null = null;
  private cancelled = false;
  private capturedAt: number | undefined = undefined;
  private inputLatencyS = 0;
  private onVisibility = () => {
    if (document.visibilityState !== 'hidden' || !this.resolveDone) return;
    if (this.opts?.onCut) {
      this.opts.onCut();
      if (this.recording) this.cancel(); // the owner did not: never left recording
    } else this.interrupt();
  };

  /** Opens the mic and starts recording. Call synchronously from a tap. Rejects with MicError. */
  async start(opts: RecordOptions): Promise<void> {
    if (!micSupported()) throw new MicError('unsupported');
    this.opts = { ...opts, maxMs: takeLimitMs(opts.maxMs, opts.capMs) };
    this.chunks = [];
    this.heardVoice = false;
    this.live = new LiveVoice();
    this.cancelled = false;
    this.capturedAt = undefined;
    // Silence the looping French first, so the scene is not recorded back (karaoke starts its song
    // itself once the microphone listens).
    audio.stop();
    audio.setMicOpen(true);
    const C = contextCtor()!;
    let ctx: AudioContext;
    try {
      ctx = new C();
      void ctx.resume().catch(() => {});
    } catch (e) {
      audio.setMicOpen(false);
      throw new MicError('error', String(e));
    }
    this.ctx = ctx;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      this.teardown();
      const name = (e as { name?: string }).name ?? '';
      throw new MicError(name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unsupported' : 'error', String(e));
    }
    if (this.cancelled) {
      this.teardown();
      throw new MicError('error', 'cancelled');
    }
    try {
      if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
      this.rate = ctx.sampleRate;
      const src = ctx.createMediaStreamSource(this.stream);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      sink.connect(ctx.destination);
      let node: AudioNode;
      if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const w = new AudioWorkletNode(ctx, 'frx-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
        w.port.onmessage = (e: MessageEvent<{ b: Float32Array; t: number } | Float32Array>) => (e.data instanceof Float32Array ? this.push(e.data) : this.push(e.data.b, e.data.t));
        node = w;
      } else {
        const sp = ctx.createScriptProcessor(4096, 1, 1);
        sp.onaudioprocess = (e) => {
          const b = new Float32Array(e.inputBuffer.getChannelData(0));
          this.push(b, ctx.currentTime - b.length / ctx.sampleRate);
        };
        node = sp;
      }
      src.connect(node);
      node.connect(sink);
      this.nodes = [src, node, sink];
      // The input latency, where the browser reports it (Chrome); 0 elsewhere.
      const lat = (this.stream.getAudioTracks?.()[0]?.getSettings?.() as { latency?: number } | undefined)?.latency;
      this.inputLatencyS = typeof lat === 'number' && Number.isFinite(lat) && lat > 0 && lat < 1 ? lat : 0;
    } catch (e) {
      this.teardown();
      throw new MicError('error', String(e));
    }
    this.startedAt = performance.now();
    this.lastVoiceAt = this.startedAt;
    this.finishing = new Promise((r) => (this.resolveDone = r));
    document.addEventListener('visibilitychange', this.onVisibility);
    ctx.onstatechange = () => {
      if ((ctx.state as string) === 'interrupted' || ctx.state === 'closed') this.interrupt();
    };
    this.timer = window.setInterval(() => this.tick(), 100);
  }

  private push(chunk: Float32Array, t?: number): void {
    if (!this.resolveDone) return;
    // The first block: when its first sample reached the microphone, on the page's clock.
    if (!this.chunks.length && t !== undefined && this.ctx) {
      const at = captureStartMs(performance.now(), this.ctx.currentTime, t, this.inputLatencyS);
      if (Number.isFinite(at)) this.capturedAt = at;
    }
    this.chunks.push(chunk);
    const level = rms(chunk);
    const voice = this.live.push(level);
    if (voice) {
      this.heardVoice = true;
      this.lastVoiceAt = performance.now();
    }
    this.opts?.onLevel?.(meterLevel(level), voice);
  }

  private tick(): void {
    const now = performance.now();
    const o = this.opts!;
    const elapsed = now - this.startedAt;
    const silence = o.silenceMs ?? SILENCE_MS;
    if (elapsed >= o.maxMs || (this.heardVoice && elapsed > 700 && now - this.lastVoiceAt > silence)) {
      o.onAutoStop?.();
      void this.stop();
    }
  }

  get recording(): boolean {
    return !!this.resolveDone;
  }

  /**
   * Stops and returns the take; null only when cancelled. Nothing recorded yet (a stop or an
   * interruption in the first few milliseconds) is an empty take, judged silent: a try like any other.
   */
  async stop(): Promise<Take | null> {
    const done = this.finishing;
    const resolve = this.resolveDone;
    if (!resolve) return done ?? null;
    this.resolveDone = null;
    const chunks = this.chunks;
    const rate = this.rate;
    this.teardown();
    if (this.cancelled) {
      resolve(null);
      return null;
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const all = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
      all.set(c, o);
      o += c.length;
    }
    const full = resample(all, rate, SPEECH_RATE);
    const look = lookAt(full, SPEECH_RATE);
    const problem = judgeRecording(look);
    // A take with a voice goes out cut to its voice (smaller uploads); one without is never sent. A
    // whole take (karaoke) keeps its timing.
    const whole = !!this.opts?.whole;
    const pcm = problem || whole ? full : trimToVoice(full, SPEECH_RATE, look);
    const wav = new Blob([encodeWav(pcm, SPEECH_RATE)], { type: 'audio/wav' });
    const take: Take = { wav, url: URL.createObjectURL(wav), durationMs: Math.round((pcm.length / SPEECH_RATE) * 1000), problem };
    if (whole && this.capturedAt !== undefined) take.capturedAt = this.capturedAt;
    resolve(take);
    return take;
  }

  /** Drops the take (unmounted, reset by the view). */
  cancel(): void {
    this.cancelled = true;
    if (this.resolveDone) void this.stop();
    else this.teardown();
  }

  /** Cut off from outside (the context interrupted; the page hidden without onCut): an automatic stop, so the view gets the take. */
  private interrupt(): void {
    if (!this.resolveDone) return;
    this.opts?.onAutoStop?.();
    void this.stop();
  }

  private teardown(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) {
      this.ctx.onstatechange = null;
      void this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    audio.setMicOpen(false);
  }
}
