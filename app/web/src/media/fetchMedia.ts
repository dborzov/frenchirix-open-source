// Fetching a media file (scene and song audio, clips, frames) with progress and a stall timeout
// (docs/app-games.md, "Loading media"). The audio engine loads every clip through it; the media gate
// loads frames through it too, so a screen's bar counts the bytes of everything it waits for.
//
// A load that receives nothing for MEDIA_TIMEOUT_MS is aborted and fails as a timeout: a stalled
// connection becomes an error the kid can retry, never a screen that waits forever. A slow load that
// keeps receiving bytes is never cut.

/** After this long still loading, the media gate adds its "slow connection" line. */
export const MEDIA_SLOW_MS = 8_000;
/** A load that receives no bytes for this long is aborted (MediaLoadError, reason 'timeout'). */
export const MEDIA_TIMEOUT_MS = 25_000;

/** Why a media file did not load: no answer in time, no network, an HTTP error, or a file the browser cannot decode. */
export type MediaFailure = 'timeout' | 'offline' | 'http' | 'decode';

/** A media file that could not be loaded. `status` is the HTTP status, 0 when there was none. */
export class MediaLoadError extends Error {
  readonly src: string;
  readonly status: number;
  readonly reason: MediaFailure;
  readonly at: number;
  constructor(src: string, status: number, reason: MediaFailure, message?: string) {
    super(message ?? `${reason} ${status} ${src}`);
    this.name = 'MediaLoadError';
    this.src = src;
    this.status = status;
    this.reason = reason;
    this.at = Date.now();
  }
}

/** Bytes received so far, and the file's size when the response says it (Content-Length, uncompressed). */
export interface Bytes {
  loaded: number;
  total: number | null;
}

export interface FetchMediaOptions {
  onProgress?: (b: Bytes) => void;
  /** Abort after this long without a byte (default MEDIA_TIMEOUT_MS). */
  stallMs?: number;
}

/** Fetch a media file to an ArrayBuffer, reporting bytes as they arrive. Rejects with a MediaLoadError. */
export async function fetchMedia(src: string, { onProgress, stallMs = MEDIA_TIMEOUT_MS }: FetchMediaOptions = {}): Promise<ArrayBuffer> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ctl?.abort();
    }, stallMs);
  };
  const fail = (e: unknown) => (e instanceof MediaLoadError ? e : new MediaLoadError(src, 0, timedOut ? 'timeout' : 'offline', timedOut ? `no data for ${Math.round(stallMs / 1000)} s` : String(e)));
  arm();
  try {
    const r = await fetch(src, { credentials: 'same-origin', ...(ctl ? { signal: ctl.signal } : {}) });
    if (!r.ok) throw new MediaLoadError(src, r.status, 'http', `HTTP ${r.status}`);
    // A compressed answer's Content-Length counts the compressed bytes, not what the reader gives.
    const length = Number(r.headers.get('content-length'));
    const total = length > 0 && !r.headers.get('content-encoding') ? length : null;
    onProgress?.({ loaded: 0, total });
    const reader = r.body?.getReader?.();
    if (!reader) {
      const whole = await r.arrayBuffer();
      onProgress?.({ loaded: whole.byteLength, total: whole.byteLength });
      return whole;
    }
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total: total !== null ? Math.max(total, loaded) : null });
    }
    const out = new Uint8Array(loaded);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    onProgress?.({ loaded, total: loaded });
    return out.buffer;
  } catch (e) {
    throw fail(e);
  } finally {
    clearTimeout(timer);
  }
}
