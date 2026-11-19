// Tops: tunics, togas, armour, suits. Each draws the torso and the sleeves over the plain shirt.
import type { ReactNode } from 'react';
import { Mirror } from '../base';
import { INK, Line, Shade, Shine, SLEEVE_L, SLEEVE_R, TORSO, TORSO_SHADE, Tube, type ArtCtx, type ItemArtDef } from '../kit';

/** An inline pattern; returns the defs and the fill url. Ids are unique per avatar and item. */
export function pattern(c: ArtCtx, name: string, w: number, h: number, body: ReactNode, rotate = 0): [ReactNode, string] {
  const id = `${name}-${c.uid}`;
  return [
    <defs key="d">
      <pattern id={id} width={w} height={h} patternUnits="userSpaceOnUse" patternTransform={rotate ? `rotate(${rotate})` : undefined}>
        {body}
      </pattern>
    </defs>,
    `url(#${id})`,
  ];
}

function Shirt({ c, fill, sleeve = fill, torso = TORSO, children }: { c: ArtCtx; fill: string; sleeve?: string; torso?: string; children?: ReactNode }) {
  return (
    <>
      <Tube d={SLEEVE_L} color={sleeve} w={14} />
      <Tube d={SLEEVE_R} color={sleeve} w={14} />
      <path d={torso} fill={fill} />
      {children}
      <Shade c={c} d={TORSO_SHADE} />
    </>
  );
}

const BELT = (color = '#5c3a20', buckle = '#ffd21f') => (
  <>
    <path d="M70 146 L130 146 L130.5 153 L69.5 153 Z" fill={color} strokeWidth={2.6} />
    <rect x="95" y="144.5" width="10" height="10" fill={buckle} strokeWidth={2.4} />
  </>
);

function tunic(fill: string, trim: string): ItemArtDef {
  return {
    layers: {
      top: (c) => (
        <Shirt c={c} fill={fill}>
          <path d="M70 160 Q100 166 130 160 L130.4 155 Q100 161 69.6 155 Z" fill={trim} strokeWidth={2.2} />
          {BELT()}
          <Line d="M86 124 L92 134 M114 124 L108 134" w={1.6} opacity={0.5} />
        </Shirt>
      ),
    },
  };
}

function toga(c: ArtCtx, fill: string): ReactNode {
  return (
    <>
      <Shirt c={c} fill={fill} />
      <path d="M80 120 L96 120 L132 156 L130 162 L116 163 Z" fill={fill} />
      <Line d="M90 122 L124 158 M84 128 L112 160" w={1.8} opacity={0.6} />
      <Shade c={c} d="M96 120 L132 156 L130 160 Z" />
    </>
  );
}

function armour(c: ArtCtx, plate: string, trim: string): ReactNode {
  return (
    <>
      <Shirt c={c} fill={plate} sleeve="#e8303a">
        {[128, 138, 148].map((y) => (
          <path key={y} d={`M71 ${y} L129 ${y} L129.6 ${y + 8} L70.4 ${y + 8} Z`} fill={plate} strokeWidth={2.4} />
        ))}
        <path d="M84 118 L116 118 L118 128 L82 128 Z" fill={trim} strokeWidth={2.4} />
        <Line d="M100 128 L100 156" w={1.6} opacity={0.6} />
        <circle cx="76" cy="124" r="2.2" fill={INK} stroke="none" />
        <circle cx="124" cy="124" r="2.2" fill={INK} stroke="none" />
        {[74, 82, 90, 98, 106, 114, 122].map((x) => (
          <rect key={x} x={x} y="156" width="6" height="10" fill="#8a5631" strokeWidth={2} />
        ))}
      </Shirt>
      <Mirror>
        <path d="M70 120 Q76 116 86 118 L84 132 Q74 134 68 130 Z" fill={trim} strokeWidth={2.4} />
      </Mirror>
      <Shine d="M78 134 L92 134 M78 144 L92 144" opacity={0.8} />
    </>
  );
}

export const TOP_ART: Record<string, ItemArtDef> = {
  'red-tunic': tunic('#e8303a', '#ffd21f'),
  'green-tunic': tunic('#22b14c', '#ff7a1a'),
  'striped-tunic': {
    layers: {
      top: (c) => {
        const [defs, fill] = pattern(c, 'stripe', 10, 10, <><rect width="10" height="10" fill="#ffffff" /><rect width="10" height="5" fill="#1e88e5" /></>);
        return (
          <>
            {defs}
            <Shirt c={c} fill={fill} sleeve="#1e88e5">
              {BELT()}
            </Shirt>
          </>
        );
      },
    },
  },
  'banquet-bib': {
    layers: {
      top: (c) => (
        <>
          <Line d="M88 120 Q80 112 82 106 M112 120 Q120 112 118 106" w={2} />
          <path d="M84 120 L116 120 L120 154 Q100 160 80 154 Z" fill="#ffffff" />
          <Shade c={c} d="M110 120 L116 120 L120 154 Q114 156 108 157 Z" />
          <circle cx="94" cy="134" r="4" fill="#ff7a1a" stroke="none" />
          <circle cx="108" cy="145" r="3" fill="#8a5631" stroke="none" />
          <circle cx="90" cy="148" r="2.4" fill="#e8303a" stroke="none" />
          <path d="M96 128 L104 132 M104 128 L96 132" stroke="#e8303a" strokeWidth={1.6} />
        </>
      ),
    },
  },
  'sailor-shirt': {
    layers: {
      top: (c) => {
        const [defs, fill] = pattern(c, 'mariniere', 8, 8, <><rect width="8" height="8" fill="#ffffff" /><rect y="5" width="8" height="3" fill="#1b2f7a" /></>);
        return (
          <>
            {defs}
            <Shirt c={c} fill={fill} />
            <path d="M88 118 L112 118 L100 130 Z" fill="#ffffff" strokeWidth={2.4} />
          </>
        );
      },
    },
  },
  'fur-vest': {
    layers: {
      top: (c) => (
        <Mirror>
          <path d="M72 158 C69 138 74 124 88 118 L94 120 L92 132 L95 140 L91 148 L94 156 L90 164 L84 160 L78 164 Z" fill="#8a5631" />
          <Line d="M76 132 l4 3 M80 146 l4 3 M78 124 l3 3" w={1.8} />
          <Shade c={c} d="M72 140 L80 140 L82 160 L72 158 Z" opacity={0.5} />
        </Mirror>
      ),
    },
  },
  'white-toga': { layers: { top: (c) => toga(c, '#ffffff') } },
  'polka-dot-toga': {
    layers: {
      top: (c) => {
        const [defs, fill] = pattern(c, 'dots', 12, 12, <><rect width="12" height="12" fill="#ffd21f" /><circle cx="3" cy="3" r="2.6" fill="#e8303a" /><circle cx="9" cy="9" r="2.6" fill="#e8303a" /></>);
        return (
          <>
            {defs}
            {toga(c, fill)}
          </>
        );
      },
    },
  },
  chainmail: {
    layers: {
      top: (c) => {
        const [defs, fill] = pattern(c, 'mail', 6, 5, <><rect width="6" height="5" fill="#b7c0cb" /><path d="M0 5 Q3 0 6 5" fill="none" stroke="#5d6774" strokeWidth="1.2" /></>);
        return (
          <>
            {defs}
            <Shirt c={c} fill={fill} sleeve="#b7c0cb">
              {BELT('#5c3a20', '#c3ccd6')}
            </Shirt>
          </>
        );
      },
    },
  },
  'druid-robe': {
    layers: {
      top: (c) => (
        <>
          <Tube d="M80 124 Q70 136 66 146" color="#ffffff" w={18} />
          <Tube d="M120 124 Q132 132 138 140" color="#ffffff" w={18} />
          <path d="M70 160 C68 138 74 123 88 118 L112 118 C126 123 132 138 130 160 L136 180 Q100 186 64 180 Z" fill="#ffffff" />
          <Shade c={c} d="M114 119 C126 124 132 140 130 160 L136 180 Q126 182 116 183 C122 160 120 136 114 119 Z" />
          <path d="M70 144 L130 144 L130 150 L70 150 Z" fill="#e8303a" strokeWidth={2.4} />
          <Line d="M84 150 L80 166 M88 150 L90 164" w={2.4} color="#e8303a" />
          <Line d="M100 152 L100 180" w={1.6} opacity={0.5} />
        </>
      ),
    },
  },
  'hockey-jersey': {
    layers: {
      top: (c) => (
        <>
          <Shirt c={c} fill="#e8303a">
            <path d="M70 150 L130 150 L130.4 156 L69.6 156 Z" fill="#ffffff" strokeWidth={2.2} />
            <path d="M96 128 L102 124 L104 124 L104 144 L99 144 L99 131 L96 132 Z" fill="#ffffff" strokeWidth={1.8} />
          </Shirt>
          <Line d="M72 132 L78 136 M126 128 L131 132" w={4} color="#ffffff" />
          <path d="M88 118 L112 118 L100 126 Z" fill="#ffffff" strokeWidth={2.2} />
        </>
      ),
    },
  },
  'legionary-armour': { layers: { top: (c) => armour(c, '#c3ccd6', '#e3a72f') } },
  'gold-armour': {
    layers: {
      top: (c) => (
        <>
          {armour(c, '#ffd21f', '#ff7a1a')}
          <path d="M100 132 l2.5 5 5.5 .8 -4 3.9 1 5.5 -5 -2.6 -5 2.6 1 -5.5 -4 -3.9 5.5 -.8 Z" fill="#ffffff" strokeWidth={1.8} />
        </>
      ),
    },
  },
  'dinosaur-suit': {
    layers: {
      back: () => (
        <>
          <path d="M80 150 C60 156 40 164 20 150 C30 172 60 178 84 168 Z" fill="#3fbf5a" />
          {[30, 44, 58].map((x, i) => (
            <path key={x} d={`M${x} ${158 + i * 2} l5 -11 l5 11 Z`} fill="#ff7a1a" strokeWidth={2.2} />
          ))}
        </>
      ),
      top: (c) => (
        <>
          <Shirt c={c} fill="#3fbf5a">
            <ellipse cx="100" cy="144" rx="17" ry="17" fill="#ffd21f" strokeWidth={2.6} />
            <Line d="M86 136 L114 136 M84 146 L116 146 M88 155 L112 155" w={1.6} opacity={0.5} />
          </Shirt>
          <Mirror>
            <path d="M74 124 l2 -10 l7 7 Z" fill="#ff7a1a" strokeWidth={2.2} />
          </Mirror>
        </>
      ),
      bottom: () => <path d="M76 148 L124 148 L123 180 L105 180 L100 162 L95 180 L77 180 Z" fill="#3fbf5a" />,
    },
  },
};
