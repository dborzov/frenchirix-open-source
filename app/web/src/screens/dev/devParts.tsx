// Small shared pieces of the /dev portal: the page frame, form fields, the plan table, coverage bars.
// Plain and dense on purpose: these pages are for reviewing content on a laptop or an iPad.
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'wouter';
import type { Scene } from '../../../../shared/content';
import { ANGLES, type LineCoverage } from '../../../../shared/practice/practice';
import { Button, Card } from '../../ui';
import type { DevRow } from './devCompose';

export function DevShell({ title, back, children }: { title: string; back?: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 40 }} data-dev-page={title}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {back && (
            <Link href="/dev" style={{ fontWeight: 800 }}>
              ← /dev
            </Link>
          )}
          <h1 style={{ margin: 0, fontSize: 26 }}>{title}</h1>
        </div>
      </Card>
      {children}
    </div>
  );
}

export function field(label: string, control: ReactNode): ReactNode {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 220px) 1fr', alignItems: 'center', gap: 8 }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      {control}
    </label>
  );
}

export function Tag({ children, color = 'var(--white)' }: { children: ReactNode; color?: string }) {
  return <span style={{ display: 'inline-block', padding: '2px 8px', border: '2px solid var(--ink)', background: color, fontSize: 13, fontWeight: 800, marginRight: 4, marginBottom: 4 }}>{children}</span>;
}

export const DEPTH_COLOR: Record<string, string> = { intro: 'var(--lime)', core: 'var(--yellow)', advanced: 'var(--tomato)' };
export const SCOPE_COLOR: Record<string, string> = { unit: 'var(--cyan)', line: 'var(--blue)', 'long-line': 'var(--purple)', 'multi-line': 'var(--orange, #ff7a1a)', scene: 'var(--green)' };

const th: CSSProperties = { textAlign: 'left', padding: '4px 6px', borderBottom: '3px solid var(--ink)', fontSize: 13, position: 'sticky', top: 0, background: 'var(--paper, #fff3d0)' };
const td: CSSProperties = { padding: '4px 6px', borderBottom: '1px solid var(--ink)', fontSize: 13, verticalAlign: 'top' };

/** A composed practice as a table: #, type and name, scope, target line, lines and units, microphone. */
export function DevPlanTable({ rows, scenes, onPlayOne, onPlayFrom, current }: { rows: DevRow[]; scenes: ReadonlyMap<string, Scene>; onPlayOne?: (r: DevRow) => void; onPlayFrom?: (r: DevRow) => void; current?: number }) {
  const lineText = (id: string) => {
    for (const sc of scenes.values()) {
      const l = sc.lines.find((x) => x.id === id);
      if (l) return l.fr.replace(/\n/g, ' / ');
    }
    return id;
  };
  return (
    // The card around it grows to its content: cap the scroller at the screen so a phone scrolls the
    // table, not the page; and keep the table wide enough that its lines column stays readable.
    <div style={{ overflowX: 'auto', maxWidth: 'calc(100vw - 48px)' }}>
      <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }} data-plan-table>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>puzzle</th>
            <th style={th}>scope</th>
            <th style={th}>lines (target ◎)</th>
            <th style={th}>units</th>
            <th style={th}>mic</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.index} style={{ background: r.index === current ? 'var(--yellow)' : undefined }} data-plan-row={r.index}>
              <td style={td}>{r.index + 1}</td>
              <td style={td}>
                <b>{r.type}</b>
                <br />
                <span style={{ opacity: 0.8 }}>{r.name}</span>
              </td>
              <td style={td}>
                <Tag color={SCOPE_COLOR[r.scope]}>{r.scope}</Tag>
              </td>
              <td style={td}>
                {r.lineIds.map((id) => (
                  <div key={id}>
                    {id === r.target ? '◎ ' : ''}
                    <code>{id.split('-').pop()}</code> {lineText(id)}
                  </div>
                ))}
                {r.target && !r.lineIds.includes(r.target) && <div style={{ color: 'var(--tomato)' }}>asked for {r.target}, built another line</div>}
                {r.reason && <div style={{ opacity: 0.65 }}>{r.reason}</div>}
              </td>
              <td style={td}>{r.unitIds.length}</td>
              <td style={td}>{r.mic ? <Tag color="var(--tomato)">mic</Tag> : ''}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                {onPlayOne && (
                  <Button size="sm" color="white" onClick={() => onPlayOne(r)} data-play-one={r.index}>
                    play
                  </Button>
                )}{' '}
                {onPlayFrom && (
                  <Button size="sm" color="lime" onClick={() => onPlayFrom(r)} data-play-from={r.index}>
                    from here
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Coverage per line: for each angle, puzzles got against the composer's demand, as small bars. */
export function CoverageBars({ lines, scene }: { lines: LineCoverage[]; scene: Scene }) {
  const max = Math.max(1, ...lines.flatMap((l) => ANGLES.map((a) => Math.max(l.got[a] ?? 0, l.demand[a] ?? 0))));
  return (
    <div style={{ display: 'grid', gap: 12 }} data-coverage>
      {lines.map((l) => {
        const line = scene.lines.find((x) => x.id === l.lineId);
        const total = ANGLES.reduce((n, a) => n + (l.got[a] ?? 0), 0);
        return (
          <div key={l.lineId} data-coverage-line={l.lineId}>
            <div style={{ fontSize: 14 }}>
              <code>{l.lineId}</code> {line?.fr.replace(/\n/g, ' / ')} {line?.approxTimes ? <Tag color="var(--tomato)">approxTimes</Tag> : null} <b>{total} puzzles</b>, {l.angles} angles
            </div>
            {ANGLES.map((a) => (
              <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 80, fontSize: 12 }}>
                  {a} {l.got[a] ?? 0}/{l.demand[a] ?? 0}
                </span>
                <span style={{ position: 'relative', flex: 1, height: 12 }}>
                  <span style={{ position: 'absolute', inset: 0, width: `${((l.demand[a] ?? 0) / max) * 100}%`, border: '2px dashed var(--ink)' }} />
                  <span style={{ position: 'absolute', inset: 0, width: `${((l.got[a] ?? 0) / max) * 100}%`, background: 'var(--blue)', border: '2px solid var(--ink)' }} />
                </span>
              </div>
            ))}
            <div style={{ fontSize: 12, opacity: 0.75 }}>{l.types.join(', ')}{l.shortfall ? ` · open: ${l.shortfall}` : ''}</div>
          </div>
        );
      })}
    </div>
  );
}
