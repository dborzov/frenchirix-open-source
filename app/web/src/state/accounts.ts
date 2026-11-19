// The accounts used on this device, for switching player on a shared device (docs/intent.md, "Accounts";
// docs/app-server.md, "Sessions and accounts"). The player selection (/players) lists them; tapping one
// logs in with its stored name and PIN, nothing to type. Kept in localStorage under `frx.accounts`:
// the device's, not one kid's (it survives "New player"). Every entry is updated whenever the state
// loads (state/player.ts), so the current account is always in the list. Storage may be missing or
// throw (a private window): then the list lives in memory for this page only.
import type { Profile } from '../../../shared/api';
import type { Avatar } from '../../../shared/catalog';

export interface RememberedAccount {
  id: string;
  name: string;
  pin: string;
  /** To draw the avatar small on the player selection. */
  avatar: Avatar;
  /** When it was last the current account on this device (ms): the oldest goes when the list is full. */
  at: number;
}

export const ACCOUNTS_KEY = 'frx.accounts';
/** Enough for a whole class sharing a set of tablets. */
export const MAX_ACCOUNTS = 30;

let memory: RememberedAccount[] = [];

function store(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function isAccount(v: unknown): v is RememberedAccount {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return typeof a.id === 'string' && typeof a.name === 'string' && typeof a.pin === 'string' && /^\d{3}$/.test(a.pin) && !!a.avatar && typeof a.avatar === 'object' && typeof a.at === 'number';
}

/** The accounts this device remembers, in the order they first came to it. Malformed entries are skipped. */
export function rememberedAccounts(): RememberedAccount[] {
  try {
    const raw = store()?.getItem(ACCOUNTS_KEY);
    if (raw) {
      const v: unknown = JSON.parse(raw);
      if (Array.isArray(v)) return v.filter(isAccount);
    }
  } catch {
    // unreadable: what this page kept
  }
  return memory.slice();
}

function save(list: RememberedAccount[]): void {
  memory = list;
  try {
    store()?.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  } catch {
    // full or blocked: memory only
  }
}

/** Remember an account as the server last sent it (name, PIN, avatar); it is now the current one. */
export function rememberAccount(p: Pick<Profile, 'id' | 'name' | 'pin' | 'avatar'>, now = Date.now()): void {
  const list = rememberedAccounts();
  const entry: RememberedAccount = { id: p.id, name: p.name, pin: p.pin, avatar: p.avatar, at: now };
  const i = list.findIndex((a) => a.id === p.id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  while (list.length > MAX_ACCOUNTS) {
    let oldest = -1;
    for (let k = 0; k < list.length; k++) if (list[k]!.id !== p.id && (oldest < 0 || list[k]!.at < list[oldest]!.at)) oldest = k;
    list.splice(oldest, 1);
  }
  save(list);
}

/** This device no longer offers the account (removed by a kid, or deleted by the server because it held nothing). */
export function forgetAccount(id: string): void {
  const list = rememberedAccounts();
  if (list.some((a) => a.id === id)) save(list.filter((a) => a.id !== id));
  else memory = memory.filter((a) => a.id !== id);
}

/** What the player selection shows: the remembered accounts, the current one always in and as the server sent it. */
export function accountsOnDevice(current: Pick<Profile, 'id' | 'name' | 'pin' | 'avatar'> | null): RememberedAccount[] {
  const list = rememberedAccounts();
  if (!current) return list;
  const mine: RememberedAccount = { id: current.id, name: current.name, pin: current.pin, avatar: current.avatar, at: Date.now() };
  const i = list.findIndex((a) => a.id === current.id);
  if (i >= 0) list[i] = mine;
  else list.push(mine);
  return list;
}

/** For tests: forget everything this page kept in memory. */
export function resetAccountsMemory(): void {
  memory = [];
}
