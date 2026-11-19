// Things on the face: glasses, goggles, paint. Eyes are at (85, 78) and (115, 78).
import type { ReactNode } from 'react';
import { Mirror } from '../base';
import { Flat, INK, Line, Shine, type ItemArtDef } from '../kit';

function heart(x: number, y: number, s: number): string {
  return `M${x} ${y + s * 0.9} C${x - s * 1.6} ${y - s * 0.1} ${x - s * 0.9} ${y - s * 1.2} ${x} ${y - s * 0.45} C${x + s * 0.9} ${y - s * 1.2} ${x + s * 1.6} ${y - s * 0.1} ${x} ${y + s * 0.9} Z`;
}
function star(x: number, y: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.5 : r;
    pts.push(`${(x + rr * Math.cos(a)).toFixed(1)} ${(y + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function glasses(lens: (x: number) => ReactNode, bridge = 'M95 77 Q100 73 105 77'): ReactNode {
  return (
    <>
      <Line d="M73 76 L60 73 M127 76 L140 73" w={3} />
      {lens(85)}
      {lens(115)}
      <Line d={bridge} w={3} />
    </>
  );
}

export const FACE_ART: Record<string, ItemArtDef> = {
  'round-glasses': {
    layers: {
      eyewear: () =>
        glasses((x) => (
          <>
            <circle cx={x} cy="78" r="10.5" fill="#ffffff" fillOpacity={0.2} strokeWidth={3.2} />
            <Shine d={`M${x - 6} 74 Q${x - 4} 71 ${x - 1} 70`} opacity={0.8} />
          </>
        )),
    },
  },
  'woad-paint': {
    layers: {
      eyewear: () => (
        <>
          <Mirror>
            <Flat d="M64 86 L84 85 L83 89.5 L65 92 Z" fill="#1e88e5" opacity={0.9} />
            <Flat d="M66 95 L82 94 L81 98 L68 100 Z" fill="#1e88e5" opacity={0.9} />
          </Mirror>
          <path d="M100 52 C106 52 108 58 104 60 C100 62 97 58 100 56" fill="none" stroke="#1e88e5" strokeWidth={2.6} />
        </>
      ),
    },
  },
  'diving-goggles': {
    layers: {
      eyewear: () => (
        <>
          <path d="M58 72 L72 74 M142 72 L128 74" stroke="#111" strokeWidth={6} />
          <path d="M72 70 Q100 64 128 70 L130 86 Q115 92 100 86 Q85 92 70 86 Z" fill="#ffd21f" />
          <path d="M76 73 Q100 68 124 73 L125 83 Q115 88 100 83 Q85 88 75 83 Z" fill="#7fd3ff" fillOpacity={0.6} strokeWidth={2.2} />
          <Shine d="M80 76 L86 74" opacity={0.9} />
        </>
      ),
    },
  },
  sunglasses: {
    layers: {
      eyewear: () => (
        <>
          <Line d="M70 74 L60 71 M130 74 L140 71" w={3} />
          <path d="M70 71 L98 72 L96 82 Q86 90 74 84 Z" fill="#111111" />
          <path d="M130 71 L102 72 L104 82 Q114 90 126 84 Z" fill="#111111" />
          <path d="M66 68 L72 70 L70 75 Z M134 68 L128 70 L130 75 Z" fill="#111111" />
          <Line d="M96 74 L104 74" w={3} />
          <Shine d="M76 75 L84 75 M108 75 L116 75" opacity={0.85} />
        </>
      ),
    },
  },
  monocle: {
    layers: {
      eyewear: () => (
        <>
          <Line d="M124 84 Q132 104 124 124" w={1.6} color="#b8860b" />
          <circle cx="115" cy="78" r="10.5" fill="#ffffff" fillOpacity={0.25} stroke="#e3a72f" strokeWidth={3.4} />
          <circle cx="115" cy="78" r="12.3" fill="none" stroke={INK} strokeWidth={1.4} />
          <Shine d="M109 74 Q111 71 114 70" opacity={0.85} />
        </>
      ),
    },
  },
  'heart-glasses': {
    layers: {
      eyewear: () => glasses((x) => <path d={heart(x, 78, 10)} fill="#e8303a" fillOpacity={0.85} strokeWidth={3} />),
    },
  },
  'star-glasses': {
    layers: {
      eyewear: () =>
        glasses((x) => (
          <>
            <path d={star(x, 79, 14)} fill="#ffd21f" strokeWidth={2.8} />
            <circle cx={x} cy="79" r="5.5" fill="#1e88e5" fillOpacity={0.5} strokeWidth={1.6} />
          </>
        )),
    },
  },
  'disguise-nose': {
    layers: {
      eyewear: () => (
        <>
          <path d="M100 98 C90 96 80 100 76 108 C86 106 94 104 100 104 C106 104 114 106 124 108 C120 100 110 96 100 98 Z" fill="#111111" />
          <ellipse cx="100" cy="91" rx="12" ry="10" fill="#f4a582" />
          <Shine d="M94 86 Q96 84 99 84" opacity={0.8} />
          {glasses(
            (x) => (
              <path d={`M${x - 11} 70 L${x + 11} 70 L${x + 10} 84 Q${x} 89 ${x - 10} 84 Z`} fill="#ffffff" fillOpacity={0.2} strokeWidth={4} />
            ),
            'M96 74 L104 74',
          )}
          <path d="M73 66 Q85 58 97 66 M103 66 Q115 58 127 66" fill="none" stroke="#111" strokeWidth={5} />
        </>
      ),
    },
  },
};
