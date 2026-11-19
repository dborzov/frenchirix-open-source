// In the right hand: sports gear and musical instruments. The grip is the hand at (141, 148); the
// hand is drawn over the item, so draw the handle through that point.
import { INK, Line, Shade, Shine, Tube, U, type ItemArtDef } from '../kit';

const WOOD = '#c98b4a';
const WOOD_DARK = '#8a5631';
const GOLD = '#ffd21f';
const BRONZE = '#e3a72f';
const RED = '#e8303a';
const BLUE = '#1e88e5';

function lyre(frame: string, body: string, extra?: React.ReactNode) {
  return (
    <>
      <path d="M134 150 C122 136 124 112 132 100 L138 104 C134 114 134 132 144 144 Z" fill={frame} />
      <path d="M150 150 C162 136 160 112 152 100 L146 104 C150 114 150 132 140 144 Z" fill={frame} />
      <rect x="128" y="96" width="28" height="7" fill={frame} />
      <Line d="M136 104 L138 146 M142 104 L142 146 M148 104 L146 146" w={1.2} />
      <ellipse cx="142" cy="150" rx="14" ry="7" fill={body} />
      {extra}
    </>
  );
}

export const HELD_ART: Record<string, ItemArtDef> = {
  'wooden-sword': {
    layers: {
      held: () => (
        <>
          <path d="M145 140 L170 92 L176 86 L174 96 L150 144 Z" fill={WOOD} />
          <Line d="M156 120 L168 96" w={1.4} opacity={0.5} />
          <path d="M134 138 L152 148 L150 152 L132 142 Z" fill={WOOD_DARK} />
          <Tube d="M141 148 L136 158" color={WOOD_DARK} w={5} outline={2.6} />
        </>
      ),
    },
  },
  ladle: {
    layers: {
      held: () => (
        <>
          <Tube d="M136 158 L158 96" color="#9aa5b1" w={4} />
          <path d="M148 96 C146 84 164 80 170 90 C172 98 162 104 156 100 Z" fill="#c3ccd6" />
          <path d="M152 92 C154 88 162 86 166 91" fill="none" stroke="#22b14c" strokeWidth={3} />
        </>
      ),
    },
  },
  drum: {
    layers: {
      held: (c) => (
        <>
          <path d="M138 140 L170 140 L170 166 Q154 172 138 166 Z" fill={RED} />
          <Shade c={c} d="M160 141 L170 140 L170 166 Q166 168 160 169 Z" />
          <Line d="M138 146 L148 162 L158 146 L170 162" w={2} color="#ffffff" />
          <ellipse cx="154" cy="140" rx="16" ry="5" fill="#fff3d0" />
          <Tube d="M144 126 L156 138" color={WOOD} w={3} outline={2} />
          <circle cx="143" cy="125" r="3.6" fill="#ffffff" strokeWidth={2} />
        </>
      ),
    },
  },
  'leather-ball': {
    layers: {
      held: (c) => (
        <>
          <circle cx="152" cy="136" r="14" fill={WOOD_DARK} />
          <Shade c={c} d="M160 125 C168 132 168 144 160 150 C164 142 164 132 160 125 Z" />
          <Line d="M140 132 Q152 128 164 134 M146 124 Q150 136 146 148 M158 124 Q154 136 158 148" w={1.6} color="#fff3d0" />
        </>
      ),
    },
  },
  'fishing-rod': {
    layers: {
      held: () => (
        <>
          <Tube d="M136 160 L176 50" color={WOOD} w={3.5} outline={2.4} />
          <Line d="M176 50 L184 94" w={1} />
          <path d="M176 98 C184 92 196 96 198 104 C196 112 184 114 176 108 L170 112 L170 94 Z" fill="#9fb3c8" strokeWidth={2.6} />
          <path d="M187 100 l3 3 M190 100 l-3 3" stroke={INK} strokeWidth={1.6} />
          <Line d="M180 84 q3 -4 0 -8 M188 82 q3 -4 0 -8" w={1.6} color="#22b14c" />
        </>
      ),
    },
  },
  'pan-flute': {
    layers: {
      held: () => (
        <>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <rect key={i} x={134 + i * 4.6} y={120 + i * 3} width="4.6" height={36 - i * 3} fill={WOOD} strokeWidth={2} />
          ))}
          <rect x="132" y="138" width="36" height="5" fill={RED} strokeWidth={2} transform="rotate(10 150 140)" />
        </>
      ),
    },
  },
  'squeaky-lyre': { layers: { held: () => lyre(WOOD, WOOD_DARK, <Line d="M162 98 q4 -4 8 0 M164 90 q4 -4 8 0" w={1.6} />) } },
  'electric-lyre': {
    layers: {
      held: () =>
        lyre(
          BLUE,
          RED,
          <>
            <path d="M162 84 L170 96 L164 97 L172 110 L158 96 L164 95 Z" fill={GOLD} strokeWidth={2} />
            <path d="M120 86 L126 96 L121 97 L127 108 L116 96 L121 95 Z" fill={GOLD} strokeWidth={2} />
            <Line d="M154 154 C164 168 176 160 186 176 C190 184 196 184 198 180" w={2.4} />
          </>,
        ),
    },
  },
  'hockey-stick': {
    layers: {
      held: () => (
        <>
          <Tube d="M130 98 L158 178" color={WOOD} w={6} />
          <path d="M154 172 L160 186 L186 184 L186 178 Z" fill={WOOD} />
          <path d="M160 180 L184 179" stroke={INK} strokeWidth={4} />
          <Tube d="M130 98 L134 110" color={INK} w={6} outline={0} />
        </>
      ),
    },
  },
  carnyx: {
    layers: {
      held: () => (
        <>
          <Tube d="M144 166 L146 36" color={BRONZE} w={5} />
          <path d="M146 40 C140 30 128 22 116 26 C112 32 118 38 126 38 C130 44 138 46 146 46 Z" fill={BRONZE} />
          <path d="M126 38 L116 40 L118 46 Z" fill={RED} strokeWidth={2} />
          <circle cx="134" cy="30" r="2" fill={INK} stroke="none" />
          <path d="M138 26 L142 16 L146 28 Z" fill={BRONZE} strokeWidth={2.2} />
          <Line d="M106 30 q-6 -4 -10 0 M104 40 q-6 2 -8 6" w={2} />
        </>
      ),
    },
  },
  'roman-map': {
    layers: {
      held: (c) => (
        <>
          <path d="M146 100 L184 100 L184 150 L146 150 Z" fill="#fff3d0" />
          <Shade c={c} d="M174 100 L184 100 L184 150 L174 150 Z" opacity={0.4} />
          <path d="M152 112 C158 106 168 110 172 106 C178 112 176 124 170 130 C164 138 156 134 152 128 Z" fill="#22b14c" opacity={0.6} strokeWidth={1.6} />
          <circle cx="178" cy="106" r="2.2" fill={RED} stroke="none" />
          <path d="M160 140 l6 0 M174 140 l4 0" stroke={INK} strokeWidth={1.4} />
          <rect x="142" y="94" width="46" height="8" fill={WOOD} />
          <rect x="142" y="148" width="46" height="8" fill={WOOD} />
        </>
      ),
    },
  },
  'golden-sickle': {
    layers: {
      held: () => (
        <>
          <Tube d="M138 160 L146 132" color={WOOD_DARK} w={6} />
          <path d="M146 132 C150 110 170 98 186 106 C172 104 158 114 152 134 Z" fill={GOLD} />
          <Shine d="M158 116 Q166 108 176 106" opacity={0.9} />
        </>
      ),
    },
  },
  'bard-harp': {
    layers: {
      held: () => (
        <>
          <path d="M140 160 L146 96 C162 96 176 108 182 124 C170 128 160 140 156 160 Z" fill="none" stroke={INK} strokeWidth={10} />
          <path d="M140 160 L146 96 C162 96 176 108 182 124 C170 128 160 140 156 160 Z" fill="none" stroke={WOOD} strokeWidth={4} />
          <Line d="M150 104 L148 158 M158 106 L152 156 M166 112 L156 150 M174 118 L160 142" w={1.1} />
          <circle cx="146" cy="96" r="4" fill={GOLD} strokeWidth={2} />
        </>
      ),
    },
  },
  bagpipes: {
    layers: {
      held: (c) => {
        const id = `tartan-${c.uid}`;
        return (
          <>
            <defs>
              <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse">
                <rect width="10" height="10" fill={RED} />
                <rect width="10" height="3" y="3.5" fill="#1b5e20" />
                <rect width="3" height="10" x="3.5" fill="#1b5e20" opacity="0.8" />
              </pattern>
            </defs>
            <Tube d="M140 128 L150 70" color={INK} w={4} outline={1.6} />
            <Tube d="M150 130 L168 78" color={INK} w={4} outline={1.6} />
            <Tube d="M156 136 L184 96" color={INK} w={3.5} outline={1.6} />
            <circle cx="150" cy="70" r="3" fill={GOLD} strokeWidth={1.6} />
            <circle cx="168" cy="78" r="3" fill={GOLD} strokeWidth={1.6} />
            <circle cx="184" cy="96" r="3" fill={GOLD} strokeWidth={1.6} />
            <U fill={`url(#${id})`}>
              <ellipse cx="152" cy="142" rx="18" ry="13" transform="rotate(-20 152 142)" />
            </U>
            <Tube d="M140 152 L134 172" color={INK} w={4} outline={1.6} />
          </>
        );
      },
    },
  },
};
