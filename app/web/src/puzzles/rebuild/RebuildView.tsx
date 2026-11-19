// The view of `rebuild`: the line loops; its English hangs in a balloon; the pieces of the French lie
// scattered in a tray; tapping the piece heard next flies it into the sentence rail, where it takes
// its unit's colour. A wrong piece wobbles ("OUPS !"); after two wrong taps on a slot the right
// piece glows. The finished line slams together and shows as a dialogue strip with its English.
import { useEffect, useRef, type CSSProperties } from 'react';
import type { Line } from '../../../../shared/content';
import { REBUILD_REVEAL_AFTER, type RebuildAction, type RebuildState, type RebuildPuzzle, type RebuildTile } from '../../../../shared/puzzles/rebuild';
import { t } from '../../../../shared/i18n';
import { audio, useIsPlaying, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { DialogueStrip } from '../../scene/DialogueStrip';
import { Slideshow } from '../../scene/Slideshow';
import { findLine, lineWindow, tags } from '../../scene/timing';
import { Balloon, cx, unitColorVars } from '../../ui';
import { LoopButton, rememberOrigin, useFlyIn } from '../arcade/kit';
import type { PuzzleViewProps } from '../registry';
import s from './Rebuild.module.css';

function hash(str: string): number {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

function unitIndex(line: Line, unitId: string): number {
  return Math.max(0, line.units.findIndex((u) => u.id === unitId));
}

function Slot({ tile, line, index, next, words }: { tile: RebuildTile | null; line: Line; index: number; next: boolean; words: boolean }) {
  const ref = useFlyIn<HTMLSpanElement>(tile ? tile.id : null);
  if (!tile)
    return (
      <span className={cx(s.slot, s.empty, next && s.next)} aria-hidden>
        <span className={s.num}>{index + 1}</span>
      </span>
    );
  return (
    <span ref={ref} className={cx(s.slot, s.filled, words && s.word)} style={unitColorVars(unitIndex(line, tile.unitId))} data-slot={index}>
      <span>{tile.fr}</span>
    </span>
  );
}

export function RebuildView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<RebuildPuzzle, RebuildState, RebuildAction>) {
  const line = findLine(scene, puzzle.lineId)!;
  const tag = tags.line(line.id);
  const looping = useIsPlaying(tag);
  const railRef = useRef<HTMLDivElement>(null);
  const done = state.placed >= puzzle.answer.length;
  const reveal = !done && (state.wrongAt[state.placed] ?? 0) >= REBUILD_REVEAL_AFTER ? puzzle.answer[state.placed] : null;
  const tablet = practiceCtx.layout === 'tablet';
  useStopAudioOnUnmount();

  const loop = () => {
    const w = lineWindow(line);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag });
  };
  useEffect(() => {
    loop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  const placedIds = new Set(puzzle.answer.slice(0, state.placed));

  const tap = (tile: RebuildTile, el: HTMLElement) => {
    if (done || placedIds.has(tile.id)) return;
    const right = puzzle.answer[state.placed] === tile.id;
    if (right) {
      rememberOrigin(tile.id, el);
      fx.sfx('pop');
      fx.haptic();
      if (state.placed + 1 >= puzzle.answer.length) {
        // The last piece: the sentence slams together.
        window.setTimeout(() => {
          const rail = railRef.current;
          if (!rail) return;
          fx.impact(undefined, rail, { size: 'md' });
          fx.burst(rail, 'star');
          fx.sfx('right');
        }, 380);
        if (!looping) loop();
      }
    } else {
      fx.wrong(el);
    }
    dispatch({ kind: 'tap', tile: tile.id });
  };

  const byId = new Map(puzzle.tiles.map((x) => [x.id, x]));
  const w = lineWindow(line);

  return (
    <div className={cx(s.puzzle, tablet && s.tablet)}>
      <div className={s.head}>
        {!tablet && <Slideshow frames={scene.frames} timeMs={w.startMs + 200} className={s.frame} drift={false} />}
        <LoopButton looping={looping} onToggle={() => (looping ? audio.stop() : loop())} label={looping ? t('puzzles.rebuild.stop') : t('puzzles.rebuild.listen')} size={tablet ? 'lg' : 'md'} />
        <Balloon tail="left" boxy className={s.meaning}>
          <span className={s.meaningLabel}>{t('puzzles.rebuild.meaning')}</span>
          <span className={s.meaningEn}>{puzzle.en}</span>
        </Balloon>
      </div>

      <div ref={railRef} className={cx(s.rail, done && s.railDone)} data-rail>
        {puzzle.answer.map((id, i) => (
          <Slot key={id} tile={i < state.placed ? byId.get(id)! : null} line={line} index={i} next={i === state.placed} words={puzzle.words} />
        ))}
      </div>

      {!done && <p className={s.prompt}>{t('puzzles.rebuild.prompt')}</p>}

      {!done ? (
        <div className={s.tray}>
          {puzzle.tiles.map((tile, i) => {
            const h = hash(tile.id);
            const placed = placedIds.has(tile.id);
            return (
              <button
                key={tile.id}
                type="button"
                className={cx(s.tile, placed && s.gone, reveal === tile.id && s.glow)}
                style={{ '--rot': `${(h % 7) - 3}deg`, '--dy': `${(h >> 3) % 9}px`, '--i': i } as CSSProperties}
                disabled={placed}
                onClick={(e) => tap(tile, e.currentTarget)}
                data-tile={tile.id}
                data-next={import.meta.env.DEV ? String(puzzle.answer[state.placed] === tile.id) : undefined}
              >
                <span>{tile.fr}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={s.after}>
          <DialogueStrip scene={scene} lineIds={[line.id]} showEnglish compact />
        </div>
      )}
    </div>
  );
}
