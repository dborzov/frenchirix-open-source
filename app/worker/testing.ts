// Test helpers for the worker tests (not a test file itself): a fresh D1 with the migrations, the
// fixture content instead of the bundle, and a little browser with a cookie jar and a test clock.
import { applyD1Migrations, env, reset } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { FIXTURE_INDEX, FIXTURE_SONG, fixtureSceneFor } from '../shared/fixtures';
import { setContentForTests } from './content';

/** The test-only passwords (vitest.config.ts bindings). */
export const GATE_PASSWORD = env.GATE_PASSWORD;
export const ADMIN_PASSWORD = env.ADMIN_PASSWORD;

// Listed one by one (not import.meta.glob, whose result the test cache keeps when a file is added).
// A new migration must be added here too.
import m0001 from './migrations/0001_init.sql?raw';
import m0002 from './migrations/0002_quests.sql?raw';
import m0003 from './migrations/0003_karaoke.sql?raw';

const sqlFiles: Record<string, string> = { '0001_init.sql': m0001, '0002_quests.sql': m0002, '0003_karaoke.sql': m0003 };

export const migrations = Object.keys(sqlFiles)
  .sort()
  .map((path) => ({
    name: path.split('/').pop()!,
    queries: sqlFiles[path]!
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n')
      .split(';')
      .map((q) => q.trim())
      .filter(Boolean),
  }));

/** Empty database with the schema, fixture content. Call in beforeEach. */
export async function freshWorld(): Promise<void> {
  await reset();
  await applyD1Migrations(env.DB, migrations);
  setContentForTests({ index: FIXTURE_INDEX, scene: fixtureSceneFor, song: (id) => (id === FIXTURE_SONG.id ? FIXTURE_SONG : null) });
}

export const db = () => env.DB;

export class Browser {
  cookies = new Map<string, string>();
  now = '2026-11-13T15:00:00Z';
  ip = '10.0.0.1';
  timeZone = 'America/Toronto';
  origin = 'http://app.test';

  /** ISO instant of a day at 10:00 in Toronto (15:00 UTC; daylight saving does not matter for tests). */
  at(day: string, hourUtc = 15): this {
    this.now = `${day}T${String(hourUtc).padStart(2, '0')}:00:00Z`;
    return this;
  }

  async fetch(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const h: Record<string, string> = { 'x-test-now': this.now, 'cf-connecting-ip': this.ip, ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload: BodyInit | undefined;
    if (body instanceof ArrayBuffer || body instanceof Uint8Array || typeof body === 'string') payload = body as BodyInit;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      h['content-type'] ??= 'application/json';
    }
    const res = await exports.default.fetch(new Request(`${this.origin}${path}`, { method, headers: h, body: payload, redirect: 'manual' }));
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [kv] = sc.split(';');
      const i = kv!.indexOf('=');
      this.cookies.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
    return res;
  }

  async json<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T }> {
    const res = await this.fetch(method, path, body, headers);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }

  /** Passes the gate. */
  async enter(): Promise<this> {
    const r = await this.fetch('POST', '/gate', { password: GATE_PASSWORD });
    if (r.status !== 204) throw new Error(`gate ${r.status}`);
    return this;
  }

  /** Gate + a new kid; returns the session state. */
  async start(): Promise<any> {
    if (!this.cookies.has('fx_gate')) await this.enter();
    const r = await this.json('POST', '/api/session', { timeZone: this.timeZone });
    if (r.status !== 200) throw new Error(`session ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.state;
  }

  async ok<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    const r = await this.json<T>(method, path, body, headers);
    if (r.status !== 200) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

/** Unlocks n of today's candidates. */
export async function unlockSome(b: Browser, n: number): Promise<string[]> {
  const d = await b.ok('GET', '/api/daily');
  const ids = d.daily.candidates.filter((o: any) => !o.unlocked).slice(0, n).map((o: any) => o.sceneId);
  for (const id of ids) await b.ok('POST', '/api/daily/unlock', { sceneId: id });
  return ids;
}

/** Starts and completes a practice with clean outcomes (one puzzle per scene). */
export async function playPractice(b: Browser, req: unknown, opts: { mistakes?: number; hints?: number } = {}): Promise<any> {
  const { plan } = await b.ok('POST', '/api/practices/start', req);
  const outcomes = plan.entries.flatMap((e: any, i: number) => [
    { puzzleId: `t${i}a`, type: 'watch', sceneId: e.sceneId, unitIds: [], missedUnitIds: [], mistakes: 0, hints: 0, skipped: false, ms: 1000 },
    { puzzleId: `t${i}b`, type: 'listen-pick', sceneId: e.sceneId, unitIds: [], missedUnitIds: [], mistakes: opts.mistakes ?? 0, hints: opts.hints ?? 0, skipped: false, ms: 1000 },
  ]);
  return b.ok('POST', `/api/practices/${plan.id}/complete`, { outcomes, ms: 60000 });
}
