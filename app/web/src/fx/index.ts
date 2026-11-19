// The effects kit: everything a puzzle type calls in one line so all puzzle types feel like one toy.
//
//   fx.burst(el, 'star')            particles from an element or a point { x, y }
//   fx.confetti()                   confetti rain from the top
//   fx.pop(el) / fx.wobble(el)      a right move / a wrong move on an element
//   fx.shake()                      screen shake (or fx.shake(el))
//   fx.floatText(el, t('practice.fx.bravo'))   text floating up from an element
//   fx.combo(3)                     the streak flash for 3 right moves in a row
//   fx.impact('PAF !', el)          comic impact: jagged burst + sound word + speed lines (+ flash, shake when big)
//   fx.oops(el)                     a small "OUPS !" for a wrong move (never a scolding)
//   fx.celebrate()                  full-screen celebration (end of a practice)
//   fx.sfx('right')                 a sound effect (audio engine's effects bus; never stops the French)
//   fx.haptic()                     a light tick where navigator.vibrate exists
//   fx.right(el) / fx.wrong(el)     the standard bundles: pop+burst+sound+tick, wobble+sound+tick
//
// Canvas particles + the Web Animations API, no library. Honours prefers-reduced-motion with a
// calmer set (fewer particles, no shake, fades instead of jumps). Never catches taps (--z-fx).
import { t } from '../../../shared/i18n';
import { audio, type SfxName } from '../audio';
import { makeImpact, type ImpactOpts } from './impact';
import { clearParticles, emit, particleCount, type ParticleKind } from './particles';

export type { ImpactOpts } from './impact';

export type { SfxName } from '../audio';
export type { ParticleKind } from './particles';

export type Point = { x: number; y: number };
export type Target = Element | Point;
export type BurstKind = ParticleKind;

export interface BurstOpts {
  kind?: BurstKind;
  color?: string; // one CSS colour (hex) for every particle
  colors?: string[];
  count?: number;
}

export interface FxKit {
  confetti(opts?: { x?: number; y?: number; count?: number }): void;
  /** Particles from an element (its centre) or a point. The second argument is a kind or options. */
  burst(target: Target, opts?: BurstKind | BurstOpts): void;
  /** A wrong move on an element, or the whole screen without one. */
  shake(el?: Element): void;
  /** A right move: pop and bounce. */
  pop(el: Element): void;
  /** A softer wrong move: a wobble. */
  wobble(el: Element): void;
  /** Text floating up from an element or point ("+10 XP", "Bravo !"). */
  floatText(target: Target, text: string, opts?: { color?: string; size?: number }): void;
  /** The flash for n right moves in a row (n >= 2). */
  combo(n: number, at?: Target): void;
  /**
   * A comic impact: a jagged burst slamming in with a French sound word (default: a random one of
   * PAF ! BOUM ! BING ! TCHAC ! WAOUH ! BRAVO !), speed lines, stars; size 'lg' adds a flash and a shake.
   * Without a target it lands in the upper middle of the screen.
   */
  impact(word?: string, at?: Target, opts?: ImpactOpts): void;
  /** A small, friendly wrong-move word ("OUPS !", "HEIN ?") by an element, with a wobble. */
  oops(el: Element): void;
  /** A random right-move sound word. */
  soundWord(): string;
  /** Full-screen celebration: confetti from both sides, stars, a big word. */
  celebrate(text?: string): void;
  /** A cheer word for how it went: 0 mistakes "Parfait !", else "Bravo !" / "Super !" / "Bien joué !". */
  cheer(mistakes?: number): string;
  sfx(name: SfxName): void;
  haptic(ms?: number | number[]): void;
  /** Bundle: pop + small impact with a sound word + 'right' sound + tick. */
  right(el: Element): void;
  /** Bundle: wobble + "OUPS !" + 'wrong' sound + tick. */
  wrong(el: Element): void;
  reducedMotion(): boolean;
  /** For tests: particles alive now. */
  particleCount(): number;
  clear(): void;
}

function reduced(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function pointOf(target: Target): Point {
  if ('x' in target && 'y' in target && !(target instanceof Element)) return target;
  const r = (target as Element).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function animate(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  try {
    return (el as HTMLElement).animate?.(frames, opts) ?? null;
  } catch {
    return null;
  }
}

let overlay: HTMLDivElement | null = null;
function layer(): HTMLDivElement | null {
  if (overlay?.isConnected) return overlay;
  if (typeof document === 'undefined') return null;
  overlay = document.createElement('div');
  overlay.dataset.fx = 'overlay';
  overlay.setAttribute('aria-hidden', 'true');
  Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 'var(--z-fx, 500)', overflow: 'hidden' });
  document.body.appendChild(overlay);
  return overlay;
}

function textEl(text: string, color: string, size: number): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = text;
  Object.assign(d.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    fontFamily: 'var(--font-display)',
    fontSize: `${size}px`,
    lineHeight: '1',
    color,
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
    WebkitTextStroke: `${Math.max(2, size / 12)}px #111`,
    paintOrder: 'stroke fill',
    textShadow: '3px 3px 0 #111',
    willChange: 'transform, opacity',
  } as Partial<CSSStyleDeclaration>);
  return d;
}

const CHEER_KEYS = ['practice.fx.bravo', 'practice.fx.super', 'practice.fx.wellDone', 'practice.fx.great'] as const;
let cheerIdx = 0;
const SOUND_KEYS = ['practice.fx.paf', 'practice.fx.boum', 'practice.fx.bing', 'practice.fx.tchac', 'practice.fx.waouh', 'practice.fx.bravo'] as const;
const OOPS_KEYS = ['practice.fx.oops', 'practice.fx.hein'] as const;
let soundIdx = Math.floor(Math.random() * 6);

function slam(el: HTMLElement, x: number, y: number, tilt: number, holdMs: number, calm: boolean): void {
  const at = (s: number, r: number) => `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${r}deg) scale(${s})`;
  const total = 160 + holdMs + 160;
  const frames: Keyframe[] = calm
    ? [
        { transform: at(1, tilt), opacity: 0 },
        { transform: at(1, tilt), opacity: 1, offset: 0.1 },
        { transform: at(1, tilt), opacity: 1, offset: 0.85 },
        { transform: at(1, tilt), opacity: 0 },
      ]
    : [
        { transform: at(0.15, tilt - 25), opacity: 0 },
        { transform: at(1.22, tilt + 3), opacity: 1, offset: 90 / total },
        { transform: at(0.96, tilt - 1), opacity: 1, offset: 150 / total },
        { transform: at(1, tilt), opacity: 1, offset: (160 + holdMs) / total },
        { transform: at(1.35, tilt + 6), opacity: 0 },
      ];
  el.style.transform = at(1, tilt);
  const a = animate(el, frames, { duration: total, easing: 'linear', fill: 'forwards' });
  if (a) a.onfinish = () => el.remove();
  else setTimeout(() => el.remove(), total);
}

function flashFrame(): void {
  const root = layer();
  if (!root) return;
  const f = document.createElement('div');
  Object.assign(f.style, { position: 'absolute', inset: '0', background: '#FFFFFF' });
  root.appendChild(f);
  const a = animate(f, [{ opacity: 0.85 }, { opacity: 0.85, offset: 0.35 }, { opacity: 0 }], { duration: 110, fill: 'forwards' });
  if (a) a.onfinish = () => f.remove();
  else setTimeout(() => f.remove(), 110);
}

export const fx: FxKit = {
  confetti(opts = {}) {
    const calm = reduced();
    const count = calm ? 24 : (opts.count ?? 140);
    if (opts.x !== undefined || opts.y !== undefined) {
      emit({ x: opts.x ?? window.innerWidth / 2, y: opts.y ?? window.innerHeight / 3, kind: 'confetti', count, speed: 650, spread: Math.PI * 0.9, gravity: 520, life: 2.4, size: 16 });
      return;
    }
    emit({ x: window.innerWidth / 2, y: -20, width: window.innerWidth, kind: 'confetti', count, speed: 120, angle: Math.PI / 2, spread: 1, gravity: 260, life: 3.2, size: 16 });
  },

  burst(target, opts) {
    const o: BurstOpts = typeof opts === 'string' ? { kind: opts } : (opts ?? {});
    const kind = o.kind ?? 'star';
    const p = pointOf(target);
    const calm = reduced();
    const count = Math.round((o.count ?? (kind === 'coin' ? 12 : kind === 'spark' ? 18 : 14)) * (calm ? 0.35 : 1));
    emit({
      ...p,
      kind,
      count,
      colors: o.colors ?? (o.color ? [o.color] : undefined),
      speed: calm ? 160 : kind === 'spark' ? 520 : 420,
      gravity: kind === 'spark' ? 200 : kind === 'coin' ? 1100 : 700,
      life: kind === 'spark' ? 0.5 : 1,
      size: kind === 'coin' ? 26 : kind === 'spark' ? 20 : 22,
    });
  },

  shake(el) {
    const target = el ?? document.getElementById('root') ?? document.body;
    if (reduced()) {
      animate(target, [{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }], { duration: 240 });
      return;
    }
    const a = el ? 8 : 10;
    animate(
      target,
      [0, -a, a, -a * 0.8, a * 0.6, -a * 0.3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 380, easing: 'ease-out' },
    );
  },

  pop(el) {
    const calm = reduced();
    animate(
      el,
      calm
        ? [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }]
        : [{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: 0.35 }, { transform: 'scale(0.94)', offset: 0.7 }, { transform: 'scale(1)' }],
      { duration: calm ? 200 : 360, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    );
  },

  wobble(el) {
    if (reduced()) {
      animate(el, [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: 260 });
      return;
    }
    animate(
      el,
      [0, -9, 8, -6, 4, -2, 0].map((d, i) => ({ transform: `rotate(${d}deg) translateX(${i % 2 ? 4 : -4}px)` })),
      { duration: 460, easing: 'ease-out' },
    );
  },

  floatText(target, text, opts = {}) {
    const root = layer();
    if (!root) return;
    const p = pointOf(target);
    const d = textEl(text, opts.color ?? 'var(--yellow)', opts.size ?? 30);
    root.appendChild(d);
    const w = d.offsetWidth;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, p.x - w / 2));
    const y = p.y - (opts.size ?? 30) / 2;
    const calm = reduced();
    const rise = calm ? 10 : 70;
    const anim = animate(
      d,
      [
        { transform: `translate(${x}px, ${y}px) scale(${calm ? 1 : 0.4})`, opacity: 0 },
        { transform: `translate(${x}px, ${y - rise * 0.3}px) scale(${calm ? 1 : 1.15})`, opacity: 1, offset: 0.2 },
        { transform: `translate(${x}px, ${y - rise * 0.6}px) scale(1)`, opacity: 1, offset: 0.65 },
        { transform: `translate(${x}px, ${y - rise}px) scale(1)`, opacity: 0 },
      ],
      { duration: 1100, easing: 'ease-out', fill: 'forwards' },
    );
    const done = () => d.remove();
    if (anim) anim.onfinish = done;
    else setTimeout(done, 1100);
  },

  combo(n, at) {
    if (n < 2) return;
    const root = layer();
    if (!root) return;
    const text = t('practice.fx.combo', { n });
    const d = textEl(text, '#FFD21F', 44);
    root.appendChild(d);
    const w = d.offsetWidth;
    const x = (window.innerWidth - w) / 2;
    const y = window.innerHeight * 0.28;
    const calm = reduced();
    const anim = animate(
      d,
      [
        { transform: `translate(${x}px, ${y}px) scale(0.2) rotate(-12deg)`, opacity: 0 },
        { transform: `translate(${x}px, ${y}px) scale(${calm ? 1 : 1.25}) rotate(4deg)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${x}px, ${y}px) scale(1) rotate(-2deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(${x}px, ${y - 20}px) scale(0.9) rotate(0deg)`, opacity: 0 },
      ],
      { duration: 1000, easing: 'ease-out', fill: 'forwards' },
    );
    if (anim) anim.onfinish = () => d.remove();
    else setTimeout(() => d.remove(), 1000);
    const flash = document.createElement('div');
    Object.assign(flash.style, { position: 'absolute', inset: '0', background: 'repeating-conic-gradient(from 0deg at 50% 30%, rgb(255 210 31 / 0.35) 0deg 6deg, transparent 6deg 18deg)' });
    root.appendChild(flash);
    const fa = animate(flash, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: 600, fill: 'forwards' });
    if (fa) fa.onfinish = () => flash.remove();
    else setTimeout(() => flash.remove(), 600);
    fx.burst(at ?? { x: window.innerWidth / 2, y: y + 22 }, { kind: 'spark', count: 10 + n * 3, colors: ['#FFD21F', '#E8303A', '#FFFFFF'] });
    audio.sfx('sparkle');
  },

  impact(word, at, opts = {}) {
    const root = layer();
    if (!root) return;
    const calm = reduced();
    const size = opts.size ?? (at ? 'sm' : 'lg');
    const { el } = makeImpact(word ?? fx.soundWord(), { ...opts, size, lines: calm ? false : opts.lines });
    root.appendChild(el);
    const p = at ? pointOf(at) : { x: window.innerWidth / 2, y: Math.max(140, window.innerHeight * 0.3) };
    const half = el.offsetWidth / 2;
    const x = Math.max(half * 0.7, Math.min(window.innerWidth - half * 0.7, p.x));
    const y = Math.max(half * 0.7, p.y);
    const tilt = opts.tilt ?? Math.round((Math.random() - 0.5) * 16);
    slam(el, x, y, tilt, opts.holdMs ?? (size === 'lg' ? 650 : 420), calm);
    if (!calm) {
      emit({ x, y, kind: 'star', count: size === 'lg' ? 16 : 8, speed: size === 'lg' ? 620 : 380, gravity: 600, life: 0.9, size: size === 'lg' ? 26 : 20, colors: ['#FFD21F', '#FFFFFF'] });
      if (opts.flash ?? size === 'lg') flashFrame();
      if (size === 'lg') fx.shake();
    }
  },

  oops(el) {
    fx.wobble(el);
    const root = layer();
    if (!root) return;
    const word = t(OOPS_KEYS[Math.floor(Math.random() * OOPS_KEYS.length)]!);
    const { el: b } = makeImpact(word, { size: 'sm', lines: false, fill: '#FFFFFF' });
    b.style.width = b.style.height = '110px';
    const svg = b.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', '110');
      svg.setAttribute('height', '110');
    }
    (b.lastElementChild as HTMLElement).style.fontSize = '22px';
    root.appendChild(b);
    const r = el.getBoundingClientRect();
    const x = Math.max(60, Math.min(window.innerWidth - 60, r.right - 10));
    const y = Math.max(60, r.top);
    slam(b, x, y, 8, 380, reduced());
  },

  soundWord() {
    soundIdx = (soundIdx + 1 + Math.floor(Math.random() * 2)) % SOUND_KEYS.length;
    return t(SOUND_KEYS[soundIdx]!);
  },

  celebrate(text) {
    const calm = reduced();
    const w = window.innerWidth;
    const h = window.innerHeight;
    emit({ x: 0, y: h * 0.75, kind: 'confetti', count: calm ? 18 : 90, angle: -Math.PI / 3, spread: 0.7, speed: 900, gravity: 520, life: 2.8, size: 16 });
    emit({ x: w, y: h * 0.75, kind: 'confetti', count: calm ? 18 : 90, angle: (-2 * Math.PI) / 3, spread: 0.7, speed: 900, gravity: 520, life: 2.8, size: 16 });
    fx.impact(text ?? t('practice.fx.waouh'), undefined, { size: 'lg', holdMs: 1100, fill: '#FFD21F' });
    audio.sfx('win');
    fx.haptic([10, 40, 10]);
  },

  cheer(mistakes = 0) {
    if (mistakes === 0) return t('practice.fx.perfect');
    cheerIdx = (cheerIdx + 1) % CHEER_KEYS.length;
    return t(CHEER_KEYS[cheerIdx]!);
  },

  sfx(name) {
    audio.sfx(name);
  },

  haptic(ms = 8) {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* not allowed */
    }
  },

  right(el) {
    fx.pop(el);
    fx.impact(undefined, el, { size: 'sm' });
    audio.sfx('right');
    fx.haptic(10);
  },

  wrong(el) {
    fx.oops(el);
    audio.sfx('wrong');
    fx.haptic([6, 30, 6]);
  },

  reducedMotion: reduced,
  particleCount,
  clear: clearParticles,
};
