import { beforeEach, describe, expect, it } from 'vitest';
import type { ContentIndex, Scene, SceneSummary } from '../shared/content';
import { FIXTURE_INDEX, fixtureSceneFor } from '../shared/fixtures';
import { createRng } from '../shared/practice/rng';
import { addDays, DAILY_CANDIDATES } from '../shared/rules';
import { setContentForTests, type Content } from './content';
import { drawCandidates } from './daily';
import { Browser, freshWorld } from './testing';

beforeEach(freshWorld);

// A small index: 30 ordinary scenes, and two starter songs of 3 scenes each plus a non-starter song.
function summary(id: string, order: number, over: Partial<SceneSummary> = {}): SceneSummary {
  return { id, episode: id.slice(0, 6), order, startMs: order * 1000, durationMs: 15000, kind: 'dialogue', titleFr: id, titleEn: id, score: 3, difficulty: 3, thumb: '', lineCount: 3, wordCount: 20, ...over };
}
const id = (ep: number, n: number) => `s01e0${ep}-${String(n * 10).padStart(4, '0')}-${String(n * 10 + 5).padStart(4, '0')}`;
const scenes: SceneSummary[] = [
  ...Array.from({ length: 30 }, (_, i) => summary(id(1, i + 1), i, { score: 3 + (i % 3), difficulty: 1 + (i % 4) })),
  ...[1, 2, 3].map((n) => summary(id(3, n), n, { kind: 'song', songId: 'dreams', score: 5, difficulty: 1 })),
  ...[1, 2, 3].map((n) => summary(id(4, n), n, { kind: 'song', songId: 'romans', score: 5, difficulty: 2 })),
  ...[1, 2].map((n) => summary(id(2, n), n, { kind: 'song', songId: 'other', score: 5, difficulty: 2 })),
];
const INDEX: ContentIndex = {
  version: 't',
  episodes: [],
  scenes,
  songs: [
    { id: 'dreams', episode: 's01e03', titleFr: 'd', titleEn: 'd', durationMs: 1, thumb: '', starter: true },
    { id: 'romans', episode: 's01e04', titleFr: 'r', titleEn: 'r', durationMs: 1, thumb: '', starter: true },
    { id: 'other', episode: 's01e02', titleFr: 'o', titleEn: 'o', durationMs: 1, thumb: '' },
  ],
  bank: { lines: [], units: [] },
};
const content = (index: ContentIndex): Content => ({
  index,
  byId: new Map(index.scenes.map((s) => [s.id, s])),
  sceneIds: index.scenes.map((s) => s.id),
  ranges: new Map(),
});
const byId = new Map(scenes.map((s) => [s.id, s]));

describe('daily candidates: songs first', () => {
  it('day one: one scene of each starter song, preferring its earliest, and the rest by the first-day rule', () => {
    const firsts = new Map<string, number>();
    for (let seed = 0; seed < 200; seed++) {
      const candidates = drawCandidates(content(INDEX), new Map(), 1.5, createRng(seed)).map((x) => byId.get(x)!);
      expect(candidates).toHaveLength(DAILY_CANDIDATES);
      expect(new Set(candidates.map((s) => s.id)).size).toBe(DAILY_CANDIDATES);
      expect(candidates.filter((s) => s.songId === 'dreams')).toHaveLength(1);
      expect(candidates.filter((s) => s.songId === 'romans')).toHaveLength(1);
      for (const s of candidates.filter((s) => s.songId === 'dreams')) firsts.set(s.id, (firsts.get(s.id) ?? 0) + 1);
    }
    expect(firsts.get(id(3, 1))!).toBeGreaterThan(firsts.get(id(3, 3)) ?? 0);
  });

  it('later days: at least one song scene while one is locked, then the usual weighting', () => {
    const someUnlocked = new Map([[id(1, 1), {}]]);
    for (let seed = 0; seed < 100; seed++) {
      const candidates = drawCandidates(content(INDEX), someUnlocked, 2, createRng(seed)).map((x) => byId.get(x)!);
      expect(candidates.some((s) => s.kind === 'song')).toBe(true);
    }
    // Every song scene unlocked but one: that one is always offered.
    const allButOne = new Map(scenes.filter((s) => s.kind === 'song' && s.id !== id(2, 2)).map((s) => [s.id, {}]));
    for (let seed = 0; seed < 20; seed++) expect(drawCandidates(content(INDEX), allButOne, 2, createRng(seed))).toContain(id(2, 2));
    // No song scene locked: ordinary scenes only.
    const allSongs = new Map(scenes.filter((s) => s.kind === 'song').map((s) => [s.id, {}]));
    const candidates = drawCandidates(content(INDEX), allSongs, 2, createRng(1));
    expect(candidates).toHaveLength(DAILY_CANDIDATES);
  });

  it('without starter songs (the fixture content) falls back to the old first-day rule', () => {
    const candidates = drawCandidates(content(FIXTURE_INDEX), new Map(), 1.5, createRng(3)).map((x) => FIXTURE_INDEX.scenes.find((s) => s.id === x)!);
    expect(candidates).toHaveLength(DAILY_CANDIDATES);
    for (const s of candidates) expect(s.difficulty <= 2 && s.score >= 4).toBe(true);
  });

  it('day one with few easy scenes, or few locked scenes: fills up from the others, then offers what is left', () => {
    // Only the starter songs and two easy scenes: the rest of the draw comes from any scene.
    const hard = scenes.map((s) => (s.kind === 'song' ? s : { ...s, difficulty: 4 }));
    hard[0] = { ...hard[0]!, difficulty: 1, score: 4 };
    hard[1] = { ...hard[1]!, difficulty: 2, score: 5 };
    for (let seed = 0; seed < 50; seed++) {
      const c = drawCandidates(content({ ...INDEX, scenes: hard }), new Map(), 1.5, createRng(seed));
      expect(c).toHaveLength(DAILY_CANDIDATES);
      expect(new Set(c).size).toBe(DAILY_CANDIDATES);
      expect(c).toEqual(expect.arrayContaining([hard[0]!.id, hard[1]!.id]));
    }
    // Fewer locked scenes than a draw: every one of them, once.
    const few = scenes.slice(0, 4);
    expect(new Set(drawCandidates(content({ ...INDEX, scenes: few }), new Map(), 1.5, createRng(1))).size).toBe(4);
    expect(drawCandidates(content({ ...INDEX, scenes: few }), new Map([[few[0]!.id, {}]]), 1.5, createRng(1))).toHaveLength(3);
  });

  it('through the API: day one candidates both starter songs; a candidate watched before choosing counts nothing', async () => {
    setContentForTests({ index: INDEX, scene: (sid) => ({ ...fixtureSceneFor(FIXTURE_INDEX.scenes[0]!.id)!, ...byId.get(sid)! }) as Scene });
    const b = new Browser();
    const s = await b.start();
    const candidates: string[] = s.daily.candidates.map((o: any) => o.sceneId);
    expect(candidates.filter((x) => byId.get(x)!.songId === 'dreams')).toHaveLength(1);
    expect(candidates.filter((x) => byId.get(x)!.songId === 'romans')).toHaveLength(1);
    const candidate = candidates[0]!;
    expect(await b.ok('POST', `/api/scenes/${candidate}/view`, {})).toEqual({ patch: {} });
    expect((await b.json('POST', '/api/practices/start', { kind: 'scene', sceneId: candidate })).body.error).toBe('scene-locked');
    expect((await b.json('POST', `/api/speech?scene=${candidate}&line=x`, new Uint8Array(100))).body.error).toBe('scene-locked');
    const me = (await b.ok('GET', '/api/me')).state;
    expect(me.currencies.xp).toBe(0);
    expect(me.progress).toEqual({});
    expect(me.stats.scenesViewed ?? 0).toBe(0);
    b.at(addDays('2026-11-13', 1));
    await b.ok('POST', '/api/daily/unlock', { sceneId: (await b.ok('GET', '/api/daily')).daily.candidates[0].sceneId });
  });
});
