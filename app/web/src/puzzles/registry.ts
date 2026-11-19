// OWNER: the puzzle types steps (each puzzle type adds one line). Created by the foundation step.
// Pairs each puzzle type's pure logic (shared/puzzles/<type>.ts) with its view (web/src/puzzles/<type>/).
// A puzzle type registers both here:
//   import { matchLogic } from '../../../shared/puzzles/match';
//   import { MatchView } from './match/MatchView';
import { question } from '../../../shared/puzzles/question';
import { sayHidden } from '../../../shared/puzzles/say-hidden';
import { sayLine } from '../../../shared/puzzles/say-line';
import { QuestionView } from './question/QuestionView';
import { SayHiddenView } from './say-hidden/SayHiddenView';
import { actLine } from '../../../shared/puzzles/act-line';
import { sayChain } from '../../../shared/puzzles/say-chain';
import { sayChoice } from '../../../shared/puzzles/say-choice';
import { ActLineView } from './act-line/ActLineView';
import { SayChainView } from './say-chain/SayChainView';
import { SayChoiceView } from './say-choice/SayChoiceView';
import { SayLineView } from './say-line/SayLineView';
//   registerPuzzleView(matchLogic, MatchView);
import type { ComponentType } from 'react';
import type { Scene } from '../../../shared/content';
import { registerPuzzleType } from '../../../shared/practice/registry';
import type { PuzzleType, PuzzleBase } from '../../../shared/practice/types';
import { listenPick } from '../../../shared/puzzles/listen-pick';
import { watch } from '../../../shared/puzzles/watch';
import { installEventCounters } from '../audio/events';
import type { Layout } from '../ui';
import { ListenPickView } from './listen-pick/ListenPickView';
import { WatchView } from './watch/WatchView';
import { fillBlanks } from '../../../shared/puzzles/fill-blanks';
import { match } from '../../../shared/puzzles/match';
import { FillBlanksView } from './fill-blanks/FillBlanksView';
import { MatchView } from './match/MatchView';
import { catapult } from '../../../shared/puzzles/catapult';
import { comicOrder } from '../../../shared/puzzles/comic-order';
import { memory } from '../../../shared/puzzles/memory';
import { rebuild } from '../../../shared/puzzles/rebuild';
import { vraiFaux } from '../../../shared/puzzles/vrai-faux';
import { CatapultView } from './catapult/CatapultView';
import { ComicOrderView } from './comic-order/ComicOrderView';
import { MemoryView } from './memory/MemoryView';
import { RebuildView } from './rebuild/RebuildView';
import { VraiFauxView } from './vrai-faux/VraiFauxView';
import { lineMeaning } from '../../../shared/puzzles/line-meaning';
import { nextLine } from '../../../shared/puzzles/next-line';
import { placeWords } from '../../../shared/puzzles/place-words';
import { LineMeaningView } from './line-meaning/LineMeaningView';
import { NextLineView } from './next-line/NextLineView';
import { PlaceWordsView } from './place-words/PlaceWordsView';

/** What the practice shell gives every puzzle view besides its puzzle and state. */
export interface PracticeCtx {
  practiceId: string;
  puzzleIndex: number;
  puzzleCount: number;
  layout: Layout;
  speak: boolean; // false: the kid cannot talk right now
  /** Open the help strip (counted in PuzzleOutcome.hints for puzzle types where it starts closed). */
  openHelp: () => void;
  /** Count one hint (pass it as a DialogueStrip's onHint when a puzzle type shows its own strip). */
  hint: () => void;
  /** True for the shell's dev page (/dev/practice): no API calls. */
  dev?: boolean;
  /** The puzzle is done and the reward moment has played: go to the next puzzle. */
  next: () => void;
  /** Flip the shell's "can't talk right now" switch (a speaking puzzle type whose mic is denied offers it). */
  setSpeak?: (speak: boolean) => void;
}

export interface PuzzleViewProps<T extends PuzzleBase = PuzzleBase, S = unknown, A = unknown> {
  puzzle: T;
  state: S;
  dispatch: (action: A) => void;
  scene: Scene;
  practiceCtx: PracticeCtx;
}

export type PuzzleView<T extends PuzzleBase = PuzzleBase, S = unknown, A = unknown> = ComponentType<PuzzleViewProps<T, S, A>>;

/**
 * How the practice shell shows the help strip for a puzzle type:
 * 'open'   the strip is open from the start (puzzle types that already show the French);
 * 'closed' behind a help button, opening it counts a hint (puzzle types that hide the French);
 * 'none'   no help strip (the puzzle type itself is the full strip, like watch).
 */
export type HelpMode = 'open' | 'closed' | 'none';

export interface PuzzleViewOptions {
  help?: HelpMode; // default 'open'
}

export interface PuzzleEntry {
  logic: PuzzleType<any, any, any>;
  View: PuzzleView<any, any, any>;
  help: HelpMode;
}

const entries = new Map<string, PuzzleEntry>();

export function registerPuzzleView<T extends PuzzleBase, S, A>(logic: PuzzleType<T, S, A>, View: PuzzleView<T, S, A>, opts: PuzzleViewOptions = {}): void {
  registerPuzzleType(logic);
  entries.set(logic.type, { logic, View, help: opts.help ?? 'open' });
}

export function getPuzzleEntry(type: string): PuzzleEntry | undefined {
  return entries.get(type);
}

export function allPuzzleEntries(): PuzzleEntry[] {
  return [...entries.values()];
}

installEventCounters();

// --- registrations (one line per puzzle type) ---
registerPuzzleView(watch, WatchView, { help: 'none' });
registerPuzzleView(listenPick, ListenPickView, { help: 'closed' });
registerPuzzleView(match, MatchView, { help: 'closed' });
registerPuzzleView(fillBlanks, FillBlanksView, { help: 'closed' });
registerPuzzleView(sayLine, SayLineView, { help: 'closed' });
registerPuzzleView(sayHidden, SayHiddenView, { help: 'closed' });
registerPuzzleView(actLine, ActLineView, { help: 'closed' });
registerPuzzleView(sayChain, SayChainView, { help: 'closed' });
registerPuzzleView(sayChoice, SayChoiceView, { help: 'closed' });
registerPuzzleView(question, QuestionView, { help: 'closed' });
registerPuzzleView(rebuild, RebuildView, { help: 'closed' });
registerPuzzleView(comicOrder, ComicOrderView, { help: 'closed' });
registerPuzzleView(catapult, CatapultView, { help: 'closed' });
registerPuzzleView(vraiFaux, VraiFauxView, { help: 'closed' });
registerPuzzleView(memory, MemoryView, { help: 'closed' });
registerPuzzleView(placeWords, PlaceWordsView, { help: 'none' });
registerPuzzleView(nextLine, NextLineView, { help: 'closed' });
registerPuzzleView(lineMeaning, LineMeaningView, { help: 'closed' });
