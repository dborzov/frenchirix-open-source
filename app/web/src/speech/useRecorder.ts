// useRecorder(): the microphone for a React view, the same in every speaking puzzle type. The first
// time ever, a kind explanation comes before the browser's permission prompt ("on va te demander le
// micro"); then each take is record() -> (stop() | auto stop) -> onTake(take). A take with nothing in
// it comes back judged silent; a take cut off by an interrupted audio context ends like an auto stop.
// Every take that starts reaches onTake, except after pause(), reset(), unmounting, or the page hidden,
// which drop it: nothing is sent, no try spent, the microphone is off and the status back to idle. Denied or missing microphones
// end in a status the view explains once, with a way to skip; so does a microphone that heard no
// voice in UNHEARD_LIMIT takes in a row ('deaf'). Nothing ever leaves a kid stuck.
//
// The microphone is open only while the status is 'opening' or 'recording', and the view shows the
// listening control (MicControl) in both; it is released after every take.
import { useCallback, useEffect, useRef, useState } from 'react';
import { audio } from '../audio';
import { log, puzzleWhere } from '../log';
import { MicError, MicRecorder, micSupported, takeLimitMs, type Take } from './recorder';

export type RecorderStatus =
  | 'idle'
  | 'intro' // the explanation screen before the first permission prompt
  | 'opening' // waiting for the permission / the mic
  | 'recording'
  | 'processing'
  | 'denied' // the kid or the device said no
  | 'unsupported' // no microphone API or no microphone
  | 'error'
  | 'deaf'; // UNHEARD_LIMIT takes in a row with no voice: probably a muted or broken microphone

/** The statuses in which the view shows the microphone's own notice (MicNotice) instead of the control. */
export const NOTICE_STATUSES: readonly RecorderStatus[] = ['intro', 'denied', 'unsupported', 'error', 'deaf'];
export const isNotice = (s: RecorderStatus) => NOTICE_STATUSES.includes(s);

/** Takes in a row with no voice heard before the microphone is said not to hear (the 'deaf' notice). */
export const UNHEARD_LIMIT = 3;

const INTRO_KEY = 'frx.mic.intro';

function introSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}
function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_KEY, '1');
  } catch {
    /* private mode: the intro shows again next time, which is fine */
  }
}

/** Per-take options: the end-of-speech silence (Infinity: never), another ceiling than 10 s, the whole take untrimmed. */
export interface TakeOptions {
  silenceMs?: number;
  capMs?: number;
  whole?: boolean;
}

/**
 * Options of the hook, for the karaoke: `playAlong` lets sound play while the microphone is open (the
 * song); `lazy` waits for a tap before saying a microphone is missing (no notice and no log on arrival;
 * after a notice the status goes back to idle, so the screen's own way back works); `intro` false skips
 * the speaking puzzles' first-time explanation (the screen has its own).
 */
export interface RecorderOptions {
  playAlong?: boolean;
  lazy?: boolean;
  intro?: boolean;
}

/** The take under way, for the countdown: its limit and when it started (performance.now()). */
export interface TakeClock {
  id: number;
  limitMs: number;
  startedAt: number;
}

export type LevelListener = (level: number, voice: boolean) => void;

export interface UseRecorder {
  status: RecorderStatus;
  /** Set while recording. */
  clock: TakeClock | null;
  /** Takes in a row in which no voice was heard (silent or too short); 0 after a take with a voice or reset() (one short of UNHEARD_LIMIT after the 'deaf' notice). */
  unheard: number;
  /** The live level while recording, about 20 times a second, without re-rendering the view. Returns the unsubscribe. */
  onLevel(fn: LevelListener): () => void;
  /** Start a take (call from a tap). Shows the intro first when the kid has never seen it. */
  record(maxMs: number, opts?: TakeOptions): void;
  /** The intro's OK button (a tap): remembers it and starts the take. */
  acceptIntro(): void;
  /** "Done": end the take now; it goes to onTake. */
  stop(): void;
  /** Pause: drop the take under way (or the microphone being opened); nothing is sent, back to idle. */
  pause(): void;
  /** Back to idle (after a denied, failed or deaf microphone, to try again). */
  reset(): void;
}

export function useRecorder(onTake: (take: Take) => void, options: RecorderOptions = {}): UseRecorder {
  const playAlong = !!options.playAlong;
  const lazy = !!options.lazy;
  const ownIntro = options.intro !== false;
  const [status, setStatus] = useState<RecorderStatus>(() => (lazy || micSupported() ? 'idle' : 'unsupported'));
  const [clock, setClock] = useState<TakeClock | null>(null);
  const [unheard, setUnheard] = useState(0);
  const unheardRef = useRef(0);
  const rec = useRef<MicRecorder | null>(null);
  const pendingMax = useRef(8000);
  const pendingOpts = useRef<TakeOptions>({});
  const onTakeRef = useRef(onTake);
  onTakeRef.current = onTake;
  const live = useRef(true);
  const listeners = useRef(new Set<LevelListener>());
  const takeId = useRef(0);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      rec.current?.cancel();
      rec.current = null;
    };
  }, []);

  // A microphone that cannot be used goes to the activity log.
  useEffect(() => {
    if (status === 'denied' || status === 'unsupported' || status === 'error' || status === 'deaf') log('mic', { status, type: puzzleWhere()?.type ?? null });
  }, [status]);

  // Nothing plays while the microphone is open: it would go into the take, over the kid's voice (once,
  // the whole line looped into the take: the kid had tapped the microphone while the missing piece of
  // a miss played, and the line that follows it came a moment later; a box tapped in the help strip).
  // The recorder silenced the French when it opened; whatever starts after that is stopped at once
  // (just after the engine's own notification, not inside it). Karaoke plays its song on purpose.
  const micOpen = status === 'opening' || status === 'recording';
  useEffect(() => {
    if (!micOpen || playAlong) return;
    return audio.subscribe((st) => {
      if (st.playing || st.loading) queueMicrotask(() => rec.current && audio.stop());
    });
  }, [micOpen, playAlong]);

  const setUnheardBoth = (n: number) => {
    unheardRef.current = n;
    setUnheard(n);
  };

  const finish = useCallback(async (r: MicRecorder) => {
    if (live.current) setStatus('processing');
    setClock(null);
    const take = await r.stop();
    if (rec.current === r) rec.current = null;
    if (!live.current) {
      if (take) URL.revokeObjectURL(take.url);
      return;
    }
    if (!take) {
      setStatus('idle');
      return;
    }
    const n = take.problem ? unheardRef.current + 1 : 0;
    setUnheardBoth(n);
    setStatus(n >= UNHEARD_LIMIT ? 'deaf' : 'idle');
    onTakeRef.current(take);
  }, []);

  /** Drops what is under way: the take is cancelled (never reaches onTake) and the microphone released. */
  const drop = useCallback((unheardTo: number | null) => {
    rec.current?.cancel();
    rec.current = null;
    setClock(null);
    if (unheardTo !== null) setUnheardBoth(unheardTo);
    setStatus(lazy || micSupported() ? 'idle' : 'unsupported');
  }, [lazy]);

  const begin = useCallback(
    (maxMs: number, opts: TakeOptions = {}) => {
      if (!micSupported()) {
        setStatus('unsupported');
        return;
      }
      const r = new MicRecorder();
      rec.current = r;
      setStatus('opening');
      const limitMs = takeLimitMs(maxMs, opts.capMs);
      r.start({
        maxMs: limitMs,
        ...opts,
        onLevel: (l, voice) => {
          if (live.current && rec.current === r) for (const fn of listeners.current) fn(l, voice);
        },
        onAutoStop: () => void finish(r),
        // The page hidden: dropped like Pause (the view's control pauses too).
        onCut: () => {
          if (rec.current === r) drop(null);
        },
      })
        .then(() => {
          if (live.current && rec.current === r) {
            setClock({ id: ++takeId.current, limitMs, startedAt: performance.now() });
            setStatus('recording');
          } else r.cancel();
        })
        .catch((e: unknown) => {
          // Paused, reset or unmounted while the microphone was opening: not an error, nothing to show.
          if (rec.current !== r || !live.current) return;
          rec.current = null;
          const kind = e instanceof MicError ? e.kind : 'error';
          setStatus(kind === 'denied' ? 'denied' : kind === 'unsupported' ? 'unsupported' : 'error');
        });
    },
    [finish, drop],
  );

  const record = useCallback(
    (maxMs: number, opts: TakeOptions = {}) => {
      if (rec.current) return;
      pendingMax.current = maxMs;
      pendingOpts.current = opts;
      if (ownIntro && !introSeen()) {
        setStatus('intro');
        return;
      }
      begin(maxMs, opts);
    },
    [begin, ownIntro],
  );

  const acceptIntro = useCallback(() => {
    markIntroSeen();
    begin(pendingMax.current, pendingOpts.current);
  }, [begin]);

  const stop = useCallback(() => {
    const r = rec.current;
    if (r && r.recording) void finish(r);
  }, [finish]);

  const pause = useCallback(() => drop(null), [drop]);
  // After the 'deaf' notice, « Réessayer le micro » gives the microphone one more take: if it hears
  // nothing again, the notice comes back at once rather than after UNHEARD_LIMIT more silent takes.
  const reset = useCallback(() => drop(unheardRef.current >= UNHEARD_LIMIT ? UNHEARD_LIMIT - 1 : 0), [drop]);

  const onLevel = useCallback((fn: LevelListener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return { status, clock, unheard, onLevel, record, acceptIntro, stop, pause, reset };
}
