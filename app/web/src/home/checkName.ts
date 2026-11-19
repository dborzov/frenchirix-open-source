// Instant feedback on a name the kid types. Uses checkName from shared/catalog/badwords.ts (the
// server agent's file) as soon as it exists; until then a local fallback checks length and
// characters only. The server is the authority either way (rude words, uniqueness).
import { NAME_MAX, NAME_MIN, NAME_RE } from '../../../shared/rules';

export type NameCheck = { ok: true } | { ok: false; reason: 'length' | 'chars' | 'rude' };
type CheckName = (name: string) => NameCheck;

// import.meta.glob matches nothing (and imports nothing) while the file does not exist.
const found = import.meta.glob<{ checkName?: CheckName }>('../../../shared/catalog/badwords.ts', { eager: true });
const shared = Object.values(found)[0]?.checkName;

export function fallbackCheckName(name: string): NameCheck {
  const n = name.trim();
  const len = [...n].length;
  if (len < NAME_MIN || len > NAME_MAX) return { ok: false, reason: 'length' };
  if (!NAME_RE.test(n)) return { ok: false, reason: 'chars' };
  return { ok: true };
}

export function checkName(name: string): NameCheck {
  return shared ? shared(name.trim()) : fallbackCheckName(name);
}

export const usingSharedCheckName = Boolean(shared);
