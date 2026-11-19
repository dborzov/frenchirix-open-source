// Writes the app icons from the one drawing of the mascot (web/src/pwa/druid.ts) into public/:
//   favicon.svg, favicon.ico, apple-touch-icon.png, icons/icon-{192,512}.png, icons/maskable-{192,512}.png
// The PNGs are committed (they are not generated media). Run after changing the drawing:
//   npx tsx tools/icons.ts
// Rasterises with rsvg-convert and packs the .ico with ImageMagick (both on the build machine).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { druidIconSvg } from '../web/src/pwa/druid';

const PUBLIC = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const tmp = mkdtempSync(join(tmpdir(), 'frx-icons-'));

function png(svg: string, px: number, out: string): void {
  const src = join(tmp, `${px}-${Math.random().toString(36).slice(2)}.svg`);
  writeFileSync(src, svg);
  execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), '-o', out, src]);
}

try {
  mkdirSync(join(PUBLIC, 'icons'), { recursive: true });
  // The full head on its burst; the maskable one keeps the head inside the central safe circle (80 %).
  const full = druidIconSvg();
  const mask = druidIconSvg({ scale: 0.78 });
  const small = druidIconSvg({ detail: 'small' });
  writeFileSync(join(PUBLIC, 'favicon.svg'), small + '\n');
  png(full, 192, join(PUBLIC, 'icons', 'icon-192.png'));
  png(full, 512, join(PUBLIC, 'icons', 'icon-512.png'));
  png(mask, 192, join(PUBLIC, 'icons', 'maskable-192.png'));
  png(mask, 512, join(PUBLIC, 'icons', 'maskable-512.png'));
  png(full, 180, join(PUBLIC, 'apple-touch-icon.png'));
  const ico = [16, 32, 48].map((px) => {
    const out = join(tmp, `fav-${px}.png`);
    png(px < 48 ? small : full, px, out);
    return out;
  });
  execFileSync('magick', [...ico, join(PUBLIC, 'favicon.ico')]);
  console.log('icons written to', PUBLIC);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
