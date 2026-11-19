import { create } from 'zustand';
import { colorVars, type BlockColor } from './colors';
import { ErrorDetail } from './ErrorPanel';
import { Icon, type IconName } from './icons';
import s from './Toast.module.css';

interface ToastItem {
  id: number;
  text: string;
  color: BlockColor;
  icon?: IconName;
  /** A failed action's line for the admin (api/errors.ts), shown small with a copy button. */
  detail?: string;
  /** What the toast says, for tests (`[data-toast="bought"]`), so they never depend on the wording. */
  tag?: string;
}

interface ToastStore {
  items: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>, ms: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const useToasts = create<ToastStore>((set, get) => ({
  items: [],
  push: (item, ms) => {
    const id = nextId++;
    set({ items: [...get().items.slice(-2), { ...item, id }] });
    setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
}));

/** Show a short message at the top of the screen. Pass text already translated with t(). */
export function toast(text: string, opts: { color?: BlockColor; icon?: IconName; ms?: number; detail?: string; tag?: string } = {}): void {
  useToasts.getState().push({ text, color: opts.color ?? 'yellow', icon: opts.icon, detail: opts.detail, tag: opts.tag }, opts.ms ?? (opts.detail ? 7000 : 2800));
}

/** Takes every toast down at once (a dialog opening where they would cover its title). */
export function dismissToasts(): void {
  for (const i of useToasts.getState().items) useToasts.getState().dismiss(i.id);
}

/** Mounted once by the app (App.tsx). */
export function ToastHost() {
  const items = useToasts((st) => st.items);
  const dismiss = useToasts((st) => st.dismiss);
  return (
    <div className={s.host} aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className={s.toast} style={colorVars(i.color)} onClick={() => dismiss(i.id)} role="status" data-toast={i.tag ?? ''}>
          <div className={s.row}>
            {i.icon && <Icon name={i.icon} size={28} />}
            <span className={s.text}>{i.text}</span>
          </div>
          {i.detail && <ErrorDetail text={i.detail} className={s.detail} />}
        </div>
      ))}
    </div>
  );
}
