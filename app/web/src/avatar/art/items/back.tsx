// On the back: capes, wings, shields and packs, drawn behind the body ('back'), with straps or
// clasps over the top ('collar').
import type { ReactNode } from 'react';
import { Mirror } from '../base';
import { INK, Line, Shade, Shine, Tube, type ArtCtx, type ItemArtDef } from '../kit';

function cape(c: ArtCtx, fill: string, lining: string, long = false): ReactNode {
  const bottom = long ? 186 : 176;
  return (
    <>
      <path d={`M74 120 L126 120 L148 ${bottom} Q124 ${bottom + 6} 112 ${bottom - 2} Q100 ${bottom + 6} 88 ${bottom - 2} Q76 ${bottom + 6} 52 ${bottom} Z`} fill={fill} />
      <path d={`M126 120 L148 ${bottom} Q140 ${bottom + 3} 134 ${bottom + 2} Z`} fill={lining} strokeWidth={2.2} />
      <Shade c={c} d={`M118 122 L126 120 L148 ${bottom} Q140 ${bottom + 3} 132 ${bottom + 1} Z`} />
    </>
  );
}
const clasp = (color: string) => () => (
  <>
    <Mirror>
      <circle cx="82" cy="122" r="4.5" fill={color} strokeWidth={2.4} />
    </Mirror>
    <Line d="M86 122 Q100 128 114 122" w={2.4} color={color} />
  </>
);

function wings(c: ArtCtx, a: string, b: string, spots: boolean): ReactNode {
  return (
    <Mirror>
      <path d="M92 130 C70 96 40 92 24 104 C22 122 40 136 60 138 C44 146 38 162 50 172 C66 172 82 158 92 142 Z" fill={a} />
      {spots && (
        <>
          <circle cx="46" cy="114" r="7" fill={b} strokeWidth={2.4} />
          <circle cx="58" cy="158" r="5" fill={b} strokeWidth={2.4} />
        </>
      )}
      {!spots && <Line d="M88 132 C70 110 48 106 32 110 M86 138 C70 136 56 134 44 130" w={1.6} />}
      {c.detail && <path d="M92 130 C80 112 64 104 50 102 C70 112 80 124 88 140 Z" fill={c.ht} stroke="none" />}
    </Mirror>
  );
}

export const BACK_ART: Record<string, ItemArtDef> = {
  'small-cape': { layers: { back: (c) => cape(c, '#8a5631', '#ffd21f'), collar: clasp('#ffd21f') } },
  'red-cape': { layers: { back: (c) => cape(c, '#e8303a', '#ffd21f', true), collar: clasp('#ffd21f') } },
  'chieftain-cape': {
    layers: {
      back: (c) => (
        <>
          {cape(c, '#7a3ff2', '#ffd21f', true)}
          <path d="M52 186 Q76 192 88 184 Q100 192 112 184 Q124 192 148 186 L146 180 Q124 186 112 178 Q100 186 88 178 Q76 186 54 180 Z" fill="#ffd21f" strokeWidth={2.4} />
        </>
      ),
      collar: () => (
        <>
          <path d="M70 124 Q76 112 90 116 L110 116 Q124 112 130 124 Q120 130 100 128 Q80 130 70 124 Z" fill="#ffffff" />
          {[78, 90, 102, 114, 124].map((x) => (
            <path key={x} d={`M${x} 121 l1.5 3 -3 0 Z`} fill={INK} stroke="none" />
          ))}
        </>
      ),
    },
  },
  'butterfly-wings': { layers: { back: (c) => wings(c, '#ff7a1a', '#1e88e5', true) } },
  'phoenix-wings': {
    layers: {
      back: (c) => (
        <Mirror>
          <path d="M94 128 C72 92 46 70 14 66 C26 78 30 86 30 94 C18 92 10 96 6 104 C20 104 28 110 32 118 C22 122 18 130 18 138 C32 132 44 134 54 140 C46 150 46 160 50 168 C62 156 78 150 94 146 Z" fill="#ff7a1a" />
          <path d="M92 132 C76 108 58 94 36 90 C46 100 48 110 46 118 C58 120 66 128 70 138 C78 136 86 136 92 140 Z" fill="#ffd21f" strokeWidth={2} />
          <path d="M88 134 C80 124 72 116 62 112 C66 120 66 128 64 132 C72 132 80 134 88 138 Z" fill="#e8303a" strokeWidth={1.6} />
          {c.detail && <path d="M94 128 C80 104 60 84 34 74 C60 92 80 116 90 142 Z" fill={c.ht} stroke="none" opacity={0.5} />}
        </Mirror>
      ),
    },
  },
  'cauldron-backpack': {
    layers: {
      back: (c) => (
        <>
          <path d="M104 92 L156 92 L152 126 Q130 140 108 126 Z" fill="#3b3b47" />
          <Shade c={c} d="M140 92 L156 92 L152 126 Q146 130 140 132 Z" />
          <rect x="100" y="86" width="60" height="9" fill="#55556a" />
          <path d="M116 86 C112 76 120 72 122 80 M130 86 C128 72 140 70 138 82 M146 86 C146 78 152 78 150 84" fill="none" stroke="#ffffff" strokeWidth={2.4} opacity={0.9} />
        </>
      ),
      collar: () => <Tube d="M86 119 L80 150" color="#5c3a20" w={4} outline={2.4} />,
    },
  },
  'round-shield': {
    layers: {
      back: (c) => (
        <>
          <circle cx="100" cy="142" r="44" fill={'#e8303a'} />
          <circle cx="100" cy="142" r="36" fill="none" stroke="#ffd21f" strokeWidth={5} />
          <Shade c={c} d="M126 108 C146 124 150 158 132 176 C142 154 140 128 126 108 Z" />
          <Line d="M64 142 L136 142 M100 98 L100 186" w={2} opacity={0.5} />
        </>
      ),
    },
  },
  'menhir-backpack': {
    layers: {
      back: (c) => (
        <>
          <path d="M120 176 L116 70 C116 40 132 22 146 24 C162 26 170 50 168 80 L160 176 Z" fill="#c3c7cc" transform="rotate(8 142 100)" />
          <g transform="rotate(8 142 100)">
            <Shade c={c} d="M152 28 C164 36 170 56 168 80 L160 176 L148 176 C156 130 160 70 152 28 Z" />
            <Line d="M130 60 q6 4 12 0 M128 100 q8 6 14 2 M136 140 q6 4 10 0" w={1.8} />
          </g>
        </>
      ),
      collar: () => (
        <>
          <Tube d="M116 119 L120 150" color="#5c3a20" w={4} outline={2.4} />
          <Tube d="M84 119 L80 150" color="#5c3a20" w={4} outline={2.4} />
        </>
      ),
    },
  },
};


