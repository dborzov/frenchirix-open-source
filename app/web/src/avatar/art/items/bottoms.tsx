// Bottoms: trousers (braies), shorts, kilts. Legs run x 88 and 112 from y 154 to 180.
import { Line, Shade, type ArtCtx, type ItemArtDef } from '../kit';
import { pattern } from './tops';

const TROUSERS = 'M75 148 L125 148 L124 180 L105 180 L100 162 L95 180 L76 180 Z';
const TROUSERS_SHADE = 'M114 150 L125 150 L124 180 L114 180 Z';
const SHORTS = 'M75 148 L125 148 L126 168 L104 170 L100 160 L96 170 L74 168 Z';

function trousers(c: ArtCtx, fill: string, extra?: React.ReactNode) {
  return (
    <>
      <path d={TROUSERS} fill={fill} />
      {extra}
      <Shade c={c} d={TROUSERS_SHADE} />
      <path d="M76 176 L95 176 L95 181 L76 181 Z M105 176 L124 176 L124 181 L105 181 Z" fill={fill} strokeWidth={2.4} />
    </>
  );
}

export const BOTTOM_ART: Record<string, ItemArtDef> = {
  'brown-trousers': { layers: { bottom: (c) => trousers(c, '#8a5631', <Line d="M88 156 L88 172 M112 156 L112 172" w={1.5} opacity={0.4} />) } },
  'striped-trousers': {
    layers: {
      bottom: (c) => {
        const [defs, fill] = pattern(c, 'vstripe', 8, 8, <><rect width="8" height="8" fill="#ffffff" /><rect width="4" height="8" fill="#22b14c" /></>);
        return (
          <>
            {defs}
            {trousers(c, fill)}
          </>
        );
      },
    },
  },
  shorts: {
    layers: {
      bottom: (c) => (
        <>
          <path d={SHORTS} fill="#1e88e5" />
          <Shade c={c} d="M114 150 L125 150 L126 168 L114 169 Z" />
          <Line d="M100 150 L100 158" w={1.6} opacity={0.5} />
        </>
      ),
    },
  },
  'patched-trousers': {
    layers: {
      bottom: (c) =>
        trousers(
          c,
          '#2f7fa8',
          <>
            <rect x="80" y="160" width="10" height="9" fill="#ff7a1a" strokeWidth={2} transform="rotate(-8 85 164)" />
            <rect x="108" y="152" width="9" height="8" fill="#ffd21f" strokeWidth={2} transform="rotate(10 112 156)" />
            <Line d="M81 158 l2 2 M86 170 l2 -2 M108 151 l2 2" w={1.2} />
          </>,
        ),
    },
  },
  'roman-skirt': {
    layers: {
      bottom: () => (
        <>
          <path d={SHORTS} fill="#e8303a" />
          {[74, 81, 88, 95, 102, 109, 116].map((x) => (
            <g key={x}>
              <rect x={x} y="150" width="7" height="22" fill="#8a5631" strokeWidth={2} />
              <circle cx={x + 3.5} cy="168" r="1.5" fill="#ffd21f" stroke="none" />
            </g>
          ))}
        </>
      ),
    },
  },
  'rainbow-trousers': {
    layers: {
      bottom: (c) => {
        const cols = ['#e8303a', '#ff7a1a', '#ffd21f', '#22b14c', '#1e88e5', '#7a3ff2'];
        const [defs, fill] = pattern(
          c,
          'rainbow',
          36,
          36,
          <>
            {cols.map((col, i) => (
              <rect key={col} y={i * 6} width="36" height="6" fill={col} />
            ))}
          </>,
        );
        return (
          <>
            {defs}
            {trousers(c, fill)}
          </>
        );
      },
    },
  },
  'golden-trousers': {
    layers: {
      bottom: (c) =>
        trousers(
          c,
          '#ffd21f',
          <>
            <path d="M82 154 L84 174 M90 152 L91 160" fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" opacity={0.8} />
            <path d="M92 168 l1.5 3 3 .5 -2.2 2 .6 3 -2.9 -1.5 -2.9 1.5 .6 -3 -2.2 -2 3 -.5 Z" fill="#ffffff" strokeWidth={1.2} />
          </>,
        ),
    },
  },
};
