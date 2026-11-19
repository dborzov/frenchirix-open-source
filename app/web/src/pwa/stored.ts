// What the client keeps in localStorage and sessionStorage, and the rule that keeps it safe across
// updates (docs/app-release.md, "Updates").
//
// Every key the app writes is listed in STORED_KEYS with a policy:
//   reset    discarded when STORE_SCHEMA changes, and whenever its shape is wrong (a resumable
//            practice's progress, settings that are only conveniences);
//   flag     a tiny string ('1', a date); kept;
//   drop     written by an earlier build and no longer used: removed at start (the old queues of
//            practice saves, replaced by saving before the kid moves on; the plan copy).
// `kid: true` marks what belongs to the kid rather than the device: "Ce n'est pas moi" (forgetKid)
// removes it, so the next kid on a shared device starts clean; the device's own settings (mute, the
// install offer, the schema) stay.
// STORE_SCHEMA is stored under `frx.store.schema`. Raise it when a release changes the shape of a
// stored value: on the next start every `reset` key is dropped. Nothing stored is precious: the server
// holds every finished puzzle (docs/app-architecture.md, "Errors").
//
// Namespaces: v2 writes only `frx.*` and `frenchirix.*`. The v1 site at the same address used
// unprefixed keys (playerCards, playerQuests, questFinished, questStarted, todaysChallenges, lastCheck,
// cardClaimedDate): they cannot collide, and they are left alone.

export const STORE_SCHEMA = 1;
export const SCHEMA_KEY = 'frx.store.schema';

type Area = 'local' | 'session';
type Policy = 'reset' | 'flag' | 'drop';

export interface StoredKey {
  /** The exact key, or a prefix ending in '.' or '.*'. */
  key: string;
  area: Area;
  policy: Policy;
  /** For reset: is the parsed value well-formed? */
  valid?: (v: unknown) => boolean;
  /** The kid's, not the device's: removed by forgetKid(). */
  kid?: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const STORED_KEYS: StoredKey[] = [
  // practice/storage.ts
  { key: 'frx.practice.progress.*', area: 'session', policy: 'reset', kid: true, valid: (v) => isObj(v) && typeof v.puzzleIndex === 'number' && Array.isArray(v.outcomes) },
  { key: 'frx.practice.pending', area: 'local', policy: 'drop' },
  { key: 'frx.practice.progressPending', area: 'local', policy: 'drop' },
  { key: 'frx.practice.plan.*', area: 'session', policy: 'drop' },
  // speech/useRecorder.ts, onboarding/storage.ts, screens/Episodes.tsx, audio/engine.ts
  { key: 'frx.mic.intro', area: 'local', policy: 'flag', kid: true },
  { key: 'frx.karaoke.intro', area: 'local', policy: 'flag', kid: true }, // the karaoke's own first-time notice (what is kept)
  { key: 'frenchirix.onb.*', area: 'local', policy: 'flag', kid: true },
  { key: 'frenchirix.episodes.mode', area: 'local', policy: 'flag', kid: true },
  { key: 'frx.muted', area: 'local', policy: 'flag' },
  // state/accounts.ts: the accounts used on this device (the device's, not one kid's; read defensively)
  { key: 'frx.accounts', area: 'local', policy: 'flag' },
  // log/index.ts: this tab's id in the activity log
  { key: 'frx.log.tab', area: 'session', policy: 'flag' },
  // this module and pwa/
  { key: SCHEMA_KEY, area: 'local', policy: 'flag' },
  { key: 'frx.pwa.welcomeBack', area: 'local', policy: 'flag', kid: true },
  { key: 'frx.pwa.*', area: 'local', policy: 'flag' },
  { key: 'frx.pwa.*', area: 'session', policy: 'flag' },
];

function matches(def: StoredKey, key: string): boolean {
  return def.key.endsWith('.*') ? key.startsWith(def.key.slice(0, -1)) : def.key === key;
}

/** The definition of a stored key, if it is one of ours (the first that matches). */
export function definitionOf(area: Area, key: string): StoredKey | undefined {
  return STORED_KEYS.find((d) => d.area === area && matches(d, key));
}

function keysOf(store: Storage): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k !== null) out.push(k);
  }
  return out;
}

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export interface SweepReport {
  removed: string[];
}

/** Apply the rule once at start-up: drop obsolete keys, `reset` keys when the schema changed, malformed values; record the schema. */
export function sweepStorage(local: Storage | undefined, session: Storage | undefined, schema = STORE_SCHEMA): SweepReport {
  const report: SweepReport = { removed: [] };
  let stored: number | null = null;
  try {
    const raw = local?.getItem(SCHEMA_KEY);
    stored = raw === null || raw === undefined ? null : Number(raw);
  } catch {
    return report; // storage unusable: nothing to sweep
  }
  // No schema yet: a device from before this rule. Its shapes are those of schema 1.
  const changed = stored !== null && stored !== schema;
  const sweep = (store: Storage | undefined, area: Area) => {
    if (!store) return;
    let keys: string[];
    try {
      keys = keysOf(store);
    } catch {
      return;
    }
    for (const k of keys) {
      const def = definitionOf(area, k);
      if (!def || def.policy === 'flag') continue; // not ours (v1 keys), or a flag
      try {
        if (def.policy === 'drop' || changed || !(def.valid?.(parse(store.getItem(k))) ?? true)) {
          store.removeItem(k);
          report.removed.push(k);
        }
      } catch {
        // one bad key must not stop the others
      }
    }
  };
  sweep(local, 'local');
  sweep(session, 'session');
  try {
    if (stored !== schema) local?.setItem(SCHEMA_KEY, String(schema));
  } catch {
    // full or blocked
  }
  return report;
}

/** "Ce n'est pas moi": remove everything that belongs to the kid (`kid: true`), keep the device's settings. */
export function forgetKid(local: Storage | undefined, session: Storage | undefined): string[] {
  const removed: string[] = [];
  for (const [store, area] of [[local, 'local'], [session, 'session']] as const) {
    if (!store) continue;
    try {
      for (const k of keysOf(store)) {
        if (!definitionOf(area, k)?.kid) continue;
        store.removeItem(k);
        removed.push(k);
      }
    } catch {
      // blocked storage: nothing was kept anyway
    }
  }
  return removed;
}

/** Guarded access to the two stores (either may be missing or throw in private mode). */
export function stores(): { local: Storage | undefined; session: Storage | undefined } {
  const get = (name: 'localStorage' | 'sessionStorage') => {
    try {
      return typeof window !== 'undefined' ? window[name] : undefined;
    } catch {
      return undefined;
    }
  };
  return { local: get('localStorage'), session: get('sessionStorage') };
}

/** A per-device flag of the pwa module (`frx.pwa.<name>`). */
export function pwaFlag(name: string): string | null {
  try {
    return stores().local?.getItem(`frx.pwa.${name}`) ?? null;
  } catch {
    return null;
  }
}
export function setPwaFlag(name: string, value = '1'): void {
  try {
    stores().local?.setItem(`frx.pwa.${name}`, value);
  } catch {
    // memory only: the offer may show again, never a problem
  }
}
