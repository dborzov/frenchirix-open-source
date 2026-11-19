// The view of `catapult`: Roman legionaries stand on a palisade holding up signs with English
// meanings; a French expression of the scene loops from the Gauls' side; tap the Roman whose sign
// says what it means and the catapult throws a boulder at him: PAF, he flies off. A wrong Roman
// takes the boulder on his helmet, says BONG, sticks his tongue out and stays; after two wrong shots
// the right Roman's sign glows. The logic moves on at once; the view lags a round behind while the
// boulder flies (presentation only, never needed for the round to finish).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CATAPULT_REVEAL_AFTER, type CatapultAction, type CatapultState, type CatapultPuzzle } from '../../../../shared/puzzles/catapult';
import { t } from '../../../../shared/i18n';
import { audio, useIsPlaying, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { frameAt } from '../../scene/Slideshow';
import { findUnit, loopWindowFor, tags } from '../../scene/timing';
import { Stamp, cx, unitColorVars } from '../../ui';
import { Boulder, Catapult, LoopButton, Roman, throwArc } from '../arcade/kit';
import type { PuzzleViewProps } from '../registry';
import s from './Catapult.module.css';

const TUNICS = ['#E8303A', '#7A3FF2', '#FF7A1A', '#2F7FA8'];
const FLIGHT_MS = 480;

function centre(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function CatapultView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<CatapultPuzzle, CatapultState, CatapultAction>) {
  const tablet = practiceCtx.layout === 'tablet';
  const done = state.round >= puzzle.rounds.length;
  // The round on screen: lags the logic while the boulder flies and the Roman tumbles away.
  const [shown, setShown] = useState(0);
  const [fired, setFired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hit, setHit] = useState<number | null>(null);
  const [bounced, setBounced] = useState<number | null>(null);
  const romanRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const catRef = useRef<HTMLDivElement>(null);
  const boulderRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  useStopAudioOnUnmount();
  useEffect(() => () => timers.current.forEach((h) => window.clearTimeout(h)), []);

  const roundIdx = Math.min(shown, puzzle.rounds.length - 1);
  const round = puzzle.rounds[roundIdx]!;
  const ref = findUnit(scene, round.unitId)!;
  const tag = tags.unit(round.unitId);
  const looping = useIsPlaying(tag);
  const wrongHere = state.wrong[roundIdx] ?? [];
  const reveal = !done && shown === state.round && wrongHere.length >= CATAPULT_REVEAL_AFTER;

  const loop = () => {
    const w = loopWindowFor(ref.line, ref.unit);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag });
  };
  useEffect(() => {
    loop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id, roundIdx]);

  // Catch up with the logic if it ran ahead without an animation (e.g. a fast double tap).
  useEffect(() => {
    if (!busy && shown < state.round && hit === null) setShown(state.round);
  }, [busy, shown, state.round, hit]);

  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));

  const fire = async (index: number) => {
    if (busy || done || shown !== state.round || wrongHere.includes(index)) return;
    const target = romanRefs.current[index];
    const c = round.choices[index]!;
    dispatch({ kind: 'fire', index });
    setBusy(true);
    setFired(true);
    fx.sfx('whoosh');
    later(260, () => setFired(false));
    const b = boulderRef.current;
    if (b && target && catRef.current && !fx.reducedMotion()) {
      const from = centre(catRef.current);
      const to = centre(target);
      b.style.visibility = 'visible';
      await throwArc(b, { x: from.x - 18, y: from.y - 40 }, { x: to.x - 18, y: to.y - 30 }, FLIGHT_MS);
      b.style.visibility = 'hidden';
    }
    if (c.correct) {
      setHit(index);
      if (target) {
        fx.impact(t('practice.fx.paf'), target, { size: 'md' });
        fx.burst(target, 'star');
      }
      fx.sfx('right');
      fx.haptic(20);
      const last = state.round + 1 >= puzzle.rounds.length;
      if (last) later(350, () => fx.impact(undefined, undefined, { size: 'lg' }));
      later(last ? 1200 : 760, () => {
        setHit(null);
        setBounced(null);
        setShown((x) => x + 1);
        setBusy(false);
      });
    } else {
      setBounced(index);
      if (target) {
        fx.impact(t('puzzles.catapult.bong'), target, { size: 'sm', fill: '#FFFFFF' });
        fx.wrong(target);
      }
      later(700, () => {
        setBounced(null);
        setBusy(false);
      });
    }
  };

  // The scene's own picture of the moment, printed faintly behind the Romans: a memory anchor.
  const backdrop = frameAt(scene.frames, loopWindowFor(ref.line, ref.unit).startMs + 100)?.src;
  const allDown = done && shown >= puzzle.rounds.length;
  const n = round.choices.length;

  return (
    <div className={cx(s.puzzle, tablet && s.tablet)}>
      <div className={s.field} data-field>
        {backdrop && <img className={s.backdrop} src={backdrop} alt="" draggable={false} key={backdrop} />}
        <div className={s.score}>
          <Stamp variant="issue" color="yellow" tilt={-6}>
            {t('puzzles.catapult.round', { n: Math.min(shown + 1, puzzle.rounds.length), total: puzzle.rounds.length })}
          </Stamp>
        </div>
        <div className={s.romans} style={{ '--n': n } as CSSProperties} key={roundIdx}>
          {round.choices.map((c, i) => {
            const wrong = wrongHere.includes(i);
            const isHit = hit === i || allDown;
            return (
              <button
                key={i}
                ref={(el) => {
                  romanRefs.current[i] = el;
                }}
                type="button"
                className={cx(s.roman, wrong && s.missed, isHit && c.correct && s.hit, reveal && c.correct && s.glow)}
                style={{ '--i': i } as CSSProperties}
                onClick={() => fire(i)}
                disabled={wrong || done}
                aria-label={c.en}
                data-choice={i}
                data-correct={import.meta.env.DEV ? String(c.correct) : undefined}
              >
                <span className={s.sign} lang="en">
                  <span>{c.en}</span>
                </span>
                <Roman className={s.figure} tunic={TUNICS[i % TUNICS.length]} mood={isHit && c.correct ? 'ouch' : bounced === i || wrong ? 'tongue' : 'smug'} />
              </button>
            );
          })}
        </div>
        <svg className={s.palisade} aria-hidden>
          <defs>
            <pattern id="frx-stakes" width="26" height="44" patternUnits="userSpaceOnUse">
              <path d="M2 44 V12 L13 1 L24 12 V44 Z" fill="#B5712E" stroke="#111" strokeWidth="3" strokeLinejoin="miter" />
              <path d="M8 20 v16" stroke="#8A5220" strokeWidth="2.5" />
            </pattern>
          </defs>
          <rect width="100%" height="44" fill="url(#frx-stakes)" />
          <rect y="26" width="100%" height="7" fill="#8A5220" stroke="#111" strokeWidth="3" />
        </svg>
      </div>

      <div className={s.ground}>
        <div ref={catRef} className={s.catapult}>
          <Catapult fired={fired} />
        </div>
        <div className={s.voice}>
          <span className={s.voiceLabel}>{t('puzzles.catapult.prompt')}</span>
          <button type="button" className={s.french} style={unitColorVars(ref.line.units.indexOf(ref.unit))} onClick={loop} data-french lang="fr">
            <span>{ref.unit.fr}</span>
          </button>
        </div>
        <LoopButton looping={looping} onToggle={() => (looping ? audio.stop() : loop())} label={looping ? t('puzzles.catapult.stop') : t('puzzles.catapult.listen')} />
      </div>

      <div ref={boulderRef} className={s.boulder} aria-hidden>
        <Boulder />
      </div>
    </div>
  );
}
