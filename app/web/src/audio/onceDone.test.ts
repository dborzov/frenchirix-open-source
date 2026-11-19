import { describe, expect, it } from 'vitest';
import { onceDone, PLAY_SLACK_MS } from './onceDone';

function timers() {
  const due: { fn: () => void; ms: number }[] = [];
  return { later: (fn: () => void, ms: number) => due.push({ fn, ms }) + 1000, due };
}

describe('onceDone', () => {
  it('goes on once, whichever comes first: the end, an error or the timer', () => {
    for (const first of ['end', 'error', 'timer'] as const) {
      const t = timers();
      let n = 0;
      const o = onceDone(() => n++, 800, t.later);
      expect(t.due).toHaveLength(1);
      expect(t.due[0]!.ms).toBe(800 + PLAY_SLACK_MS);
      if (first === 'end') o.onEnd();
      if (first === 'error') o.onError(new Error('x') as never);
      t.due[0]!.fn();
      o.onEnd();
      o.onError(new Error('x') as never);
      expect(n).toBe(1);
    }
  });
});
