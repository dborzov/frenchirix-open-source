/// <reference types="node" />
// The liveness explorer (`npm run check:liveness`, docs/checks.md): plays every registered puzzle type
// inside the real practice screen (PracticeRunner) on scenes of the bundle, under fake timers, with
// the audio engine, the recorder and the API replaced by scripted fakes (./fakes.ts), and looks for
// puzzles a kid cannot finish. Each run: wait until nothing is pending, then tap one enabled control of
// the puzzle pane chosen by a seeded rng (wrong moves are fine: puzzles cannot be failed), until the
// puzzle is done or a cap is reached. Escape hatches ("Je ne peux pas parler") are never tapped.
//
// Kinds of run: done; slow (done, but SLOW_MS of waiting beyond TAP_MS per tap); stuck (nothing to
// tap, nothing pending); escape-only (stuck, and "Je ne peux pas parler", tapped at the end, gets the
// kid out); livelock (not done within MAX_STEPS taps or TIME_CAP_MS); crash (an exception, an
// unhandled rejection or console.error). tools/liveness/run.ts starts this file through its own
// vitest config, reads the runs it writes (LIVENESS_OUT) and compares them with the ledger.
// The environment variables (LIVENESS_TYPE, _SEED, _SCENARIO, _DATA, _OUT) come from run.ts.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, it, vi } from 'vitest';
import type { ContentIndex, Scene } from '../../../shared/content';
import { createRng } from '../../../shared/practice/rng';
import type { Practice, PuzzleBase } from '../../../shared/practice/types';
import { PracticeRunner } from '../practice/PracticeRunner';
import { allPuzzleEntries, type PuzzleEntry } from '../puzzles/registry';
import { fakeLog, fixedScript, installFakeAnimate, note, randomScript, setScript, type FixedOutcomes, type Script } from './fakes';
import type { Run, RunKind } from './liveness-types';

vi.mock('../audio/engine', async (orig) => {
  const actual = await orig<typeof import('../audio/engine')>();
  return { ...actual, Engine: (await import('./fakes')).createFakeEngine(actual.AudioLoadError) };
});
vi.mock('../speech/recorder', async (orig) => {
  const actual = await orig<typeof import('../speech/recorder')>();
  const f = await import('./fakes');
  return { ...actual, MicRecorder: f.createFakeRecorder(actual.MicError), micSupported: f.micSupported };
});
vi.mock('../api', async (orig) => {
  const actual = await orig<typeof import('../api')>();
  return { ...actual, api: (await import('./fakes')).createFakeApi(actual.ApiRequestError) };
});

// ---- Limits (fake time) ---------------------------------------------------------------------------

// Taps. The tapper has no memory, so a memory board takes it many taps, and the trophies (once a pair
// is found) take half of them: on the largest board (6 pairs) a simulation of this tapper needed over
// 400 taps in 5% of runs, over 627 in 0.1%, and never more than 1000 in 20,000.
const MAX_STEPS = 1000;
const TIME_CAP_MS = 15 * 60_000;
const SLOW_MS = 80_000; // done, but the puzzle kept the kid waiting this long (beyond TAP_MS per tap)
const TAP_MS = 2000; // what one tap may cost (its animation, a line it replays): a clumsy kid's many taps are not the puzzle's slowness
const SETTLE_CAP_MS = 20_000; // the longest wait before tapping something anyway
const GRACE_MS = 400; // after the last timeout: frames and promises get a chance to schedule more
const FIDGET = 0.25; // the chance that the kid taps something while the puzzle is still busy (after SETTLE_CAP_MS)

/** Data attributes that name a view's state; the signature of a finding is made of them. */
const STATE_ATTRS = ['data-step', 'data-phase', 'data-status', 'data-stage', 'data-mode', 'data-chain-status', 'data-speak', 'data-record', 'data-mic-denied', 'data-speak-note', 'data-mic', 'data-chain-note'];
const STATE_FLAGS = ['data-mic-intro', 'data-listen-back', 'data-chain-end'];
/** Attributes that differ per item or give the answer away: never part of a control's name. */
const NOISE_ATTRS = new Set(['data-next', 'data-correct', 'data-correct-fr', 'data-pair', 'data-winner', 'data-shown', 'data-k', 'data-index']);

// ---- Scenarios ------------------------------------------------------------------------------------

/**
 * Fixed scenarios pin one channel and keep the rest favourable; random ones draw every outcome.
 * `taps` are controls (by name) the kid taps first, in order, each as soon as it is there, even while
 * the puzzle is busy (Pause while the microphone listens); `name@text` waits until the view's state
 * contains the text too (`mic-pause@mic=listening`). Then the seeded tapper goes on.
 */
type Scenario = FixedOutcomes & { taps?: string[] };
const SPEAK_FIXED: Record<string, Scenario> = {
  'all-pass': {},
  'all-fail': { speech: 'fail' },
  'all-partial': { speech: 'partial' },
  'all-unavailable': { speech: 'unavailable' },
  'speech-blip': { speech: ['unavailable', 'pass'] }, // one 503, then the server answers again
  'speech-hang': { speech: 'hang' },
  'speech-slow': { speech: 'slow' },
  'audio-never': { audio: 'never' },
  'no-recognition-audio-never': { speech: 'unavailable', audio: 'never' }, // listen-back with plays that never end
  'audio-error': { audio: 'error' },
  'mic-denied': { mic: 'denied' },
  'mic-unsupported': { mic: 'unsupported' },
  'mic-intro': { mic: 'intro' },
  'silent-takes': { take: 'silent' },
  'cut-takes': { take: 'cut' },
  'cut-after-miss': { speech: 'fail', take: ['voice', 'cut'] }, // a missed try, then every take cut off (the page hidden)
  'blip-then-hang': { speech: ['unavailable', 'hang'] }, // one 503, then the server never answers (say-chain ignored its timeout)
  'blip-then-silent': { speech: 'unavailable', take: ['voice', 'silent'] }, // no recognition, then silent takes (say-chain ignored them)
  'mic-error-once': { take: ['error', 'voice'] }, // the microphone fails to open once, then works (« Réessayer »)
  'take-limit': { take: 'long' }, // the kid talks on: every take ends at its limit (at most 10 s) and is sent as it is
  'silent-then-voice': { take: ['silent', 'silent', 'voice'] }, // two takes with no voice (no try, the nudge), then a voice
  'pause-resume': { taps: ['mic-pause@mic=opening', 'record', 'mic-pause@mic=listening', 'record'] }, // Pause while the microphone opens, go on, Pause while it listens, go on
  'pause-silent': { take: 'silent', taps: ['mic-pause@mic=listening', 'record'] }, // Pause, go on, then takes with no voice until the microphone's notice
};
const TAP_FIXED: Record<string, Scenario> = { 'audio-end': {}, 'audio-error': { audio: 'error' }, 'audio-never': { audio: 'never' } };
const FIXED_SEEDS = [1, 2]; // a phone and a tablet
const env = process.env;
const SPEAK_RANDOM = Number(env.LIVENESS_RANDOM_SPEAK ?? 24);
const TAP_RANDOM = Number(env.LIVENESS_RANDOM_TAP ?? 6);

function scriptFor(scenario: string, seed: number, speaking: boolean): { script: Script; taps: string[] } {
  if (scenario === 'random') return { script: randomScript(seed, speaking ? undefined : 'audio'), taps: [] };
  const fixed = (speaking ? SPEAK_FIXED : TAP_FIXED)[scenario] ?? SPEAK_FIXED[scenario];
  if (!fixed) throw new Error(`unknown scenario "${scenario}" (fixed: ${Object.keys(speaking ? SPEAK_FIXED : TAP_FIXED).join(', ')}, or random)`);
  const { taps = [], ...outcomes } = fixed;
  return { script: fixedScript(seed, outcomes), taps: [...taps] };
}

function plan(speaking: boolean): { scenario: string; seed: number }[] {
  if (env.LIVENESS_SEED) return [{ scenario: env.LIVENESS_SCENARIO || 'random', seed: Number(env.LIVENESS_SEED) }];
  const fixed = Object.keys(speaking ? SPEAK_FIXED : TAP_FIXED).flatMap((scenario) => FIXED_SEEDS.map((seed) => ({ scenario, seed })));
  const n = speaking ? SPEAK_RANDOM : TAP_RANDOM;
  const random = Array.from({ length: n }, (_, i) => ({ scenario: 'random', seed: 1000 + i }));
  return env.LIVENESS_SCENARIO ? [...fixed, ...random].filter((p) => p.scenario === env.LIVENESS_SCENARIO) : [...fixed, ...random];
}

// ---- The bundle -----------------------------------------------------------------------------------

const appDir = env.LIVENESS_APP_DIR || process.cwd(); // set by tools/liveness/vitest.config.ts
const dataDir = env.LIVENESS_DATA || join(appDir, 'public/data');
if (!existsSync(join(dataDir, 'index.json'))) {
  throw new Error(`check:liveness: no content bundle at ${dataDir}. Regenerate it from the repository root: .venv/bin/frenchirix export-app --data-only`);
}
const index = JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8')) as ContentIndex;
const loadScene = (id: string) => JSON.parse(readFileSync(join(dataDir, 'scenes', `${id}.json`), 'utf8')) as Scene;
const releasePath = join(appDir, 'data/release.json');
const releaseIds = existsSync(releasePath) ? (JSON.parse(readFileSync(releasePath, 'utf8')) as { scenes: string[] }).scenes : index.scenes.map((s) => s.id);
const sceneIds = releaseIds.filter((id) => index.scenes.some((s) => s.id === id) && existsSync(join(dataDir, 'scenes', `${id}.json`)));
if (!sceneIds.length) throw new Error(`check:liveness: none of the release scenes is in the bundle at ${dataDir}`);
const sceneCache = new Map<string, Scene>();
const scene = (id: string) => sceneCache.get(id) ?? sceneCache.set(id, loadScene(id)).get(id)!;

/** One puzzle of this type on a scene and level chosen by the seed (the first scene where it builds). */
function buildFor(entry: PuzzleEntry, seed: number): { practice: Practice; scenes: Map<string, Scene>; sceneId: string; level: number } | null {
  const type = entry.logic.type;
  const meta = entry.logic.meta;
  const rng = createRng(seed).fork(`liveness:scene:${type}`);
  for (const id of rng.shuffle(sceneIds).slice(0, 15)) {
    const sc = scene(id);
    const level = meta.minLevel + rng.int(Math.max(1, meta.maxLevel - meta.minLevel + 1));
    const others = index.scenes.filter((x) => x.id !== id && x.episode === sc.episode && sceneIds.includes(x.id)).slice(0, 2).map((x) => scene(x.id));
    const built = entry.logic.build({ scene: sc, level, rng: createRng(seed).fork(`liveness:build:${type}`), focusUnitIds: new Set(), others, bank: index.bank, usedLineIds: new Set(), usedUnitIds: new Set() });
    if (!built) continue;
    const puzzle: PuzzleBase = { ...built, id: `${id}:p1:${type}` };
    const practice: Practice = { id: 'liveness', seed, kind: 'scene', entries: [{ sceneId: id, level, due: true }], puzzles: [puzzle] };
    return { practice, scenes: new Map([sc, ...others].map((x) => [x.id, x])), sceneId: id, level };
  }
  return null;
}

// ---- Time -----------------------------------------------------------------------------------------

/** Pending one-shot timeouts (intervals and animation frames run forever and do not count). */
function trackTimeouts() {
  const set0 = globalThis.setTimeout;
  const clear0 = globalThis.clearTimeout;
  const due = new Map<unknown, number>();
  globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const id: unknown = set0(() => {
      due.delete(id);
      if (typeof fn === 'function') fn(...args);
    }, ms);
    due.set(id, Date.now() + Math.max(0, Number(ms) || 0));
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: unknown) => {
    due.delete(id);
    clear0(id as Parameters<typeof clearTimeout>[0]);
  }) as typeof clearTimeout;
  return {
    nextDue: () => (due.size ? Math.min(...due.values()) : null),
    restore: () => {
      globalThis.setTimeout = set0;
      globalThis.clearTimeout = clear0;
    },
  };
}

const nowMs = () => Date.now();

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Let the puzzle run by itself until nothing is pending ('idle') or SETTLE_CAP_MS passed ('busy'), or
 * until a scripted tap's control is there ('scripted'), checked at least every 250 ms of fake time.
 */
async function settle(clock: ReturnType<typeof trackTimeouts>, until: number, scripted?: () => boolean): Promise<'idle' | 'busy' | 'scripted'> {
  const end = Math.min(until, nowMs() + SETTLE_CAP_MS);
  while (nowMs() < end) {
    if (scripted?.()) return 'scripted';
    const due = clock.nextDue();
    if (due === null) {
      await advance(GRACE_MS);
      if (clock.nextDue() === null) return 'idle';
      continue;
    }
    await advance(Math.max(1, Math.min(due - nowMs(), end - nowMs(), scripted ? 250 : 1000)));
  }
  return 'busy';
}

installFakeAnimate();

// ---- Reading the screen ---------------------------------------------------------------------------

interface Control {
  el: HTMLElement;
  name: string;
  escape: boolean;
}

function reactProps(el: Element): Record<string, unknown> | null {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
  return key ? ((el as unknown as Record<string, Record<string, unknown>>)[key] ?? null) : null;
}

function controlName(el: HTMLElement): string {
  for (const a of el.getAttributeNames()) if (a.startsWith('data-') && !NOISE_ATTRS.has(a)) return a.slice(5);
  const role = el.getAttribute('role');
  return role && role !== el.tagName.toLowerCase() ? `${el.tagName.toLowerCase()}[${role}]` : el.tagName.toLowerCase();
}

/** Every enabled element of the puzzle pane with a tap handler. */
function controls(): Control[] {
  const pane = document.querySelector('[data-puzzle-pane]');
  if (!pane) return [];
  const out: Control[] = [];
  for (const el of pane.querySelectorAll<HTMLElement>('*')) {
    const p = reactProps(el);
    if (!p || !(p.onClick || p.onPointerDown || p.onPointerUp || p.onMouseDown || p.onTouchStart || p.onTouchEnd)) continue;
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[inert], fieldset[disabled]')) continue;
    out.push({ el, name: controlName(el), escape: !!el.closest('[data-cant-speak]') });
  }
  return out;
}

const ENUM = /^[a-z][a-z-]{0,24}$/;
/** The view's state, from its state attributes: `step=back speak=idle …` (sorted, deduplicated). */
function viewState(): string {
  const pane = document.querySelector('[data-puzzle-pane]');
  if (!pane) return '(no puzzle pane)';
  const parts = new Set<string>();
  for (const el of pane.querySelectorAll('*')) {
    for (const a of STATE_ATTRS) {
      const v = el.getAttribute(a);
      if (v !== null) parts.add(ENUM.test(v) ? `${a.slice(5)}=${v}` : a.slice(5));
    }
    for (const a of STATE_FLAGS) if (el.hasAttribute(a)) parts.add(a.slice(5));
  }
  return [...parts].sort().join(' ') || '-';
}

const names = (cs: Control[]) => [...new Set(cs.map((c) => c.name))].sort().join(' ') || 'none';

async function tap(el: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(el);
    fireEvent.mouseDown(el);
    fireEvent.pointerUp(el);
    fireEvent.mouseUp(el);
    fireEvent.click(el);
  });
}

// ---- One run --------------------------------------------------------------------------------------

function normalizeError(msg: string): string {
  return msg
    .split('\n')[0]!
    .replace(/s\d\de\d\d-[\d-]+(:p\d+:[a-z-]+)?/g, '<id>')
    .replace(/\d+/g, 'N')
    .replace(/"[^"]*"|'[^']*'/g, '…')
    .slice(0, 120);
}

const errors: string[] = [];
let crashSeen = false;
function onUnhandled(e: unknown) {
  errors.push(`unhandled: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
  crashSeen = true;
}

async function explore(entry: PuzzleEntry, scenario: string, seed: number): Promise<Run> {
  const type = entry.logic.type;
  const speaking = entry.logic.meta.needsMic;
  const layout = seed % 2 ? 'phone' : 'tablet';
  const base = { type, scenario, seed, layout } as const;
  const built = buildFor(entry, seed);
  if (!built) return { ...base, sceneId: null, level: null, kind: 'no-build', signature: `${type} no-build`, state: '-', controls: '-', escape: 'none', ms: 0, steps: 0, log: [] };
  const { script, taps } = scriptFor(scenario, seed, speaking);
  const happy = (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM;
  happy.setViewport(layout === 'phone' ? { width: 390, height: 844 } : { width: 1024, height: 768 });
  try {
    localStorage.clear();
  } catch {
    /* none */
  }
  if (script.mic !== 'intro') localStorage.setItem('frx.mic.intro', '1');
  errors.length = 0;
  crashSeen = false;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'], now: 0 });
  const clock = trackTimeouts();
  setScript(script, built.scenes);
  const consoleError = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    // React logs render errors as console.error('%o …', error): name the error, not the format string.
    const e = a.find((x): x is Error => x instanceof Error);
    errors.push(e ? `${e.name}: ${e.message}` : a.map(String).join(' '));
  });
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => note(`warn ${a.map(String).join(' ').slice(0, 160)}`));
  let finished = false;
  let escape: Run['escape'] = 'none';
  const pick = createRng(seed).fork(`liveness:taps:${type}:${scenario}`);
  const states: string[] = [];
  let steps = 0;
  let kind: RunKind = 'done';
  let last = { state: '-', controls: '-' };
  const puzzleId = built.practice.puzzles[0]!.id;
  let ms = 0;
  const isDone = () => finished || !!document.querySelector('[data-continue]') || !document.querySelector(`[data-puzzle="${puzzleId}"]`);
  try {
    const complete = () => {
      finished = true;
      return new Promise<never>(() => {});
    };
    await act(async () => {
      render(<Harness practice={built.practice} scenes={built.scenes} complete={complete} />);
    });
    const scriptedNow = () => {
      if (!taps.length) return undefined;
      const [name, when] = taps[0]!.split('@') as [string, string | undefined];
      if (when && !viewState().includes(when)) return undefined;
      return controls().find((c) => !c.escape && c.name === name);
    };
    for (;;) {
      const s = await settle(clock, TIME_CAP_MS, taps.length ? () => !!scriptedNow() : undefined);
      const cs = controls();
      last = { state: viewState(), controls: names(cs) };
      states.push(last.state);
      if (errors.length || crashSeen) {
        kind = 'crash';
        break;
      }
      if (isDone()) {
        kind = nowMs() - steps * TAP_MS > SLOW_MS ? 'slow' : 'done';
        break;
      }
      if (nowMs() >= TIME_CAP_MS || steps >= MAX_STEPS) {
        kind = 'livelock';
        break;
      }
      const choices = cs.filter((c) => !c.escape);
      const planned = s === 'scripted' ? scriptedNow() : undefined;
      if (planned) {
        taps.shift();
        note(`tap ${planned.name} (scripted; state: ${last.state})`);
        await tap(planned.el);
        steps++;
        continue;
      }
      if (s === 'busy' && (!choices.length || pick.next() >= FIDGET)) continue; // a patient kid waits
      if (!choices.length) {
        kind = 'stuck';
        break;
      }
      // A kind of control first, then one of that kind: twenty boxes of a dialogue must not drown the one button.
      const kinds = [...new Set(choices.map((x) => x.name))].sort();
      const kindNow = pick.pick(kinds);
      const c = pick.pick(choices.filter((x) => x.name === kindNow));
      note(`tap ${c.name} (state: ${last.state})`);
      await tap(c.el);
      steps++;
    }
    ms = nowMs();
    // A dead end: does the escape hatch still get the kid out? Stuck but for it is a finding of its own kind.
    const esc = kind === 'stuck' || kind === 'livelock' ? controls().find((c) => c.escape) : undefined;
    if (esc) {
      note(`tap ${esc.name} (the escape)`);
      await tap(esc.el);
      await settle(clock, nowMs() + SETTLE_CAP_MS);
      escape = isDone() ? 'works' : 'fails';
      if (kind === 'stuck' && escape === 'works') kind = 'escape-only';
    }
  } catch (e) {
    kind = 'crash';
    errors.push(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  } finally {
    ms ||= nowMs();
    try {
      cleanup();
      // Run what is pending once with nothing mounted (an animation-frame loop resets its module state
      // when its last frame runs), so the next run starts as fresh as a replay of it alone.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
    } catch (e) {
      note(`after unmount: ${e instanceof Error ? e.message : String(e)}`);
    }
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    clock.restore();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  }
  const error = kind === 'crash' ? errors[0] : undefined;
  // Where it ended: the last state for a stuck run; for a livelock, the state it kept coming back to.
  let where = last.state;
  if (kind === 'livelock') {
    const tail = states.slice(-30);
    const count = new Map<string, number>();
    for (const st of tail) count.set(st, (count.get(st) ?? 0) + 1);
    where = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? last.state;
  }
  const signature =
    kind === 'crash' ? `${type} crash ${normalizeError(error ?? '?')}` :
    kind === 'slow' ? `${type} slow` :
    kind === 'livelock' ? `${type} livelock ${where}${escape === 'fails' ? ' | escape fails' : ''}` :
    kind === 'stuck' || kind === 'escape-only' ? `${type} ${kind} ${where} | ${last.controls}` :
    `${type} ${kind}`;
  const all = env.LIVENESS_SEED ? [...fakeLog()] : fakeLog().slice(-40);
  return { type, scenario, seed, sceneId: built.sceneId, level: built.level, layout, kind, signature, state: last.state, controls: last.controls, escape, ms, steps, ...(error ? { error } : {}), log: all };
}

/** The practice screen as the app mounts it, with the "Je ne peux pas parler" switch working. */
function Harness({ practice, scenes, complete }: { practice: Practice; scenes: Map<string, Scene>; complete: () => Promise<never> }) {
  const [speak, setSpeak] = useState(true);
  return <PracticeRunner practice={practice} scenes={scenes} speak={speak} onSpeakChange={setSpeak} complete={complete} onExit={() => {}} onFinish={() => {}} />;
}

// ---- The suite ------------------------------------------------------------------------------------

const wanted = (env.LIVENESS_TYPE ?? '').split(',').filter(Boolean);
const entries = allPuzzleEntries().filter((e) => !wanted.length || wanted.includes(e.logic.type));
if (wanted.length && entries.length !== wanted.length) {
  const known = allPuzzleEntries().map((e) => e.logic.type);
  throw new Error(`check:liveness: unknown puzzle type in ${wanted.join(',')} (registered: ${known.join(', ')})`);
}
// LIVENESS_SHARD=k/n: run.ts starts n processes; this one plays every n-th type (speaking ones first, they cost most).
const [shard, shards] = (env.LIVENESS_SHARD ?? '0/1').split('/').map(Number) as [number, number];
const mine = [...entries].sort((a, b) => Number(b.logic.meta.needsMic) - Number(a.logic.meta.needsMic) || a.logic.type.localeCompare(b.logic.type)).filter((_, i) => i % shards === shard);
const runs: Run[] = [];
const out = env.LIVENESS_OUT || join(appDir, 'test-results/liveness.raw.json');

process.on('unhandledRejection', onUnhandled);
process.on('uncaughtException', onUnhandled);

describe('liveness', () => {
  if (!mine.length) it('(no puzzle type in this shard)', () => {});
  for (const entry of mine) {
    it(entry.logic.type, { timeout: 600_000 }, async () => {
      for (const p of plan(entry.logic.meta.needsMic)) runs.push(await explore(entry, p.scenario, p.seed));
    });
  }
});

afterAll(() => {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ types: mine.map((e) => e.logic.type), runs }, null, 1));
  process.off('unhandledRejection', onUnhandled);
  process.off('uncaughtException', onUnhandled);
});
