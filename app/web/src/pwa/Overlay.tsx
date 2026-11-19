// The moments this module shows over any screen, in its own React root (pwa/boot.ts), so they work
// even when the app's own tree has crashed (a chunk that failed to load):
// - NOUVEAU ! : a burst for about a second before reloading into a new build, on an idle screen;
// - stuck: a reload did not help (or a chunk keeps failing): one button to reload;
// - welcome back: "Played before?" while the account is empty, in the browser and in the installed
//   app. On iOS the home-screen app may not get Safari's cookies, and a lost cookie anywhere makes a
//   new account: offer the login with name and secret number before the kid starts over
//   (docs/app-release.md, "Installing"). A device that remembers other accounts offers them as on the
//   player selection ("Who's playing?").
import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { navigate } from 'wouter/use-browser-location';
import type { PlayerState } from '../../../shared/api';
import { t } from '../../../shared/i18n';
import { ApiRequestError } from '../api';
import { logIn } from '../state/account';
import { rememberedAccounts, type RememberedAccount } from '../state/accounts';
import { usePlayer } from '../state/player';
import { actionFailed } from '../state/recover';
import { Burst, Button, cx } from '../ui';
import { DruidMark } from './DruidMark';
import { isStandalone } from './install';
import { pwaFlag, setPwaFlag } from './stored';
import { forceReload, getUpdateState, subscribeUpdate } from './update';
import s from './pwa.module.css';

/** A brand-new account: nothing earned, nothing unlocked, no name chosen. */
export function isEmptyAccount(st: PlayerState): boolean {
  return st.currencies.xp === 0 && Object.keys(st.progress).length === 0 && !st.profile.nameChosen;
}

// The avatars are drawn only when this device remembers other accounts: load them then, not with every page.
const PlayerTiles = lazy(() => import('../screens/PlayerTiles').then((m) => ({ default: m.PlayerTiles })));

function UpdateMoment() {
  const u = useSyncExternalStore(subscribeUpdate, getUpdateState, getUpdateState);
  if (u.phase === 'applying') {
    return (
      <div className={s.updateLayer} role="status" aria-live="polite" data-testid="pwa-updating">
        <div className={s.updateStack}>
          <Burst size={240} color="red" text="white" rotate={-8} className={s.updateBurst}>
            {t('pwa.update.burst')}
          </Burst>
          <span className={s.updateText}>{t('pwa.update.text')}</span>
        </div>
      </div>
    );
  }
  if (u.phase === 'stuck') {
    return (
      <div className={s.stuckLayer} role="alertdialog" aria-modal="true" data-testid="pwa-stuck">
        <div className={s.stuckPanel}>
          <Burst size={150} color="red" text="white" rotate={-6}>
            {t('gate.oups')}
          </Burst>
          <p>{t('pwa.stuck.text')}</p>
          <Button color="yellow" size="lg" icon="loop" onClick={forceReload}>
            {t('pwa.stuck.go')}
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

/**
 * "Played before?" while the account is empty: a lost cookie (a private window, cleared data, a
 * school profile wiped at night, the iOS home-screen app) makes a new kid silently; this offers the
 * login with name and PIN before the kid starts over, or, when this device remembers other accounts,
 * those accounts to tap. Asked once per device and kid (the flag is the kid's; "New player" answers it
 * for the new kid); never on the login screen or the player selection.
 */
function WelcomeBack() {
  const st = usePlayer((x) => x.state);
  const ready = usePlayer((x) => x.status === 'ready');
  const path = useSyncExternalStore(subscribePath, currentPath, currentPath);
  const [answered, setAnswered] = useState(() => pwaFlag('welcomeBack') !== null);
  const [busy, setBusy] = useState<string | null>(null);
  if (answered || !ready || !st || path.startsWith('/login') || path.startsWith('/players') || path.startsWith('/dev')) return null;
  if (!isEmptyAccount(st)) {
    // A kid with something already: nothing to ask on this device, ever (until "Ce n'est pas moi").
    setPwaFlag('welcomeBack', 'had-account');
    return null;
  }
  const close = (how: string) => {
    setPwaFlag('welcomeBack', how);
    setAnswered(true);
  };
  const app = isStandalone();
  const others = rememberedAccounts().filter((a) => a.id !== st.profile.id);
  if (others.length > 0) {
    const pick = async (a: RememberedAccount) => {
      if (busy) return;
      setBusy(a.id);
      try {
        await logIn(a.name, a.pin);
        close('switched');
        navigate('/', { replace: true });
      } catch (e) {
        setBusy(null);
        if (e instanceof ApiRequestError && e.code === 'bad-credentials') {
          close('login');
          navigate(`/login?name=${encodeURIComponent(a.name)}&stale=1`);
        } else actionFailed(e);
      }
    };
    return (
      <div className={cx(s.stuckLayer, s.pickLayer)} role="dialog" aria-modal="true" aria-labelledby="pwa-welcome-title" data-testid="pwa-welcome" data-welcome-pick>
        <div className={cx(s.stuckPanel, s.pickPanel)}>
          <h2 id="pwa-welcome-title" style={{ margin: 0, font: '400 30px/1 var(--font-display)', letterSpacing: '0.04em' }}>
            {t('players.title')}
          </h2>
          <p>{t('players.welcomeText')}</p>
          <div className={s.pickTiles}>
            <Suspense fallback={null}>
              <PlayerTiles accounts={others} busyId={busy} onPick={(a) => void pick(a)} avatarSize={72} />
            </Suspense>
          </div>
          <div className={s.welcomeButtons}>
            <Button color="green" size="lg" block onClick={() => close('new')} disabled={!!busy} data-welcome-new>
              {t('players.new')}
            </Button>
            <Button
              color="white"
              block
              onClick={() => {
                close('login');
                navigate('/login');
              }}
              disabled={!!busy}
              data-welcome-login
            >
              {t('players.have')}
            </Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={s.stuckLayer} role="dialog" aria-modal="true" aria-labelledby="pwa-welcome-title" data-testid="pwa-welcome" data-welcome-where={app ? 'app' : 'browser'}>
      <div className={s.stuckPanel}>
        <DruidMark size={96} tile className={s.homeIcon} />
        <h2 id="pwa-welcome-title" style={{ margin: 0, font: '400 30px/1 var(--font-display)', letterSpacing: '0.04em' }}>
          {app ? t('pwa.welcome.title') : t('pwa.welcome.browserTitle')}
        </h2>
        <p>{app ? t('pwa.welcome.text') : t('pwa.welcome.browserText')}</p>
        <div className={s.welcomeButtons}>
          <Button
            color="green"
            size="lg"
            block
            onClick={() => {
              close('login');
              navigate('/login');
            }}
            data-welcome-login
          >
            {t('pwa.welcome.yes')}
          </Button>
          <Button color="white" block onClick={() => close('new')} data-welcome-new>
            {t('pwa.welcome.no')}
          </Button>
        </div>
        <p className={s.hint}>{app ? t('pwa.welcome.hint') : t('pwa.welcome.browserHint')}</p>
      </div>
    </div>
  );
}

// wouter navigates with pushState/replaceState and dispatches events of those names (pwa/update.ts).
const PATH_EVENTS = ['popstate', 'pushState', 'replaceState'];
function subscribePath(fn: () => void): () => void {
  for (const ev of PATH_EVENTS) window.addEventListener(ev, fn);
  return () => {
    for (const ev of PATH_EVENTS) window.removeEventListener(ev, fn);
  };
}
function currentPath(): string {
  return typeof location !== 'undefined' ? location.pathname : '/';
}

export function PwaOverlay() {
  // Re-render on a language switch like the app does.
  usePlayer((x) => x.language);
  // A new kid on this device ("Ce n'est pas moi") reads the question's flag again.
  const kid = usePlayer((x) => x.state?.profile.id);
  return (
    <>
      <WelcomeBack key={kid ?? ''} />
      <UpdateMoment />
    </>
  );
}
