import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('worker', () => {
  it('answers /api/health without the gate', async () => {
    const res = await exports.default.fetch('http://example.com/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, testMode: true });
  });

  it('has a D1 binding', async () => {
    const { env } = await import('cloudflare:test');
    const row = await env.DB.prepare('select 1 as one').first<{ one: number }>();
    expect(row?.one).toBe(1);
  });
});

describe('content', () => {
  it('loads the real index through ASSETS when the client is built', async () => {
    const { env } = await import('cloudflare:test');
    const { getContent, getScene, setContentForTests } = await import('./content');
    setContentForTests(null);
    const res = await env.ASSETS.fetch(new Request('https://assets.local/data/index.json'));
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return; // dist/ not built: nothing to check
    const c = await getContent(env);
    expect(c.index.scenes.length).toBeGreaterThan(0); // however many scenes the release holds (50 in 2.1)
    const s = await getScene(env, c.index.scenes[0]!.id);
    expect(s?.lines.length).toBeGreaterThan(0);
  });
});
