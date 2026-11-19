// /dev: the admin, testing and review portal. Not in the kids' navigation; access is decided by the
// server (open locally, an admin password once per browser in production).
import { Link } from 'wouter';
import { Card } from '../../ui';
import { DevShell } from './devParts';

const PAGES: [string, string, string][] = [
  ['/dev/practices', 'Practices', 'Any release scene at any level: the practice (composePractice), its plan table, coverage per line, played in the real shell. Results stay local. /dev/panono opens it on the Panono scene.'],
  ['/dev/types_of_puzzles', 'Types of puzzles', 'Every puzzle type with its id, name, purpose, depth, scope and microphone; each playable on the Panono scene.'],
  ['/dev/scenes', 'Scenes', 'Every scene by episode, with filters; one scene with everything the bundle holds (lines, units, timings, notes, questions, alternates, frames).'],
  ['/dev/practice', 'Play puzzles', 'One puzzle type or a chain of puzzle types on any scene, in the real shell (?scene=…&type=…&level=…&seed=…); ?plan=scene&scene=… starts a real practice through the API.'],
  ['/dev/speaking', 'Speaking', 'Microphone prototypes and what Whisper heard (built by the speaking-puzzles step).'],
  ['/dev/loops', 'Loop styles', 'Compare how looped French is cut and faded (A to E; D is the default) and measure the seams.'],
  ['/dev/scene', 'Scene components', 'The scene player, the dialogue strip in all its variants, GlossText, voices, every effect and sound.'],
  ['/dev/ui', 'Design system', 'Every component of the design system.'],
  ['/dev/avatar', 'Avatar', 'The avatar and its items.'],
];

export default function DevIndexScreen() {
  return (
    <DevShell title="/dev">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {PAGES.map(([href, title, text]) => (
          <Link key={href} href={href} style={{ textDecoration: 'none', color: 'inherit' }} data-dev-link={href}>
            <Card style={{ height: '100%' }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>{title}</h2>
              <code style={{ fontSize: 13 }}>{href}</code>
              <p style={{ margin: '8px 0 0', fontSize: 15 }}>{text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </DevShell>
  );
}
