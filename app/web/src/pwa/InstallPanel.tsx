// "Installer l'appli": a sheet that helps a kid (or a teacher) put Frenchirix on the home screen.
// Android with a prompt ready: one button that fires the browser's install prompt. iPhone and iPad:
// three illustrated steps (Share, "Sur l'écran d'accueil", "Ajouter"), drawn by us. Anything else:
// a sentence. Hidden when already running as an installed app. Mounted from Profile (InstallButton)
// and offered once on Home (InstallOffer).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { t } from '../../../shared/i18n';
import { shouldInvite } from '../onboarding';
import { usePlayer } from '../state/player';
import { Burst, Button, Caption, cx, Sheet, useLayout } from '../ui';
import { DruidMark } from './DruidMark';
import { canPrompt, detectPlatform, isIosSafari, isIpad, isStandalone, justInstalled, promptInstall, subscribeInstall } from './install';
import { pwaFlag, setPwaFlag } from './stored';
import s from './pwa.module.css';

function useInstallState() {
  const prompt = useSyncExternalStore(subscribeInstall, canPrompt, () => false);
  const done = useSyncExternalStore(subscribeInstall, justInstalled, () => false);
  return { prompt, done };
}

/** The share icon of Safari: a square with an arrow coming out of the top. */
export function ShareGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 12 H8 V28 H24 V12 H21" />
      <path d="M16 20 V3 M10.5 8.5 L16 3 L21.5 8.5" />
    </svg>
  );
}

/** The "add" icon of the menu row: a rounded square with a plus. */
function PlusSquareGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
      <rect x="4" y="4" width="24" height="24" rx="6" />
      <path d="M16 10 V22 M10 16 H22" />
    </svg>
  );
}

function Step({ n, children, art, tilt }: { n: number; children: React.ReactNode; art: React.ReactNode; tilt: number }) {
  return (
    <li className={s.step} style={{ ['--tilt' as string]: `${tilt}deg` }}>
      <span className={s.stepN}>{n}</span>
      <div className={s.stepArt} aria-hidden>
        {art}
      </div>
      <p className={s.stepText}>{children}</p>
    </li>
  );
}

/** Safari's toolbar, drawn: on iPhone at the bottom with the "•••" button; on iPad at the top. */
function ToolbarArt({ ipad }: { ipad: boolean }) {
  return (
    <div className={cx(s.toolbar, ipad && s.toolbarIpad)}>
      {ipad ? (
        <>
          <span className={s.urlPill}>{location.host}</span>
          <span className={cx(s.toolBtn, s.hot)}>
            <ShareGlyph size={24} />
          </span>
        </>
      ) : (
        <>
          <span className={s.urlPill}>{location.host}</span>
          <span className={cx(s.toolBtn, s.hot)}>
            <ShareGlyph size={24} />
          </span>
          <span className={s.toolBtn}>•••</span>
        </>
      )}
      <Burst size={54} color="yellow" rotate={-10} className={s.toolBurst}>
        !
      </Burst>
    </div>
  );
}

function MenuRowArt({ label, other }: { label: string; other?: string }) {
  return (
    <div className={s.menu}>
      <span className={s.menuRowDim} />
      <span className={cx(s.menuRow, s.hot)}>
        <span className={s.menuLabel}>
          {label}
          {other && <small>{other}</small>}
        </span>
        <PlusSquareGlyph />
      </span>
      <span className={s.menuRowDim} />
    </div>
  );
}

function AddArt() {
  return (
    <div className={s.addDialog}>
      <div className={s.addBar}>
        <span>{t('pwa.ios.cancel')}</span>
        <span className={cx(s.addBtn, s.hot)}>{t('pwa.ios.add')}</span>
      </div>
      <div className={s.addBody}>
        <DruidMark size={44} tile className={s.addIcon} />
        <span className={s.addName}>Frenchirix</span>
      </div>
    </div>
  );
}

function Remember() {
  const profile = usePlayer((st) => st.state?.profile);
  if (!profile) return null;
  return (
    <div className={s.remember}>
      <p>{t('pwa.panel.remember')}</p>
      <div className={s.creds}>
        <span className={s.cred}>
          <small>{t('pwa.panel.name')}</small>
          <b>{profile.name}</b>
        </span>
        <span className={cx(s.cred, s.credPin)}>
          <small>{t('pwa.panel.pin')}</small>
          <b>{profile.pin}</b>
        </span>
      </div>
    </div>
  );
}

/** What the sheet holds, by platform. */
export function InstallSteps({ platform = detectPlatform(), ipad = isIpad() }: { platform?: ReturnType<typeof detectPlatform>; ipad?: boolean }) {
  const { prompt, done } = useInstallState();
  const [busy, setBusy] = useState(false);
  if (done) return <p className={s.lead}>{t('pwa.done')}</p>;
  if (platform === 'ios') {
    return (
      <>
        <Remember />
        <ol className={s.steps}>
          <Step n={1} tilt={-1.2} art={<ToolbarArt ipad={ipad} />}>
            {t('pwa.ios.step1')} {!ipad && <span className={s.more}>{t('pwa.ios.step1.more')}</span>}
          </Step>
          <Step n={2} tilt={0.8} art={<MenuRowArt label={t('pwa.ios.row')} other={t('pwa.ios.rowOther')} />}>
            {t('pwa.ios.step2')}
          </Step>
          <Step n={3} tilt={-0.6} art={<AddArt />}>
            {t('pwa.ios.step3')}
          </Step>
        </ol>
        {!isIosSafari() && <p className={s.more}>{t('pwa.ios.notSafari')}</p>}
      </>
    );
  }
  if (platform === 'android' || prompt) {
    if (prompt) {
      return (
        <div className={s.android}>
          <p className={s.lead}>{t('pwa.android.text')}</p>
          <Button
            color="green"
            size="lg"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await promptInstall();
              setBusy(false);
            }}
          >
            {t('pwa.android.go')}
          </Button>
        </div>
      );
    }
    return (
      <ol className={s.steps}>
        <Step n={1} tilt={-1} art={<MenuRowArt label={t('pwa.android.row')} />}>
          {t('pwa.android.menu')}
        </Step>
      </ol>
    );
  }
  return <p className={s.lead}>{t('pwa.other.text')}</p>;
}

export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} color="teal" title={t('pwa.panel.title')}>
      <div className={s.sheetBody}>
        <div className={s.iconRow}>
          <DruidMark size={84} tile className={s.homeIcon} title="Frenchirix" />
          <Caption tilt={-3}>{t('pwa.panel.icon')}</Caption>
        </div>
        <InstallSteps />
      </div>
    </Sheet>
  );
}

/** Profile: a button that opens the sheet; nothing when running installed. */
export function InstallButton() {
  const [open, setOpen] = useState(false);
  if (isStandalone()) return null;
  return (
    <>
      <Button color="teal" icon="star" onClick={() => setOpen(true)} data-testid="pwa-install-button">
        {t('pwa.button')}
      </Button>
      <InstallSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const OFFER_AFTER_PRACTICES = 5;

/** Home: offered once, after a few practices, in a browser tab only. "Non merci" hides it for good. */
export function InstallOffer() {
  const st = usePlayer((x) => x.state);
  const [hidden, setHidden] = useState(() => pwaFlag('offer') !== null);
  const [open, setOpen] = useState(false);
  const layout = useLayout();
  useEffect(() => {
    if (open) setPwaFlag('offer', 'opened');
  }, [open]);
  if (!st || hidden || isStandalone()) return null;
  if ((st.stats.practicesFinished ?? 0) < OFFER_AFTER_PRACTICES || shouldInvite(st)) return null;
  // Desktop browsers without a prompt have nothing useful to offer here.
  if (detectPlatform() === 'other' && !canPrompt()) return null;
  return (
    <section className={cx(s.offer, layout === 'tablet' && s.offerTablet)} data-testid="pwa-offer">
      <DruidMark size={layout === 'tablet' ? 76 : 64} tile className={s.offerIcon} />
      <div className={s.offerText}>
        <strong>{t('pwa.offer.title')}</strong>
        <span>{t('pwa.offer.text')}</span>
        <div className={s.offerButtons}>
          <Button color="green" size="sm" onClick={() => setOpen(true)}>
            {t('pwa.offer.go')}
          </Button>
          <Button
            color="white"
            size="sm"
            onClick={() => {
              setPwaFlag('offer', 'dismissed');
              setHidden(true);
            }}
          >
            {t('pwa.offer.later')}
          </Button>
        </div>
      </div>
      <InstallSheet
        open={open}
        onClose={() => {
          setOpen(false);
          setHidden(true);
        }}
      />
    </section>
  );
}
