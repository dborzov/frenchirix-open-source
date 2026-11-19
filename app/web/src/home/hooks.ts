// Small hooks shared by the screens around the practices.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import type { PracticeStartRequest } from '../../../shared/api';
import type { ContentIndex, SceneSummary } from '../../../shared/content';
import { api, ApiRequestError, errorMessage, loadIndex } from '../api';
import { fx } from '../fx';
import { usePlayer } from '../state/player';
import { actionFailed, recover, refreshState } from '../state/recover';
import { scenesById } from './logic';

export interface Async<T> {
  data: T | undefined;
  error: ApiRequestError | Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Run an async loader on mount (and on reload); never throws into React. A failure goes through
 * recover() (a stale view refreshes the state; a lost gate reloads) and the screen shows the error
 * panel with « Réessayer » (`reload`).
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): Async<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Async<T>['error']>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    load().then(
      (v) => {
        if (!live) return;
        setData(v);
        setLoading(false);
      },
      (e: unknown) => {
        if (!live) return;
        recover(e);
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload };
}

export interface IndexData {
  index: ContentIndex;
  byId: Map<string, SceneSummary>;
}

let cachedIndex: IndexData | null = null;

/** The content index with scenes by id. Cached after the first load. */
export function useIndex(): Async<IndexData> {
  return useAsync(async () => {
    if (cachedIndex) return cachedIndex;
    const index = await loadIndex();
    cachedIndex = { index, byId: scenesById(index) };
    return cachedIndex;
  });
}

/** The kid's message for any error from the API or the network (api/errors.ts). */
export function errorText(e: unknown): string {
  return errorMessage(e);
}

/**
 * Fetch the whole state again (GET /api/me) once on mount, quietly: the store already has a copy,
 * which may be from yesterday, or from before a practice finished in another tab or on another device.
 */
export function useRefreshState(): void {
  useEffect(() => {
    void refreshState();
  }, []);
}

/**
 * Start a practice and open it. The plan goes to the practice screen in the navigation state
 * (`history.state.plan`).
 */
export function useStartPractice(): { start: (req: PracticeStartRequest) => Promise<void>; busy: boolean } {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const start = useCallback(
    async (req: PracticeStartRequest) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const res = await api.startPractice(req);
        usePlayer.getState().apply(res.patch);
        fx.sfx('whoosh');
        // `fresh`: the practice screen uses this plan once instead of asking the server again.
        navigate(`/practice/${encodeURIComponent(res.plan.id)}`, { state: { plan: res.plan, fresh: true } });
      } catch (e) {
        actionFailed(e);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [navigate],
  );
  return { start, busy };
}

/** The width of an element, kept up to date. Pass the returned callback as `ref`. */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

/** True once, after mount, for entrance animations that need a frame. */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setM(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return m;
}

/**
 * "Do more" (POST /api/daily/more): a fresh draw of candidates and extra quests, once every quest is done.
 * On success `then` runs (Home opens the candidates screen); a refusal goes back to the screen as it was.
 */
export function useDoMore(then?: () => void): { more: () => Promise<void>; busy: boolean } {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const more = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await api.more();
      usePlayer.getState().apply(res.patch);
      fx.sfx('whoosh');
      then?.();
    } catch (e) {
      actionFailed(e);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [then]);
  return { more, busy };
}
