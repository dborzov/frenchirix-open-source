// The view of `match`: French tiles on the left (each its own colour), English on the right. The
// selected French tile loops (its v1 drill once first, when it has one); tap an English tile to pair
// it. A right pair fuses: the English takes the French tile's colour, both slam and lock. A wrong
// pair wobbles. After two wrong pairs on one French tile, it and its English pulse together.
// The first French tile is selected and looping from the start; after each match the next one is.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLater } from '../useLater';
import { MATCH_REVEAL_AFTER, type MatchAction, type MatchState, type MatchPuzzle } from '../../../../shared/puzzles/match';
import { t } from '../../../../shared/i18n';
import { audio, useAudioState, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { Slideshow } from '../../scene/Slideshow';
import { findUnit, loopWindowFor, tags } from '../../scene/timing';
import { Caption, Icon, cx, unitColorVars } from '../../ui';
import type { PuzzleViewProps } from '../registry';
import s from './Match.module.css';

export function MatchView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<MatchPuzzle, MatchState, MatchAction>) {
  const [selFr, setSelFr] = useState<number | null>(0);
  const [selEn, setSelEn] = useState<number | null>(null);
  const [fused, setFused] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const st = useAudioState();
  const tablet = practiceCtx.layout === 'tablet';
  const done = state.matched.length >= puzzle.pairs.length;
  useStopAudioOnUnmount();
  const later = useLater(); // delayed plays die with the puzzle

  const loopPair = (i: number) => {
    const pair = puzzle.pairs[i];
    const found = pair && findUnit(scene, pair.unitId);
    if (!found) return;
    const w = loopWindowFor(found.line, found.unit);
    const tag = tags.unit(pair.unitId);
    const loop = () => audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag });
    // A v1 drill is a ready-made repetition: play it through once, then loop the scene window.
    if (pair.drill) audio.play(pair.drill, { tag, onEnd: loop });
    else loop();
  };

  useEffect(() => {
    loopPair(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  const el = (side: 'fr' | 'en', i: number) => rootRef.current?.querySelector<HTMLElement>(`[data-${side}="${i}"]`) ?? null;

  const tryPair = (fr: number, en: number) => {
    const right = fr === en;
    const a = el('fr', fr);
    const b = el('en', en);
    if (right) {
      if (b) fx.right(b);
      if (a) fx.pop(a);
      setFused(fr);
      setTimeout(() => setFused((f) => (f === fr ? null : f)), 600);
      const left = puzzle.pairs.map((_, k) => k).filter((k) => k !== fr && !state.matched.includes(k));
      if (!left.length) {
        later(() => {
          fx.impact(undefined, rootRef.current ?? undefined, { size: 'md' });
          fx.sfx('win');
        }, 200);
        setSelFr(null);
        loopPair(fr);
      } else {
        // On to the next French tile, so something French is always looping.
        const next = left.find((k) => k > fr) ?? left[0]!;
        setSelFr(next);
        later(() => loopPair(next), 450);
      }
    } else {
      if (b) fx.wrong(b);
      if (a) fx.wobble(a);
    }
    setSelEn(null);
    dispatch({ kind: 'pair', fr, en });
  };

  const tapFr = (i: number) => {
    if (done || state.matched.includes(i)) return;
    setSelFr(i);
    loopPair(i);
    const a = el('fr', i);
    if (a) fx.pop(a);
    if (selEn !== null) tryPair(i, selEn);
  };

  const tapEn = (j: number) => {
    if (done || state.matched.includes(j)) return;
    if (selFr !== null && !state.matched.includes(selFr)) tryPair(selFr, j);
    else {
      setSelEn(j);
      const b = el('en', j);
      if (b) fx.pop(b);
    }
  };

  const playingTag = st.playing ? st.tag : null;
  const sel = selFr !== null ? puzzle.pairs[selFr] : undefined;
  const selUnit = sel ? findUnit(scene, sel.unitId) : undefined;
  const frameMs = selUnit ? loopWindowFor(selUnit.line, selUnit.unit).startMs + 80 : undefined;

  return (
    <div ref={rootRef} className={cx(s.puzzle, tablet && s.tablet)} data-match>
      {!tablet && frameMs !== undefined && <Slideshow frames={scene.frames} timeMs={frameMs} className={s.frame} drift={false} />}
      <p className={s.prompt}>{t('puzzles.match.prompt')}</p>
      <div className={s.board}>
        <div className={s.col}>
          <Caption tilt={-2} className={s.head}>
            {t('puzzles.match.fr')}
          </Caption>
          {puzzle.pairs.map((p, i) => {
            const matched = state.matched.includes(i);
            const reveal = !matched && (state.wrong[i] ?? 0) >= MATCH_REVEAL_AFTER;
            const playing = playingTag === tags.unit(p.unitId);
            return (
              <button
                key={p.unitId}
                type="button"
                className={cx(s.tile, s.fr, selFr === i && !matched && s.selected, matched && s.matched, fused === i && s.fuse, reveal && s.reveal, playing && s.playing)}
                style={{ ...unitColorVars(i), '--i': i } as CSSProperties}
                onClick={() => tapFr(i)}
                disabled={matched}
                aria-pressed={selFr === i}
                data-fr={i}
                data-unit={p.unitId}
              >
                <span className={s.txt}>{p.fr}</span>
                {playing && !matched && <Icon name="speaker" size={20} className={s.spk} />}
                {matched && <Icon name="check" size={20} className={s.spk} />}
              </button>
            );
          })}
        </div>
        <div className={s.col}>
          <Caption tilt={2} color="white" className={s.head}>
            {t('puzzles.match.en')}
          </Caption>
          {puzzle.enOrder.map((j, row) => {
            const p = puzzle.pairs[j]!;
            const matched = state.matched.includes(j);
            const reveal = !matched && (state.wrong[j] ?? 0) >= MATCH_REVEAL_AFTER;
            return (
              <button
                key={p.unitId}
                type="button"
                className={cx(s.tile, s.en, selEn === j && s.selected, matched && s.matched, fused === j && s.fuse, reveal && s.reveal)}
                style={{ ...(matched || reveal ? unitColorVars(j) : null), '--i': row } as CSSProperties}
                onClick={() => tapEn(j)}
                disabled={matched}
                data-en={j}
                data-correct-fr={import.meta.env.DEV ? j : undefined}
              >
                <span className={s.txt}>{p.en}</span>
              </button>
            );
          })}
        </div>
      </div>
      {!done && <p className={s.tip}>{t('puzzles.match.tip')}</p>}
    </div>
  );
}
