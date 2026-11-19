import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_PLAYER } from '../../../shared/fixtures';
import { getLanguage } from '../../../shared/i18n';
import { usePlayer } from './player';

beforeEach(() => usePlayer.setState({ state: null, status: 'idle', error: null, language: 'fr' }));

describe('player store', () => {
  it('replaces and patches the state, following the language', () => {
    usePlayer.getState().replace(structuredClone(FIXTURE_PLAYER));
    usePlayer.getState().apply({ currencies: { sesterces: 1 }, profile: { language: 'en' } });
    const st = usePlayer.getState();
    expect(st.state?.currencies.sesterces).toBe(1);
    expect(st.state?.currencies.xp).toBe(FIXTURE_PLAYER.currencies.xp);
    expect(st.language).toBe('en');
    expect(getLanguage()).toBe('en');
  });

  it('ignores a patch before boot', () => {
    usePlayer.getState().apply({ currencies: { sesterces: 1 } });
    expect(usePlayer.getState().state).toBeNull();
  });
});
