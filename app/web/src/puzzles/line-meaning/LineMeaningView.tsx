// The view of `line-meaning` ("Meaning line-up"): three or four lines in a row wait as numbered
// speakers, their French hidden; their English meanings lie shuffled as cards. At first the whole
// stretch loops and each speaker lights up as its line is said. Tap a speaker (it loops just its
// line), then the meaning that goes with it: the card flies under the speaker and the French appears
// in coloured boxes. A wrong meaning wobbles; after two, the right one glows while that speaker is
// selected. When all are matched the stretch loops again, every speaker now showing its French.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useLater } from '../useLater';
import type { Line } from '../../../../shared/content';
import { displayEn } from '../../../../shared/puzzles/listen-pick';
import { LINE_MEANING_REVEAL_AFTER, type LineMeaningAction, type LineMeaningState, type LineMeaningPuzzle } from '../../../../shared/puzzles/line-meaning';
import { t } from '../../../../shared/i18n';
import { audio, useAudioClock, useIsPlaying, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { findLine, lineWindow, tags } from '../../scene/timing';
import { Icon, cx, unitColorVars } from '../../ui';
import { LoopButton, rememberOrigin, useFlyIn } from '../arcade/kit';
import type { PuzzleViewProps } from '../registry';
import s from './LineMeaning.module.css';

function MatchedEn({ line }: { line: Line }) {
  const ref = useFlyIn<HTMLSpanElement>(`lm:${line.id}`, { ms: 440 });
  return (
    <span ref={ref} className={s.matchedEn}>
      {displayEn(line.en)}
    </span>
  );
}

/** The French of a matched line, as coloured unit boxes (the text between units as plain text). */
function FrenchBoxes({ line }: { line: Line }) {
  const parts: ReactNode[] = [];
  let pos = 0;
  line.units.forEach((u, i) => {
    const between = line.fr.slice(pos, u.cs).replace(/\s+/g, ' ').trim();
    if (between) parts.push(<span key={`p${i}`} className={s.punct}>{between}</span>);
    pos = u.ce;
    parts.push(
      <span key={u.id} className={s.ubox} style={unitColorVars(i)}>
        <span>{u.fr}</span>
      </span>,
    );
  });
  const tail = line.fr.slice(pos).trim();
  if (tail) parts.push(<span key="end" className={s.punct}>{tail}</span>);
  return <span className={s.boxes}>{parts}</span>;
}

export function LineMeaningView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<LineMeaningPuzzle, LineMeaningState, LineMeaningAction>) {
  const tablet = practiceCtx.layout === 'tablet';
  const lines = puzzle.lineIds.map((id) => findLine(scene, id)!);
  const done = state.matched.length >= lines.length;
  const [selected, setSelected] = useState<string | null>(null);
  const stretchTag = `lm:${puzzle.id}`;
  const stretchOn = useIsPlaying(stretchTag);
  const first = lineWindow(lines[0]!);
  const last = lineWindow(lines[lines.length - 1]!);
  useStopAudioOnUnmount();
  const later = useLater(); // delayed plays die with the puzzle

  const loopAll = () => {
    setSelected(null);
    audio.playRange(scene.audio.src, first.startMs, last.endMs, { loop: true, tag: stretchTag });
  };
  useEffect(() => {
    loopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  const heard = useAudioClock((ms, st) => {
    if (st.tag !== stretchTag || !st.playing) return -1;
    let k = -1;
    lines.forEach((l, i) => {
      if (ms >= lineWindow(l).startMs - 80) k = i;
    });
    return k;
  });

  const select = (l: Line, el: HTMLElement) => {
    fx.pop(el);
    setSelected(l.id);
    const w = lineWindow(l);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag: tags.line(l.id) });
  };

  const choose = (meaning: string, el: HTMLElement) => {
    if (done) return;
    if (!selected || state.matched.includes(selected)) {
      // Which speaker? Nudge the speakers.
      document.querySelectorAll('[data-speaker]').forEach((x) => {
        if (!state.matched.includes((x as HTMLElement).dataset.speaker!)) fx.wobble(x);
      });
      fx.sfx('tap');
      return;
    }
    if (meaning === selected) {
      rememberOrigin(`lm:${meaning}`, el);
      fx.sfx('right');
      fx.haptic();
      const sp = document.querySelector(`[data-speaker="${CSS.escape(meaning)}"]`);
      window.setTimeout(() => sp && fx.impact(t('practice.fx.bing'), sp, { size: 'sm' }), 350);
      setSelected(null);
      if (state.matched.length + 1 >= lines.length)
        later(() => {
          fx.impact(undefined, undefined, { size: 'lg' });
          audio.playRange(scene.audio.src, first.startMs, last.endMs, { loop: true, tag: stretchTag });
        }, 700);
    } else {
      fx.wrong(el);
    }
    dispatch({ kind: 'pair', lineId: selected, meaning });
  };

  const selIdx = selected ? puzzle.lineIds.indexOf(selected) : -1;
  const reveal = selected && !state.matched.includes(selected) && (state.wrong[selIdx] ?? 0) >= LINE_MEANING_REVEAL_AFTER ? selected : null;
  const open = puzzle.meanings.filter((m) => !state.matched.includes(m));

  return (
    <div className={cx(s.puzzle, tablet && s.tablet)}>
      <div className={s.top}>
        <LoopButton looping={stretchOn} onToggle={() => (stretchOn ? audio.stop() : loopAll())} label={stretchOn ? t('puzzles.line-meaning.stop') : t('puzzles.line-meaning.listen')} />
        <p className={s.prompt}>{t(done ? 'puzzles.line-meaning.done' : selected ? 'puzzles.line-meaning.pickMeaning' : 'puzzles.line-meaning.prompt')}</p>
      </div>

      <div className={s.board}>
        <ol className={s.speakers}>
          {lines.map((l, i) => {
            const matched = state.matched.includes(l.id);
            const isSel = selected === l.id;
            return (
              <li key={l.id} style={{ '--i': i } as CSSProperties}>
                <button
                  type="button"
                  className={cx(s.speaker, matched && s.matched, isSel && s.selected, heard === i && s.heard)}
                  onClick={(e) => select(l, e.currentTarget)}
                  data-speaker={l.id}
                  aria-pressed={isSel}
                  aria-label={matched ? l.fr : t('puzzles.line-meaning.speaker', { n: i + 1 })}
                >
                  <span className={s.num}>{i + 1}</span>
                  {matched ? (
                    <span className={s.body}>
                      <FrenchBoxes line={l} />
                      <MatchedEn line={l} />
                    </span>
                  ) : (
                    <span className={s.hidden}>
                      <Icon name="speaker" size={30} />
                      <span className={s.dots} aria-hidden>
                        ? ? ?
                      </span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>

        {!done && (
          <ul className={s.meanings}>
            {open.map((m, i) => {
              const l = findLine(scene, m)!;
              return (
                <li key={m} style={{ '--i': i } as CSSProperties}>
                  <button type="button" className={cx(s.meaning, reveal === m && s.glow, !selected && s.idle)} onClick={(e) => choose(m, e.currentTarget)} data-meaning={m} lang="en">
                    {displayEn(l.en)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
