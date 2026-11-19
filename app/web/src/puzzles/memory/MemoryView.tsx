// The view of `memory`: face-down comic shields in a grid. The backs say the language at a glance:
// French shields are blue with halftone dots and a white speech balloon « FR » (they speak), English
// shields orange with stripes and a yellow sign « EN ». A French shield flips to its expression in its
// unit colour and loops it from the scene; an English shield flips to a meaning. While one shield is
// up, the others of its language are locked (dimmed; a tap only wobbles) and the prompt asks for the
// other language. Two that belong together slam green with a BING and join the trophy row below
// (French = English, tap to hear it again). Two that do not stay up until the next tap, which turns
// them back. After two mistakes on a pair, its partner peeks out whenever one of its shields is turned.
import { useEffect, useRef, type CSSProperties } from 'react';
import { MEMORY_REVEAL_AFTER, lockedSide, partnerOf, type MemoryAction, type MemoryState, type MemoryPuzzle } from '../../../../shared/puzzles/memory';
import { t } from '../../../../shared/i18n';
import { audio, useIsPlaying, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { findUnit, loopWindowFor, tags } from '../../scene/timing';
import { Icon, Stamp, cx, unitColorVars } from '../../ui';
import type { PuzzleViewProps } from '../registry';
import s from './Memory.module.css';

/**
 * Columns of the grid: a phone 2 or 3; a tablet held upright (the pane is wide) as many as make two or
 * three even rows; a tablet in landscape (the pane is narrower) 3, so the shields stay big.
 */
function columns(n: number, layout: 'phone' | 'upright' | 'landscape'): number {
  if (layout === 'upright') return n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : n <= 10 ? 5 : 4;
  if (layout === 'landscape') return n <= 4 ? 2 : 3;
  return n <= 10 ? 2 : 3;
}

export function MemoryView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<MemoryPuzzle, MemoryState, MemoryAction>) {
  const tablet = practiceCtx.layout === 'tablet';
  const done = state.matched.length >= puzzle.pairs.length;
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useStopAudioOnUnmount();

  const playPair = (pair: number) => {
    const p = puzzle.pairs[pair]!;
    const r = findUnit(scene, p.unitId);
    if (!r) return;
    const w = loopWindowFor(r.line, r.unit);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag: tags.unit(p.unitId) });
  };

  // Nothing loops until a French shield is turned (it speaks then). Stop anything left from the last puzzle.
  useEffect(() => {
    audio.stop();
  }, [puzzle.id]);

  const locked = lockedSide(puzzle, state);

  const flip = (i: number) => {
    const c = puzzle.cards[i]!;
    const el = cardRefs.current[i];
    if (locked === c.side && !state.open.includes(i) && !state.matched.includes(c.pair)) {
      // The same language as the shield that is up: it cannot make a pair. A wobble, nothing else.
      if (el) fx.wobble(el);
      return;
    }
    if (state.matched.includes(c.pair)) {
      playPair(c.pair);
      if (el) fx.pop(el);
      return;
    }
    if (state.open.length === 1 && state.open[0] === i) {
      if (c.side === 'fr') playPair(c.pair);
      return;
    }
    const first = state.open.length === 1 ? state.open[0]! : null;
    fx.sfx('tap');
    if (c.side === 'fr') playPair(c.pair);
    if (first !== null) {
      const a = puzzle.cards[first]!;
      if (a.pair === c.pair) {
        // A pair: the French loops (whichever side was turned second), BING.
        playPair(c.pair);
        window.setTimeout(() => {
          if (el) {
            fx.impact(t('practice.fx.bing'), el, { size: 'sm' });
            fx.burst(el, 'star');
          }
          const fe = cardRefs.current[first];
          if (fe) fx.pop(fe);
          fx.sfx('right');
          fx.haptic(15);
          if (state.matched.length + 1 >= puzzle.pairs.length) window.setTimeout(() => fx.impact(undefined, undefined, { size: 'lg' }), 250);
        }, 260);
      } else {
        const knew = state.seen.includes(partnerOf(puzzle, first));
        window.setTimeout(() => {
          const fe = cardRefs.current[first];
          if (knew && el) fx.wrong(el);
          else {
            if (el) fx.wobble(el);
            if (fe) fx.wobble(fe);
          }
        }, 300);
      }
    }
    dispatch({ kind: 'flip', card: i });
  };

  const peek = state.open.length === 1 && (state.wrongAt[puzzle.cards[state.open[0]!]!.pair] ?? 0) >= MEMORY_REVEAL_AFTER ? partnerOf(puzzle, state.open[0]!) : -1;
  const cols = columns(puzzle.cards.length, tablet ? 'upright' : 'phone');
  const colsLandscape = columns(puzzle.cards.length, 'landscape');

  const step = done ? 'done' : state.open.length === 2 ? 'mismatch' : state.open.length === 1 ? 'second' : 'first';

  return (
    <div className={cx(s.puzzle, tablet && s.tablet)} data-memory data-step={step}>
      <div className={s.top}>
        <Stamp variant="issue" color="yellow" tilt={-5}>
          {t('puzzles.memory.pairs', { n: state.matched.length, total: puzzle.pairs.length })}
        </Stamp>
        <p className={cx(s.prompt, locked && s.promptNow)} key={locked ?? 'any'}>
          {locked === 'fr' ? t('puzzles.memory.nowEn') : locked === 'en' ? t('puzzles.memory.nowFr') : t('puzzles.memory.prompt')}
        </p>
      </div>

      <div className={s.grid} style={{ '--cols': cols, '--cols-landscape': colsLandscape } as CSSProperties}>
        {puzzle.cards.map((c, i) => {
          const pair = puzzle.pairs[c.pair]!;
          const matched = state.matched.includes(c.pair);
          const up = matched || state.open.includes(i);
          const r = findUnit(scene, pair.unitId);
          const colour = r ? r.line.units.indexOf(r.unit) : c.pair;
          const isLocked = locked === c.side && !up;
          return (
            <button
              key={i}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              type="button"
              className={cx(s.card, c.side === 'fr' ? s.sideFr : s.sideEn, up && s.up, matched && s.matched, peek === i && s.peek, isLocked && s.locked)}
              style={{ '--i': i, ...(c.side === 'fr' ? unitColorVars(colour) : null) } as CSSProperties}
              onClick={() => flip(i)}
              aria-disabled={isLocked || undefined}
              aria-label={up ? (c.side === 'fr' ? (puzzle.hideFrench && !matched ? t('puzzles.memory.listenCard') : pair.fr) : pair.en) : t(c.side === 'fr' ? 'puzzles.memory.hiddenFr' : 'puzzles.memory.hiddenEn')}
              data-card={i}
              data-side={c.side}
              data-pair={import.meta.env.DEV ? c.pair : undefined}
            >
              <span className={s.flipper}>
                <span className={s.back} aria-hidden>
                  {c.side === 'fr' ? (
                    <span className={s.emblemFr}>
                      <span className={s.code}>{t('puzzles.memory.backFr')}</span>
                      <Icon name="speaker" size={14} className={s.emblemSpk} />
                    </span>
                  ) : (
                    <span className={s.emblemEn}>
                      <span className={s.code}>{t('puzzles.memory.backEn')}</span>
                    </span>
                  )}
                </span>
                <span className={cx(s.face, c.side === 'fr' ? s.fr : s.en)}>
                  {c.side === 'fr' ? <FrFace unitId={pair.unitId} text={pair.fr} hidden={puzzle.hideFrench && !matched} /> : <span className={s.enText} lang="en">{pair.en}</span>}
                </span>
              </span>
              {/* On the shield's corner, off its text (a phone's shields are small). */}
              {matched && (
                <span className={s.tick} aria-hidden>
                  <Icon name="check" size={16} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {state.matched.length > 0 && (
        <ol className={cx(s.trophies, done && s.allDone)}>
          {state.matched.map((pi) => {
            const p = puzzle.pairs[pi]!;
            const r = findUnit(scene, p.unitId);
            return (
              <li key={pi} className={s.trophy}>
                <button type="button" className={s.trophyFr} style={unitColorVars(r ? r.line.units.indexOf(r.unit) : pi)} onClick={() => playPair(pi)}>
                  <span>{p.fr}</span>
                </button>
                <span className={s.eq}>=</span>
                <span className={s.trophyEn}>{p.en}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** A French shield: its text and a speaker, or only a big speaker while the French is to be heard, not read. */
function FrFace({ unitId, text, hidden }: { unitId: string; text: string; hidden: boolean }) {
  const playing = useIsPlaying(tags.unit(unitId));
  if (hidden)
    return (
      <span className={cx(s.earOnly, playing && s.spkOn)} aria-hidden>
        <Icon name="speaker" size={34} />
      </span>
    );
  return (
    <>
      <span className={s.frText} lang="fr">{text}</span>
      <span className={cx(s.spk, playing && s.spkOn)} aria-hidden>
        <Icon name="speaker" size={16} />
      </span>
    </>
  );
}
