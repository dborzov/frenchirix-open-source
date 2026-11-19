// The dialogue strip: each line of a scene as a row of coloured boxes, one per unit (--unit-1..6).
// Tapping a box pops it, shows its English in that sense (and its note) in a bubble under the line,
// and loops its audio until another tap; tapping it again stops. A play button per line loops the
// whole line. Units named by a scene note carry an asterisk that opens the note. While the scene
// audio plays, the word being spoken lights up (lines with approxTimes light up as a whole).
// With `linePanels` (a whole scene, beside its playback bar) each line is a panel in its line's colour
// (its segment in the bar), and a tap on the panel outside a box loops the line (LinePanel.module.css).
// See docs/app-games.md ("The help strip and `DialogueStrip`") for the props puzzle types use.
import { memo, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { Line, Note, Scene, Unit } from '../../../shared/content';
import { t } from '../../../shared/i18n';
import { audio, useAudioClock, useAudioState } from '../audio';
import { installEventCounters } from '../audio/events';
import { fx } from '../fx';
import { Icon, cx, unitColorVars } from '../ui';
import s from './DialogueStrip.module.css';
import { hint, useHintAnchor } from './hint';
import { lineColorVars, unitOnLineColorVars } from './lineColors';
import lp from './LinePanel.module.css';
import { lineWindow, loopWindowFor, tags, wordKeyAt } from './timing';

installEventCounters();

export type HintKind = 'unit' | 'line' | 'note';
export type WordMark = 'matched' | 'missed' | 'current';

/**
 * Every word of a line in order, as the keys wordMarks uses ('<unit id>#<word index>'). The speech
 * API's `matched[]` lists the expected words in order, so marks = zip(lineWordKeys(line), matched).
 */
export function lineWordKeys(line: Line): string[] {
  return line.units.flatMap((u) => u.words.map((_, i) => `${u.id}#${i}`));
}

export interface DialogueStripProps {
  scene: Scene;
  lineIds: string[]; // the lines to show, in this order
  /** A unit drawn as selected (puzzle types that pick a unit). */
  activeUnitId?: string | null;
  /** A line drawn as current (the scene player highlights the line being spoken). */
  activeLineId?: string | null;
  /** Called on every tap of a box (after the strip's own behaviour). */
  onUnitTap?: (unitId: string) => void;
  /** Show each line's literal English under it. */
  showEnglish?: boolean;
  /** Units drawn masked: as a blank or as first letters plus dots (maskStyle). */
  masked?: readonly string[] | ReadonlySet<string>;
  maskStyle?: 'blank' | 'initial';
  /** Text shown inside a masked box instead of the mask (e.g. the word the kid placed there). */
  maskFill?: Readonly<Record<string, string>>;
  /** No taps at all. */
  disabled?: boolean;
  /** Smaller type and boxes (side panes, help sheets). */
  compact?: boolean;
  /** Each tap that reveals something: a box, a line play, a note. The practice shell counts these as hints. */
  onHint?: (kind: HintKind, id: string) => void;
  /** Tapping a box loops its audio (default true). */
  loopOnTap?: boolean;
  /** Show the per-line play button (default true). */
  linePlay?: boolean;
  /**
   * When given (the scene player), the line's play control jumps the whole scene's playback to that
   * line and keeps playing, instead of looping the line.
   */
  onLineSeek?: (line: Line) => void;
  /** Show the hint bubble with the English on tap (default true). */
  bubbles?: boolean;
  /** Light up the word being spoken while this scene's audio plays (default true). */
  followAudio?: boolean;
  /** Extra class per unit box (puzzle types colour right/wrong boxes with it). */
  unitClassName?: (unit: Unit, line: Line) => string | undefined;
  /**
   * Per-word marks (speaking rounds): key `<unit id>#<word index>` (see lineWordKeys), value
   * 'matched' | 'missed' | 'current'. Marked words are drawn inside their boxes.
   */
  wordMarks?: Readonly<Record<string, WordMark>>;
  /**
   * A whole scene beside its playback bar (the scene player): each line is a panel in its line's
   * colour, the n-th line of the strip taking the bar's n-th colour, and a tap on the panel outside a
   * box loops the line (again: `onLineSeek` when given, so the scene plays on from there; else stop).
   */
  linePanels?: boolean;
  /** Registers each line's element (the scene player scrolls the current line into view). */
  lineRef?: (lineId: string, el: HTMLElement | null) => void;
  className?: string;
}


function toSet(v: readonly string[] | ReadonlySet<string> | undefined): ReadonlySet<string> {
  if (!v) return EMPTY;
  return v instanceof Set ? v : new Set(v as readonly string[]);
}
const EMPTY: ReadonlySet<string> = new Set();

/** The last of a note's units in reading order (`<line id>:<index>`: the line, then the index). */
export function lastUnitOf(unitIds: readonly string[]): string | undefined {
  const key = (id: string) => {
    const i = id.lastIndexOf(':');
    return [id.slice(0, i), Number(id.slice(i + 1))] as const;
  };
  let best: string | undefined;
  for (const id of unitIds) {
    if (!best) best = id;
    else {
      const [l, n] = key(id);
      const [bl, bn] = key(best);
      if (l > bl || (l === bl && n > bn)) best = id;
    }
  }
  return best;
}

/** First letter of each word plus a dot per remaining letter: "n'aimes pas" -> "n·aimes"… */
export function initialMask(text: string): string {
  return text.replace(/\p{L}+/gu, (w, offset: number, all: string) => {
    // Keep the first letter of a word; a letter right after an apostrophe continues the word.
    const prev = offset > 0 ? all[offset - 1] : ' ';
    const keepFirst = !(prev === "'" || prev === '’');
    return keepFirst ? w[0] + '·'.repeat(w.length - 1) : '·'.repeat(w.length);
  });
}

export function DialogueStrip(props: DialogueStripProps) {
  const { scene, lineIds, compact, className } = props;
  // The one shared hint bubble (hint.ts): which box it is open for, to draw it as selected.
  const open = useHintAnchor();
  const openUnit = open instanceof HTMLElement ? (open.dataset.unit ?? null) : null;
  const lines = useMemo(() => lineIds.map((id) => scene.lines.find((l) => l.id === id)).filter((l): l is Line => !!l), [scene, lineIds]);
  // One asterisk per note, on the last unit of its phrase (a phrase over three boxes once drew three
  // asterisks that opened the same text).
  const notesByUnit = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of scene.notes) {
      const u = lastUnitOf(n.unitIds ?? []);
      if (u) m.set(u, [...(m.get(u) ?? []), n]);
    }
    return m;
  }, [scene]);
  const notesByLine = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of scene.notes) if (n.lineId && !(n.unitIds && n.unitIds.length)) m.set(n.lineId, [...(m.get(n.lineId) ?? []), n]);
    return m;
  }, [scene]);
  const masked = useMemo(() => toSet(props.masked), [props.masked]);

  return (
    <div className={cx(s.strip, compact && s.compact, props.disabled && s.disabled, className)} data-strip>
      {lines.map((line, index) => (
        <LineRow
          key={line.id}
          line={line}
          index={index}
          props={props}
          masked={masked}
          notesByUnit={notesByUnit}
          lineNotes={notesByLine.get(line.id)}
          openUnit={openUnit}
        />
      ))}
    </div>
  );
}

interface RowProps {
  line: Line;
  index: number;
  props: DialogueStripProps;
  masked: ReadonlySet<string>;
  notesByUnit: Map<string, Note[]>;
  lineNotes: Note[] | undefined;
  openUnit: string | null;
}

const LineRow = memo(function LineRow({ line, index, props, masked, notesByUnit, lineNotes, openUnit }: RowProps) {
  const { scene, disabled, maskStyle = 'initial', maskFill, showEnglish, onHint, onUnitTap, unitClassName, activeUnitId, wordMarks } = props;
  const loopOnTap = props.loopOnTap ?? true;
  const bubbles = props.bubbles ?? true;
  const follow = props.followAudio ?? true;
  const src = scene.audio.src;
  const rowRef = useRef<HTMLDivElement>(null);
  const st = useAudioState();
  const playingTag = st.playing && st.src === src ? st.tag : null;
  const lineTag = tags.line(line.id);
  const panels = !!props.linePanels;
  const looping = panels && playingTag === lineTag && st.loop;

  // What to light up: a word key, 'L' (the whole line: approxTimes or a line loop), or ''.
  const lit = useAudioClock((ms, as) => {
    if (!follow || !as.playing || as.src !== src || as.loading) return '';
    if (as.tag && as.tag.startsWith('unit:')) return '';
    const w = lineWindow(line);
    if (ms < w.startMs - 50 || ms > w.endMs + 50) return '';
    if (line.approxTimes) return 'L';
    return wordKeyAt([line], ms) ?? 'L';
  });

  const ref = props.lineRef;
  const setRow = useCallback(
    (el: HTMLDivElement | null) => {
      (rowRef as { current: HTMLDivElement | null }).current = el;
      ref?.(line.id, el);
    },
    [ref, line.id],
  );

  const tapUnit = (unit: Unit, el: HTMLElement) => {
    if (disabled) return;
    const tag = tags.unit(unit.id);
    // "Again" (stop) only when the kid already opened this box here: a box that is looping because
    // the puzzle loops that unit (catapult, vrai-faux, match) must still open its meaning on a tap.
    const shown = hint.isOpenFor(el);
    const again = bubbles ? shown && (playingTag === tag || !loopOnTap) : playingTag === tag;
    fx.pop(el);
    if (again) {
      audio.stop();
      hint.hide();
    } else {
      if (loopOnTap) {
        const w = loopWindowFor(line, unit);
        audio.playRange(src, w.startMs, w.endMs, { loop: true, tag });
      }
      // Only the English (and its note): never the French (the user's rule).
      if (bubbles) hint.show(el, { en: unit.en, note: unit.note });
      onHint?.('unit', unit.id);
    }
    onUnitTap?.(unit.id);
  };

  const tapNote = (notes: Note[], el: HTMLElement) => {
    if (disabled) return;
    fx.pop(el);
    const kinds = [...new Set(notes.map((n) => n.kind))];
    const opened = hint.toggle(el, {
      tone: 'caption',
      label: kinds.map((k) => t(k === 'wordplay' ? 'scene.strip.wordplay' : 'scene.strip.reference')).join(' · '),
      en: '',
      note: notes.map((n) => n.text).join('\n\n'),
    });
    if (opened) onHint?.('note', line.id);
  };

  const tapLine = () => {
    if (disabled) return;
    // In a scene player, the line's control jumps the scene's playback there and keeps playing.
    if (props.onLineSeek) {
      props.onLineSeek(line);
      onHint?.('line', line.id);
      return;
    }
    if (playingTag === lineTag) {
      audio.stop();
      return;
    }
    const w = lineWindow(line);
    audio.playRange(src, w.startMs, w.endMs, { loop: true, tag: lineTag });
    onHint?.('line', line.id);
  };

  // A tap on a line's panel outside its boxes: loop the line; again, back to the scene (or stop).
  const tapPanel = () => {
    if (disabled) return;
    if (playingTag === lineTag) {
      if (props.onLineSeek) props.onLineSeek(line);
      else audio.stop();
      return;
    }
    fx.sfx('tap');
    const w = lineWindow(line);
    audio.playRange(src, w.startMs, w.endMs, { loop: true, tag: lineTag });
    onHint?.('line', line.id);
  };

  // Build the row: punctuation between boxes as plain text; a newline in the French starts a new row.
  const parts: ReactNode[] = [];
  const pushText = (text: string, key: string) => {
    if (!text) return;
    const pieces = text.split('\n');
    pieces.forEach((p, i) => {
      if (i > 0) parts.push(<span key={`${key}-br${i}`} className={s.br} />);
      const trimmed = p.replace(/\s+/g, ' ');
      if (trimmed.trim()) parts.push(<span key={`${key}-t${i}`} className={s.punct}>{trimmed.trim()}</span>);
    });
  };
  let pos = 0;
  line.units.forEach((u, i) => {
    pushText(line.fr.slice(pos, u.cs), `p${i}`);
    pos = u.ce;
    const isMasked = masked.has(u.id);
    const notes = notesByUnit.get(u.id);
    const tag = tags.unit(u.id);
    const playing = playingTag === tag;
    const selected = activeUnitId === u.id || openUnit === u.id;
    let content: ReactNode;
    if (isMasked) {
      const fill = maskFill?.[u.id];
      content = fill ? <span className={s.fill}>{fill}</span> : maskStyle === 'blank' ? <span className={s.blank} style={{ width: `${Math.min(14, Math.max(3, u.fr.length * 0.62))}ch` }} /> : <span className={s.mask}>{initialMask(u.fr)}</span>;
    } else {
      content = renderWords(u, lit, wordMarks);
    }
    parts.push(
      <span key={u.id} className={s.unitWrap}>
        <button
          type="button"
          className={cx(s.unit, isMasked && s.masked, playing && s.playing, selected && s.selected, lit === 'L' && s.litBox, unitClassName?.(u, line))}
          style={panels ? unitOnLineColorVars(i, index) : unitColorVars(i)}
          data-unit={u.id}
          aria-pressed={playing}
          aria-label={isMasked ? t('scene.strip.hidden') : undefined}
          disabled={disabled}
          onClick={(e) => tapUnit(u, e.currentTarget)}
        >
          <span className={s.text}>{content}</span>
        </button>
        {/* A hidden unit (a blank to fill) shows no asterisk until its word is in place: its note would name it. */}
        {notes && (!isMasked || !!maskFill?.[u.id]) && (
          <button type="button" className={s.star} aria-label={t('scene.strip.note')} data-note-unit={u.id} disabled={disabled} onClick={(e) => tapNote(notes, e.currentTarget)}>
            *
          </button>
        )}
      </span>,
    );
  });
  pushText(line.fr.slice(pos), 'end');
  if (lineNotes) {
    parts.push(
      <button key="lnote" type="button" className={cx(s.star, s.starInline)} aria-label={t('scene.strip.note')} disabled={disabled} onClick={(e) => tapNote(lineNotes, e.currentTarget)}>
        *
      </button>,
    );
  }

  const active = props.activeLineId === line.id || lit !== '';
  return (
    <div
      ref={setRow}
      className={cx(s.line, panels ? cx(lp.panel, s.panelLine, active && lp.lit, looping && lp.looping) : active && s.active)}
      style={panels ? lineColorVars(index) : undefined}
      data-line={line.id}
      data-looping={looping ? '' : undefined}
    >
      {panels && <button type="button" className={lp.hit} aria-label={t('scene.strip.playLine')} aria-pressed={looping} data-line-loop={line.id} disabled={disabled} onClick={tapPanel} />}
      {looping && (
        <span className={lp.tag} aria-hidden="true">
          <Icon name="loop" size={16} />
        </span>
      )}
      {line.speaker && <span className={cx(s.speaker, panels && lp.content, panels && lp.speaker)}>{line.speaker}</span>}
      <div className={cx(s.row, panels && lp.content)}>
        {(props.linePlay ?? true) && (
          <button type="button" className={cx(s.play, playingTag === lineTag && s.playOn)} aria-label={props.onLineSeek ? t('scene.strip.jumpLine') : t('scene.strip.playLine')} data-play-line={line.id} data-line-seek={props.onLineSeek ? '' : undefined} disabled={disabled} onClick={tapLine}>
            <Icon name={props.onLineSeek ? 'play' : playingTag === lineTag ? 'stop' : 'loop'} size={props.compact ? 18 : 22} />
          </button>
        )}
        <div className={s.units}>{parts}</div>
      </div>
      {showEnglish && <p className={cx(s.en, panels && lp.content)}>{line.en.replace(/\n/g, ' ')}</p>}
    </div>
  );
});

const MARK_CLASS: Record<WordMark, string | undefined> = { matched: s.wMatched, missed: s.wMissed, current: s.wCurrent };

function renderWords(u: Unit, lit: string, marks?: Readonly<Record<string, WordMark>>): ReactNode {
  const hasMarks = !!marks && u.words.some((_, i) => marks[`${u.id}#${i}`]);
  if (!hasMarks && (!lit || lit === 'L' || !lit.startsWith(u.id + '#'))) return u.fr;
  const wi = lit.startsWith(u.id + '#') ? Number(lit.slice(u.id.length + 1)) : -1;
  const out: ReactNode[] = [];
  let pos = u.cs;
  u.words.forEach((w, i) => {
    if (w.cs > pos) out.push(u.fr.slice(pos - u.cs, w.cs - u.cs));
    out.push(
      <span key={i} className={cx(s.word, i === wi && s.wordOn, marks && MARK_CLASS[marks[`${u.id}#${i}`] as WordMark])} data-word-mark={marks?.[`${u.id}#${i}`]}>
        {u.fr.slice(w.cs - u.cs, w.ce - u.cs)}
      </span>,
    );
    pos = w.ce;
  });
  if (pos < u.ce) out.push(u.fr.slice(pos - u.cs));
  return out;
}
