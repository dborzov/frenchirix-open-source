// Loop styles: how a looped window is cut and faded. An experiment for the user's ears
// (/dev/loops); style A is today's behaviour and stays the default until they choose.
//
//   A  the window as given, 8 ms linear fade in and out (the original engine)
//   B  the same window, longer shaped fades inside it (raised cosine, ~40 ms in, ~120 ms out)
//   C  a padded window (pre/post), the fades filling the padding, so the unit itself is untouched
//   D  C, with the cut points moved to the quietest moment inside the padding (RMS scan)
//   E  D, with a long exponential release after the unit (~250 ms), a longer gap, optional low-pass
//
// Everything here is pure planning plus one scheduling function used by both the live engine and
// the offline renders, so what is measured is what is played. All automation is on the audio clock.

export type LoopStyleId = 'A' | 'B' | 'C' | 'D' | 'E';

export interface LoopStyle {
  id: LoopStyleId;
  fadeInMs: number; // A, B: fade-in length inside the window
  fadeOutMs: number; // A, B: fade-out length inside the window
  preMs: number; // C, D, E: padding before the unit
  postMs: number; // C, D: padding after the unit
  releaseMs: number; // E: release after the unit
  gapMs: number; // silence between repetitions
  lowpass: boolean; // E: a light low-pass sweep during the release
}

export const LOOP_STYLES: Record<LoopStyleId, LoopStyle> = {
  A: { id: 'A', fadeInMs: 8, fadeOutMs: 8, preMs: 0, postMs: 0, releaseMs: 0, gapMs: 350, lowpass: false },
  B: { id: 'B', fadeInMs: 40, fadeOutMs: 120, preMs: 0, postMs: 0, releaseMs: 0, gapMs: 350, lowpass: false },
  C: { id: 'C', fadeInMs: 0, fadeOutMs: 0, preMs: 120, postMs: 200, releaseMs: 0, gapMs: 350, lowpass: false },
  D: { id: 'D', fadeInMs: 0, fadeOutMs: 0, preMs: 120, postMs: 200, releaseMs: 0, gapMs: 350, lowpass: false },
  E: { id: 'E', fadeInMs: 0, fadeOutMs: 0, preMs: 120, postMs: 200, releaseMs: 250, gapMs: 450, lowpass: false },
};

/**
 * The style every loop uses when playRange gets none. The user chose D on /dev/loops (2026-11-14):
 * pad 120 ms before and 200 ms after, fades filling the padding (raised cosine), cuts moved to the
 * quietest moment inside it, gap 350 ms. Non-looping plays keep A (a single play has no seam).
 */
export const DEFAULT_LOOP_STYLE: LoopStyleId = 'D';

export type Curve = 'linear' | 'cosine' | 'exp';

/** One repetition, in buffer seconds. Fades are [start, end] in buffer seconds too. */
export interface LoopPlan {
  style: LoopStyle;
  unitS: [number, number]; // the window asked for
  playS: [number, number]; // what is played (cut points)
  fadeIn: { from: number; to: number; curve: Curve };
  fadeOut: { from: number; to: number; curve: Curve };
  lowpass: boolean;
  gapS: number;
}

/** True when this style's plan for that window is already computed (D and E scan the buffer). */
export function planReady(startS: number, endS: number, styleIn: LoopStyleId | Partial<LoopStyle> | undefined, cacheKey: string): boolean {
  const style = resolveStyle(styleIn);
  if (style.id !== 'D' && style.id !== 'E') return true;
  return planCache.has(`${cacheKey}|${startS}|${endS}|${JSON.stringify(style)}`);
}

export function resolveStyle(style: LoopStyleId | Partial<LoopStyle> | undefined): LoopStyle {
  if (!style) return LOOP_STYLES[DEFAULT_LOOP_STYLE];
  if (typeof style === 'string') return LOOP_STYLES[style];
  const base = LOOP_STYLES[style.id ?? DEFAULT_LOOP_STYLE];
  return { ...base, ...style, id: base.id };
}

/** Minimal view of an AudioBuffer (so planning is testable without Web Audio). */
export interface PcmLike {
  sampleRate: number;
  duration: number;
  numberOfChannels: number;
  getChannelData(ch: number): Float32Array;
}

const RMS_WIN_S = 0.012;
const RMS_HOP_S = 0.002;

/** Mean-square energy of all channels around t (a window of RMS_WIN_S). */
export function energyAt(buf: PcmLike, t: number, winS = RMS_WIN_S): number {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor((t - winS / 2) * sr));
  const b = Math.min(Math.floor(buf.duration * sr), Math.ceil((t + winS / 2) * sr));
  if (b <= a) return 0;
  let sum = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = a; i < b; i++) sum += d[i]! * d[i]!;
  }
  return sum / ((b - a) * buf.numberOfChannels);
}

/** RMS in dBFS over [t0, t1]. */
export function rmsDb(buf: PcmLike, t0: number, t1: number): number {
  const e = energyAt(buf, (t0 + t1) / 2, Math.max(0.001, t1 - t0));
  return 10 * Math.log10(e + 1e-12);
}

/** The quietest moment in [a, b] (RMS scan); ties go to the point nearest `prefer`. */
export function quietestPoint(buf: PcmLike, a: number, b: number, prefer: number): number {
  if (b - a < RMS_HOP_S) return prefer;
  let best = prefer;
  let bestE = Infinity;
  for (let t = a; t <= b + 1e-9; t += RMS_HOP_S) {
    // A slight bias towards `prefer` so a flat silence does not push the cut to the far edge.
    const e = energyAt(buf, t) * (1 + 0.15 * Math.abs(t - prefer) / Math.max(1e-3, b - a));
    if (e < bestE) {
      bestE = e;
      best = t;
    }
  }
  return best;
}

const planCache = new Map<string, LoopPlan>();
const MIN_FADE_IN_S = 0.04;
const MIN_FADE_OUT_S = 0.08;

/** Plan one repetition of [startS, endS] in this style. D and E scan the buffer (cached per window). */
export function planLoop(buf: PcmLike, startS: number, endS: number, styleIn: LoopStyleId | Partial<LoopStyle> | undefined, cacheKey?: string): LoopPlan {
  const style = resolveStyle(styleIn);
  const dur = buf.duration;
  const gapS = Math.max(0, style.gapMs / 1000);
  const len = endS - startS;
  if (style.id === 'A' || style.id === 'B') {
    // A keeps the original engine's rule exactly: each fade at most a quarter of the window.
    const fi = Math.min(style.fadeInMs / 1000, style.id === 'A' ? len / 4 : len / 3);
    const fo = Math.min(style.fadeOutMs / 1000, style.id === 'A' ? len / 4 : len / 2);
    const curve: Curve = style.id === 'A' ? 'linear' : 'cosine';
    return { style, unitS: [startS, endS], playS: [startS, endS], fadeIn: { from: startS, to: startS + fi, curve }, fadeOut: { from: endS - fo, to: endS, curve }, lowpass: false, gapS };
  }
  const key = cacheKey ? `${cacheKey}|${startS}|${endS}|${JSON.stringify(style)}` : null;
  const hit = key ? planCache.get(key) : undefined;
  if (hit) return hit;
  const pre = style.preMs / 1000;
  const post = style.id === 'E' ? Math.max(style.postMs, style.releaseMs + 40) / 1000 : style.postMs / 1000;
  let a = Math.max(0, startS - pre);
  let b = Math.min(dur, endS + post);
  if (style.id === 'D' || style.id === 'E') {
    // The cut moves to the quietest moment, but never so close to the unit that the fade has no
    // room: at least MIN_FADE_IN before it and MIN_FADE_OUT (or most of E's release) after it.
    const inRoom = Math.min(MIN_FADE_IN_S, startS - a);
    a = quietestPoint(buf, a, startS - inRoom, a);
    const outRoom = style.id === 'E' ? (style.releaseMs / 1000) * 0.8 : Math.min(MIN_FADE_OUT_S, b - endS);
    const searchFrom = Math.min(b, endS + outRoom);
    b = quietestPoint(buf, searchFrom, b, b);
  }
  const minFade = 0.004;
  const fadeIn = { from: a, to: Math.max(a + minFade, startS), curve: 'cosine' as Curve };
  const fadeOut = style.id === 'E'
    ? { from: Math.min(endS, b - minFade), to: b, curve: 'exp' as Curve }
    : { from: Math.min(endS, b - minFade), to: b, curve: 'cosine' as Curve };
  if (fadeIn.to > fadeOut.from) {
    const mid = (fadeIn.from + fadeOut.to) / 2;
    fadeIn.to = mid;
    fadeOut.from = mid;
  }
  const plan: LoopPlan = { style, unitS: [startS, endS], playS: [a, b], fadeIn, fadeOut, lowpass: style.id === 'E' && style.lowpass, gapS };
  if (key) planCache.set(key, plan);
  return plan;
}

/** A fade-out shape: 1 at x = 0, 0 at x = 1. Fade-ins are the mirror (down(1 - x)). */
export function fadeDown(curve: Curve, x: number): number {
  const k = 5; // exponential steepness: about -43 dB two thirds of the way
  if (curve === 'linear') return 1 - x;
  if (curve === 'cosine') return 0.5 + 0.5 * Math.cos(Math.PI * x);
  return (Math.exp(-k * x) - Math.exp(-k)) / (1 - Math.exp(-k));
}

/** The gain curve of a fade (0..1 or 1..0), n points. */
export function fadeCurve(curve: Curve, up: boolean, n = 64): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    out[i] = up ? fadeDown(curve, 1 - x) : fadeDown(curve, x);
  }
  // Exact ends: silence at the cut points.
  out[up ? 0 : n - 1] = 0;
  out[up ? n - 1 : 0] = 1;
  return out;
}

/** The envelope value at buffer time t (for drawing and tests). */
export function envelopeAt(plan: LoopPlan, t: number): number {
  const { fadeIn: fi, fadeOut: fo } = plan;
  if (t <= plan.playS[0] || t >= plan.playS[1]) return 0;
  let g = 1;
  if (t < fi.to) g = Math.min(g, fadeDown(fi.curve, 1 - (t - fi.from) / Math.max(1e-6, fi.to - fi.from)));
  if (t > fo.from) g = Math.min(g, fadeDown(fo.curve, (t - fo.from) / Math.max(1e-6, fo.to - fo.from)));
  return Math.max(0, Math.min(1, g));
}

export interface Scheduled {
  src: AudioBufferSourceNode;
  env: GainNode;
  nodes: AudioNode[];
  when: number;
  offsetS: number;
  durS: number;
  realS: number;
}

/**
 * Schedule one repetition at `when` on ctx (live or offline): source -> [low-pass] -> envelope -> out.
 * `fromS` starts the first repetition later inside the play window (the scene player resumes).
 */
export function scheduleRepetition(ctx: BaseAudioContext, out: AudioNode, buffer: AudioBuffer, plan: LoopPlan, when: number, rate: number, fromS?: number): Scheduled {
  const [a, b] = plan.playS;
  const start = fromS !== undefined ? Math.max(a, Math.min(b - 0.02, fromS)) : a;
  const durS = Math.max(0.02, b - start);
  const realS = durS / rate;
  const toCtx = (bufT: number) => when + (bufT - start) / rate;
  const env = ctx.createGain();
  env.connect(out);
  const g = env.gain;
  const nodes: AudioNode[] = [env];
  // Curves (setValueCurveAtTime) must not overlap any other event, so the start value is the
  // param's intrinsic value and touching curves leave a 0.1 ms gap.
  const resumed = start > plan.fadeIn.from;
  g.value = resumed ? 1 : 0;
  let fadeInEnd = when;
  if (!resumed) {
    const t0 = toCtx(plan.fadeIn.from);
    const d = Math.max(0.001, (plan.fadeIn.to - plan.fadeIn.from) / rate);
    if (plan.fadeIn.curve === 'linear') {
      g.setValueAtTime(0, t0);
      g.linearRampToValueAtTime(1, t0 + d);
    } else g.setValueCurveAtTime(fadeCurve(plan.fadeIn.curve, true), t0, d);
    fadeInEnd = t0 + d;
  } else g.setValueAtTime(1, when);
  const t1 = Math.max(fadeInEnd + 0.0001, toCtx(Math.max(start, plan.fadeOut.from)));
  const d1 = Math.max(0.001, toCtx(plan.fadeOut.to) - t1);
  if (plan.fadeOut.curve === 'linear') {
    g.setValueAtTime(1, t1);
    g.linearRampToValueAtTime(0, t1 + d1);
  } else g.setValueCurveAtTime(fadeCurve(plan.fadeOut.curve, false), t1, d1);
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.playbackRate.value = rate;
  if (plan.lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.5;
    f.frequency.setValueAtTime(18000, when);
    f.frequency.setValueAtTime(18000, t1);
    f.frequency.exponentialRampToValueAtTime(1200, t1 + d1);
    s.connect(f);
    f.connect(env);
    nodes.push(f);
  } else s.connect(env);
  s.start(when, start, durS);
  s.stop(when + realS + 0.02);
  return { src: s, env, nodes, when, offsetS: start, durS, realS };
}

// ---- offline measurement --------------------------------------------------------------------------

export interface SeamReport {
  style: LoopStyleId;
  playMs: [number, number];
  /** |sample| at the first and last instants the envelope is open (0 = starts and ends in silence). */
  firstSample: number;
  lastSample: number;
  /** The largest sample-to-sample step within 3 ms of a seam, relative to the largest step inside the unit. */
  seamStepRatio: number;
  /** Output level (dBFS) in the 20 ms before the end of a repetition and the 20 ms after the start of the next. */
  tailDb: number;
  headDb: number;
}

/** Render three repetitions offline and measure the seams. */
export async function measureSeams(buffer: AudioBuffer, startS: number, endS: number, style: LoopStyleId | Partial<LoopStyle>, cacheKey?: string): Promise<SeamReport> {
  const plan = planLoop(buffer, startS, endS, style, cacheKey);
  const sr = buffer.sampleRate;
  const rep = plan.playS[1] - plan.playS[0];
  const total = 0.05 + 3 * (rep + plan.gapS) + 0.05;
  const Ctor = (window as unknown as { OfflineAudioContext: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new Ctor(buffer.numberOfChannels, Math.ceil(total * sr), sr);
  const starts: number[] = [];
  let when = 0.05;
  for (let i = 0; i < 3; i++) {
    scheduleRepetition(ctx, ctx.destination, buffer, plan, when, 1);
    starts.push(when);
    when += rep + plan.gapS;
  }
  const out = await ctx.startRendering();
  const ch = out.getChannelData(0);
  const at = (t: number) => Math.round(t * sr);
  // First and last open samples of the middle repetition.
  const s0 = at(starts[1]!);
  const s1 = at(starts[1]! + rep);
  let first = 0;
  for (let i = s0; i < s1; i++) if (ch[i] !== 0) { first = Math.abs(ch[i]!); break; }
  let last = 0;
  for (let i = s1; i > s0; i--) if (ch[i] !== 0) { last = Math.abs(ch[i]!); break; }
  const maxStep = (a: number, b: number) => {
    let m = 0;
    for (let i = Math.max(1, a); i < Math.min(ch.length, b); i++) m = Math.max(m, Math.abs(ch[i]! - ch[i - 1]!));
    return m;
  };
  const w = at(0.003);
  const seam = Math.max(maxStep(s0 - w, s0 + w), maxStep(s1 - w, s1 + w));
  const inside = maxStep(at(starts[1]! + (plan.unitS[0] - plan.playS[0])), at(starts[1]! + (plan.unitS[1] - plan.playS[0])));
  const lvl = (a: number, b: number) => {
    let sum = 0;
    for (let i = a; i < b; i++) sum += ch[i]! * ch[i]!;
    return 10 * Math.log10(sum / Math.max(1, b - a) + 1e-12);
  };
  return {
    style: plan.style.id,
    playMs: [Math.round(plan.playS[0] * 1000), Math.round(plan.playS[1] * 1000)],
    firstSample: first,
    lastSample: last,
    seamStepRatio: inside > 0 ? seam / inside : 0,
    tailDb: lvl(s1 - at(0.02), s1),
    headDb: lvl(s0, s0 + at(0.02)),
  };
}
