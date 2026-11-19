// The layered SVG avatar wearing the kid's items, drawn like a 1950s comic: thick ink, flat colour,
// halftone shading at large sizes. One coordinate system for everything (see art/kit.tsx).
import { useId, type ReactNode } from 'react';
import { ITEMS_BY_ID, resolveBase, type Avatar as AvatarData, type ItemSlot } from '../../../shared/catalog';
import { drawBareFeet, drawBody, drawFace, drawHands, drawHead, drawLegs, drawLowerFace, drawNeck, drawUndershorts, HAIR_STYLES, SIDEBURNS } from './art/base';
import { HalftoneDefs, INK, LAYERS, type ArtCtx, type ItemArtDef, type Layer } from './art/kit';
import { ITEM_ART } from './art/registry';
import { BG, HAIR, shade, SKIN } from './palette';
import s from './Avatar.module.css';

export interface AvatarProps {
  avatar: AvatarData;
  size: number; // px, square
  className?: string;
  /** 'bust' crops to head and shoulders; 'auto' (default) uses it below 80 px. */
  framing?: 'auto' | 'full' | 'bust';
  /** 'panel' (default): a square comic panel with an ink border. 'none': no background, no border. */
  shape?: 'panel' | 'none';
  /** Idle blink and bob. Defaults to on at 120 px and up. */
  animate?: boolean;
  /** Accessible name; defaults to "avatar". */
  label?: string;
}

/** The art of an item, if it has some. */
export function itemArt(itemId: string): ItemArtDef | undefined {
  const item = ITEMS_BY_ID.get(itemId);
  return ITEM_ART[item?.art ?? itemId];
}

export function makeCtx(avatar: Pick<AvatarData, 'base'> | null, uid: string, detail: boolean): ArtCtx {
  const base = resolveBase(avatar);
  const skin = SKIN[base.skin];
  const hair = HAIR[base.hairColor];
  return {
    base,
    skin,
    skinDark: shade(skin, 0.28),
    hair,
    hairDark: shade(hair, base.hairColor === 'black' ? -0.25 : 0.3),
    uid,
    detail,
    ht: `url(#ht-${uid})`,
    htLight: `url(#htl-${uid})`,
  };
}

const VIEW_FULL = { x: 0, y: 0, w: 200, h: 200 };
const VIEW_BUST = { x: 28, y: 14, w: 144, h: 144 };

export function Avatar({ avatar, size, className, framing = 'auto', shape = 'panel', animate, label }: AvatarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const detail = size >= 96;
  const c = makeCtx(avatar, uid, detail);
  const bust = framing === 'bust' || (framing === 'auto' && size < 80);
  const view = bust ? VIEW_BUST : VIEW_FULL;
  const live = animate ?? size >= 120;

  const worn: [ItemSlot, ItemArtDef][] = [];
  for (const [slot, id] of Object.entries(avatar?.worn ?? {}) as [ItemSlot, string | undefined][]) {
    if (!id) continue;
    const art = itemArt(id);
    if (art && ITEMS_BY_ID.get(id)?.slot === slot) worn.push([slot, art]);
  }
  const bySlot = new Map(worn);
  const hat = bySlot.get('hat');
  const wig = bySlot.get('hair')?.hidesHair === 'all' ? bySlot.get('hair') : undefined;
  const hatHides = hat?.hidesHair;
  const style = HAIR_STYLES[c.base.hair];
  const ears = !hat?.hidesEars;

  const base: Partial<Record<Layer, ReactNode>> = {
    bg: <rect x="-10" y="-10" width="220" height="220" fill={BG[c.base.bgColor]} />,
    bgFront: shape === 'panel' && !bySlot.has('background') ? <BackdropTexture c={c} /> : null,
    hairBack: hatHides === 'all' || wig ? null : style.back?.(c),
    legs: drawLegs(c),
    bottom: bySlot.has('bottom') ? null : drawUndershorts(c),
    feet: bySlot.has('feet') ? null : drawBareFeet(c),
    body: drawBody(c),
    neck: drawNeck(c),
    head: drawHead(c, ears),
    face: drawFace(c, live ? s.blink : undefined),
    facialHair: drawLowerFace(c),
    hair: hatHides === 'all' || wig ? null : hatHides === 'top' ? (style.sides ?? SIDEBURNS)(c) : style.front?.(c),
    hand: drawHands(c),
  };

  const layers: ReactNode[] = [];
  for (const layer of LAYERS) {
    const parts: ReactNode[] = [];
    if (shape === 'none' && (layer === 'bg' || layer === 'bgFront')) continue;
    if (base[layer]) parts.push(<g key="base">{base[layer]}</g>);
    for (const [slot, art] of worn) {
      const draw = art.layers[layer];
      if (!draw) continue;
      // A hat that covers the crown hides hair pieces, except what hangs behind.
      if (slot === 'hair' && hatHides && layer !== 'hairBack') continue;
      if (slot === 'hair' && hatHides === 'all') continue;
      parts.push(<g key={slot}>{draw(c)}</g>);
    }
    if (parts.length) layers.push(<g key={layer} data-layer={layer}>{parts}</g>);
  }

  const border = (view.w / size) * (size >= 120 ? 4 : size >= 56 ? 3 : 2);
  const clip = `clip-${uid}`;
  return (
    <svg
      className={[s.avatar, className].filter(Boolean).join(' ')}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      width={size}
      height={size}
      role="img"
      aria-label={label ?? 'avatar'}
    >
      <defs>
        <HalftoneDefs uid={uid} />
        <clipPath id={clip}>
          <rect x={view.x} y={view.y} width={view.w} height={view.h} />
        </clipPath>
      </defs>
      <g clipPath={shape === 'panel' ? `url(#${clip})` : undefined}>
        <g stroke={INK} strokeWidth={3.4} strokeLinejoin="round" strokeLinecap="round">
          {layers.slice(0, 2)}
          <g className={live ? s.bob : undefined}>{layers.slice(2)}</g>
        </g>
      </g>
      {shape === 'panel' && (
        <rect x={view.x + border / 2} y={view.y + border / 2} width={view.w - border} height={view.h - border} fill="none" stroke={INK} strokeWidth={border} />
      )}
    </svg>
  );
}

/** The plain colour background's comic texture: a halftone field and a burst of light behind the head. */
function BackdropTexture({ c }: { c: ArtCtx }) {
  if (!c.detail) return null;
  const rays: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = a0 + Math.PI / 22;
    rays.push(`M100 80 L${100 + 220 * Math.cos(a0)} ${80 + 220 * Math.sin(a0)} L${100 + 220 * Math.cos(a1)} ${80 + 220 * Math.sin(a1)} Z`);
  }
  const light = c.base.bgColor === 'lime' || c.base.bgColor === 'sun';
  return (
    <g stroke="none">
      <path d={rays.join(' ')} fill="#ffffff" opacity={light ? 0.35 : 0.14} />
      <rect x="-10" y="-10" width="220" height="220" fill={light ? c.ht : c.htLight} opacity={light ? 0.35 : 0.7} />
      <ellipse cx="100" cy="190" rx="50" ry="7" fill={INK} opacity={0.25} />
    </g>
  );
}
