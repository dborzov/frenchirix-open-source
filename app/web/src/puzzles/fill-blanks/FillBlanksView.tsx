// The view of `fill-blanks`: the line loops; its French is drawn as the dialogue strip with the key
// words as blanks, its English below; a bank of words underneath. Tap a word and it flies into the
// next blank (or into the blank tapped first); a wrong word wobbles back. After two wrong words on a
// blank the right word in the bank glows. Tapping a visible box (or a blank) loops that piece, as
// everywhere. The last word lands with an impact.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FILL_REVEAL_AFTER, fits, nextBlank, type FillBlanksAction, type FillBlanksState, type FillBlanksPuzzle } from '../../../../shared/puzzles/fill-blanks';
import { displayEn } from '../../../../shared/puzzles/listen-pick';
import { t } from '../../../../shared/i18n';
import { audio, useIsPlaying, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { DialogueStrip } from '../../scene/DialogueStrip';
import { findLine, lineWindow, tags } from '../../scene/timing';
import { Icon, cx } from '../../ui';
import type { PuzzleViewProps } from '../registry';
import s from './FillBlanks.module.css';

export function FillBlanksView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<FillBlanksPuzzle, FillBlanksState, FillBlanksAction>) {
  const line = findLine(scene, puzzle.lineId)!;
  const tag = tags.line(line.id);
  const looping = useIsPlaying(tag);
  const rootRef = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [flying, setFlying] = useState<number | null>(null);
  const tablet = practiceCtx.layout === 'tablet';
  const done = state.filled.every((x) => x !== null);
  useStopAudioOnUnmount();

  const loop = () => {
    const w = lineWindow(line);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag });
  };
  useEffect(() => {
    loop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  const target = chosen !== null && state.filled[chosen] === null ? chosen : nextBlank(state);
  const blankOfUnit = useMemo(() => new Map(puzzle.blanks.map((b, i) => [b.unitId, i])), [puzzle.blanks]);
  const masked = useMemo(() => puzzle.blanks.filter((_, i) => state.filled[i] === null).map((b) => b.unitId), [puzzle.blanks, state.filled]);
  const maskFill = useMemo(() => {
    const m: Record<string, string> = {};
    puzzle.blanks.forEach((b, i) => {
      const w = state.filled[i];
      if (w !== null && w !== undefined) m[b.unitId] = puzzle.words[w]!.fr;
    });
    return m;
  }, [puzzle, state.filled]);
  // The strip masks only unfilled blanks; filled ones show their word in place (maskFill on a masked id).
  const maskedAll = useMemo(() => [...masked, ...Object.keys(maskFill)], [masked, maskFill]);
  const revealWord = target >= 0 && (state.wrong[target] ?? 0) >= FILL_REVEAL_AFTER ? puzzle.words.findIndex((_, w) => fits(puzzle, target, w) && !state.filled.includes(w)) : -1;

  const blankEl = (b: number) => rootRef.current?.querySelector<HTMLElement>(`[data-unit="${CSS.escape(puzzle.blanks[b]!.unitId)}"]`) ?? null;

  const fly = (from: HTMLElement, to: HTMLElement | null, text: string, back: boolean, after: () => void) => {
    if (!to || fx.reducedMotion() || typeof from.animate !== 'function') {
      after();
      return;
    }
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const ghost = from.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-word');
    Object.assign(ghost.style, { position: 'fixed', left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, margin: '0', zIndex: '400', pointerEvents: 'none' });
    ghost.textContent = text;
    ghost.className = cx(from.className, s.ghost);
    document.body.appendChild(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const frames: Keyframe[] = back
      ? [{ transform: 'none' }, { transform: `translate(${dx * 0.8}px, ${dy * 0.8}px) rotate(8deg)`, offset: 0.45 }, { transform: 'none' }]
      : [{ transform: 'none' }, { transform: `translate(${dx / 2}px, ${dy / 2 - 40}px) rotate(-10deg) scale(1.1)`, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px) scale(0.9)` }];
    const anim = ghost.animate(frames, { duration: back ? 420 : 340, easing: 'cubic-bezier(0.3, 0.8, 0.4, 1)' });
    anim.onfinish = anim.oncancel = () => {
      ghost.remove();
      after();
    };
  };

  const tapWord = (w: number, el: HTMLElement) => {
    if (done || flying !== null || state.filled.includes(w) || target < 0) return;
    // A word that fits another empty blank goes there, unless the kid chose a blank first.
    const explicit = chosen !== null && state.filled[chosen] === null;
    const other = state.filled.findIndex((x, k) => x === null && fits(puzzle, k, w));
    const b = !explicit && !fits(puzzle, target, w) && other >= 0 ? other : target;
    const right = fits(puzzle, b, w);
    const to = blankEl(b);
    if (right) {
      setFlying(w);
      fly(el, to, puzzle.words[w]!.fr, false, () => {
        setFlying(null);
        setChosen(null);
        dispatch({ kind: 'place', blank: b, word: w });
        requestAnimationFrame(() => {
          const landed = blankEl(b);
          if (landed) fx.right(landed);
          const left = state.filled.filter((x) => x === null).length - 1;
          if (left <= 0) {
            setTimeout(() => {
              fx.impact(undefined, landed ?? undefined, { size: 'md' });
              fx.sfx('win');
            }, 150);
            if (!looping) loop();
          }
        });
      });
    } else {
      fx.wrong(el);
      if (to) fx.wobble(to);
      fly(el, to, puzzle.words[w]!.fr, true, () => {});
      dispatch({ kind: 'place', blank: b, word: w });
    }
  };

  const onUnitTap = (unitId: string) => {
    const b = blankOfUnit.get(unitId);
    if (b !== undefined && state.filled[b] === null) setChosen(b);
  };

  return (
    <div ref={rootRef} className={cx(s.puzzle, tablet && s.tablet)} data-fill>
      <div className={s.top}>
        <button type="button" className={cx(s.speaker, looping && s.on)} onClick={() => (looping ? audio.stop() : loop())} aria-label={looping ? t('puzzles.fill-blanks.stop') : t('puzzles.fill-blanks.listen')} data-listen>
          <Icon name={looping ? 'speaker' : 'play'} size={tablet ? 44 : 32} />
        </button>
        <p className={s.prompt}>{t('puzzles.fill-blanks.prompt')}</p>
      </div>
      <div className={s.lineBox}>
        <DialogueStrip
          scene={scene}
          lineIds={[line.id]}
          masked={maskedAll}
          compact={!tablet}
          maskStyle="blank"
          maskFill={maskFill}
          activeUnitId={done || target < 0 ? null : puzzle.blanks[target]!.unitId}
          onUnitTap={onUnitTap}
          unitClassName={(u) => (blankOfUnit.has(u.id) ? cx(s.blankBox, maskFill[u.id] && s.filledBox, !maskFill[u.id] && blankOfUnit.get(u.id) === target && s.targetBox) : undefined)}
        />
        <p className={s.en}>
          <span className={s.enLabel}>{t('puzzles.fill-blanks.english')}</span>
          {displayEn(line.en)}
        </p>
      </div>
      <div className={s.bank} role="group">
        {puzzle.words.map((word, i) => {
          const used = state.filled.includes(i);
          return (
            <button
              key={i}
              type="button"
              className={cx(s.word, used && s.used, revealWord === i && s.glow, flying === i && s.lifting)}
              style={{ '--i': i } as CSSProperties}
              disabled={used || done}
              onClick={(e) => tapWord(i, e.currentTarget)}
              data-word={i}
              data-correct={import.meta.env.DEV ? String(puzzle.blanks.some((_, b) => fits(puzzle, b, i))) : undefined}
            >
              {word.fr}
            </button>
          );
        })}
      </div>
    </div>
  );
}
