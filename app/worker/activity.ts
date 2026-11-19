// The activity log and the kids' problem reports (docs/app-server.md, "Activity log and reports").
//   POST /api/log      a batch of client events (CLIENT_LOG_KINDS in shared/activity.ts): 204
//   POST /api/reports  one "Quelque chose ne va pas ?" report: { id }
// Both work with or without a session (they are behind the gate): a report from the boot error panel
// still arrives. The Worker logs its own events with logTx (inside a request's batch, so an event is
// written exactly when the request commits) or logNow (outside one: the error handler). The daily
// scheduled job (purgeActivity) deletes rows older than ACTIVITY_KEEP_DAYS; reports are kept.
import { Hono } from 'hono';
import {
  ACTIVITY_KEEP_DAYS,
  LOG_MAX_BYTES,
  LOG_MAX_DATA_CHARS,
  LOG_MAX_EVENTS,
  REPORT_MAX_CONTEXT_CHARS,
  REPORT_MAX_TEXT,
  REPORTS_PER_HOUR,
  TAB_HEADER,
  isClientLogKind,
  type LogRequest,
  type ReportRequest,
  type ReportResponse,
  type ServerLogKind,
} from '../shared/activity';
import { BUILD_HEADER } from '../shared/build';
import { DEFAULT_TIME_ZONE, kidDay } from '../shared/rules';
import type { AppEnv, Env } from './env';
import { sessionUser } from './session';
import type { UserTx } from './tx';
import { fail, jsonBody, nowMs, type Ctx } from './util';

const DAY_MS = 86_400_000;
const INSERT = 'INSERT INTO activity (user_id, at, day, build, session_id, kind, route, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';

const clip = (v: unknown, n: number): string | null => (typeof v === 'string' && v ? v.slice(0, n) : null);

/** An event's data as stored: a JSON object of at most LOG_MAX_DATA_CHARS (beyond: a marker). */
export function dataJson(data: unknown): string {
  let s = '{}';
  try {
    s = JSON.stringify(data && typeof data === 'object' && !Array.isArray(data) ? data : {}) ?? '{}';
  } catch {
    // a cycle or a BigInt: nothing worth keeping
  }
  return s.length <= LOG_MAX_DATA_CHARS ? s : JSON.stringify({ truncated: true, chars: s.length });
}

/** A report's context as stored: JSON of at most REPORT_MAX_CONTEXT_CHARS (beyond: its beginning, marked). */
export function contextJson(context: unknown): string {
  const s = dataJsonUnbounded(context);
  if (s.length <= REPORT_MAX_CONTEXT_CHARS) return s;
  return JSON.stringify({ truncated: true, chars: s.length, partial: s.slice(0, REPORT_MAX_CONTEXT_CHARS - 200) });
}

function dataJsonUnbounded(v: unknown): string {
  try {
    return JSON.stringify(v && typeof v === 'object' && !Array.isArray(v) ? v : {}) ?? '{}';
  } catch {
    return '{}';
  }
}

const buildOf = (c: Ctx) => clip(c.req.header(BUILD_HEADER), 60);
const pathOf = (c: Ctx) => new URL(c.req.url).pathname.slice(0, 200);

/**
 * One event of the Worker's own, queued in the request's batch: written when the request commits, and
 * not at all when it fails or is replayed. One line per event where it happens.
 */
export function logTx(tx: UserTx, c: Ctx, kind: ServerLogKind, data: Record<string, unknown>): void {
  tx.stmt(INSERT, tx.id, tx.nowMs, tx.today, buildOf(c), clip(c.req.header(TAB_HEADER), 40), kind, pathOf(c), dataJson(data));
}

/** One event of the Worker's own, written at once (outside a batch: the error handler). Never throws. */
export async function logNow(c: Ctx, kind: ServerLogKind, data: Record<string, unknown>): Promise<void> {
  try {
    let userId: string | null = null;
    try {
      userId = c.get('userId') ?? null;
    } catch {
      // before requireSession
    }
    const at = nowMs(c);
    await c.env.DB.prepare(INSERT).bind(userId, at, kidDay(at, DEFAULT_TIME_ZONE), buildOf(c), clip(c.req.header(TAB_HEADER), 40), kind, pathOf(c), dataJson(data)).run();
  } catch {
    // the log must never turn one failure into two
  }
}

/** The scheduled job: delete activity rows older than ACTIVITY_KEEP_DAYS. Returns how many went. */
export async function purgeActivity(env: Env, now: number): Promise<number> {
  const r = await env.DB.prepare('DELETE FROM activity WHERE at < ?').bind(now - ACTIVITY_KEEP_DAYS * DAY_MS).run();
  return r.meta.changes ?? 0;
}

export const activityRoutes = new Hono<AppEnv>();

activityRoutes.post('/log', async (c) => {
  if (Number(c.req.header('content-length') ?? 0) > LOG_MAX_BYTES) return fail(413, 'bad-request', 'too big');
  const raw = await c.req.text();
  if (raw.length > LOG_MAX_BYTES) return fail(413, 'bad-request', 'too big');
  let body: Partial<LogRequest>;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'bad-request', 'expected JSON');
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.events)) return fail(400, 'bad-request', 'expected { events }');
  const user = await sessionUser(c);
  const now = nowMs(c);
  const zone = user?.time_zone ?? DEFAULT_TIME_ZONE;
  // The client's clock may be off: its times are moved by the difference at sending, then kept within the last week.
  const skew = typeof body.sentAt === 'number' && Number.isFinite(body.sentAt) ? now - body.sentAt : 0;
  const build = clip(body.build, 60) ?? buildOf(c);
  const tab = clip(body.tab, 40);
  const stmts: D1PreparedStatement[] = [];
  for (const e of body.events.slice(0, LOG_MAX_EVENTS)) {
    // Unknown kinds (an older or newer client) are ignored, not refused.
    if (!e || typeof e !== 'object' || !isClientLogKind(e.kind)) continue;
    const t = typeof e.at === 'number' && Number.isFinite(e.at) ? Math.trunc(e.at + skew) : now;
    const at = t > now || t < now - 7 * DAY_MS ? now : t;
    stmts.push(c.env.DB.prepare(INSERT).bind(user?.id ?? null, at, kidDay(at, zone), build, tab, e.kind, clip(e.route, 200), dataJson(e.data)));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.body(null, 204);
});

activityRoutes.post('/reports', async (c) => {
  if (Number(c.req.header('content-length') ?? 0) > 2 * REPORT_MAX_CONTEXT_CHARS) return fail(413, 'bad-request', 'too big');
  const body = await jsonBody<Partial<ReportRequest>>(c);
  const user = await sessionUser(c);
  const now = nowMs(c);
  if (user) {
    const r = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE user_id = ? AND at > ?').bind(user.id, now - 3_600_000).first<{ n: number }>();
    if ((r?.n ?? 0) >= REPORTS_PER_HOUR) return fail(429, 'rate-limited', 'reports per hour', 600);
  }
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, REPORT_MAX_TEXT) : '';
  const ctx = body.context && typeof body.context === 'object' ? body.context : {};
  const row = await c.env.DB.prepare('INSERT INTO reports (user_id, at, build, route, text, context, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(user?.id ?? null, now, buildOf(c) ?? clip((ctx as { build?: unknown }).build, 60), clip(body.route, 200), text, contextJson(ctx), clip(c.req.header('user-agent'), 400))
    .first<{ id: number }>();
  console.log(JSON.stringify({ report: { id: row?.id, user: user?.id ?? null, route: clip(body.route, 200) } }));
  return c.json<ReportResponse>({ id: row!.id });
});
