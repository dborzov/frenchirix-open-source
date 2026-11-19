// What the practice shell keeps between page loads: where the kid is in a running practice
// (sessionStorage), so a reload of this tab resumes at the same puzzle with its time and outcomes.
// Nothing here is precious: every finished puzzle is saved on the server before the kid moves on
// (docs/app-games.md, "The practice screen"), and a reopened practice asks the server where it stands.
import type { PuzzleOutcome } from '../../../shared/practice/types';

const PROGRESS_KEY = (id: string) => `frx.practice.progress.${id}`;

function read<T>(store: Storage | undefined, key: string): T | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(store: Storage | undefined, key: string, value: unknown): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full: resuming is a convenience */
  }
}
const session = () => (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);

export interface PracticeProgress {
  puzzleIndex: number;
  outcomes: PuzzleOutcome[];
  ms: number; // time spent before this page load
}
export function saveProgress(id: string, p: PracticeProgress | null): void {
  write(session(), PROGRESS_KEY(id), p);
}
export function loadProgress(id: string): PracticeProgress | null {
  return read<PracticeProgress>(session(), PROGRESS_KEY(id));
}
export function forgetPractice(id: string): void {
  saveProgress(id, null);
}
