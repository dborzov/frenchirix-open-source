// The build id of the running client, for /version (shared/build.ts explains the format).
import { t } from '../../../shared/i18n';
import { BUILD } from './update';
import s from './pwa.module.css';

export function BuildStamp() {
  return (
    <span className={s.build} data-testid="pwa-build">
      {t('pwa.build', { id: BUILD })}
    </span>
  );
}
