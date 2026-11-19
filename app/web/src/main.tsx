import '@fontsource/bangers/latin-400.css';
import '@fontsource/bangers/latin-ext-400.css';
import '@fontsource/comic-neue/latin-400.css';
import '@fontsource/comic-neue/latin-700.css';
// Install, update and stored-data rules on every screen (docs/app-release.md, "Updates"); first, before the app.
import './pwa/boot';
import './ui/tokens.css';
import './ui/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { t } from '../../shared/i18n';
import { errorDetail } from './api/errors';
import { audio, onPlayError } from './audio';
import { installLogging, log } from './log';
import { toast } from './ui';

// The activity log: batches to POST /api/log, uncaught errors, the console's errors (docs/app-architecture.md).
installLogging();

// Browsers only allow audio after a user gesture: unlock the engine on the first touch. A touch's
// pointerdown is not a user activation (touchend and click are; iOS needs the silent buffer played
// inside one of those), so every kind of first gesture unlocks; unlock() is safe to call again.
for (const ev of ['pointerdown', 'touchend', 'click', 'keydown'] as const) window.addEventListener(ev, () => void audio.unlock(), { once: true, capture: true, passive: true });

// A play whose clip failed to load says so (docs/app-games.md, "Loading media"): the kid's message and
// the admin's detail line, never silence; tapping again is the retry. Once per clip in a few seconds, so a
// step that moves on and plays the same clip again does not pile up toasts.
const toldAt = new Map<string, number>();
onPlayError((e) => {
  log('media-fail', { reason: e.reason, status: e.status, src: e.src, where: 'play' });
  const now = Date.now();
  if (now - (toldAt.get(e.src) ?? 0) < 5000) return;
  toldAt.set(e.src, now);
  toast(t('common.fail.mediaPlay'), { detail: errorDetail(e), tag: 'media-failed' });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
