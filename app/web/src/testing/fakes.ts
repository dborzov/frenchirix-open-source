// Scripted fakes for tests that drive puzzle views without a browser: the audio engine, the
// microphone recorder and the API client. happy-dom has no Web Audio and no microphone, so without
// them nothing ever ends and the recorder is always 'unsupported'. Each fake draws the outcome of
// every call from a Script (an audio play ends, fails or never ends; a take has a voice, is silent,
// is cut off; speech recognition passes, fails, answers 503, hangs…) and logs it.
//
// Install them in a test file with vi.mock (docs/app-dev.md, "Seams for tests"):
//
//   vi.mock('../audio/engine', async (orig) => {
//     const actual = await orig<typeof import('../audio/engine')>();
//     return { ...actual, Engine: (await import('./fakes')).createFakeEngine(actual.AudioLoadError) };
//   });
//   vi.mock('../speech/recorder', async (orig) => {
//     const actual = await orig<typeof import('../speech/recorder')>();
//     const f = await import('./fakes');
//     return { ...actual, MicRecorder: f.createFakeRecorder(actual.MicError), micSupported: f.micSupported };
//   });
//   vi.mock('../api', async (orig) => {
//     const actual = await orig<typeof import('../api')>();
//     return { ...actual, api: (await import('./fakes')).createFakeApi(actual.ApiRequestError) };
//   });
//
// and `installFakeAnimate()` (happy-dom's Element.animate finishes on real timers), then
// `setScript(script, scenes)` before each run. Times are fake-timer friendly: everything waits
// with setTimeout. Only types are imported from the modules being replaced (a value import would
// load the mocked module from inside its own mock factory).
import type { Scene } from '../../../shared/content';
import type { SpeechQuery, SpeechResponse } from '../../../shared/api';
import { createRng, type Rng } from '../../../shared/practice/rng';
import { LISTEN_MAX_MS } from '../../../shared/puzzles/speak-core';
import { scoreSpeech } from '../../../shared/speech';
import type { ApiClient, ApiRequestError as ApiRequestErrorT } from '../api';
import type { AudioLoadError as AudioLoadErrorT, AudioState, NowPlaying, PlayHandle, PlayOptions } from '../audio/engine';
import type { MicError as MicErrorT, RecordOptions, Take } from '../speech/recorder';

// ---- Outcomes and scripts ------------------------------------------------------------------------

/** POST /api/speech: a pass; some words heard but no pass; nothing heard; 503 speech-unavailable; 500; fetch throws; an answer after 10 s; no answer ever. */
export type SpeechOutcome = 'pass' | 'partial' | 'fail' | 'unavailable' | 'error' | 'offline' | 'slow' | 'hang';
/** Any other API call (progress save, events, profile). */
export type CallOutcome = 'ok' | 'fail' | 'hang';
/** One take: a voice; silence until the take's limit; a voice that goes on until the limit (sent as it is); a mumble too short; cut off mid-recording just as the kid began (the page hidden, the context interrupted: a take too short); the microphone fails to open. */
export type TakeOutcome = 'voice' | 'silent' | 'long' | 'short' | 'cut' | 'error';
/** One audio play: ends after its duration; fails to load (onError); never ends (a stalled load: no callback at all). */
export type AudioOutcome = 'end' | 'error' | 'never';
/** The microphone for the whole run: granted (intro already seen); the first-time intro first; denied; no microphone API. */
export type MicSetup = 'granted' | 'intro' | 'denied' | 'unsupported';

export interface Script {
  speech(): SpeechOutcome;
  call(): CallOutcome;
  take(): TakeOutcome;
  audio(): AudioOutcome;
  mic: MicSetup;
  /** For choices inside an outcome (which balloon a passing say-choice take picks). */
  rng: Rng;
}

type Weights<T extends string> = Record<T, number>;
function weighted<T extends string>(rng: Rng, w: Weights<T>): T {
  const entries = Object.entries(w) as [T, number][];
  let x = rng.next() * entries.reduce((n, [, v]) => n + v, 0);
  for (const [k, v] of entries) {
    x -= v;
    if (x < 0) return k;
  }
  return entries[entries.length - 1]![0];
}

// Speech recognition is up or down, and stays so for a while: outages are short bursts, and after one
// the server answers again (a kid meets "it failed once, then worked" far more often than a coin toss).
const SPEECH_UP: Weights<SpeechOutcome> = { pass: 4, partial: 2, fail: 2, unavailable: 0, error: 0, offline: 0, slow: 0.5, hang: 0 };
const SPEECH_DOWN: Weights<SpeechOutcome> = { pass: 0, partial: 0, fail: 0, unavailable: 2, error: 1, offline: 1, slow: 0, hang: 1 };
const GO_DOWN = 0.12; // per call, while up
const GO_UP = 0.6; // per call, while down
const RANDOM_CALL: Weights<CallOutcome> = { ok: 8, fail: 1, hang: 1 };
const RANDOM_TAKE: Weights<TakeOutcome> = { voice: 7, silent: 1.2, long: 0.4, short: 0.6, cut: 0.6, error: 0.6 };
const RANDOM_AUDIO: Weights<AudioOutcome> = { end: 8, error: 1, never: 1 };
const RANDOM_MIC: Weights<MicSetup> = { granted: 14, intro: 3, denied: 1, unsupported: 0.6 };

/** A script that draws every outcome from seeded weights. `only: 'audio'` keeps everything else favourable. */
export function randomScript(seed: number, only?: 'audio'): Script {
  const rng = createRng(seed).fork('liveness:outcomes');
  const pick = createRng(seed).fork('liveness:picks');
  if (only === 'audio') return { speech: () => 'pass', call: () => 'ok', take: () => 'voice', audio: () => weighted(rng, RANDOM_AUDIO), mic: 'granted', rng: pick };
  let up = true;
  return {
    speech: () => {
      if (rng.next() < (up ? GO_DOWN : GO_UP)) up = !up;
      return weighted(rng, up ? SPEECH_UP : SPEECH_DOWN);
    },
    call: () => weighted(rng, RANDOM_CALL),
    take: () => weighted(rng, RANDOM_TAKE),
    audio: () => weighted(rng, RANDOM_AUDIO),
    mic: weighted(createRng(seed).fork('liveness:mic'), RANDOM_MIC),
    rng: pick,
  };
}

/** Fixed outcomes per channel: one value for every call, or a sequence whose last value repeats. */
export interface FixedOutcomes {
  speech?: SpeechOutcome | SpeechOutcome[];
  call?: CallOutcome | CallOutcome[];
  take?: TakeOutcome | TakeOutcome[];
  audio?: AudioOutcome | AudioOutcome[];
  mic?: MicSetup;
}

function sequence<T>(v: T | T[] | undefined, favourable: T): () => T {
  const list = v === undefined ? [favourable] : Array.isArray(v) ? v : [v];
  let i = 0;
  return () => list[Math.min(i++, list.length - 1)]!;
}

/**
 * A script with fixed outcomes; a channel not given is favourable (pass, ok, a voice, ends, granted).
 * `{ speech: ['unavailable', 'pass'] }`: one 503, then the server answers again.
 */
export function fixedScript(seed: number, o: FixedOutcomes): Script {
  return {
    speech: sequence(o.speech, 'pass'),
    call: sequence(o.call, 'ok'),
    take: sequence(o.take, 'voice'),
    audio: sequence(o.audio, 'end'),
    mic: o.mic ?? 'granted',
    rng: createRng(seed).fork('liveness:picks'),
  };
}

// ---- The shared run state -------------------------------------------------------------------------

let script: Script = fixedScript(1, {});
let scenes = new Map<string, Scene>();
const durations = new Map<string, number>(); // src -> ms (scene audio, takes)
let log: string[] = [];
let engine: { reset(): void; stop(): void } | null = null;
let takes = 0;

const now = () => Math.round(performance.now());

/** Start a run: the script every fake draws from, the scenes the API scores against. Resets the engine and the log. */
export function setScript(s: Script, sceneMap: ReadonlyMap<string, Scene>): void {
  script = s;
  scenes = new Map(sceneMap);
  durations.clear();
  for (const sc of scenes.values()) durations.set(sc.audio.src, sc.audio.durationMs);
  log = [];
  takes = 0;
  engine?.reset();
}

/** What the fakes did so far in this run, one line per call: `<ms> <channel>=<outcome> <what>`. */
export function fakeLog(): readonly string[] {
  return log;
}

/** Add a line to the run's log (the explorer logs its taps there too). */
export function note(line: string): void {
  log.push(`${now()} ${line}`);
}

function draw<T extends string>(channel: string, outcome: T, what: string): T {
  note(`${channel}=${outcome} ${what}`);
  return outcome;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const never = <T>() => new Promise<T>(() => {});

// ---- The audio engine -----------------------------------------------------------------------------

const DEFAULT_CLIP_MS = 2500; // a clip whose length is unknown (questions, alternates, drills)
const VOICE_RATE: Record<string, number> = { squeaky: 1.3, deep: 0.8, wobble: 1.05, echo: 0.95 };

interface Current {
  id: number;
  outcome: AudioOutcome;
  startMs: number;
  endMs: number;
  fromMs: number;
  loop: boolean;
  gapMs: number;
  rate: number;
  t0: number;
}

/** A class with the public surface of audio/engine.ts's Engine; every play's outcome comes from the script. */
export function createFakeEngine(AudioLoadError: typeof AudioLoadErrorT) {
  const initial = (muted = false): AudioState => ({ src: null, playing: false, loading: false, loop: false, tag: null, startMs: 0, endMs: 0, positionMs: 0, unlocked: true, muted, overlay: null });
  return class FakeEngine {
    loopsHeard = 0;
    onLoopHeard: ((tag: string | null) => void) | null = null;
    private state: AudioState = initial();
    private listeners = new Set<(s: AudioState) => void>();
    private token = 0;
    private cur: Current | null = null;
    private timers: ReturnType<typeof setTimeout>[] = [];

    constructor() {
      engine = this; // eslint-disable-line @typescript-eslint/no-this-alias
    }

    reset(): void {
      this.halt();
      this.token++;
      this.loopsHeard = 0;
      this.state = initial();
    }

    async unlock(): Promise<void> {}
    isUnlocked(): boolean {
      return true;
    }
    isRunning(): boolean {
      return true;
    }
    async preload(): Promise<void> {}
    async load(): Promise<void> {}
    onPlayError: ((err: AudioLoadErrorT) => void) | null = null;
    isLoaded(): boolean {
      return true;
    }
    setMicOpen(): void {}
    sfx(): void {}

    setMuted(muted: boolean): void {
      if (muted === this.state.muted) return;
      if (muted) this.stop();
      this.state = { ...this.state, muted };
      this.emit();
    }
    isMuted(): boolean {
      return this.state.muted;
    }

    play(src: string, opts: Omit<PlayOptions, 'fromMs'> = {}): PlayHandle {
      return this.playRange(src, 0, Number.POSITIVE_INFINITY, opts);
    }

    playRange(src: string, startMs: number, endMs: number, opts: PlayOptions = {}): PlayHandle {
      this.halt();
      const id = ++this.token;
      const outcome = draw('audio', script.audio(), `${opts.loop ? 'loop' : 'play'} ${opts.tag ?? src}`);
      const end = Number.isFinite(endMs) ? endMs : startMs + (durations.get(src) ?? DEFAULT_CLIP_MS);
      const rate = (opts.rate && opts.rate > 0 ? opts.rate : 1) * (opts.voice ? (VOICE_RATE[opts.voice] ?? 1) : 1);
      const fromMs = Math.max(startMs, Math.min(end - 50, opts.fromMs ?? startMs));
      const gapMs = opts.gapMs ?? 350;
      this.cur = { id, outcome, startMs, endMs: end, fromMs, loop: !!opts.loop, gapMs, rate, t0: performance.now() };
      this.state = { ...this.state, src, playing: true, loading: outcome === 'never', loop: !!opts.loop, tag: opts.tag ?? null, startMs, endMs: end, positionMs: fromMs, overlay: opts.overlay?.src ?? null };
      this.emit();
      let resolve!: () => void;
      let reject!: (e: unknown) => void;
      const ready = new Promise<void>((a, b) => {
        resolve = a;
        reject = b;
      });
      ready.catch(() => {});
      const first = Math.max(50, end - fromMs) / rate;
      const each = Math.max(50, end - startMs) / rate;
      if (outcome === 'error') {
        this.later(40, () => {
          if (id !== this.token) return;
          this.cur = null;
          this.state = { ...this.state, playing: false, loading: false };
          this.emit();
          const e = new AudioLoadError(src, 0, `scripted load failure for ${src}`);
          opts.onError?.(e);
          reject(e);
        });
      } else if (outcome === 'end') {
        resolve();
        if (opts.loop) {
          // The first three rounds report to onIteration; the loop goes on silently after that. A loop
          // nobody listens to sets no timer, so it never keeps a test waiting.
          let at = first;
          if (opts.onIteration)
          for (let n = 1; n <= 3; n++) {
            const k = n;
            this.later(at, () => {
              if (id !== this.token) return;
              opts.onIteration?.(k);
              if (k === 2) {
                this.loopsHeard++;
                this.onLoopHeard?.(opts.tag ?? null);
              }
            });
            at += gapMs / rate + each;
          }
        } else {
          this.later(first, () => {
            if (id !== this.token) return;
            opts.onIteration?.(1);
            this.halt();
            this.state = { ...this.state, playing: false, positionMs: end };
            this.emit();
            opts.onEnd?.();
          });
        }
      }
      // 'never': a stalled load; no callback at all and `ready` never settles.
      return { id, ready, stop: () => id === this.token && this.stop(), isCurrent: () => id === this.token };
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

    getPositionMs(): number {
      const c = this.cur;
      if (!c || c.outcome !== 'end') return this.state.positionMs;
      const el = (performance.now() - c.t0) * c.rate;
      if (!c.loop) return Math.min(c.endMs, c.fromMs + el);
      const period = c.endMs - c.startMs + c.gapMs;
      const into = (el + (c.fromMs - c.startMs)) % period;
      return c.startMs + Math.min(into, c.endMs - c.startMs);
    }

    getState(): AudioState {
      return this.state;
    }

    clipHeardAt(clipMs: number): number | null {
      const c = this.cur;
      return c ? c.t0 + (clipMs - c.fromMs) / c.rate : null;
    }

    nowPlaying(): NowPlaying | null {
      const s = this.state;
      if (!s.playing || !s.src) return null;
      return { id: this.token, src: s.src, tag: s.tag, loop: s.loop, startMs: s.startMs, endMs: s.endMs };
    }

    subscribe(l: (s: AudioState) => void): () => void {
      this.listeners.add(l);
      return () => this.listeners.delete(l);
    }

    private emit(): void {
      for (const l of this.listeners) l(this.state);
    }

    private later(ms: number, f: () => void): void {
      this.timers.push(setTimeout(f, Math.round(ms)));
    }

    private halt(): void {
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
      this.cur = null;
    }
  };
}

// ---- The microphone -------------------------------------------------------------------------------

export function micSupported(): boolean {
  return script.mic !== 'unsupported';
}

const TAKE_MS: Record<'voice' | 'short' | 'cut', number> = { voice: 1600, short: 350, cut: 900 };

/** A class with the public surface of speech/recorder.ts's MicRecorder, as faithful as possible to how it stops. */
export function createFakeRecorder(MicError: typeof MicErrorT) {
  return class FakeMicRecorder {
    private resolveDone: ((t: Take | null) => void) | null = null;
    private finishing: Promise<Take | null> | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private outcome: TakeOutcome = 'voice';
    private startedAt = 0;
    private cancelled = false;

    get recording(): boolean {
      return !!this.resolveDone;
    }

    async start(opts: RecordOptions): Promise<void> {
      if (!micSupported()) throw new MicError('unsupported');
      this.cancelled = false;
      engine?.stop(); // the real recorder silences the French first
      if (script.mic === 'denied') {
        draw('take', 'denied', '');
        await sleep(300);
        throw new MicError('denied');
      }
      const o = draw('take', script.take(), `max ${opts.maxMs}`);
      await sleep(120); // the permission and the context opening
      if (this.cancelled) throw new MicError('error', 'cancelled');
      if (o === 'error') throw new MicError('error', 'scripted failure to open');
      this.outcome = o;
      this.startedAt = performance.now();
      this.finishing = new Promise((r) => (this.resolveDone = r));
      opts.onLevel?.(o === 'silent' ? 0 : 0.5, o !== 'silent');
      // A silent take runs to its limit (at most LISTEN_MAX_MS, as the real recorder clamps it).
      const ms = o === 'silent' || o === 'long' ? Math.min(opts.maxMs, LISTEN_MAX_MS) : TAKE_MS[o];
      this.timer = setTimeout(() => {
        this.timer = null;
        // Cut off (the audio context interrupted while the page is in view) ends like the real
        // recorder's interrupt(): an automatic stop with what was recorded so far, here too short (the kid
        // had just begun). (The page hidden drops the take: a visibilitychange, not a scripted outcome.)
        opts.onAutoStop?.();
        void this.stop();
      }, Math.min(ms, opts.maxMs));
    }

    async stop(): Promise<Take | null> {
      const done = this.finishing;
      const resolve = this.resolveDone;
      if (!resolve) return done ?? null;
      this.resolveDone = null;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      if (this.cancelled) {
        resolve(null);
        return null;
      }
      const durationMs = Math.round(performance.now() - this.startedAt);
      const url = `blob:liveness-take-${++takes}`;
      durations.set(url, Math.max(300, durationMs));
      const problem = this.outcome === 'silent' ? 'silent' : this.outcome === 'short' || this.outcome === 'cut' ? 'short' : null;
      const take: Take = { wav: new Blob(['RIFF'], { type: 'audio/wav' }), url, durationMs, problem };
      resolve(take);
      return take;
    }

    cancel(): void {
      this.cancelled = true;
      if (this.resolveDone) void this.stop();
      else if (this.timer !== null) clearTimeout(this.timer);
    }
  };
}

// ---- The API client -------------------------------------------------------------------------------

const SPEECH_MS = 1500; // a normal answer (Whisper, sometimes the judge)
const SLOW_MS = 10_000;

function candidatesOf(q: SpeechQuery): string[] {
  const scene = scenes.get(q.scene);
  if (!scene) return [''];
  const altsOf = (id: string) => ((scene.lines.find((l) => l.id === id) as { alternates?: { fr: string }[] } | undefined)?.alternates ?? []).map((a) => a.fr);
  if (q.line) return [scene.lines.find((l) => l.id === q.line)?.fr ?? ''];
  if (q.unit) return [scene.lines.flatMap((l) => l.units).find((u) => u.id === q.unit)?.fr ?? ''];
  if (q.alt) {
    const i = q.alt.lastIndexOf(':');
    return [altsOf(q.alt.slice(0, i))[Number(q.alt.slice(i + 1))] ?? ''];
  }
  if (q.choice) return [scene.lines.find((l) => l.id === q.choice)?.fr ?? '', ...altsOf(q.choice)];
  return [''];
}

function speechAnswer(q: SpeechQuery, outcome: 'pass' | 'partial' | 'fail'): SpeechResponse {
  const cands = candidatesOf(q);
  const kind = q.unit ? 'unit' : 'line';
  const pick = q.choice ? script.rng.int(cands.length) : 0;
  const target = cands[pick] ?? '';
  const words = target.split(/\s+/).filter(Boolean);
  const transcript = outcome === 'pass' ? target : outcome === 'partial' ? words.slice(0, Math.max(1, Math.floor(words.length / 2))).join(' ') : 'euh';
  const scored = cands.map((c) => scoreSpeech(c, transcript, { kind }));
  const sc = scored[pick]!;
  const pass = outcome === 'pass';
  return {
    transcript,
    score: pass ? Math.max(sc.score, 0.9) : Math.min(sc.score, 0.4),
    pass,
    matched: sc.expectedWords.map((word, i) => ({ word, ok: outcome === 'fail' ? false : outcome === 'pass' ? true : !!sc.matched[i] })),
    expectedWords: sc.expectedWords,
    heardWords: sc.heardWords,
    ...(q.choice ? { choice: { index: pick, scores: scored.map((x, i) => (i === pick && pass ? Math.max(x.score, 0.9) : Math.min(x.score, 0.4))) } } : {}),
    patch: {},
  };
}

const API_METHODS = [
  'gate', 'session', 'login', 'me', 'patchMe', 'daily', 'unlock', 'startPractice', 'completePractice', 'practiceProgress', 'viewScene', 'events',
  'openChest', 'shop', 'buy', 'search', 'follow', 'unfollow', 'friends', 'gift', 'inbox', 'league',
] as const satisfies readonly (keyof ApiClient)[];

/** An ApiClient whose answers come from the script: `speech` per SpeechOutcome, every other call per CallOutcome. */
export function createFakeApi(ApiRequestError: typeof ApiRequestErrorT): ApiClient {
  const other = (name: string) => async () => {
    const o = draw('call', script.call(), name);
    if (o === 'hang') return never();
    await sleep(150);
    if (o === 'fail') throw new ApiRequestError(500, 'internal', `scripted failure of ${name}`);
    return { patch: {} };
  };
  const api = Object.fromEntries(API_METHODS.map((m) => [m, other(m)])) as unknown as ApiClient;
  api.speech = async (q) => {
    const target = q.unit ? `unit ${q.unit}` : q.line ? `line ${q.line}` : q.choice ? `choice ${q.choice}` : q.alt ? `alt ${q.alt}` : '?';
    const o = draw('speech', script.speech(), `${target} attempt ${q.attempt ?? '-'}`);
    switch (o) {
      case 'hang':
        return never();
      case 'offline':
        await sleep(50);
        throw new ApiRequestError(0, 'offline', 'scripted: fetch failed');
      case 'unavailable':
        await sleep(SPEECH_MS);
        throw new ApiRequestError(503, 'speech-unavailable');
      case 'error':
        await sleep(SPEECH_MS);
        throw new ApiRequestError(500, 'internal', 'scripted server error');
      case 'slow':
        await sleep(SLOW_MS);
        return speechAnswer(q, 'pass');
      default:
        await sleep(SPEECH_MS);
        return speechAnswer(q, o);
    }
  };
  return api;
}

// ---- Animations ------------------------------------------------------------------------------------

/**
 * Element.animate on the fake clock: happy-dom's animations finish on its own real timers, so under
 * fake timers an awaited animation (catapult's boulder) never ended. This one ends after its
 * duration × iterations, like a browser; an infinite one never ends.
 */
export function fakeAnimate(this: Element, _frames: unknown, options?: number | KeyframeAnimationOptions): Animation {
  const o = typeof options === 'number' ? { duration: options } : (options ?? {});
  const total = (Number(o.delay) || 0) + (Number(o.duration) || 0) * (o.iterations ?? 1) + (Number(o.endDelay) || 0);
  const anim = new EventTarget() as EventTarget & Record<string, unknown>;
  let resolve!: (a: unknown) => void;
  let reject!: (e: unknown) => void;
  const finished = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  finished.catch(() => {});
  const fire = (name: 'finish' | 'cancel') => {
    const ev = new Event(name);
    (anim[`on${name}`] as ((e: Event) => void) | null)?.(ev);
    anim.dispatchEvent(ev);
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const finish = () => {
    if (anim.playState !== 'running') return;
    if (timer !== null) clearTimeout(timer);
    anim.playState = 'finished';
    resolve(anim);
    fire('finish');
  };
  Object.assign(anim, {
    playState: 'running', onfinish: null, oncancel: null, onremove: null, finished, ready: Promise.resolve(anim), effect: { target: this }, currentTime: 0, playbackRate: 1,
    finish,
    cancel: () => {
      if (anim.playState === 'idle') return;
      if (timer !== null) clearTimeout(timer);
      anim.playState = 'idle';
      reject(new DOMException('The animation was canceled.', 'AbortError'));
      fire('cancel');
    },
    play: () => {}, pause: () => {}, reverse: () => {}, persist: () => {}, commitStyles: () => {}, updatePlaybackRate: () => {},
  });
  if (Number.isFinite(total)) timer = setTimeout(finish, Math.max(0, total));
  return anim as unknown as Animation;
}

/** Replaces Element.prototype.animate with fakeAnimate (call once per test file). */
export function installFakeAnimate(): void {
  Element.prototype.animate = fakeAnimate as typeof Element.prototype.animate;
}
