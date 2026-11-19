// Plays practices through the real interface for the journey and puzzle type specs, the way a kid would:
// it taps the puzzle type's buttons, never dispatches actions.
//
// How it knows the right move: a development build of the client exposes the running puzzle on
// `window.__frxPractice` (PracticeRunner's PuzzleHost, dev builds only): the puzzle, its state, `solve()`
// (the puzzle type's own perfect next action) and `wrong()` (the puzzle type's `wrongAction`, a mistake a kid
// could make). `tapsFor` turns such an action into the element a kid taps, found by the stable
// `data-` attributes the views carry (data-choice, data-fr/data-en, data-word, data-tile, ...).
// After each tap it waits for the puzzle's state to change, and taps again if an animation swallowed it.
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------------------------------
// Guard: no uncaught page errors, no failed requests other than the ones a test provokes.

export interface Guard {
  problems: string[];
  consoleErrors: string[];
  /** Responses or failures whose URL matches are expected from now on (e.g. a provoked 503). */
  allow(re: RegExp): void;
  /** Fails the test when an unexpected problem was seen; clears the list. */
  check(where: string): void;
}

/**
 * Waits until the screen has settled, instead of a fixed pause: the fonts in, the images on screen
 * loaded, every animation that ends (entrances, slam-ins, pops) ended; looping ones never end and are
 * left out. For screenshots and measurements.
 */
export async function settled(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    () =>
      document.fonts.status === 'loaded' &&
      [...document.images].every((i) => i.complete || i.getBoundingClientRect().top > innerHeight) &&
      document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
    undefined,
    { timeout },
  );
}

/** Requests that are never a problem: aborted media/data loads when a screen is left mid-load. */
const BENIGN_FAIL = /net::ERR_ABORTED|NS_BINDING_ABORTED/;

export function guard(page: Page): Guard {
  const allowed: RegExp[] = [];
  const g: Guard = {
    problems: [],
    consoleErrors: [],
    allow: (re) => void allowed.push(re),
    check(where) {
      const list = g.problems.splice(0);
      expect(list, `page errors or failed requests (${where})`).toEqual([]);
    },
  };
  const ok = (url: string) => allowed.some((re) => re.test(url));
  page.on('pageerror', (e) => g.problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') g.consoleErrors.push(m.text());
  });
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? '';
    if (BENIGN_FAIL.test(f) || ok(r.url())) return;
    g.problems.push(`requestfailed ${r.method()} ${r.url()} ${f}`);
  });
  page.on('response', (r) => {
    if (r.status() < 400 || ok(r.url())) return;
    g.problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return g;
}

// ---------------------------------------------------------------------------------------------------
// The running puzzle.

export interface PuzzleInfo {
  puzzleId: string;
  type: string;
  done: boolean;
  mistakes: number;
  state: string;
  solve: any;
  wrong: any;
  puzzle: any;
}

export async function puzzleInfo(page: Page): Promise<PuzzleInfo | null> {
  // A null on a lost execution context (the page navigated): callers poll again.
  return page.evaluate(() => {
    const l = (window as any).__frxPractice;
    const root = document.querySelector('[data-puzzle]');
    if (!l || !root || root.getAttribute('data-puzzle') !== l.puzzleId) return null;
    return { puzzleId: l.puzzleId, type: l.type, done: l.done, mistakes: l.mistakes, state: JSON.stringify(l.state), solve: l.solve(), wrong: l.wrong(), puzzle: l.puzzle };
  }).catch(() => null);
}

/** Waits for the practice shell to show a puzzle (or the results); returns the puzzle or null at the results. */
export async function currentPuzzle(page: Page, timeout = 20_000): Promise<PuzzleInfo | null> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.locator('[data-results]').isVisible()) return null;
    const i = await puzzleInfo(page);
    if (i) return i;
    await page.waitForTimeout(100);
  }
  throw new Error('no puzzle and no results on screen');
}

export async function audioState(page: Page): Promise<{ src: string | null; playing: boolean; loop: boolean; tag: string | null; unlocked: boolean; loading: boolean; muted: boolean; overlay?: string | null }> {
  return page.evaluate(() => (window as any).__frxAudio.getState());
}

// ---------------------------------------------------------------------------------------------------
// Actions to taps.

type Tap = { sel: string; part?: string };

/** The elements to tap, in order, for a puzzle type action. */
export function tapsFor(type: string, action: any, puzzle: any): Tap[] {
  switch (type) {
    case 'listen-pick':
      return [{ sel: `[data-choice="${action.index}"]` }];
    case 'catapult':
      return [{ sel: `[data-choice="${action.index}"]` }];
    case 'match':
      return [{ sel: `[data-fr="${action.fr}"]` }, { sel: `[data-en="${action.en}"]` }];
    case 'fill-blanks': {
      const unit = puzzle.blanks[action.blank].unitId as string;
      return [{ sel: `[data-fill] [data-unit="${unit}"]` }, { sel: `[data-word="${action.word}"]` }];
    }
    case 'question':
      // Choose, then confirm: a tap on the card chooses the answer (and plays it), « C'est ça ! » submits it.
      return [{ sel: `li[data-answer="${action.answer}"]` }, { sel: '[data-confirm]' }];
    case 'vrai-faux':
      return [{ sel: `[data-answer="${action.says}"]` }];
    case 'rebuild':
      return [{ sel: `[data-tile="${action.tile}"]` }];
    case 'comic-order':
      return [{ sel: `[data-card="${action.lineId}"]` }];
    case 'memory':
      return [{ sel: `[data-card="${action.card}"]` }];
    case 'place-words':
      return [{ sel: `[data-piece="${action.piece}"]` }, { sel: `[data-gap="${action.gap}"]` }];
    case 'next-line':
      return [{ sel: `[data-choice="${action.lineId}"]` }];
    case 'line-meaning':
      return [{ sel: `[data-speaker="${action.lineId}"]` }, { sel: `[data-meaning="${action.meaning}"]` }];
    default:
      throw new Error(`no taps for ${type} ${JSON.stringify(action)}`);
  }
}

async function tapEl(page: Page, loc: Locator): Promise<void> {
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
  try {
    await loc.tap({ timeout: 3000 });
  } catch {
    // Pulsing elements (a looping box) never become "stable": tap where it is.
    await loc.tap({ force: true, timeout: 3000 });
  }
}

/** Performs one action by tapping, then waits for the state to change. Retries a swallowed tap. */
async function act(page: Page, before: PuzzleInfo, action: any): Promise<PuzzleInfo | null> {
  const pane = page.locator('[data-puzzle-pane]');
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      for (const t of tapsFor(before.type, action, before.puzzle)) {
        let loc = pane.locator(t.sel).first();
        if (t.part) loc = loc.locator(t.part).first();
        await tapEl(page, loc);
      }
    } catch (e) {
      // The element re-rendered under the tap (a new round slamming in): look again and retry.
      lastError = e;
    }
    const end = Date.now() + 2500;
    while (Date.now() < end) {
      const now = await puzzleInfo(page);
      if (!now || now.puzzleId !== before.puzzleId || now.state !== before.state) return now;
      await page.waitForTimeout(60);
    }
  }
  throw new Error(`${before.type}: tapping for ${JSON.stringify(action)} changed nothing (state ${before.state})${lastError ? `; last error: ${String(lastError).split('\n')[0]}` : ''}`);
}

// ---------------------------------------------------------------------------------------------------
// Speaking.

/**
 * How a speaking round is played. 'cant' starts recording, then presses "Je ne peux pas parler" in
 * the middle of the take; 'denied-cant' presses it on the denied-microphone screen. Both replace the
 * round with its tapping equivalent (puzzle.alt), which playPuzzle then plays.
 */
/** A take that is surely a miss: hesitations only count as nothing heard (no judge, no lenient rule). */
const MISS = 'euh euh euh';

export type SpeakPlan = 'pass' | 'fail-pass' | 'fail3' | 'unavailable' | 'denied-skip' | 'denied-cant' | 'cant' | 'judge';

export interface Kid {
  ctx: BrowserContext;
  page: Page;
  headers: Record<string, string>;
}

/** Sets (or clears, with undefined) one extra header on every request of the kid's context. */
export async function setHeader(kid: Kid, name: string, value: string | undefined): Promise<void> {
  if (value === undefined) delete kid.headers[name];
  else kid.headers[name] = value;
  await kid.ctx.setExtraHTTPHeaders(kid.headers);
}

/**
 * Gets the microphone recording: taps the record button unless the puzzle already opened it by itself
 * (act-line's "à toi !"), and accepts the first-time explanation when it shows.
 */
async function ensureRecording(kid: Kid): Promise<void> {
  const { page } = kid;
  const pane = page.locator('[data-puzzle-pane]');
  const rec = pane.locator('[data-record]');
  await expect(rec).toBeVisible({ timeout: 20_000 });
  const intro = pane.locator('[data-mic-ok]');
  const recording = pane.locator('[data-record="recording"]');
  // act-line opens the microphone by itself a moment after its cue: give it that moment.
  await expect(intro.or(recording).first()).toBeVisible({ timeout: 2500 }).catch(() => {});
  if (!(await recording.isVisible()) && !(await intro.isVisible())) await tapEl(page, rec);
  // The first time ever, a kind explanation comes before the microphone: whichever shows first.
  await expect(intro.or(recording).first()).toBeVisible({ timeout: 10_000 });
  if (await intro.isVisible()) await tapEl(page, intro);
  await expect(recording).toBeVisible({ timeout: 10_000 });
}

async function recordOnce(kid: Kid): Promise<void> {
  const { page } = kid;
  const pane = page.locator('[data-puzzle-pane]');
  await ensureRecording(kid);
  await page.waitForTimeout(1600); // the fake microphone beeps; a kid speaks
  const stop = pane.locator('[data-record="recording"]');
  if (await stop.isVisible()) await tapEl(page, stop);
}

/** Plays a speaking puzzle with one target (say-line, say-hidden, act-line) with the given plan; leaves it done. */
export async function playSpeak(kid: Kid, info: PuzzleInfo, plan: SpeakPlan): Promise<void> {
  const { page } = kid;
  const pane = page.locator('[data-puzzle-pane]');
  const text: string = info.type === 'say-hidden' ? info.puzzle.fr : info.puzzle.text;
  const note = pane.locator('[data-speak-note]');
  const say = async (transcript: string | undefined) => {
    await setHeader(kid, 'x-test-transcript', transcript === undefined ? undefined : encodeURIComponent(transcript));
    await recordOnce(kid);
  };
  if (plan === 'pass') {
    await say(text);
    await expect(note).toHaveAttribute('data-speak-note', 'passed', { timeout: 15_000 });
  } else if (plan === 'judge') {
    // The scorer does not pass it; the judge (its answer given by x-test-judge) says it was an attempt.
    await setHeader(kid, 'x-test-judge', '{"attempt": true, "candidate": 0}');
    await say('blablabla quelque chose');
    await expect(note).toHaveAttribute('data-speak-note', 'passed', { timeout: 15_000 });
    await setHeader(kid, 'x-test-judge', undefined);
  } else if (plan === 'fail-pass') {
    await say(MISS);
    await expect(note).toHaveAttribute('data-speak-note', 'failed', { timeout: 15_000 });
    await say(text);
    await expect(note).toHaveAttribute('data-speak-note', 'passed', { timeout: 15_000 });
  } else if (plan === 'fail3') {
    // Two failed tries show what was heard; the third always passes, whatever was heard.
    for (let i = 0; i < 2; i++) {
      await say(MISS);
      await expect(note).toHaveAttribute('data-speak-note', 'failed', { timeout: 15_000 });
      await expect(pane.locator('[data-heard]')).toBeVisible();
    }
    await say(MISS);
    await expect(note).toHaveAttribute('data-speak-note', 'passed', { timeout: 15_000 });
  } else if (plan === 'unavailable') {
    await say(undefined); // no test transcript: the local worker has no Workers AI, so 503
    const back = pane.locator('[data-listen-back]');
    await expect(back).toBeVisible({ timeout: 15_000 });
    const me = pane.locator('[data-speak-me]');
    await expect(me).toBeEnabled();
    await tapEl(page, me);
  } else if (plan === 'cant') {
    // The button is there before the microphone, and while recording.
    await expect(pane.locator('[data-cant-speak]')).toBeVisible({ timeout: 20_000 });
    await ensureRecording(kid);
    await tapEl(page, pane.locator('[data-cant-speak]'));
  } else {
    const rec = pane.locator('[data-record]');
    await tapEl(page, rec);
    const intro = pane.locator('[data-mic-ok]');
    await expect(intro.or(pane.locator('[data-mic-denied]')).first()).toBeVisible({ timeout: 10_000 });
    if (await intro.isVisible()) await tapEl(page, intro);
    await expect(pane.locator('[data-mic-denied]')).toBeVisible({ timeout: 10_000 });
    if (plan === 'denied-skip') await tapEl(page, pane.locator('[data-mic-skip]'));
    else await tapEl(page, pane.locator('[data-cant-speak]'));
  }
  await setHeader(kid, 'x-test-transcript', undefined);
}

/**
 * say-chain, hands-free: one tap starts it; then the test transcript follows the item on screen (the
 * worker in TEST_MODE scores the header), and nothing else is tapped until the chain ends.
 */
export async function playChain(kid: Kid, info: PuzzleInfo): Promise<void> {
  const { page } = kid;
  const pane = page.locator('[data-puzzle-pane]');
  const items = info.puzzle.items as { fr: string }[];
  await setHeader(kid, 'x-test-transcript', encodeURIComponent(items[0]!.fr));
  await tapEl(page, pane.locator('[data-chain-start]'));
  const intro = pane.locator('[data-mic-ok]');
  let seen = -1;
  const end = Date.now() + 25_000 * items.length;
  const dbg = process.env.E2E_DEBUG_CHAIN ? setInterval(() => void page.evaluate(() => { const l = (window as any).__frxPractice; return l ? `${l.done} ${JSON.stringify(l.state).slice(0, 160)} ${document.querySelector('[data-chain-status]')?.getAttribute('data-chain-status')} rec=${document.querySelector('[data-record]')?.getAttribute('data-record')} audio=${JSON.stringify((window as any).__frxAudio?.getState())} pos=${(window as any).__frxAudio?.getPositionMs()}` : 'none'; }).then((x) => console.log('[chain]', x), () => {}), 4000) : null;
  if (process.env.E2E_DEBUG_CHAIN) page.on('response', (r) => { if (r.url().includes('/api/speech')) console.log('[chain] speech', r.status()); });
  while (Date.now() < end) {
    if (await intro.isVisible().catch(() => false)) await tapEl(page, intro);
    const now = await puzzleInfo(page);
    if (now?.done) break;
    if (!now) {
      // The puzzle root re-rendering for a moment: read again.
      await page.waitForTimeout(100);
      continue;
    }
    const index = JSON.parse(now.state).index as number;
    if (index !== seen && items[index]) {
      seen = index;
      await setHeader(kid, 'x-test-transcript', encodeURIComponent(items[index]!.fr));
    }
    await page.waitForTimeout(100);
  }
  if (dbg) clearInterval(dbg);
  await setHeader(kid, 'x-test-transcript', undefined);
}

/** say-choice: says one of the funny alternates (the server's choice scoring picks it). */
export async function playChoice(kid: Kid, info: PuzzleInfo): Promise<void> {
  const option = (info.puzzle.options as { k: number; fr: string }[]).find((o) => o.k === 1) ?? info.puzzle.options[0];
  await setHeader(kid, 'x-test-transcript', encodeURIComponent(option.fr));
  await recordOnce(kid);
  // Done, or already moved on to the next puzzle.
  await expect.poll(async () => { const now = await puzzleInfo(kid.page); return !!now && (now.done || now.puzzleId !== info.puzzleId); }, { timeout: 20_000 }).toBe(true);
  await setHeader(kid, 'x-test-transcript', undefined);
}

// ---------------------------------------------------------------------------------------------------
// A whole puzzle, a whole practice.

export interface PlayOpts {
  /** Wrong moves to make before playing right (when the puzzle type has one to make). */
  wrongFirst?: number;
  speak?: SpeakPlan;
  /** Called once the puzzle is on screen, before any move (screenshots, audio checks). */
  onStart?: (info: PuzzleInfo) => Promise<void>;
  /** Called when the puzzle is done, before continuing (screenshots of the reward moment). */
  onDone?: (info: PuzzleInfo) => Promise<void>;
  /** Leave the puzzle done with its continue bar showing, without tapping it (its save may be held). */
  leaveDone?: boolean;
}

export interface Played {
  type: string;
  /** The speaking puzzle type this round replaced (the kid pressed "Je ne peux pas parler"). */
  replaced?: string;
  puzzleId: string;
  wrongMade: number;
  mistakes: number;
}

/** Plays the puzzle on screen to its end and taps continue. */
export async function playPuzzle(kid: Kid, opts: PlayOpts = {}): Promise<Played> {
  const { page } = kid;
  let info = await currentPuzzle(page);
  if (!info) throw new Error('no puzzle to play');
  const first = info;
  await opts.onStart?.(info);
  let wrongMade = 0;
  if (info.type === 'watch') {
    await expect.poll(async () => (await puzzleInfo(page))?.done ?? true, { timeout: 120_000, intervals: [250] }).toBe(true);
  } else if (info.type === 'say-chain' && (opts.speak ?? 'pass') === 'pass') {
    await playChain(kid, info);
  } else if (info.type === 'say-choice' && (opts.speak ?? 'pass') === 'pass') {
    try {
      await playChoice(kid, info);
    } catch (e) {
      // Open issue (see docs/app-dev.md): under the full suite's load the page has navigated during
      // a say-choice round. The practice comes back at its saved puzzle: play the round once more.
      console.log(`[drive] say-choice: ${String(e).split('\n')[0]}; playing the round again`);
      const again = await currentPuzzle(page, 30_000);
      if (again && again.type === 'say-choice' && !again.done) await playChoice(kid, again);
    }
  } else if (['say-line', 'say-hidden', 'act-line', 'say-chain', 'say-choice'].includes(info.type)) {
    const plan = opts.speak ?? 'pass';
    await playSpeak(kid, info, plan);
    if (plan === 'cant' || plan === 'denied-cant') {
      // The round is replaced in place by its tapping equivalent on the same French: play that.
      await expect.poll(async () => ((await puzzleInfo(page))?.puzzleId ?? '').startsWith(`${first.puzzleId}~`), { timeout: 10_000 }).toBe(true);
      const alt = await playPuzzle(kid, { ...opts, speak: undefined });
      return { ...alt, replaced: first.type };
    }
  } else {
    for (let i = 0; i < (opts.wrongFirst ?? 0); i++) {
      if (!info.wrong) break;
      const before = info.mistakes;
      info = (await act(page, info, info.wrong))!;
      expect(info, `${first.type}: a wrong move ended the puzzle`).not.toBeNull();
      expect(info.done, `${first.type}: a wrong move finished the round`).toBe(false);
      expect(info.mistakes, `${first.type}: a wrong move did not count a mistake`).toBeGreaterThan(before);
      wrongMade++;
    }
    for (let step = 0; step < 200 && info && !info.done && info.puzzleId === first.puzzleId; step++) {
      // A null read is the puzzle root re-rendering for a moment: read it again.
      info = (await act(page, info, info.solve)) ?? (await currentPuzzle(page));
    }
  }
  const after = await puzzleInfo(page);
  if (after && after.puzzleId !== first.puzzleId) return { type: first.type, puzzleId: first.puzzleId, wrongMade, mistakes: 0 }; // the round already moved on
  const last = after ?? info;
  expect(last?.done, `${first.type}: did not finish`).toBe(true);
  const bar = page.locator('[data-continue]');
  await expect(bar).toBeVisible({ timeout: 10_000 });
  await opts.onDone?.(last!);
  if (opts.leaveDone) return { type: first.type, puzzleId: first.puzzleId, wrongMade, mistakes: last?.mistakes ?? 0 };
  await tapEl(page, bar.locator('[data-next]'));
  // On to the next puzzle or the results.
  await expect.poll(async () => (await page.locator('[data-results]').isVisible()) || ((await puzzleInfo(page))?.puzzleId ?? first.puzzleId) !== first.puzzleId, { timeout: 15_000 }).toBe(true);
  return { type: first.type, puzzleId: first.puzzleId, wrongMade, mistakes: last?.mistakes ?? 0 };
}

/** Plays every puzzle of the practice on screen; wrong moves first in the first round of each puzzle type. */
export async function playPractice(kid: Kid, opts: { wrongFirstPerType?: boolean; speak?: SpeakPlan; seen?: Set<string> } = {}): Promise<Played[]> {
  const played: Played[] = [];
  const seen = opts.seen ?? new Set<string>();
  for (let i = 0; i < 60; i++) { // a practice has at most 50 puzzles (PRACTICE_MAX)
    const info = await currentPuzzle(kid.page);
    if (!info) break;
    const fresh = !seen.has(info.type);
    seen.add(info.type);
    played.push(await playPuzzle(kid, { wrongFirst: opts.wrongFirstPerType && fresh ? 2 : 0, speak: opts.speak ?? 'pass' }));
  }
  await expect(kid.page.locator('[data-results]')).toBeVisible();
  return played;
}

// ---------------------------------------------------------------------------------------------------
// The hint bubble's four rules and the playback bar's seek (docs/app-games.md, "The hint bubble").

const bubbleShown = (page: Page) => page.evaluate(() => {
  const root = document.querySelector('[data-hint-layer]') as HTMLElement | null;
  return !!root && !root.hidden && (root.querySelector('[data-bubble]')?.textContent ?? '').trim().length > 0;
});

/**
 * Taps a French box and checks the bubble: 1. it shows the translation only, never the French;
 * 2. its tail points at the tapped box; 3. tapping the bubble hides it; 4. any other tap hides it.
 * `elsewhere` is a neutral element to tap for rule 4.
 */
export async function checkHintRules(page: Page, box: Locator, elsewhere: Locator, where: string): Promise<void> {
  await box.scrollIntoViewIfNeeded();
  const fr = ((await box.textContent()) ?? '').trim();
  await box.tap({ force: true });
  await expect.poll(() => bubbleShown(page), { timeout: 4000, message: `${where}: a tapped box shows a bubble` }).toBe(true);
  await page.waitForTimeout(150); // placed on the next frame
  const info = await page.evaluate(() => {
    const root = document.querySelector('[data-hint-layer]') as HTMLElement;
    return { text: (root.querySelector('[data-bubble]')?.textContent ?? '').trim(), tipX: Number(root.dataset.tipX), tipY: Number(root.dataset.tipY) };
  });
  const r = (await box.boundingBox())!;
  // Rule 1: the translation only (a name the same in both languages is allowed to be the same).
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').trim();
  if (norm(fr) && norm(info.text) !== norm(fr)) expect(norm(info.text), `${where}: the bubble shows the French "${fr}"`).not.toContain(norm(fr));
  // Rule 2: the tail's tip on the box's top or bottom edge, within its width.
  expect(info.tipX, `${where}: the tail points at the box (x)`).toBeGreaterThanOrEqual(r.x - 3);
  expect(info.tipX, `${where}: the tail points at the box (x)`).toBeLessThanOrEqual(r.x + r.width + 3);
  expect(Math.min(Math.abs(info.tipY - r.y), Math.abs(info.tipY - (r.y + r.height))), `${where}: the tail touches the box (y)`).toBeLessThanOrEqual(8);
  // Rule 3: tapping the bubble hides it (the bubble takes its own tap; nothing beneath is pressed).
  // Checked as "this box's bubble is gone", whatever shows next.
  const same = () => page.evaluate((was) => {
    const root = document.querySelector('[data-hint-layer]') as HTMLElement | null;
    if (!root || root.hidden) return false;
    return (root.querySelector('[data-bubble]')?.textContent ?? '').trim() === was.text && Number(root.dataset.tipX) === was.tipX && Number(root.dataset.tipY) === was.tipY;
  }, info);
  await page.locator('[data-hint-layer] [data-bubble]').tap({ force: true });
  await expect.poll(same, { timeout: 3000, message: `${where}: tapping the bubble hides it` }).toBe(false);
  if (await bubbleShown(page)) await elsewhere.tap({ force: true, position: { x: 4, y: 4 } });
  await expect.poll(() => bubbleShown(page), { timeout: 3000 }).toBe(false);
  // Rule 4: any other tap hides it.
  await box.tap({ force: true });
  await expect.poll(() => bubbleShown(page), { timeout: 4000 }).toBe(true);
  await elsewhere.tap({ force: true, position: { x: 4, y: 4 } });
  await expect.poll(() => bubbleShown(page), { timeout: 3000, message: `${where}: another tap hides it` }).toBe(false);
}

/** Taps the playback bar at 70 % of its width: the playhead moves there and the scene plays from there. */
export async function checkSeek(page: Page, bar: Locator, where: string): Promise<void> {
  await bar.scrollIntoViewIfNeeded();
  const b = (await bar.boundingBox())!;
  await bar.tap({ position: { x: b.width * 0.7, y: b.height / 2 } });
  const handle = await bar.elementHandle();
  const at = () => page.evaluate((el) => parseFloat((el?.querySelector('[data-playhead]') as HTMLElement | null)?.style.left ?? '-1'), handle);
  await expect.poll(at, { timeout: 4000, message: `${where}: the playhead jumps to the tap` }).toBeGreaterThan(60);
  expect(await at(), `${where}: the playhead stays near the tap`).toBeLessThan(90);
  await expect.poll(async () => (await audioState(page)).playing, { timeout: 4000, message: `${where}: the scene plays from there` }).toBe(true);
}
