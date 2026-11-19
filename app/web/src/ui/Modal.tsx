import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../../shared/i18n';
import { IconButton } from './Button';
import { colorVars, type BlockColor } from './colors';
import s from './Modal.module.css';

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  /** false: tapping the backdrop or Escape does nothing (for moments that must be acknowledged). */
  dismissable?: boolean;
}

function useOverlay(open: boolean, onClose: () => void, dismissable: boolean) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose, dismissable]);
  return panel;
}

/** A centred dialog that pops in. */
export function Modal({ open, onClose, title, children, dismissable = true }: OverlayProps) {
  const panel = useOverlay(open, onClose, dismissable);
  const id = useId();
  if (!open) return null;
  return createPortal(
    <div className={s.backdrop} onClick={dismissable ? onClose : undefined}>
      <div ref={panel} className={s.panel} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        {(title || dismissable) && (
          <div className={s.header}>
            <h2 id={id} className={s.title}>{title}</h2>
            {dismissable && <IconButton icon="close" label={t('common.close')} size="sm" onClick={onClose} />}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A bottom sheet that slides up (phone pickers, details). */
export function Sheet({ open, onClose, title, children, dismissable = true, color = 'yellow' }: OverlayProps & { color?: BlockColor }) {
  const panel = useOverlay(open, onClose, dismissable);
  const id = useId();
  if (!open) return null;
  return createPortal(
    <div className={s.sheetBackdrop} onClick={dismissable ? onClose : undefined}>
      <div ref={panel} className={s.sheet} style={colorVars(color)} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className={s.grab} />
        {(title || dismissable) && (
          <div className={s.header}>
            <h2 id={id} className={s.title}>{title}</h2>
            {dismissable && <IconButton icon="close" label={t('common.close')} size="sm" onClick={onClose} />}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
