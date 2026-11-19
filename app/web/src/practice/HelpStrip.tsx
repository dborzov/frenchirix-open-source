// The help strip around every puzzle: the lines in puzzle.helpLineIds as a DialogueStrip. Open from the
// start for puzzle types that show the French, closed behind a help button for puzzle types that hide it.
// Opening it, or tapping a box in it, counts a hint. A bottom drawer on a phone; in the scene pane
// on a tablet.
import type { Scene } from '../../../shared/content';
import { t } from '../../../shared/i18n';
import { DialogueStrip } from '../scene/DialogueStrip';
import { Button, Icon, cx } from '../ui';
import s from './Practice.module.css';

export interface HelpStripProps {
  scene: Scene;
  lineIds: string[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onHint: () => void;
  variant: 'drawer' | 'pane';
}

export function HelpStrip({ scene, lineIds, open, onOpen, onClose, onHint, variant }: HelpStripProps) {
  if (variant === 'pane') {
    return (
      <div className={s.helpPane} data-help={open ? 'open' : 'closed'}>
        {open ? (
          <DialogueStrip scene={scene} lineIds={lineIds} compact onHint={onHint} />
        ) : (
          <button type="button" className={s.helpBig} onClick={onOpen} data-help-open>
            <Icon name="help" size={44} />
            <span>{t('practice.help')}</span>
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={cx(s.drawer, open && s.drawerOpen)} data-help={open ? 'open' : 'closed'}>
      <div className={s.drawerBar}>
        <span className={s.drawerTitle}>{open ? t('practice.help') : t('practice.help.need')}</span>
        <Button size="sm" color={open ? 'white' : 'yellow'} icon={open ? 'close' : 'help'} onClick={open ? onClose : onOpen} data-help-toggle>
          {open ? t('practice.help.hide') : t('practice.help')}
        </Button>
      </div>
      {open && (
        <div className={s.drawerBody}>
          <DialogueStrip scene={scene} lineIds={lineIds} compact onHint={onHint} />
        </div>
      )}
    </div>
  );
}
