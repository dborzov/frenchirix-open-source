// The playback bar of a whole scene (or song): the length of the audio, divided into its lines
// (each segment in its line's colour, a thick ink mark where the speaker changes), a playhead that
// moves, and tap or drag anywhere to seek. The current line is highlighted and named; a line that
// loops (tapped in the dialogue) is marked as looping, so the bar and the dialogue agree.
// Used by ScenePlayer (scene page, preview, watch), place-words and karaoke.
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { Line } from '../../../shared/content';
import { t } from '../../../shared/i18n';
import { useAudioClock, useAudioState } from '../audio';
import { Icon, cx } from '../ui';
import { lineColorVars } from './lineColors';
import s from './SceneBar.module.css';
import { lineAt, lineWindow, tags } from './timing';

export interface SceneBarProps {
  lines: Line[];
  durationMs: number;
  /** The clip this bar belongs to: the playhead follows the engine while it plays this clip. */
  src: string;
  /** Seek: play from this position (ms in the clip). */
  onSeek: (ms: number) => void;
  compact?: boolean;
  className?: string;
  /**
   * The line looping after a tap in the dialogue, marked on the bar. Default: read from the engine
   * (a looping play tagged `line:<id>` of this clip); place-words passes its selected line, which
   * stays selected while a tapped box speaks.
   */
  loopLineId?: string | null;
  /**
   * While the engine's play has a tag this returns true for, the bar keeps what it showed before (a
   * tray piece of place-words speaking: where it is heard is the answer).
   */
  holdWhile?: (tag: string | null) => boolean;
}

/** The position in ms for a pointer at clientX over a bar spanning [left, left + width]. */
export function msAtX(clientX: number, left: number, width: number, durationMs: number): number {
  if (width <= 0 || durationMs <= 0) return 0;
  const k = Math.max(0, Math.min(1, (clientX - left) / width));
  return Math.round(k * durationMs);
}

/** Segments of the bar: one per line, as fractions of the duration, with speaker changes marked. */
export function segmentsOf(lines: Line[], durationMs: number): { line: Line; from: number; to: number; speakerChange: boolean }[] {
  let prev: string | null | undefined;
  return lines.map((line, i) => {
    const w = lineWindow(line);
    const seg = {
      line,
      from: Math.max(0, w.startMs / durationMs),
      to: Math.min(1, w.endMs / durationMs),
      speakerChange: i > 0 && !!line.speaker && !!prev && line.speaker !== prev,
    };
    prev = line.speaker ?? prev;
    return seg;
  });
}

const clock = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

export function SceneBar({ lines, durationMs, src, onSeek, compact, className, loopLineId, holdWhile }: SceneBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // ms under the finger while dragging
  const downAt = useRef<number | null>(null);
  // The playhead, in tenths of a percent (re-renders ~1000 times over a scene at most); held where it
  // was while a play matching holdWhile runs.
  const hold = useRef(holdWhile);
  hold.current = holdWhile;
  const shown = useRef(-1);
  const pos = useAudioClock((ms, st) => {
    if (hold.current?.(st.tag)) return shown.current;
    shown.current = st.src === src && (st.playing || st.positionMs > 0) ? Math.round(((st.playing ? ms : st.positionMs) / durationMs) * 1000) : -1;
    return shown.current;
  });
  const ms = drag ?? (pos >= 0 ? (pos / 1000) * durationMs : 0);
  const current = pos >= 0 || drag !== null ? lineAt(lines, ms) : undefined;
  const segs = segmentsOf(lines, durationMs);
  const st = useAudioState();
  const engineLoop = st.playing && st.loop && st.src === src && st.tag?.startsWith('line:') ? (lines.find((l) => tags.line(l.id) === st.tag)?.id ?? null) : null;
  const looping = loopLineId === undefined ? engineLoop : loopLineId;

  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return msAtX(e.clientX, r.left, r.width, durationMs);
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const m = at(e);
    downAt.current = m;
    setDrag(m);
    onSeek(m); // a tap seeks at once
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    setDrag(at(e));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const m = at(e);
    setDrag(null);
    if (m !== downAt.current) onSeek(m); // a drag seeks where it was let go
    downAt.current = null;
  };

  return (
    <div className={cx(s.wrap, compact && s.compact, className)} data-scene-bar>
      <div
        ref={ref}
        className={s.bar}
        role="slider"
        tabIndex={0}
        aria-label={t('scene.bar.label')}
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(ms / 1000)}
        aria-valuetext={clock(ms)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeek(Math.min(durationMs, ms + 2000));
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, ms - 2000));
        }}
      >
        {segs.map((sg, i) => (
          <span
            key={sg.line.id}
            className={cx(s.seg, current?.id === sg.line.id && s.segOn, looping === sg.line.id && s.segLoop, sg.speakerChange && s.speaker)}
            style={{ ...lineColorVars(i), left: `${sg.from * 100}%`, width: `${Math.max(0.4, (sg.to - sg.from) * 100)}%` } as CSSProperties}
            data-bar-line={sg.line.id}
            data-bar-loop={looping === sg.line.id ? '' : undefined}
          />
        ))}
        <span className={s.head} style={{ left: `${(ms / durationMs) * 100}%` }} data-playhead={Math.round(ms)} />
      </div>
      <div className={s.info}>
        <span className={s.time}>
          {clock(ms)} / {clock(durationMs)}
        </span>
        {current && (
          <span className={s.now} data-bar-current={current.id} data-bar-looping={looping === current.id ? '' : undefined}>
            {looping === current.id && <Icon name="loop" size={15} className={s.loopIcon} />}
            {current.speaker ? `${current.speaker} · ` : ''}
            {t('scene.bar.line', { n: lines.indexOf(current) + 1, total: lines.length })}
          </span>
        )}
      </div>
    </div>
  );
}
