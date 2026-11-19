// Route /karaoke/:id, and the compact card Home embeds (<KaraokePlayer params={{ id }} />, compact
// whenever it is not on a /karaoke/ route). A song plays in a loop with its frames as the backdrop;
// the current line is big and bouncing with the words lighting up as they are sung (a line with
// approxTimes lights up as a whole), the next line waits below. Play/pause, restart, a song picker;
// tapping a line jumps to it, tapping a piece of it opens its meaning.
// Starts by itself as soon as audio is unlocked (the first touch anywhere); until then a big
// "tap to sing" burst. The compact card does not start if something else is playing.
// The kid's saved recording of the song plays over it, in time, wherever it plays (the full screen and
// Home's card); the full screen also has the studio (web/src/karaoke/) to record a take, hear it and
// keep it or throw it away. While a take records, the song runs once from its start and the player's
// own controls are off.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import type { Line, Song, SongSummary } from '../../../shared/content';
import { t } from '../../../shared/i18n';
import { loadIndex, loadSong } from '../api';
import { audio, useAudioClock, useAudioState, useMuted, type Overlay } from '../audio';
import { countEvent, flushEvents, installEventCounters } from '../audio/events';
import { fx } from '../fx';
import { Studio, type StudioView } from '../karaoke/StudioPanel';
import { recordingOverlay, type SongPlayOptions } from '../karaoke/useStudio';
import { MediaGate } from '../media/MediaGate';
import { firstMoment } from '../media/loadMedia';
import { hint, useHintAnchor } from '../scene/hint';
import { SceneBar } from '../scene/SceneBar';
import { Slideshow } from '../scene/Slideshow';
import { usePlayer } from '../state/player';
import { Burst, Chip, IconButton, Spinner, Stamp, cx, unitColorVars, useLayout } from '../ui';
import s from './Karaoke.module.css';

installEventCounters();

/** One display row: a line, or one part of a line that has line breaks (lyrics). */
export interface Row {
  key: string;
  line: Line;
  cs: number; // span in line.fr
  ce: number;
  startMs: number;
  endMs: number;
}

/** Split the song's lines into display rows with their times (approxTimes lines share their time by length). */
export function songRows(song: Pick<Song, 'lines'>): Row[] {
  const rows: Row[] = [];
  for (const line of song.lines) {
    const parts: { cs: number; ce: number }[] = [];
    let pos = 0;
    for (const piece of line.fr.split('\n')) {
      parts.push({ cs: pos, ce: pos + piece.length });
      pos += piece.length + 1;
    }
    const total = line.fr.length || 1;
    parts.forEach((p, i) => {
      let a: number;
      let b: number;
      const words = line.units.flatMap((u) => u.words).filter((w) => w.cs >= p.cs && w.ce <= p.ce);
      if (!line.approxTimes && words.length) {
        a = Math.min(...words.map((w) => w.startMs));
        b = Math.max(...words.map((w) => w.endMs));
      } else {
        const d = line.endMs - line.startMs;
        a = line.startMs + (d * p.cs) / total;
        b = line.startMs + (d * Math.min(p.ce + 1, total)) / total;
      }
      rows.push({ key: `${line.id}#${i}`, line, cs: p.cs, ce: p.ce, startMs: Math.round(a), endMs: Math.round(b) });
    });
  }
  return rows;
}

/** The row being sung at ms, or the last one started (holding until the next starts). */
export function rowIndexAt(rows: Row[], ms: number): number {
  let idx = -1;
  for (let i = 0; i < rows.length; i++) if (rows[i]!.startMs - 150 <= ms) idx = i;
  return idx;
}

export default function KaraokePlayerScreen({ params, compact: compactProp }: { params: { id: string }; compact?: boolean }) {
  const [path, navigate] = useLocation();
  const compact = compactProp ?? !path.startsWith('/karaoke/');
  const layout = useLayout();
  const id = params.id;
  const [song, setSong] = useState<Song | null>(null);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tag = `song:${id}`;
  const st = useAudioState();
  const muted = useMuted();
  const playing = st.playing && st.tag === tag;
  // Started but the song is still on its way: the button is busy, never "pause".
  const busy = playing && st.loading;
  const started = useRef(false);
  const sung = useRef(false);
  // The full screen waits behind the media gate for the song and its first frames; Home's card does not.
  const [mediaIn, setMediaIn] = useState(false);

  useEffect(() => {
    setSong(null);
    setMediaIn(false);
    started.current = false;
    sung.current = false;
    loadSong(id).then(setSong, (e: unknown) => setError(String(e)));
    void loadIndex().then((i) => setSongs(i.songs));
    return () => {
      if (audio.getState().tag === tag) audio.stop();
      void flushEvents();
    };
  }, [id, tag]);

  const rows = useMemo(() => (song ? songRows(song) : []), [song]);

  const recording = usePlayer((x) => x.state?.recordings?.[id]);
  // What plays over the song: set below from the studio (or the recording, on Home's card), read when a
  // play starts.
  const overlayRef = useRef<Overlay | null>(null);
  // The overlay the current play asked for (the engine adds it once it has loaded).
  const playedOverlay = useRef<string | null>(null);

  const play = (fromMs = 0, o: SongPlayOptions = {}) => {
    if (!song) return null;
    started.current = true;
    const ov = o.overlay !== undefined ? o.overlay : overlayRef.current;
    playedOverlay.current = ov?.src ?? null;
    return audio.playRange(song.audio.src, 0, song.audio.durationMs, {
      loop: !o.once,
      tag,
      fromMs,
      ...(o.onEnd ? { onEnd: o.onEnd } : {}),
      ...(o.onError ? { onError: o.onError } : {}),
      ...(ov ? { overlay: { ...ov, onError: (e) => console.warn('[karaoke] the recording could not be loaded; the song plays alone', e) } } : {}),
      onIteration: () => {
        if (!sung.current) {
          sung.current = true;
          countEvent('songsSung', id);
          void flushEvents();
          fx.impact(t('karaoke.bravo'), undefined, { size: compact ? 'md' : 'lg' });
        }
      },
    });
  };

  // The studio (the full screen only) says what plays over the song while it holds singing, and when the
  // player's controls rest; otherwise the recording plays over the song.
  const [studio, setStudio] = useState<StudioView>({ overlay: undefined, locked: false, phase: 'idle' });
  const onStudio = useCallback((v: StudioView) => setStudio(v), []);
  const overlay = !compact && studio.overlay !== undefined ? studio.overlay : recordingOverlay(recording);
  overlayRef.current = overlay;
  const locked = !compact && studio.locked;

  // The recording changed while the song plays (kept, erased, singing heard or thrown away, a recording
  // made on another device): the song goes on from where it is, with the right voice over it.
  useEffect(() => {
    if (locked) return;
    const now = audio.getState();
    if (now.tag !== tag || !now.playing || playedOverlay.current === (overlay?.src ?? null)) return;
    play(audio.getPositionMs());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay?.src, overlay?.offsetMs]);

  // Start by itself once audio is unlocked; the compact card leaves alone anything else playing.
  useEffect(() => {
    if (!song || started.current || locked || (!compact && (studio.phase !== 'idle' || !mediaIn)) || !audio.isUnlocked() || audio.isMuted()) return;
    if (compact && st.playing && st.tag !== tag) return;
    play(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, st, compact, locked, mediaIn]);

  const cur = useAudioClock((ms, as) => (as.tag === tag && (as.playing || as.positionMs > 0) ? rowIndexAt(rows, as.playing ? ms : as.positionMs) : -1));
  const curIdx = Math.max(0, cur);

  if (error) return <div className={s.error}>{error}</div>;
  const home = () => navigate('/');
  if (!song) return compact ? <Spinner /> : <MediaGate key={`gate:${id}`} media={null} onHome={home} />;

  const row = rows[curIdx];
  const prev = curIdx > 0 ? rows[curIdx - 1] : undefined;
  const next = rows[curIdx + 1];
  const neverStarted = !started.current && !playing && !locked;
  // The stamp says the voice is in the mix: only once the engine plays it (not while it loads, nor when it failed).
  const voice = !locked && !!overlay && st.tag === tag && st.overlay === overlay.src;

  const screen = (
    <div className={cx(s.player, compact ? s.compact : s.full, layout === 'tablet' && s.tablet, locked && s.locked)} data-karaoke={song.id} data-karaoke-overlay={voice ? overlay!.src : ''} data-karaoke-locked={locked || undefined}>
      <div className={s.stage} data-karaoke-stage>
        <Slideshow frames={song.frames} audioSrc={song.audio.src} fit="fill" className={s.backdrop} alt="" />
        <div className={s.shade} />
        {!compact && <h1 className={s.songTitle}>{song.titleFr}</h1>}
        {voice && (
          <Stamp color="lime" tilt={5} className={s.voiceStamp} data-karaoke-voice>
            {t('karaoke.rec.mine')}
          </Stamp>
        )}
        <div className={s.lyrics}>
          {prev && !compact && (
            <button type="button" className={cx(s.row, s.prev)} onClick={() => play(prev.startMs)} disabled={locked} data-row="prev">
              {prev.line.fr.slice(prev.cs, prev.ce)}
            </button>
          )}
          {row && <CurrentRow key={row.key} row={row} tag={tag} active={cur >= 0} />}
          {next && (
            <button type="button" className={cx(s.row, s.next)} onClick={() => play(next.startMs)} disabled={locked} data-row="next">
              {next.line.fr.slice(next.cs, next.ce)}
            </button>
          )}
        </div>
        {neverStarted && (
          <button type="button" className={s.invite} onClick={() => { if (muted) audio.setMuted(false); play(0); }} data-karaoke-start>
            <Burst size={compact ? 150 : 220} color="yellow" rotate={-6} pop>
              {t('karaoke.sing')}
            </Burst>
            <span className={s.inviteText}>{muted ? t('karaoke.muted') : t('karaoke.tapToSing')}</span>
          </button>
        )}
      </div>
      <SceneBar lines={song.lines} durationMs={song.audio.durationMs} src={song.audio.src} compact={compact} onSeek={(ms) => !locked && play(ms)} className={locked ? s.lockedBar : undefined} />

      <div className={s.controls}>
        <IconButton icon={playing ? 'pause' : 'play'} busy={busy} label={busy ? t('common.media.busy') : playing ? t('karaoke.pause') : t('karaoke.play')} color={playing ? 'yellow' : 'lime'} size={compact ? 'md' : 'lg'} onClick={() => (busy ? undefined : playing ? audio.stop() : play(row && cur >= 0 ? row.startMs : 0))} disabled={locked} data-karaoke-toggle />
        <IconButton icon="loop" label={t('karaoke.restart')} color="white" size={compact ? 'md' : 'lg'} onClick={() => play(0)} disabled={locked} data-karaoke-restart />
        {compact && (
          <button type="button" className={s.compactTitle} onClick={() => navigate(`/karaoke/${song.id}`)}>
            {song.titleFr}
          </button>
        )}
      </div>
      {!compact && <Studio song={song} tag={tag} play={play} onView={onStudio} />}
      {/* The other songs, under the studio: on a phone the record control is then on screen on arrival. */}
      {!compact && (
        <div className={s.picker} role="tablist">
          {songs.map((x) => (
            <Chip key={x.id} color="yellow" selected={x.id === song.id} onClick={() => navigate(`/karaoke/${x.id}`)} disabled={locked}>
              {x.titleFr}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
  if (compact) return screen;
  return (
    <MediaGate key={`gate:${id}`} media={firstMoment(song)} onHome={home} onReady={() => setMediaIn(true)}>
      {screen}
    </MediaGate>
  );
}

function CurrentRow({ row, tag, active }: { row: Row; tag: string; active: boolean }) {
  const open = useHintAnchor();
  const openUnitId = open instanceof HTMLElement ? open.dataset.karaokeUnit : undefined;
  const line = row.line;
  // The word being sung (index among the row's words), -2 before the row, 999 after; approx lines light whole.
  const pos = useAudioClock((ms, as) => {
    if (as.tag !== tag || !as.playing) return -2;
    if (line.approxTimes) return ms >= row.startMs ? 999 : -2;
    const words = line.units.flatMap((u) => u.words).filter((w) => w.cs >= row.cs && w.ce <= row.ce);
    let k = -2;
    for (let i = 0; i < words.length; i++) {
      if (ms >= words[i]!.startMs - 40) k = i;
      if (ms > words[i]!.endMs + 40 && i === words.length - 1) k = 999;
    }
    return k;
  });
  const units = line.units.map((u, i) => ({ u, i })).filter(({ u }) => u.ce > row.cs && u.cs < row.ce);
  let wi = 0;
  const parts: ReactNode[] = [];
  let p = row.cs;
  for (const { u, i } of units) {
    const a = Math.max(u.cs, row.cs);
    const b = Math.min(u.ce, row.ce);
    if (a > p) parts.push(<span key={`t${a}`} className={s.punct}>{line.fr.slice(p, a)}</span>);
    const ws = u.words.filter((w) => w.cs >= row.cs && w.ce <= row.ce);
    const inner: ReactNode[] = [];
    let q = a;
    for (const w of ws) {
      if (w.cs > q) inner.push(line.fr.slice(q, w.cs));
      const k = wi++;
      const state = line.approxTimes ? (pos === 999 ? 'on' : '') : k < pos ? 'sung' : k === pos ? 'on' : '';
      inner.push(
        <span key={k} className={cx(s.word, state === 'sung' && s.sung, state === 'on' && s.on)}>
          {line.fr.slice(w.cs, w.ce)}
          {state === 'on' && !line.approxTimes && <i className={s.ball} aria-hidden />}
        </span>,
      );
      q = w.ce;
    }
    if (q < b) inner.push(line.fr.slice(q, b));
    parts.push(
      <span
        key={u.id}
        role="button"
        tabIndex={0}
        className={cx(s.unit, openUnitId === u.id && s.unitOpen)}
        style={unitColorVars(i) as CSSProperties}
        onClick={(e) => {
          fx.pop(e.currentTarget);
          hint.toggle(e.currentTarget, { en: u.en, note: u.note }); // the shared hint bubble: English only
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') hint.toggle(e.currentTarget, { en: u.en, note: u.note });
        }}
        data-karaoke-unit={u.id}
      >
        <span>{inner}</span>
      </span>,
    );
    p = b;
  }
  if (p < row.ce) parts.push(<span key="end" className={s.punct}>{line.fr.slice(p, row.ce)}</span>);
  return (
    <div className={cx(s.row, s.current, active && s.bounce, line.approxTimes && pos === 999 && s.allOn)} data-row="current" data-line={line.id}>
      {parts}
    </div>
  );
}
