// The view of `vrai-faux`: a card slams in with a French expression of the scene (it loops) and one
// English meaning in a balloon; the kid slams VRAI or FAUX. A right answer stamps the card and
// throws it onto the pile below, where every card shows its true meaning (a false one shows the
// wrong meaning struck out and the right one). Right answers in a row fill the magic-potion
// cauldron and flash a combo. A wrong answer wobbles; the other button then glows.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { VRAI_FAUX_REVEAL_AFTER, type VraiFauxAction, type VraiFauxCard, type VraiFauxState, type VraiFauxPuzzle } from '../../../../shared/puzzles/vrai-faux';
import { t } from '../../../../shared/i18n';
import { audio, useIsPlaying, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { findUnit, loopWindowFor, tags } from '../../scene/timing';
import { Balloon, Stamp, cx, unitColorVars } from '../../ui';
import { Cauldron, LoopButton } from '../arcade/kit';
import type { PuzzleViewProps } from '../registry';
import s from './VraiFaux.module.css';

function Thumb({ down }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 48 48" className={cx(s.thumb, down && s.down)} aria-hidden>
      <path d="M8 22 h8 v20 h-8 z" fill="#fff" stroke="#111" strokeWidth="3.5" strokeLinejoin="miter" />
      <path d="M16 22 l8 -14 q5 -2 5 4 l-2 9 h11 q5 1 4 6 l-3 12 q-1 4 -5 4 h-18 z" fill="#F2B48A" stroke="#111" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M30 29 h9 M29 35 h8" stroke="#111" strokeWidth="2.5" />
    </svg>
  );
}

function PileCard({ puzzle, card, scene }: { puzzle: VraiFauxPuzzle; card: VraiFauxCard; scene: PuzzleViewProps['scene'] }) {
  const ref = findUnit(scene, card.unitId)!;
  const tag = tags.unit(card.unitId);
  const looping = useIsPlaying(tag);
  const play = () => {
    const w = loopWindowFor(ref.line, ref.unit);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag });
  };
  return (
    <li className={cx(s.pileCard, looping && s.pileOn)} data-pile={puzzle.cards.indexOf(card)}>
      <button type="button" className={s.pileFr} style={unitColorVars(ref.line.units.indexOf(ref.unit))} onClick={play}>
        <span>{ref.unit.fr}</span>
      </button>
      <span className={s.eq}>=</span>
      <span className={s.pileEn}>
        {!card.truth && <s className={s.struck}>{card.shownEn}</s>}
        <span>{card.rightEn}</span>
      </span>
    </li>
  );
}

export function VraiFauxView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<VraiFauxPuzzle, VraiFauxState, VraiFauxAction>) {
  const tablet = practiceCtx.layout === 'tablet';
  const done = state.card >= puzzle.cards.length;
  const idx = Math.min(state.card, puzzle.cards.length - 1);
  const card = puzzle.cards[idx]!;
  const ref = findUnit(scene, card.unitId)!;
  const tag = tags.unit(card.unitId);
  const looping = useIsPlaying(tag);
  const [leaving, setLeaving] = useState<{ card: VraiFauxCard; says: boolean; key: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const potRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef(0);
  const wrongHere = state.wrongAt[idx] ?? 0;
  const reveal = !done && wrongHere >= VRAI_FAUX_REVEAL_AFTER;
  useStopAudioOnUnmount();

  const loop = () => {
    const w = loopWindowFor(ref.line, ref.unit);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag });
  };
  useEffect(() => {
    if (!done) loop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id, idx, done]);

  useEffect(() => {
    if (!leaving) return;
    const h = window.setTimeout(() => setLeaving(null), 650);
    return () => window.clearTimeout(h);
  }, [leaving]);

  const answer = (says: boolean, el: HTMLElement) => {
    if (done) return;
    const right = says === card.truth;
    if (right) {
      const streak = wrongHere === 0 ? state.streak + 1 : 0;
      setLeaving({ card, says, key: keyRef.current++ });
      fx.sfx('right');
      fx.haptic();
      fx.burst(el, says ? 'star' : 'spark');
      if (streak >= 2 && potRef.current) fx.combo(streak, potRef.current);
      if (state.card + 1 >= puzzle.cards.length) {
        window.setTimeout(() => fx.impact(undefined, undefined, { size: 'lg' }), 300);
        if (state.best >= 3 || streak >= 3) window.setTimeout(() => fx.confetti(), 450);
      }
    } else {
      fx.wrong(cardRef.current ?? el);
    }
    dispatch({ kind: 'answer', says });
  };

  const resolved = puzzle.cards.slice(0, state.card);
  const pile = resolved.slice(-3).reverse();
  const leavingRef = leaving ? findUnit(scene, leaving.card.unitId) : undefined;
  const leavingIdx = leavingRef ? leavingRef.line.units.indexOf(leavingRef.unit) : 0;
  const level = puzzle.cards.length ? state.streak / puzzle.cards.length : 0;

  return (
    <div className={cx(s.puzzle, tablet && s.tablet)}>
      <div className={s.top}>
        <Stamp variant="issue" color="yellow" tilt={-5}>
          {t('puzzles.vrai-faux.card', { n: Math.min(state.card + 1, puzzle.cards.length), total: puzzle.cards.length })}
        </Stamp>
        <div ref={potRef} className={s.pot}>
          <Cauldron level={done ? Math.max(level, 0.3) : level} />
          <span className={cx(s.combo, state.streak >= 2 && s.comboOn)} key={state.streak}>
            ×{state.streak}
          </span>
        </div>
      </div>

      <div className={s.stage}>
        {!done && (
          <div ref={cardRef} className={s.card} key={idx} data-card={idx}>
            <div className={s.frRow}>
              <LoopButton looping={looping} onToggle={() => (looping ? audio.stop() : loop())} label={looping ? t('puzzles.vrai-faux.stop') : t('puzzles.vrai-faux.listen')} size={tablet ? 'lg' : 'md'} />
              <button type="button" className={s.french} style={unitColorVars(ref.line.units.indexOf(ref.unit))} onClick={loop} data-french>
                <span>{ref.unit.fr}</span>
              </button>
            </div>
            <Balloon tail="top" tailAt="18%" boxy color="paper" className={s.meaning}>
              <span className={s.meaningLabel}>{t('puzzles.vrai-faux.means')}</span>
              <span className={s.meaningEn} data-shown>
                {card.shownEn}
              </span>
            </Balloon>
          </div>
        )}
        {leaving && (
          <div className={cx(s.card, s.leaving, leaving.says ? s.toRight : s.toLeft)} key={`l${leaving.key}`} aria-hidden>
            <div className={s.frRow}>
              <span className={s.french} style={unitColorVars(leavingIdx)}>
                <span>{leavingRef?.unit.fr}</span>
              </span>
            </div>
            <Stamp variant="plain" color={leaving.says ? 'green' : 'red'} tilt={-12} className={s.verdict}>
              {leaving.says ? t('puzzles.vrai-faux.true') : t('puzzles.vrai-faux.false')}
            </Stamp>
          </div>
        )}
      </div>

      {!done && (
        <div className={s.buttons}>
          <button type="button" className={cx(s.btn, s.no, reveal && !card.truth && s.glow)} onClick={(e) => answer(false, e.currentTarget)} data-answer="false" data-correct={import.meta.env.DEV ? String(!card.truth) : undefined}>
            <Thumb down />
            <span>{t('puzzles.vrai-faux.false')}</span>
          </button>
          <button type="button" className={cx(s.btn, s.yes, reveal && card.truth && s.glow)} onClick={(e) => answer(true, e.currentTarget)} data-answer="true" data-correct={import.meta.env.DEV ? String(card.truth) : undefined}>
            <Thumb />
            <span>{t('puzzles.vrai-faux.true')}</span>
          </button>
        </div>
      )}

      {pile.length > 0 && (
        <ol className={s.pile} style={{ '--n': pile.length } as CSSProperties}>
          {(done ? resolved.slice().reverse() : pile).map((c) => (
            <PileCard key={c.unitId} puzzle={puzzle} card={c} scene={scene} />
          ))}
        </ol>
      )}
    </div>
  );
}
