// What the kid is asked to say, drawn as the dialogue strip's coloured boxes (tap one: its meaning,
// and its sound loops). After each try the boxes whose words were heard light up and stay lit (the
// speaking core's `lit`, partial credit that builds); a box partly heard is half lit. When the target
// is one unit of a line, the rest of the line is shown faint around it.
//
// Also `replayMissing`: after a try that did not pass, the first piece not heard yet plays once, then
// the whole target loops (on the piece's end, its error, or a timer: onceDone).
import type { CSSProperties } from 'react';
import type { Line, Scene, Unit } from '../../../shared/content';
import { spanCredit } from '../../../shared/puzzles/speak-core';
import { audio, onceDone } from '../audio';
import { DialogueStrip } from '../scene/DialogueStrip';
import { loopWindowFor, tags } from '../scene/timing';
import { cx } from '../ui';
import s from './SpeakPanel.module.css';

export interface TargetStripProps {
  scene: Scene;
  line: Line;
  /** When the target is one unit of the line. */
  unit?: Unit;
  lit: readonly boolean[];
  /** The kid's turn: the boxes pulse. */
  active?: boolean;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Credit 0..1 of one unit of the line, given the words heard of the target. */
export function unitCredit(line: Line, unit: Unit, target: Unit | undefined, lit: readonly boolean[]): number {
  if (target) return target.id === unit.id ? spanCredit(target.fr, lit, 0, target.fr.length) : 0;
  return spanCredit(line.fr, lit, unit.cs, unit.ce);
}

export function TargetStrip({ scene, line, unit, lit, active, compact, className, style }: TargetStripProps) {
  return (
    <div className={cx(s.target, active && s.targetActive, className)} style={style} data-target-strip>
      <DialogueStrip
        scene={scene}
        lineIds={[line.id]}
        compact={compact}
        linePlay={false}
        unitClassName={(u) => {
          if (unit && u.id !== unit.id) return s.faint;
          const c = unitCredit(line, u, unit, lit);
          return c >= 1 ? s.litBox : c > 0 ? s.halfBox : undefined;
        }}
      />
    </div>
  );
}

/**
 * After a miss: the first unit not fully heard plays once from the scene (or its whole line when its
 * times are estimated), then `then()` (usually: the whole target, looping), once, on the piece's end,
 * its error or a timer. `later` is the view's own timer (useLater), so nothing plays on a puzzle that is gone.
 */
export function replayMissing(scene: Scene, line: Line, target: Unit | undefined, lit: readonly boolean[], then: () => void, later: (fn: () => void, ms: number) => number): void {
  const units = target ? [target] : line.units;
  const miss = units.find((u) => u.key && unitCredit(line, u, target, lit) < 1) ?? units.find((u) => unitCredit(line, u, target, lit) < 1);
  if (!miss || target || units.length === 1) {
    then();
    return;
  }
  const w = loopWindowFor(line, miss);
  audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: false, tag: tags.unit(miss.id), ...onceDone(() => later(then, 250), w.endMs - w.startMs, later) });
}
