// The guard for the colour rule in docs/app-style.md: a panel, caption, card, tile or button never has
// the fill of the surface it sits on. On each screen and each puzzle type (fixture client), it looks for
// ink-outlined elements whose background equals the background under them, and fails with their
// selectors. Runs in every project (phone, tablet, upright iPad). The check itself is in contrast.ts.
import { expect, test, type Page } from '@playwright/test';
import { sameFillPanels } from './contrast';
import { settled } from './drive';

test.describe.configure({ timeout: 240_000 });

const SCREENS: [string, string, string?][] = [
  ['home', '/'],
  ['welcome', '/?welcome'],
  ['unlock', '/unlock'],
  ['home, a practice half done', '/?flow=mid'],
  ['home, every quest done', '/?flow=done'],
  ['home, after "Do more"', '/?flow=more'],
  ['unlock, choosing', '/unlock?flow=calm'],
  ['episodes timeline', '/episodes', 'timeline'],
  ['episodes by episode', '/episodes', 'episodes'],
  ['episodes review', '/episodes', 'review'],
  ['episode', '/episodes/s01e04'],
  ['scene', '/scene/s01e04-0016-0017'],
  ['chest', '/chest/c_fixture01'],
  ['profile', '/profile'],
  ['avatar', '/avatar'],
  ['shop', '/shop'],
  ['friends', '/friends'],
  ['league', '/league'],
  ['achievements', '/achievements'],
  ['karaoke', '/karaoke'],
  ['login', '/login'],
  ['players', '/players'],
  ['version', '/version'],
  ['gallery', '/dev/ui'],
];

const PUZZLE_TYPES = ['watch', 'listen-pick', 'match', 'fill-blanks', 'say-line', 'say-hidden', 'question', 'rebuild', 'comic-order', 'catapult', 'vrai-faux', 'memory', 'place-words', 'next-line', 'line-meaning', 'act-line', 'say-chain', 'say-choice'];
const MIC_PROTOTYPES = ['act-line', 'say-chain', 'say-choice'];

async function open(page: Page, path: string, mode?: string): Promise<void> {
  await page.goto('/version');
  await page.evaluate((m) => {
    try {
      localStorage.setItem('frenchirix.onb.welcome', '1');
      if (m) localStorage.setItem('frenchirix.episodes.mode', m);
    } catch {
      // no storage: defaults
    }
  }, mode ?? null);
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await settled(page);
}

test('screens: no panel has the fill of the surface under it', async ({ page }) => {
  const problems: string[] = [];
  for (const [name, path, mode] of SCREENS) {
    await open(page, path, mode);
    for (const f of await sameFillPanels(page)) problems.push(`${name}: ${f.selector} "${f.text}" (${f.fill})`);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

test('puzzle types: no panel has the fill of the surface under it', async ({ page }) => {
  const problems: string[] = [];
  for (const puzzleType of PUZZLE_TYPES) {
    // The microphone puzzles of the practice prototype need the Panono scene (say-choice: its alternates).
    const scene = MIC_PROTOTYPES.includes(puzzleType) ? 's01e03-0023-0026' : 's01e02-0074-0076'; // release scenes
    await open(page, `/dev/practice?scene=${scene}&type=${puzzleType}&level=3&seed=1`);
    for (const f of await sameFillPanels(page)) problems.push(`${puzzleType}: ${f.selector} "${f.text}" (${f.fill})`);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});
