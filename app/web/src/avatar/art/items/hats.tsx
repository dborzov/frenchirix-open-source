// Hats and helmets. The head's crown spans x 57..143 above y ~58; a hat that hides the hair's crown
// must cover that (hidesHair: 'top').
import type { ReactNode } from 'react';
import { Mirror } from '../base';
import { Flat, INK, Line, Shade, Shine, Tube, U, type ArtCtx, type ItemArtDef } from '../kit';

const STEEL = '#c3ccd6';
const STEEL_DARK = '#7f8b99';
const BRASS = '#e3a72f';
const GOLD = '#ffd21f';
const RED = '#e8303a';
const LEAF = '#22b14c';
const WHITE = '#ffffff';

const DOME = 'M56 63 C54 30 76 16 100 16 C124 16 146 30 144 63 Z';
const DOME_SHADE = 'M118 19 C136 26 146 42 144 63 L126 63 C128 44 126 30 118 19 Z';

function Dome({ c, fill, band, bandY = 54 }: { c: ArtCtx; fill: string; band: string; bandY?: number }) {
  return (
    <>
      <path d={DOME} fill={fill} />
      <Shade c={c} d={DOME_SHADE} />
      <Shine d="M74 30 Q84 22 96 21" />
      <rect x="53" y={bandY} width="94" height="11" fill={band} />
      <Shade c={c} d={`M126 ${bandY} L147 ${bandY} L147 ${bandY + 11} L126 ${bandY + 11} Z`} />
    </>
  );
}

function Rivets({ y, xs }: { y: number; xs: number[] }) {
  return (
    <>
      {xs.map((x) => (
        <circle key={x} cx={x} cy={y} r="2" fill={INK} stroke="none" />
      ))}
    </>
  );
}

function leafRing(color: string, c: ArtCtx, gold = false): ReactNode {
  const leaves: ReactNode[] = [];
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const a = Math.PI * (1.05 - t * 0.5);
    const x = 100 + 44 * Math.cos(a);
    const y = 60 - 22 * Math.sin(a);
    const rot = (-a * 180) / Math.PI + 90 + 35;
    leaves.push(<ellipse key={`l${i}`} cx={x} cy={y} rx="5" ry="10" transform={`rotate(${rot} ${x} ${y})`} fill={color} strokeWidth={2.4} />);
    const mx = 200 - x;
    leaves.push(<ellipse key={`r${i}`} cx={mx} cy={y} rx="5" ry="10" transform={`rotate(${-rot} ${mx} ${y})`} fill={color} strokeWidth={2.4} />);
  }
  return (
    <>
      <Line d="M56 60 Q100 30 144 60" w={3} color={gold ? '#b8860b' : '#157532'} />
      {leaves}
      {gold && c.detail && <Shine d="M70 44 L76 40 M124 40 L130 44" opacity={0.9} />}
      {gold && <path d="M100 34 l2.5 5 5.5 .8 -4 3.9 1 5.5 -5 -2.6 -5 2.6 1 -5.5 -4 -3.9 5.5 -.8 Z" fill={WHITE} strokeWidth={2} />}
    </>
  );
}

function hoodBack(fill: string): (c: ArtCtx) => ReactNode {
  return (c) => (
    <>
      <path d="M48 104 C38 50 64 12 100 12 C136 12 162 50 152 104 C150 116 142 124 132 126 L68 126 C58 124 50 116 48 104 Z" fill={fill} />
      <Shade c={c} d="M128 18 C150 34 158 70 152 104 C150 116 142 124 132 126 C142 100 144 56 128 18 Z" />
    </>
  );
}
const HOOD_RIM = 'M57 76 C54 42 76 24 100 24 C124 24 146 42 143 76 C138 56 122 45 100 45 C78 45 62 56 57 76 Z';

export const HAT_ART: Record<string, ItemArtDef> = {
  'winged-helmet': {
    hidesHair: 'top',
    layers: {
      hat: (c) => (
        <>
          <Mirror>
            <path d="M62 50 C46 44 32 30 26 10 C36 17 43 18 50 16 C48 23 52 27 58 27 C57 33 60 37 66 38 Z" fill={WHITE} />
            <Line d="M54 40 Q42 32 34 18 M58 32 Q50 28 46 20" w={1.8} />
          </Mirror>
          <Dome c={c} fill={STEEL} band={BRASS} />
          <Rivets y={59.5} xs={[64, 82, 100, 118, 136]} />
        </>
      ),
    },
  },
  'woolly-hat': {
    hidesHair: 'top',
    layers: {
      hat: (c) => (
        <>
          <circle cx="100" cy="15" r="10" fill={WHITE} />
          <path d="M57 62 C55 30 76 20 100 20 C124 20 145 30 143 62 Z" fill={RED} />
          <Shade c={c} d={DOME_SHADE} />
          <Line d="M70 30 L74 56 M86 23 L88 56 M100 21 L100 56 M114 23 L112 56 M130 30 L126 56" w={1.6} opacity={0.6} />
          <rect x="53" y="52" width="94" height="14" fill={GOLD} />
          <Line d="M60 55 L60 63 M70 55 L70 63 M80 55 L80 63 M90 55 L90 63 M100 55 L100 63 M110 55 L110 63 M120 55 L120 63 M130 55 L130 63 M140 55 L140 63" w={1.4} opacity={0.5} />
        </>
      ),
    },
  },
  'horned-helmet': {
    hidesHair: 'top',
    layers: {
      hat: (c) => (
        <>
          <Mirror>
            <path d="M60 52 C42 50 30 36 32 12 C38 26 50 34 64 36 Z" fill="#fff3d0" />
            <Line d="M44 40 L48 33 M38 30 L43 25" w={1.8} />
          </Mirror>
          <Dome c={c} fill={STEEL_DARK} band={'#8a5631'} />
          <Rivets y={59.5} xs={[66, 100, 134]} />
        </>
      ),
    },
  },
  'flower-crown': {
    layers: {
      hat: () => {
        const spots: [number, number, string][] = [
          [60, 56, RED],
          [74, 46, GOLD],
          [90, 41, '#1e88e5'],
          [110, 41, RED],
          [126, 46, '#7a3ff2'],
          [140, 56, GOLD],
        ];
        return (
          <>
            <Tube d="M56 60 Q100 30 144 60" color={LEAF} w={4} />
            {spots.map(([x, y, col]) => (
              <g key={x}>
                <U fill={col} w={2.4}>
                  {[0, 72, 144, 216, 288].map((a) => (
                    <circle key={a} cx={x + 5 * Math.cos((a * Math.PI) / 180)} cy={y + 5 * Math.sin((a * Math.PI) / 180)} r="4" />
                  ))}
                </U>
                <circle cx={x} cy={y} r="2.6" fill={a2(col)} strokeWidth={1.6} />
              </g>
            ))}
          </>
        );
      },
    },
  },
  'cauldron-helmet': {
    hidesHair: 'top',
    layers: {
      hat: (c) => (
        <>
          <Mirror>
            <path d="M58 44 C46 44 44 56 54 58" fill="none" strokeWidth={4} />
          </Mirror>
          <path d="M56 62 L62 24 Q100 12 138 24 L144 62 Z" fill="#3b3b47" />
          <Shade c={c} d="M120 18 L138 24 L144 62 L128 62 Z" />
          <Shine d="M72 28 L68 50" opacity={0.4} />
          <rect x="51" y="54" width="98" height="10" fill="#55556a" />
          <path d="M120 64 Q122 74 126 72 Q128 68 126 64 Z" fill="#ff7a1a" strokeWidth={2} />
          <path d="M84 64 Q85 70 88 69 Q90 67 89 64 Z" fill="#ff7a1a" strokeWidth={2} />
        </>
      ),
    },
  },
  'legionary-helmet': {
    hidesHair: 'top',
    hidesEars: true,
    layers: {
      hat: (c) => (
        <>
          <Mirror>
            <path d="M56 58 L54 92 Q60 98 68 94 L72 62 Z" fill={STEEL} />
            <circle cx="62" cy="84" r="2" fill={INK} stroke="none" />
          </Mirror>
          <path d="M50 64 L150 64 L156 70 L44 70 Z" fill={BRASS} />
          <Dome c={c} fill={STEEL} band={BRASS} bandY={52} />
          <rect x="95" y="6" width="10" height="12" fill={BRASS} />
          <circle cx="100" cy="6" r="5" fill={BRASS} />
          <Line d="M84 32 L90 36 L86 40" w={1.8} />
        </>
      ),
    },
  },
  'laurel-wreath': { layers: { hat: (c) => leafRing(LEAF, c) } },
  'golden-laurel': { layers: { hat: (c) => leafRing(GOLD, c, true) } },
  'druid-hood': {
    hidesHair: 'all',
    hidesEars: true,
    layers: {
      hairBack: hoodBack(WHITE),
      hat: (c) => (
        <>
          <path d={HOOD_RIM} fill={WHITE} />
          <Mirror>
            <path d="M57 74 C55 88 58 102 64 112 L71 108 C65 96 63 86 62 74 Z" fill={WHITE} />
          </Mirror>
          <Shade c={c} d="M124 30 C138 40 144 56 143 76 C140 64 134 54 126 49 Z" />
          <Line d="M70 38 Q100 30 130 38" w={1.6} opacity={0.4} />
        </>
      ),
    },
  },
  'chef-toque': {
    hidesHair: 'top',
    layers: {
      hat: (c) => (
        <>
          <U fill={WHITE}>
            <circle cx="78" cy="30" r="16" />
            <circle cx="100" cy="20" r="18" />
            <circle cx="122" cy="30" r="16" />
            <rect x="66" y="28" width="68" height="28" />
          </U>
          <Shade c={c} d="M126 16 C138 22 140 34 134 44 L134 56 L122 56 C128 44 130 28 126 16 Z" />
          <Line d="M84 40 L86 54 M100 36 L100 54 M116 40 L114 54" w={1.6} opacity={0.45} />
          <path d="M57 63 C57 54 66 50 100 50 C134 50 143 54 143 63 Z" fill={WHITE} />
        </>
      ),
    },
  },
  'pirate-hat': {
    hidesHair: 'top',
    layers: {
      hat: (c) => (
        <>
          <path d="M150 34 C164 22 176 26 178 14 C168 18 158 16 146 26 Z" fill={GOLD} />
          <path d="M40 62 C46 30 76 34 100 18 C124 34 154 30 160 62 C130 52 70 52 40 62 Z" fill="#222228" />
          <Shade c={c} d="M120 26 C140 34 154 36 160 62 C150 58 140 56 130 55 Z" />
          <Line d="M46 58 C70 50 130 50 154 58" w={2.4} color={GOLD} />
          <circle cx="100" cy="40" r="7" fill={WHITE} strokeWidth={2.4} />
          <circle cx="97.5" cy="39" r="1.6" fill={INK} stroke="none" />
          <circle cx="102.5" cy="39" r="1.6" fill={INK} stroke="none" />
        </>
      ),
    },
  },
  earmuffs: {
    hidesEars: true,
    layers: {
      hat: (c) => (
        <>
          <Tube d="M59 74 C56 22 144 22 141 74" color="#1e88e5" w={6} />
          <Mirror>
            <U fill="#ff7a1a">
              <circle cx="59" cy="80" r="11" />
              <circle cx="53" cy="74" r="6" />
              <circle cx="53" cy="86" r="6" />
              <circle cx="63" cy="70" r="5" />
              <circle cx="63" cy="90" r="5" />
            </U>
          </Mirror>
          <Shade c={c} d="M134 70 C146 70 150 86 142 94 C152 86 150 72 134 70 Z" />
        </>
      ),
    },
  },
  'centurion-helmet': {
    hidesHair: 'top',
    hidesEars: true,
    layers: {
      hat: (c) => (
        <>
          <path d="M44 30 C48 0 152 0 156 30 Q100 18 44 30 Z" fill={RED} />
          <Line d="M58 22 L56 10 M72 16 L70 4 M86 13 L86 2 M100 12 L100 1 M114 13 L114 2 M128 16 L130 4 M142 22 L144 10" w={1.8} />
          <Mirror>
            <path d="M56 58 L54 92 Q60 98 68 94 L72 62 Z" fill={BRASS} />
          </Mirror>
          <path d="M50 64 L150 64 L156 70 L44 70 Z" fill={BRASS} />
          <Dome c={c} fill={'#e9edf2'} band={BRASS} bandY={52} />
          <Rivets y={57.5} xs={[66, 100, 134]} />
        </>
      ),
    },
  },
  'boar-hat': {
    hidesHair: 'top',
    layers: {
      hat: (c) => (
        <>
          <Mirror>
            <path d="M64 30 L60 8 L80 20 Z" fill="#8a5631" />
          </Mirror>
          <path d="M55 64 C52 28 76 14 100 14 C124 14 148 28 145 64 Z" fill="#8a5631" />
          <Shade c={c} d={DOME_SHADE} />
          <Line d="M70 22 L74 30 M78 18 L80 26 M120 18 L118 26 M128 22 L124 30" w={1.8} />
          <circle cx="82" cy="34" r="5" fill={WHITE} strokeWidth={2.4} />
          <circle cx="118" cy="34" r="5" fill={WHITE} strokeWidth={2.4} />
          <circle cx="83" cy="35" r="2.4" fill={INK} stroke="none" />
          <circle cx="117" cy="35" r="2.4" fill={INK} stroke="none" />
          <Mirror>
            <path d="M88 58 C82 60 78 56 80 50 C82 54 86 54 90 52 Z" fill={WHITE} strokeWidth={2.2} />
          </Mirror>
          <ellipse cx="100" cy="50" rx="13" ry="9" fill="#d9946b" />
          <ellipse cx="95" cy="50" rx="2.4" ry="3.2" fill={INK} stroke="none" />
          <ellipse cx="105" cy="50" rx="2.4" ry="3.2" fill={INK} stroke="none" />
          <rect x="53" y="58" width="94" height="7" fill="#5c3a20" />
        </>
      ),
    },
  },
  'propeller-cap': {
    hidesHair: 'top',
    layers: {
      hat: (c) => (
        <>
          <path d="M98 16 L102 16 L102 28 L98 28 Z" fill={INK} />
          <path d="M100 16 C88 8 72 10 68 16 C76 20 90 20 100 16 C110 12 126 12 132 16 C126 22 112 22 100 16 Z" fill={GOLD} />
          <circle cx="100" cy="16" r="3" fill={RED} strokeWidth={2} />
          <path d="M57 62 C55 34 76 26 100 26 C124 26 145 34 143 62 Z" fill={RED} />
          <path d="M100 26 C88 36 84 50 84 62 L116 62 C116 50 112 36 100 26 Z" fill="#1e88e5" />
          <Shade c={c} d={DOME_SHADE} />
          <path d="M100 58 L162 58 C164 66 150 70 100 66 Z" fill={RED} />
        </>
      ),
    },
  },
  'dino-hood': {
    hidesHair: 'all',
    hidesEars: true,
    layers: {
      hairBack: hoodBack('#3fbf5a'),
      hat: (c) => (
        <>
          {[
            [70, 22],
            [86, 12],
            [104, 8],
            [122, 12],
            [136, 22],
          ].map(([x, y]) => (
            <path key={x} d={`M${x! - 8} ${y! + 12} L${x} ${y! - 6} L${x! + 8} ${y! + 12} Z`} fill="#ff7a1a" />
          ))}
          <path d={HOOD_RIM} fill="#3fbf5a" />
          <Mirror>
            <path d="M57 74 C55 88 58 102 64 112 L71 108 C65 96 63 86 62 74 Z" fill="#3fbf5a" />
          </Mirror>
          <Shade c={c} d="M124 30 C138 40 144 56 143 76 C140 64 134 54 126 49 Z" />
          {[68, 80, 92, 104, 116, 128].map((x, i) => (
            <path key={x} d={`M${x} ${i === 0 || i === 5 ? 56 : 47} l5 9 l5 -9 Z`} fill={WHITE} strokeWidth={1.8} />
          ))}
          <circle cx="80" cy="30" r="5" fill={WHITE} strokeWidth={2.2} />
          <circle cx="120" cy="30" r="5" fill={WHITE} strokeWidth={2.2} />
          <circle cx="81" cy="31" r="2.4" fill={INK} stroke="none" />
          <circle cx="119" cy="31" r="2.4" fill={INK} stroke="none" />
          <Flat d="M70 40 Q100 34 130 40" fill="none" />
        </>
      ),
    },
  },
};

function a2(col: string): string {
  return col === GOLD ? '#ff7a1a' : GOLD;
}
