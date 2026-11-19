// "Quelque chose ne va pas ?" (docs/intent.md, "When something goes wrong"): a small flag button in the
// practice header (next to mute), on every error panel and in the profile. Pressing it takes the context
// at once (report/context.ts), then opens a short form: one text area, Send, Cancel. Sent, the kid sees
// « Merci ! » and is back where they were; a failed send shows the error panel in the form, the text kept,
// and « Réessayer » sends again. The tip (once per device, the onboarding Tip) points at the flag the
// first time a practice opens, or at the first error panel, whichever comes first.
import { useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../../../shared/i18n';
import { api, loadIndex } from '../api';
import { fx } from '../fx';
import { Tip } from '../onboarding';
import { recover } from '../state/recover';
import { Button, cx, ErrorPanel, IconButton, Modal, toast } from '../ui';
import { captureContext } from './context';
import s from './Report.module.css';

/** The tip's id in the onboarding flags (frenchirix.onb.tip.report). */
export const REPORT_TIP = 'report';
export const REPORT_TEXT_MAX = 1000;

export interface ReportButtonProps {
  /** 'icon': the round flag (practice header, the compact error bar); 'button': flag and words. */
  variant?: 'icon' | 'button';
  /** The error of the panel the button is on; its detail line goes with the report. */
  error?: unknown;
  className?: string;
}

export function ReportButton({ variant = 'button', error, className }: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const context = useRef<Record<string, unknown>>({});
  const press = () => {
    // Before the form covers the screen: what the kid was looking at when something went wrong.
    context.current = captureContext(error === undefined ? {} : { error });
    setOpen(true);
  };
  return (
    <>
      {variant === 'icon' ? (
        <IconButton icon="flag" label={t('common.report.button')} size="sm" color="white" onClick={press} className={className} data-report-open />
      ) : (
        <Button icon="flag" size="sm" color="white" onClick={press} className={className} data-report-open>
          {t('common.report.button')}
        </Button>
      )}
      {open && <ReportForm context={context.current} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The tip pointing at the flag, in the flow under it (it never covers a control); once per device. */
export function ReportTip({ where }: { where: 'header' | 'panel' }): ReactNode {
  return (
    <div className={cx(s.tipRow, where === 'header' ? s.tipRowHeader : s.tipRowPanel)} data-report-tip={where}>
      <Tip id={REPORT_TIP} placement="inline" className={cx(s.tip, where === 'header' ? s.tipHeader : s.tipPanel)}>
        {t('common.report.tip')}
      </Tip>
    </div>
  );
}

/** What fills the error panel's slot (ui/ErrorPanel.tsx, setErrorReportSlot): the flag, and the tip under it. */
export function ErrorPanelReport({ error, bar }: { error: unknown; bar: boolean }): ReactNode {
  if (bar) return <ReportButton variant="icon" error={error} />;
  return (
    <div className={s.panelReport}>
      <ReportButton variant="button" error={error} />
      <ReportTip where="panel" />
    </div>
  );
}

function ReportForm({ context, onClose }: { context: Record<string, unknown>; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const id = useId();
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const content = await loadIndex().then((ix) => ix.version, () => null);
      await api.report({ text: text.trim(), route: String(context.route ?? location.pathname), context: { ...context, content } });
      fx.sfx('pop');
      toast(t('common.report.thanks'), { color: 'lime', icon: 'check', tag: 'report-thanks' });
      onClose();
    } catch (e) {
      // Like any failed call: the panel, « Réessayer »; the text stays in the form.
      recover(e);
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} dismissable={!busy} title={t('common.report.title')}>
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        data-report-form
      >
        <label className={s.label} htmlFor={id}>
          {t('common.report.label')}
        </label>
        <textarea
          id={id}
          className={s.text}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={REPORT_TEXT_MAX}
          rows={4}
          placeholder={t('common.report.placeholder')}
          autoFocus
          data-report-text
        />
        {error !== null && <ErrorPanel variant="bar" error={error} report={false} onRetry={() => void send()} retrying={busy} className={s.failed} />}
        <div className={s.buttons}>
          <Button type="button" color="white" onClick={onClose} disabled={busy} data-report-cancel>
            {t('common.cancel')}
          </Button>
          <Button type="submit" color="lime" icon="check" loading={busy} data-report-send>
            {t('common.report.send')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
