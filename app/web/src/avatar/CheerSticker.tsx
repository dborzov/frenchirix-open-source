// The cheer stickers friends send each other: a jagged comic burst with a little picture.
// The phrase is shown by whoever renders the sticker (cheer.name in the kid's language).
import type { ReactNode } from 'react';
import { CHEERS_BY_ID } from '../../../shared/catalog';
import { INK } from './palette';

const COLORS: Record<string, string> = {
  'unit-1': '#1e88e5',
  'unit-2': '#ffd21f',
  'unit-3': '#22b14c',
  'unit-4': '#2f7fa8',
  'unit-5': '#e8303a',
  'unit-6': '#7a3ff2',
};

function burst(n: number, r1: number, r2: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? r2 : r1;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
}
function star(x: number, y: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(x + rr * Math.cos(a)).toFixed(1)} ${(y + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
}

const W = '#ffffff';
const Y = '#ffd21f';
const R = '#e8303a';

export const CHEER_ART: Record<string, ReactNode> = {
  star: <path d={star(50, 52, 26)} fill={Y} />,
  lightning: <path d="M56 18 L32 54 L48 54 L40 84 L68 44 L52 44 L62 18 Z" fill={Y} />,
  menhir: (
    <>
      <path d="M36 82 L34 40 C34 22 62 20 64 40 L66 82 Z" fill="#c3c7cc" />
      <path d="M42 46 q6 4 12 0 M44 62 q6 3 10 0" fill="none" strokeWidth={2} />
    </>
  ),
  crown: (
    <>
      <path d="M24 70 L22 34 L38 50 L50 26 L62 50 L78 34 L76 70 Z" fill={Y} />
      <circle cx="50" cy="58" r="5" fill={R} strokeWidth={2.4} />
    </>
  ),
  wave: (
    <>
      <path d="M38 80 L36 46 C36 40 44 40 44 46 L44 30 C44 24 52 24 52 30 L52 28 C52 22 60 22 60 28 L60 34 C60 28 68 28 68 34 L68 62 C68 74 60 82 50 82 Z" fill="#f7c19c" />
      <path d="M24 36 q-6 8 0 16 M76 28 q6 8 0 16" fill="none" strokeWidth={3} />
    </>
  ),
  thumb: <path d="M30 78 L30 50 L40 50 L52 26 C58 24 62 30 58 40 L56 48 L72 48 C78 48 80 56 74 58 C80 60 78 68 72 68 C76 72 72 78 66 78 Z" fill="#f7c19c" />,
  cauldron: (
    <>
      <path d="M26 46 L74 46 L70 74 Q50 86 30 74 Z" fill="#3b3b47" />
      <ellipse cx="50" cy="46" rx="26" ry="6" fill="#8dff3a" />
      <circle cx="40" cy="30" r="5" fill="#8dff3a" strokeWidth={2.4} />
      <circle cx="56" cy="22" r="4" fill="#8dff3a" strokeWidth={2.4} />
    </>
  ),
  boar: (
    <>
      <ellipse cx="50" cy="60" rx="30" ry="18" fill="#c96a2b" />
      <path d="M22 58 L14 52 M78 58 L86 52" strokeWidth={4} />
      <path d="M36 50 q14 -8 28 0" fill="none" stroke={W} strokeWidth={3} />
      <path d="M44 34 q2 -8 0 -12 M56 34 q2 -8 0 -12" fill="none" strokeWidth={2.4} />
    </>
  ),
  muscle: (
    <path d="M24 74 C24 60 30 52 40 50 L44 34 C42 26 50 22 56 26 L62 34 L56 40 L52 52 C60 46 74 48 76 60 C78 72 66 80 50 80 L28 80 Z" fill="#f7c19c" />
  ),
  helmet: (
    <>
      <path d="M26 60 C24 32 40 22 50 22 C60 22 76 32 74 60 Z" fill="#c3ccd6" />
      <path d="M22 60 L78 60 L80 68 L20 68 Z" fill="#e3a72f" />
      <path d="M30 26 C34 10 66 10 70 26 Q50 18 30 26 Z" fill={R} />
      <path d="M40 46 q3 -6 6 0 M54 46 q3 -6 6 0" fill="none" strokeWidth={2.4} />
    </>
  ),
  heart: <path d="M50 80 C20 60 22 30 40 30 C46 30 50 36 50 40 C50 36 54 30 60 30 C78 30 80 60 50 80 Z" fill={R} />,
  moon: (
    <>
      <path d="M58 20 C38 22 26 40 30 58 C34 74 52 84 68 78 C52 72 44 58 46 44 C48 32 52 24 58 20 Z" fill={Y} />
      <path d={star(70, 34, 7)} fill={W} strokeWidth={2} />
    </>
  ),
};

export interface CheerStickerProps {
  cheerId: string;
  size: number;
  className?: string;
}

export function CheerSticker({ cheerId, size, className }: CheerStickerProps) {
  const cheer = CHEERS_BY_ID.get(cheerId);
  const color = COLORS[cheer?.color ?? 'unit-1'] ?? '#1e88e5';
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label={cheer?.name.fr ?? cheerId}>
      <path d={burst(12, 48, 38)} fill={color} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <g stroke={INK} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round">
        {CHEER_ART[cheer?.art ?? ''] ?? null}
      </g>
    </svg>
  );
}
