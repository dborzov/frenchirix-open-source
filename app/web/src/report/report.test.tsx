// "Quelque chose ne va pas ?" (report/): the context taken when the flag is pressed (truncation, the puzzle
// pane's state), the form (send, « Merci ! », a failed send keeps the text and « Réessayer » sends again,
// Cancel), the button on the error panels, and the tip shown once.
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, translate } from '../../../shared/i18n';
import { ApiRequestError } from '../api/errors';
import { log, setLogSenderForTests, setPuzzleWhere } from '../log';
import { clearFlags, getFlag } from '../onboarding/storage';
import { ErrorPanel, setErrorReportSlot } from '../ui';
import { captureContext, clipJson, CONTEXT_MAX, EVENTS_KEPT, fitContext, paneState, STATE_MAX } from './context';
import { ErrorPanelReport, ReportButton, ReportTip } from './ReportButton';

const sendReport = vi.hoisted(() => vi.fn());
vi.mock('../api', async (orig) => {
  const actual = await orig<typeof import('../api')>();
  return { ...actual, api: { ...actual.api, report: sendReport }, loadIndex: async () => ({ version: 'content-v1' }) };
});
const recovered = vi.hoisted(() => vi.fn(() => true));
vi.mock('../state/recover', () => ({ recover: recovered }));
const toasts = vi.hoisted(() => vi.fn());
vi.mock('../ui/Toast', async (orig) => ({ ...(await orig<typeof import('../ui/Toast')>()), toast: toasts }));

beforeEach(() => {
  setLogSenderForTests(null);
  clearFlags();
  sendReport.mockReset();
  toasts.mockReset();
});
afterEach(() => {
  setErrorReportSlot(null);
  setLanguage('fr');
  document.body.innerHTML = '';
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });

describe('the context of a report', () => {
  it('cuts JSON to a length', () => {
    expect(clipJson({ a: 1 }, 100)).toBe('{"a":1}');
    expect(clipJson({ a: 'x'.repeat(50) }, 10)).toBe('{"a":"xxxx…');
  });

  it('reads the puzzle pane’s state attributes, its enabled controls and the marks around it', () => {
    document.body.innerHTML = `
      <div data-puzzle-pane><div data-step="back"><span data-speak="idle"></span><div data-listen-back></div>
        <button data-cant-speak>x</button><button data-pick disabled>r</button><button aria-label="Rejouer">▶</button></div></div>
      <div data-continue></div><div data-error-panel="bar" data-error-kind="server"></div>`;
    expect(paneState()).toEqual({ pane: 'listen-back speak=idle step=back', screen: ['continue-bar', 'error-panel=server'], controls: ['cant-speak', 'Rejouer'] });
    document.body.innerHTML = '';
    expect(paneState().pane).toBe('(no puzzle pane)');
  });

  it('carries the puzzle on screen and its state (truncated), the last events, the error, and the device', () => {
    history.replaceState(null, '', '/practice/p_abc');
    for (let i = 0; i < EVENTS_KEPT + 20; i++) log('puzzle-show', { index: i });
    setPuzzleWhere({ practiceId: 'p_abc', index: 4, count: 28, puzzleId: 'z4', type: 'say-chain', speak: true, state: () => ({ step: 'chain', big: 'b'.repeat(STATE_MAX * 2) }) });
    const ctx = captureContext({ error: new ApiRequestError(500, 'internal', 'boom', undefined, { method: 'POST', path: '/api/speech' }) });
    expect(ctx).toMatchObject({ route: '/practice/p_abc', practiceId: 'p_abc', puzzle: { index: 4, count: 28, type: 'say-chain', id: 'z4' }, speak: true, layout: expect.any(String), online: expect.any(Boolean), build: expect.any(String) });
    expect((ctx.puzzleState as string).startsWith('{"step":"chain"')).toBe(true);
    expect((ctx.puzzleState as string).length).toBe(STATE_MAX + 1);
    expect(ctx.events).toHaveLength(EVENTS_KEPT);
    expect(ctx.error).toMatch(/^FRX-ERR server 500 POST \/api\/speech/);
    expect(JSON.stringify(ctx).length).toBeLessThanOrEqual(CONTEXT_MAX);
    setPuzzleWhere(null);
    history.replaceState(null, '', '/');
  });

  it('stays under the cap: the state shortened, then fewer events, then their data', () => {
    const events = Array.from({ length: 50 }, (_, i) => ({ kind: 'crash', at: i, route: '/', data: { stack: 's'.repeat(1900) } }));
    const big = { route: '/x', build: 'b', puzzleState: 'p'.repeat(5000), events };
    const fit = fitContext(big, 20_000);
    expect(JSON.stringify(fit).length).toBeLessThanOrEqual(20_000);
    expect((fit.puzzleState as string).length).toBe(1501);
    expect((fit.events as unknown[]).length).toBeLessThan(50);
    expect((fit.events as { at: number }[]).at(-1)!.at).toBe(49); // the newest are kept
    const tiny = fitContext(big, 600);
    expect(JSON.stringify(tiny).length).toBeLessThanOrEqual(600);
    expect(tiny.route).toBe('/x');
    expect(fitContext({ a: 1 }, 100)).toEqual({ a: 1 });
  });
});

describe('the report form', () => {
  it('opens from the flag, sends the text with the context taken when the flag was pressed, says « Merci ! » and closes', async () => {
    sendReport.mockResolvedValue({ id: 7 });
    setPuzzleWhere({ practiceId: 'p_1', index: 2, count: 9, puzzleId: 'z2', type: 'match', speak: false, state: () => ({ picked: 1 }) });
    const { container } = render(<ReportButton variant="icon" />);
    const flag = container.querySelector<HTMLButtonElement>('[data-report-open]')!;
    expect(flag.getAttribute('aria-label')).toBe('Quelque chose ne va pas ?');
    act(() => flag.click());
    setPuzzleWhere(null); // what happens after the press is not the context
    const form = document.querySelector('[data-report-form]')!;
    expect(form.textContent).toMatch(/Raconte ce qui ne marche pas/);
    fireEvent.change(form.querySelector('textarea')!, { target: { value: '  le bouton ne marche pas  ' } });
    act(() => document.querySelector<HTMLButtonElement>('[data-report-send]')!.click());
    await flush();
    expect(sendReport).toHaveBeenCalledTimes(1);
    const req = sendReport.mock.calls[0]![0];
    expect(req.text).toBe('le bouton ne marche pas');
    expect(req.context).toMatchObject({ puzzle: { type: 'match', index: 2, id: 'z2' }, puzzleState: '{"picked":1}', speak: false, content: 'content-v1' });
    expect(toasts).toHaveBeenCalledWith('Merci !', expect.anything());
    expect(document.querySelector('[data-report-form]')).toBeNull();
  });

  it('a failed send shows the error panel in the form, keeps the text, and « Réessayer » sends again', async () => {
    sendReport.mockRejectedValueOnce(new ApiRequestError(500, 'internal', 'down', undefined, { method: 'POST', path: '/api/reports' })).mockResolvedValueOnce({ id: 8 });
    render(<ReportButton />);
    act(() => document.querySelector<HTMLButtonElement>('[data-report-open]')!.click());
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'ça bloque' } });
    act(() => document.querySelector<HTMLButtonElement>('[data-report-send]')!.click());
    await flush();
    const panel = document.querySelector('[data-report-form] [data-error-panel]')!;
    expect(panel.getAttribute('data-error-kind')).toBe('server');
    expect(panel.querySelector('[data-report-open]')).toBeNull(); // no report button inside the report form
    expect(recovered).toHaveBeenCalled();
    expect(document.querySelector('textarea')!.value).toBe('ça bloque');
    act(() => panel.querySelector<HTMLButtonElement>('[data-error-retry]')!.click());
    await flush();
    expect(sendReport).toHaveBeenCalledTimes(2);
    expect(sendReport.mock.calls[1]![0].text).toBe('ça bloque');
    expect(document.querySelector('[data-report-form]')).toBeNull();
  });

  it('Cancel closes without sending; in English it speaks English', () => {
    setLanguage('en');
    render(<ReportButton />);
    expect(document.querySelector('[data-report-open]')!.textContent).toBe('Something wrong?');
    act(() => document.querySelector<HTMLButtonElement>('[data-report-open]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-report-cancel]')!.click());
    expect(document.querySelector('[data-report-form]')).toBeNull();
    expect(sendReport).not.toHaveBeenCalled();
  });
});

describe('on the error panels, and the tip', () => {
  it('every panel carries the button once the slot is filled: words and the tip on a page, the flag alone on the bar', () => {
    const e = new ApiRequestError(0, 'offline');
    const empty = render(<ErrorPanel error={e} />);
    expect(empty.container.querySelector('[data-report-open]')).toBeNull(); // nothing registered
    empty.unmount();
    setErrorReportSlot(ErrorPanelReport);
    const page = render(<ErrorPanel error={e} />);
    expect(page.container.querySelector('[data-report-open]')!.textContent).toMatch(/Quelque chose ne va pas/);
    expect(page.container.querySelector('[data-report-tip="panel"]')!.textContent).toContain(translate('fr', 'common.report.tip'));
    page.unmount();
    const bar = render(<ErrorPanel error={e} variant="bar" />);
    expect(bar.container.querySelector('[data-report-open]')!.getAttribute('aria-label')).toMatch(/Quelque chose ne va pas/);
    expect(bar.container.querySelector('[data-report-tip]')).toBeNull();
    bar.unmount();
    const none = render(<ErrorPanel error={e} report={false} />);
    expect(none.container.querySelector('[data-report-open]')).toBeNull();
  });

  it('the tip shows until the kid taps it, then never again on this device', () => {
    const first = render(<ReportTip where="header" />);
    const tip = first.container.querySelector<HTMLButtonElement>('[data-report-tip] button')!;
    expect(tip.textContent).toMatch(/Si quelque chose ne marche pas/);
    act(() => tip.click());
    expect(first.container.querySelector('[data-report-tip] button')).toBeNull();
    expect(getFlag('tip.report')).toBe('1');
    first.unmount();
    const again = render(<ReportTip where="panel" />);
    expect(again.container.querySelector('[data-report-tip] button')).toBeNull();
  });
});
