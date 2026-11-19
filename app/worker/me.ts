// GET /api/me and PATCH /api/me: profile settings, name, avatar, seen achievements.
import { Hono } from 'hono';
import type { MePatchRequest, MePatchResponse, MeResponse } from '../shared/api';
import { validateAvatar, type Avatar } from '../shared/catalog';
import { checkName, nameKey } from '../shared/catalog/badwords';
import { isValidTimeZone } from '../shared/rules';
import type { AppEnv } from './env';
import { runTx } from './session';
import { fullState } from './state';
import { fail, jsonBody } from './util';

export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/me', async (c) => runTx(c, async (tx) => c.json<MeResponse>({ state: await fullState(tx) })));

meRoutes.patch('/me', async (c) => {
  const body = await jsonBody<MePatchRequest>(c);
  return runTx(c, async (tx) => {
    if (body.name !== undefined) {
      if (typeof body.name !== 'string') return fail(400, 'name-invalid');
      const name = body.name.trim().normalize('NFC');
      const check = checkName(name);
      if (!check.ok) return fail(400, check.reason === 'rude' ? 'name-rude' : 'name-invalid');
      const key = nameKey(name);
      if (key !== tx.u.name_key) {
        const other = await tx.db.prepare('SELECT id FROM users WHERE name_key = ?').bind(key).first();
        if (other) return fail(409, 'name-taken');
      }
      tx.set('name', name);
      tx.set('name_key', key);
      tx.set('name_chosen', 1);
    }
    if (body.language !== undefined) {
      if (body.language !== 'fr' && body.language !== 'en') return fail(400, 'bad-request', 'language');
      tx.set('language', body.language);
    }
    if (body.speak !== undefined) {
      if (typeof body.speak !== 'boolean') return fail(400, 'bad-request', 'speak');
      tx.set('speak', body.speak ? 1 : 0);
    }
    if (body.timeZone !== undefined) {
      if (typeof body.timeZone !== 'string' || body.timeZone.length > 64 || !isValidTimeZone(body.timeZone)) return fail(400, 'bad-request', 'timeZone');
      tx.set('time_zone', body.timeZone);
    }
    if (body.avatar !== undefined) {
      const a = body.avatar as Avatar;
      const json = JSON.stringify(a ?? null);
      if (!a || typeof a !== 'object' || json.length > 2000 || validateAvatar(a, await tx.ownedItems()).length) return fail(400, 'avatar-invalid');
      tx.set('avatar', json);
    }
    if (Array.isArray(body.seenAchievements)) {
      const earned = await tx.achievements();
      for (const id of body.seenAchievements.slice(0, 100)) {
        const a = typeof id === 'string' ? earned.get(id) : undefined;
        if (a && !a.seen) tx.setAchievement(id, { ...a, seen: true }, false);
      }
    }
    try {
      await tx.commit();
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) return fail(409, 'name-taken');
      throw e;
    }
    return c.json<MePatchResponse>({ patch: tx.patch });
  });
});
