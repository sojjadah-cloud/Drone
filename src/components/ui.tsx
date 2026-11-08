import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XOctagon, FlaskConical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useI18n } from '@/i18n';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// -----------------------------------------------------------------------------
// Button
// -----------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline-danger' | 'emergency';
type Size = 'sm' | 'md' | 'lg';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover shadow-1',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-hover',
  ghost: 'text-ink-muted hover:bg-surface-hover hover:text-ink',
  danger: 'bg-alert text-on-alert hover:bg-alert-hover shadow-1',
  'outline-danger': 'border border-crit/60 text-crit hover:bg-crit-soft',
  emergency: 'bg-red-600 text-white hover:bg-[#981f2a] shadow-1',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-disabled disabled:text-disabled-ink disabled:shadow-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon: Icon, label, className, size = 'md', ...rest }: { icon: LucideIcon; label: string; size?: 'sm' | 'md' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'size-8' : 'size-10',
        className,
      )}
      {...rest}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}

// -----------------------------------------------------------------------------
// Badges & tones
// -----------------------------------------------------------------------------
export type Tone = 'crit' | 'warn' | 'ok' | 'info' | 'neutral' | 'gold';
const toneCls: Record<Tone, string> = {
  crit: 'bg-crit-soft text-crit',
  warn: 'bg-warn-soft text-warn',
  ok: 'bg-ok-soft text-ok',
  info: 'bg-info-soft text-info',
  neutral: 'bg-neutral-soft text-ink-muted',
  gold: 'bg-[color-mix(in_srgb,var(--gold-fill)_18%,transparent)] text-gold',
};
export const toneText: Record<Tone, string> = { crit: 'text-crit', warn: 'text-warn', ok: 'text-ok', info: 'text-info', neutral: 'text-ink-muted', gold: 'text-gold' };
export const toneDot: Record<Tone, string> = { crit: 'bg-crit', warn: 'bg-warn', ok: 'bg-ok', info: 'bg-info', neutral: 'bg-ink-subtle', gold: 'bg-gold' };

export function Badge({ tone = 'neutral', icon: Icon, children, className, solid }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string; solid?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 text-[12px] font-semibold leading-5',
        solid ? (tone === 'crit' ? 'bg-alert text-white' : toneCls[tone]) : toneCls[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

export function DemoBadge({ className, label }: { className?: string; label?: string }) {
  const { t } = useI18n();
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-sm border border-dashed border-gold/70 px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-gold', className)}>
      <FlaskConical className="size-3" aria-hidden />
      {label ?? t('common.demo')}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Surfaces
// -----------------------------------------------------------------------------
export function Card({ className, children, as: As = 'div', ...rest }: { className?: string; children: ReactNode; as?: any } & Record<string, any>) {
  return (
    <As className={cx('rounded-lg border border-line bg-surface shadow-1', className)} {...rest}>
      {children}
    </As>
  );
}

export function PanelHeader({ title, icon: Icon, actions, sub, className }: { title: ReactNode; icon?: LucideIcon; actions?: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-h-12 items-center gap-2 border-b border-line px-4 py-2', className)}>
      {Icon && <Icon className="size-4 shrink-0 text-ink-subtle" aria-hidden />}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[14px] font-semibold text-ink">{title}</h2>
        {sub && <div className="truncate text-[12px] text-ink-subtle">{sub}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, lead, actions, badge }: { title: string; lead?: string; actions?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-bold leading-tight text-ink">{title}</h1>
          {badge}
        </div>
        {lead && <p className="mt-1 max-w-3xl text-[14px] text-ink-muted">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KV({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[13px] text-ink-subtle">{k}</dt>
      <dd className={cx('min-w-0 text-end text-[13px] font-medium text-ink', mono && 'num')}>{v}</dd>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Feedback states
// -----------------------------------------------------------------------------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2 p-4" role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, body, action, compact }: { icon?: LucideIcon; title: string; body?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-12')}>
      <div className={cx('flex items-center justify-center rounded-full bg-neutral-soft text-ink-subtle', compact ? 'size-9' : 'size-12')}>
        <Icon className={compact ? 'size-4' : 'size-5'} aria-hidden />
      </div>
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {body && <p className="max-w-sm text-[13px] text-ink-subtle">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <XOctagon className="size-6 text-crit" aria-hidden />
      <p className="text-[14px] font-semibold">{t('common.error')}</p>
      <p className="max-w-sm text-[13px] text-ink-subtle">{message ?? t('common.errorBody')}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function Callout({ tone = 'info', title, children, icon, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: LucideIcon; className?: string }) {
  const Icon = icon ?? (tone === 'crit' ? AlertTriangle : tone === 'warn' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : Info);
  return (
    <div
      role={tone === 'crit' ? 'alert' : 'note'}
      className={cx('flex gap-3 rounded-md border px-3.5 py-3 text-[13px]', toneCls[tone], 'border-current/20', className)}
      style={{ borderColor: 'color-mix(in srgb, currentColor 22%, transparent)' }}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 text-ink">
        {title && <p className={cx('font-semibold', toneText[tone])}>{title}</p>}
        {children && <div className="text-ink-muted [&_strong]:text-ink">{children}</div>}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Form controls
// -----------------------------------------------------------------------------
const controlCls =
  'w-full rounded-md border border-line-strong bg-surface px-3 text-[14px] text-ink placeholder:text-ink-subtle transition-colors duration-150 hover:border-ink-subtle focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25 disabled:bg-disabled disabled:text-disabled-ink aria-[invalid=true]:border-crit';

export function Field({ label, hint, error, required, children, id: idProp, optionalLabel }: { label: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode; id?: string; optionalLabel?: boolean }) {
  const auto = useId();
  const id = idProp ?? auto;
  const { t } = useI18n();
  const desc = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        {label}
        {required && <span className="text-crit" aria-hidden>*</span>}
        {optionalLabel && <span className="font-normal text-ink-subtle">({t('common.optional')})</span>}
      </label>
      {children({ id, 'aria-describedby': desc, 'aria-invalid': error ? true : undefined })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[12px] text-ink-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="flex items-center gap-1 text-[12px] font-medium text-crit">
          <AlertTriangle className="size-3.5" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx(controlCls, 'h-10', className)} {...p} />;
});
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(controlCls, 'min-h-24 py-2 leading-relaxed', className)} {...p} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(controlCls, 'h-10 cursor-pointer pe-8', className)} {...p}>
      {children}
    </select>
  );
}

export function Checkbox({ label, checked, onChange, disabled, description }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('flex cursor-pointer items-start gap-3 rounded-md px-1 py-1.5', disabled && 'cursor-not-allowed opacity-60')}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded-sm accent-[var(--brand)]"
      />
      <span className="text-[14px] text-ink">
        {label}
        {description && <span className="block text-[12px] text-ink-subtle">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-ok' : 'bg-line-strong',
      )}
    >
      <span
        className={cx(
          'inline-block size-5 rounded-full bg-white shadow transition-transform duration-150',
          checked ? 'translate-x-[22px] rtl:-translate-x-[22px]' : 'translate-x-0.5 rtl:-translate-x-0.5',
        )}
      />
    </button>
  );
}

/** Large tappable option group used in the public report form. */
export function OptionGroup<T extends string>({ value, onChange, options, name, columns = 2, label }: { value: T | null; onChange: (v: T) => void; options: { value: T; label: string; icon?: LucideIcon; tone?: Tone }[]; name: string; columns?: 2 | 3 | 4; label: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold text-ink">
        {label} <span className="text-crit" aria-hidden>*</span>
      </legend>
      <div className={cx('grid gap-2', columns === 2 && 'grid-cols-2', columns === 3 && 'grid-cols-2 sm:grid-cols-3', columns === 4 && 'grid-cols-2 sm:grid-cols-4')}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <label
              key={o.value}
              className={cx(
                'flex min-h-12 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-[14px] transition-colors duration-150',
                active ? 'border-brand bg-surface-selected font-semibold text-ink ring-1 ring-brand' : 'border-line-strong bg-surface text-ink-muted hover:border-ink-subtle hover:text-ink',
              )}
            >
              <input type="radio" name={name} value={o.value} checked={active} onChange={() => onChange(o.value)} className="sr-only" />
              {o.icon && <o.icon className={cx('size-[18px] shrink-0', active ? 'text-brand' : 'text-ink-subtle')} aria-hidden />}
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: LucideIcon }[]; label: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-[5px] font-medium transition-colors duration-150',
            size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
            value === o.value ? 'bg-surface text-ink shadow-1' : 'text-ink-subtle hover:text-ink',
          )}
        >
          {o.icon && <o.icon className="size-3.5" aria-hidden />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto', className)}>
      {tabs.map((tb) => (
        <button
          key={tb.value}
          role="tab"
          aria-selected={value === tb.value}
          onClick={() => onChange(tb.value)}
          className={cx(
            'relative inline-flex h-10 cursor-pointer items-center gap-2 whitespace-nowrap px-3 text-[13px] font-medium transition-colors duration-150',
            value === tb.value ? 'text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand' : 'text-ink-subtle hover:text-ink',
          )}
        >
          {tb.label}
          {tb.count !== undefined && <span className="num rounded-sm bg-neutral-soft px-1.5 text-[11px] font-semibold text-ink-muted">{tb.count}</span>}
        </button>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Dialog (focus-trapped, Esc to close, returns focus)
// -----------------------------------------------------------------------------
export function Dialog({ open, onClose, title, children, footer, tone, size = 'md', description }: { open: boolean; onClose: () => void; title: ReactNode; children?: ReactNode; footer?: ReactNode; tone?: 'crit' | 'warn'; size?: 'sm' | 'md' | 'lg'; description?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement as HTMLElement;
    const el = ref.current!;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((x) => !x.hasAttribute('disabled'));
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[1] ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (last.focus(), e.preventDefault());
        else if (!e.shiftKey && document.activeElement === last) (first.focus(), e.preventDefault());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev.current?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const theme = document.querySelector('.theme-ops') ? 'theme-ops' : '';
  return createPortal(
    <div className={cx('fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4', theme)} dir={document.documentElement.dir}>
      <div className="absolute inset-0 bg-[var(--overlay)] fade-in" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          'relative flex max-h-[92vh] w-full flex-col rounded-t-lg border border-line bg-surface text-ink shadow-2 fade-in sm:rounded-lg',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-3xl',
          tone === 'crit' && 'border-t-4 border-t-alert',
          tone === 'warn' && 'border-t-4 border-t-warn',
        )}
      >
        <div className="flex items-start gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[16px] font-bold">
              {title}
            </h2>
            {description && <p className="mt-1 text-[13px] text-ink-muted">{description}</p>}
          </div>
          <IconButton icon={X} label={t('common.close')} onClick={onClose} size="sm" />
        </div>
        <div className="overflow-y-auto px-5 py-3">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// -----------------------------------------------------------------------------
// Toasts
// -----------------------------------------------------------------------------
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === 'crit' ? 9000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 end-4 z-[120] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((i) => {
          const Icon = i.tone === 'crit' ? XOctagon : i.tone === 'warn' ? AlertTriangle : i.tone === 'ok' ? CheckCircle2 : Info;
          return (
            <div key={i.id} role={i.tone === 'crit' ? 'alert' : 'status'} className="pointer-events-auto flex gap-3 rounded-lg border border-line bg-surface p-3 text-ink shadow-2 slide-in">
              <Icon className={cx('mt-0.5 size-4 shrink-0', toneText[i.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold">{i.title}</p>
                {i.body && <p className="text-[12px] text-ink-muted">{i.body}</p>}
              </div>
              <button className="cursor-pointer text-ink-subtle hover:text-ink" aria-label="Dismiss" onClick={() => setItems((x) => x.filter((y) => y.id !== i.id))}>
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/** Hook: run a mutation with standard error toast mapping. */
export function useMutation() {
  const toast = useToast();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (success) toast({ tone: 'ok', title: success });
        return r;
      } catch (e: any) {
        const code = e?.code ?? 'internal';
        const field = e?.body?.field;
        toast({ tone: 'crit', title: t(`errors.${code}`), body: field ? `${field}: ${e?.body?.reason}` : undefined });
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast, t],
  );
  return { run, busy };
}
