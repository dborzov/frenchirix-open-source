// The content bundle on the server: /data/index.json through env.ASSETS, loaded once per isolate;
// a scene's or a song's JSON only when needed (speech, the karaoke check). Nothing generated is imported into the bundle.
import type { ContentIndex, Scene, SceneSummary, Song } from '../shared/content';
import type { Env } from './env';

export interface Content {
  index: ContentIndex;
  byId: Map<string, SceneSummary>;
  /** Unlockable scenes: every scene of the index, songs included (they are on the timelines too). */
  sceneIds: string[];
  /** Episode id -> [first, last] line numbers of each scene, to map unit and line ids to scenes. */
  ranges: Map<string, { id: string; from: number; to: number }[]>;
}

let cached: Promise<Content> | null = null;
let override: { index: ContentIndex; scene: (id: string) => Scene | null; song?: (id: string) => Song | null } | null = null;
const sceneCache = new Map<string, Promise<Scene | null>>();
const songCache = new Map<string, Promise<Song | null>>();

/** Tests: serve this content instead of the bundle (null restores the bundle). */
export function setContentForTests(c: { index: ContentIndex; scene: (id: string) => Scene | null; song?: (id: string) => Song | null } | null): void {
  override = c;
  cached = null;
  sceneCache.clear();
  songCache.clear();
}

const SCENE_ID_RE = /^(s\d+e\d+)-(\d+)-(\d+)$/;
const LINE_ID_RE = /^(s\d+e\d+)-(\d+)$/;

function build(index: ContentIndex): Content {
  const byId = new Map(index.scenes.map((s) => [s.id, s]));
  const ranges = new Map<string, { id: string; from: number; to: number }[]>();
  for (const s of index.scenes) {
    const m = SCENE_ID_RE.exec(s.id);
    if (!m) continue;
    const list = ranges.get(m[1]!) ?? [];
    list.push({ id: s.id, from: +m[2]!, to: +m[3]! });
    ranges.set(m[1]!, list);
  }
  return { index, byId, sceneIds: index.scenes.map((s) => s.id), ranges };
}

async function fetchJson<T>(env: Env, path: string): Promise<T | null> {
  const res = await env.ASSETS.fetch(new Request(`https://assets.local${path}`));
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null; // the SPA fallback
  return (await res.json()) as T;
}

export function getContent(env: Env): Promise<Content> {
  if (override) return Promise.resolve(build(override.index));
  cached ??= fetchJson<ContentIndex>(env, '/data/index.json').then((index) => {
    if (!index) {
      cached = null;
      throw new Error('content index missing: build the client (npm run build) after export-app');
    }
    return build(index);
  });
  return cached;
}

export function getScene(env: Env, id: string): Promise<Scene | null> {
  if (override) return Promise.resolve(override.scene(id));
  if (!SCENE_ID_RE.test(id)) return Promise.resolve(null);
  let p = sceneCache.get(id);
  if (!p) {
    p = fetchJson<Scene>(env, `/data/scenes/${id}.json`);
    sceneCache.set(id, p);
    if (sceneCache.size > 64) sceneCache.delete(sceneCache.keys().next().value!);
  }
  return p;
}

const SONG_ID_RE = /^[a-z0-9-]{1,80}$/;

/** A karaoke song of the bundle (its lyrics and length), or null when the index does not list it. */
export async function getSong(env: Env, id: string): Promise<Song | null> {
  if (override) return override.song?.(id) ?? null;
  if (!SONG_ID_RE.test(id) || !(await getContent(env)).index.songs.some((s) => s.id === id)) return null;
  let p = songCache.get(id);
  if (!p) {
    p = fetchJson<Song>(env, `/data/songs/${id}.json`).then((song) => {
      if (!song) songCache.delete(id);
      return song;
    });
    songCache.set(id, p);
  }
  return p;
}

/** The scenes that contain a line (a line can belong to several scenes). */
export function scenesOfLine(content: Content, lineId: string): string[] {
  const m = LINE_ID_RE.exec(lineId);
  if (!m) return [];
  const n = +m[2]!;
  return (content.ranges.get(m[1]!) ?? []).filter((r) => r.from <= n && n <= r.to).map((r) => r.id);
}

/** The line id of a unit id ('s01e04-0016:3' -> 's01e04-0016'). */
export function lineOfUnit(unitId: string): string {
  const i = unitId.lastIndexOf(':');
  return i < 0 ? unitId : unitId.slice(0, i);
}

/** Does this unit or line id belong to this scene? */
export function inScene(sceneId: string, unitOrLineId: string): boolean {
  const s = SCENE_ID_RE.exec(sceneId);
  const l = LINE_ID_RE.exec(lineOfUnit(unitOrLineId));
  if (!s || !l || s[1] !== l[1]) return false;
  const n = +l[2]!;
  return +s[2]! <= n && n <= +s[3]!;
}
