# Art direction: a 1950s comic book

How the app must look and move, and how the look is built in code. Read before styling any screen, component, puzzle or avatar in `app/`, and before judging a screenshot. The user set this direction after rejecting a first design system as "girly pink" with "baby nerfed soft round corners".

## The user's words

> What we want is 50s comics assertive aesthetics, bright and different colours, each section can have its own, and the aesthetics of comics, typography of 50s comics.

The reference images the direction was set from are not in this repository; what they showed:

- Promotional art of the show: a coral-red field, white speed lines, a jagged white burst with **PAF!** in heavy black slanted lettering, yellow stars; the show's comic-explosion palette.
- A 1950s comic cover: thick black ink lines, flat colour, halftone dots, a black frame, small print details ("Vol. I, No. 1", "10¢").
- The dialogue boxes of the app's first version: each line a different flat bright colour with heavy comic capitals. Still the model for the coloured unit boxes.
- An avatar editor, for its layout only (tabs of options over a live preview), not its look.

## Rules

**Ink.** Everything that is a thing has a thick black outline: 3 px on controls, 4 px on big panels. Shadows are hard: a solid black offset (about 4 to 6 px down and right), never blurred. A pressed button moves into its shadow.

**Corners.** Square, or barely eased (0 to 6 px). No pills, no bubbly blobs. The exceptions are comic shapes that are round by nature: speech balloons with a tail, jagged bursts, stars.

**Colour.** Flat, saturated printing-ink colours on a full-bleed field, never pastel: comic red and coral (`#E8303A`, `#F4505E`), yellow (`#FFD21F`), blue (`#1E88E5`) and the cover's teal blue (`#2F7FA8`), green (`#22B14C`), orange (`#FF7A1A`), purple (`#7A3FF2`), cream paper (`#FFF3D0`), ink black (`#111111`), white. **Each section of the app owns its own background colour** (home, episodes, karaoke, friends, league, shop, profile, practice…), bright and different from its neighbours; panels on top are cream or white, or another bold flat colour. Pink is not a base colour.

**A panel never has the colour of what it sits on.** The user, after using the app: "when in layout you have boxes and panels that are the same colour as background … we would want these panels to have a different colour than the background so that they stand out more", bright and eye-catching. So no panel, caption, card, tile, tag or button has the fill of the surface under it; the ink outline alone is not enough. Each section has accents chosen to stand out on its background (`--section-accent`, `--section-accent-2`, and ink with yellow lettering as `--section-accent-3`, each with an `-ink` for its lettering; `colorVars('accent')`, and `Caption` uses the accent by default). Cream and white panels stand out on every section. Use the accents with intent: the one thing to tap next gets the loudest; not every box needs one. `e2e/contrast.spec.ts` fails when the rule is broken.

**Texture.** Halftone (Ben-Day) dots, radiating speed lines and paper grain, as CSS or inline SVG. Use them boldly on backgrounds and in bursts, never so strong that text is hard to read.

**Typography.** Display: heavy comic lettering, capitals, slanted, black with a white or yellow outline or a hard shadow, often tilted two to four degrees, like a cover title or a sound effect. Text: comic balloon lettering with clear French accents. Numbers in the display face. French accents must be drawn correctly at every size; kids learn spelling from this.

**Comic furniture, used as interface.**
- **Panels and gutters**: a screen is a page of panels with gutters between them, some slightly tilted or overlapping, not a stack of soft cards.
- **Caption boxes**: yellow narration boxes with a black outline for labels and section titles.
- **Speech balloons**: for translations, hints and tips. The English gloss of a tapped unit is the hint bubble, a balloon with its tail on the unit ([app-games.md](app-games.md)).
- **Bursts and onomatopoeia**: jagged starbursts with comic sound words for moments, in the interface's language: `PAF !`, `BOUM !`, `BING !`, `TCHAC !`, `WAOUH !`, `BRAVO !` in French, `POW!`, `BOOM!`, `BING!`, `SNAP!`, `WOW!`, `BRAVO!` in English (the pairs are listed at the top of `shared/i18n/fr.ts`). A right answer is an impact, not a tick.
- **Cover details**: issue numbers, price tags, "N° 3", corner stamps, used playfully for counters, streaks and levels.
- **Stars and speed lines** for motion and reward.

**Motion.** Punchy: impact frames, overshoot, a shake on a hit, things slamming in at an angle. Not floaty, not slow fades. Honour `prefers-reduced-motion`.

**Not this.** Pastel pink, soft blurred shadows, big round corners, glassy gradients, a baby-toy or "kawaii" look, thin grey outlines, corporate cards.

## What stays

Readability for a ten-year-old on a phone, tap targets of at least 44 px, two real layouts (phone, tablet), and every string through `t()`. Loud is good; confusing is not: one obvious thing to tap per screen.

## Our own art

The look is a 1950s comic in general. Characters, props and avatars are our own drawings in that style (thick ink, flat colour, halftone shading); they do not copy the likeness of the show's or the comics' characters. The show's own frames appear only as the scenes' slideshow pictures.

## In code

- Use the tokens in `web/src/ui/tokens.css` and the `ui/` components; no hard-coded colours. Ink `var(--outline)` (3 px) on controls and `var(--outline-thick)` (4 px) on panels; shadows `var(--shadow-hard)` / `var(--shadow-hard-lg)`; radii `--r-*`, all 0–6 px.
- Fonts: `var(--font-display)` (Bangers: titles, buttons, sound words, numbers) and `var(--font-text)` (Comic Neue bold: anything to read, and French the kid learns to spell).
- **PIN digits are the exception to "numbers in the display face"**: everywhere a PIN is shown or typed (the profile, the login slots and keypad, the note-your-PIN card, the players' remove card, the install panel) they use `var(--font-pin)` at `var(--font-pin-weight)` (Comic Neue at 700), in the same inked boxes. In Bangers 1 and 7 look alike and a kid misread their PIN (2026-11-17); one face everywhere makes the digits read on one device look like the ones tapped on another.
- Colours: the block inks (`--red`, `--yellow`, `--blue`, `--teal`, `--green`, `--orange`, `--purple`, `--paper`, `--ink`…) and `--unit-1` … `--unit-6` for the unit boxes. `colorVars(color)` also sets the matching lettering and stroke.
- **Page backgrounds belong to `AppShell`**: it paints the route's `--section-<name>` colour with halftone and speed lines (`sectionForPath`). Screens never set a page background; they put panels on it, using the section's accents (`colorVars('accent' | 'accent-2' | 'accent-3')`, `var(--accent)`, lettering `var(--section-accent-ink)`) or cream and white panels. `e2e/contrast.spec.ts` checks every screen and puzzle type.
- Compose a screen from the comic furniture in `ui/`: `Panel`, `Caption`, `Balloon`, `Burst`, `Stamp`, `SpeedLines`, `Halftone`.
- Plain CSS modules (`*.module.css`) next to the component; no CSS framework, no animation library (CSS and the Web Animations API). Respect `prefers-reduced-motion`. Add any new `ui/` component to `/dev/ui`.
