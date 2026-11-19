// Shared pieces of the arcade puzzle types (rebuild, comic-order, catapult, vrai-faux, memory): the big
// loop button, a "fly from there to here" animation for tiles that snap into place, and our own
// comic art drawn as inline SVG (a generic Roman legionary, a catapult, a boulder, a cauldron).
// None of it copies the show's characters: thick ink, flat colour, simple shapes.
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { t } from '../../../../shared/i18n';
import { useAudioState } from '../../audio';
import { Icon, Spinner, cx } from '../../ui';
import k from './kit.module.css';

// ---- the loop button --------------------------------------------------------------------------

export interface LoopButtonProps {
  looping: boolean;
  onToggle: () => void;
  label: string;
  size?: 'md' | 'lg';
  color?: 'yellow' | 'white' | 'orange' | 'cyan';
  className?: string;
}

/** A square ink-framed speaker that thumps and throws sound marks while its French loops. */
export function LoopButton({ looping, onToggle, label, size = 'md', color = 'yellow', className }: LoopButtonProps) {
  // Its play started but the clip is still on its way: hopping dots, no sound marks (nothing is heard yet).
  const st = useAudioState();
  const busy = looping && st.loading;
  return (
    <button
      type="button"
      className={cx(k.loop, size === 'lg' && k.loopLg, looping && !busy && k.loopOn, className)}
      style={{ '--lb': `var(--${color})` } as CSSProperties}
      onClick={onToggle}
      aria-label={busy ? t('common.media.busy') : label}
      aria-pressed={looping}
      aria-busy={busy || undefined}
      data-loop
      data-busy={busy || undefined}
    >
      {busy ? <Spinner size={size === 'lg' ? 'md' : 'sm'} /> : <Icon name={looping ? 'speaker' : 'play'} size={size === 'lg' ? 48 : 34} />}
      {looping && !busy && (
        <span className={k.marks} aria-hidden>
          <i />
          <i />
          <i />
        </span>
      )}
    </button>
  );
}

// ---- fly-in ----------------------------------------------------------------------------------

/** Remembered screen rectangles of things that were tapped, so their replacement can fly from there. */
const origins = new Map<string, DOMRect>();

export function rememberOrigin(key: string, el: Element | null): void {
  if (el) origins.set(key, el.getBoundingClientRect());
}

/**
 * Animates the element in from the rectangle remembered under `key` (if any) the first time it
 * mounts: a slam with overshoot and a spin. Use on the slot that receives a tapped tile.
 */
export function useFlyIn<T extends HTMLElement>(key: string | null, opts: { spin?: number; ms?: number } = {}) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !key) return;
    const from = origins.get(key);
    origins.delete(key);
    if (!from) return;
    const to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const spin = opts.spin ?? (dx > 0 ? -14 : 14);
    try {
      el.animate(
        reduce
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(1.15)`, zIndex: 5 },
              { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 30}px) rotate(${spin / 2}deg) scale(1.2)`, offset: 0.45 },
              { transform: 'translate(0, 6px) rotate(-3deg) scale(0.92)', offset: 0.8 },
              { transform: 'none' },
            ],
        { duration: opts.ms ?? 420, easing: 'cubic-bezier(0.3, 0.9, 0.4, 1)' },
      );
    } catch {
      /* no WAAPI: it just appears */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ref;
}

/** Throws an element along an arc from a point to another (boulders). Resolves when it lands. */
export function throwArc(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, ms = 520): Promise<void> {
  const frames: Keyframe[] = [];
  const n = 10;
  const h = Math.max(80, Math.abs(to.x - from.x) * 0.5 + 60);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t - h * 4 * t * (1 - t);
    frames.push({ transform: `translate(${x}px, ${y}px) rotate(${t * 540}deg) scale(${1 - 0.35 * t})`, offset: t });
  }
  return new Promise((resolve) => {
    try {
      const a = el.animate(frames, { duration: ms, easing: 'linear', fill: 'forwards' });
      a.onfinish = () => resolve();
      a.oncancel = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---- art -------------------------------------------------------------------------------------

const INK = '#111111';

export interface RomanProps {
  /** Mouth: 'smug' (waiting), 'tongue' (a boulder bounced off him), 'ouch' (hit). */
  mood?: 'smug' | 'tongue' | 'ouch';
  tunic?: string;
  className?: string;
}

/** A generic cartoon legionary holding up a sign (the sign is HTML laid over his raised arms). */
export function Roman({ mood = 'smug', tunic = '#E8303A', className }: RomanProps) {
  return (
    <svg viewBox="0 0 100 130" className={className} aria-hidden>
      {/* raised arms holding the sign pole */}
      <path d="M22 62 L14 8 M78 62 L86 8" stroke={INK} strokeWidth="9" strokeLinecap="square" />
      <path d="M22 62 L14 8 M78 62 L86 8" stroke="#F2B48A" strokeWidth="4" strokeLinecap="square" />
      {/* legs and sandals */}
      <rect x="34" y="104" width="10" height="20" fill="#F2B48A" stroke={INK} strokeWidth="3" />
      <rect x="56" y="104" width="10" height="20" fill="#F2B48A" stroke={INK} strokeWidth="3" />
      <path d="M30 124 h18 M52 124 h18" stroke={INK} strokeWidth="5" />
      {/* tunic and armour */}
      <path d="M24 64 h52 l6 44 h-64 z" fill={tunic} stroke={INK} strokeWidth="3.5" strokeLinejoin="miter" />
      <rect x="28" y="64" width="44" height="26" fill="#C9CED6" stroke={INK} strokeWidth="3" />
      <path d="M28 72 h44 M28 80 h44" stroke={INK} strokeWidth="2.5" />
      <path d="M30 100 v8 M38 100 v8 M46 100 v8 M54 100 v8 M62 100 v8 M70 100 v8" stroke={INK} strokeWidth="2.5" />
      {/* head */}
      <circle cx="50" cy="46" r="17" fill="#F2B48A" stroke={INK} strokeWidth="3.5" />
      {/* helmet with a crest */}
      <path d="M32 44 a18 18 0 0 1 36 0 z" fill="#C9CED6" stroke={INK} strokeWidth="3.5" />
      <path d="M36 26 q14 -14 28 0 l-4 4 q-10 -8 -20 0 z" fill="#E8303A" stroke={INK} strokeWidth="3" />
      <path d="M32 44 v12 M68 44 v12" stroke={INK} strokeWidth="4" />
      {/* face */}
      <circle cx="44" cy="48" r="2.4" fill={INK} />
      <circle cx="57" cy="48" r="2.4" fill={INK} />
      <path d="M50 49 q6 5 0 8" stroke={INK} strokeWidth="2.5" fill="none" />
      {mood === 'smug' && <path d="M43 57 q7 3 14 -1" stroke={INK} strokeWidth="2.5" fill="none" />}
      {mood === 'tongue' && (
        <>
          <path d="M42 57 h16" stroke={INK} strokeWidth="2.5" />
          <path d="M47 57 v5 a3 3 0 0 0 6 0 v-5" fill="#F4505E" stroke={INK} strokeWidth="2" />
        </>
      )}
      {mood === 'ouch' && (
        <>
          <ellipse cx="50" cy="59" rx="4" ry="3.5" fill={INK} />
          <path d="M40 44 l6 4 M46 44 l-6 4 M54 44 l6 4 M60 44 l-6 4" stroke={INK} strokeWidth="2.5" />
        </>
      )}
    </svg>
  );
}

/** A wooden catapult; `fired` swings its arm. */
export function Catapult({ fired, className }: { fired?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 160 110" className={className} aria-hidden>
      <g className={cx(k.arm, fired && k.armFired)} style={{ transformOrigin: '86px 74px' }}>
        <path d="M86 74 L28 30" stroke={INK} strokeWidth="11" strokeLinecap="square" />
        <path d="M86 74 L28 30" stroke="#B5712E" strokeWidth="6" strokeLinecap="square" />
        <path d="M14 24 q14 22 30 4 z" fill="#8A5220" stroke={INK} strokeWidth="3.5" />
      </g>
      <path d="M60 76 L86 40 L112 76" fill="none" stroke={INK} strokeWidth="10" />
      <path d="M60 76 L86 40 L112 76" fill="none" stroke="#B5712E" strokeWidth="5" />
      <rect x="20" y="72" width="124" height="16" fill="#B5712E" stroke={INK} strokeWidth="3.5" />
      <path d="M30 80 h104" stroke={INK} strokeWidth="2" strokeDasharray="10 8" />
      <circle cx="42" cy="94" r="13" fill="#8A5220" stroke={INK} strokeWidth="3.5" />
      <circle cx="122" cy="94" r="13" fill="#8A5220" stroke={INK} strokeWidth="3.5" />
      <circle cx="42" cy="94" r="3" fill={INK} />
      <circle cx="122" cy="94" r="3" fill={INK} />
    </svg>
  );
}

export function Boulder({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 40 40" className={className} style={style} aria-hidden>
      <path d="M6 18 q2 -12 15 -13 q13 1 14 12 q2 12 -12 17 q-15 1 -17 -16 z" fill="#9AA0A8" stroke={INK} strokeWidth="3.5" />
      <path d="M14 14 l5 4 l-2 6 M26 22 l4 3" stroke={INK} strokeWidth="2.2" fill="none" />
      <circle cx="13" cy="26" r="2" fill="#6E747C" />
    </svg>
  );
}

/** A bubbling cauldron whose potion rises with `level` (0-1). */
export function Cauldron({ level, className, children }: { level: number; className?: string; children?: ReactNode }) {
  const top = 70 - Math.max(0, Math.min(1, level)) * 46;
  return (
    <div className={cx(k.cauldron, className)}>
      <svg viewBox="0 0 120 110" aria-hidden>
        <defs>
          <clipPath id="frx-cauldron-clip">
            <path d="M14 34 h92 q4 56 -46 62 q-50 -6 -46 -62 z" />
          </clipPath>
        </defs>
        <path d="M14 34 h92 q4 56 -46 62 q-50 -6 -46 -62 z" fill="#2A2A2A" stroke={INK} strokeWidth="4" />
        <g clipPath="url(#frx-cauldron-clip)">
          <rect x="0" y={top} width="120" height="120" fill="#22B14C" className={k.potion} />
          <path d={`M0 ${top} q15 -7 30 0 t30 0 t30 0 t30 0`} fill="#8CD62C" stroke={INK} strokeWidth="2.5" />
          {level > 0.05 && (
            <g className={k.bubbles}>
              <circle cx="40" cy={top + 14} r="4" fill="#8CD62C" stroke={INK} strokeWidth="2" />
              <circle cx="72" cy={top + 22} r="3" fill="#8CD62C" stroke={INK} strokeWidth="2" />
              <circle cx="58" cy={top + 8} r="2.5" fill="#8CD62C" stroke={INK} strokeWidth="2" />
            </g>
          )}
        </g>
        <rect x="8" y="28" width="104" height="12" fill="#3A3A3A" stroke={INK} strokeWidth="4" />
        <path d="M30 96 l-8 12 M90 96 l8 12" stroke={INK} strokeWidth="6" />
      </svg>
      {children}
    </div>
  );
}
