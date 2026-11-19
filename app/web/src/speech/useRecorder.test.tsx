// useRecorder with the scripted fake recorder (web/src/testing/fakes.ts): Pause while the microphone
// opens is no error; takes with no voice are counted in a row, UNHEARD_LIMIT of them make the 'deaf'
// notice, and a take with a voice or reset() clears the count.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../audio';
import { fixedScript, setScript, type FixedOutcomes } from '../testing/fakes';
import type { Take } from './recorder';
import { UNHEARD_LIMIT, useRecorder } from './useRecorder';

vi.mock('./recorder', async (orig) => {
  const actual = await orig<typeof import('./recorder')>();
  const f = await import('../testing/fakes');
  return { ...actual, MicRecorder: f.createFakeRecorder(actual.MicError), micSupported: f.micSupported };
});
vi.mock('../log', () => ({ log: () => {}, puzzleWhere: () => null }));
vi.mock('../audio/engine', async (orig) => {
  const actual = await orig<typeof import('../audio/engine')>();
  return { ...actual, Engine: (await import('../testing/fakes')).createFakeEngine(actual.AudioLoadError) };
});

function setup(o: FixedOutcomes) {
  setScript(fixedScript(1, o), new Map());
  const takes: Take[] = [];
  const hook = renderHook(() => useRecorder((t) => takes.push(t)));
  return { hook, takes };
}
const flush = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  localStorage.setItem('frx.mic.intro', '1');
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('useRecorder', () => {
  it('Pause while the microphone opens: back to idle, no error, no take', async () => {
    const { hook, takes } = setup({});
    act(() => hook.result.current.record(5000));
    expect(hook.result.current.status).toBe('opening');
    act(() => hook.result.current.pause());
    await flush(500);
    expect(hook.result.current.status).toBe('idle');
    expect(takes).toHaveLength(0);
  });

  it('Pause while listening drops the take; the clock is set only while recording', async () => {
    const { hook, takes } = setup({ take: 'silent' });
    act(() => hook.result.current.record(5000));
    await flush(200);
    expect(hook.result.current.status).toBe('recording');
    expect(hook.result.current.clock?.limitMs).toBe(5000);
    act(() => hook.result.current.pause());
    await flush(6000);
    expect(hook.result.current.status).toBe('idle');
    expect(hook.result.current.clock).toBeNull();
    expect(takes).toHaveLength(0);
  });

  it(`counts takes with no voice in a row: ${UNHEARD_LIMIT} make the microphone 'deaf'; a retry gets one more take`, async () => {
    const { hook, takes } = setup({ take: 'silent' });
    for (let i = 1; i <= UNHEARD_LIMIT; i++) {
      act(() => hook.result.current.record(4000));
      await flush(4500);
      expect(hook.result.current.unheard).toBe(i);
    }
    expect(takes.every((t) => t.problem === 'silent')).toBe(true);
    expect(hook.result.current.status).toBe('deaf');
    // « Réessayer le micro »: one more take; nothing again, and the notice is back at once.
    act(() => hook.result.current.reset());
    expect(hook.result.current.status).toBe('idle');
    expect(hook.result.current.unheard).toBe(UNHEARD_LIMIT - 1);
    act(() => hook.result.current.record(4000));
    await flush(4500);
    expect(hook.result.current.status).toBe('deaf');
  });

  it('nothing plays while the microphone is open (a late replay would go into the take); afterwards it does', async () => {
    const { hook, takes } = setup({ take: 'voice', audio: 'end' });
    act(() => hook.result.current.record(5000));
    act(() => void audio.playRange('/a.m4a', 0, 2000, { loop: true, tag: 'while-opening' }));
    await flush(10);
    expect(audio.getState().playing).toBe(false);
    await flush(200);
    expect(hook.result.current.status).toBe('recording');
    act(() => void audio.playRange('/a.m4a', 0, 2000, { loop: true, tag: 'late-replay' }));
    await flush(10);
    expect(audio.getState().playing).toBe(false);
    await flush(5000);
    expect(takes).toHaveLength(1);
    expect(hook.result.current.status).toBe('idle');
    act(() => void audio.playRange('/a.m4a', 0, 2000, { loop: true, tag: 'after' }));
    await flush(10);
    expect(audio.getState()).toMatchObject({ playing: true, tag: 'after' });
    act(() => audio.stop());
  });

  it('a take with a voice clears the count', async () => {
    const { hook } = setup({ take: ['silent', 'voice'] });
    act(() => hook.result.current.record(4000));
    await flush(4500);
    expect(hook.result.current.unheard).toBe(1);
    act(() => hook.result.current.record(4000));
    await flush(2500);
    expect(hook.result.current.unheard).toBe(0);
    expect(hook.result.current.status).toBe('idle');
  });
});
