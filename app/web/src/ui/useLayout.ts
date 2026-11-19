import { useSyncExternalStore } from 'react';

export type Layout = 'phone' | 'tablet';

/** The breakpoint between the phone and tablet layouts (docs/app-architecture.md, "Client basics"). */
export const TABLET_MIN_WIDTH = 768;

const query = `(min-width: ${TABLET_MIN_WIDTH}px)`;

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(query);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function snapshot(): Layout {
  return window.matchMedia(query).matches ? 'tablet' : 'phone';
}

/** 'phone' under 768 px wide (one column, bottom tab bar), 'tablet' from 768 px (side rail, two panes). */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, snapshot, () => 'phone');
}
