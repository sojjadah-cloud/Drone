import { useState } from 'react';
import type { ReactNode } from 'react';
import { Building2, Car, CheckCircle2, Flame, HelpCircle, Leaf, MapPin, Phone, Send, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';
import { Button, Textarea, cx } from '@/components/ui';
import { CampusMap } from '@/components/CampusMap';
import { FIRE_SIZES, FIRE_TYPES, insideCampus } from '@shared/campus';
import type { FireSize, FireType } from '@shared/campus';

const TYPE_ICON: Record<FireType, LucideIcon> = { vegetation: Leaf, building: Building2, vehicle: Car, electrical: Zap, other: HelpCircle };
const SIZE_ICON: Record<FireSize, string> = { small: 'size-4', medium: 'size-5', large: 'size-7' };

export default function ReportPage() {
  const { t } = useI18n();
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [outside, setOutside] = useState(false);
  const [size, setSize] = useState<FireSize | null>(null);
  const [type, setType] = useState<FireType | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const complete = !!loc && !!size && !!type;

  const onPick = (p: { lat: number; lng: number }) => {
    const ok = insideCampus(p.lat, p.lng);
    setOutside(!ok);
    if (ok) setLoc(p);
  };
  const submit = async () => {
    if (!complete) return setErr(t('report.missing'));
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ ref: string }>('/reports', { ...loc, size, type, details });
      setSent(r.ref);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setErr(t(`errors.${(e as ApiError).code}`));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => (setSent(null), setLoc(null), setSize(null), setType(null), setDetails(''), setErr(null));

  if (sent)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-5 py-16 text-center fade-in">
        <span className="flex size-20 items-center justify-center rounded-full bg-ok-soft text-ok"><CheckCircle2 className="size-11" aria-hidden /></span>
        <h1 className="mt-5 text-[26px] font-bold">{t('report.sent')}</h1>
        <p className="mt-2 text-[15px] text-ink-muted">{t('report.sentLead')}</p>
        <div className="mt-8 w-full rounded-xl border border-line bg-surface p-5">
          <p className="text-[13px] text-ink-subtle">{t('report.ref')}</p>
          <p className="mono mt-1 text-[26px] font-bold tracking-wider" dir="ltr">{sent}</p>
        </div>
        <Button variant="primary" size="lg" className="mt-6 w-full" onClick={reset}>{t('report.another')}</Button>
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl px-4 pb-32 pt-6 sm:px-6 lg:pb-12 lg:pt-10">
      <header className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight sm:text-[34px]">{t('report.title')}</h1>
        <p className="mt-1 text-[15px] text-ink-muted">{t('report.lead')}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:gap-10">
        <Step n={1} title={t('report.step1')} done={!!loc}>
          <div className="overflow-hidden rounded-xl border border-line shadow-1">
            <CampusMap pick={{ value: loc, onChange: onPick }} showStations={false} className="h-[46vh] min-h-[300px] w-full lg:h-[540px]" />
          </div>
          <p aria-live="polite" className={cx('mt-2 flex items-center gap-1.5 text-[13px]', outside ? 'font-semibold text-crit' : loc ? 'text-ok' : 'text-ink-subtle')}>
            <MapPin className="size-4 shrink-0" aria-hidden />
            {outside ? t('report.outside') : loc ? t('report.located') : t('report.tapMap')}
          </p>
        </Step>

        <div className="space-y-7">
          <Step n={2} title={t('report.step2')} done={!!size}>
            <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label={t('report.step2')}>
              {FIRE_SIZES.map((s) => (
                <Tile key={s} active={size === s} onClick={() => setSize(s)} label={t(`report.sizes.${s}`)} hint={t(`report.sizeHint.${s}`)}
                  icon={<Flame className={cx(SIZE_ICON[s], 'mx-auto')} aria-hidden />} />
              ))}
            </div>
          </Step>
          <Step n={3} title={t('report.step3')} done={!!type}>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2" role="radiogroup" aria-label={t('report.step3')}>
              {FIRE_TYPES.map((x) => {
                const Icon = TYPE_ICON[x];
                return <Tile key={x} row active={type === x} onClick={() => setType(x)} label={t(`report.types.${x}`)} icon={<Icon className="size-5 shrink-0" aria-hidden />} />;
              })}
            </div>
          </Step>
          <Step n={4} title={t('report.step4')} optional>
            <Textarea aria-label={t('report.step4')} value={details} maxLength={500} placeholder={t('report.detailsPh')} onChange={(e) => setDetails(e.target.value)} className="min-h-24" />
          </Step>

          {/* Desktop send */}
          <div className="hidden lg:block">
            {err && <p role="alert" className="mb-3 rounded-md bg-crit-soft px-3 py-2 text-[14px] font-medium text-crit">{err}</p>}
            <Button variant="emergency" size="lg" icon={Send} className="h-14 w-full text-[17px]" loading={busy} onClick={submit} disabled={!complete}>
              {busy ? t('report.sending') : t('report.send')}
            </Button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-ink-subtle"><Phone className="size-3.5" aria-hidden />{t('report.emergency')}</p>
          </div>
        </div>
      </div>

      {/* Mobile sticky send bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden">
        {err && <p role="alert" className="mb-2 text-[13px] font-medium text-crit">{err}</p>}
        <Button variant="emergency" size="lg" icon={Send} className="h-13 w-full text-[16px]" loading={busy} onClick={submit} disabled={!complete}>
          {busy ? t('report.sending') : t('report.send')}
        </Button>
        <p className="mt-1.5 text-center text-[12px] text-ink-subtle">{t('report.emergency')}</p>
      </div>
    </div>
  );
}

function Step({ n, title, done, optional, children }: { n: number; title: string; done?: boolean; optional?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2.5 text-[16px] font-bold">
        <span className={cx('flex size-7 items-center justify-center rounded-full text-[13px] font-bold transition-colors', done ? 'bg-ok text-white' : 'bg-surface-selected text-brand')}>
          {done ? <CheckCircle2 className="size-4" aria-hidden /> : <span className="num">{n}</span>}
        </span>
        {title}
        {optional && <span className="text-[13px] font-normal text-ink-subtle">({t('common.optional')})</span>}
      </h2>
      {children}
    </section>
  );
}

function Tile({ active, onClick, label, hint, icon, row }: { active: boolean; onClick: () => void; label: string; hint?: string; icon: ReactNode; row?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx(
        'cursor-pointer rounded-xl border-2 text-[15px] font-semibold transition-colors duration-150',
        row ? 'flex min-h-14 items-center gap-2.5 px-3.5 text-start' : 'px-2 py-3 text-center',
        active ? 'border-brand bg-surface-selected text-brand' : 'border-line bg-surface text-ink hover:border-line-strong',
      )}
    >
      {icon}
      <span className={row ? '' : 'mt-1.5 block'}>{label}</span>
      {hint && <span className="mt-0.5 block text-[11px] font-normal text-ink-subtle">{hint}</span>}
    </button>
  );
}
