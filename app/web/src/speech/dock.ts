// The microphone's dock: on a phone (and a tablet held sideways) every speaking puzzle type puts
// « Je ne peux pas parler », the note after a take and the compact microphone control in a box stuck
// to the bottom of the puzzle (SpeakPanel, say-chain; say-choice has its own), so the control can never
// scroll away and the French being said stays readable above it while the microphone listens. The tall
// control under a long line once pushed most of the line off the top of a phone (a 9-box line on
// 375x667, an act-line on 390x844).
//
// The French to keep readable is marked `data-speak-keep` (or is a TargetStrip, `data-target-strip`);
// keepAboveDock scrolls the puzzle just enough to show it above the dock, never past its first row.

/**
 * Whether the microphone sits in the dock: on a phone, and on a tablet held sideways (under 900 px
 * high, where the full control under a long line pushed its first rows off the top: 1180x820). An
 * upright tablet keeps the full control: the whole line and the control fit (768x1024 and up).
 */
export const micDocked = (layout: 'phone' | 'tablet') => layout === 'phone' || (typeof window !== 'undefined' && window.innerHeight < 900);

const KEEP = '[data-speak-keep], [data-target-strip]';

function scrollBox(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/** Scrolls the puzzle so that its French (KEEP) shows above the dock: its bottom just above it, or its top at the top when it is taller than the room. */
export function keepAboveDock(from: Element | null, smooth = false): void {
  const pane = from?.closest('[data-puzzle-pane]') ?? document.querySelector('[data-puzzle-pane]');
  const dock = pane?.querySelector('[data-mic-dock]');
  const keeps = pane ? [...pane.querySelectorAll(KEEP)] : [];
  if (!dock || !keeps.length) return;
  const box = scrollBox(dock);
  if (!box) return;
  const rects = keeps.map((k) => k.getBoundingClientRect());
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const room = 12;
  const roof = box.getBoundingClientRect().top + room;
  const floor = dock.getBoundingClientRect().top - room;
  let dy = 0;
  if (bottom > floor) dy = bottom - floor; // under the dock: up, just enough
  if (top - dy < roof) dy = top - roof; // never past its first row (taller than the room: its top at the top)
  if (Math.abs(dy) >= 1) box.scrollBy({ top: dy, behavior: smooth ? 'smooth' : 'auto' });
}
