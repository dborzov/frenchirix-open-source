// The translation hint bubble: ONE shared bubble for the whole app, shown when a piece of French is
// tapped for its meaning (the dialogue strip, GlossText, place-words, karaoke, any puzzle type).
//
//   hint.toggle(boxElement, { en: unit.en, note: unit.note });   // in the box's click handler
//   hint.hide();
//   useHintAnchor(el) / hint.isOpenFor(el)                         // draw the tapped box as selected
//
// The user's four rules (2026-11-14):
//  1. the bubble shows only the English (and a note), never the French;
//  2. its tail points at the tapped box: it sits just above or below the box where there is room,
//     never over it, never off screen, and follows the box when the layout moves;
//  3. tapping the bubble hides it;
//  4. any tap, drag or key anywhere else hides it (and that tap still does what it does).
// Plain DOM in a fixed layer (no React tree needed), positioned every animation frame while open.
import { useSyncExternalStore } from 'react';
import s from './HintBubble.module.css';

export interface HintContent {
  en: string; // the meaning in English, in that sense
  note?: string; // a note for a ten-year-old (cultural reference, wordplay)
  label?: string; // a small heading for a note bubble ("Le savais-tu ?")
  tone?: 'balloon' | 'caption'; // caption: a yellow note box (scene notes)
  /** The side to put it on when it fits there (place-words: above the tray, off the dialogue's gaps). */
  prefer?: 'above' | 'below';
}

export interface Placement {
  left: number; // bubble box, viewport px
  top: number;
  width: number;
  height: number;
  side: 'above' | 'below';
  tailX: number; // tail tip, viewport px
  tailY: number;
}

export const TAIL = 12; // px from the bubble's edge to the tail's tip
export const MARGIN = 8; // px kept from the viewport's edges

/**
 * Where the bubble goes for an anchor rectangle: below when it fits (or when there is more room
 * below), else above; centred on the anchor and clamped to the viewport; the tail tip touches the
 * anchor's edge at its centre (clamped inside the bubble's rounded corners).
 */
export function placeBubble(anchor: { left: number; top: number; width: number; height: number }, size: { width: number; height: number }, viewport: { width: number; height: number }, prefer?: Placement['side']): Placement {
  const width = Math.min(size.width, viewport.width - 2 * MARGIN);
  const height = size.height;
  const roomBelow = viewport.height - (anchor.top + anchor.height) - MARGIN;
  const roomAbove = anchor.top - MARGIN;
  const need = height + TAIL;
  const fits = (side: Placement['side']) => (side === 'below' ? roomBelow : roomAbove) >= need;
  const side: Placement['side'] = prefer && fits(prefer) ? prefer : roomBelow >= need || roomBelow >= roomAbove ? 'below' : 'above';
  const cx = anchor.left + anchor.width / 2;
  const left = Math.max(MARGIN, Math.min(viewport.width - MARGIN - width, cx - width / 2));
  const top = side === 'below' ? anchor.top + anchor.height + TAIL : anchor.top - TAIL - height;
  const tailX = Math.max(left + 18, Math.min(left + width - 18, cx));
  const tailY = side === 'below' ? anchor.top + anchor.height : anchor.top;
  return { left, top, width, height, side, tailX, tailY };
}

// ---- the single bubble ----------------------------------------------------------------------------

let root: HTMLDivElement | null = null;
let body: HTMLDivElement | null = null;
let tail: HTMLDivElement | null = null;
let anchor: Element | null = null;
let prefer: HintContent['prefer'];
let raf = 0;
let lastKey = '';
let last: { left: number; top: number; right: number; bottom: number; vw: number; vh: number } | null = null;
const listeners = new Set<(a: Element | null) => void>();

function ensure(): void {
  if (root?.isConnected) return;
  root = document.createElement('div');
  root.className = s.layer!;
  root.dataset.hintLayer = '';
  body = document.createElement('div');
  body.className = s.bubble!;
  body.dataset.bubble = ''; // the visible balloon (tests and e2e look for [data-bubble])
  body.setAttribute('role', 'status');
  body.setAttribute('aria-live', 'polite');
  tail = document.createElement('div');
  tail.className = s.tail!;
  tail.dataset.hintTail = '';
  root.append(body, tail);
  // Rule 3: tapping the bubble hides it, and the tap goes no further: the bubble catches its own taps
  // (pointer-events: auto on the balloon), so nothing under it is pressed. A tap that went through
  // could press "Je ne peux pas parler" or the record button under a bubble.
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    hide();
  });
  document.body.appendChild(root);
}

function emit(): void {
  for (const l of listeners) l(anchor);
}

// Rule 4: any interaction elsewhere hides it. Capture phase, so the tap still reaches its target.
function onOutside(e: Event): void {
  if (!anchor || !root) return;
  const t = e.target as Node | null;
  if (t && (root.contains(t) || anchor.contains(t))) return; // the bubble itself, or its box (the box toggles)
  hide();
}
function onKey(e: KeyboardEvent): void {
  if (!anchor) return;
  if (e.key === 'Enter' || e.key === ' ') {
    if (anchor.contains(document.activeElement)) return; // the box's own keyboard toggle
  }
  hide();
}

function frame(): void {
  raf = 0;
  if (!anchor || !root || !body || !tail) return;
  if (!anchor.isConnected) {
    hide();
    return;
  }
  const r = anchor.getBoundingClientRect();
  // Off screen entirely (scrolled away): hide the drawing but keep following.
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  // Follow real moves (wrap, scroll, a drawer opening) but not a box's own pulse or pop (a few px
  // of scale): a bubble that jitters with its box is unpleasant to read.
  const near = (a: number, b: number) => Math.abs(a - b) <= 4;
  const moved = !last || !near(r.left, last.left) || !near(r.top, last.top) || !near(r.right, last.right) || !near(r.bottom, last.bottom) || vw !== last.vw || vh !== last.vh;
  if (moved || lastKey === '') {
    lastKey = 'placed';
    last = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw, vh };
    body.style.maxWidth = `${Math.min(340, vw - 2 * MARGIN)}px`;
    // Never taller than the room on the roomier side of the box: a long note scrolls inside the bubble
    // (a 375×667 phone once cut the top of one off, with no way to read it).
    body.style.maxHeight = `${Math.max(96, Math.max(r.top, vh - r.bottom) - MARGIN - TAIL)}px`;
    const size = { width: body.offsetWidth, height: body.offsetHeight };
    const p = placeBubble(r, size, { width: vw, height: vh }, prefer);
    root.style.visibility = r.bottom < 0 || r.top > vh ? 'hidden' : 'visible';
    body.style.transform = `translate(${p.left}px, ${p.top}px)`;
    tail.style.transform = `translate(${p.tailX - TAIL}px, ${p.side === 'below' ? p.tailY : p.tailY - TAIL}px)`;
    tail.dataset.side = p.side;
    root.dataset.side = p.side;
    root.dataset.tipX = String(Math.round(p.tailX));
    root.dataset.tipY = String(Math.round(p.tailY));
  }
  raf = requestAnimationFrame(frame);
}

export function show(el: Element, content: HintContent): void {
  if (typeof document === 'undefined') return;
  ensure();
  if (!body || !root) return;
  anchor = el;
  prefer = content.prefer;
  lastKey = '';
  last = null;
  body.replaceChildren();
  body.className = `${s.bubble} ${content.tone === 'caption' ? s.caption : ''}`;
  if (content.label) {
    const l = document.createElement('span');
    l.className = s.label!;
    l.textContent = content.label;
    body.appendChild(l);
  }
  if (content.en) {
    const en = document.createElement('span');
    en.className = s.en!;
    en.textContent = content.en;
    en.lang = 'en';
    body.appendChild(en);
  }
  // Several notes (joined by a blank line) each get their own block, with a rule between them.
  for (const text of (content.note ?? '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
    const n = document.createElement('span');
    n.className = s.note!;
    n.textContent = text;
    n.lang = 'en';
    n.dataset.bubbleNote = '';
    body.appendChild(n);
  }
  root.hidden = false;
  root.classList.remove(s.pop!);
  void root.offsetWidth; // restart the pop
  root.classList.add(s.pop!);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('wheel', onOutside, { capture: true, passive: true });
  if (raf) cancelAnimationFrame(raf);
  frame(); // places it now and keeps following every frame
  emit();
}

export function hide(): void {
  if (!anchor) return;
  anchor = null;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (root) root.hidden = true;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('wheel', onOutside, true);
  emit();
}

/** Show for this box, or hide when it is already showing for it. Returns true when now open. */
export function toggle(el: Element, content: HintContent): boolean {
  if (anchor === el) {
    hide();
    return false;
  }
  show(el, content);
  return true;
}

export function isOpenFor(el: Element | null): boolean {
  return !!el && anchor === el;
}

export function openAnchor(): Element | null {
  return anchor;
}

export function subscribe(l: (a: Element | null) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const hint = { show, hide, toggle, isOpenFor, openAnchor, subscribe };

/** The element the bubble is open for (re-renders when it changes): draw that box as selected. */
export function useHintAnchor(): Element | null {
  return useSyncExternalStore(
    (cb) => subscribe(() => cb()),
    () => anchor,
    () => null,
  );
}
