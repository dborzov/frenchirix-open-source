// Time helpers for scenes. Every puzzle type that loops French uses these, so lines with estimated word
// times (`approxTimes`) get the right window everywhere.
import type { Line, Scene, Unit } from '../../../shared/content';

export interface Window {
  startMs: number;
  endMs: number;
}

/** The whole line: from the earliest of the line and its first unit to the latest of both. */
export function lineWindow(line: Line): Window {
  let a = line.startMs;
  let b = line.endMs;
  for (const u of line.units) {
    if (line.approxTimes) break; // estimated unit windows can spill: trust the line times
    a = Math.min(a, u.startMs);
    b = Math.max(b, u.endMs);
  }
  return { startMs: Math.max(0, a), endMs: b };
}

/**
 * The window to loop when a unit is tapped. For a line with `approxTimes` the unit's window is an
 * estimate that can play the wrong words, so the whole line loops instead.
 */
export function loopWindowFor(line: Line, unit: Unit): Window {
  if (line.approxTimes) return lineWindow(line);
  return { startMs: unit.startMs, endMs: unit.endMs };
}

/** True when the unit's own window can be trusted (word-exact puzzle types skip units where it is false). */
export function hasExactTimes(line: Line): boolean {
  return !line.approxTimes;
}

/** The tag the strip and puzzle types use for a looping unit, line or scene (audio PlayOptions.tag). */
export const tags = {
  unit: (id: string) => `unit:${id}`,
  line: (id: string) => `line:${id}`,
  scene: (id: string) => `scene:${id}`,
  /** A piece of a puzzle whose place in the scene is the answer (place-words' tray): the bar and the slideshow do not follow it. */
  piece: (id: string) => `piece:${id}`,
};

export function findLine(scene: Scene, lineId: string): Line | undefined {
  return scene.lines.find((l) => l.id === lineId);
}

export function findUnit(scene: Scene, unitId: string): { line: Line; unit: Unit } | undefined {
  const lineId = unitId.slice(0, unitId.lastIndexOf(':'));
  const line = findLine(scene, lineId);
  const unit = line?.units.find((u) => u.id === unitId);
  return line && unit ? { line, unit } : undefined;
}

/** The line being spoken at ms (or the last one started before it), among the given lines. */
export function lineAt(lines: Line[], ms: number): Line | undefined {
  let cur: Line | undefined;
  for (const l of lines) {
    const w = lineWindow(l);
    if (w.startMs <= ms + 40) cur = l;
    if (ms >= w.startMs && ms <= w.endMs) return l;
  }
  return cur && ms <= lineWindow(cur).endMs + 400 ? cur : undefined;
}

/** Key of the word spoken at ms: '<unit id>#<word index>', or null. Lines with approxTimes never match. */
export function wordKeyAt(lines: Line[], ms: number): string | null {
  for (const l of lines) {
    if (l.approxTimes) continue;
    const w = lineWindow(l);
    if (ms < w.startMs - 50 || ms > w.endMs + 50) continue;
    for (const u of l.units) {
      for (let i = 0; i < u.words.length; i++) {
        const wd = u.words[i]!;
        if (ms >= wd.startMs - 30 && ms <= wd.endMs + 30) return `${u.id}#${i}`;
      }
    }
  }
  return null;
}

/** Audio windows a line plays in, playing a whole scene clip once ('scene'). */
export function sceneWindow(scene: Scene): Window {
  return { startMs: 0, endMs: scene.audio.durationMs };
}
