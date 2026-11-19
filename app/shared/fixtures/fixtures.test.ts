import { describe, expect, it } from 'vitest';
import { applyPatch, mergePatches, type StatePatch } from '../api';
import { ITEMS_BY_ID } from '../catalog';
import { DAILY_CANDIDATES } from '../rules';
import { FIXTURE_INDEX, FIXTURE_PLAYER, FIXTURE_SCENE, fixtureSceneFor } from './index';

describe('fixture scene', () => {
  const scene = FIXTURE_SCENE;

  it('units cover every word of each line, in order, with spans matching the text', () => {
    for (const line of scene.lines) {
      let pos = 0;
      for (const u of line.units) {
        expect(u.id.startsWith(`${line.id}:`)).toBe(true);
        expect(u.cs).toBeGreaterThanOrEqual(pos);
        expect(line.fr.slice(u.cs, u.ce)).toBe(u.fr);
        expect(line.fr.slice(pos, u.cs)).toMatch(/^[\s,.!?;:«»—-]*$/);
        for (const w of u.words) {
          expect(line.fr.slice(w.cs, w.ce)).toBe(w.fr);
          expect(w.startMs).toBeGreaterThanOrEqual(u.startMs);
          expect(w.endMs).toBeLessThanOrEqual(u.endMs);
        }
        pos = u.ce;
      }
      expect(line.fr.slice(pos)).toMatch(/^[\s,.!?;:«»—-]*$/);
    }
  });

  it('every time window lies inside the audio', () => {
    for (const line of scene.lines) {
      expect(line.startMs).toBeGreaterThanOrEqual(0);
      expect(line.endMs).toBeLessThanOrEqual(scene.audio.durationMs);
      for (const u of line.units) {
        expect(u.startMs).toBeGreaterThanOrEqual(line.startMs);
        expect(u.endMs).toBeLessThanOrEqual(line.endMs);
      }
    }
    for (const f of scene.frames) expect(f.t).toBeLessThanOrEqual(scene.audio.durationMs);
  });

  it('every question has exactly one correct answer', () => {
    for (const q of scene.questions) expect(q.answers.filter((a) => a.correct)).toHaveLength(1);
  });
});

describe('fixture index', () => {
  it('has 5 episodes whose scene ids are the index scenes in timeline order', () => {
    expect(FIXTURE_INDEX.episodes).toHaveLength(5);
    const byId = new Map(FIXTURE_INDEX.scenes.map((s) => [s.id, s]));
    for (const ep of FIXTURE_INDEX.episodes) {
      ep.sceneIds.forEach((id, i) => {
        const s = byId.get(id)!;
        expect(s.episode).toBe(ep.id);
        expect(s.order).toBe(i);
      });
    }
    expect(FIXTURE_INDEX.scenes).toHaveLength(203);
  });

  it('includes the fixture scene with its own summary', () => {
    const s = FIXTURE_INDEX.scenes.find((x) => x.id === FIXTURE_SCENE.id)!;
    expect(s.titleFr).toBe(FIXTURE_SCENE.titleFr);
    expect(fixtureSceneFor(FIXTURE_SCENE.id)).toBe(FIXTURE_SCENE);
    expect(fixtureSceneFor('s01e01-0004-0008')?.id).toBe('s01e01-0004-0008');
    expect(fixtureSceneFor('nope')).toBeNull();
  });
});

describe('fixture player', () => {
  it('refers only to scenes and items that exist', () => {
    const ids = new Set(FIXTURE_INDEX.scenes.map((s) => s.id));
    for (const id of Object.keys(FIXTURE_PLAYER.progress)) expect(ids.has(id), id).toBe(true);
    for (const o of FIXTURE_PLAYER.daily.candidates) {
      expect(ids.has(o.sceneId)).toBe(true);
      expect(FIXTURE_PLAYER.progress[o.sceneId]).toBeUndefined();
    }
    expect(FIXTURE_PLAYER.daily.candidates).toHaveLength(DAILY_CANDIDATES);
    for (const id of Object.keys(FIXTURE_PLAYER.inventory)) expect(ITEMS_BY_ID.has(id)).toBe(true);
  });
});

describe('applyPatch', () => {
  const s0 = FIXTURE_PLAYER;

  it('returns the same state for an empty patch', () => {
    expect(applyPatch(s0, undefined)).toBe(s0);
    expect(applyPatch(s0, {})).toEqual(s0);
  });

  it('merges, replaces and removes as documented, without mutating', () => {
    const before = JSON.stringify(s0);
    const patch: StatePatch = {
      profile: { name: 'zoe' },
      currencies: { sesterces: 99 },
      progress: { 's01e02-0003-0008': { level: 0, dueDay: null, passes: 0, unlockedDay: '2026-11-13', views: 0, lastPassDay: null }, 's01e05-0017-0022': null },
      inventory: { 'squeaky-lyre': 0, 'polka-dot-toga': 1 },
      chests: { remove: ['c_fixture01'], add: [{ id: 'c2', kind: 'gold', source: 'quest', earnedDay: '2026-11-13' }] },
      stats: { practicesFinished: 8 },
      league: null,
      inboxUnread: 0,
    };
    const s1 = applyPatch(s0, patch);
    expect(JSON.stringify(s0)).toBe(before);
    expect(s1.profile.name).toBe('zoe');
    expect(s1.profile.pin).toBe(s0.profile.pin);
    expect(s1.currencies).toEqual({ ...s0.currencies, sesterces: 99 });
    expect(s1.progress['s01e02-0003-0008']?.unlockedDay).toBe('2026-11-13');
    expect(s1.progress['s01e05-0017-0022']).toBeUndefined();
    expect(s1.progress['s01e04-0016-0017']).toEqual(s0.progress['s01e04-0016-0017']);
    expect(s1.inventory).toEqual({ 'winged-helmet': 1, 'polka-dot-toga': 1 });
    expect(s1.chests.map((c) => c.id)).toEqual(['c2']);
    expect(s1.stats.practicesFinished).toBe(8);
    expect(s1.stats.loopsHeard).toBe(s0.stats.loopsHeard);
    expect(s1.league).toBeNull();
    expect(s1.inboxUnread).toBe(0);
  });

  it('mergePatches has the effect of applying both in order', () => {
    const a: StatePatch = { currencies: { xp: 200 }, inventory: { x: 1 }, chests: { add: [{ id: 'c3', kind: 'wood', source: 'quest', earnedDay: '2026-11-13' }] } };
    const b: StatePatch = { currencies: { sesterces: 1 }, inventory: { y: 2 }, chests: { remove: ['c3'] } };
    expect(applyPatch(s0, mergePatches(a, b))).toEqual(applyPatch(applyPatch(s0, a), b));
  });
});
