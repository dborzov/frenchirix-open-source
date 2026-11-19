// The results show the XP of the whole practice: what its progress saves credited as the puzzles
// finished (`creditedXp`) plus what the completion credited (`rewards.xp`).
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PracticeCompleteResponse } from '../../../shared/api';
import { setLanguage } from '../../../shared/i18n';
import { fx } from '../fx';
import { Results } from './Results';

const result = {
  level: 1,
  replay: false,
  stars: 3,
  rewards: { xp: 22, sesterces: 8 },
  creditedXp: 58,
  quest: null,
  chest: null,
  levels: [],
  replayed: [],
  achievements: [],
  achievementRewards: {},
  streak: { count: 1, extended: true, freezesUsed: 0, reset: false, full: false },
  rankUp: null,
  patch: {},
} as PracticeCompleteResponse;

describe('results', () => {
  beforeEach(() => {
    setLanguage('en');
    vi.useFakeTimers();
    vi.spyOn(fx, 'reducedMotion').mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('counts the XP of the whole practice, the puzzles saved earlier too', async () => {
    const r = render(<Results scenes={new Map()} outcomes={[]} result={result} level={1} replay={false} onContinue={() => {}} />);
    await act(async () => void vi.advanceTimersByTime(3000));
    expect(r.container.querySelector('[data-xp]')?.textContent).toContain('+80');
    expect(r.container.textContent).toContain('80 XP');
  });

  it('without creditedXp (an older server, the fixtures), what the completion credited', async () => {
    const r = render(<Results scenes={new Map()} outcomes={[]} result={{ ...result, creditedXp: undefined }} level={1} replay={false} onContinue={() => {}} />);
    await act(async () => void vi.advanceTimersByTime(3000));
    expect(r.container.querySelector('[data-xp]')?.textContent).toContain('+22');
  });
});
