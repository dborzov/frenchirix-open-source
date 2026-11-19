// The app root: boots the player (POST /api/session), then renders the routes inside the shell.
// The whole tree is keyed by language, so every t() call re-renders on a language switch.
// A crash on a screen is caught around the routes (« Oups », the detail line, back Home); a copy of
// the state older than ten minutes is refreshed when the app comes back to the foreground. Every error
// panel carries the "Quelque chose ne va pas ?" button (report/); every route change is logged (log/).
import { Suspense, useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { t } from '../../shared/i18n';
import { log } from './log';
import { ErrorPanelReport } from './report';
import { NotFound, ROUTES } from './routes';
import { ShellCounters } from './ShellCounters';
import { usePlayer } from './state/player';
import { installStaleWatch } from './state/recover';
import { AppShell, Button, ErrorBoundary, ErrorPanel, Logo, setErrorReportSlot, Spinner, ToastHost } from './ui';
import s from './App.module.css';

setErrorReportSlot(ErrorPanelReport);

function Splash() {
  return (
    <div className={s.splash}>
      <Logo size={48} wiggle />
      <Spinner size="lg" label={t('common.loading')} />
    </div>
  );
}

function BootError() {
  const error = usePlayer((st) => st.error);
  const boot = usePlayer((st) => st.boot);
  return (
    <div className={s.splash}>
      <ErrorPanel error={error} onRetry={() => void boot()} />
    </div>
  );
}

function Routes() {
  const [path, navigate] = useLocation();
  const bare = ROUTES.some((r) => r.bare && matchPrefix(r.path, path));
  useEffect(() => log('route'), [path]);
  return (
    <AppShell counters={<ShellCounters />} bare={bare}>
      <ErrorBoundary
        resetKey={path}
        where={path}
        fallback={(e) => (
          <ErrorPanel
            error={e}
            where={path}
            message={t('common.fail.crash')}
            secondary={
              <Button color="yellow" size="lg" icon="home" onClick={() => navigate('/')} data-error-home>
                {t('nav.home')}
              </Button>
            }
          />
        )}
      >
        <Suspense fallback={<div className={s.loading}><Spinner /></div>}>
          <Switch>
            {ROUTES.map((r) => (
              <Route key={r.path} path={r.path} component={r.screen} />
            ))}
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

/** True when a route pattern like '/practice/:id' matches the path. */
function matchPrefix(pattern: string, path: string): boolean {
  const a = pattern.split('/');
  const b = path.split('/');
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}

export function App() {
  const status = usePlayer((st) => st.status);
  const language = usePlayer((st) => st.language);
  const boot = usePlayer((st) => st.boot);

  useEffect(() => {
    if (status === 'idle') void boot();
  }, [status, boot]);

  useEffect(() => installStaleWatch(), []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <div key={language} className={s.app}>
      {status === 'ready' ? <Routes /> : status === 'error' ? <BootError /> : <Splash />}
      <ToastHost />
    </div>
  );
}
