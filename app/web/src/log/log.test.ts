// The client's activity log (log/index.ts): the ring buffer a report reads, batches under the server's
// caps, nothing sent before a sender is installed, and never a throw.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOG_MAX_BYTES, LOG_MAX_DATA_CHARS, LOG_MAX_EVENTS, type LogRequest } from '../../../shared/activity';
import { BATCH_SIZE, RING_SIZE, TAB, crashData, flushLog, log, noteConsoleErrorForTests, recentConsoleErrors, recentEvents, setLogSenderForTests } from './index';

afterEach(() => setLogSenderForTests(null));

const sent = () => {
  const calls: { body: LogRequest; beacon: boolean }[] = [];
  setLogSenderForTests((body, beacon) => calls.push({ body: JSON.parse(body) as LogRequest, beacon }));
  return calls;
};

describe('the activity log', () => {
  it('keeps the last events in memory, with the route, and sends nothing without a sender', () => {
    setLogSenderForTests(null);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (let i = 0; i < RING_SIZE + 30; i++) log('route', { i });
    const events = recentEvents(RING_SIZE + 30);
    expect(events).toHaveLength(RING_SIZE);
    expect(events[0]!.data).toEqual({ i: 30 });
    expect(events.at(-1)).toMatchObject({ kind: 'route', route: location.pathname, data: { i: RING_SIZE + 29 } });
    expect(recentEvents(5)).toHaveLength(5);
    flushLog();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('sends a batch every BATCH_SIZE events, and the rest when flushed (a beacon when the page goes away)', () => {
    const calls = sent();
    for (let i = 0; i < BATCH_SIZE + 3; i++) log('puzzle-done', { i });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.events).toHaveLength(BATCH_SIZE);
    expect(calls[0]!.body).toMatchObject({ tab: TAB, build: expect.any(String), sentAt: expect.any(Number) });
    expect(calls[0]!.beacon).toBe(false);
    flushLog(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.events.map((e) => e.data.i)).toEqual([BATCH_SIZE, BATCH_SIZE + 1, BATCH_SIZE + 2]);
    expect(calls[1]!.beacon).toBe(true);
    flushLog();
    expect(calls).toHaveLength(2); // nothing left
  });

  it('keeps every batch under the server’s caps, even of the largest events', () => {
    const calls: string[] = [];
    setLogSenderForTests((body) => calls.push(body));
    for (let i = 0; i < BATCH_SIZE * 3; i++) log('crash', { message: 'x'.repeat(480), stack: 'y'.repeat(480), more: 'z'.repeat(480), last: 'w'.repeat(480) });
    flushLog();
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.length).toBeLessThanOrEqual(LOG_MAX_BYTES);
      expect((JSON.parse(c) as LogRequest).events.length).toBeLessThanOrEqual(LOG_MAX_EVENTS);
    }
    expect(calls.reduce((n, c) => n + (JSON.parse(c) as LogRequest).events.length, 0)).toBe(BATCH_SIZE * 3);
  });

  it('never throws: a sender that throws, data that cannot be serialised, data too big; strings are clipped', () => {
    setLogSenderForTests(() => {
      throw new Error('network on fire');
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => {
      log('crash', cyclic);
      log('crash', { big: Array.from({ length: 200 }, () => 'w'.repeat(100)) });
      log('route', { long: 'q'.repeat(2000) });
      for (let i = 0; i < BATCH_SIZE * 2; i++) log('route');
      flushLog(true);
    }).not.toThrow();
    const [a, b, c] = recentEvents(RING_SIZE);
    expect(a!.data).toEqual({ unloggable: true });
    expect(b!.data).toMatchObject({ truncated: true });
    expect(JSON.stringify(b!.data).length).toBeLessThan(LOG_MAX_DATA_CHARS);
    expect((c!.data.long as string).length).toBeLessThanOrEqual(501);
  });

  it('copies the data: a later change to the object does not change the event', () => {
    setLogSenderForTests(null);
    const d = { n: 1 };
    log('route', d);
    d.n = 2;
    expect(recentEvents(1)[0]!.data).toEqual({ n: 1 });
  });

  it('keeps the last console errors, and describes a crash with the first stack lines', () => {
    for (let i = 0; i < 15; i++) noteConsoleErrorForTests([`boom ${i}`, new TypeError('bad')]);
    const errs = recentConsoleErrors();
    expect(errs).toHaveLength(10);
    expect(errs.at(-1)).toBe('boom 14 TypeError: bad');
    const e = new Error('kaput');
    const d = crashData(e);
    expect(d.message).toBe('Error: kaput');
    expect(d.stack!.split('\n').length).toBeLessThanOrEqual(6);
    expect(crashData('plain')).toEqual({ message: 'plain' });
  });
});
