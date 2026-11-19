// What a screen's first moment needs, loaded together with one progress (docs/app-games.md, "Loading
// media"): audio through the engine (fetched and decoded into its cache), frames through fetchMedia (the
// browser's HTTP cache then serves the <img>). Progress is by bytes when every response said its size
// (Content-Length), else by files done out of files needed: never an invented animation.
import { audio } from '../audio';
import { fetchMedia, type Bytes } from './fetchMedia';

export interface FirstMoment {
  audio: string[];
  images: string[];
}

export interface MediaProgress {
  /** Files done out of files needed. */
  done: number;
  count: number;
  /** Bytes received, and the sum of the sizes once every file has said its size (else null). */
  loaded: number;
  total: number | null;
}

/** How many of a scene's or song's first frames its screen waits for (a frame every 2 s or so). */
export const FIRST_FRAMES = 3;

/** What the first moment of a scene or song needs: its audio and its first frames. */
export function firstMoment(media: { audio: { src: string }; frames: readonly { src: string }[] }): FirstMoment {
  return { audio: [media.audio.src], images: media.frames.slice(0, FIRST_FRAMES).map((f) => f.src) };
}

/** The share done, 0..1: by bytes when every size is known, else by files. */
export function progressFraction(p: MediaProgress): number {
  if (p.count === 0) return 1;
  if (p.total !== null && p.total > 0) return Math.min(1, p.loaded / p.total);
  return p.done / p.count;
}

/** Frames this page fetched (with their size), so a screen opened again passes at once. */
const imagesIn = new Map<string, number>();

/** True when everything is already in (the gate then shows nothing at all). */
export function isLoaded(m: FirstMoment): boolean {
  return m.audio.every((s) => audio.isLoaded(s)) && m.images.every((s) => imagesIn.has(s));
}

/** Load everything; rejects with the first file's MediaLoadError (the others go on into the cache). */
export function loadMedia(m: FirstMoment, onProgress?: (p: MediaProgress) => void): Promise<void> {
  const srcs = [...new Set([...m.audio, ...m.images])];
  const bytes = new Map<string, Bytes>();
  let done = 0;
  const report = () => {
    if (!onProgress) return;
    let loaded = 0;
    let total: number | null = 0;
    for (const s of srcs) {
      const b = bytes.get(s);
      loaded += b?.loaded ?? 0;
      total = total !== null && b && b.total !== null ? total + b.total : null;
    }
    onProgress({ done, count: srcs.length, loaded, total });
  };
  const track = (src: string) => (b: Bytes) => {
    bytes.set(src, b);
    report();
  };
  const finished = () => {
    done++;
    report();
  };
  report();
  const audioSet = new Set(m.audio);
  return Promise.all(
    srcs.map((src) => {
      if (audioSet.has(src)) return audio.load(src, track(src)).then(finished);
      const size = imagesIn.get(src);
      if (size !== undefined) {
        track(src)({ loaded: size, total: size });
        finished();
        return Promise.resolve();
      }
      return fetchMedia(src, { onProgress: track(src) }).then((buf) => {
        imagesIn.set(src, buf.byteLength);
        finished();
      });
    }),
  ).then(() => undefined);
}

/** Clips fetched ahead (or being fetched) by this page: never twice. */
const ahead = new Set<string>();

/**
 * Fetch ahead, in the background: files the screen will play later (a practice's clips), in order, a
 * few at a time. Only the download: the bytes land in the browser's HTTP cache (the media URLs are
 * cached hard), and the engine decodes a clip when it is played, so nothing here counts against the
 * engine's memory cap. A failure stays quiet; the play itself loads the clip again and says so when it
 * fails. Returns a function that stops what has not started yet.
 */
export function fetchAhead(srcs: string[], concurrency = 3): () => void {
  const queue = [...new Set(srcs)].filter((s) => !audio.isLoaded(s) && !ahead.has(s));
  let stopped = false;
  const next = (): Promise<void> | void => {
    let src = stopped ? undefined : queue.shift();
    while (src && ahead.has(src)) src = queue.shift(); // taken by another run meanwhile
    if (!src) return;
    ahead.add(src);
    return fetchMedia(src).then(next, () => {
      ahead.delete(src); // quiet: the play loads it again when it needs it
      return next();
    });
  };
  for (let i = 0; i < concurrency; i++) void next();
  return () => {
    stopped = true;
  };
}
