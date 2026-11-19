// The view of `comic-order`: a stretch of three or four lines loops; their panels (the frame where
// each is said, its French, its English) lie shuffled; the kid taps the panel that comes next and it
// flies into the comic strip, N° 1 to N° 4. Each panel's speaker loops just its line. A wrong panel
// wobbles; after two wrong taps on a slot the right one glows. The finished strip plays through, the
// panel being spoken lit up, with the dialogue strip of the stretch underneath.
import { useEffect, useRef, type CSSProperties } from 'react';
import { useLater } from '../useLater';
import type { Line } from '../../../../shared/content';
import { COMIC_REVEAL_AFTER, type ComicOrderAction, type ComicOrderState, type ComicOrderPuzzle } from '../../../../shared/puzzles/comic-order';
import { displayEn } from '../../../../shared/puzzles/listen-pick';
import { t } from '../../../../shared/i18n';
import { audio, useAudioClock, useIsPlaying, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { DialogueStrip } from '../../scene/DialogueStrip';
import { frameAt } from '../../scene/Slideshow';
import { findLine, lineWindow, tags } from '../../scene/timing';
import { Icon, cx } from '../../ui';
import { LoopButton, rememberOrigin, useFlyIn } from '../arcade/kit';
import type { PuzzleViewProps } from '../registry';
import s from './ComicOrder.module.css';

function StripSlot({ line, n, frame, next, lit, tablet }: { line: Line | null; n: number; frame?: string; next: boolean; lit: boolean; tablet: boolean }) {
  const ref = useFlyIn<HTMLDivElement>(line ? `comic:${line.id}` : null, { ms: 460 });
  return (
    <div ref={line ? ref : undefined} className={cx(s.slot, line ? s.filled : s.empty, next && s.next, lit && s.lit)} data-slot={n}>
      <span className={s.no}>{t('puzzles.comic-order.panel', { n: n + 1 })}</span>
      {line && frame && <img className={s.slotImg} src={frame} alt="" draggable={false} />}
      {line && tablet && <span className={s.slotFr}>{displayEn(line.fr)}</span>}
    </div>
  );
}

export function ComicOrderView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<ComicOrderPuzzle, ComicOrderState, ComicOrderAction>) {
  const tablet = practiceCtx.layout === 'tablet';
  const lines = puzzle.answer.map((id) => findLine(scene, id)!);
  const first = lineWindow(lines[0]!);
  const last = lineWindow(lines[lines.length - 1]!);
  const stretchTag = `comic:${puzzle.id}`;
  const looping = useIsPlaying(stretchTag);
  const done = state.placed >= puzzle.answer.length;
  const reveal = !done && (state.wrongAt[state.placed] ?? 0) >= COMIC_REVEAL_AFTER ? puzzle.answer[state.placed] : null;
  const stripRef = useRef<HTMLDivElement>(null);
  useStopAudioOnUnmount();
  const later = useLater(); // delayed plays die with the puzzle

  const loopAll = () => audio.playRange(scene.audio.src, first.startMs, last.endMs, { loop: true, tag: stretchTag });
  useEffect(() => {
    loopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  // While the whole stretch plays, which panel is being spoken.
  const litIndex = useAudioClock((ms, st) => {
    if (st.tag !== stretchTag || !st.playing) return -1;
    let k = -1;
    lines.forEach((l, i) => {
      if (ms >= lineWindow(l).startMs - 80) k = i;
    });
    return k;
  });

  const playLine = (l: Line) => {
    const w = lineWindow(l);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag: tags.line(l.id) });
  };

  const place = (id: string, el: HTMLElement) => {
    if (done || puzzle.answer.indexOf(id) < state.placed) return;
    if (puzzle.answer[state.placed] === id) {
      rememberOrigin(`comic:${id}`, el);
      fx.sfx('pop');
      fx.haptic();
      if (state.placed + 1 >= puzzle.answer.length) {
        later(() => {
          if (stripRef.current) {
            fx.impact(undefined, stripRef.current, { size: 'lg' });
            fx.burst(stripRef.current, 'confetti');
          }
          loopAll();
        }, 420);
      }
    } else {
      fx.wrong(el);
    }
    dispatch({ kind: 'place', lineId: id });
  };

  const frameOf = (l: Line) => frameAt(scene.frames, lineWindow(l).startMs + 250)?.src;
  const placed = new Set(puzzle.answer.slice(0, state.placed));

  return (
    <div className={cx(s.puzzle, tablet && s.tablet)}>
      <div className={s.head}>
        <LoopButton looping={looping} onToggle={() => (looping ? audio.stop() : loopAll())} label={looping ? t('puzzles.comic-order.stop') : t('puzzles.comic-order.listen')} size={tablet ? 'lg' : 'md'} />
        <p className={s.prompt}>{t(done ? 'puzzles.comic-order.done' : 'puzzles.comic-order.prompt')}</p>
      </div>

      <div ref={stripRef} className={cx(s.strip, done && s.stripDone)} style={{ '--n': lines.length } as CSSProperties} data-strip>
        {lines.map((l, i) => (
          <StripSlot key={l.id} line={i < state.placed ? l : null} n={i} frame={frameOf(l)} next={i === state.placed} lit={done && litIndex === i} tablet={tablet} />
        ))}
      </div>

      {!done ? (
        <ul className={s.cards}>
          {puzzle.cards.map((id, i) => {
            const l = findLine(scene, id)!;
            if (placed.has(id)) return null;
            return (
              <li key={id} className={cx(s.card, reveal === id && s.glow)} style={{ '--i': i } as CSSProperties}>
                <button type="button" className={s.cardMain} onClick={(e) => place(id, e.currentTarget.parentElement ?? e.currentTarget)} data-card={id} data-next={import.meta.env.DEV ? String(puzzle.answer[state.placed] === id) : undefined}>
                  {frameOf(l) && <img className={s.thumb} src={frameOf(l)} alt="" draggable={false} />}
                  <span className={s.texts}>
                    <span className={s.fr}>{displayEn(l.fr)}</span>
                    <span className={s.en}>{displayEn(l.en)}</span>
                  </span>
                </button>
                <CardSpeaker line={l} onPlay={() => playLine(l)} />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={s.after}>
          <DialogueStrip scene={scene} lineIds={puzzle.answer} showEnglish compact activeLineId={litIndex >= 0 ? lines[litIndex]!.id : null} />
        </div>
      )}
    </div>
  );
}

function CardSpeaker({ line, onPlay }: { line: Line; onPlay: () => void }) {
  const on = useIsPlaying(tags.line(line.id));
  return (
    <button type="button" className={cx(s.spk, on && s.spkOn)} onClick={() => (on ? audio.stop() : onPlay())} aria-label={t('puzzles.comic-order.hear')} data-hear={line.id}>
      <Icon name={on ? 'speaker' : 'play'} size={22} />
    </button>
  );
}
