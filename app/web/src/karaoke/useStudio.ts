// The karaoke studio (docs/app-games.md, "Karaoke: singing along with the microphone"): record a take
// while the song plays once from its start, check it on the server (rude words only), hear it over the
// song, then keep it as the song's recording or throw it away. The song's player (KaraokePlayer) owns
// the playing; this hook owns the take and tells the player what plays over the song (`overlay`).
//
//   idle ─record─▶ (intro, the first time) ─▶ recording ─(the song ends | done)─▶ checking ─ok─▶ listen ─keep─▶ idle
//     ▲                                          │ Pause, no voice, too short       │ refused,       │ throw away,
//     └──────────────────────────────────────────┴──────────────────────────────────┴ throw away ────┴ do it again
//                                                                                    └ failed (the singing is still in the page: try again)
//
// "Take" is a word of the code; the kid hears about their singing (shared/i18n/fr.ts). The microphone
// is open only while the recorder says so (MicControl shows it) and is released when the take ends,
// also when the kid leaves the song (another song by the back button, another screen). A take with no
// voice is never sent (the voice gate). Whenever the studio is not recording or listening, the song
// plays as the karaoke screen always does. A take the server checked but the kid neither kept nor threw
// away (they left) is dropped from the server, best effort.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KaraokeRecording, KaraokeTake } from '../../../shared/api';
import type { Song } from '../../../shared/content';
import { t } from '../../../shared/i18n';
import { alignTake, KARAOKE_MAX_MS, KARAOKE_MIN_MS, KARAOKE_RATE, KARAOKE_SLACK_MS, takeOffsetMs } from '../../../shared/karaoke';
import { api, ApiRequestError, errorDetail, errorMessage, RequestAbandoned } from '../api';
import { audio, type Overlay, type PlayHandle } from '../audio';
import { fx } from '../fx';
import { holdUpdates } from '../pwa/update';
import { devTestTranscript, isNotice, sliceWav, useRecorder, type Take, type TakeClock, type UseRecorder } from '../speech';
import { usePlayer } from '../state/player';
import { actionFailed, recover } from '../state/recover';
import { toast } from '../ui';

export type StudioPhase =
  | 'idle'
  | 'intro' // the karaoke's own first-time notice: what happens to the singing
  | 'recording' // the microphone opens (or its notice shows), then listens while the song plays once
  | 'silent' // the take had no voice: not sent
  | 'short' // too little voice, or too short once placed on the song: not sent
  | 'checking' // sent; Whisper and the word check
  | 'failed' // the check could not be done: the singing is still in the page, « Réessayer » sends it again
  | 'refused' // rude words: the take is gone
  | 'listen' // the song plays with the take over it; keep it or throw it away
  | 'saving';

/** Options for one play of the song, as KaraokePlayer's play() takes them. */
export interface SongPlayOptions {
  once?: boolean; // play to the end and stop (a take); otherwise the song loops
  onEnd?: () => void;
  onError?: () => void;
  overlay?: Overlay | null; // what plays over the song (default: what the studio says)
}
export type PlaySong = (fromMs?: number, opts?: SongPlayOptions) => PlayHandle | null;

export interface Studio {
  phase: StudioPhase;
  rec: UseRecorder;
  /** The countdown while recording: the song's own time left (the recorder's limit has slack for loading). */
  clock: TakeClock | null;
  error: unknown;
  /** The kid's kept recording of this song, if any. */
  recording: KaraokeRecording | undefined;
  /** What plays over the song now, when it is not the recording: the take while it is heard, nothing while recording. */
  overlay: Overlay | null | undefined;
  /** The player's own controls are off: the song runs once from its start under the microphone. */
  locked: boolean;
  start(): void;
  acceptIntro(): void;
  cancel(): void;
  send(): void;
  keep(): void;
  drop(): void;
  redo(): void;
  remove(): Promise<boolean>;
  back(): void;
}

/** The page's own copy of a recording's audio (the take it came from), so keeping it downloads nothing. */
const localAudio = new Map<string, string>();

/** What plays over a song for a kid with this recording (Home's card, and the song's screen when idle). */
export function recordingOverlay(rec: KaraokeRecording | undefined): Overlay | null {
  return rec ? { src: localAudio.get(rec.id) ?? rec.url, offsetMs: rec.offsetMs } : null;
}

function forgetLocal(recordingId: string | undefined): void {
  const url = recordingId ? localAudio.get(recordingId) : undefined;
  if (url) URL.revokeObjectURL(url);
  if (recordingId) localAudio.delete(recordingId);
}

const INTRO_KEY = 'frx.karaoke.intro';
function introSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

interface LocalTake {
  songId: string;
  wav: Blob;
  url: string;
  offsetMs: number;
  durationMs: number;
}

/** The studio of one song on the full karaoke screen. `play` is the player's play(); `tag` the song's audio tag. */
export function useStudio(song: Song, tag: string, play: PlaySong): Studio {
  const songId = song.id;
  const recording = usePlayer((s) => s.state?.recordings?.[songId]);
  const [phase, setPhase] = useState<StudioPhase>('idle');
  const [error, setError] = useState<unknown>(null);
  const [clock, setClock] = useState<TakeClock | null>(null);
  const take = useRef<LocalTake | null>(null);
  const checked = useRef<KaraokeTake | null>(null);
  const checking = useRef<AbortController | null>(null);
  const songZero = useRef<number | null>(null);
  const armed = useRef(false);
  const live = useRef(true);
  const playRef = useRef(play);
  playRef.current = play;
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  // The phase as last set (the state shows it at the next render; handlers after an await read this).
  const phaseRef = useRef(phase);
  const go = useCallback((p: StudioPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);
  // Each take handed over gets a number; a take started, cancelled, thrown away or left since makes it stale.
  const takeNo = useRef(0);

  const clearTake = useCallback(() => {
    const tk = take.current;
    if (tk && ![...localAudio.values()].includes(tk.url)) URL.revokeObjectURL(tk.url);
    take.current = null;
    checked.current = null;
  }, []);

  /** The karaoke screen as it always is: the song plays (from where it is, or its start), the recording over it. */
  const playOn = useCallback(
    (from: 'here' | 'start' = 'here') => {
      const st = audio.getState();
      if (audio.isMuted()) return;
      if (from === 'here' && st.tag === tag && st.playing && st.loop) return; // already as it should be
      const at = from === 'here' && st.tag === tag ? audio.getPositionMs() : 0;
      playRef.current(at >= song.audio.durationMs - 300 ? 0 : at, { overlay: recordingOverlay(recordingRef.current) });
    },
    [tag, song.audio.durationMs],
  );

  // The server's copy of a checked take the kid did not keep: thrown away, best effort (a failure leaves
  // it to the next take of the song or the daily purge; nothing to show the kid, request() logs it).
  const dropOnServer = useCallback((id: string) => void api.karaokeDrop(id).catch(() => {}), []);

  const send = useCallback(async () => {
    const tk = take.current;
    if (!tk) return;
    go('checking');
    setError(null);
    const ctrl = new AbortController();
    checking.current = ctrl;
    try {
      const testTranscript = devTestTranscript();
      const res = await api.karaokeTake(tk.songId, tk.wav, tk.offsetMs, { ...(testTranscript !== undefined ? { testTranscript } : {}), signal: ctrl.signal });
      if (!live.current || take.current !== tk) return;
      usePlayer.getState().apply(res.patch);
      if (res.verdict !== 'ok' || !res.take) {
        clearTake();
        go('refused');
        playOn();
        return;
      }
      checked.current = res.take;
      go('listen');
      playRef.current(0, { overlay: { src: tk.url, offsetMs: tk.offsetMs } });
    } catch (e) {
      if (e instanceof RequestAbandoned || !live.current || take.current !== tk) return;
      if (!recover(e)) return; // the page is reloading
      setError(e);
      go('failed');
    } finally {
      if (checking.current === ctrl) checking.current = null;
    }
  }, [clearTake, go, playOn]);

  const onTake = useCallback(
    async (raw: Take) => {
      URL.revokeObjectURL(raw.url);
      if (!live.current || phaseRef.current !== 'recording') return;
      if (raw.problem) {
        go(raw.problem === 'short' ? 'short' : 'silent');
        playOn();
        return;
      }
      go('checking'); // at once, in the same render as the recorder going idle
      const no = ++takeNo.current;
      playOn(); // the song goes on while the singing is checked
      // The voice where it was sung: the song position heard when the take's first sample was captured.
      // What the microphone caught before the song began, or after it ended, is cut.
      const zero = songZero.current;
      const { dropSamples, offsetMs } = alignTake(zero !== null && raw.capturedAt !== undefined ? takeOffsetMs(raw.capturedAt, zero) : 0);
      const keepSamples = Math.max(0, ((song.audio.durationMs + KARAOKE_SLACK_MS / 2 - offsetMs) * KARAOKE_RATE) / 1000);
      const buf = await raw.wav.arrayBuffer();
      const sliced = sliceWav(buf, dropSamples, dropSamples + keepSamples);
      const wav = sliced === buf ? raw.wav : new Blob([sliced], { type: 'audio/wav' });
      const durationMs = Math.round(((wav.size - 44) / 2 / KARAOKE_RATE) * 1000);
      if (!live.current || no !== takeNo.current) return;
      if (durationMs < KARAOKE_MIN_MS) {
        go('short');
        return;
      }
      clearTake();
      take.current = { songId, wav, url: URL.createObjectURL(wav), offsetMs, durationMs };
      void send();
    },
    [song.audio.durationMs, songId, send, clearTake, go, playOn],
  );

  const rec = useRecorder((tk) => void onTake(tk), { playAlong: true, lazy: true, intro: false });
  const recRef = useRef(rec);
  recRef.current = rec;

  // The microphone listens: the song starts over from its beginning, once, and its end ends the take.
  useEffect(() => {
    if (rec.status !== 'recording' || !armed.current) return;
    armed.current = false;
    songZero.current = null;
    const h = playRef.current(0, {
      once: true,
      overlay: null,
      onEnd: () => recRef.current.stop(),
      onError: () => {
        recRef.current.pause();
        go('idle');
        toast(t('karaoke.rec.songError'), { color: 'tomato', icon: 'help' });
      },
    });
    void h?.ready.then(
      () => {
        if (!h.isCurrent()) return;
        songZero.current = audio.clipHeardAt(0);
        setClock({ id: Date.now(), limitMs: song.audio.durationMs, startedAt: songZero.current ?? performance.now() });
      },
      () => {},
    );
  }, [rec.status, song.audio.durationMs, go]);
  useEffect(() => {
    if (rec.status !== 'recording') setClock(null);
  }, [rec.status]);

  // A take that never reached onTake (Pause, the page hidden, a microphone that failed to open) leaves
  // the recording phase with the recorder, and the song plays again.
  useEffect(() => {
    if (phase !== 'recording' || armed.current) return;
    if (rec.status === 'idle' && !take.current) {
      go('idle');
      playOn();
    }
  }, [phase, rec.status, go, playOn]);

  /** Opens the microphone (inside the tap: iOS asks for it there). */
  const startNow = useCallback(() => {
    if (audio.isMuted()) audio.setMuted(false); // singing along needs the song
    takeNo.current++;
    clearTake();
    setError(null);
    armed.current = true;
    go('recording');
    // The limit leaves room for the song to load after the microphone opened; the song's end stops the take first.
    recRef.current.record(song.audio.durationMs + KARAOKE_SLACK_MS + 3000, { silenceMs: Number.POSITIVE_INFINITY, capMs: KARAOKE_MAX_MS, whole: true });
  }, [song.audio.durationMs, clearTake, go]);

  const start = useCallback(() => {
    // The first time a kid records a song: what happens to their singing, whatever they met before.
    if (!introSeen()) {
      go('intro');
      return;
    }
    startNow();
  }, [go, startNow]);

  const acceptIntro = useCallback(() => {
    try {
      localStorage.setItem(INTRO_KEY, '1');
    } catch {
      // private mode: the notice shows again next time
    }
    startNow();
  }, [startNow]);

  const cancel = useCallback(() => {
    takeNo.current++;
    armed.current = false;
    recRef.current.pause();
    go('idle');
    playOn();
  }, [go, playOn]);

  const drop = useCallback(() => {
    const tk = take.current;
    const onServer = !!checked.current || phaseRef.current === 'checking';
    takeNo.current++;
    checking.current?.abort();
    clearTake();
    go('idle');
    if (tk && onServer) dropOnServer(tk.songId);
    if (audio.getState().tag !== tag || !audio.getState().playing) playOn('start');
  }, [tag, clearTake, go, dropOnServer, playOn]);

  const redo = useCallback(() => {
    drop();
    start();
  }, [drop, start]);

  const keep = useCallback(async () => {
    const c = checked.current;
    const tk = take.current;
    if (!c || !tk) return;
    go('saving');
    try {
      const res = await api.karaokeSave(tk.songId, c.id);
      const old = recordingRef.current;
      usePlayer.getState().apply(res.patch);
      if (old && old.id !== res.recording.id) forgetLocal(old.id); // the recording it replaced
      localAudio.set(res.recording.id, tk.url); // the same audio as the server's: nothing to download
      take.current = null;
      checked.current = null;
      if (!live.current) return;
      go('idle');
      fx.sfx('win');
      toast(t('karaoke.rec.saved'), { color: 'lime', icon: 'check', tag: 'karaoke-kept' });
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiRequestError && e.code === 'no-take') {
        // The server no longer holds it (replaced on another device, or kept unsaved too long).
        clearTake();
        go('idle');
        toast(errorMessage(e), { color: 'yellow', icon: 'loop', detail: errorDetail(e) });
        return;
      }
      actionFailed(e);
      go('listen');
    }
  }, [go]);

  const remove = useCallback(async () => {
    const old = recordingRef.current;
    try {
      const res = await api.karaokeRemove(songId);
      usePlayer.getState().apply(res.patch);
      forgetLocal(old?.id);
      toast(t('karaoke.rec.removed'), { color: 'white', icon: 'check', tag: 'karaoke-removed' });
      return true;
    } catch (e) {
      actionFailed(e);
      return false;
    }
  }, [songId]);

  const back = useCallback(() => {
    recRef.current.reset();
    armed.current = false;
    takeNo.current++;
    go('idle');
    playOn();
  }, [go, playOn]);

  // Leaving the song (another song, the back button, another screen): the microphone is released and
  // the take dropped; a take the server holds unkept is thrown away there too.
  useEffect(() => {
    live.current = true;
    return () => {
      const p = phaseRef.current;
      const tk = take.current;
      takeNo.current++;
      armed.current = false;
      checking.current?.abort();
      recRef.current.pause();
      if (tk && (p === 'checking' || p === 'failed' || p === 'listen')) dropOnServer(tk.songId);
      clearTake();
      setError(null);
      setClock(null);
      go('idle');
      live.current = false;
    };
  }, [songId, clearTake, go, dropOnServer]);

  // A take under way must not be cut by an update of the app (docs/app-release.md, "Updates").
  const busy = phase === 'intro' || phase === 'recording' || phase === 'checking' || phase === 'failed' || phase === 'listen' || phase === 'saving';
  useEffect(() => (busy ? holdUpdates() : undefined), [busy]);

  const micOpen = rec.status === 'opening' || rec.status === 'recording';
  const overlay: Overlay | null | undefined =
    phase === 'recording' && !isNotice(rec.status) ? null : (phase === 'listen' || phase === 'saving') && take.current ? { src: take.current.url, offsetMs: take.current.offsetMs } : undefined;

  return {
    phase,
    rec,
    clock,
    error,
    recording,
    overlay,
    locked: phase === 'recording' && (micOpen || armed.current) && !isNotice(rec.status),
    start,
    acceptIntro,
    cancel,
    send: () => void send(),
    keep: () => void keep(),
    drop,
    redo,
    remove,
    back,
  };
}
