// The audio engine: Web Audio, one French voice at a time, plus a separate bus for sound effects.
// See docs/app-games.md ("Audio") for how puzzle types use it.
//
// Design
// - One AudioContext for the app's lifetime, created lazily. Clips are fetched and decoded once and
//   cached (LRU with a memory cap; the playing clip is never evicted).
// - A play is a list of iterations scheduled on the context clock: each iteration is a
//   BufferSource -> per-iteration gain envelope (fade in / out) -> voice bus. A loop keeps the next
//   iterations scheduled ahead by a small pump, with `gapMs` of silence between them.
// - Starting anything stops what was playing (with a fade, so cuts never click).
// - iOS / iPadOS (cannot be tested on this machine, coded defensively):
//   * the context starts suspended: resume() is called synchronously inside every gesture listener
//     and at the top of every play call (plays are started from tap handlers);
//   * a 'interrupted' or 'suspended' context (phone call, tab switch) is resumed on the next gesture
//     and on visibilitychange to visible;
//   * navigator.audioSession.type = 'playback' when the API exists, so the silent switch does not
//     mute practices; 'play-and-record' only while the microphone is open (setMicOpen);
//   * decodeAudioData in its callback form as a fallback for old WebKit;
//   * buffers are decoded at the context's own sample rate (decodeAudioData resamples); if the
//     context is ever closed and recreated, the cache is dropped;
//   * nothing relies on autoplay: a play started before unlock is scheduled and simply starts when
//     the context resumes.

import { heardAtMs, overlaySpan } from '../../../shared/karaoke';
import { fetchMedia, MediaLoadError, type Bytes, type MediaFailure } from '../media/fetchMedia';
import { DEFAULT_LOOP_STYLE, planLoop, planReady, resolveStyle, scheduleRepetition, type LoopPlan, type LoopStyle, type LoopStyleId } from './loopStyle';

export interface PlayOptions {
  loop?: boolean;
  gapMs?: number; // silence between loops (default 350)
  rate?: number; // playback rate (1 = normal; 0.75 = slower; pitch changes with it)
  fromMs?: number; // the first iteration starts here instead of at startMs (later ones at startMs)
  tag?: string; // what is playing, for views (e.g. 'unit:<id>', 'line:<id>', 'scene:<id>')
  /** How a looped window is cut and faded (audio/loopStyle.ts); default DEFAULT_LOOP_STYLE ('D', the one the user chose). */
  loopStyle?: LoopStyleId | Partial<LoopStyle>;
  /** A funny voice for plain generated speech: pitch and speed, vibrato, or echo (see VOICES). */
  voice?: VoicePreset;
  /** The clip could not be fetched or decoded (e.g. a missing /media/q/ file). `ready` rejects too. */
  onError?: (err: AudioLoadError) => void;
  /**
   * A failed load is not told to the kid (Engine.onPlayError): the caller has its own fallback. Only the
   * question puzzle's clips use it (they fall back to the line's audio; the user's choice).
   */
  quiet?: boolean;
  onEnd?: () => void; // a non-looping play finished (not called on stop or when replaced)
  onIteration?: (n: number) => void; // iteration n (1-based) finished playing (loops and single plays)
  /**
   * A second clip played in time with this one (a karaoke recording over its song): its first sample
   * sits at `offsetMs` of the clip, and it follows every iteration, seek and loop of the play. When it
   * cannot be loaded the play goes on without it (`onError`).
   */
  overlay?: Overlay;
}

export interface Overlay {
  src: string;
  offsetMs: number;
  gain?: number; // default 1
  onError?: (err: AudioLoadError) => void;
}

export interface AudioState {
  src: string | null;
  playing: boolean; // something is scheduled (it may be in a loop gap)
  loading: boolean; // waiting for the clip to download or decode
  loop: boolean;
  tag: string | null;
  startMs: number;
  endMs: number;
  positionMs: number; // in the clip's timeline, as of the last state change (use getPositionMs() live)
  unlocked: boolean; // audio will be heard (unlocked by a gesture and the context running)
  muted: boolean; // the kid's mute switch (remembered on the device)
  overlay: string | null; // the overlay clip playing with this play (PlayOptions.overlay), once loaded
}

export interface PlayHandle {
  readonly id: number;
  /** Resolves when the clip is decoded and scheduled (or when the play was replaced or failed). */
  readonly ready: Promise<void>; // rejects with an AudioLoadError when the clip cannot be loaded
  /** Stop this play if it is still the current one. */
  stop(): void;
  /** True while this play is the current one. */
  isCurrent(): boolean;
}

export type VoicePreset = 'squeaky' | 'deep' | 'wobble' | 'echo';

/** The voice presets: playback rate (pitch and speed together), vibrato, echo. */
export const VOICES: Record<VoicePreset, { rate: number; vibrato?: { hz: number; depth: number }; echo?: { delayS: number; feedback: number; wet: number } }> = {
  squeaky: { rate: 1.3 },
  deep: { rate: 0.8 },
  wobble: { rate: 1.05, vibrato: { hz: 5, depth: 0.05 } },
  echo: { rate: 0.95, echo: { delayS: 0.17, feedback: 0.38, wet: 0.5 } },
};

/**
 * A clip that could not be loaded: `status` is the HTTP status (503 for tts-unavailable), 0 for network,
 * a timeout or decoding; `reason` says which (a MediaLoadError, media/fetchMedia.ts).
 */
export class AudioLoadError extends MediaLoadError {
  constructor(src: string, status: number, message: string, reason: MediaFailure = status ? 'http' : 'decode') {
    super(src, status, reason, message);
    this.name = 'AudioLoadError';
  }
}

function asLoadError(src: string, e: unknown): AudioLoadError {
  if (e instanceof AudioLoadError) return e;
  if (e instanceof MediaLoadError) return new AudioLoadError(e.src, e.status, e.message, e.reason);
  return new AudioLoadError(src, 0, String(e), 'decode');
}

export type SfxName =
  | 'tap'
  | 'right'
  | 'wrong'
  | 'win'
  | 'pop'
  | 'whoosh'
  | 'sparkle'
  | 'coin'
  | 'chest'
  | 'level'
  | 'rankUp';

export interface NowPlaying {
  id: number;
  src: string;
  tag: string | null;
  loop: boolean;
  startMs: number;
  endMs: number;
}

const FADE_S = 0.008; // fade on every start and stop
const LOOKAHEAD_S = 1.2; // keep loop iterations scheduled this far ahead
const PUMP_MS = 150;
// Decoded float32 PCM; a 20 s stereo scene is about 7.7 MB. Small devices keep less.
const CACHE_CAP_LARGE = 96 * 1024 * 1024;
const CACHE_CAP_SMALL = 32 * 1024 * 1024;

/**
 * The cache cap for this device: 32 MB on a small one (navigator.deviceMemory of 4 GB or less where the
 * browser reports it; otherwise a phone-sized viewport), 96 MB elsewhere.
 */
export function cacheCapBytes(env: { deviceMemory?: number; width?: number; height?: number } = deviceEnv()): number {
  if (typeof env.deviceMemory === 'number' && env.deviceMemory > 0) return env.deviceMemory <= 4 ? CACHE_CAP_SMALL : CACHE_CAP_LARGE;
  if (env.width && env.height) return Math.min(env.width, env.height) < 600 ? CACHE_CAP_SMALL : CACHE_CAP_LARGE;
  return CACHE_CAP_LARGE;
}

function deviceEnv(): { deviceMemory?: number; width?: number; height?: number } {
  if (typeof window === 'undefined') return {};
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const sw = window.screen?.width || window.innerWidth;
  const sh = window.screen?.height || window.innerHeight;
  return { ...(typeof mem === 'number' ? { deviceMemory: mem } : {}), width: sw, height: sh };
}

const CACHE_CAP_BYTES = cacheCapBytes();
const SFX_FILES: Partial<Record<SfxName, string>> = {
  right: '/media/sfx/right.mp3',
  wrong: '/media/sfx/wrong.mp3',
  win: '/media/sfx/win.mp3',
};

interface Iteration {
  src: AudioBufferSourceNode;
  env: GainNode;
  extra: AudioBufferSourceNode[]; // the overlay's source, stopped with the iteration
  nodes: AudioNode[];
  when: number; // context time it starts
  offsetS: number; // where in the buffer it starts
  durS: number; // buffer seconds it plays
  n: number;
}

interface Voice {
  id: number;
  src: string;
  buffer: AudioBuffer;
  startS: number;
  endS: number;
  plan: LoopPlan;
  loop: boolean;
  gapS: number;
  rate: number;
  tag: string | null;
  opts: PlayOptions;
  its: Iteration[];
  out: AudioNode; // where iterations connect (the voice bus, or the voice preset's chain)
  fxNodes: AudioNode[]; // the preset's nodes, disconnected after the stop
  lfo: OscillatorNode | null;
  lfoGain: GainNode | null;
  overlay: { src: string; buffer: AudioBuffer; offsetS: number; gain: number } | null;
  nextWhen: number; // when the next iteration starts
  count: number; // iterations scheduled
  timers: number[];
  pump: number | null;
}

interface CacheEntry {
  promise: Promise<AudioBuffer>;
  bytes: number; // decoded size, 0 until decoded
  used: number;
  /** The download, for progress: bytes received and the file's size when known. */
  got: Bytes;
  watchers: Set<(b: Bytes) => void>;
}

type Ctor = typeof AudioContext;

function contextCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function setAudioSession(type: 'playback' | 'play-and-record' | 'auto'): void {
  try {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = type;
  } catch {
    /* not supported */
  }
}

const MUTE_KEY = 'frx.muted';
function readMuted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeMuted(m: boolean): void {
  try {
    if (m) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* private mode: the switch still works for this page */
  }
}

export class Engine {
  private ctx: AudioContext | null = null;
  private voiceBus: GainNode | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private cache = new Map<string, CacheEntry>();
  private sfxBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private voice: Voice | null = null;
  private token = 0;
  private useCounter = 0;
  private listeners = new Set<(s: AudioState) => void>();
  private state: AudioState = { src: null, playing: false, loading: false, loop: false, tag: null, startMs: 0, endMs: 0, positionMs: 0, unlocked: false, muted: readMuted(), overlay: null };
  private wired = false;
  private unlocked = false;
  /** Loops heard, counted once per looping play that completed two iterations (for POST /api/events). */
  loopsHeard = 0;
  onLoopHeard: ((tag: string | null) => void) | null = null;
  /** A play's clip failed to load while it was the current play (not a `quiet` one): the app tells the kid. */
  onPlayError: ((err: AudioLoadError) => void) | null = null;

  // ---- context ---------------------------------------------------------------------------------

  /** The context, created on first use (it may start suspended until a gesture). */
  private context(): AudioContext | null {
    if (this.ctx && this.ctx.state !== 'closed') return this.ctx;
    const C = contextCtor();
    if (!C) return null;
    if (this.ctx) {
      // Closed (should not happen): buffers belong to the old context's sample rate.
      this.cache.clear();
      this.sfxBuffers.clear();
    }
    try {
      this.ctx = new C({ latencyHint: 'interactive' });
    } catch {
      this.ctx = new C();
    }
    // Views waiting for "unlocked" (karaoke autoplay) re-check when the context starts running.
    this.ctx.onstatechange = () => this.refreshUnlocked();
    // Everything goes through the master gain: the mute switch sets it to 0.
    this.master = this.ctx.createGain();
    this.master.gain.value = this.state.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.voiceBus = this.ctx.createGain();
    this.voiceBus.connect(this.master);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.55;
    this.sfxBus.connect(this.master);
    this.wire();
    return this.ctx;
  }

  /** Global listeners: resume on any gesture, stop when hidden. Installed once. */
  private wire(): void {
    if (this.wired || typeof window === 'undefined') return;
    this.wired = true;
    const resume = () => this.resumeNow();
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click'] as const) window.addEventListener(ev, resume, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.resumeNow();
    });
    window.addEventListener('pagehide', () => this.stop());
  }

  /** Synchronous resume, safe to call inside a gesture handler (iOS requires it there). */
  private resumeNow(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      try {
        void ctx.resume().catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }

  isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  isUnlocked(): boolean {
    return this.unlocked && this.isRunning();
  }

  /** Call from a user gesture once (main.tsx does it on the first touch; it is safe to call again). */
  async unlock(): Promise<void> {
    const ctx = this.context();
    if (!ctx) return;
    setAudioSession('playback');
    this.resumeNow();
    // The classic iOS unlock: play one silent sample inside the gesture.
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
    this.unlocked = true;
    for (const name of Object.keys(SFX_FILES) as SfxName[]) void this.sfxBuffer(name);
    await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
    this.refreshUnlocked();
  }

  /** Open or close the microphone's audio session (play-and-record only while it is open). */
  setMicOpen(open: boolean): void {
    setAudioSession(open ? 'play-and-record' : 'playback');
  }

  // ---- loading ---------------------------------------------------------------------------------

  private decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
    return new Promise<AudioBuffer>((resolve, reject) => {
      let settled = false;
      const ok = (b: AudioBuffer) => {
        if (!settled) {
          settled = true;
          resolve(b);
        }
      };
      const ko = (e: unknown) => {
        if (!settled) {
          settled = true;
          reject(e instanceof Error ? e : new Error('decodeAudioData failed'));
        }
      };
      try {
        const p = ctx.decodeAudioData(data, ok, ko) as Promise<AudioBuffer> | undefined; // callback form for old WebKit
        if (p && typeof p.then === 'function') p.then(ok, ko);
      } catch (e) {
        ko(e);
      }
    });
  }

  /**
   * The decoded clip, from the cache or fetched (media/fetchMedia: progress, and a stall becomes a
   * timeout error) and decoded once. A failure leaves nothing in the cache, so the next try fetches again.
   */
  private loadBuffer(src: string, onProgress?: (b: Bytes) => void): Promise<AudioBuffer> {
    const hit = this.cache.get(src);
    if (hit) {
      hit.used = ++this.useCounter;
      if (onProgress) {
        onProgress(hit.got);
        if (!hit.bytes) {
          hit.watchers.add(onProgress);
          const off = () => hit.watchers.delete(onProgress);
          hit.promise.then(off, off);
        }
      }
      return hit.promise;
    }
    const ctx = this.context();
    if (!ctx) return Promise.reject(new AudioLoadError(src, 0, 'Web Audio is not available'));
    const entry: CacheEntry = { promise: null as unknown as Promise<AudioBuffer>, bytes: 0, used: ++this.useCounter, got: { loaded: 0, total: null }, watchers: new Set(onProgress ? [onProgress] : []) };
    const progress = (b: Bytes) => {
      entry.got = b;
      for (const w of entry.watchers) w(b);
    };
    entry.promise = fetchMedia(src, { onProgress: progress })
      .then((data) => this.decode(ctx, data).catch((e: unknown) => Promise.reject(new AudioLoadError(src, 0, String(e), 'decode'))))
      .then((buf) => {
        entry.bytes = buf.length * buf.numberOfChannels * 4;
        entry.watchers.clear();
        this.evict();
        return buf;
      })
      .catch((e: unknown) => {
        entry.watchers.clear();
        if (this.cache.get(src) === entry) this.cache.delete(src);
        throw asLoadError(src, e);
      });
    this.cache.set(src, entry);
    return entry.promise;
  }

  /**
   * Fetch and decode a clip into the cache, reporting the download's bytes. Rejects with an
   * AudioLoadError (no answer for MEDIA_TIMEOUT_MS, offline, an HTTP error, undecodable). A clip in the
   * cache resolves at once; one already loading is shared.
   */
  load(src: string, onProgress?: (b: Bytes) => void): Promise<void> {
    return this.loadBuffer(src, onProgress).then(() => undefined);
  }

  private evict(): void {
    let total = 0;
    for (const e of this.cache.values()) total += e.bytes;
    if (total <= CACHE_CAP_BYTES) return;
    const order = [...this.cache.entries()].filter(([src, e]) => e.bytes > 0 && src !== this.voice?.src && src !== this.voice?.overlay?.src).sort((a, b) => a[1].used - b[1].used);
    for (const [src, e] of order) {
      if (total <= CACHE_CAP_BYTES) break;
      this.cache.delete(src);
      total -= e.bytes;
    }
  }

  /** Fetch and decode clips ahead of time. */
  async preload(src: string | string[]): Promise<void> {
    const list = Array.isArray(src) ? src : [src];
    await Promise.all(list.map((s) => this.loadBuffer(s).then(() => undefined, () => undefined)));
  }

  /** True when the clip is decoded and ready. */
  isLoaded(src: string): boolean {
    const e = this.cache.get(src);
    return !!e && e.bytes > 0;
  }

  // ---- playing ---------------------------------------------------------------------------------

  /** Play src from startMs to endMs (ms in the clip). Stops whatever was playing. */
  playRange(src: string, startMs: number, endMs: number, opts: PlayOptions = {}): PlayHandle {
    this.resumeNow(); // inside the tap that started it, for iOS
    this.halt();
    const id = ++this.token;
    this.state = {
      src,
      playing: true,
      loading: !this.isLoaded(src),
      loop: !!opts.loop,
      tag: opts.tag ?? null,
      startMs,
      endMs,
      positionMs: opts.fromMs ?? startMs,
      unlocked: this.isUnlocked(),
      muted: this.state.muted,
      overlay: null,
    };
    this.emit();
    // The overlay never holds the play back: the clip starts as soon as it is ready, and the overlay
    // joins when it has loaded (at once when it is in the cache). One that cannot be loaded is left out.
    const ov = opts.overlay;
    const ready = this.loadBuffer(src).then(
      (buffer) => {
        if (id !== this.token) return;
        this.begin(id, src, buffer, startMs, endMs, opts);
        if (!ov) return;
        void this.loadBuffer(ov.src).then(
          (ovBuffer) => {
            if (id === this.token && this.voice?.id === id) this.attachOverlay(this.voice, { src: ov.src, buffer: ovBuffer, offsetS: ov.offsetMs / 1000, gain: ov.gain ?? 1 });
          },
          (err: unknown) => ov.onError?.(asLoadError(ov.src, err)),
        );
      },
      (err: unknown) => {
        const e = asLoadError(src, err);
        const current = id === this.token;
        if (current) {
          this.state = { ...this.state, playing: false, loading: false };
          this.emit();
        }
        opts.onError?.(e);
        // Told to the kid only for the play still current (a replaced or stopped one is not theirs any more).
        if (current && !opts.quiet) this.onPlayError?.(e);
        throw e;
      },
    );
    ready.catch(() => {}); // a caller that does not listen must not get an unhandled rejection
    return {
      id,
      ready,
      stop: () => {
        if (id === this.token) this.stop();
      },
      isCurrent: () => id === this.token,
    };
  }

  /** Play a whole file (v1 word drills, generated speech). Stops whatever was playing. */
  play(src: string, opts: Omit<PlayOptions, 'fromMs'> = {}): PlayHandle {
    return this.playRange(src, 0, Number.POSITIVE_INFINITY, opts);
  }

  private begin(id: number, src: string, buffer: AudioBuffer, startMs: number, endMs: number, opts: PlayOptions): void {
    const ctx = this.ctx!;
    const dur = buffer.duration;
    const startS = Math.max(0, Math.min(dur, startMs / 1000));
    let endS = Math.max(startS, Math.min(dur, endMs / 1000));
    if (endS - startS < 0.05) endS = Math.min(dur, startS + 0.05);
    // Loops default to the chosen style (D); a single play has no seam and keeps A.
    const styleIn = opts.loopStyle ?? (opts.loop ? DEFAULT_LOOP_STYLE : 'A');
    const style = resolveStyle(styleIn);
    // D and E scan the buffer for quiet cut points. Never block the first sound on it: until the
    // scan is cached, play C's padded window, and switch to the scanned plan from the next repetition.
    const scanLater = !planReady(startS, endS, styleIn, src);
    const plan = scanLater ? planLoop(buffer, startS, endS, { ...style, id: 'C' }) : planLoop(buffer, startS, endS, styleIn, src);
    const preset = opts.voice ? VOICES[opts.voice] : undefined;
    const rate = (opts.rate && opts.rate > 0 ? opts.rate : 1) * (preset?.rate ?? 1);
    // The voice preset's chain: vibrato is an LFO on every iteration's playbackRate; echo is a
    // feedback delay mixed with the dry signal.
    let out: AudioNode = this.voiceBus!;
    const fxNodes: AudioNode[] = [];
    let lfo: OscillatorNode | null = null;
    let lfoGain: GainNode | null = null;
    if (preset?.echo) {
      const input = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = preset.echo.delayS;
      const fb = ctx.createGain();
      fb.gain.value = preset.echo.feedback;
      const wet = ctx.createGain();
      wet.gain.value = preset.echo.wet;
      input.connect(this.voiceBus!);
      input.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(this.voiceBus!);
      out = input;
      fxNodes.push(input, delay, fb, wet);
    }
    if (preset?.vibrato) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = preset.vibrato.hz;
      lfoGain = ctx.createGain();
      lfoGain.gain.value = preset.vibrato.depth * rate;
      lfo.connect(lfoGain);
      lfo.start();
    }
    const v: Voice = {
      id,
      src,
      buffer,
      startS,
      endS,
      plan,
      loop: !!opts.loop,
      gapS: Math.max(0, opts.gapMs !== undefined ? opts.gapMs / 1000 : plan.gapS),
      rate,
      tag: opts.tag ?? null,
      opts,
      its: [],
      out,
      fxNodes,
      lfo,
      lfoGain,
      overlay: null,
      nextWhen: ctx.currentTime + 0.02,
      count: 0,
      timers: [],
      pump: null,
    };
    this.voice = v;
    if (scanLater) {
      setTimeout(() => {
        const scanned = planLoop(buffer, startS, endS, styleIn, src);
        if (this.voice === v) v.plan = scanned;
      }, 0);
    }
    const fromS = opts.fromMs !== undefined ? Math.max(startS, Math.min(endS - 0.05, opts.fromMs / 1000)) : startS;
    this.schedule(v, fromS);
    if (v.loop) {
      v.pump = window.setInterval(() => this.pumpLoop(v), PUMP_MS);
      this.pumpLoop(v);
    }
    this.state = { ...this.state, src, playing: true, loading: false, endMs: endMs === Number.POSITIVE_INFINITY ? dur * 1000 : endMs, overlay: null };
    this.emit();
  }

  private pumpLoop(v: Voice): void {
    if (this.voice !== v || !this.ctx) return;
    // A suspended context does not advance: nothing to do until it runs again.
    while (v.nextWhen < this.ctx.currentTime + LOOKAHEAD_S) this.schedule(v);
    v.its = v.its.filter((it) => it.when + it.durS / v.rate > this.ctx!.currentTime - 0.1);
  }

  private schedule(v: Voice, fromS?: number): void {
    const ctx = this.ctx!;
    const when = Math.max(v.nextWhen, ctx.currentTime + 0.005);
    const r = scheduleRepetition(ctx, v.out, v.buffer, v.plan, when, v.rate, fromS);
    const s = r.src;
    const env = r.env;
    if (v.lfoGain) v.lfoGain.connect(s.playbackRate);
    const extra: AudioBufferSourceNode[] = [];
    const n = ++v.count;
    const it: Iteration = { src: s, env, extra, nodes: r.nodes, when, offsetS: r.offsetS, durS: r.durS, n };
    v.its.push(it);
    if (v.overlay) this.scheduleOverlay(v, it, when);
    v.nextWhen = when + r.realS + (v.loop ? v.gapS : 0);
    s.onended = () => {
      for (const node of r.nodes) {
        try {
          node.disconnect();
        } catch {
          /* ignore */
        }
      }
      if (this.voice !== v) return;
      v.opts.onIteration?.(n);
      if (v.loop && n === 2) {
        this.loopsHeard++;
        this.onLoopHeard?.(v.tag);
      }
      if (!v.loop) {
        this.halt(); // frees the voice preset's nodes
        this.state = { ...this.state, playing: false, positionMs: v.endS * 1000 };
        this.emit();
        v.opts.onEnd?.();
      }
    };
  }

  /**
   * The overlay plays the part of itself that lies under an iteration, from `fromWhen` on (the
   * iteration's start, or now for one already playing when the overlay arrived), through the
   * iteration's own envelope, so a seek, a loop, a fade and a stop all carry it along.
   */
  private scheduleOverlay(v: Voice, it: Iteration, fromWhen: number): void {
    const ctx = this.ctx;
    const ov = v.overlay;
    if (!ctx || !ov) return;
    const at = Math.max(it.when, fromWhen);
    const skipS = (at - it.when) * v.rate; // clip seconds of the iteration already past
    if (skipS >= it.durS - 0.02) return;
    const span = overlaySpan(at, it.offsetS + skipS, it.durS - skipS, v.rate, ov.offsetS, ov.buffer.duration);
    if (!span) return;
    const os = ctx.createBufferSource();
    os.buffer = ov.buffer;
    os.playbackRate.value = v.rate;
    const g = ctx.createGain();
    g.gain.value = ov.gain;
    os.connect(g);
    g.connect(it.env);
    os.start(span.atS, span.overlayFromS, span.durS);
    os.stop(span.atS + span.durS / v.rate + 0.02);
    it.extra.push(os);
    it.nodes.push(g);
  }

  /** The overlay has loaded: it joins every iteration scheduled, from now on, and every later one. */
  private attachOverlay(v: Voice, ov: NonNullable<Voice['overlay']>): void {
    const ctx = this.ctx;
    if (!ctx || this.voice !== v) return;
    v.overlay = ov;
    // A little ahead of the clock (a source started in the past would play late); one already in the
    // cache arrives a microtask after the first iteration was scheduled 20 ms ahead, so it starts with it.
    const now = ctx.currentTime + 0.01;
    for (const it of v.its) this.scheduleOverlay(v, it, now);
    this.state = { ...this.state, overlay: ov.src };
    this.emit();
  }

  /** Stop the voice nodes with a short fade, without touching the public state. */
  private halt(): void {
    const v = this.voice;
    this.voice = null;
    if (!v) return;
    if (v.pump !== null) clearInterval(v.pump);
    // Let an echo tail ring out briefly, then free the preset's nodes.
    if (v.fxNodes.length || v.lfo) {
      const nodes = v.fxNodes;
      const lfo = v.lfo;
      setTimeout(() => {
        for (const n of nodes) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
        try {
          lfo?.stop();
          lfo?.disconnect();
        } catch {
          /* ignore */
        }
      }, 1500);
    }
    for (const t of v.timers) clearTimeout(t);
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const it of v.its) {
      try {
        it.src.onended = null;
        const g = it.env.gain;
        g.cancelScheduledValues(now);
        if (it.when >= now) {
          // Not started yet: never let it start.
          it.src.stop(0);
          for (const x of it.extra) x.stop(0);
          it.env.disconnect();
          continue;
        }
        const cur = g.value;
        g.setValueAtTime(cur, now);
        g.linearRampToValueAtTime(0, now + FADE_S);
        it.src.stop(now + FADE_S + 0.01);
        for (const x of it.extra) x.stop(now + FADE_S + 0.01);
      } catch {
        /* already stopped */
      }
    }
  }

  stop(): void {
    this.token++;
    const was = this.state.playing || this.state.loading;
    const pos = this.getPositionMs();
    this.halt();
    if (was || this.state.src) {
      this.state = { ...this.state, playing: false, loading: false, positionMs: pos };
      this.emit();
    }
  }

  // ---- clock -----------------------------------------------------------------------------------

  /**
   * The live position in the current clip, in ms, corrected for output latency so highlights line
   * up with what is heard. During a loop gap it holds at the end of the window.
   */
  getPositionMs(): number {
    const v = this.voice;
    const ctx = this.ctx;
    if (!v || !ctx) return this.state.positionMs;
    const lat = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? ctx.baseLatency ?? 0;
    const now = ctx.currentTime - (Number.isFinite(lat) ? lat : 0);
    let cur: Iteration | undefined;
    for (const it of v.its) if (it.when <= now) cur = it;
    if (!cur) return (v.its[0]?.offsetS ?? v.startS) * 1000;
    const into = (now - cur.when) * v.rate;
    return (cur.offsetS + Math.min(into, cur.durS)) * 1000;
  }

  /**
   * When position `clipMs` of the current play's first iteration is (or was) heard, in
   * performance.now() ms, with the output latency the browser reports; null when nothing is scheduled.
   * The karaoke recorder places a take on its song with it (shared/karaoke.ts, "Timing").
   */
  clipHeardAt(clipMs: number): number | null {
    const v = this.voice;
    const ctx = this.ctx;
    const it = v?.its[0];
    if (!v || !ctx || !it) return null;
    const lat = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? ctx.baseLatency ?? 0;
    return heardAtMs({ perfNowMs: performance.now(), ctxNowS: ctx.currentTime, outputLatencyS: Number.isFinite(lat) ? lat : 0, whenS: it.when, offsetS: it.offsetS, rate: v.rate }, clipMs);
  }

  getState(): AudioState {
    return this.state;
  }

  nowPlaying(): NowPlaying | null {
    const s = this.state;
    if (!s.playing || !s.src) return null;
    return { id: this.token, src: s.src, tag: s.tag, loop: s.loop, startMs: s.startMs, endMs: s.endMs };
  }

  subscribe(listener: (s: AudioState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private refreshUnlocked(): void {
    const u = this.isUnlocked();
    if (u !== this.state.unlocked) this.state = { ...this.state, unlocked: u };
    this.emit();
  }

  private emit(): void {
    const s = this.state;
    for (const l of this.listeners) l(s);
  }

  // ---- sound effects ---------------------------------------------------------------------------

  private sfxBuffer(name: SfxName): Promise<AudioBuffer | null> {
    const file = SFX_FILES[name];
    if (!file) return Promise.resolve(null);
    let p = this.sfxBuffers.get(file);
    if (!p) {
      const ctx = this.context();
      if (!ctx) return Promise.resolve(null);
      p = fetch(file)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((d) => this.decode(ctx, d))
        .catch(() => null);
      this.sfxBuffers.set(file, p);
    }
    return p;
  }

  /**
   * The mute switch. Muted: the master gain is 0, the French that was playing stops, effects are
   * skipped. Plays started while muted still run silently (so a puzzle type's timing and callbacks, and
   * microphone rounds, keep working); views that start sound by themselves check isMuted() first.
   */
  setMuted(muted: boolean): void {
    if (muted === this.state.muted) return;
    writeMuted(muted);
    if (muted) this.stop();
    const ctx = this.ctx;
    if (ctx && this.master) {
      const g = this.master.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(muted ? 0 : 1, ctx.currentTime + 0.03);
    }
    this.state = { ...this.state, muted };
    this.emit();
  }

  isMuted(): boolean {
    return this.state.muted;
  }

  /** A sound effect on its own bus: it never stops the French, which ducks a little under it. */
  sfx(name: SfxName): void {
    if (this.state.muted) return;
    const ctx = this.context();
    if (!ctx || !this.sfxBus) return;
    this.resumeNow();
    if (ctx.state !== 'running' && !this.unlocked) return;
    const file = SFX_FILES[name];
    if (file) {
      void this.sfxBuffer(name).then((b) => {
        if (!b || !this.sfxBus) return;
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(this.sfxBus);
        s.start();
        this.duck(Math.min(1.2, b.duration));
      });
      return;
    }
    const len = synth(ctx, this.sfxBus, name);
    this.duck(len);
  }

  private duck(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.voiceBus || !this.voice) return;
    const g = this.voiceBus.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.45, now + 0.04);
    g.setValueAtTime(0.45, now + seconds);
    g.linearRampToValueAtTime(1, now + seconds + 0.25);
  }
}

// ---- synthesised effects (nothing to download) -------------------------------------------------

function tone(ctx: AudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, at: number, dur: number, vol: number): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  g.connect(out);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function noise(ctx: AudioContext, out: AudioNode, at: number, dur: number, vol: number, fromHz: number, toHz: number): void {
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource();
  s.buffer = b;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(fromHz, at);
  f.frequency.exponentialRampToValueAtTime(toHz, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f);
  f.connect(g);
  g.connect(out);
  s.start(at);
  s.stop(at + dur + 0.02);
}

/** Plays a synthesised effect; returns its length in seconds. */
function synth(ctx: AudioContext, out: AudioNode, name: SfxName): number {
  const t = ctx.currentTime + 0.005;
  switch (name) {
    case 'tap':
      tone(ctx, out, 'triangle', 900, 600, t, 0.06, 0.25);
      return 0.06;
    case 'pop':
      tone(ctx, out, 'sine', 300, 1100, t, 0.09, 0.5);
      return 0.1;
    case 'whoosh':
      noise(ctx, out, t, 0.35, 0.35, 400, 3000);
      return 0.35;
    case 'sparkle':
      [1568, 2093, 2637, 3136].forEach((f, i) => tone(ctx, out, 'sine', f, f * 1.01, t + i * 0.055, 0.18, 0.18));
      return 0.4;
    case 'coin':
      tone(ctx, out, 'square', 988, 988, t, 0.08, 0.12);
      tone(ctx, out, 'square', 1319, 1319, t + 0.08, 0.3, 0.12);
      return 0.38;
    case 'chest':
      noise(ctx, out, t, 0.25, 0.3, 200, 900);
      [523, 659, 784, 1047].forEach((f, i) => tone(ctx, out, 'triangle', f, f, t + 0.2 + i * 0.07, 0.25, 0.22));
      return 0.7;
    case 'level':
      [784, 988, 1175, 1568].forEach((f, i) => tone(ctx, out, 'triangle', f, f, t + i * 0.09, 0.35, 0.22));
      tone(ctx, out, 'sine', 2093, 2093, t + 0.36, 0.5, 0.12);
      return 0.9;
    case 'rankUp':
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(ctx, out, 'square', f, f, t + i * 0.08, 0.16, 0.09));
      return 0.6;
    default:
      tone(ctx, out, 'sine', 660, 990, t, 0.12, 0.3);
      return 0.12;
  }
}
