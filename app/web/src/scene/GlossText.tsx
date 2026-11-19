// Our own French (questions, answers, anything not from a scene) drawn like the dialogue strip:
// each GlossUnit is a coloured ink box, the text between units is plain; tapping a box opens a
// speech balloon with its English in that sense. Only one balloon is open at a time on the whole
// screen. No audio: these sentences have no window in a scene's audio.
//
// The boxes are <span role="button">, not <button>, so a GlossText can sit inside a tappable answer
// card; a tap on a box does not reach the card (stopPropagation).
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { GlossUnit } from '../../../shared/content';
import { fx } from '../fx';
import { cx, unitColorVars } from '../ui';
import s from './DialogueStrip.module.css';
import { hint, useHintAnchor } from './hint';
import g from './GlossText.module.css';

export interface GlossTextProps {
  fr: string;
  units: GlossUnit[];
  /** Called on every tap of a box (index in units). */
  onUnitTap?: (index: number, unit: GlossUnit) => void;
  /** Called when a balloon opens (count it as a hint if your puzzle type wants). */
  onGloss?: (index: number, unit: GlossUnit) => void;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  /** 'colour' (default): boxes cycle the unit colours. 'paper': white boxes (on a coloured card). 'ink': black boxes, white lettering. */
  tone?: 'colour' | 'paper' | 'ink';
  /** Per-unit marks by index in `units` (speaking rounds over our own French): 'matched' | 'missed' | 'current'. */
  marks?: Readonly<Record<number, 'matched' | 'missed' | 'current'>>;
  /** Show the balloon on tap (default true). */
  balloons?: boolean;
  className?: string;
}

/** Close any open hint bubble (puzzle types call it when the round changes). */
export function closeGlosses(): void {
  hint.hide();
}

/** Units that tile `fr`; when none are given, one unit for the whole sentence with `en`. */
export function wholeSentenceUnits(fr: string, en: string): GlossUnit[] {
  return [{ fr, en, cs: 0, ce: fr.length }];
}

export function GlossText({ fr, units, onUnitTap, onGloss, size = 'md', disabled, tone = 'colour', balloons = true, marks, className }: GlossTextProps) {
  const open = useHintAnchor();

  const tap = (i: number, u: GlossUnit, e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled) return;
    const el = e.currentTarget;
    fx.pop(el);
    // The shared hint bubble: only the English, its tail on this box (the user's rules).
    if (balloons && hint.toggle(el, { en: u.en })) onGloss?.(i, u);
    onUnitTap?.(i, u);
  };

  const parts: ReactNode[] = [];
  let pos = 0;
  const sorted = [...units].sort((a, b) => a.cs - b.cs);
  const text = (t: string, key: string) => {
    const tt = t.replace(/\s+/g, ' ').trim();
    if (tt) parts.push(<span key={key} className={s.punct}>{tt}</span>);
  };
  sorted.forEach((u, i) => {
    text(fr.slice(pos, u.cs), `p${i}`);
    pos = Math.max(pos, u.ce);
    const mark = marks?.[units.indexOf(u)];
    parts.push(
      <span
        key={`u${i}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        className={cx(s.unit, g.unit, tone === 'paper' && g.paper, tone === 'ink' && g.ink)}
        style={unitColorVars(i)}
        data-gloss-unit={i}
        onClick={(e) => tap(i, u, e)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') tap(i, u, e);
        }}
        ref={(el) => {
          if (el) el.classList.toggle(s.selected!, open === el);
        }}
      >
        <span className={cx(s.text, mark === 'matched' && s.wMatched, mark === 'missed' && s.wMissed, mark === 'current' && s.wCurrent)} data-word-mark={mark}>
          {fr.slice(u.cs, u.ce) || u.fr}
        </span>
      </span>,
    );
  });
  text(fr.slice(pos), 'end');

  return (
    <div className={cx(g.gloss, g[size], className)} data-gloss>
      <div className={s.units}>{parts}</div>
    </div>
  );
}
