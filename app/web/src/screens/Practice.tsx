// Route /practice/:id. The screen that starts a practice (POST /api/practices/start) hands the fresh
// plan over in the navigation state:
//   const { plan } = await api.startPractice({ kind: 'scene', sceneId });
//   navigate(`/practice/${plan.id}`, { state: { plan, fresh: true } });
// That plan is used once. Any other way here (the back button, a reload, a link from history) asks the
// server first ({ kind: 'resume' }): a practice finished meanwhile, here or on another device, says so
// and goes Home instead of being played again with nothing saved; an open one continues where the
// server says it is.
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { t } from '../../../shared/i18n';
import type { PracticePlan } from '../../../shared/practice/types';
import { api, ApiRequestError } from '../api';
import { PracticePlayer } from '../practice/PracticePlayer';
import { usePlayer } from '../state/player';
import { recover, refreshState } from '../state/recover';
import { Button, ErrorPanel, Spinner, toast } from '../ui';
import s from '../practice/Practice.module.css';

/** The plan the starting screen just handed over, once: the mark is cleared so history never replays it. */
function takeFreshPlan(id: string): PracticePlan | null {
  const st = (typeof history !== 'undefined' ? history.state : null) as { plan?: PracticePlan; fresh?: boolean } | null;
  if (!st?.fresh || st.plan?.id !== id) return null;
  return st.plan;
}

export default function PracticeScreen({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation();
  const [plan, setPlan] = useState<PracticePlan | null>(() => takeFreshPlan(params.id));
  const [error, setError] = useState<unknown>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (plan) {
      // Used: a later visit to this history entry asks the server.
      const st = history.state as { plan?: PracticePlan; fresh?: boolean } | null;
      if (st?.fresh) history.replaceState({ ...st, fresh: false }, '');
      return;
    }
    let live = true;
    setError(null);
    api.startPractice({ kind: 'resume', practiceId: params.id }).then(
      (res) => {
        if (!live) return;
        usePlayer.getState().apply(res.patch);
        setPlan(res.plan);
      },
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiRequestError && (e.code === 'practice-closed' || e.code === 'not-found')) {
          void refreshState();
          toast(t('practice.closed'), { color: 'yellow', icon: 'check', tag: 'practice-closed' });
          navigate('/', { replace: true });
          return;
        }
        recover(e);
        setError(e);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, tries, !!plan]);

  if (error) {
    return (
      <div className={s.practice} style={{ justifyContent: 'center', padding: '0 16px' }}>
        <ErrorPanel
          error={error}
          onRetry={() => setTries((n) => n + 1)}
          secondary={
            <Button color="white" icon="home" onClick={() => navigate('/')} data-error-home>
              {t('nav.home')}
            </Button>
          }
        />
      </div>
    );
  }
  if (!plan) {
    return (
      <div className={s.practice} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size="lg" label={t('common.loading')} />
      </div>
    );
  }
  return (
    <PracticePlayer
      key={plan.id}
      plan={plan}
      onExit={(done) => {
        if (done) toast(t('practice.saved'), { color: 'lime', icon: 'check' });
        navigate('/');
      }}
      onFinish={(res) => navigate(res?.chest ? `/chest/${encodeURIComponent(res.chest.id)}` : '/')}
    />
  );
}
