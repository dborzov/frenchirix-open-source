// Installing the app: are we running installed, which platform, and Android's install prompt.
// (docs/app-release.md, "Installing".) Android/Chrome fires `beforeinstallprompt` when the page is installable; we
// keep the event and fire it from the kid's tap. iOS and iPadOS have no prompt: the panel shows the
// Share -> "Sur l'écran d'accueil" steps instead.

export type Platform = 'ios' | 'android' | 'other';

/** Running as an installed app (home-screen icon), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches) return true;
  } catch {
    // old browsers
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true; // iOS Safari
}

/** iPhone, iPad (iPadOS reports itself as a Mac with touch), Android, or anything else. */
export function detectPlatform(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0): Platform {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && touchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

/** iPad (for the steps: the Share button sits at the top right of Safari's toolbar). */
export function isIpad(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0): boolean {
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

/** Safari itself (not Chrome or Firefox on iOS, which add to the home screen from their own menus). */
export function isIosSafari(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True when Android's install prompt can be shown from a tap. */
export function canPrompt(): boolean {
  return deferred !== null;
}
export function justInstalled(): boolean {
  return installedNow;
}

/** Show the browser's install prompt. Resolves with what the kid chose. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null; // a prompt event can be used once
  notify();
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}

let installed = false;
/** Listen for the prompt from the start: it can fire before any screen mounts (pwa/boot.ts). */
export function installPromptWatch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // no mini-infobar: we offer it in our own panel
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    notify();
  });
}
