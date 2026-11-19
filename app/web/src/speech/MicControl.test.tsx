// MicControl pauses by itself: a dialog over the puzzle (« Une pause ? », the report form), the help
// strip opening, or the page hidden; so the microphone never listens, nor a hands-free chain goes on,
// behind them. With the microphone off, nothing.
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicControl } from './MicControl';
import type { RecorderStatus, UseRecorder } from './useRecorder';

const rec = (status: RecorderStatus): UseRecorder => ({
  status,
  clock: status === 'recording' ? { id: 1, limitMs: 10_000, startedAt: performance.now() } : null,
  unheard: 0,
  onLevel: () => () => {},
  record: () => {},
  acceptIntro: () => {},
  stop: () => {},
  pause: () => {},
  reset: () => {},
});

function openDialog(): HTMLElement {
  const d = document.createElement('div');
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-modal', 'true');
  document.body.appendChild(d);
  return d;
}

afterEach(() => {
  document.body.querySelectorAll('[aria-modal]').forEach((d) => d.remove());
});

describe('MicControl under a dialog', () => {
  it('pauses when a dialog opens while it listens', async () => {
    const onPause = vi.fn();
    render(<MicControl rec={rec('recording')} onStart={() => {}} onPause={onPause} />);
    expect(onPause).not.toHaveBeenCalled();
    await act(async () => void openDialog());
    expect(onPause).toHaveBeenCalled();
  });

  it('pauses at once when the microphone opens under a dialog already open (act-line opens it by itself)', () => {
    openDialog();
    const onPause = vi.fn();
    render(<MicControl rec={rec('opening')} onStart={() => {}} onPause={onPause} />);
    expect(onPause).toHaveBeenCalled();
  });

  it('a hands-free chain pauses at every running step, the model playing included', async () => {
    const onPause = vi.fn();
    render(<MicControl rec={rec('idle')} waiting pauseWhen="running" onStart={() => {}} onPause={onPause} />);
    await act(async () => void openDialog());
    expect(onPause).toHaveBeenCalled();
  });

  it('pauses when the help strip opens during a take, not when it was open before', async () => {
    const help = document.createElement('div');
    help.setAttribute('data-help', 'open');
    document.body.appendChild(help);
    const onPause = vi.fn();
    render(<MicControl rec={rec('recording')} onStart={() => {}} onPause={onPause} />);
    expect(onPause).not.toHaveBeenCalled(); // a kid may speak with the help open
    await act(async () => help.setAttribute('data-help', 'closed'));
    await act(async () => help.setAttribute('data-help', 'open'));
    expect(onPause).toHaveBeenCalledTimes(1);
    help.remove();
  });

  it('pauses when the page is hidden (the take is dropped, no try spent)', () => {
    const onPause = vi.fn();
    render(<MicControl rec={rec('recording')} onStart={() => {}} onPause={onPause} />);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    expect(onPause).toHaveBeenCalled();
  });

  it('does nothing while the microphone is off', async () => {
    const onPause = vi.fn();
    render(<MicControl rec={rec('idle')} onStart={() => {}} onPause={onPause} />);
    await act(async () => void openDialog());
    expect(onPause).not.toHaveBeenCalled();
  });
});
