// The one error panel (docs/app-architecture.md, "Errors"): the kid's message, « Réessayer », and,
// small and out of the way, the one-line detail for the admin with a copy button. Screens show it in
// place of what failed to load; the practice shows it over the continue bar when a save failed.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../../../shared/i18n';
import { errorDetail, errorMessage, kindOf } from '../api/errors';
import { Burst } from './Burst';
import { Button } from './Button';
import { cx } from './colors';
import { Icon } from './icons';
import s from './ErrorPanel.module.css';

export interface ErrorPanelProps {
  error: unknown;
  /** « Réessayer »: try the same thing again (a load, a save). */
  onRetry?: () => void;
  /** The retry is under way. */
  retrying?: boolean;
  /** A second way out (usually back Home). */
  secondary?: ReactNode;
  /** A message of the screen's own instead of the one for the error's kind. */
  message?: string;
  /** The screen for a crash's detail line (defaults to the current path). */
  where?: string;
  /** 'page': a panel in place of a screen or a part of it; 'bar': one compact row (the practice's continue bar). */
  variant?: 'page' | 'bar';
  /** false: no "Quelque chose ne va pas ?" button (the report form's own failure). */
  report?: boolean;
  className?: string;
}

export function ErrorPanel({ error, onRetry, retrying, secondary, message, where, variant = 'page', report = true, className }: ErrorPanelProps) {
  const kind = kindOf(error);
  const detail = errorDetail(error, where);
  const text = message ?? errorMessage(error);
  const bar = variant === 'bar';
  return (
    <div className={cx(s.panel, bar && s.bar, className)} role="alert" data-error-panel={variant} data-error-kind={kind}>
      {!bar && (
        <Burst size={120} color="white" text="ink" rotate={-7} seed={4} className={s.burst}>
          {t('common.fail.title')}
        </Burst>
      )}
      <p className={s.message}>{text}</p>
      <div className={s.actions}>
        {onRetry && (
          <Button color="yellow" size={bar ? 'md' : 'lg'} icon="loop" onClick={onRetry} loading={retrying} data-error-retry>
            {t('common.retry')}
          </Button>
        )}
        {secondary}
        {bar && report && <ErrorReportSlot error={error} bar />}
      </div>
      {!bar && report && <ErrorReportSlot error={error} bar={false} />}
      <ErrorDetail text={detail} />
    </div>
  );
}

/** What fills the report slot: given the panel's error, and whether the panel is the compact bar. */
export type ErrorReportSlotComponent = (props: { error: unknown; bar: boolean }) => ReactNode;

let reportSlot: ErrorReportSlotComponent | null = null;

/**
 * The place for the "Quelque chose ne va pas ?" button on every error panel (docs/intent.md, "When
 * something goes wrong"). The report module fills it once (App.tsx: `setErrorReportSlot(ErrorPanelReport)`),
 * so the design system does not import it; empty until then (unit tests of the panel).
 */
export function setErrorReportSlot(slot: ErrorReportSlotComponent | null): void {
  reportSlot = slot;
}

function ErrorReportSlot({ error, bar }: { error: unknown; bar: boolean }): ReactNode {
  const Slot = reportSlot;
  return Slot ? <Slot error={error} bar={bar} /> : null;
}

/** The admin's detail line: one line of small monospace text, selectable, with a copy button. */
export function ErrorDetail({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const code = useRef<HTMLElement>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation(); // inside a toast, a tap elsewhere dismisses it
    const ok = await copyText(text);
    if (!ok && code.current) selectAll(code.current);
    setCopied(ok);
    window.clearTimeout(timer.current);
    if (ok) timer.current = window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className={cx(s.detail, className)}>
      <span className={s.detailLabel}>{t('common.fail.detail')}</span>
      <code ref={code} className={s.detailText} data-error-detail onClick={(e) => e.stopPropagation()}>
        {text}
      </code>
      <button type="button" className={s.copy} onClick={(e) => void copy(e)} aria-label={t('common.fail.copy')} data-error-copy>
        <Icon name={copied ? 'check' : 'copy'} size={18} />
        <span>{copied ? t('common.fail.copied') : t('common.fail.copy')}</span>
      </button>
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // not allowed here (no user activation, an old WebView): try the old way
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.('copy') ?? false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Select the text so it can be copied by hand when the browser refuses to copy. */
function selectAll(el: HTMLElement): void {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    // nothing more to do
  }
}
