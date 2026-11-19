// The view of `listen-pick`: "Qui dit quoi ?". The scene's frame is the stage, with an empty speech
// balloon pinned on the picture ("? ? ?") while the line loops. The five English meanings float
// below as speech balloons; tap the one the speaker says and it flies up and snaps into the empty
// balloon on the picture with a PAF ! (the burst lands on the picture's corner, never on the
// sentence), and the other balloons pop away. A wrong balloon pops and goes flat with an "OUPS !";
// after two wrong picks the right one glows. All five balloons always show at once, on every layout;
// with long meanings on a phone the puzzle column scrolls (the owner's decision, no carousel).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { REVEAL_AFTER, type ListenPickAction, type ListenPickState, type ListenPickPuzzle } from '../../../../shared/puzzles/listen-pick';
import { t } from '../../../../shared/i18n';
import { audio, useIsPlaying, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { frameAt } from '../../scene/Slideshow';
import { findLine, lineWindow, tags } from '../../scene/timing';
import { cx } from '../../ui';
import { LoopButton } from '../arcade/kit';
import type { PuzzleViewProps } from '../registry';
import s from './ListenPick.module.css';

const FLY_MS = 420;

export function ListenPickView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<ListenPickPuzzle, ListenPickState, ListenPickAction>) {
  const line = findLine(scene, puzzle.lineId)!;
  const tag = tags.line(line.id);
  const looping = useIsPlaying(tag);
  const tablet = practiceCtx.layout === 'tablet';
  const done = state.picked !== null;
  const reveal = !done && state.wrong.length >= REVEAL_AFTER;
  const [landed, setLanded] = useState(false); // the chosen balloon has snapped onto the picture
  const [flying, setFlying] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  useStopAudioOnUnmount();
  useEffect(() => () => timers.current.forEach((h) => window.clearTimeout(h)), []);
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));

  const loop = () => {
    const w = lineWindow(line);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag });
  };
  // The line loops from the start and keeps looping (an earworm) until the kid moves on.
  useEffect(() => {
    if (!audio.isMuted()) loop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  // If the logic finished without the animation (e.g. a replay), show the result at once.
  useEffect(() => {
    if (done && flying === null && !landed) setLanded(true);
  }, [done, flying, landed]);

  /** A copy of the balloon flies from where it was tapped (`a`) to the empty balloon on the picture. */
  const flyUp = (from: HTMLElement, a: DOMRect): Promise<void> => {
    const to = slotRef.current;
    if (!to || fx.reducedMotion() || typeof from.animate !== 'function') return Promise.resolve();
    const b = to.getBoundingClientRect();
    const ghost = from.cloneNode(true) as HTMLElement;
    for (const at of ['data-choice', 'data-correct']) ghost.removeAttribute(at);
    Object.assign(ghost.style, { position: 'fixed', left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, margin: '0', zIndex: '400', pointerEvents: 'none' });
    document.body.appendChild(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = ghost.animate(
      [
        { transform: 'none' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 50}px) rotate(-8deg) scale(1.08)`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(${Math.min(1.3, b.width / a.width)})`, opacity: 0.4 },
      ],
      { duration: FLY_MS, easing: 'cubic-bezier(0.3, 0.8, 0.4, 1)' },
    );
    return new Promise((r) => {
      anim.onfinish = anim.oncancel = () => {
        ghost.remove();
        r();
      };
    });
  };

  const pick = async (index: number, el: HTMLElement) => {
    if (done || flying !== null || state.wrong.includes(index)) return;
    const c = puzzle.choices[index]!;
    if (!c.correct) {
      fx.wrong(el);
      fx.burst(el, { kind: 'dot', count: 10 });
      dispatch({ kind: 'pick', index });
      return;
    }
    // A balloon low in a long list was scrolled to: bring the picture back into view first (at once, so
    // the copy can still start under the finger) and fly up to where the balloon lands.
    const from = el.getBoundingClientRect();
    stageRef.current?.scrollIntoView?.({ block: 'nearest' });
    setFlying(index);
    dispatch({ kind: 'pick', index });
    fx.sfx('whoosh');
    await flyUp(el, from);
    setFlying(null);
    setLanded(true);
    if (!looping) loop();
    // PAF on the picture's lower corner, away from the balloon at the top.
    const st = stageRef.current?.getBoundingClientRect();
    if (st) {
      const at = { x: st.right - 36, y: st.bottom - 8 };
      fx.impact(t('practice.fx.paf'), at, { size: 'sm' });
      fx.burst(at, 'star');
    }
    fx.sfx('right');
    fx.haptic(20);
  };

  const w = lineWindow(line);
  const frame = frameAt(scene.frames, w.startMs + 200)?.src;
  const answer = state.picked !== null ? puzzle.choices[state.picked]! : null;

  const balloon = (i: number) => {
    const c = puzzle.choices[i]!;
    const wrong = state.wrong.includes(i);
    const right = state.picked === i;
    return (
      <button
        key={i}
        type="button"
        className={cx(s.choice, wrong && s.popped, right && s.chosen, done && !right && s.away, reveal && c.correct && s.glow, flying === i && s.lifting)}
        style={{ '--i': i } as CSSProperties}
        disabled={wrong || done}
        onClick={(e) => void pick(i, e.currentTarget)}
        data-choice={i}
        data-correct={import.meta.env.DEV ? String(c.correct) : undefined}
        lang="en"
      >
        <span className={s.choiceText}>{c.en}</span>
      </button>
    );
  };

  return (
    <div className={cx(s.puzzle, tablet && s.tablet)} data-listen-pick>
      <div ref={stageRef} className={s.stage} data-stage>
        {frame && <img className={s.picture} src={frame} alt="" draggable={false} />}
        <div ref={slotRef} className={cx(s.slot, landed && s.slotFull)} data-slot aria-live="polite">
          {landed && answer ? (
            <span className={s.slotText} lang="en">
              {answer.en}
            </span>
          ) : (
            <span className={s.slotQ} aria-label={t('puzzles.listen-pick.prompt')}>
              ? ? ?
            </span>
          )}
        </div>
        <LoopButton className={s.loop} looping={looping} onToggle={() => (looping ? audio.stop() : loop())} label={looping ? t('puzzles.listen-pick.stop') : t('puzzles.listen-pick.listen')} />
      </div>
      <p className={s.prompt}>{t(done ? 'puzzles.listen-pick.done' : 'puzzles.listen-pick.who')}</p>

      <div className={s.choices}>{puzzle.choices.map((_, i) => balloon(i))}</div>
    </div>
  );
}
