// The Frenchirix mascot: a druid, drawn as a flat comic head in profile. One drawing, used everywhere: the React mark (DruidMark.tsx), the app icons and the
// favicon (tools/icons.ts writes public/icons/ from these shapes). Pure data, no DOM.
//
// Coordinates are a 512 x 512 box. The head faces right. `DRUID_SMALL` is the simplified version for
// sizes under ~40 px (favicon), where the eye, strands and beard lines would turn to mush.

export const INK = '#111111';
export const GREEN = '#12a058'; // skin
export const GREEN_LIGHT = '#2cc26f'; // the beard catches the light
export const GREEN_DARK = '#086b37'; // shade, brow, ear
export const RED = '#e8303a';
export const YELLOW = '#ffd21f';
export const WHITE = '#ffffff';

export interface Shape {
  d: string;
  fill: string;
  /** Stroke width in the 512 box; 0 for none. Ink unless `stroke` is given. */
  sw: number;
  stroke?: string;
  cap?: 'round';
}

const OUT = 11; // the ink outline

/** The full head, back to front (painter's order). */
export const DRUID: Shape[] = [
  // Three wiry strands of hair on the bald top (the art's antennae).
  { d: 'M220 124 C212 94 194 72 168 58', fill: 'none', sw: 8, cap: 'round' },
  { d: 'M242 118 C244 84 256 58 282 40', fill: 'none', sw: 8, cap: 'round' },
  { d: 'M264 120 C280 94 302 80 330 78', fill: 'none', sw: 8, cap: 'round' },
  // Tufts of hair at the back of the head.
  { d: 'M186 176 L144 160 L168 196 L120 206 L160 226 L116 250 L158 260 L124 290 L166 288 L150 318 L196 300 L204 220 Z', fill: GREEN_DARK, sw: 8 },
  // The head: bald dome, forehead, the face behind the nose.
  {
    d: 'M186 312 C150 258 152 142 238 122 C292 110 328 142 334 188 L332 206 C326 240 322 272 326 304 C304 334 252 350 214 340 C198 334 190 324 186 312 Z',
    fill: GREEN,
    sw: OUT,
  },
  // Shade on the back of the skull.
  { d: 'M200 156 C176 190 172 240 190 290 C186 244 192 196 218 148 Z', fill: GREEN_DARK, sw: 0 },
  // The ear.
  { d: 'M218 222 C192 214 186 270 216 280 C230 270 232 232 218 222 Z', fill: GREEN_DARK, sw: 8 },
  { d: 'M214 238 C206 246 206 260 214 266', fill: 'none', sw: 5, cap: 'round' },
  // The long beard, flowing down and forward to a point.
  {
    d: 'M222 284 C248 316 292 334 336 344 C356 352 368 372 362 396 C374 430 364 466 334 500 C326 470 300 452 270 436 C238 418 214 388 210 350 C208 324 212 302 222 284 Z',
    fill: GREEN_LIGHT,
    sw: OUT,
  },
  // Strands in the beard.
  { d: 'M238 330 C250 368 276 398 314 424', fill: 'none', sw: 6, cap: 'round' },
  { d: 'M286 352 C296 386 316 416 336 446', fill: 'none', sw: 6, cap: 'round' },
  { d: 'M232 380 C246 402 266 416 290 430', fill: 'none', sw: 5, cap: 'round' },
  // The moustache, drooping from under the nose into the beard.
  { d: 'M306 330 C334 334 364 352 372 400 C352 386 330 378 306 372 C294 360 296 340 306 330 Z', fill: GREEN_DARK, sw: 8 },
  // The long drooping nose with its bulb.
  {
    d: 'M318 206 C342 216 354 240 362 266 C388 290 398 330 376 348 C356 364 326 352 320 330 C310 292 304 242 318 206 Z',
    fill: GREEN,
    sw: OUT,
  },
  { d: 'M352 288 C366 298 374 314 372 330', fill: 'none', sw: 7, stroke: GREEN_LIGHT, cap: 'round' },
  // The eye: half-closed, a little sly.
  { d: 'M272 228 C282 214 304 214 314 228 C304 240 282 242 272 228 Z', fill: WHITE, sw: 6 },
  { d: 'M292 228 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 Z', fill: INK, sw: 0 },
  { d: 'M268 228 C278 210 306 208 318 226 C304 220 284 220 268 228 Z', fill: GREEN_DARK, sw: 6 },
  // The bushy brow jutting over the eye.
  { d: 'M250 202 C266 176 304 166 330 178 L356 164 L344 186 L366 190 L340 202 C314 198 282 204 252 214 Z', fill: GREEN_DARK, sw: 8 },
];

/** The silhouette alone, chunkier, for 16-32 px: dome, brow, nose, beard. */
export const DRUID_SMALL: Shape[] = [
  // dome, face and the long pointed beard as one shape
  {
    d: 'M150 300 C110 200 150 84 260 84 C330 84 356 136 352 196 L346 300 C376 350 380 430 330 500 C290 456 230 430 196 392 C172 364 158 336 150 300 Z',
    fill: GREEN,
    sw: 26,
  },
  // the big nose
  { d: 'M336 196 C392 224 436 290 424 344 C412 392 344 380 332 336 Z', fill: GREEN, sw: 26 },
  // the beard, lighter
  { d: 'M190 330 C230 360 300 372 344 330 C362 380 360 440 330 486 C290 448 236 420 206 386 Z', fill: GREEN_LIGHT, sw: 0 },
  // the brow and the eye
  { d: 'M216 196 C256 160 320 150 364 168 L364 200 C320 192 268 202 222 224 Z', fill: INK, sw: 0 },
  { d: 'M262 240 a26 22 0 1 0 52 0 a26 22 0 1 0 -52 0 Z', fill: WHITE, sw: 0 },
  { d: 'M290 240 a14 14 0 1 0 28 0 a14 14 0 1 0 -28 0 Z', fill: INK, sw: 0 },
];

/** A jagged starburst polygon in a box of `size`, centred (deterministic for a seed). */
export function burstPolygon(size: number, points = 16, seed = 11, depth = 0.26, inset = 0): string {
  let a = seed >>> 0 || 1;
  const rnd = () => {
    a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
    return (a % 1000) / 1000;
  };
  const c = size / 2;
  const R = c - inset;
  const out: string[] = [];
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2 + (rnd() - 0.5) * 0.1;
    const r = i % 2 === 0 ? R * (1 - rnd() * 0.08) : R * (1 - depth) - rnd() * R * 0.08;
    out.push(`${(c + Math.cos(angle) * r).toFixed(1)},${(c + Math.sin(angle) * r).toFixed(1)}`);
  }
  return out.join(' ');
}

export interface IconOptions {
  /** 'full' head (default) or the 'small' silhouette. */
  detail?: 'full' | 'small';
  /** Scale of the head around the centre (maskable icons keep it inside the safe circle). */
  scale?: number;
  /** Draw the red field and burst behind the head (false: transparent, for the logo mark). */
  background?: boolean;
  /** Output size in px (the viewBox stays 512). */
  px?: number;
}

function shapeSvg(sh: Shape): string {
  const stroke = sh.sw > 0 ? ` stroke="${sh.stroke ?? INK}" stroke-width="${sh.sw}" stroke-linejoin="round"${sh.cap ? ` stroke-linecap="${sh.cap}"` : ''}` : '';
  return `<path d="${sh.d}" fill="${sh.fill}"${stroke}/>`;
}

/** The background: red field, halftone dots, a yellow burst with a white flash, as SVG markup. */
export function backgroundSvg(detail: 'full' | 'small' = 'full'): string {
  if (detail === 'small') {
    return `<rect width="512" height="512" fill="${YELLOW}"/><rect x="14" y="14" width="484" height="484" fill="none" stroke="${INK}" stroke-width="28"/>`;
  }
  return [
    `<defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="4" fill="#000" fill-opacity=".16"/></pattern></defs>`,
    `<rect width="512" height="512" fill="${RED}"/>`,
    `<rect width="512" height="512" fill="url(#dots)"/>`,
    `<polygon points="${burstPolygon(512, 16, 11, 0.24, 14)}" fill="${YELLOW}" stroke="${INK}" stroke-width="10" stroke-linejoin="miter"/>`,
    `<polygon points="${burstPolygon(512, 12, 5, 0.3, 120)}" fill="${WHITE}"/>`,
  ].join('');
}

/** The head shapes as SVG markup, scaled around the centre. */
export function headSvg(detail: 'full' | 'small' = 'full', scale = 1): string {
  const shapes = (detail === 'small' ? DRUID_SMALL : DRUID).map(shapeSvg).join('');
  if (scale === 1) return shapes;
  const t = 256 * (1 - scale);
  return `<g transform="translate(${t.toFixed(1)} ${t.toFixed(1)}) scale(${scale})">${shapes}</g>`;
}

/** A complete SVG document of the icon. */
export function druidIconSvg(opts: IconOptions = {}): string {
  const detail = opts.detail ?? 'full';
  const px = opts.px ?? 512;
  const bg = opts.background ?? true;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${px}" height="${px}">${bg ? backgroundSvg(detail) : ''}${headSvg(detail, opts.scale ?? 1)}</svg>`;
}
