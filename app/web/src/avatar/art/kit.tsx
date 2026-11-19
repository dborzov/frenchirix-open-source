// The drawing kit shared by every piece of avatar art: the layer order, the context an item is
// drawn with, and a few primitives that give the bold, outlined cartoon look.
//
// Coordinates: one 200 x 200 box for everything. The character stands with feet at y = 186.
//   head      ellipse centre (100, 74), rx 40, ry 37 (top y 37, chin y 111); ears at x 61 and 139, y 80
//   eyes      (85, 78) and (115, 78); brows y ~65; nose (100, 90); mouth (100, 101)
//   torso     shoulders y 118 between x 72 and 128, hem y ~160
//   hands     left (66, 154) hanging, right (141, 148) holding: a held item's grip is the right hand
//   legs      x 88 and 112 from y 156 to 180; feet (84, 184) and (116, 184)
//   pet       stands left of the character, x 14..62, ground y 190
import { Children, type ReactElement, type ReactNode } from 'react';
import type { AvatarBase } from '../../../../shared/catalog';
import { INK } from '../palette';

export { INK };

/** Back to front. Items draw on any layers they need, not only their slot's. */
export const LAYERS = [
  'bg', // backgrounds
  'bgFront', // ground details of a background, still behind the character
  'back', // capes, wings, backpacks
  'hairBack', // long hair behind the head and shoulders
  'pet', // the companion stands beside, behind the hands
  'legs',
  'bottom',
  'feet',
  'body', // torso and arms
  'top',
  'neck',
  'collar', // things worn over the top: cape clasps, straps
  'head',
  'face',
  'facialHair',
  'hair',
  'hairAcc',
  'hat',
  'eyewear',
  'held',
  'hand', // the holding hand, drawn over the held item so it grips it
  'front', // anything that must be on top
] as const;
export type Layer = (typeof LAYERS)[number];

export interface ArtCtx {
  base: AvatarBase;
  skin: string;
  skinDark: string;
  hair: string;
  hairDark: string;
  uid: string; // unique per rendered avatar, for pattern and clip ids
  /** Large enough for comic detail: halftone shading and fine lines. False at small sizes. */
  detail: boolean;
  /** Fill for halftone shading (ink dots), e.g. <path fill={c.ht} />. */
  ht: string;
  /** Fill for light halftone (white dots) on dark areas. */
  htLight: string;
}

/** Halftone shading: a shape filled with ink dots, drawn only at large sizes. */
export function Shade({ c, d, opacity = 1 }: { c: ArtCtx; d: string; opacity?: number }) {
  if (!c.detail) return null;
  return <path d={d} fill={c.ht} stroke="none" opacity={opacity} />;
}

/** The halftone dot patterns an avatar's art refers to. Rendered once per avatar inside <defs>. */
export function HalftoneDefs({ uid }: { uid: string }) {
  return (
    <>
      <pattern id={`ht-${uid}`} width="4.2" height="4.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <circle cx="2.1" cy="2.1" r="1.15" fill="#111111" opacity="0.55" />
      </pattern>
      <pattern id={`htr-${uid}`} width="3.6" height="3.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <circle cx="1.8" cy="1.8" r="1.2" fill="#e8303a" opacity="0.75" />
      </pattern>
      <pattern id={`htl-${uid}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <circle cx="2.5" cy="2.5" r="1.1" fill="#ffffff" opacity="0.5" />
      </pattern>
    </>
  );
}

export type Draw = (c: ArtCtx) => ReactNode;

export interface ItemArtDef {
  layers: Partial<Record<Layer, Draw>>;
  /** viewBox of ItemIcon when the item is shown on its own. Defaults to its slot's. */
  icon?: string;
  /** Headwear that covers the top of the head: 'top' hides the hair's crown, 'all' hides all hair. */
  hidesHair?: 'top' | 'all';
  /** Covers the ears (hoods, helmets with cheek guards). */
  hidesEars?: boolean;
  /** Replaces the plain shirt under it entirely (it draws its own torso). Default true for tops. */
  hidesLegs?: boolean;
}

/** Shapes drawn with one clean outer outline (overlaps inside get no lines). Children: plain shapes without fill or stroke. */
export function U({ fill, children, w = 3.4, opacity }: { fill: string; children: ReactNode; w?: number; opacity?: number }) {
  const kids = Children.toArray(children) as ReactElement[];
  return (
    <g opacity={opacity}>
      <g fill={INK} stroke={INK} strokeWidth={w * 2} strokeLinejoin="round" strokeLinecap="round">
        {kids}
      </g>
      <g fill={fill} stroke="none">
        {kids}
      </g>
    </g>
  );
}

/** A thick outlined stroke: limbs, sticks, straps. */
export function Tube({ d, color, w = 10, outline = 3.4 }: { d: string; color: string; w?: number; outline?: number }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={INK} strokeWidth={w + outline * 2} />
      <path d={d} stroke={color} strokeWidth={w} />
    </g>
  );
}

/** A detail line (no fill), ink by default. */
export function Line({ d, color = INK, w = 3, opacity }: { d: string; color?: string; w?: number; opacity?: number }) {
  return <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />;
}

/** A flat shape without outline (shading, highlights, patterns). */
export function Flat({ d, fill, opacity }: { d: string; fill: string; opacity?: number }) {
  return <path d={d} fill={fill} stroke="none" opacity={opacity} />;
}

/** A soft white highlight that makes things look shiny. */
export function Shine({ d, opacity = 0.55 }: { d: string; opacity?: number }) {
  return <path d={d} fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" opacity={opacity} />;
}

/** Arm paths: the garments re-draw these in their own colour as sleeves. */
export const ARM_L = 'M80 124 Q69 137 66 152';
export const ARM_R = 'M120 124 Q133 132 140 146';
export const SLEEVE_L = 'M80 124 Q73 132 70 140';
export const SLEEVE_R = 'M120 124 Q128 129 132 135';
/** Halftone shading on the right side of the torso; tops draw it over their fill. */
export const TORSO_SHADE = 'M114 119 C126 124 131 140 130 160 Q122 162.5 112 163.5 C118 150 119 134 114 119 Z';
export const TORSO = 'M70 160 C68 138 74 123 88 118 L112 118 C126 123 132 138 130 160 Q100 166 70 160 Z';
export const LEG_L = 'M88 154 L87 180';
export const LEG_R = 'M112 154 L113 180';
