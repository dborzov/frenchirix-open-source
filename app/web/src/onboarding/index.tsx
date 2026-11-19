// Onboarding without registration: a ten-second welcome on first open, tips shown once in context
// as small bubbles, and the invitation to make an avatar and choose a name after a few practices.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import type { PlayerState } from '../../../shared/api';
import { t } from '../../../shared/i18n';
import { addDays, compareDays } from '../../../shared/rules';
import { Avatar } from '../avatar/Avatar';
import { FIXTURES } from '../api';
import { fx } from '../fx';
import { Button, cx, IconButton, Logo } from '../ui';
import { Burst } from '../home/comic';
import { isEmptyAccount } from '../pwa/Overlay';
import { pwaFlag } from '../pwa/stored';
import { getFlag, setFlag } from './storage';
import s from './onboarding.module.css';

export { clearFlags as resetOnboarding } from './storage';

/** Practices to finish before the avatar and name invitation appears. */
export const INVITE_AFTER_PRACTICES = 3;
/** A dismissed invitation comes back after this many days, until the kid has chosen a name. */
export const INVITE_SNOOZE_DAYS = 3;

/** First open: no practice finished, nothing unlocked, welcome not seen on this device. */
export function needsWelcome(st: PlayerState): boolean {
  if (FIXTURES && typeof location !== 'undefined' && new URLSearchParams(location.search).has('welcome')) return true;
  if (getFlag('welcome')) return false;
  return (st.stats.practicesFinished ?? 0) === 0 && Object.keys(st.progress).length === 0;
}

export function shouldInvite(st: PlayerState): boolean {
  if (st.profile.nameChosen) return false;
  if ((st.stats.practicesFinished ?? 0) < INVITE_AFTER_PRACTICES) return false;
  const snoozed = getFlag('invite');
  return !snoozed || compareDays(st.today, snoozed) >= 0;
}

/** How long a new kid's Home waits for "Played before?" to appear before showing the welcome anyway. */
const WELCOME_BACK_GRACE_MS = 1500;

/**
 * The welcome comes after "Played before?" (pwa/Overlay.tsx, drawn in its own React root), never on
 * top of it: true once the welcome is wanted and that question was answered, or is not going to be
 * asked (an account with something in it, a device that answered it before).
 */
export function useWelcomeAfterWelcomeBack(wanted: boolean, st: PlayerState): boolean {
  const [ready, setReady] = useState(false);
  const empty = isEmptyAccount(st);
  useEffect(() => {
    if (!wanted || ready) return;
    const t0 = Date.now();
    let seen = false;
    const check = () => {
      if (document.querySelector('[data-testid="pwa-welcome"]')) {
        seen = true;
        return;
      }
      if (seen || !empty || pwaFlag('welcomeBack') !== null || Date.now() - t0 > WELCOME_BACK_GRACE_MS) setReady(true);
    };
    check();
    const id = setInterval(check, 200);
    return () => clearInterval(id);
  }, [wanted, ready, empty]);
  return wanted && ready;
}

/** The welcome: what this is, one tap, then straight to choosing scenes. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const [, navigate] = useLocation();
  const go = () => {
    setFlag('welcome');
    fx.sfx('whoosh');
    onDone();
    navigate('/unlock');
  };
  return (
    <div className={s.welcome} role="dialog" aria-modal="true" aria-label={t('home.onb.welcomeTitle')} data-testid="welcome">
      <div className={s.rays} aria-hidden />
      <div className={s.welcomeBody}>
        <Logo size={44} wiggle />
        <div className={s.cauldron} aria-hidden>
          <Burst word={t('home.onb.burst')} size={150} color="yellow" seed={5} />
          <Cauldron />
        </div>
        <h1 className={s.welcomeTitle}>{t('home.onb.welcomeTitle')}</h1>
        <ul className={s.welcomeSteps}>
          <li style={{ '--i': 0 } as CSSProperties}>
            <span className={s.stepIcon} data-c="blue">1</span>
            {t('home.onb.step1')}
          </li>
          <li style={{ '--i': 1 } as CSSProperties}>
            <span className={s.stepIcon} data-c="lime">2</span>
            {t('home.onb.step2')}
          </li>
          <li style={{ '--i': 2 } as CSSProperties}>
            <span className={s.stepIcon} data-c="yellow">3</span>
            {t('home.onb.step3')}
          </li>
          <li style={{ '--i': 3 } as CSSProperties}>
            <span className={s.stepIcon} data-c="lime">?</span>
            {t('home.onb.step4')}
          </li>
        </ul>
        <Button size="xl" color="lime" iconRight="forward" onClick={go} className={s.welcomeGo} data-welcome-go>
          {t('home.onb.go')}
        </Button>
      </div>
    </div>
  );
}

/** A small bubble shown once per device. Tap it to make it go away for good. */
export function Tip({ id, children, placement = 'below', className }: { id: string; children: ReactNode; placement?: 'below' | 'above' | 'inline'; className?: string }) {
  const [shown, setShown] = useState(() => !getFlag(`tip.${id}`));
  if (!shown) return null;
  const close = () => {
    setFlag(`tip.${id}`);
    setShown(false);
  };
  return (
    <button type="button" className={cx(s.tip, placement === 'above' ? s.tipAbove : placement === 'inline' ? s.tipInline : s.tipBelow, className)} onClick={close} aria-label={t('common.close')}>
      <span className={s.tipText}>{children}</span>
      <span className={s.tipOk}>{t('common.ok')}</span>
    </button>
  );
}

/** After a few practices: make your avatar and choose your name, as a reward. Dismissable. */
export function AvatarInvite({ state, onDismiss }: { state: PlayerState; onDismiss: () => void }) {
  const [, navigate] = useLocation();
  const dismiss = () => {
    setFlag('invite', addDays(state.today, INVITE_SNOOZE_DAYS));
    onDismiss();
  };
  return (
    <div className={s.invite}>
      <div className={s.inviteAvatar}>
        <Avatar avatar={state.profile.avatar} size={84} />
        <span className={s.inviteSpark} aria-hidden>
          ✦
        </span>
      </div>
      <div className={s.inviteText}>
        <h3>{t('home.onb.inviteTitle')}</h3>
        <p>{t('home.onb.inviteText')}</p>
        <Button color="yellow" size="sm" icon="star" onClick={() => navigate('/avatar?from=invite')}>
          {t('home.onb.inviteGo')}
        </Button>
      </div>
      <IconButton icon="close" label={t('home.onb.later')} size="sm" className={s.inviteClose} onClick={dismiss} />
    </div>
  );
}

/** After the first passed practice, once per device and kid: there is now something worth logging back into. */
export function shouldNotePin(st: PlayerState): boolean {
  if (getFlag('notePin')) return false;
  return Object.values(st.progress).some((p) => p.level >= 1);
}

/**
 * "Écris ton nom et ton code": a kid's account has no email, so the name and the PIN are the only
 * way back on another device (or after "Ce n'est pas moi"). A card on Home, once.
 */
export function NotePinCard({ state, onDone }: { state: PlayerState; onDone: () => void }) {
  const done = () => {
    setFlag('notePin');
    fx.sfx('pop');
    onDone();
  };
  return (
    <div className={s.notePin} data-note-pin>
      <h3 className={s.notePinTitle}>{t('home.notePin.title')}</h3>
      <p className={s.notePinText}>{t('home.notePin.text')}</p>
      <dl className={s.notePinCard}>
        <dt>{t('profile.leave.name')}</dt>
        <dd>{state.profile.name}</dd>
        <dt>{t('profile.leave.pin')}</dt>
        <dd className={s.notePinDigits}>{state.profile.pin}</dd>
      </dl>
      <Button color="yellow" size="sm" icon="check" onClick={done} data-note-pin-done>
        {t('home.notePin.done')}
      </Button>
    </div>
  );
}

/** A bubbling cauldron, the welcome's and the unlock screen's picture. */
export function Cauldron({ size = 120 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 110" width={size} height={(size * 110) / 120} className={s.cauldronSvg} aria-hidden>
      <g className={s.bubbles}>
        <circle cx="45" cy="30" r="7" fill="var(--lime)" />
        <circle cx="66" cy="22" r="5" fill="var(--lime)" />
        <circle cx="78" cy="34" r="8" fill="var(--lime)" />
      </g>
      <ellipse cx="60" cy="46" rx="48" ry="11" fill="var(--lime-dark)" />
      <path d="M12 46c0 34 18 54 48 54s48-20 48-54z" fill="var(--ink)" />
      <path d="M20 54c4 26 18 38 40 38" stroke="var(--ink-soft)" strokeWidth="5" fill="none" strokeLinecap="round" />
      <ellipse cx="60" cy="46" rx="48" ry="10" fill="none" stroke="var(--ink)" strokeWidth="7" />
      <path d="M28 98l-8 10M92 98l8 10" stroke="var(--ink)" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}
