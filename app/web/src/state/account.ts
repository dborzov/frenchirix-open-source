// Switching player on a shared device (docs/intent.md, "Accounts"): the player selection (/players), the
// "Played before?" welcome and the login screen call these. Each throws when the server refused or could
// not be reached; nothing has changed then.
import { navigate } from 'wouter/use-browser-location';
import { api } from '../api';
import { clearFlags } from '../onboarding/storage';
import { forgetKid, setPwaFlag, stores } from '../pwa/stored';
import { forgetAccount } from './accounts';
import { usePlayer } from './player';

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';
  } catch {
    return 'America/Toronto';
  }
}

/**
 * Play as another account (POST /api/login with its name and PIN). The account left behind is forgotten
 * by this device when the server deleted it (it held nothing). The device's flags (tips seen, the
 * welcome) stay: they belong to the device, and the kid arriving has played before.
 */
export async function logIn(name: string, pin: string): Promise<void> {
  const before = usePlayer.getState().state?.profile.id;
  // Names have no spaces: « chinchilla farceur » is « chinchilla-farceur » (the server maps them too).
  const res = await api.login({ name: name.trim().replace(/\s+/g, '-'), pin, timeZone: timeZone() });
  if (res.previousDeleted && before && before !== res.state.profile.id) forgetAccount(before);
  usePlayer.getState().replace(res.state);
}

/**
 * "New player": ends this browser's session (POST /api/logout), forgets what the device kept for the
 * kid (not the list of accounts: the kid who leaves stays one tap away), and boots a new kid on Home.
 */
export async function newPlayer(): Promise<void> {
  const before = usePlayer.getState().state?.profile.id;
  const res = await api.logout();
  if (res?.deleted && before) forgetAccount(before);
  const { local, session } = stores();
  forgetKid(local, session);
  clearFlags();
  // The kid chose to start as someone new: "Played before?" would only ask it again.
  setPwaFlag('welcomeBack', 'new');
  navigate('/', { replace: true });
  await usePlayer.getState().boot();
}
