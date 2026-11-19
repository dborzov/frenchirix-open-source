// What the liveness explorer (liveness.explore.tsx) writes for each run and tools/liveness/run.ts reads.
// No imports: the Node tools' tsconfig checks this file too.

/** How a run ended (docs/checks.md, "check:liveness"). `no-build`: no scene tried built a puzzle of this type. */
export type RunKind = 'done' | 'slow' | 'stuck' | 'escape-only' | 'livelock' | 'crash' | 'no-build';

export interface Run {
  type: string;
  scenario: string;
  seed: number;
  sceneId: string | null;
  level: number | null;
  layout: 'phone' | 'tablet';
  kind: RunKind;
  /** Stable across runs: puzzle type, kind and where the view ended (its state attributes, its controls); not the seed. */
  signature: string;
  state: string;
  controls: string;
  /** At a dead end (stuck, livelock): whether "Je ne peux pas parler" got the kid out. */
  escape: 'none' | 'works' | 'fails';
  ms: number; // fake time
  steps: number; // taps
  error?: string;
  /** The last lines of the run's log (each outcome drawn and each tap); all of it when replaying one run. */
  log: string[];
}
