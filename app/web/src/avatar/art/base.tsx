// The character itself: body, head, face, facial hair and hair styles. Every option id of
// AVATAR_BASE_OPTIONS has a drawing here (a test checks it).
import type { ReactNode } from 'react';
import type { AvatarBase } from '../../../../shared/catalog';
import { ARM_L, ARM_R, Flat, INK, LEG_L, LEG_R, Line, Tube, TORSO, U, type ArtCtx, type Draw } from './kit';

/** Draws its children and their mirror image across x = 100. */
export function Mirror({ children }: { children: ReactNode }) {
  return (
    <>
      <g>{children}</g>
      <g transform="translate(200 0) scale(-1 1)">{children}</g>
    </>
  );
}

const MOUTH_DARK = '#8c2a3a';
const TONGUE = '#ff7d8f';
const UNDERSHIRT = '#f3ead8';
const UNDERSHORTS = '#d8c7a6';

// --- Body ------------------------------------------------------------------------------------

export const drawLegs: Draw = (c) => (
  <>
    <Tube d={LEG_L} color={c.skin} w={12} />
    <Tube d={LEG_R} color={c.skin} w={12} />
  </>
);

/** Under the clothes: plain shorts when no bottom is worn. */
export const drawUndershorts: Draw = () => <path d="M76 150 L124 150 L126 168 L104 170 L100 162 L96 170 L74 168 Z" fill={UNDERSHORTS} />;

export const drawBareFeet: Draw = (c) => (
  <>
    <ellipse cx="84" cy="184" rx="10" ry="5.5" fill={c.skin} />
    <ellipse cx="116" cy="184" rx="10" ry="5.5" fill={c.skin} />
    <Line d="M78 182 L78 185 M82 181 L82 185" w={1.5} color={c.skinDark} />
    <Line d="M122 182 L122 185 M118 181 L118 185" w={1.5} color={c.skinDark} />
  </>
);

export const drawBody: Draw = (c) => (
  <>
    <Tube d={ARM_L} color={c.skin} w={11} />
    <Tube d={ARM_R} color={c.skin} w={11} />
    <path d={TORSO} fill={UNDERSHIRT} />
  </>
);

export const drawNeck: Draw = (c) => (
  <>
    <path d="M92 102 L92 121 Q100 126 108 121 L108 102 Z" fill={c.skin} />
    <path d="M92.5 106 Q100 115 107.5 106 L107.5 113 Q100 118 92.5 113 Z" fill={INK} stroke="none" opacity={0.8} />
  </>
);

export const drawHands: Draw = (c) => (
  <>
    <circle cx="66" cy="154" r="7.5" fill={c.skin} />
    <circle cx="141" cy="148" r="7.5" fill={c.skin} />
    <Line d="M137 144 Q141 142 145 145" w={1.6} color={c.skinDark} />
  </>
);

export function drawHead(c: ArtCtx, ears: boolean): ReactNode {
  return (
    <>
      {ears && (
        <>
          <circle cx="61" cy="80" r="8.5" fill={c.skin} />
          <circle cx="139" cy="80" r="8.5" fill={c.skin} />
        </>
      )}
      <ellipse cx="100" cy="74" rx="40" ry="37" fill={c.skin} />
      {ears && <Line d="M58 77 Q62 79 60 84 M142 77 Q138 79 140 84" w={2} color={c.skinDark} />}
    </>
  );
}

// --- Face ------------------------------------------------------------------------------------

const EYES: Record<AvatarBase['eyes'], (x: number, side: 'l' | 'r') => ReactNode> = {
  round: (x) => (
    <>
      <ellipse cx={x} cy="78" rx="5.6" ry="6.6" fill="#fff" strokeWidth={2.2} />
      <circle cx={x + (x < 100 ? 1.2 : -1.2)} cy="79" r="3.3" fill={INK} stroke="none" />
      <circle cx={x + (x < 100 ? 2.2 : -0.2)} cy="77.6" r="1" fill="#fff" stroke="none" />
      <Line d={`M${x - 6.5} 75 Q${x} 69.5 ${x + 6.5} 75`} w={3.2} />
    </>
  ),
  happy: (x) => <Line d={`M${x - 6} 80 Q${x} 71 ${x + 6} 80`} w={3.6} />,
  wide: (x) => (
    <>
      <ellipse cx={x} cy="77" rx="7.2" ry="7.8" fill="#fff" strokeWidth={2.5} />
      <circle cx={x + (x < 100 ? 1 : -1)} cy="78" r="3.8" fill={INK} stroke="none" />
      <circle cx={x + (x < 100 ? 2.2 : 0.2)} cy="76.4" r="1.3" fill="#fff" stroke="none" />
    </>
  ),
  sleepy: (x) => (
    <>
      <path d={`M${x - 6} 78 Q${x} 85 ${x + 6} 78 Z`} fill={INK} stroke="none" />
      <Line d={`M${x - 7} 77.5 L${x + 7} 77.5`} w={3} />
    </>
  ),
  wink: (x, side) =>
    side === 'l' ? (
      <>
        <ellipse cx={x} cy="78" rx="4.8" ry="5.8" fill={INK} stroke="none" />
        <circle cx={x + 1.6} cy="75.8" r="1.7" fill="#fff" stroke="none" />
      </>
    ) : (
      <Line d={`M${x - 6} 75 L${x + 4} 79 L${x - 6} 83`} w={3.4} />
    ),
  sparkle: (x) => (
    <>
      <ellipse cx={x} cy="77.5" rx="6" ry="7.2" fill={INK} stroke="none" />
      <circle cx={x + 2} cy="74.6" r="2.3" fill="#fff" stroke="none" />
      <circle cx={x - 2.2} cy="80.6" r="1.2" fill="#fff" stroke="none" />
    </>
  ),
};

const BROWS: Record<AvatarBase['brows'], (c: ArtCtx) => ReactNode> = {
  normal: (c) => (
    <Mirror>
      <path d="M76.5 66.5 Q84 59 93.5 63 L93 66 Q85 63.5 77.5 69 Z" fill={browColor(c)} stroke={INK} strokeWidth={1.4} />
    </Mirror>
  ),
  thick: (c) => (
    <Mirror>
      <path d="M76 67.5 Q84 58 94 63 L93 67.5 Q85 64.5 78 70.5 Z" fill={browColor(c)} stroke={INK} strokeWidth={1.6} />
    </Mirror>
  ),
  raised: (c) => (
    <Mirror>
      <Line d="M79 62 Q85 55.5 91 60" w={3.4} color={browColor(c)} />
    </Mirror>
  ),
  cross: (c) => (
    <Mirror>
      <Line d="M78 62.5 L92 67" w={3.6} color={browColor(c)} />
    </Mirror>
  ),
  none: () => null,
};

function browColor(c: ArtCtx): string {
  return c.base.hair === 'bald' && c.base.facialHair === 'none' ? INK : c.hairDark;
}

const MOUTHS: Record<AvatarBase['mouth'], ReactNode> = {
  smile: <Line d="M90 100 Q100 109.5 110 100" w={3.5} />,
  grin: (
    <>
      <path d="M87.5 98.5 Q100 115 112.5 98.5 Z" fill="#fff" strokeWidth={2.8} />
      <Line d="M89.5 101.5 Q100 104 110.5 101.5" w={1.4} opacity={0.5} />
    </>
  ),
  laugh: (
    <>
      <path d="M87 97.5 Q100 119 113 97.5 Z" fill={MOUTH_DARK} strokeWidth={2.8} />
      <path d="M93.5 108.5 Q100 103.5 106.5 108.5 Q100 113.5 93.5 108.5 Z" fill={TONGUE} stroke="none" />
    </>
  ),
  tongue: (
    <>
      <path d="M95.5 102.5 Q95 113.5 100.5 113.5 Q106 113.5 105.5 102.5 Z" fill={TONGUE} strokeWidth={2.4} />
      <Line d="M100.5 104 L100.5 109" w={1.3} opacity={0.4} />
      <Line d="M89 100 Q100 107 111 100" w={3.5} />
    </>
  ),
  oh: <ellipse cx="100" cy="103.5" rx="4.6" ry="5.8" fill={MOUTH_DARK} strokeWidth={2.6} />,
  smirk: <Line d="M90 103 Q102 107 111 98" w={3.5} />,
};

export function drawFace(c: ArtCtx, blinkClass?: string): ReactNode {
  const eye = EYES[c.base.eyes];
  return (
    <>
      {c.detail && (
        <>
          <path d="M124 46 C140 58 142 88 128 103 C120 109 110 111.5 100 111.5 C116 104 129 90 131 72 C132 61 129 52 124 46 Z" fill={c.ht} stroke="none" opacity={0.6} />
          <circle cx="73" cy="94" r="6.5" fill={`url(#htr-${c.uid})`} stroke="none" />
          <circle cx="127" cy="94" r="6.5" fill={`url(#htr-${c.uid})`} stroke="none" />
        </>
      )}
      <g className={blinkClass}>
        {eye(85, 'l')}
        {eye(115, 'r')}
      </g>
      {BROWS[c.base.brows](c)}
    </>
  );
}

/** The lower face, in this order so that moustaches tuck under the nose: beard, mouth, moustache, nose. */
export function drawLowerFace(c: ArtCtx): ReactNode {
  const fh = FACIAL_HAIR[c.base.facialHair];
  return (
    <>
      {fh.chin?.(c)}
      {MOUTHS[c.base.mouth]}
      {fh.stache?.(c)}
      <ellipse cx="100" cy="89" rx="8.5" ry="6.8" fill={c.skin} />
      <Flat d="M95 86.5 Q97 84.5 100 85" fill="#fff" opacity={0.5} />
    </>
  );
}

// --- Facial hair -----------------------------------------------------------------------------

const STACHE_DROOPY = 'M100 94 C92 92 84 94 80 100 C78 106 76 112 71 115 C80 117 88 109 92 103 C95 101 98 100 100 100 C102 100 105 101 108 103 C112 109 120 117 129 115 C124 112 122 106 120 100 C116 94 108 92 100 94 Z';

const FACIAL_HAIR: Record<AvatarBase['facialHair'], { chin?: Draw; stache?: Draw }> = {
  none: {},
  droopy: {
    stache: (c) => (
      <>
        <path d={STACHE_DROOPY} fill={c.hair} />
        <Line d="M88 98 Q84 103 82 108 M112 98 Q116 103 118 108" w={1.4} color={c.hairDark} />
      </>
    ),
  },
  handlebar: {
    stache: (c) => (
      <Mirror>
        <path d="M100 95 C92 92 84 95 78 99 C72 103 66 102 65 96 C62 99 63 106 70 107.5 C80 109 92 103 100 101 Z" fill={c.hair} />
      </Mirror>
    ),
  },
  curly: {
    stache: (c) => (
      <Mirror>
        <path d="M100 95 C93 93 86 95 82 99 C79 102 76 103 73 101 C71 99 72 96 75 96 C72 93 67 96 68 101 C69 107 78 107 84 104 C90 101 96 101 100 101 Z" fill={c.hair} />
      </Mirror>
    ),
  },
  walrus: {
    stache: (c) => (
      <>
        <path d="M100 92 C86 90 73 94 71 105 C76 113 87 109 93 109 L100 107 L107 109 C113 109 124 113 129 105 C127 94 114 90 100 92 Z" fill={c.hair} />
        <Line d="M84 100 L82 108 M91 100 L90 108 M109 100 L110 108 M116 100 L118 108" w={1.4} color={c.hairDark} />
      </>
    ),
  },
  beard: {
    chin: (c) => <path d="M62 84 C61 112 78 129 100 129 C122 129 139 112 138 84 C134 94 128 102 119 105 C113 99 87 99 81 105 C72 102 66 94 62 84 Z" fill={c.hair} />,
    stache: (c) => <path d="M100 94.5 C92 92.5 84 95 81 101 C88 102 94 100.5 100 99.5 C106 100.5 112 102 119 101 C116 95 108 92.5 100 94.5 Z" fill={c.hair} />,
  },
  'long-beard': {
    chin: (c) => (
      <>
        <path d="M62 84 C60 116 76 134 90 142 L100 154 L110 142 C124 134 140 116 138 84 C134 94 128 102 119 105 C113 99 87 99 81 105 C72 102 66 94 62 84 Z" fill={c.hair} />
        <Line d="M90 118 Q93 130 98 140 M110 118 Q107 130 102 140" w={1.5} color={c.hairDark} />
      </>
    ),
    stache: (c) => <path d={STACHE_DROOPY} fill={c.hair} />,
  },
  'braided-beard': {
    chin: (c) => (
      <>
        <U fill={c.hair}>
          <path d="M62 84 C61 110 76 126 100 127 C124 126 139 110 138 84 C134 94 128 102 119 105 C113 99 87 99 81 105 C72 102 66 94 62 84 Z" />
          <ellipse cx="100" cy="132" rx="7" ry="6.5" />
          <ellipse cx="100" cy="143" rx="6.2" ry="6" />
          <ellipse cx="100" cy="153" rx="5.4" ry="5.4" />
        </U>
        <Line d="M95 135 L105 130 M95 146 L105 141" w={1.4} color={c.hairDark} />
        <rect x="94" y="157" width="12" height="5" rx="2" fill="#e8c547" strokeWidth={2} />
      </>
    ),
    stache: (c) => <path d={STACHE_DROOPY} fill={c.hair} />,
  },
  goatee: {
    chin: (c) => <path d="M91 109 C91 120 96 126 100 128 C104 126 109 120 109 109 C104 113 96 113 91 109 Z" fill={c.hair} />,
    stache: (c) => <path d="M100 95 C93 93.5 87 96 85 100 C90 101 95 99.5 100 99.2 C105 99.5 110 101 115 100 C113 96 107 93.5 100 95 Z" fill={c.hair} />,
  },
};

// --- Hair ------------------------------------------------------------------------------------

export interface HairStyle {
  back?: Draw;
  front?: Draw;
  /** What still shows under a hat that covers the crown. Defaults to small sideburns. */
  sides?: Draw;
}

const SIDEBURNS: Draw = (c) => (
  <Mirror>
    <path d="M62 58 C60 68 62 80 66 88 L71 84 C69 76 69 66 71 58 Z" fill={c.hair} />
  </Mirror>
);

const CAP = 'M57 82 C52 46 72 29 100 29 C128 29 148 46 143 82 C139 72 136 64 130 58 C116 64 96 63 84 55 C76 62 64 70 57 82 Z';
const SWEPT = 'M58 80 C54 46 74 30 100 30 C126 30 146 46 142 80 C140 70 134 60 126 55 C110 50 88 52 76 58 C68 64 62 70 58 80 Z';

function curlCircles(): { cx: number; cy: number; r: number }[] {
  const out: { cx: number; cy: number; r: number }[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = ((196 - i * 21.2) * Math.PI) / 180;
    out.push({ cx: 100 + 45 * Math.cos(a), cy: 70 - 40 * Math.sin(a), r: 11.5 });
  }
  return out;
}
const CURLS = curlCircles();

function afroCircles(): { cx: number; cy: number; r: number }[] {
  const out: { cx: number; cy: number; r: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    out.push({ cx: 100 + 50 * Math.cos(a), cy: 64 + 46 * Math.sin(a), r: 15 });
  }
  return out;
}
const AFRO = afroCircles();

const strands = (c: ArtCtx, d: string) => <Line d={d} w={1.6} color={c.hairDark} opacity={0.8} />;

export const HAIR_STYLES: Record<AvatarBase['hair'], HairStyle> = {
  tuft: {
    front: (c) => (
      <>
        <U fill={c.hair}>
          <path d={CAP} />
          <path d="M90 36 C84 20 96 10 101 21 C104 10 118 12 113 28 Z" />
        </U>
        {strands(c, 'M100 24 L101 34 M84 44 Q94 50 104 50')}
      </>
    ),
  },
  short: {
    front: (c) => (
      <>
        <path d={CAP} fill={c.hair} />
        {strands(c, 'M84 44 Q94 50 104 50 M118 42 Q126 48 130 56')}
      </>
    ),
  },
  bowl: {
    front: (c) => (
      <>
        <path d="M55 88 C49 44 72 27 100 27 C128 27 151 44 145 88 L135 88 C135 72 133 64 129 59 L71 59 C67 64 65 72 65 88 Z" fill={c.hair} />
        {strands(c, 'M80 52 L80 59 M92 51 L92 59 M104 51 L104 59 M116 52 L116 59')}
      </>
    ),
    sides: (c) => (
      <Mirror>
        <path d="M58 56 L56 88 L66 88 L67 56 Z" fill={c.hair} />
      </Mirror>
    ),
  },
  spiky: {
    front: (c) => (
      <path
        d="M58 80 L52 54 L65 57 L61 36 L77 44 L82 22 L94 37 L104 16 L111 36 L124 24 L125 44 L140 37 L135 57 L148 55 L142 80 C137 68 131 61 124 58 C112 62 90 62 76 58 C68 62 62 68 58 80 Z"
        fill={c.hair}
      />
    ),
  },
  curly: {
    front: (c) => (
      <U fill={c.hair}>
        <ellipse cx="100" cy="50" rx="42" ry="22" />
        {CURLS.map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={p.r} />
        ))}
        <circle cx="80" cy="54" r="10" />
        <circle cx="96" cy="52" r="10" />
        <circle cx="112" cy="53" r="10" />
        <circle cx="126" cy="58" r="9" />
      </U>
    ),
    sides: (c) => (
      <Mirror>
        <U fill={c.hair}>
          <circle cx="60" cy="66" r="9" />
          <circle cx="60" cy="80" r="8" />
        </U>
      </Mirror>
    ),
  },
  long: {
    back: (c) => <path d="M54 84 C48 40 74 24 100 24 C126 24 152 40 146 84 L151 132 Q137 140 122 130 L78 130 Q63 140 49 132 Z" fill={c.hairDark} />,
    front: (c) => (
      <>
        <path d="M60 102 C50 54 70 30 100 30 C130 30 150 54 140 102 L133 102 C134 84 132 70 128 60 C112 64 94 58 82 48 C76 62 68 72 67 102 Z" fill={c.hair} />
        {strands(c, 'M92 40 Q104 48 120 50')}
      </>
    ),
    sides: (c) => (
      <Mirror>
        <path d="M58 56 L56 104 L67 104 L68 56 Z" fill={c.hair} />
      </Mirror>
    ),
  },
  braids: {
    front: (c) => (
      <>
        <path d={CAP} fill={c.hair} />
        {strands(c, 'M100 30 L100 46')}
        <Braids c={c} />
      </>
    ),
    sides: (c) => (
      <>
        {SIDEBURNS(c)}
        <Braids c={c} />
      </>
    ),
  },
  ponytail: {
    back: (c) => (
      <>
        <path d="M126 44 C150 36 168 54 166 80 C165 100 160 112 150 122 C152 102 148 86 136 72 Z" fill={c.hair} />
        <Line d="M146 60 Q156 76 154 100" w={1.6} color={c.hairDark} />
      </>
    ),
    front: (c) => (
      <>
        <path d={SWEPT} fill={c.hair} />
        <rect x="129" y="44" width="9" height="13" rx="3" transform="rotate(-30 133 50)" fill="#ff5a7a" strokeWidth={2.2} />
        {strands(c, 'M78 48 Q96 40 122 44')}
      </>
    ),
  },
  bun: {
    front: (c) => (
      <>
        <circle cx="100" cy="24" r="15" fill={c.hair} />
        <path d={SWEPT} fill={c.hair} />
        <rect x="88" y="33" width="24" height="6" rx="3" fill="#ffd60a" strokeWidth={2.2} />
        {strands(c, 'M78 48 Q96 42 120 46 M94 18 Q100 14 106 18')}
      </>
    ),
  },
  afro: {
    back: (c) => (
      <U fill={c.hair}>
        <ellipse cx="100" cy="64" rx="52" ry="48" />
        {AFRO.map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={p.r} />
        ))}
      </U>
    ),
    front: (c) => <path d="M60 78 C56 44 76 31 100 31 C124 31 144 44 140 78 C134 64 120 56 100 56 C80 56 66 64 60 78 Z" fill={c.hair} strokeWidth={0} />,
    sides: () => null,
  },
  mohawk: {
    front: (c) => (
      <>
        <Flat d="M66 60 C72 44 86 38 100 38 C114 38 128 44 134 60 C122 50 78 50 66 60 Z" fill={c.hairDark} opacity={0.35} />
        <path d="M91 50 L84 18 L95 26 L100 6 L105 26 L116 18 L109 50 Z" fill={c.hair} />
      </>
    ),
    sides: () => null,
  },
  pigtails: {
    back: (c) => (
      <Mirror>
        <U fill={c.hair}>
          <circle cx="47" cy="64" r="14" />
          <circle cx="40" cy="80" r="12" />
          <circle cx="44" cy="94" r="9" />
        </U>
        <circle cx="58" cy="60" r="4.5" fill="#ff5a7a" strokeWidth={2} />
      </Mirror>
    ),
    front: (c) => (
      <path
        d="M57 82 C52 46 72 29 100 29 C128 29 148 46 143 82 C138 70 132 60 122 54 C112 56 104 52 100 44 C96 52 88 56 78 54 C68 60 62 70 57 82 Z"
        fill={c.hair}
      />
    ),
  },
  wavy: {
    back: (c) => (
      <path
        d="M54 86 C48 42 74 26 100 26 C126 26 152 42 146 86 C151 96 147 106 141 111 C135 105 129 107 124 112 L76 112 C71 107 65 105 59 111 C53 106 49 96 54 86 Z"
        fill={c.hairDark}
      />
    ),
    front: (c) => (
      <path
        d="M58 96 C52 50 72 30 100 30 C128 30 148 50 142 96 C140 82 138 71 134 62 C126 60 120 55 116 48 C110 56 98 58 90 54 C82 60 72 60 66 63 C62 72 60 84 58 96 Z"
        fill={c.hair}
      />
    ),
    sides: (c) => (
      <Mirror>
        <path d="M58 56 C56 70 56 84 58 98 L66 96 L67 56 Z" fill={c.hair} />
      </Mirror>
    ),
  },
  bald: {
    front: () => <Line d="M80 47 Q91 41 104 42" w={3} color="#ffffff" opacity={0.45} />,
    sides: () => null,
  },
};

function Braids({ c }: { c: ArtCtx }) {
  return (
    <Mirror>
      <U fill={c.hair}>
        <ellipse cx="63" cy="92" rx="8" ry="9" />
        <ellipse cx="62" cy="106" rx="7.5" ry="8.5" />
        <ellipse cx="61" cy="119" rx="7" ry="8" />
        <ellipse cx="60" cy="131" rx="6.2" ry="7" />
      </U>
      <Line d="M57 96 L69 90 M56 110 L68 104 M55 123 L67 117" w={1.5} color={c.hairDark} />
      <rect x="54" y="136" width="12" height="5" rx="2" fill="#ffd60a" strokeWidth={2} />
      <path d="M56 141 L54 150 L60 146 L66 150 L64 141 Z" fill={c.hair} strokeWidth={2} />
    </Mirror>
  );
}

export function hasFrontHair(base: AvatarBase): boolean {
  return base.hair !== 'bald';
}

export { SIDEBURNS };
