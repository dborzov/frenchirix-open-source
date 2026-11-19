// Hair pieces: clips and bows sit on the hair (hairAcc); wigs replace the hair (hidesHair: 'all').
import { Mirror } from '../base';
import { INK, Line, Shade, Tube, U, type ItemArtDef } from '../kit';

export const HAIR_ART: Record<string, ItemArtDef> = {
  'hair-ribbon': {
    layers: {
      hairAcc: () => (
        <g transform="rotate(20 132 44)">
          <path d="M132 44 L116 34 L118 54 Z" fill="#e8303a" />
          <path d="M132 44 L148 34 L146 54 Z" fill="#e8303a" />
          <circle cx="132" cy="44" r="5" fill="#ffd21f" strokeWidth={2.4} />
        </g>
      ),
    },
  },
  'feather-clip': {
    layers: {
      hairAcc: () => (
        <>
          <path d="M132 50 C134 32 146 16 160 8 C160 22 150 40 136 52 Z" fill="#ffffff" />
          <path d="M160 8 C160 16 156 22 152 26 L148 20 C152 14 156 10 160 8 Z" fill="#1e88e5" strokeWidth={2} />
          <Line d="M134 50 Q144 30 158 12" w={1.8} />
          <rect x="126" y="46" width="12" height="7" fill="#ffd21f" transform="rotate(-30 132 50)" strokeWidth={2.2} />
        </>
      ),
    },
  },
  'mistletoe-sprig': {
    layers: {
      hairAcc: () => (
        <>
          <ellipse cx="124" cy="36" rx="5" ry="11" transform="rotate(-40 124 36)" fill="#22b14c" strokeWidth={2.4} />
          <ellipse cx="142" cy="38" rx="5" ry="11" transform="rotate(40 142 38)" fill="#22b14c" strokeWidth={2.4} />
          <Line d="M133 50 L133 34" w={2.4} />
          <circle cx="129" cy="47" r="4" fill="#ffffff" strokeWidth={2.2} />
          <circle cx="137" cy="47" r="4" fill="#ffffff" strokeWidth={2.2} />
          <circle cx="133" cy="52" r="4" fill="#ffffff" strokeWidth={2.2} />
        </>
      ),
    },
  },
  'rainbow-wig': {
    hidesHair: 'all',
    layers: {
      hairBack: () => {
        const circles = Array.from({ length: 13 }, (_, i) => {
          const a = Math.PI * (1.12 - (i / 12) * 1.24);
          return { cx: 100 + 50 * Math.cos(a), cy: 70 - 46 * Math.sin(a) };
        });
        return (
          <>
            <U fill="#e8303a">
              {circles.map((p, i) => (
                <circle key={i} cx={p.cx} cy={p.cy} r="15" />
              ))}
              <ellipse cx="100" cy="64" rx="50" ry="40" />
            </U>
            <g fill="none" strokeLinecap="round" stroke="none">
              <path d="M48 92 C42 24 158 24 152 92" stroke="#ff7a1a" strokeWidth="9" />
              <path d="M56 92 C52 36 148 36 144 92" stroke="#ffd21f" strokeWidth="8" />
              <path d="M62 92 C60 46 140 46 138 92" stroke="#22b14c" strokeWidth="7" />
            </g>
          </>
        );
      },
      hair: () => (
        <>
          <path d="M58 70 C56 44 76 30 100 30 C124 30 144 44 142 70 C134 58 120 52 100 52 C80 52 66 58 58 70 Z" fill="#1e88e5" />
          <path d="M64 62 C70 50 84 44 100 44 C116 44 130 50 136 62 C126 56 114 54 100 54 C86 54 74 56 64 62 Z" fill="#7a3ff2" stroke="none" />
        </>
      ),
    },
  },
  'golden-braids': {
    hidesHair: 'all',
    layers: {
      hair: (c) => (
        <>
          <path d="M57 82 C52 46 72 29 100 29 C128 29 148 46 143 82 C139 72 136 64 128 58 C116 56 106 50 100 40 C94 50 84 56 72 58 C64 64 61 72 57 82 Z" fill="#ffd21f" />
          <Shade c={c} d="M120 34 C136 42 146 60 143 82 C140 70 134 62 128 58 C128 50 125 42 120 34 Z" />
          <Mirror>
            <U fill="#ffd21f">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <ellipse key={i} cx={63 - i * 1.4} cy={90 + i * 12} rx={8 - i * 0.4} ry="8.5" />
              ))}
            </U>
            <Line d="M57 94 L69 88 M56 106 L68 100 M54 118 L66 112 M53 130 L65 124 M51 142 L63 136 M50 154 L62 148" w={1.5} color="#b8860b" />
            <rect x="48" y="166" width="12" height="5" fill="#e8303a" strokeWidth={2} />
            <path d="M50 171 L47 182 L54 178 L60 182 L58 171 Z" fill="#ffd21f" strokeWidth={2} />
          </Mirror>
          <Tube d="M62 60 Q100 44 138 60" color="#e8303a" w={3} outline={2} />
          <circle cx="100" cy="49" r="3" fill="#ffffff" stroke={INK} strokeWidth={1.6} />
        </>
      ),
    },
  },
};
