// /dev/ui: a gallery of every design-system component, for screenshots and for checking a change
// to ui/ at a glance. Owned by the foundation step; add your component here when you add one to ui/.
// A developer tool: its sample texts are literal (not through t()), apart from the real UI strings.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { t } from '../../../../shared/i18n';
import type { Level } from '../../../../shared/rules';
import { FIXTURE_SCENE } from '../../../../shared/fixtures/scene';
import { Avatar } from '../../avatar/Avatar';
import { usePlayer } from '../../state/player';
import { ApiRequestError } from '../../api/errors';
import {
  BLOCK_COLORS,
  Badge,
  Balloon,
  Burst,
  Button,
  Caption,
  Card,
  Chip,
  Counter,
  EmptyState,
  Halftone,
  Icon,
  ICON_NAMES,
  IconButton,
  Logo,
  Modal,
  Panel,
  Pill,
  PressableCard,
  ProgressBar,
  SECTIONS,
  Sheet,
  SpeedLines,
  Spinner,
  Stamp,
  toast,
  unitColorVars,
  useLayout,
  ErrorPanel,
  type BlockColor,
} from '../../ui';
import s from './DevUi.module.css';

/** A section of the gallery: a paper panel, or a coloured one when its samples are paper themselves. */
function Section({ title, children, tilt = 0, color }: { title: string; children: ReactNode; tilt?: number; color?: BlockColor }) {
  return (
    <section className={s.section}>
      <Caption size="lg" tilt={-1.5}>
        {title}
      </Caption>
      <Panel tilt={tilt} color={color}>
        {children}
      </Panel>
    </section>
  );
}

/** A sample screen composed as a comic page: panels, gutters, a caption, a balloon, a burst. */
function ComicPage() {
  const line = FIXTURE_SCENE.lines[1]!;
  const [tapped, setTapped] = useState<string | null>('s01e04-0017:2');
  const unit = line.units.find((u) => u.id === tapped);
  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <Stamp variant="plain">Vol. I, N° 4</Stamp>
        <Stamp variant="price" color="yellow" tilt={8}>
          3
          <Icon name="flame" size={20} />
        </Stamp>
      </div>
      <h2 className={s.pageTitle}>Aime-le ou va voir les lions&nbsp;!</h2>
      <div className={s.strip}>
        <Panel color="teal" padding="none" className={s.frame} tilt={-1}>
          <SpeedLines x="70%" y="40%" />
          <Halftone color="rgb(0 0 0 / 0.18)" fade="bottom" />
          <div className={s.frameInner}>
            <Caption tilt={-2}>Pendant ce temps, à Rome…</Caption>
            <Burst size={150} color="yellow" rotate={-10} seed={4} pop>
              BOUM&nbsp;!
            </Burst>
          </div>
        </Panel>
        <Panel color="white" padding="tight" tilt={1.2} className={s.side}>
          <Caption tilt={1}>Touche une case</Caption>
          <div className={s.unitsRow}>
            {line.units.map((u, i) => (
              <button key={u.id} type="button" className={s.unitBtn} style={unitColorVars(i)} aria-pressed={tapped === u.id} onClick={() => setTapped(u.id)}>
                {u.fr}
              </button>
            ))}
          </div>
          {unit && (
            <Balloon tail="top" tailAt="30%" boxy color="paper" className={s.gloss}>
              « {unit.fr} » = <em>{unit.en}</em>
              {unit.note && <small className={s.note}>* {unit.note}</small>}
            </Balloon>
          )}
        </Panel>
      </div>
      <div className={s.strip2}>
        <Panel color="yellow" padding="tight" tilt={-0.8}>
          <p className={s.q}>Que font les Romains avec ceux qui fomentent les rébellions&nbsp;?</p>
          <div className={s.answers}>
            <Button color="white" size="sm">Ils leur offrent un gâteau</Button>
            <Button color="green" size="sm" icon="check">
              Ils les jettent aux lions
            </Button>
          </div>
        </Panel>
        <div className={s.bravo}>
          <Burst size={128} color="red" rotate={8} seed={11} text="yellow">
            BRAVO&nbsp;!
          </Burst>
        </div>
      </div>
      <Button size="lg" color="red" block iconRight="forward">
        {t('common.continue')}
      </Button>
    </div>
  );
}

export default function DevUiScreen() {
  const layout = useLayout();
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [chip, setChip] = useState('hat');
  const [progress, setProgress] = useState(0.62);
  const [coins, setCoins] = useState(47);
  const language = usePlayer((st) => st.language);
  const setLanguage = usePlayer((st) => st.setLanguage);
  const avatar = usePlayer((st) => st.state?.profile.avatar);

  return (
    <div className={s.gallery}>
      <header className={s.hero}>
        <Logo size={layout === 'tablet' ? 76 : 54} wiggle />
        <Caption tilt={-2}>
          {t('dev.ui.title')} · {layout}
        </Caption>
        <div className={s.row}>
          <Chip color="blue" selected={language === 'fr'} onClick={() => void setLanguage('fr')}>
            {t('common.language.fr')}
          </Chip>
          <Chip color="red" selected={language === 'en'} onClick={() => void setLanguage('en')}>
            {t('common.language.en')}
          </Chip>
        </div>
      </header>

      <Section title="Une page de BD">
        <ComicPage />
      </Section>

      <Section title="Lettrage · É È À Ç Ô Œ">
        <div className={s.stack}>
          <p className={s.display1}>ÇA, C’EST GÉNIAL&nbsp;! ÔTE-TOI DE LÀ, ŒIL DE BŒUF&nbsp;!</p>
          <p className={s.display2}>Où est passé le sanglier rôti&nbsp;?</p>
          <p className={s.text1}>« Et si tu n’aimes pas, on te l’imposera. » — Ça, c’est du français&nbsp;!</p>
          <p className={s.text2}>Petit texte : à, â, é, è, ê, ë, î, ï, ô, ù, û, ü, ç, œ, æ — Où ? Là ! Déjà ? Bien sûr…</p>
        </div>
      </Section>

      <Section title="Rubriques et leurs accents">
        <div className={s.sections}>
          {SECTIONS.map((name, i) => (
            <div key={name} className={s.sectionSwatch} style={{ '--c': `var(--section-${name})`, color: `var(--section-${name}-ink)`, transform: `rotate(${i % 2 ? 1 : -1}deg)` } as CSSProperties}>
              <b className={s.sectionName}>{name}</b>
              <div className={s.accents}>
                <span className={s.accent} style={{ background: `var(--section-${name}-accent)`, color: `var(--section-${name}-accent-ink)` }}>accent</span>
                <span className={s.accent} style={{ background: `var(--section-${name}-accent-2)`, color: `var(--section-${name}-accent-2-ink)` }}>accent-2</span>
                <span className={s.accent} style={{ background: 'var(--ink)', color: 'var(--yellow)' }}>accent-3</span>
              </div>
            </div>
          ))}
        </div>
        <div className={s.wrap} style={{ marginTop: 'var(--sp-5)' }}>
          <Caption>Caption = accent</Caption>
          <Button color="accent" iconRight="forward">accent</Button>
          <Button color="accent-2">accent-2</Button>
          <Button color="accent-3">accent-3</Button>
          <Stamp color="accent-2">N° 3</Stamp>
        </div>
      </Section>

      <Section title="Cases · --unit-1..6">
        <div className={s.stack}>
          {FIXTURE_SCENE.lines.map((line) => (
            <div key={line.id} className={s.units}>
              {line.units.map((u, i) => (
                <span key={u.id} className={s.unit} style={unitColorVars(i)}>
                  {u.fr}
                </span>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Bulles et bruits" color="purple">
        <div className={s.wrap}>
          <Burst size={170}>PAF&nbsp;!</Burst>
          <Burst size={130} color="yellow" rotate={8} seed={3}>
            BING&nbsp;!
          </Burst>
          <Burst size={120} color="blue" rotate={-12} seed={9}>
            TCHAC&nbsp;!
          </Burst>
          <Burst size={140} color="red" rotate={5} seed={21} text="yellow">
            WAOUH&nbsp;!
          </Burst>
        </div>
        <div className={s.wrap}>
          <Caption>Le lendemain…</Caption>
          <Caption color="cyan" tilt={2}>
            Pendant ce temps
          </Caption>
          <Caption size="lg" color="orange" tilt={-3}>
            Épisode 4
          </Caption>
        </div>
        <div className={s.balloons}>
          <Balloon>Par Toutatis&nbsp;!</Balloon>
          <Balloon tail="bottom" tailAt="78%" flip color="yellow">
            Ils sont fous, ces Romains.
          </Balloon>
          <Balloon tail="left" boxy>
            « aux lions » veut dire <em>to the lions</em>.
          </Balloon>
        </div>
        <div className={s.wrap}>
          <Stamp>N° 3</Stamp>
          <Stamp variant="price" color="yellow">
            10¢
          </Stamp>
          <Stamp color="red" tilt={4}>
            NOUVEAU
          </Stamp>
          <Stamp variant="plain">Vol. I, N° 1</Stamp>
        </div>
      </Section>

      <Section title="Panel · Card" tilt={0.6} color="pink">
        <div className={s.grid}>
          {/* paper named: a Panel without a colour inherits the colour of the panel it sits in */}
          <Panel color="paper">
            <h3>Panel</h3>
            <p>Papier crème.</p>
          </Panel>
          <Panel color="yellow" tilt={-2} dots>
            <h3>Jaune</h3>
            <p>Penché, à points.</p>
          </Panel>
          <Card color="blue">
            <h3>Card</h3>
            <p>= un Panel.</p>
          </Card>
          <PressableCard color="lime" onClick={() => toast('PAF !', { color: 'lime' })}>
            <h3>Pressable</h3>
            <p>Appuie&nbsp;!</p>
          </PressableCard>
          <PressableCard color="purple" disabled>
            <h3>Désactivé</h3>
            <p>Pas touche.</p>
          </PressableCard>
          <Panel color="red" padding="none" className={s.texPanel}>
            <SpeedLines />
            <Halftone fade="corner" />
            <span className={s.texLabel}>SpeedLines + Halftone</span>
          </Panel>
        </div>
      </Section>

      <Section title="Button">
        <div className={s.wrap}>
          {BLOCK_COLORS.map((c) => (
            <Button key={c} color={c}>
              {c}
            </Button>
          ))}
        </div>
        <div className={s.wrap}>
          <Button size="sm" color="lime" icon="check">
            {t('common.ok')}
          </Button>
          <Button color="yellow" icon="play">
            {t('common.continue')}
          </Button>
          <Button size="lg" color="red" iconRight="forward">
            {t('common.next')}
          </Button>
          <Button disabled icon="lock">
            {t('common.locked')}
          </Button>
          <Button loading color="cyan">
            {t('common.save')}
          </Button>
        </div>
        <Button size="xl" color="yellow" block icon="star" onClick={() => toast(t('common.notBuiltHint'), { color: 'yellow', icon: 'star' })}>
          {t('practice.title')}
        </Button>
      </Section>

      <Section title="IconButton">
        <div className={s.wrap}>
          <IconButton icon="back" label={t('common.back')} size="sm" />
          <IconButton icon="loop" label="loop" color="yellow" />
          <IconButton icon="speaker" label="speaker" color="cyan" />
          <IconButton icon="mic" label="mic" color="red" size="lg" />
          <IconButton icon="play" label="play" color="green" size="xl" />
          <IconButton icon="help" label={t('practice.help')} color="purple" disabled />
        </div>
      </Section>

      <Section title="Pill · Chip">
        <div className={s.wrap}>
          <Pill>Plain</Pill>
          <Pill color="lime" icon="check">
            Nouveau
          </Pill>
          <Pill color="red" icon="flame">
            x2
          </Pill>
          <Pill color="cyan">{t('common.days', { n: 3 })}</Pill>
        </div>
        <div className={s.wrap}>
          {(['hat', 'top', 'held', 'pet'] as const).map((k, i) => (
            <Chip key={k} color={(['yellow', 'cyan', 'lime', 'orange'] as const)[i]} selected={chip === k} onClick={() => setChip(k)}>
              {k}
            </Chip>
          ))}
          <Chip disabled>off</Chip>
        </div>
      </Section>

      <Section title="ProgressBar">
        <div className={s.stack}>
          <ProgressBar value={progress} label={`${Math.round(progress * 100)}%`} height={30} />
          <ProgressBar value={3} max={12} color="blue" />
          <ProgressBar value={0} color="red" />
          <ProgressBar value={1} color="yellow" height={16} />
          <div className={s.wrap}>
            <Button size="sm" color="white" onClick={() => setProgress((p) => Math.max(0, p - 0.15))}>
              −
            </Button>
            <Button size="sm" color="lime" onClick={() => setProgress((p) => Math.min(1, p + 0.15))}>
              +
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Badge (levels)">
        <div className={s.wrap}>
          <Badge level={0} locked showLabel size={52} />
          {([0, 1, 2, 3, 4, 5, 6] as Level[]).map((m) => (
            <Badge key={m} level={m} showLabel size={52} />
          ))}
        </div>
      </Section>

      <Section title="Counter">
        <div className={s.wrap}>
          <Counter icon="flame" value={3} label={t('common.streak')} />
          <Counter icon="flame" value={0} label={t('common.streak')} dim />
          <Counter icon="coin" value={coins} label={t('common.sesterces')} onClick={() => setCoins((c) => c + 5)} />
          <Counter icon="potion" value={1} label={t('common.potions')} />
          <Counter icon="xp" value={184} label="XP" compact />
        </div>
      </Section>

      <Section title="Sheet · Modal · Toast">
        <div className={s.wrap}>
          <Button color="purple" onClick={() => setModal(true)}>
            Modal
          </Button>
          <Button color="yellow" onClick={() => setSheet(true)}>
            Sheet
          </Button>
          <Button color="red" onClick={() => toast(t('common.error.no-unlocks-left'), { color: 'yellow', icon: 'lock' })}>
            Toast
          </Button>
        </div>
        <Modal open={modal} onClose={() => setModal(false)} title={t('chest.kind.gold')}>
          <div className={s.center}>
            <Burst size={200} color="yellow" seed={5}>
              <Icon name="chest" size={84} />
            </Burst>
            <Button color="green" block onClick={() => setModal(false)}>
              {t('common.ok')}
            </Button>
          </div>
        </Modal>
        <Sheet open={sheet} onClose={() => setSheet(false)} title={t('practice.help')} color="cyan">
          <p>{FIXTURE_SCENE.lines[1]!.en}</p>
        </Sheet>
      </Section>

      <Section title="Spinner · EmptyState">
        <div className={s.wrap}>
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </div>
        <EmptyState icon="friends" color="lime" title={t('common.empty')} text={t('common.notBuiltHint')} action={<Button color="green">{t('common.continue')}</Button>} />
      </Section>

      <Section title="ErrorPanel · ErrorDetail">
        <ErrorPanel error={new ApiRequestError(500, 'internal', 'sample', undefined, { method: 'POST', path: '/api/practices/p_sample/progress' })} onRetry={() => {}} />
        <ErrorPanel variant="bar" error={new ApiRequestError(0, 'offline', 'Failed to fetch', undefined, { method: 'POST', path: '/api/practices/p_sample/progress' })} onRetry={() => {}} />
      </Section>

      <Section title="Avatar · Icons">
        <div className={s.wrap}>{avatar && [48, 72, 120].map((n) => <Avatar key={n} avatar={avatar} size={n} />)}</div>
        <div className={s.icons}>
          {ICON_NAMES.map((n) => (
            <span key={n} className={s.icon} title={n}>
              <Icon name={n} size={30} />
              <small>{n}</small>
            </span>
          ))}
        </div>
      </Section>

      <Section title="Encres (block colours)">
        <div className={s.swatches}>
          {[...BLOCK_COLORS, 'level-1', 'level-2', 'level-3', 'level-4', 'level-5', 'level-6', 'locked'].map((c) => (
            <span key={c} className={s.swatch} style={{ '--c': `var(--${c})` } as CSSProperties}>
              <b>{c}</b>
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
