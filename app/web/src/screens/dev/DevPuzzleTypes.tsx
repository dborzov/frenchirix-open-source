// /dev/types_of_puzzles: every playable type of puzzle, with its id, name, purpose and properties
// read from its meta, each demonstrated on the Panono scene. New types appear by themselves when
// their authors register them. Plain English (dev tooling).
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import type { ContentIndex, Scene } from '../../../../shared/content';
import { allPuzzleTypes } from '../../../../shared/practice/registry';
import { createRng } from '../../../../shared/practice/rng';
import type { AnyPuzzleType, PuzzleBase } from '../../../../shared/practice/types';
import { loadIndex, loadScene } from '../../api';
import { getPuzzleEntry } from '../../puzzles/registry';
import { Button, Card, Spinner } from '../../ui';
import { PANONO, devQuery } from './devCompose';
import { DevShell, DEPTH_COLOR, SCOPE_COLOR, Tag, field } from './devParts';

const DEPTHS = ['intro', 'core', 'advanced'];
const SCOPES = ['unit', 'line', 'long-line', 'multi-line', 'scene'];
const missing = <i style={{ opacity: 0.6 }}>not filled yet</i>;
/** A second example for types whose look depends on the content, aimed at a line Panono does not have. */
const EXTRA: Record<string, { scene: string; line: string; label: string }> = {
  'listen-pick': { scene: 's01e03-0227-0233', line: 's01e03-0230', label: 'play with long choices' },
};

function tryBuild(g: AnyPuzzleType, scene: Scene, level: number, seed: number, index: ContentIndex, others: Scene[]): { puzzle: PuzzleBase | null; why?: string } {
  if (level < g.meta.minLevel || level > g.meta.maxLevel) return { puzzle: null, why: `level ${level} is outside its levels ${g.meta.minLevel}–${g.meta.maxLevel}` };
  try {
    const puzzle = g.build({ scene, level, rng: createRng(seed).fork(`types:${g.type}`), focusUnitIds: new Set(), others, bank: index.bank, usedLineIds: new Set(), usedUnitIds: new Set() });
    return puzzle ? { puzzle } : { puzzle: null, why: `build returned nothing on ${scene.id} (no line or unit there fits this puzzle)` };
  } catch (e) {
    return { puzzle: null, why: `build threw: ${String(e)}` };
  }
}

export default function DevPuzzleTypesScreen() {
  const [index, setIndex] = useState<ContentIndex | null>(null);
  const [panono, setPanono] = useState<Scene | null>(null);
  const [others, setOthers] = useState<Scene[]>([]);
  const [level, setLevel] = useState(1);
  const [seed, setSeed] = useState(1);
  const [depth, setDepth] = useState('all');
  const [scope, setScope] = useState('all');
  const [mic, setMic] = useState('all');
  const [sort, setSort] = useState<'id' | 'depth' | 'scope'>('depth');

  useEffect(() => {
    void loadIndex().then(async (i) => {
      setIndex(i);
      const sc = await loadScene(PANONO);
      setPanono(sc);
      setOthers(await Promise.all(i.scenes.filter((x) => x.episode === sc.episode && x.id !== sc.id).slice(0, 2).map((x) => loadScene(x.id))));
    });
  }, []);

  const puzzleTypes = useMemo(() => {
    const list = allPuzzleTypes().filter((g) => {
      if (depth !== 'all' && (g.meta.depth ?? 'none') !== depth) return false;
      if (scope !== 'all' && (g.meta.scope ?? 'none') !== scope) return false;
      if (mic !== 'all' && g.meta.needsMic !== (mic === 'yes')) return false;
      return true;
    });
    const key = (g: AnyPuzzleType) => (sort === 'depth' ? DEPTHS.indexOf(g.meta.depth ?? '') : sort === 'scope' ? SCOPES.indexOf(g.meta.scope ?? '') : 0);
    return list.sort((a, b) => key(a) - key(b) || a.type.localeCompare(b.type));
  }, [depth, scope, mic, sort]);

  if (!index || !panono) return <Spinner />;
  const sel = { minHeight: 44, fontSize: 16 } as const;
  return (
    <DevShell title="Types of puzzles" back>
      <Card>
        <p style={{ margin: '0 0 8px' }}>
          Every registered type, demonstrated on the Panono scene <code>{PANONO}</code> ({panono.titleFr}). Properties come from each puzzle type's <code>meta</code>.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {field(
            'Level',
            <select value={level} onChange={(e) => setLevel(Number(e.target.value))} style={sel} data-types-level>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>,
          )}
          {field(
            'Seed',
            <span style={{ display: 'flex', gap: 8 }}>
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} style={{ ...sel, width: 120 }} />
              <Button size="sm" color="white" onClick={() => setSeed(1 + Math.floor(Math.random() * 99999))} data-types-reroll>
                re-roll
              </Button>
            </span>,
          )}
          {field(
            'Depth',
            <select value={depth} onChange={(e) => setDepth(e.target.value)} style={sel}>
              {['all', ...DEPTHS].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>,
          )}
          {field(
            'Scope',
            <select value={scope} onChange={(e) => setScope(e.target.value)} style={sel}>
              {['all', ...SCOPES].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>,
          )}
          {field(
            'Microphone',
            <select value={mic} onChange={(e) => setMic(e.target.value)} style={sel}>
              <option value="all">all</option>
              <option value="yes">uses the microphone</option>
              <option value="no">no microphone</option>
            </select>,
          )}
          {field(
            'Sort by',
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={sel}>
              <option value="depth">depth</option>
              <option value="scope">scope</option>
              <option value="id">id</option>
            </select>,
          )}
          <span>{puzzleTypes.length} types</span>
        </div>
      </Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {puzzleTypes.map((g) => (
          <TypeCard key={g.type} g={g} scene={panono} level={level} seed={seed} index={index} others={others} />
        ))}
      </div>
    </DevShell>
  );
}

function TypeCard({ g, scene, level, seed, index, others }: { g: AnyPuzzleType; scene: Scene; level: number; seed: number; index: ContentIndex; others: Scene[] }) {
  const [, navigate] = useLocation();
  const [mySeed, setMySeed] = useState(seed);
  const [alt, setAlt] = useState<{ id: string; note: string } | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => setMySeed(seed), [seed]);
  const m = g.meta;
  const view = getPuzzleEntry(g.type);
  const built = useMemo(() => tryBuild(g, scene, level, mySeed, index, others), [g, scene, level, mySeed, index, others]);
  const lineId = built.puzzle ? ((built.puzzle as PuzzleBase & { lineId?: string }).lineId ?? built.puzzle.helpLineIds.join(', ')) : null;
  const play = (sceneId: string, line?: string) => navigate(`/dev/practice?${devQuery({ scenes: [sceneId], puzzleTypes: [g.type], level, seed: mySeed, ...(line ? { line } : {}) })}`);
  const extra = EXTRA[g.type];

  const findScene = async () => {
    setSearching(true);
    for (const s of index.scenes) {
      if (s.id === scene.id) continue;
      const sc = await loadScene(s.id).catch(() => null);
      if (!sc) continue;
      const r = tryBuild(g, sc, level, mySeed, index, others);
      if (r.puzzle) {
        setAlt({ id: sc.id, note: sc.titleFr });
        break;
      }
    }
    setSearching(false);
  };

  return (
    <Card data-type-card={g.type}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{m.name ?? g.type}</h2>
      <code style={{ fontSize: 14 }}>{g.type}</code>
      <p style={{ margin: '8px 0', fontSize: 15 }}>{m.purpose ?? missing}</p>
      <div>
        <Tag color={m.depth ? DEPTH_COLOR[m.depth] : undefined}>depth: {m.depth ?? 'not filled yet'}</Tag>
        <Tag color={m.scope ? SCOPE_COLOR[m.scope] : undefined}>scope: {m.scope ?? 'not filled yet'}</Tag>
        <Tag color={m.needsMic ? 'var(--tomato)' : undefined}>{m.needsMic ? 'microphone' : 'no microphone'}</Tag>
        <Tag>role: {m.role}</Tag>
        <Tag>
          levels {m.minLevel}–{m.maxLevel}
        </Tag>
        <Tag>~{m.seconds}s</Tag>
        <Tag>weight {m.weight}</Tag>
        <Tag>help: {view?.help ?? 'no view yet'}</Tag>
      </div>
      <div style={{ marginTop: 8, fontSize: 14 }}>
        {built.puzzle ? (
          <>
            On Panono, seed {mySeed}: <b>{lineId}</b>, {built.puzzle.unitIds.length} units
          </>
        ) : (
          <span style={{ color: 'var(--tomato)' }}>Cannot build on Panono: {built.why}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <Button size="sm" color="lime" icon="play" disabled={!built.puzzle || !view} onClick={() => play(scene.id)} data-type-play={g.type}>
          play on Panono
        </Button>
        <Button size="sm" color="white" onClick={() => setMySeed(1 + Math.floor(Math.random() * 99999))}>
          re-roll
        </Button>
        {extra && (
          <Button size="sm" color="lime" icon="play" disabled={!view} onClick={() => play(extra.scene, extra.line)} data-type-extra={g.type}>
            {extra.label}
          </Button>
        )}
        {!built.puzzle && (
          <Button size="sm" color="yellow" loading={searching} onClick={() => void findScene()}>
            find a scene it builds on
          </Button>
        )}
        {alt && (
          <Button size="sm" color="lime" icon="play" disabled={!view} onClick={() => play(alt.id)}>
            play on {alt.id}
          </Button>
        )}
      </div>
    </Card>
  );
}
