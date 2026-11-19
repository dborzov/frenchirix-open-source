import { beforeEach, describe, expect, it } from 'vitest';
import { CHEERS } from '../shared/catalog';
import { addDays, LEAGUE_PROMOTE, LEAGUE_DEMOTE } from '../shared/rules';
import { GIFTS_PER_DAY, MOVES_PER_DAY } from './social';
import { Browser, db, freshWorld, playPractice, unlockSome } from './testing';

beforeEach(freshWorld);

const DAY = '2026-11-13';

async function kid(name: string) {
  const b = new Browser();
  const s = await b.start();
  await b.ok('PATCH', '/api/me', { name });
  return { b, id: s.profile.id as string };
}

describe('follows and friends', () => {
  it('finds by name prefix, follows, shows friends with friend streaks and the feed', async () => {
    const a = await kid('Astérix');
    const o = await kid('Obélix');
    await kid('Obéron');
    const found = await a.b.ok('GET', '/api/social/search?q=obe');
    expect(found.users.map((u: any) => u.name).sort()).toEqual(['Obélix', 'Obéron']);
    expect(found.users[0]).not.toHaveProperty('pin');
    const f = await a.b.ok('POST', '/api/social/follow', { userId: o.id });
    expect(f.user).toMatchObject({ id: o.id, following: true, followsMe: false });
    expect(f.patch.stats.follows).toBe(1);
    await o.b.ok('POST', '/api/social/follow', { userId: a.id });
    // Both practise two days in a row (bronze, then silver of the same scene).
    const scenes = new Map<string, string>();
    for (const day of [DAY, addDays(DAY, 1)]) {
      for (const k of [a, o]) {
        k.b.at(day);
        if (!scenes.has(k.id)) scenes.set(k.id, (await unlockSome(k.b, 1))[0]!);
        await playPractice(k.b, { kind: 'scene', sceneId: scenes.get(k.id)! });
      }
    }
    const fr = await a.b.ok('GET', '/api/social/friends');
    expect(fr.friends).toHaveLength(1);
    expect(fr.friends[0]).toMatchObject({ id: o.id, following: true, followsMe: true, friendStreak: 2, practisedToday: true });
    expect(fr.friends[0].weekXp).toBeGreaterThan(0);
    // Obélix's followers counter was updated without touching the rest of his row.
    expect((await o.b.ok('GET', '/api/me')).state.stats.followers).toBe(1);
    await a.b.ok('DELETE', '/api/social/follow', { userId: o.id });
    const fr2 = await a.b.ok('GET', '/api/social/friends');
    expect(fr2.friends[0]).toMatchObject({ following: false, followsMe: true });
    expect((await a.b.json('POST', '/api/social/follow', { userId: a.id })).status).toBe(400);
  });

  it('shows friends’ milestones and lets a cheer be sent once per item', async () => {
    const a = await kid('Astérix');
    const o = await kid('Obélix');
    await a.b.ok('POST', '/api/social/follow', { userId: o.id });
    const [first] = await unlockSome(o.b, 1);
    await playPractice(o.b, { kind: 'scene', sceneId: first }); // first-practice achievement
    const { feed } = await a.b.ok('GET', '/api/social/friends');
    const item = feed.find((f: any) => f.kind === 'achievement' && f.achievementId === 'first-lesson');
    expect(item).toMatchObject({ user: { id: o.id, name: 'Obélix' }, cheeredByMe: false });
    const cheer = { kind: 'cheer', cheerId: CHEERS[0]!.id, feedItemId: item.id };
    await a.b.ok('POST', '/api/social/gift', { toUserId: o.id, gift: cheer });
    expect((await a.b.json('POST', '/api/social/gift', { toUserId: o.id, gift: cheer })).status).toBe(409);
    expect((await a.b.ok('GET', '/api/social/friends')).feed.find((f: any) => f.id === item.id).cheeredByMe).toBe(true);
    expect((await o.b.ok('GET', '/api/me')).state.inboxUnread).toBe(1);
    const inbox = await o.b.ok('GET', '/api/social/inbox');
    expect(inbox.entries[0]).toMatchObject({ from: { id: a.id }, gift: cheer, seen: false });
    expect(inbox.patch.inboxUnread).toBe(0);
    expect((await o.b.ok('GET', '/api/social/inbox')).entries[0].seen).toBe(true);
  });
});

describe('gifts', () => {
  it('moves items and potions, respects ownership, the potion cap and the daily limits', async () => {
    const a = await kid('Astérix');
    const o = await kid('Obélix');
    expect((await a.b.json('POST', '/api/social/gift', { toUserId: o.id, gift: { kind: 'potion' } })).body.error).toBe('not-found'); // must follow
    await a.b.ok('POST', '/api/social/follow', { userId: o.id });
    expect((await a.b.json('POST', '/api/social/gift', { toUserId: o.id, gift: { kind: 'potion' } })).body.error).toBe('not-owned');
    expect((await a.b.json('POST', '/api/social/gift', { toUserId: o.id, gift: { kind: 'item', itemId: 'squeaky-lyre' } })).body.error).toBe('not-owned');
    await db().prepare('UPDATE users SET potions = 2 WHERE id = ?').bind(a.id).run();
    await db().prepare("INSERT INTO inventory (user_id, item_id, count) VALUES (?, 'squeaky-lyre', 1)").bind(a.id).run();
    await a.b.ok('PATCH', '/api/me', { avatar: { v: 1, base: {}, worn: { held: 'squeaky-lyre' } } });
    const g = await a.b.ok('POST', '/api/social/gift', { toUserId: o.id, gift: { kind: 'item', itemId: 'squeaky-lyre' } });
    expect(g.patch.inventory['squeaky-lyre']).toBe(0);
    expect(g.patch.profile.avatar.worn.held).toBeUndefined();
    const p = await a.b.ok('POST', '/api/social/gift', { toUserId: o.id, gift: { kind: 'potion' } });
    expect(p.patch.currencies.potions).toBe(1);
    const os = (await o.b.ok('GET', '/api/me')).state;
    expect(os.inventory['squeaky-lyre']).toBe(1);
    expect(os.currencies.potions).toBe(1);
    expect(os.stats.giftsReceived).toBe(2);
    await db().prepare('UPDATE users SET potions = 2 WHERE id = ?').bind(o.id).run();
    expect((await a.b.json('POST', '/api/social/gift', { toUserId: o.id, gift: { kind: 'potion' } })).body.error).toBe('potions-full');
    await db().prepare('UPDATE users SET potions = 0 WHERE id = ?').bind(o.id).run();
    await a.b.ok('POST', '/api/social/gift', { toUserId: o.id, gift: { kind: 'potion' } });
    expect(MOVES_PER_DAY).toBe(3);
    await db().prepare('UPDATE users SET potions = 2 WHERE id = ?').bind(a.id).run();
    expect((await a.b.json('POST', '/api/social/gift', { toUserId: o.id, gift: { kind: 'potion' } })).body.error).toBe('rate-limited');
    for (let i = 3; i < GIFTS_PER_DAY; i++) await a.b.ok('POST', '/api/social/gift', { toUserId: o.id, gift: { kind: 'cheer', cheerId: CHEERS[0]!.id } });
    expect((await a.b.json('POST', '/api/social/gift', { toUserId: o.id, gift: { kind: 'cheer', cheerId: CHEERS[0]!.id } })).status).toBe(429);
    // Tomorrow the limits reset.
    a.b.at(addDays(DAY, 1));
    await a.b.ok('POST', '/api/social/gift', { toUserId: o.id, gift: { kind: 'cheer', cheerId: CHEERS[0]!.id } });
  });
});

describe('leagues', () => {
  it('joins on first XP, ranks the group, promotes and relegates across a week boundary', async () => {
    // Week of Monday 2026-11-09. 12 kids in tier 1 so both promotion and relegation apply.
    const kids: { b: Browser; id: string; scene?: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const b = new Browser();
      b.ip = `10.2.0.${i}`;
      const s = await b.start();
      await db().prepare('UPDATE users SET league_tier = 1 WHERE id = ?').bind(s.profile.id).run();
      kids.push({ b, id: s.profile.id });
    }
    expect((await kids[0]!.b.ok('GET', '/api/league')).rows).toHaveLength(1); // not a member yet
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]!;
      const [sceneId] = await unlockSome(k.b, 1);
      k.scene = sceneId!;
      for (let j = 0; j <= i; j++) await playPractice(k.b, { kind: 'scene', sceneId });
    }
    const league = await kids[0]!.b.ok('GET', '/api/league');
    expect(league).toMatchObject({ week: '2026-11-09', endsDay: '2026-11-15', tier: 1, promote: LEAGUE_PROMOTE, demote: LEAGUE_DEMOTE });
    expect(league.rows).toHaveLength(12);
    expect(league.rows[0].userId).toBe(kids[11]!.id);
    expect(league.rows.find((r: any) => r.me).rank).toBe(12);
    const me = (await kids[0]!.b.ok('GET', '/api/me')).state.league;
    expect(me).toMatchObject({ tier: 1, rank: 12, groupSize: 12 });

    // Next week: the first kid seen settles the group.
    for (const k of kids) k.b.at('2026-11-16');
    const top = await kids[11]!.b.ok('GET', '/api/league');
    expect(top.tier).toBe(2);
    expect(top.rows).toHaveLength(1);
    const bottom = await kids[0]!.b.ok('GET', '/api/me');
    expect(bottom.state.league).toBeNull();
    const tiers = await db().prepare('SELECT id, league_tier FROM users').all<{ id: string; league_tier: number }>();
    const tierOf = new Map(tiers.results.map((r) => [r.id, r.league_tier]));
    kids.forEach((k, i) => {
      const expected = i >= 12 - LEAGUE_PROMOTE ? 2 : i < LEAGUE_DEMOTE ? 0 : 1;
      expect(tierOf.get(k.id), `kid ${i}`).toBe(expected);
    });
    // Settled once only.
    await kids[5]!.b.ok('GET', '/api/league');
    expect((await db().prepare('SELECT league_tier FROM users WHERE id = ?').bind(kids[11]!.id).first<{ league_tier: number }>())!.league_tier).toBe(2);
    // XP this week goes into a group of the new tier.
    await playPractice(kids[11]!.b, { kind: 'scene', sceneId: kids[11]!.scene });
    expect((await kids[11]!.b.ok('GET', '/api/league')).tier).toBe(2);
  });
});

describe('speech', () => {
  function wav(seconds: number): Uint8Array {
    const n = Math.round(16000 * seconds) * 2;
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    w(0, 'RIFF');
    v.setUint32(4, 36 + n, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true);
    v.setUint32(28, 32000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, n, true);
    return new Uint8Array(buf);
  }

  it('scores the test transcript against the expected line', async () => {
    const { FIXTURE_SCENE } = await import('../shared/fixtures');
    const b = new Browser();
    await b.start();
    const id = (await unlockSome(b, 1))[0]!;
    const line = FIXTURE_SCENE.lines[0]!; // fixtureSceneFor serves the fixture's lines under every id
    const q = `/api/speech?scene=${id}&line=${line.id}`;
    const good = await b.ok('POST', q, wav(2), { 'content-type': 'audio/wav', 'x-test-transcript': encodeURIComponent(line.fr) });
    expect(good.pass).toBe(true);
    expect(good.transcript).toBe(line.fr);
    expect(good.matched.every((m: any) => m.ok)).toBe(true);
    expect(good.patch.stats.linesSpoken).toBe(1);
    const bad = await b.ok('POST', q, wav(2), { 'content-type': 'audio/wav', 'x-test-transcript': encodeURIComponent('Sous-titrage ST’ 501') });
    expect(bad.pass).toBe(false);
    const unit = line.units.find((u) => u.key)!;
    const u = await b.ok('POST', `/api/speech?scene=${id}&unit=${unit.id}`, wav(1), { 'content-type': 'audio/wav', 'x-test-transcript': encodeURIComponent(unit.fr) });
    expect(u.pass).toBe(true);
    expect((await b.json('POST', q, wav(31), { 'content-type': 'audio/wav', 'x-test-transcript': 'x' })).status).toBe(413);
    expect((await b.json('POST', q, new Uint8Array(100), { 'content-type': 'audio/wav', 'x-test-transcript': 'x' })).status).toBe(400);
    expect((await b.json('POST', `/api/speech?scene=${id}&line=nope`, wav(1), { 'x-test-transcript': 'x' })).status).toBe(404);
  });
});
