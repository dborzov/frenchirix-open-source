// Companions stand to the left of the character, x 10..64, ground y ~190.
import { Mirror } from '../base';
import { INK, Line, Shade, Tube, U, type ItemArtDef } from '../kit';

const eye = (x: number, y: number, r = 2.6) => (
  <>
    <circle cx={x} cy={y} r={r + 1.6} fill="#ffffff" strokeWidth={1.8} />
    <circle cx={x + 0.6} cy={y + 0.4} r={r * 0.75} fill={INK} stroke="none" />
  </>
);
const shadow = <ellipse cx="38" cy="190" rx="24" ry="4" fill={INK} stroke="none" opacity={0.25} />;

export const PET_ART: Record<string, ItemArtDef> = {
  puppy: {
    layers: {
      pet: (c) => (
        <>
          {shadow}
          <Tube d="M56 176 Q66 168 62 160" color="#c98b4a" w={4} />
          <path d="M22 188 C20 168 28 156 40 156 C52 156 58 168 56 188 Z" fill="#c98b4a" />
          <Shade c={c} d="M48 158 C56 164 58 176 56 188 L50 188 C52 176 52 166 48 158 Z" />
          <ellipse cx="34" cy="176" rx="6" ry="5" fill="#fff3d0" strokeWidth={0} />
          <path d="M18 146 C16 128 26 120 38 120 C50 120 60 128 58 146 C56 156 48 160 38 160 C28 160 20 156 18 146 Z" fill="#c98b4a" />
          <path d="M20 128 C10 130 8 146 14 152 C20 148 22 138 24 132 Z M56 128 C66 130 68 146 62 152 C56 148 54 138 52 132 Z" fill="#5c3a20" />
          <circle cx="46" cy="134" r="5" fill="#5c3a20" stroke="none" />
          {eye(30, 138)}
          {eye(46, 138)}
          <ellipse cx="38" cy="148" rx="7" ry="5" fill="#fff3d0" />
          <ellipse cx="38" cy="145.5" rx="3.6" ry="2.6" fill={INK} stroke="none" />
          <path d="M36 152 Q38 158 41 152" fill="#e8303a" strokeWidth={1.6} />
        </>
      ),
    },
  },
  piglet: {
    layers: {
      pet: () => (
        <>
          {shadow}
          <rect x="24" y="178" width="7" height="11" fill="#8a5631" strokeWidth={2.4} />
          <rect x="48" y="178" width="7" height="11" fill="#8a5631" strokeWidth={2.4} />
          <ellipse cx="40" cy="170" rx="24" ry="16" fill="#8a5631" />
          <Line d="M30 158 Q34 170 30 182 M40 155 Q44 170 40 185 M50 158 Q54 170 50 182" w={2.4} color="#d9b48a" />
          <path d="M22 158 L16 146 L28 152 Z" fill="#8a5631" strokeWidth={2.4} />
          {eye(24, 164, 2)}
          <ellipse cx="14" cy="172" rx="6" ry="5" fill="#d9946b" />
          <circle cx="12.5" cy="172" r="1.2" fill={INK} stroke="none" />
          <circle cx="15.5" cy="172" r="1.2" fill={INK} stroke="none" />
          <path d="M64 166 q6 -4 4 -10" fill="none" strokeWidth={2.4} />
        </>
      ),
    },
  },
  snail: {
    layers: {
      pet: () => (
        <>
          {shadow}
          <path d="M14 188 L58 188 C60 182 56 178 50 178 L22 178 C18 166 10 168 10 176 C10 182 12 186 14 188 Z" fill="#9ccc65" />
          <Line d="M16 170 L12 156 M20 170 L22 156" w={2} />
          <circle cx="12" cy="155" r="2.6" fill={INK} stroke="none" />
          <circle cx="22" cy="155" r="2.6" fill={INK} stroke="none" />
          <circle cx="40" cy="166" r="16" fill="#ff7a1a" />
          <path d="M40 166 m0 -10 a10 10 0 1 1 -9 6 a6 6 0 1 1 6 8 a2 2 0 1 1 2 -3" fill="none" strokeWidth={2.4} />
          <Line d="M62 160 L70 160 M60 168 L72 168 M62 176 L70 176" w={2} />
        </>
      ),
    },
  },
  rooster: {
    layers: {
      pet: () => (
        <>
          {shadow}
          <Line d="M32 176 L30 190 L24 190 M42 176 L44 190 L50 190" w={2.6} color="#ff7a1a" />
          <path d="M50 150 C64 136 66 120 60 112 C70 120 72 140 62 156 Z" fill="#1e88e5" />
          <path d="M54 146 C66 140 70 128 68 120 C74 134 70 150 58 158 Z" fill="#e8303a" strokeWidth={2.4} />
          <ellipse cx="38" cy="162" rx="20" ry="16" fill="#ffffff" />
          <path d="M28 150 C22 140 20 128 28 122 C36 118 42 124 42 134 L44 152 Z" fill="#ffffff" />
          <path d="M26 122 C24 114 30 112 32 118 C32 110 40 110 38 120 Z" fill="#e8303a" strokeWidth={2.4} />
          <path d="M20 130 L12 133 L20 136 Z" fill="#ffd21f" strokeWidth={2.2} />
          <path d="M22 138 C20 144 26 146 26 140 Z" fill="#e8303a" strokeWidth={1.8} />
          {eye(28, 128, 2)}
          <path d="M30 160 C38 154 48 156 52 164 C44 166 36 166 30 160 Z" fill="#1e88e5" strokeWidth={2.2} />
        </>
      ),
    },
  },
  cat: {
    layers: {
      pet: (c) => (
        <>
          {shadow}
          <path d="M54 186 C70 184 72 166 62 152" fill="none" stroke={INK} strokeWidth={10} strokeLinecap="round" />
          <path d="M54 186 C70 184 72 166 62 152" fill="none" stroke="#ff7a1a" strokeWidth={5} strokeLinecap="round" />
          <path d="M22 188 C18 166 26 152 38 152 C50 152 58 166 54 188 Z" fill="#ff7a1a" />
          <Shade c={c} d="M46 154 C54 160 58 174 54 188 L48 188 C50 174 50 162 46 154 Z" />
          <path d="M20 118 L24 132 L32 126 Z M56 118 L52 132 L44 126 Z" fill="#ff7a1a" />
          <ellipse cx="38" cy="140" rx="19" ry="16" fill="#ff7a1a" />
          <Line d="M30 126 L32 132 M38 125 L38 131 M46 126 L44 132" w={2} />
          <path d="M26 140 Q30 136 34 140 M42 140 Q46 136 50 140" fill="none" strokeWidth={2.6} />
          <path d="M36 145 L40 145 L38 148 Z" fill="#e8303a" strokeWidth={1.4} />
          <Line d="M14 146 L28 148 M14 152 L28 150 M62 146 L48 148 M62 152 L48 150" w={1.2} />
        </>
      ),
    },
  },
  owl: {
    layers: {
      pet: (c) => (
        <>
          <path d="M18 190 L22 172 L56 172 L60 190 Z" fill="#8a5631" />
          <ellipse cx="39" cy="172" rx="19" ry="4" fill="#c98b4a" />
          <path d="M22 168 C16 140 24 120 39 120 C54 120 62 140 56 168 Z" fill="#a0623a" />
          <Shade c={c} d="M48 122 C58 132 60 152 56 168 L50 168 C54 152 54 136 48 122 Z" />
          <path d="M22 122 L26 112 L32 120 Z M56 122 L52 112 L46 120 Z" fill="#a0623a" />
          <ellipse cx="39" cy="154" rx="11" ry="12" fill="#fff3d0" strokeWidth={2.2} />
          <Line d="M33 150 l3 3 3 -3 3 3 3 -3 M33 158 l3 3 3 -3 3 3 3 -3" w={1.3} />
          <circle cx="31" cy="134" r="7.5" fill="#ffd21f" strokeWidth={2.4} />
          <circle cx="47" cy="134" r="7.5" fill="#ffd21f" strokeWidth={2.4} />
          <circle cx="31" cy="134" r="3.4" fill={INK} stroke="none" />
          <circle cx="47" cy="134" r="3.4" fill={INK} stroke="none" />
          <path d="M36 140 L42 140 L39 146 Z" fill="#ff7a1a" strokeWidth={2} />
        </>
      ),
    },
  },
  goose: {
    layers: {
      pet: () => (
        <>
          {shadow}
          <Line d="M36 180 L34 190 L28 190 M44 180 L46 190 L52 190" w={2.6} color="#ff7a1a" />
          <path d="M18 168 C18 156 30 152 44 156 C58 160 64 168 60 178 C52 186 30 186 22 180 Z" fill="#ffffff" />
          <path d="M60 166 L66 158 L64 170 Z" fill="#ffffff" strokeWidth={2.4} />
          <Tube d="M26 160 C20 146 22 132 30 128" color="#ffffff" w={9} />
          <path d="M28 124 C22 122 16 126 14 130 L22 132 C24 130 28 130 30 132 Z" fill="#ff7a1a" strokeWidth={2.2} />
          <ellipse cx="32" cy="128" rx="7" ry="6" fill="#ffffff" strokeWidth={0} />
          <circle cx="31" cy="126" r="1.8" fill={INK} stroke="none" />
          <Line d="M34 166 C40 172 50 172 54 166" w={1.8} />
          <Line d="M8 120 L12 124 M6 128 L11 129" w={2} />
        </>
      ),
    },
  },
  'mini-dino': {
    layers: {
      pet: (c) => (
        <>
          {shadow}
          <path d="M44 172 C56 172 66 176 72 184 C62 184 54 182 46 180 Z" fill="#3fbf5a" />
          <path d="M28 188 L28 178 L36 178 L36 188 Z M42 188 L42 178 L50 178 L50 188 Z" fill="#3fbf5a" strokeWidth={2.6} />
          <ellipse cx="38" cy="168" rx="16" ry="14" fill="#3fbf5a" />
          <ellipse cx="34" cy="172" rx="8" ry="8" fill="#ffd21f" strokeWidth={2} />
          <Shade c={c} d="M46 158 C54 164 56 174 50 180 C52 172 50 164 46 158 Z" />
          <path d="M26 156 C20 140 26 126 40 126 C54 126 58 138 56 146 C54 152 46 154 40 152 L34 160 Z" fill="#3fbf5a" />
          <path d="M44 126 l3 -6 3 7 Z M52 130 l5 -4 0 7 Z" fill="#ff7a1a" strokeWidth={2} />
          {eye(42, 136, 2.4)}
          <Line d="M36 146 Q46 150 54 146" w={2.2} />
          <path d="M40 147 l2 3 2 -2.6 Z M48 148 l2 3 2 -3.4 Z" fill="#ffffff" strokeWidth={1.2} />
          <Tube d="M28 164 L22 170" color="#3fbf5a" w={3} outline={2.2} />
        </>
      ),
    },
  },
};


