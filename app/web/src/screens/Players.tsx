// Route /players: the player selection, for several kids sharing one device and one browser
// (docs/intent.md, "Accounts"). The accounts this device remembers (state/accounts.ts): tap one to play
// as it, logging in with its stored name and PIN, nothing to type; "New player"; "I have an account"
// (name + PIN for an account not on this device, /login); and removing an account from this device.
// Reached from the profile's "Switch player"; never from a practice (no tab bar there).
import { useState } from 'react';
import { useLocation } from 'wouter';
import { t } from '../../../shared/i18n';
import { ApiRequestError } from '../api';
import { fx } from '../fx';
import { isEmptyAccount } from '../pwa/Overlay';
import { logIn, newPlayer } from '../state/account';
import { accountsOnDevice, forgetAccount, type RememberedAccount } from '../state/accounts';
import { usePlayerState } from '../state/player';
import { actionFailed } from '../state/recover';
import { Caption } from '../home/comic';
import { Button, cx, IconButton, Modal, toast, useLayout } from '../ui';
import { PlayerTiles } from './PlayerTiles';
import s from './Players.module.css';

/** The login screen, prefilled, when a stored name no longer works (renamed on another device). */
export function staleLoginPath(name: string): string {
  return `/login?name=${encodeURIComponent(name)}&stale=1`;
}

export default function PlayersScreen() {
  const st = usePlayerState();
  const tablet = useLayout() === 'tablet';
  const [, navigate] = useLocation();
  const [accounts, setAccounts] = useState(() => accountsOnDevice(st.profile));
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<RememberedAccount | null>(null);

  const back = () => (history.length > 1 ? history.back() : navigate('/profile'));

  const pick = async (a: RememberedAccount) => {
    if (busy) return;
    if (a.id === st.profile.id) {
      navigate('/');
      return;
    }
    setBusy(a.id);
    try {
      await logIn(a.name, a.pin);
      fx.sfx('win');
      navigate('/', { replace: true });
    } catch (e) {
      setBusy(null);
      fx.sfx('wrong');
      if (e instanceof ApiRequestError && e.code === 'bad-credentials') navigate(staleLoginPath(a.name));
      else actionFailed(e);
    }
  };

  const fresh = async () => {
    if (busy) return;
    // An account that holds nothing is already a new player.
    if (isEmptyAccount(st)) {
      navigate('/');
      return;
    }
    setBusy('new');
    try {
      await newPlayer();
    } catch (e) {
      setBusy(null);
      actionFailed(e);
    }
  };

  const remove = () => {
    if (!removing) return;
    forgetAccount(removing.id);
    setAccounts(accountsOnDevice(st.profile));
    toast(t('players.removed', { name: removing.name }), { color: 'white', icon: 'check' });
    setRemoving(null);
  };

  return (
    <div className={cx(s.page, tablet && s.tablet)} data-players>
      <div className={s.top}>
        <IconButton icon="back" label={t('common.back')} onClick={back} />
        <Caption as="h1" tilt={-2} className={s.title}>
          {t('players.title')}
        </Caption>
      </div>
      <p className={s.text}>{t('players.text')}</p>
      <PlayerTiles accounts={accounts} currentId={st.profile.id} busyId={busy} onPick={(a) => void pick(a)} onRemove={setRemoving} avatarSize={tablet ? 150 : 84} className={s.tiles} />
      <div className={s.actions}>
        <Button color="accent-2" size="lg" icon="plus" onClick={() => void fresh()} loading={busy === 'new'} disabled={!!busy && busy !== 'new'} data-players-new>
          {t('players.new')}
        </Button>
        <Button color="white" size="lg" icon="lock" onClick={() => navigate('/login')} disabled={!!busy} data-players-login>
          {t('players.have')}
        </Button>
      </div>
      <Modal open={!!removing} onClose={() => setRemoving(null)} title={removing ? t('players.remove.title', { name: removing.name }) : ''}>
        {removing && (
          <div className={s.removeBody} data-remove>
            <p className={s.removeText}>{t('players.remove.text', { name: removing.name })}</p>
            <dl className={s.card}>
              <dt>{t('profile.leave.name')}</dt>
              <dd>{removing.name}</dd>
              <dt>{t('profile.leave.pin')}</dt>
              <dd className={s.pin}>{removing.pin}</dd>
            </dl>
            <p className={s.note}>{t('profile.leave.note')}</p>
            <Button color="tomato" size="lg" block icon="close" onClick={remove} data-remove-go>
              {t('players.remove.go')}
            </Button>
            <Button color="white" block onClick={() => setRemoving(null)} data-remove-keep>
              {t('players.remove.keep')}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
