import { beforeEach, describe, expect, it } from 'vitest';
import { definitionOf, forgetKid, SCHEMA_KEY, STORE_SCHEMA, sweepStorage } from './stored';

const outcome = { puzzleId: 't1', type: 'watch', sceneId: 's01e04-0016-0017', unitIds: [], missedUnitIds: [], mistakes: 0, hints: 0, skipped: false, ms: 1000 };
const progress = { puzzleIndex: 2, outcomes: [outcome], ms: 3000 };

describe('the stored-data rule', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('knows every key the app writes, and none of v1', () => {
    expect(definitionOf('session', 'frx.practice.progress.L1')?.policy).toBe('reset');
    expect(definitionOf('local', 'frenchirix.onb.welcome')?.policy).toBe('flag');
    expect(definitionOf('local', 'frx.mic.intro')?.policy).toBe('flag');
    expect(definitionOf('local', 'frx.pwa.welcomeBack')?.kid).toBe(true);
    expect(definitionOf('local', 'frx.pwa.offer')?.kid).toBeUndefined();
    for (const v1 of ['playerCards', 'playerQuests', 'questFinished', 'questStarted', 'todaysChallenges', 'lastCheck', 'cardClaimedDate']) expect(definitionOf('local', v1)).toBeUndefined();
  });

  it('drops the old queues of practice saves and the plan copies of earlier builds', () => {
    localStorage.setItem('frx.practice.pending', JSON.stringify({ L0: { outcomes: [outcome], ms: 1 } }));
    localStorage.setItem('frx.practice.progressPending', JSON.stringify({ L0: { done: 3, outcomes: [] } }));
    sessionStorage.setItem('frx.practice.plan.L1', '{}');
    sessionStorage.setItem('frx.practice.progress.L1', JSON.stringify(progress));
    localStorage.setItem('playerCards', '[1,2,3]');
    const r = sweepStorage(localStorage, sessionStorage);
    expect(r.removed.sort()).toEqual(['frx.practice.pending', 'frx.practice.plan.L1', 'frx.practice.progressPending']);
    expect(localStorage.getItem(SCHEMA_KEY)).toBe(String(STORE_SCHEMA));
    expect(sessionStorage.getItem('frx.practice.progress.L1')).not.toBeNull();
    expect(localStorage.getItem('playerCards')).toBe('[1,2,3]'); // v1 data is left alone
  });

  it('when the schema changes, drops resumable progress and keeps flags', () => {
    localStorage.setItem(SCHEMA_KEY, '1');
    localStorage.setItem('frenchirix.onb.welcome', '1');
    sessionStorage.setItem('frx.practice.progress.L1', JSON.stringify(progress));
    const r = sweepStorage(localStorage, sessionStorage, 2);
    expect(r.removed).toEqual(['frx.practice.progress.L1']);
    expect(localStorage.getItem('frenchirix.onb.welcome')).toBe('1');
    expect(localStorage.getItem(SCHEMA_KEY)).toBe('2');
    // The same schema again changes nothing.
    sessionStorage.setItem('frx.practice.progress.L2', JSON.stringify(progress));
    expect(sweepStorage(localStorage, sessionStorage, 2).removed).toEqual([]);
  });

  it('drops malformed values, and survives missing storage', () => {
    sessionStorage.setItem('frx.practice.progress.L1', JSON.stringify({ puzzleIndex: 'two' }));
    sessionStorage.setItem('frx.practice.progress.L2', '{not json');
    const r = sweepStorage(localStorage, sessionStorage);
    expect(r.removed.sort()).toEqual(['frx.practice.progress.L1', 'frx.practice.progress.L2']);
    expect(sweepStorage(undefined, undefined)).toEqual({ removed: [] });
  });

  it('"Ce n’est pas moi" forgets the kid and keeps the device', () => {
    localStorage.setItem('frenchirix.onb.welcome', '1');
    localStorage.setItem('frx.mic.intro', '1');
    localStorage.setItem('frx.pwa.welcomeBack', 'new');
    localStorage.setItem('frx.pwa.offer', 'dismissed');
    localStorage.setItem('frx.muted', '1');
    localStorage.setItem(SCHEMA_KEY, '1');
    sessionStorage.setItem('frx.practice.progress.L1', JSON.stringify(progress));
    expect(forgetKid(localStorage, sessionStorage).sort()).toEqual(['frenchirix.onb.welcome', 'frx.mic.intro', 'frx.practice.progress.L1', 'frx.pwa.welcomeBack']);
    expect(localStorage.getItem('frx.pwa.offer')).toBe('dismissed');
    expect(localStorage.getItem('frx.muted')).toBe('1');
    expect(localStorage.getItem(SCHEMA_KEY)).toBe('1');
    expect(forgetKid(undefined, undefined)).toEqual([]);
  });
});
