// Route /login: "I have an account": name + the three-digit number, for an account this device does not
// remember (the player selection, /players, lists those it does). `?name=…&stale=1`: a remembered name
// that no longer works (renamed on another device): the name prefilled, and a plain message.
import { useEffect, useState, type CSSProperties } from 'react';
import { useLocation, useSearch } from 'wouter';
import { t } from '../../../shared/i18n';
import { ApiRequestError } from '../api';
import { fx } from '../fx';
import { Balloon, Burst, Caption } from '../home/comic';
import { logIn } from '../state/account';
import { actionFailed } from '../state/recover';
import { Button, cx, Icon, IconButton, useLayout } from '../ui';
import s from './Login.module.css';

/** What the balloon under the PIN says, by cause (`data-login-error` names it for tests). */
const ERROR_TEXT = { stale: 'players.stale', 'rate-limited': 'login.tooMany', 'bad-credentials': 'login.wrong' } as const;

export default function LoginScreen() {
  const layout = useLayout();
  const [, navigate] = useLocation();
  const query = new URLSearchParams(useSearch());
  const [name, setName] = useState(() => (query.get('name') ?? '').slice(0, 40));
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof ERROR_TEXT | null>(() => (query.get('stale') ? 'stale' : null));
  const [waitS, setWaitS] = useState(0);
  const [shake, setShake] = useState(0);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (waitS <= 0) return;
    const id = setTimeout(() => setWaitS((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [waitS]);

  const submit = async (code: string) => {
    if (busy || waitS > 0 || !name.trim() || code.length !== 3) return;
    setBusy(true);
    setError(null);
    try {
      await logIn(name, code);
      fx.sfx('win');
      setSuccess(true);
      setTimeout(() => navigate('/'), 900);
    } catch (e) {
      fx.sfx('wrong');
      setShake((n) => n + 1);
      setPin('');
      if (e instanceof ApiRequestError && e.code === 'rate-limited') {
        setWaitS(e.retryAfterS ?? 60);
        setError('rate-limited');
      } else if (e instanceof ApiRequestError && e.code === 'bad-credentials') {
        setError('bad-credentials');
      } else {
        // Offline, a timeout, the server: the kid's message and the admin's line, as for any action.
        setError(null);
        actionFailed(e);
      }
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (pin.length >= 3 || waitS > 0) return;
    fx.sfx('tap');
    const next = pin + d;
    setPin(next);
    if (next.length === 3) void submit(next);
  };

  return (
    <div className={cx(s.page, layout === 'tablet' && s.tablet)}>
      <div className={s.top}>
        <IconButton icon="back" label={t('common.back')} onClick={() => history.length > 1 ? history.back() : navigate('/')} />
        <Caption as="h1" tilt={-2} className={s.title}>
          {t('login.title')}
        </Caption>
      </div>
      <div className={s.body}>
        <div className={s.formPanel}>
          <label className={s.label} htmlFor="login-name">
            <Icon name="profile" size={24} /> {t('login.name')}
          </label>
          <input id="login-name" className={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('login.namePlaceholder')} autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <span className={s.label}>
            <Icon name="lock" size={24} /> {t('login.pin')}
          </span>
          <div key={shake} className={cx(s.slots, shake > 0 && s.shake)} aria-label={t('login.pinFilled', { n: pin.length })}>
            {[0, 1, 2].map((i) => (
              <span key={i} className={cx(s.slot, i < pin.length && s.slotFull)} style={{ '--i': i } as CSSProperties}>
                {pin[i] ?? ''}
              </span>
            ))}
          </div>
          {error && (
            <Balloon tail="top-left" className={s.error}>
              <span data-login-error={error}>{t(ERROR_TEXT[error])}</span>
              {waitS > 0 && <strong className={s.wait}> {t('login.waitMin', { n: Math.max(1, Math.ceil(waitS / 60)) })}</strong>}
            </Balloon>
          )}
        </div>
        <div className={s.padPanel}>
          {success ? (
            <Burst word={t('login.welcomeBack')} size={200} color="yellow" seed={6} />
          ) : (
            <div className={s.pad}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} type="button" className={s.key} onClick={() => press(d)} disabled={busy || waitS > 0 || !name.trim()}>
                  {d}
                </button>
              ))}
              <button type="button" className={cx(s.key, s.keyBack)} onClick={() => setPin((p) => p.slice(0, -1))} aria-label={t('login.erase')} disabled={!pin}>
                <Icon name="back" size={30} />
              </button>
              <button type="button" className={s.key} onClick={() => press('0')} disabled={busy || waitS > 0 || !name.trim()}>
                0
              </button>
              <span className={s.keySpacer} />
            </div>
          )}
          {!name.trim() && !success && <p className={s.hint}>{t('login.nameFirst')}</p>}
          {busy && <p className={s.hint}>{t('common.loading')}</p>}
        </div>
      </div>
      <div className={s.footer}>
        <p className={s.where}>{t('login.where')}</p>
        <div className={s.footerButtons}>
          <Button color="white" size="sm" icon="home" onClick={() => navigate('/')}>
            {t('login.stay')}
          </Button>
        </div>
      </div>
    </div>
  );
}
