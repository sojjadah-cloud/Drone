import { useState } from 'react';
import { CheckCircle2, Flame, MapPin } from 'lucide-react';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';
import { Button, Callout, Card, Textarea, cx } from '@/components/ui';
import { CampusMap } from '@/components/CampusMap';
import { FIRE_SIZES, FIRE_TYPES, insideCampus } from '@shared/campus';
import type { FireSize, FireType } from '@shared/campus';

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

  const onPick = (p: { lat: number; lng: number }) => {
    const ok = insideCampus(p.lat, p.lng);
    setOutside(!ok);
    if (ok) setLoc(p);
  };
  const submit = async () => {
    if (!loc || !size || !type) return setErr(t('campus.required'));
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ ref: string }>('/campus/reports', { body: { ...loc, size, type, details } });
      setSent(r.ref);
    } catch (e) {
      setErr(t(`errors.${(e as ApiError).code}`));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => (setSent(null), setLoc(null), setSize(null), setType(null), setDetails(''));

  if (sent)
    return (
      <div className="mx-auto max-w-md px-4 py-14 text-center">
        <CheckCircle2 className="mx-auto size-16 text-ok" aria-hidden />
        <h1 className="mt-4 text-[24px] font-bold">{t('campus.sent')}</h1>
        <p className="mt-1 text-ink-muted">{t('campus.sentLead')}</p>
        <p className="mt-6 text-[13px] text-ink-subtle">{t('campus.ref')}</p>
        <p className="mono text-[24px] font-bold" dir="ltr">{sent}</p>
        <Button variant="primary" size="lg" className="mt-8 w-full" onClick={reset}>{t('campus.another')}</Button>
      </div>
    );

  const chip = (active: boolean) =>
    cx('h-12 rounded-md border px-3 text-[15px] font-semibold transition-colors', active ? 'border-brand bg-brand text-on-brand' : 'border-line-strong bg-surface text-ink hover:border-brand');

  return (
    <div className="mx-auto grid max-w-6xl gap-5 px-3 py-5 sm:px-5 lg:grid-cols-[1.3fr_1fr] lg:py-8">
      <section>
        <h1 className="text-[24px] font-bold">{t('campus.reportTitle')}</h1>
        <p className="mb-3 text-[14px] text-ink-muted">{t('campus.reportLead')}</p>
        <Card className="overflow-hidden">
          <CampusMap pick={{ value: loc, onChange: onPick }} showStations={false} className="h-[46vh] min-h-[320px] w-full lg:h-[560px]" />
        </Card>
        <p className={cx('mt-2 flex items-center gap-1.5 text-[13px]', outside ? 'font-semibold text-crit' : loc ? 'text-ok' : 'text-ink-subtle')}>
          <MapPin className="size-4" aria-hidden />
          {outside ? t('campus.outside') : loc ? t('campus.location') + ' ✓' : t('campus.tapMap')}
        </p>
      </section>

      <section className="space-y-5 lg:pt-[68px]">
        <fieldset>
          <legend className="mb-2 text-[15px] font-bold">{t('campus.size')}</legend>
          <div className="grid grid-cols-3 gap-2">
            {FIRE_SIZES.map((s) => (
              <button key={s} type="button" aria-pressed={size === s} aria-label={t(`campus.sizes.${s}`)} className={chip(size === s)} onClick={() => setSize(s)}>
                <Flame className={cx('mx-auto', s === 'small' ? 'size-3.5' : s === 'medium' ? 'size-4.5' : 'size-6')} aria-hidden />
                <span className="block text-[13px]">{t(`campus.sizes.${s}`)}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-[15px] font-bold">{t('campus.type')}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
            {FIRE_TYPES.map((x) => (
              <button key={x} type="button" aria-pressed={type === x} className={chip(type === x)} onClick={() => setType(x)}>{t(`campus.types.${x}`)}</button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="details" className="mb-2 block text-[15px] font-bold">{t('campus.details')} <span className="text-[13px] font-normal text-ink-subtle">({t('campus.detailsHint')})</span></label>
          <Textarea id="details" value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} className="min-h-20" />
        </div>
        {err && <Callout tone="crit">{err}</Callout>}
        <Button variant="emergency" size="lg" className="h-14 w-full text-[17px]" loading={busy} onClick={submit} disabled={!loc || !size || !type}>
          {busy ? t('campus.sending') : t('campus.send')}
        </Button>
        <p className="text-center text-[12px] text-ink-subtle">{t('campus.emergency')}</p>
      </section>
    </div>
  );
}
