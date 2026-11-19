// The design rule "a panel never has the fill of the surface it sits on" (docs/app-style.md, Colour),
// checked in the browser: every visible element with a solid ink outline (dashed = an empty slot, exempt) (a panel, caption, card, tile,
// tag or button) whose background colour is the same as (or reads as the same as) the surface under it.
import type { Page } from '@playwright/test';

export interface SameFill {
  selector: string;
  text: string;
  fill: string;
}

// Plain JavaScript in a string: some TypeScript runners wrap named helpers in __name(), which does
// not exist in the page.
const SCRIPT = `(() => {
  const rgba = (s) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(s);
    if (!m) return null;
    const p = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
  };
  // CIE76 colour difference: under 20 the two fills read as the same colour (yellow on amber, red on
  // vermilion, cyan on cyan). White on cream (or cream on white) is allowed; cream on cream is not.
  const lab = (c) => {
    const f = (v) => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; };
    const r = f(c[0]), g = f(c[1]), b = f(c[2]);
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const F = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * F(y) - 16, 500 * (F(x) - F(y)), 200 * (F(y) - F(z))];
  };
  const paper = (l) => l[0] > 90 && Math.hypot(l[1], l[2]) < 30;
  const near = (a, b) => {
    const A = lab(a), B = lab(b);
    const d = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    return paper(A) && paper(B) ? d < 5 : d < 20;
  };
  const isInk = (c) => {
    const v = rgba(c);
    return !!v && v[3] > 0.8 && v[0] < 70 && v[1] < 70 && v[2] < 70;
  };
  const outlined = (cs) => {
    let sides = 0;
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const w = parseFloat(cs.getPropertyValue('border-' + side + '-width'));
      if (w >= 2 && cs.getPropertyValue('border-' + side + '-style') === 'solid' && isInk(cs.getPropertyValue('border-' + side + '-color'))) sides++;
    }
    return sides >= 3;
  };
  const surface = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const v = rgba(getComputedStyle(p).backgroundColor);
      if (v && v[3] > 0.6) return v;
    }
    return null;
  };
  const label = (el) => {
    const parts = [];
    for (let e = el; e && parts.length < 3 && e !== document.body; e = e.parentElement) {
      const cls = String(e.getAttribute('class') || '').split(/\\s+/)[0];
      const id = e.getAttribute('data-testid');
      parts.unshift(e.tagName.toLowerCase() + (id ? '[data-testid=' + id + ']' : cls ? '.' + cls : ''));
    }
    return parts.join(' > ');
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16 || r.bottom < 0 || r.top > innerHeight * 3) continue;
    if (el.closest('[aria-hidden="true"], [data-fx], svg, [data-same-fill-ok]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.3) continue;
    if (!outlined(cs)) continue;
    const fill = rgba(cs.backgroundColor);
    if (!fill || fill[3] < 0.6) continue;
    const under = surface(el);
    if (under && near(fill, under)) out.push({ selector: label(el), text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40), fill: cs.backgroundColor });
  }
  return out;
})()`;

/** Elements on screen whose fill equals their surface's fill. Empty means the screen follows the rule. */
export function sameFillPanels(page: Page): Promise<SameFill[]> {
  return page.evaluate(SCRIPT) as Promise<SameFill[]>;
}
