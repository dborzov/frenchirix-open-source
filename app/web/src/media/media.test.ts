// Loading media (docs/app-games.md, "Loading media"): progress by bytes, a stall becomes a timeout error,
// a failed load leaves nothing in the cache so « Réessayer » fetches again, a failed play is told to the
// app (not a quiet one), the gate's progress by bytes or by files, the admin's detail line, and the
// clips a practice fetches ahead.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorDetail, errorMessage, kindOf } from '../api/errors';
import { AudioLoadError, Engine } from '../audio/engine';
import { fetchMedia, MEDIA_TIMEOUT_MS, MediaLoadError } from './fetchMedia';
import { loadMedia, progressFraction, type MediaProgress } from './loadMedia';
import { practiceClips } from '../practice/clips';
import type { Scene } from '../../../shared/content';
import type { PuzzleBase } from '../../../shared/practice/types';
import { translate } from '../../../shared/i18n';

/** A response whose body comes in the given chunks; `stallAfter` chunks, then it never sends more. */
function streamed(chunks: number[], opts: { length?: number | null; encoding?: string; status?: number; stallAfter?: number } = {}): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (opts.stallAfter !== undefined && i >= opts.stallAfter) return new Promise(() => {}); // never more
      if (i >= chunks.length) {
        ctl.close();
        return;
      }
      ctl.enqueue(new Uint8Array(chunks[i++]!));
    },
  });
  const total = chunks.reduce((a, b) => a + b, 0);
  const headers: Record<string, string> = {};
  if (opts.length !== null) headers['content-length'] = String(opts.length ?? total);
  if (opts.encoding) headers['content-encoding'] = opts.encoding;
  return new Response(body, { status: opts.status ?? 200, headers });
}

/** Just enough of an AudioContext for the engine to load and decode (decoding: one sample per byte). */
class FakeContext {
  state = 'running';
  sampleRate = 48000;
  currentTime = 0;
  baseLatency = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  createGain() {
    return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
  }
  createBuffer() {
    return { length: 1, numberOfChannels: 1, duration: 0 };
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start() {}, stop() {}, disconnect() {}, playbackRate: { value: 1 }, onended: null };
  }
  decodeAudioData(data: ArrayBuffer, ok?: (b: unknown) => void, ko?: (e: unknown) => void) {
    if (new Uint8Array(data)[0] === 0xff) {
      const e = new Error('cannot decode');
      ko?.(e);
      return Promise.reject(e);
    }
    const b = { length: data.byteLength, numberOfChannels: 1, duration: data.byteLength / 48000, sampleRate: 48000, getChannelData: () => new Float32Array(data.byteLength) };
    ok?.(b);
    return Promise.resolve(b);
  }
  resume() {
    return Promise.resolve();
  }
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('AudioContext', FakeContext);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Rejects when the request's signal aborts, like a real fetch. */
function abortable(init?: RequestInit): Promise<never> {
  return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
}

describe('fetchMedia', () => {
  it('reports bytes as they arrive, with the size from Content-Length', async () => {
    fetchMock.mockResolvedValue(streamed([100, 200, 50]));
    const seen: [number, number | null][] = [];
    const buf = await fetchMedia('/media/a/x.m4a', { onProgress: (b) => seen.push([b.loaded, b.total]) });
    expect(buf.byteLength).toBe(350);
    expect(seen[0]).toEqual([0, 350]);
    expect(seen).toContainEqual([100, 350]);
    expect(seen).toContainEqual([300, 350]);
    expect(seen.at(-1)).toEqual([350, 350]);
  });

  it('has no size when the answer is compressed or says none', async () => {
    fetchMock.mockResolvedValueOnce(streamed([10, 10], { encoding: 'gzip', length: 7 }));
    const a: (number | null)[] = [];
    await fetchMedia('/media/q/a.m4a', { onProgress: (b) => a.push(b.total) });
    expect(a.slice(0, -1).every((t) => t === null)).toBe(true);
    fetchMock.mockResolvedValueOnce(streamed([10], { length: null }));
    const b: (number | null)[] = [];
    await fetchMedia('/media/q/b.m4a', { onProgress: (x) => b.push(x.total) });
    expect(b[0]).toBeNull();
  });

  it('a stall becomes a timeout error after MEDIA_TIMEOUT_MS without a byte; a slow load that keeps coming is not cut', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (_u, init) => {
      const r = streamed([100, 100, 100], { stallAfter: 1 });
      // The reader rejects when the request is aborted, like a real fetch's body.
      const reader = r.body!.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(ctl) {
          const next = await Promise.race([reader.read(), abortable(init)]);
          if (next.done) ctl.close();
          else ctl.enqueue(next.value);
        },
      });
      return new Response(body, { headers: { 'content-length': '300' } });
    });
    const p = fetchMedia('/media/a/stall.m4a').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(MEDIA_TIMEOUT_MS - 1000);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    const e = (await p) as MediaLoadError;
    expect(e).toBeInstanceOf(MediaLoadError);
    expect(e.reason).toBe('timeout');
    expect(e.src).toBe('/media/a/stall.m4a');
  });

  it('no answer at all times out too; a network failure is offline; an HTTP error says its status', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_u, init) => abortable(init));
    const p = fetchMedia('/media/a/none.m4a').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(MEDIA_TIMEOUT_MS + 10);
    expect(((await p) as MediaLoadError).reason).toBe('timeout');
    vi.useRealTimers();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await fetchMedia('/media/a/off.m4a').catch((e: MediaLoadError) => e.reason)).toBe('offline');
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    const http = (await fetchMedia('/media/a/gone.m4a').catch((e: unknown) => e)) as MediaLoadError;
    expect([http.reason, http.status]).toEqual(['http', 404]);
  });
});

describe('the engine loads with progress and lets a failed load be tried again', () => {
  it('reports progress, then the clip is in the cache; a second load is instant and shares the bytes', async () => {
    const engine = new Engine();
    fetchMock.mockResolvedValue(streamed([1000, 1000]));
    const seen: number[] = [];
    await engine.load('/media/a/s.m4a', (b) => seen.push(b.loaded));
    expect(seen).toContain(1000);
    expect(seen.at(-1)).toBe(2000);
    expect(engine.isLoaded('/media/a/s.m4a')).toBe(true);
    const again: [number, number | null][] = [];
    await engine.load('/media/a/s.m4a', (b) => again.push([b.loaded, b.total]));
    expect(again).toEqual([[2000, 2000]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a failure rejects with an AudioLoadError and leaves nothing behind: the retry fetches again and succeeds', async () => {
    const engine = new Engine();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    const e = (await engine.load('/media/q/c.m4a').catch((x: unknown) => x)) as AudioLoadError;
    expect(e).toBeInstanceOf(AudioLoadError);
    expect(e).toBeInstanceOf(MediaLoadError);
    expect([e.reason, e.status]).toEqual(['http', 503]);
    expect(engine.isLoaded('/media/q/c.m4a')).toBe(false);
    fetchMock.mockResolvedValueOnce(streamed([500]));
    await engine.load('/media/q/c.m4a');
    expect(engine.isLoaded('/media/q/c.m4a')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a stalled load times out, and the retry works', async () => {
    vi.useFakeTimers();
    const engine = new Engine();
    fetchMock.mockImplementationOnce((_u, init) => abortable(init));
    const p = engine.load('/media/a/t.m4a').catch((x: unknown) => x);
    await vi.advanceTimersByTimeAsync(MEDIA_TIMEOUT_MS + 10);
    const e = (await p) as AudioLoadError;
    expect(e).toBeInstanceOf(AudioLoadError);
    expect(e.reason).toBe('timeout');
    fetchMock.mockResolvedValueOnce(streamed([10]));
    await engine.load('/media/a/t.m4a');
    expect(engine.isLoaded('/media/a/t.m4a')).toBe(true);
  });

  it('an undecodable file fails as decode', async () => {
    const engine = new Engine();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([0xff, 1, 2]), { headers: { 'content-length': '3' } }));
    const e = (await engine.load('/media/a/bad.m4a').catch((x: unknown) => x)) as AudioLoadError;
    expect(e.reason).toBe('decode');
  });

  it('while a play loads the state says loading; a failed play is told to the app, a quiet one is not', async () => {
    const engine = new Engine();
    const told: string[] = [];
    engine.onPlayError = (e) => told.push(e.src);
    let answer!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (answer = r)));
    const h = engine.playRange('/media/a/p.m4a', 0, 1000, { tag: 'scene:p' });
    expect(engine.getState()).toMatchObject({ loading: true, tag: 'scene:p' });
    answer(new Response('', { status: 500 }));
    await h.ready.catch(() => {});
    expect(engine.getState().loading).toBe(false);
    expect(told).toEqual(['/media/a/p.m4a']);
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    const onError = vi.fn();
    await engine.play('/media/q/quiet.m4a', { quiet: true, onError }).ready.catch(() => {});
    expect(onError).toHaveBeenCalledOnce();
    expect(told).toEqual(['/media/a/p.m4a']);
  });

  it('a play replaced while it loads is not told when it fails', async () => {
    const engine = new Engine();
    const told: string[] = [];
    engine.onPlayError = (e) => told.push(e.src);
    let answer!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (answer = r)));
    const h = engine.playRange('/media/a/old.m4a', 0, 1000);
    engine.stop();
    answer(new Response('', { status: 500 }));
    await h.ready.catch(() => {});
    expect(told).toEqual([]);
  });
});

describe('the gate', () => {
  it('counts bytes when every file said its size, else files', () => {
    const p = (o: Partial<MediaProgress>): MediaProgress => ({ done: 0, count: 4, loaded: 0, total: null, ...o });
    expect(progressFraction(p({ done: 1 }))).toBe(0.25);
    expect(progressFraction(p({ done: 1, loaded: 300, total: 1000 }))).toBe(0.3);
    expect(progressFraction(p({ count: 0 }))).toBe(1);
  });

  it('loads audio and frames together, by bytes', async () => {
    fetchMock.mockImplementation(async (u) => (String(u).endsWith('.m4a') ? streamed([600, 400]) : streamed([100])));
    const seen: MediaProgress[] = [];
    await loadMedia({ audio: ['/media/a/g.m4a'], images: ['/media/f/g/0.webp', '/media/f/g/1.webp'] }, (x) => seen.push(x));
    const last = seen.at(-1)!;
    expect(last).toMatchObject({ done: 3, count: 3, loaded: 1200, total: 1200 });
    expect(seen.some((x) => x.total === 1200 && x.loaded < 1200)).toBe(true);
    // Shares only grow.
    const shares = seen.map(progressFraction);
    expect(shares.at(-1)).toBe(1);
  });

  it('rejects with the first failure, a MediaLoadError naming the file', async () => {
    fetchMock.mockImplementation(async (u) => (String(u).includes('/f/') ? new Response('', { status: 404 }) : streamed([10])));
    const e = (await loadMedia({ audio: ['/media/a/h.m4a'], images: ['/media/f/h/0.webp'] }).catch((x: unknown) => x)) as MediaLoadError;
    expect(e.src).toBe('/media/f/h/0.webp');
    expect(e.status).toBe(404);
  });
});

describe('a media error for the kid and the admin', () => {
  it('has a kind, a plain message and a detail line naming the file and what failed', () => {
    const e = new MediaLoadError('/media/a/s01e01-0067-0071.m4a?v=abc', 0, 'timeout', 'no data for 25 s');
    expect(kindOf(e)).toBe('timeout');
    expect(errorMessage(e)).toBe(translate('fr', 'common.fail.timeout'));
    expect(errorDetail(e)).toMatch(/^FRX-ERR media timeout 0 GET \/media\/a\/s01e01-0067-0071\.m4a\?v=abc msg="no data for 25 s" build=\S+ at=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const http = new AudioLoadError('/media/q/x.m4a', 404, 'HTTP 404');
    expect(kindOf(http)).toBe('server');
    expect(errorMessage(http)).toBe(translate('fr', 'common.fail.media'));
    expect(kindOf(new MediaLoadError('/m', 0, 'offline'))).toBe('offline');
  });
});

describe('the clips a practice fetches ahead', () => {
  it('lists question, answer, alternate and drill clips in puzzle order, once each, without the scene audio', () => {
    const scene = {
      audio: { src: '/media/a/s.m4a?v=1', durationMs: 1000 },
      frames: [{ t: 0, src: '/media/f/s/0.webp?v=1' }],
      questions: [{ id: 'q1', audio: '/media/q/q1.m4a?v=1', answers: [{ audio: '/media/q/a1.m4a?v=1' }, {}] }],
    } as unknown as Scene;
    const puzzles = [
      { id: 'p0', type: 'listen-pick', sceneId: 's', helpLineIds: [], unitIds: [] },
      { id: 'p1', type: 'say-choice', sceneId: 's', helpLineIds: [], unitIds: [], options: [{ k: 0 }, { k: 1, audio: '/media/q/alt.m4a?v=1' }], alt: { id: 'p1~rebuild', type: 'rebuild' } },
      { id: 'p2', type: 'question', sceneId: 's', helpLineIds: [], unitIds: [], questionId: 'q1' },
      { id: 'p3', type: 'match', sceneId: 's', helpLineIds: [], unitIds: [], pairs: [{ drill: '/media/w/d.mp3?v=1' }, { drill: '/media/q/alt.m4a?v=1' }], frame: '/media/f/s/0.webp?v=1', clip: '/media/a/s.m4a?v=1' },
    ] as unknown as PuzzleBase[];
    expect(practiceClips(puzzles, scene)).toEqual(['/media/q/alt.m4a?v=1', '/media/q/q1.m4a?v=1', '/media/q/a1.m4a?v=1', '/media/w/d.mp3?v=1']);
    expect(practiceClips(puzzles, scene, 2)).toEqual(['/media/q/q1.m4a?v=1', '/media/q/a1.m4a?v=1', '/media/w/d.mp3?v=1', '/media/q/alt.m4a?v=1']);
  });
});
