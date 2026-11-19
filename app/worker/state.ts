// The whole PlayerState of a kid (session, login, GET /api/me).
import type { PlayerState } from '../shared/api';
import { getContent } from './content';
import { dailyState, ensureDaily } from './daily';
import { recordingsOf } from './karaoke';
import { leagueSummary, touchLeague } from './league';
import { scenePractices } from './practice-pick';
import type { UserTx } from './tx';

/** Commits whatever the handler changed on `tx` (plus the day's quests, built at its first visit, and league settling) and returns the state. */
export async function fullState(tx: UserTx): Promise<PlayerState> {
  const content = await getContent(tx.env);
  await tx.preload(['progress', 'inventory', 'achievements', 'chests', 'daily', 'days']);
  await touchLeague(tx);
  await ensureDaily(tx, content);
  await tx.commit();
  const [base, daily, league, practices, recordings] = await Promise.all([tx.baseState(), dailyState(tx, content), leagueSummary(tx), scenePractices(tx, content), recordingsOf(tx.db, tx.id)]);
  // Progress on scenes that are not in the release is kept in the database but not shown.
  const progress = Object.fromEntries(Object.entries(base.progress).filter(([id]) => content.byId.has(id)));
  return { ...base, progress, daily, league, practices, recordings };
}
