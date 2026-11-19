// Started by main.tsx before the app renders (one import line). Installs everything this module does
// on every screen: the stored-data rule, the update watch, chunk-failure recovery, Android's install
// prompt, and the overlay root for the update moments and the "Tu as déjà joué ?" question.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { usePlayer } from '../state/player';
import { installPromptWatch } from './install';
import { PwaOverlay } from './Overlay';
import { stores, sweepStorage } from './stored';
import { checkNow, installUpdateWatch } from './update';

function start(): void {
  const { local, session } = stores();
  sweepStorage(local, session);
  installUpdateWatch();
  installPromptWatch();

  const host = document.createElement('div');
  host.id = 'pwa-root';
  document.body.appendChild(host);
  createRoot(host).render(createElement(PwaOverlay));

  // Ask which build is deployed once the kid is known, whatever screen the app opens on.
  const unsub = usePlayer.subscribe((st) => {
    if (st.status !== 'ready') return;
    unsub();
    void checkNow();
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') start();
