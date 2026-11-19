// The karaoke studio under the song's player (the full screen only; useStudio.ts holds the logic): the
// one microphone control of the app (MicControl, compact at every size so the words being sung stay in
// view) to record while the song plays, the karaoke's own first-time notice, the notes after singing
// that was not sent or not allowed, the error panel when the check could not be done, the singing over
// the song with "keep it" / "do it again" / "throw it away", and the kept recording with a way to erase
// it (a confirmation first). `Studio` mounts it for the player and tells the player what plays over the
// song and when its controls rest; Home's compact card has no studio and no recorder.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '../../../shared/content';
import { t } from '../../../shared/i18n';
import { ApiRequestError, errorMessage } from '../api';
import type { Overlay } from '../audio';
import { fx } from '../fx';
import { isNotice, MicControl, MicNotice } from '../speech';
import { Burst, Button, dismissToasts, ErrorPanel, Modal, Panel, Stamp, cx, useLayout } from '../ui';
import s from './StudioPanel.module.css';
import { useStudio, type PlaySong, type Studio as StudioState, type StudioPhase } from './useStudio';

/** What the studio tells the player: what plays over the song (undefined: the recording), whether its controls rest. */
export interface StudioView {
  overlay: Overlay | null | undefined;
  locked: boolean;
  phase: StudioPhase;
}

export function Studio({ song, tag, play, onView }: { song: Song; tag: string; play: PlaySong; onView: (v: StudioView) => void }) {
  const studio = useStudio(song, tag, play);
  const { overlay, locked, phase } = studio;
  const key = `${overlay === undefined ? 'rec' : (overlay?.src ?? 'none')}|${overlay?.offsetMs ?? ''}|${locked}|${phase}`;
  useEffect(() => {
    onView({ overlay, locked, phase });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => onView({ overlay: undefined, locked: false, phase: 'idle' }), [onView]);
  return <StudioPanel studio={studio} />;
}

/** The kid's message when the check failed: the app's message for the kind, or one of the karaoke's own. */
function failMessage(e: unknown): string {
  if (e instanceof ApiRequestError && e.code === 'speech-unavailable') return t('karaoke.rec.failed.speech');
  if (e instanceof ApiRequestError && e.code === 'rate-limited') return t('karaoke.rec.failed.limit');
  return errorMessage(e);
}

/** A failure that the same singing sent again cannot fix: today's limit, or singing too long to send. */
const hopeless = (e: unknown) => e instanceof ApiRequestError && (e.code === 'rate-limited' || e.code === 'too-big');

export function StudioPanel({ studio }: { studio: StudioState }) {
  const { phase, rec, recording } = studio;
  const phone = useLayout() === 'phone';
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const ref = useRef<HTMLElement>(null);
  // The countdown follows the song, not the recorder's limit.
  const micRec = useMemo(() => (studio.clock ? { ...rec, clock: studio.clock } : rec), [rec, studio.clock]);

  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    const ok = await studio.remove();
    setRemoving(false);
    if (ok) setConfirm(false);
  };

  // What needs the kid's tap next comes into view (on a phone the panel sits under the song).
  const needsTap = phase === 'intro' || phase === 'listen' || phase === 'failed' || phase === 'refused' || phase === 'silent' || phase === 'short' || isNotice(rec.status);
  useEffect(() => {
    if (!needsTap) return;
    const id = requestAnimationFrame(() => ref.current?.scrollIntoView?.({ block: 'nearest', behavior: fx.reducedMotion() ? 'auto' : 'smooth' }));
    return () => cancelAnimationFrame(id);
  }, [needsTap, phase]);

  // Listening: the kid sings with the words, so the line being sung comes up under the top bar when the
  // microphone control stays in view above the tab bar (the control is compact at every size, so it
  // does at every size the app supports); otherwise the control has it (it brings itself into view).
  const listening = rec.status === 'recording';
  useEffect(() => {
    if (!listening) return;
    const id = window.setTimeout(() => {
      const section = ref.current;
      const player = section?.closest('[data-karaoke]');
      const row = player?.querySelector('[data-row="current"]') ?? player?.querySelector('[data-karaoke-stage]');
      const mic = section?.querySelector('[data-mic]');
      if (!section || !row || !mic) return;
      const top = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      const tabbar = phone ? parseFloat(getComputedStyle(section).getPropertyValue('--tabbar-h')) || 72 : 0;
      const bottom = window.innerHeight - tabbar;
      const dy = row.getBoundingClientRect().top - top - 12;
      if (Math.abs(dy) > 4 && mic.getBoundingClientRect().bottom - dy <= bottom - 8) window.scrollBy({ top: dy, behavior: 'auto' });
    }, 120);
    return () => window.clearTimeout(id);
  }, [listening, phone]);

  let body;
  if (phase === 'listen' || phase === 'saving') {
    const saving = phase === 'saving';
    body = (
      <Panel color="yellow" tilt={-1} className={s.listen} data-studio-listen>
        <Burst size={phone ? 104 : 124} color="white" text="ink" rotate={-7} seed={3} className={s.burst}>
          {t('karaoke.rec.listen.title')}
        </Burst>
        <div className={s.listenText}>
          <p className={s.lead}>{t('karaoke.rec.listen.text')}</p>
          {recording && <p className={s.small}>{t('karaoke.rec.listen.replaces')}</p>}
        </div>
        <div className={s.listenButtons}>
          <Button color="green" size="lg" icon="check" onClick={studio.keep} loading={saving} data-studio-keep>
            {t('karaoke.rec.keep')}
          </Button>
          <Button color="white" icon="mic" onClick={studio.redo} disabled={saving} data-studio-redo>
            {t('karaoke.rec.redo')}
          </Button>
          <Button color="white" icon="close" onClick={studio.drop} disabled={saving} data-studio-drop>
            {t('karaoke.rec.drop')}
          </Button>
        </div>
      </Panel>
    );
  } else if (phase === 'failed') {
    const noRetry = hopeless(studio.error);
    body = (
      <ErrorPanel
        error={studio.error}
        message={failMessage(studio.error)}
        {...(noRetry ? {} : { onRetry: studio.send })}
        secondary={
          <Button color={noRetry ? 'yellow' : 'white'} size={noRetry ? 'lg' : 'md'} icon={noRetry ? 'back' : 'close'} onClick={studio.drop} data-studio-drop>
            {noRetry ? t('karaoke.rec.back') : t('karaoke.rec.drop')}
          </Button>
        }
      />
    );
  } else if (phase === 'intro' || isNotice(rec.status)) {
    body = (
      <MicNotice
        status={phase === 'intro' ? 'intro' : rec.status}
        onOk={studio.acceptIntro}
        onSkip={studio.back}
        onRetry={() => {
          studio.back();
          studio.start();
        }}
        introSkip
        words={{
          introTitle: t('karaoke.rec.mic.introTitle'),
          introText: t('karaoke.rec.mic.intro'),
          introOk: t('karaoke.rec.mic.introOk'),
          deniedText: t('karaoke.rec.mic.denied'),
          deafText: t('karaoke.rec.mic.deaf'),
          skip: t('karaoke.rec.back'),
        }}
      />
    );
  } else {
    const note = phase === 'silent' ? t('karaoke.rec.silent') : phase === 'short' ? t('karaoke.rec.short') : phase === 'refused' ? t('karaoke.rec.refused') : null;
    const idleText = note ? t('karaoke.rec.retry') : recording ? t('karaoke.rec.again') : t('karaoke.rec.start');
    const quiet = phase === 'idle' || note !== null;
    body = (
      <Panel color="paper" className={cx(s.desk, phone && s.deskPhone)}>
        <MicControl rec={micRec} onStart={studio.start} onPause={studio.cancel} thinking={phase === 'checking'} idleText={idleText} compact buttonData={{ 'data-studio-record': true }} />
        {phase === 'checking' && (
          <Button color="white" size="sm" icon="close" onClick={studio.drop} data-studio-drop>
            {t('karaoke.rec.drop')}
          </Button>
        )}
        {quiet && (
          <div className={s.side}>
            {note ? (
              <p className={cx(s.note, phase === 'refused' && s.noteRefused)} role="status" data-studio-note={phase}>
                {note}
              </p>
            ) : recording ? (
              <div className={s.mine} data-studio-mine={recording.id}>
                <Stamp color="lime" tilt={-4} className={s.stamp}>
                  {t('karaoke.rec.mine')}
                </Stamp>
                <p className={s.small}>{t('karaoke.rec.mineText')}</p>
              </div>
            ) : (
              <p className={s.small}>{t('karaoke.rec.intro')}</p>
            )}
            {recording && phase === 'idle' && (
              <Button
                color="white"
                size="sm"
                icon="close"
                onClick={() => {
                  dismissToasts(); // none over the dialog's title
                  setConfirm(true);
                }}
                data-studio-remove
              >
                {t('karaoke.rec.remove')}
              </Button>
            )}
          </div>
        )}
      </Panel>
    );
  }

  return (
    <section ref={ref} className={s.studio} data-studio={phase} data-studio-recording={recording?.id ?? ''} data-mic-status={rec.status}>
      {body}
      <Modal open={confirm} onClose={() => !removing && setConfirm(false)} title={t('karaoke.rec.remove.title')}>
        <div className={s.confirm} data-studio-confirm>
          <p className={s.lead}>{t('karaoke.rec.remove.text')}</p>
          <Button color="tomato" size="lg" block icon="close" onClick={() => void remove()} loading={removing} data-studio-remove-go>
            {t('karaoke.rec.remove.go')}
          </Button>
          <Button color="white" block onClick={() => setConfirm(false)} disabled={removing} data-studio-remove-keep>
            {t('karaoke.rec.remove.keep')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
