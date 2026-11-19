// The content loader: the static bundle in public/data (written by `frenchirix export-app`).
// Cached in memory. Scene and song URLs carry the content version, so the browser can cache them hard.
// Under VITE_FIXTURES=1, when /data has nothing, it falls back to the shared fixtures.
import type { ContentIndex, Scene, Song } from '../../../shared/content';
import { request } from './client';

const FIXTURES = import.meta.env.VITE_FIXTURES === '1';

let indexPromise: Promise<ContentIndex> | null = null;
const scenes = new Map<string, Promise<Scene>>();
const songs = new Map<string, Promise<Song>>();

/**
 * Through the API client's request(), so content fails like any call (a timeout, the kinds of
 * api/errors.ts, the gate reload). The SPA fallback answers a missing file with index.html, which
 * fails as "not JSON".
 */
function getJson<T>(url: string): Promise<T> {
  return request<T>('GET', url);
}

/**
 * Media paths in the bundle (`/media/...`) get the content version too, so a scene's JSON and its
 * audio and frames always come from the same export: a browser never pairs cached old timings with
 * new audio (or the reverse). The Worker caches `?v=` URLs for a year only under the deployed version
 * and answers any other version `no-store` (worker/pwa.ts), so an old page cannot poison the cache.
 */
export function versionMedia<T>(value: T, version: string): T {
  if (!version) return value;
  const v = `?v=${encodeURIComponent(version)}`;
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return x.startsWith('/media/') && !x.includes('?') ? x + v : x;
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x)) out[k] = walk(val);
      return out;
    }
    return x;
  };
  return walk(value) as T;
}

async function fixtures() {
  return import('../../../shared/fixtures');
}

export function loadIndex(): Promise<ContentIndex> {
  indexPromise ??= getJson<ContentIndex>('/data/index.json').then((ix) => ({ ...ix, scenes: versionMedia(ix.scenes, ix.version), songs: versionMedia(ix.songs, ix.version) })).catch(async (e) => {
    if (!FIXTURES) {
      indexPromise = null;
      throw e;
    }
    return (await fixtures()).FIXTURE_INDEX;
  });
  return indexPromise;
}

async function versioned(path: string): Promise<string> {
  const index = await loadIndex();
  return `${path}?v=${encodeURIComponent(index.version)}`;
}

export function loadScene(id: string): Promise<Scene> {
  let p = scenes.get(id);
  if (!p) {
    p = versioned(`/data/scenes/${encodeURIComponent(id)}.json`)
      .then(async (url) => versionMedia(await getJson<Scene>(url), (await loadIndex()).version))
      .catch(async (e) => {
        if (FIXTURES) {
          const s = (await fixtures()).fixtureSceneFor(id);
          if (s) return s;
        }
        scenes.delete(id);
        throw e;
      });
    scenes.set(id, p);
  }
  return p;
}

export function loadSong(id: string): Promise<Song> {
  let p = songs.get(id);
  if (!p) {
    p = versioned(`/data/songs/${encodeURIComponent(id)}.json`)
      .then(async (url) => versionMedia(await getJson<Song>(url), (await loadIndex()).version))
      .catch(async (e) => {
        if (FIXTURES) {
          const f = await fixtures();
          if (id === f.FIXTURE_SONG.id) return f.FIXTURE_SONG;
        }
        songs.delete(id);
        throw e;
      });
    songs.set(id, p);
  }
  return p;
}
