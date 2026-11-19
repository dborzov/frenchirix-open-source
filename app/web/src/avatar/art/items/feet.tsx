// Footwear. Feet at (84, 184) and (116, 184), ground y ~190.
import type { ReactNode } from 'react';
import { drawBareFeet, Mirror } from '../base';
import { Line, Shine, type ArtCtx, type ItemArtDef } from '../kit';

function sandals(c: ArtCtx, strap: string, extra?: ReactNode): ReactNode {
  return (
    <>
      <Mirror>
        <ellipse cx="84" cy="187" rx="12" ry="4" fill="#5c3a20" />
      </Mirror>
      {drawBareFeet(c)}
      <Mirror>
        <path d="M78 180 L90 186 M90 180 L78 186" fill="none" stroke={strap} strokeWidth={2.6} />
      </Mirror>
      {extra}
    </>
  );
}

function shoe(fill: string, top = 174): ReactNode {
  return (
    <Mirror>
      <path d={`M80 ${top} L92 ${top} L92 180 C98 181 98 190 92 190 L74 190 C70 190 70 182 80 180 Z`} fill={fill} />
    </Mirror>
  );
}

export const FEET_ART: Record<string, ItemArtDef> = {
  sandals: { layers: { feet: (c) => sandals(c, '#8a5631') } },
  'leather-boots': {
    layers: {
      feet: () => (
        <>
          {shoe('#8a5631', 168)}
          <Mirror>
            <path d="M79 168 L93 168 L93 172 L79 172 Z" fill="#5c3a20" strokeWidth={2.2} />
            <Shine d="M74 186 L80 186" opacity={0.6} />
          </Mirror>
        </>
      ),
    },
  },
  'boar-slippers': {
    layers: {
      feet: () => (
        <Mirror>
          <path d="M76 176 L74 170 L80 174 Z M86 176 L86 170 L90 175 Z" fill="#8a5631" strokeWidth={2} />
          <ellipse cx="84" cy="184" rx="13" ry="7.5" fill="#8a5631" />
          <ellipse cx="74" cy="185" rx="4.5" ry="3.6" fill="#d9946b" strokeWidth={2} />
          <circle cx="80" cy="180" r="1.6" fill="#111" stroke="none" />
          <path d="M73 189 l-2 3 M76 189 l1 3" stroke="#fff" strokeWidth={1.8} />
        </Mirror>
      ),
    },
  },
  caligae: {
    layers: {
      feet: (c) =>
        sandals(
          c,
          '#5c3a20',
          <Mirror>
            <path d="M82 166 L93 172 M93 166 L82 172 M82 172 L93 178 M93 172 L82 178" fill="none" stroke="#5c3a20" strokeWidth={2.4} />
            <circle cx="77" cy="190" r="1.1" fill="#ddd" stroke="none" />
            <circle cx="83" cy="190.5" r="1.1" fill="#ddd" stroke="none" />
            <circle cx="89" cy="190" r="1.1" fill="#ddd" stroke="none" />
          </Mirror>,
        ),
    },
  },
  'winged-sandals': {
    layers: {
      feet: (c) =>
        sandals(
          c,
          '#ffd21f',
          <>
            <path d="M76 178 C66 176 58 170 54 162 C60 164 64 163 66 160 C68 166 72 170 78 172 Z" fill="#ffffff" />
            <path d="M124 178 C134 176 142 170 146 162 C140 164 136 163 134 160 C132 166 128 170 122 172 Z" fill="#ffffff" />
            <Line d="M72 174 L62 166 M128 174 L138 166" w={1.4} />
          </>,
        ),
    },
  },
  'roller-sandals': {
    layers: {
      feet: (c) =>
        sandals(
          c,
          '#e8303a',
          <Mirror>
            <circle cx="77" cy="192" r="3.6" fill="#ffd21f" strokeWidth={2.2} />
            <circle cx="91" cy="192" r="3.6" fill="#ffd21f" strokeWidth={2.2} />
            <Line d="M60 186 L66 186 M58 191 L66 191" w={1.8} />
          </Mirror>,
        ),
    },
  },
};
