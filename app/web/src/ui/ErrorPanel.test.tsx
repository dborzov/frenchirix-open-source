// The error panel (the kid's message, « Réessayer », the admin's line with a copy button) and the error
// boundary (catches a crash, logs it, shows the fallback, clears it when its key changes).
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../../shared/i18n';
import { ApiRequestError } from '../api/errors';
import { ErrorBoundary } from './ErrorBoundary';
import { ErrorPanel } from './ErrorPanel';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLanguage('fr');
});

describe('the error panel', () => {
  it('shows the kid’s message, « Réessayer », and the detail line, which copies', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const onRetry = vi.fn();
    const e = new ApiRequestError(500, 'internal', 'boom', undefined, { method: 'POST', path: '/api/practices/p1/progress' });
    const { container, getByText } = render(<ErrorPanel error={e} onRetry={onRetry} />);
    const panel = container.querySelector('[data-error-panel]')!;
    expect(panel.getAttribute('data-error-kind')).toBe('server');
    expect(panel.getAttribute('role')).toBe('alert');
    expect(getByText(/Le serveur a trébuché/)).toBeTruthy();
    const detail = container.querySelector('[data-error-detail]')!.textContent!;
    expect(detail).toMatch(/^FRX-ERR server 500 POST \/api\/practices\/p1\/progress code=internal/);
    act(() => container.querySelector<HTMLButtonElement>('[data-error-retry]')!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-error-copy]')!.click());
    expect(writeText).toHaveBeenCalledWith(detail);
    expect(container.querySelector('[data-error-copy]')!.textContent).toMatch(/Copié/);
  });

  it('without a retry, shows no button; in English it speaks English; the bar variant has no burst', () => {
    setLanguage('en');
    const { container } = render(<ErrorPanel error={new ApiRequestError(0, 'offline')} variant="bar" />);
    expect(container.querySelector('[data-error-retry]')).toBeNull();
    expect(container.textContent).toMatch(/No internet/);
    expect(container.querySelector('[data-error-panel]')!.getAttribute('data-error-panel')).toBe('bar');
    expect(container.textContent).not.toMatch(/OOPS/);
  });
});

function Boom({ when }: { when: boolean }) {
  if (when) throw new TypeError('the view broke');
  return <p data-ok>fine</p>;
}

describe('the error boundary', () => {
  it('catches a crash, logs it with console.error, shows the fallback, and clears it when its key changes', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = (key: string, when: boolean) => (
      <ErrorBoundary resetKey={key} where="/practice/x" fallback={(e) => <ErrorPanel error={e} where="/practice/x" message="Ce défi s’est bloqué." />}>
        <Boom when={when} />
      </ErrorBoundary>
    );
    const { container, rerender } = render(view('a', true));
    expect(container.querySelector('[data-error-panel]')!.getAttribute('data-error-kind')).toBe('crash');
    expect(container.querySelector('[data-error-detail]')!.textContent).toMatch(/^FRX-ERR crash \/practice\/x "TypeError: the view broke"/);
    expect(logged.mock.calls.some((c) => String(c[0]).startsWith('[frx] crash FRX-ERR crash /practice/x'))).toBe(true);
    rerender(view('a', false));
    expect(container.querySelector('[data-error-panel]')).not.toBeNull(); // same key: still the fallback
    rerender(view('b', false));
    expect(container.querySelector('[data-ok]')).not.toBeNull();
  });

  it('« Réessayer » can reset it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let broken = true;
    function Flaky() {
      if (broken) throw new Error('once');
      return <p data-ok>back</p>;
    }
    const { container } = render(
      <ErrorBoundary fallback={(e, reset) => <ErrorPanel error={e} onRetry={reset} />}>
        <Flaky />
      </ErrorBoundary>,
    );
    broken = false;
    act(() => container.querySelector<HTMLButtonElement>('[data-error-retry]')!.click());
    expect(container.querySelector('[data-ok]')).not.toBeNull();
  });
});
