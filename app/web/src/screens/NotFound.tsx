import { Link } from 'wouter';
import { t } from '../../../shared/i18n';
import { Button, EmptyState } from '../ui';

export default function NotFoundScreen() {
  return (
    <EmptyState
      icon="help"
      color="tomato"
      title={t('common.error.not-found')}
      action={
        <Link href="/" asChild>
          <Button icon="home">{t('nav.home')}</Button>
        </Link>
      }
    />
  );
}
