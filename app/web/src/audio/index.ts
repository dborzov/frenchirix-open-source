// The audio engine (docs/app-games.md, "Audio"; docs/app-architecture.md, "Client basics").
//
//   audio.playRange(scene.audio.src, unit.startMs, unit.endMs, { loop: true, tag: `unit:${unit.id}` });
//   audio.play(unit.drill!);          // a whole file, once
//   audio.play(q.audio!, { voice: q.voice, loop: true, onError: () => loopTheLineInstead() });  // a static clip
//   audio.playRange(src, a, b, { tag, ...onceDone(next, b - a, later) });  // a play a step waits on: next() once, on end, error or a timer
//   audio.stop();
//   audio.sfx('right');               // effects bus: never stops the French
//
// In React: useAudioState() (re-renders on start/stop), useNowPlaying() (what is playing, with its
// tag), useAudioClock(select) (the live position, per animation frame; pass a selector so the
// component only re-renders when the selected value changes), useStopAudioOnUnmount().
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Bytes } from '../media/fetchMedia';
import { Engine, type AudioLoadError, type AudioState, type NowPlaying, type PlayHandle, type PlayOptions, type SfxName } from './engine';

export { AudioLoadError, VOICES, type Overlay } from './engine';
export { MEDIA_SLOW_MS, MEDIA_TIMEOUT_MS, MediaLoadError, type Bytes } from '../media/fetchMedia';
export { DEFAULT_LOOP_STYLE, LOOP_STYLES, type LoopStyle, type LoopStyleId } from './loopStyle';
export { onceDone, PLAY_SLACK_MS } from './onceDone';
export type { AudioState, NowPlaying, PlayHandle, PlayOptions, SfxName, VoicePreset } from './engine';

export interface AudioEngine {
  /** Call from a user gesture once (the app does it on the first touch). Safe to call again. */
  unlock(): Promise<void>;
  /** True once unlocked and the context is running (sound will be heard). */
  isUnlocked(): boolean;
  preload(src: string | string[]): Promise<void>;
  /** Fetch and decode one clip into the cache with its download's progress; rejects with an AudioLoadError (a stall becomes a timeout). */
  load(src: string, onProgress?: (b: Bytes) => void): Promise<void>;
  isLoaded(src: string): boolean;
  /** Play src from startMs to endMs (ms in the clip). Stops whatever was playing. */
  playRange(src: string, startMs: number, endMs: number, opts?: PlayOptions): PlayHandle;
  /** Play a whole file (v1 word drills, generated speech). Stops whatever was playing. */
  play(src: string, opts?: Omit<PlayOptions, 'fromMs'>): PlayHandle;
  /** The foundation's name for play(). */
  playFile(src: string, opts?: Omit<PlayOptions, 'fromMs' | 'loop' | 'gapMs'>): PlayHandle;
  stop(): void;
  getState(): AudioState;
  getPositionMs(): number;
  /** When position clipMs of the current play is heard, in performance.now() ms (null when nothing plays). */
  clipHeardAt(clipMs: number): number | null;
  nowPlaying(): NowPlaying | null;
  subscribe(listener: (s: AudioState) => void): () => void;
  /** A sound effect on the effects bus (synthesised or one of /media/sfx). */
  sfx(name: SfxName): void;
  /** Microphone open: audio session play-and-record; closed: playback. */
  setMicOpen(open: boolean): void;
  /** The mute switch (remembered on the device). */
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Loops heard so far (a looping play that reached its second round). */
  loopsHeard(): number;
}

const engine = new Engine();

export const audio: AudioEngine = {
  unlock: () => engine.unlock(),
  isUnlocked: () => engine.isUnlocked(),
  preload: (src) => engine.preload(src),
  load: (src, onProgress) => engine.load(src, onProgress),
  isLoaded: (src) => engine.isLoaded(src),
  playRange: (src, a, b, opts) => engine.playRange(src, a, b, opts),
  play: (src, opts) => engine.play(src, opts),
  playFile: (src, opts) => engine.play(src, opts),
  stop: () => engine.stop(),
  getState: () => engine.getState(),
  getPositionMs: () => engine.getPositionMs(),
  clipHeardAt: (ms) => engine.clipHeardAt(ms),
  nowPlaying: () => engine.nowPlaying(),
  subscribe: (l) => engine.subscribe(l),
  sfx: (name) => engine.sfx(name),
  setMicOpen: (open) => engine.setMicOpen(open),
  loopsHeard: () => engine.loopsHeard,
  setMuted: (m) => engine.setMuted(m),
  isMuted: () => engine.isMuted(),
};

/**
 * Called when the clip of the current play failed to load (not for `quiet` plays): the app shows the kid
 * a message with the detail line (main.tsx), so a tapped play never fails in silence.
 */
export function onPlayError(cb: ((err: AudioLoadError) => void) | null): void {
  engine.onPlayError = cb;
}

/** Hook for the events batcher: called each time a loop is heard (tag of the play). */
export function onLoopHeard(cb: ((tag: string | null) => void) | null): void {
  engine.onLoopHeard = cb;
}

// Tests and dev pages can reach the engine (also used by the Playwright checks).
if (typeof window !== 'undefined' && import.meta.env?.DEV) (window as unknown as { __frxAudio: AudioEngine }).__frxAudio = audio;

// ---- hooks -------------------------------------------------------------------------------------

const subscribeState = (cb: () => void) => engine.subscribe(cb);
const getStateSnap = () => engine.getState();

/** The engine state; re-renders when a play starts, loads, ends or stops (not per frame). */
export function useAudioState(): AudioState {
  return useSyncExternalStore(subscribeState, getStateSnap, getStateSnap);
}

/** What is playing now (null when nothing). Compare `tag` to know whether your box is the one looping. */
export function useNowPlaying(): NowPlaying | null {
  const s = useAudioState();
  if (!s.playing || !s.src) return null;
  return { id: 0, src: s.src, tag: s.tag, loop: s.loop, startMs: s.startMs, endMs: s.endMs };
}

/** True while the play tagged `tag` is the current one. */
export function useIsPlaying(tag: string): boolean {
  const s = useAudioState();
  return s.playing && s.tag === tag;
}

/**
 * True while the play tagged `tag` is the current one and its clip is still downloading or decoding:
 * its control shows a busy state, never "pause" or "playing" (nothing is heard yet).
 */
export function useIsLoading(tag: string): boolean {
  const s = useAudioState();
  return s.loading && s.tag === tag;
}

// The clock: one shared requestAnimationFrame loop while something plays and someone listens.
const clockListeners = new Set<() => void>();
let rafId = 0;
let clockMs = 0;
function tick() {
  rafId = 0;
  const next = engine.getPositionMs();
  if (next !== clockMs) {
    clockMs = next;
    for (const l of clockListeners) l();
  }
  if (clockListeners.size && engine.getState().playing) rafId = requestAnimationFrame(tick);
}
function ensureTicking() {
  if (!rafId && clockListeners.size && typeof requestAnimationFrame !== 'undefined') rafId = requestAnimationFrame(tick);
}
engine.subscribe(() => {
  clockMs = engine.getPositionMs();
  for (const l of clockListeners) l();
  ensureTicking();
});
function subscribeClock(cb: () => void) {
  clockListeners.add(cb);
  ensureTicking();
  return () => {
    clockListeners.delete(cb);
  };
}

/**
 * The live position (ms in the active clip), updated per animation frame while playing.
 * With a selector, the component re-renders only when the selected value changes:
 *   const wordKey = useAudioClock((ms) => wordAt(line, ms));
 */
export function useAudioClock(): number;
export function useAudioClock<T>(select: (ms: number, state: AudioState) => T): T;
export function useAudioClock<T>(select?: (ms: number, state: AudioState) => T): T | number {
  const sel = useRef(select);
  sel.current = select;
  const cache = useRef<{ ms: number; st: AudioState; v: T | number } | null>(null);
  const get = () => {
    const st = engine.getState();
    const c = cache.current;
    if (c && c.ms === clockMs && c.st === st) return c.v;
    const v = sel.current ? sel.current(clockMs, st) : clockMs;
    // Keep the previous value object when equal, so useSyncExternalStore does not loop.
    const out = c && Object.is(c.v, v) ? c.v : v;
    cache.current = { ms: clockMs, st, v: out };
    return out;
  };
  return useSyncExternalStore(subscribeClock, get, get);
}

/** Stops the French when the component unmounts (every puzzle type screen and the practice shell use it). */
export function useStopAudioOnUnmount(): void {
  useEffect(() => () => engine.stop(), []);
}

/** True while the mute switch is on (re-renders when it changes). */
export function useMuted(): boolean {
  return useAudioState().muted;
}
