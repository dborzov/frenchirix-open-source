// Backgrounds: full 200 x 200 comic panels behind the character, flat colour with halftone.
import type { ReactNode } from 'react';
import { INK, Line, type ArtCtx, type ItemArtDef } from '../kit';

function star(x: number, y: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(x + rr * Math.cos(a)).toFixed(1)} ${(y + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function rays(cx: number, cy: number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = a0 + Math.PI / n;
    out.push(`M${cx} ${cy} L${cx + 300 * Math.cos(a0)} ${cy + 300 * Math.sin(a0)} L${cx + 300 * Math.cos(a1)} ${cy + 300 * Math.sin(a1)} Z`);
  }
  return out.join(' ');
}

/** A sky colour, a ground, and halftone over the sky at large sizes. */
function panel(c: ArtCtx, sky: string, ground: string, horizon: number, body?: ReactNode, light = true): ReactNode {
  return (
    <>
      <rect x="-10" y="-10" width="220" height="220" fill={sky} stroke="none" />
      {c.detail && <rect x="-10" y="-10" width="220" height={horizon + 10} fill={light ? c.htLight : c.ht} stroke="none" opacity={light ? 0.8 : 0.35} />}
      {body}
      <path d={`M-10 ${horizon} L210 ${horizon} L210 210 L-10 210 Z`} fill={ground} />
      {c.detail && <path d={`M-10 ${horizon + 2} L210 ${horizon + 2} L210 210 L-10 210 Z`} fill={c.ht} stroke="none" opacity={0.3} />}
    </>
  );
}

export const BACKGROUND_ART: Record<string, ItemArtDef> = {
  meadow: {
    layers: {
      bg: (c) =>
        panel(
          c,
          '#1e88e5',
          '#22b14c',
          150,
          <>
            <path d="M120 40 C120 30 136 26 142 34 C150 26 166 30 164 40 C172 42 172 52 162 52 L124 52 C114 52 112 42 120 40 Z" fill="#ffffff" />
            <path d="M-10 156 C40 128 90 130 140 150 C170 140 200 140 210 146 L210 160 L-10 160 Z" fill="#7cc243" />
          </>,
        ),
      bgFront: () => <Line d="M20 176 l2 -6 2 6 M170 170 l2 -6 2 6 M150 184 l2 -6 2 6" w={2} />,
    },
  },
  village: {
    layers: {
      bg: (c) =>
        panel(
          c,
          '#ff7a1a',
          '#8a5631',
          152,
          <>
            <path d="M-6 120 L30 76 L66 120 Z" fill="#ffd21f" />
            <rect x="2" y="120" width="56" height="34" fill="#fff3d0" />
            <path d="M134 116 L172 70 L210 116 Z" fill="#ffd21f" />
            <rect x="142" y="116" width="60" height="38" fill="#fff3d0" />
            <Line d="M10 84 L30 76 M150 80 L172 70" w={1.6} />
            {Array.from({ length: 20 }, (_, i) => (
              <path key={i} d={`M${-8 + i * 11} 154 L${-8 + i * 11} 134 L${-3 + i * 11} 126 L${2 + i * 11} 134 L${2 + i * 11} 154 Z`} fill="#c98b4a" strokeWidth={2.2} />
            ))}
          </>,
        ),
    },
  },
  forest: {
    layers: {
      bg: (c) =>
        panel(
          c,
          '#1b5e20',
          '#5c3a20',
          160,
          <>
            {[10, 60, 150, 186].map((x, i) => (
              <g key={x}>
                <rect x={x - 7} y="60" width="14" height="104" fill="#8a5631" />
                <circle cx={x} cy={50 + (i % 2) * 10} r="30" fill="#22b14c" />
              </g>
            ))}
          </>,
          false,
        ),
    },
  },
  'menhir-field': {
    layers: {
      bg: (c) =>
        panel(
          c,
          '#ffd21f',
          '#7cc243',
          150,
          <>
            <path d="M14 152 L12 92 C12 76 30 72 34 88 L38 152 Z" fill="#c3c7cc" />
            <path d="M150 152 L152 70 C154 54 176 52 178 70 L182 152 Z" fill="#c3c7cc" />
            <path d="M50 152 L52 118 C54 108 66 108 66 120 L68 152 Z" fill="#c3c7cc" />
            <Line d="M160 90 q6 4 10 0 M20 110 q4 3 8 0" w={1.6} />
          </>,
          false,
        ),
    },
  },
  'roman-columns': {
    layers: {
      bg: (c) =>
        panel(
          c,
          '#e8303a',
          '#fff3d0',
          160,
          <>
            <path d="M-10 30 L100 2 L210 30 Z" fill="#fff3d0" />
            <rect x="-10" y="30" width="220" height="10" fill="#fff3d0" />
            {[10, 46, 154, 190].map((x) => (
              <g key={x}>
                <rect x={x - 10} y="40" width="20" height="120" fill="#ffffff" />
                <Line d={`M${x - 4} 46 L${x - 4} 154 M${x + 4} 46 L${x + 4} 154`} w={1.6} opacity={0.5} />
                <rect x={x - 13} y="40" width="26" height="6" fill="#fff3d0" strokeWidth={2.2} />
              </g>
            ))}
          </>,
        ),
    },
  },
  seaside: {
    layers: {
      bg: (c) =>
        panel(
          c,
          '#2f7fa8',
          '#ffd21f',
          164,
          <>
            <circle cx="40" cy="40" r="18" fill="#ffd21f" />
            <path d="M-10 120 L210 120 L210 166 L-10 166 Z" fill="#1e88e5" />
            <Line d="M10 134 q8 -5 16 0 q8 5 16 0 M150 146 q8 -5 16 0 q8 5 16 0 M120 128 q6 -4 12 0" w={2} color="#ffffff" />
            <path d="M150 116 L190 116 L184 126 L156 126 Z" fill="#8a5631" strokeWidth={2.4} />
            <Line d="M170 116 L170 86" w={2.4} />
            <path d="M171 88 L188 108 L171 108 Z" fill="#ffffff" strokeWidth={2.2} />
          </>,
        ),
    },
  },
  arena: {
    layers: {
      bg: (c) =>
        panel(
          c,
          '#ff7a1a',
          '#e3c27a',
          158,
          <>
            <rect x="-10" y="60" width="220" height="98" fill="#c98b4a" />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <path key={i} d={`M${-6 + i * 32} 156 L${-6 + i * 32} 104 C${-6 + i * 32} 88 ${18 + i * 32} 88 ${18 + i * 32} 104 L${18 + i * 32} 156 Z`} fill="#5c3a20" strokeWidth={2.4} />
            ))}
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <path key={`u${i}`} d={`M${-2 + i * 32} 82 L${-2 + i * 32} 70 C${-2 + i * 32} 64 ${14 + i * 32} 64 ${14 + i * 32} 70 L${14 + i * 32} 82 Z`} fill="#5c3a20" strokeWidth={2} />
            ))}
            <rect x="-10" y="56" width="220" height="6" fill="#fff3d0" strokeWidth={2.2} />
          </>,
        ),
    },
  },
  'starry-night': {
    layers: {
      bg: (c) => (
        <>
          <rect x="-10" y="-10" width="220" height="220" fill="#1b2f7a" stroke="none" />
          {c.detail && <rect x="-10" y="-10" width="220" height="220" fill={c.htLight} stroke="none" opacity={0.35} />}
          <path d="M160 24 C146 26 138 40 142 54 C146 66 160 72 172 68 C160 64 152 52 154 40 C155 32 158 28 160 24 Z" fill="#ffd21f" />
          {[
            [24, 30, 6],
            [70, 18, 4],
            [110, 40, 5],
            [36, 88, 4],
            [180, 100, 5],
            [14, 140, 4],
            [186, 150, 3.5],
          ].map(([x, y, r]) => (
            <path key={x} d={star(x!, y!, r! * 1.6)} fill="#ffffff" strokeWidth={2} />
          ))}
          <path d="M-10 170 C40 160 80 166 120 170 C160 174 190 166 210 168 L210 210 L-10 210 Z" fill="#0f1a4a" />
        </>
      ),
    },
  },
  banquet: {
    layers: {
      bg: (c) => (
        <>
          <rect x="-10" y="-10" width="220" height="220" fill="#e8303a" stroke="none" />
          {c.detail && <path d={rays(100, 80, 18)} fill="#ffd21f" stroke="none" opacity={0.3} />}
          <path d="M-10 14 Q25 34 60 14 Q100 34 140 14 Q175 34 210 14" fill="none" strokeWidth={2.4} />
          {[10, 35, 60, 85, 110, 135, 160, 185].map((x, i) => (
            <path key={x} d={`M${x - 6} ${20 + (i % 2) * 3} L${x + 6} ${20 + (i % 2) * 3} L${x} ${34 + (i % 2) * 3} Z`} fill={['#ffd21f', '#1e88e5', '#22b14c'][i % 3]} strokeWidth={2} />
          ))}
          <rect x="-10" y="150" width="220" height="60" fill="#8a5631" />
          <ellipse cx="170" cy="150" rx="22" ry="12" fill="#c96a2b" />
          <path d="M150 152 L144 160 M190 152 L196 160" strokeWidth={3} />
          <path d="M20 140 L38 140 L36 152 L22 152 Z" fill="#ffd21f" />
        </>
      ),
    },
  },
  'plutonium-glow': {
    layers: {
      bg: (c) => (
        <>
          <rect x="-10" y="-10" width="220" height="220" fill="#111111" stroke="none" />
          <path d={rays(100, 80, 20)} fill="#8dff3a" stroke="none" opacity={0.5} />
          <circle cx="100" cy="80" r="60" fill="#8dff3a" stroke="none" opacity={0.35} />
          {c.detail && <rect x="-10" y="-10" width="220" height="220" fill={c.htLight} stroke="none" opacity={0.4} />}
          {[
            [24, 36],
            [176, 40],
            [30, 150],
            [172, 160],
          ].map(([x, y]) => (
            <path key={x} d={star(x!, y!, 7)} fill="#8dff3a" stroke={INK} strokeWidth={2} />
          ))}
        </>
      ),
    },
  },
};
