// Per-device memory for onboarding (welcome seen, tips seen, invitation dismissed). Browser storage
// can be missing or throw (private mode): every access is guarded and the app works without it.
const PREFIX = 'frenchirix.onb.';
const memory = new Map<string, string>();

export function getFlag(key: string): string | null {
  try {
    const v = window.localStorage.getItem(PREFIX + key);
    if (v !== null) return v;
  } catch {
    // fall through to memory
  }
  return memory.get(key) ?? null;
}

export function setFlag(key: string, value = '1'): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // memory only
  }
}

export function clearFlags(): void {
  memory.clear();
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) window.localStorage.removeItem(k);
    }
  } catch {
    // nothing stored
  }
}
