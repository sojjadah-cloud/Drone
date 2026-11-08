import { useEffect, useState } from 'react';
import { BatteryLow, CheckCircle2, Clock, Flame, Gauge, Lock, LogOut, MapPin, Rocket, Ruler, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/i18n';
import { api, useAuth } from '@/lib/api';
import type { ApiError } from '@/lib/api';
import { Button, Callout, Card, DemoBadge, Field, Input, cx, useMutation } from '@/components/ui';
import { CampusMap, AGENT_COLOR } from '@/components/CampusMap';
import { STATIONS } from '@shared/campus';
import type { CampusDrone, CampusState } from '@shared/campus';

export default function PilotPage() {
  const { user, checked, set } = useAuth();
  useEffect(() => {
    if (checked) return;
    api('/auth/me').then((r) => set({ user: r.user, csrf: r.csrf, permissions: r.permissions, checked: true })).catch(() => set({ user: null, checked: true }));
  }, [checked, set]);
  if (!checked) return null;
  return user?.role === 'pilot' ? <Console /> : <PilotLogin />;
}

function PilotLogin() {
  const { t } = useI18n();
  const setAuth = useAuth((s) => s.set);
  const user = useAuth((s) => s.user);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(user ? t('campus.pilotOnly') : null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/auth/login', { body: { username: u.trim(), password: p } });
      if (r.user.role !== 'pilot') {
        await api('/auth/logout', { method: 'POST', headers: { 'x-csrf-token': r.csrf } }).catch(() => {});
        setErr(t('campus.pilotOnly'));
      } else setAuth({ user: r.user, csrf: r.csrf, permissions: r.permissions, checked: true });
    } catch (e) {
      setErr((e as ApiError).code === 'locked' ? t('login.locked') : t('login.invalid'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-sm px-4 py-14">
      <Card className="p-6">
        <h1 className="text-[20px] font-bold">{t('campus.pilot')}</h1>
        <p className="mb-5 text-[13px] text-ink-muted">{t('campus.pilotOnly')}</p>
        <form onSubmit={submit} className="space-y-3">
          <Field label={t('login.username')}>{(fp) => <Input {...fp} dir="ltr" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} />}</Field>
          <Field label={t('login.password')}>{(fp) => <Input {...fp} dir="ltr" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} />}</Field>
          {err && <Callout tone="crit">{err}</Callout>}
          <Button variant="primary" size="lg" icon={Lock} className="w-full" type="submit" loading={busy} disabled={!u || !p}>{t('campus.signIn')}</Button>
        </form>
      </Card>
    </div>
  );
}

const fmtEta = (s: number | null, t: (k: string) => string) =>
  s == null ? '—' : s < 60 ? `${s} ${t('campus.sec')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} ${t('campus.min')}`;

function Console() {
  const { t, lang, fmtRel } = useI18n();
  const setAuth = useAuth((s) => s.set);
  const [st, setSt] = useState<CampusState | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const { run, busy } = useMutation();

  useEffect(() => {
    let alive = true;
    const load = () => api<CampusState>('/campus/state').then((x) => alive && setSt(x)).catch(() => {});
    load();
    const i = setInterval(load, 1000);
    return () => ((alive = false), clearInterval(i));
  }, []);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setAuth({ user: null, csrf: null, permissions: [] });
  };
  const launch = (id: number) => run(() => api(`/campus/reports/${id}/dispatch`, { body: {} }));
  const resolve = (id: number) => run(() => api(`/campus/reports/${id}/resolve`, { body: {} }));

  const flying = st?.drones.filter((d) => d.state === 'enroute' || d.state === 'onscene' || d.state === 'returning') ?? [];
  const suggestions = st?.hotspots.filter((h) => h.suggest) ?? [];

  return (
    <div className="mx-auto grid max-w-[1500px] gap-3 p-3 lg:h-[calc(100vh-56px)] lg:grid-cols-[1fr_400px]">
      <Card className="relative overflow-hidden">
        <CampusMap drones={st?.drones} fires={st?.active} hotspots={st?.hotspots} selectedFire={sel} onFire={setSel} className="h-[50vh] min-h-[340px] w-full lg:h-full" />
        <div className="pointer-events-none absolute bottom-8 start-3 flex flex-wrap gap-1.5 text-[12px]">
          {(['water', 'foam', 'powder'] as const).map((a) => (
            <span key={a} className="flex items-center gap-1 rounded-md bg-black/65 px-2 py-1 font-semibold text-white">
              <span className="size-2.5 rounded-sm" style={{ background: AGENT_COLOR[a] }} />{t(`campus.agents.${a}`)}
            </span>
          ))}
          <span className="flex items-center gap-1 rounded-md bg-black/65 px-2 py-1 font-semibold text-white"><span className="size-2.5 rounded-sm bg-[#e02424]" />{t('campus.hotspots')}</span>
        </div>
      </Card>

      <div className="space-y-3 lg:overflow-y-auto">
        <div className="flex items-center gap-2">
          <h1 className="text-[18px] font-bold">{t('campus.pilot')}</h1>
          <DemoBadge label={t('campus.simulated')} />
          <button onClick={logout} className="ms-auto inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-muted hover:bg-surface-hover"><LogOut className="size-4" />{t('campus.signOut')}</button>
        </div>

        {/* Active fires */}
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-[14px] font-bold"><Flame className="size-4 text-crit" />{t('campus.fires')}</h2>
          {!st?.active.length ? <Card className="px-4 py-5 text-center text-[14px] text-ink-subtle">{t('campus.noFires')}</Card> : (
            <div className="space-y-2">
              {st.active.map((f) => {
                const plan = f.plan;
                const n = plan.drones.length;
                return (
                  <Card key={f.id} className={cx('p-3', sel === f.id && 'ring-2 ring-crit')} onClick={() => setSel(f.id)}>
                    <div className="flex items-start gap-2">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-crit-soft text-crit"><Flame className="size-5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-bold">{t(`campus.types.${f.type}`)} · {t(`campus.sizes.${f.size}`)}</p>
                        <p className="text-[12px] text-ink-subtle">{fmtRel(f.createdAt)} · <span className="mono" dir="ltr">{f.ref}</span></p>
                        {f.details && <p className="mt-1 text-[13px] text-ink-muted">{f.details}</p>}
                      </div>
                    </div>
                    {plan.required > 0 && (
                      <div className="mt-3 rounded-md bg-surface-2 p-2.5">
                        <p className="mb-1.5 text-[13px] font-semibold">{t('campus.needs', { n: plan.required, agent: t(`campus.agents.${plan.agent}`) })}</p>
                        {plan.drones.map((d) => (
                          <div key={d.id} className="flex items-center gap-2 py-1 text-[13px]">
                            <span className="size-3 rounded-sm" style={{ background: AGENT_COLOR[d.agent] }} />
                            <span className="num w-10 font-bold">{d.name}</span>
                            <span className="text-ink-muted">{t(`campus.agents.${d.agent}`)}</span>
                            <span className="num ms-auto flex items-center gap-1 text-ink-muted"><Ruler className="size-3.5" />{d.distanceM} {t('campus.m')}</span>
                            <span className="num flex items-center gap-1 font-semibold"><Clock className="size-3.5" />{fmtEta(d.etaS, t)}</span>
                          </div>
                        ))}
                        {plan.shortage > 0 && <p className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-warn"><TriangleAlert className="size-3.5" />{n ? t('campus.shortage', { n: plan.shortage }) : t('campus.noneReady')}</p>}
                        {n > 0 && (
                          <Button variant="emergency" icon={Rocket} className="mt-2 w-full" loading={busy} onClick={(e) => (e.stopPropagation(), launch(f.id))}>
                            {f.assigned.length ? t('campus.reinforce') : n === 1 ? t('campus.launch1') : t('campus.launch', { n })}
                          </Button>
                        )}
                      </div>
                    )}
                    {f.status === 'dispatched' && (
                      <Button variant="secondary" icon={CheckCircle2} className="mt-2 w-full" onClick={(e) => (e.stopPropagation(), resolve(f.id))}>{t('campus.resolve')}</Button>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* Drones in flight */}
        <section>
          <h2 className="mb-2 text-[14px] font-bold">{t('campus.inFlight')}</h2>
          {!flying.length ? <Card className="px-4 py-4 text-center text-[13px] text-ink-subtle">{t('campus.noFlight')}</Card> : (
            <div className="space-y-2">{flying.map((d) => <DroneCard key={d.id} d={d} />)}</div>
          )}
        </section>

        {/* Hotspots & station suggestions */}
        <section>
          <h2 className="mb-1 flex items-center gap-1.5 text-[14px] font-bold"><span className="size-3 rounded-sm bg-[#e02424]" />{t('campus.hotspots')}</h2>
          <p className="mb-2 text-[12px] text-ink-subtle">{t('campus.hotspotsLead')}</p>
          {suggestions.length ? suggestions.map((h, i) => (
            <Card key={i} className="mb-2 flex items-center gap-3 border-gold/50 p-3">
              <MapPin className="size-5 shrink-0 text-gold" />
              <div>
                <p className="text-[14px] font-bold">{t('campus.suggest')}</p>
                <p className="text-[12px] text-ink-muted">{t('campus.suggestWhy', { n: h.count, m: h.nearestStationM })}</p>
              </div>
            </Card>
          )) : <p className="text-[13px] text-ink-subtle">{t('campus.noSuggest')}</p>}
        </section>

        {/* Stations summary */}
        <section>
          <h2 className="mb-2 text-[14px] font-bold">{t('campus.stations')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {STATIONS.map((s) => {
              const ready = st?.drones.filter((d) => d.station === s.id && d.state === 'ready') ?? [];
              return (
                <Card key={s.id} className="p-2.5">
                  <p className="text-[13px] font-semibold">{s.name[lang]}</p>
                  <div className="mt-1 flex items-center gap-1">
                    {ready.map((d) => <span key={d.id} title={d.name} className="size-3 rounded-sm" style={{ background: AGENT_COLOR[d.agent] }} />)}
                    <span className="ms-auto text-[12px] text-ink-subtle"><span className="num">{ready.length}</span> {t('campus.ready')}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function DroneCard({ d }: { d: CampusDrone }) {
  const { t } = useI18n();
  const low = d.battery < 30;
  return (
    <Card className={cx('p-3', d.returnReason === 'battery' && 'border-warn')}>
      <div className="flex items-center gap-2">
        <span className="size-3.5 rounded-sm" style={{ background: AGENT_COLOR[d.agent] }} />
        <span className="num font-bold">{d.name}</span>
        <span className="text-[13px] text-ink-muted">{t(`campus.agents.${d.agent}`)}</span>
        <span className={cx('ms-auto rounded-sm px-2 py-0.5 text-[12px] font-semibold', d.state === 'onscene' ? 'bg-crit-soft text-crit' : d.state === 'returning' ? 'bg-neutral-soft text-ink-muted' : 'bg-info-soft text-info')}>{t(`campus.state.${d.state}`)}</span>
      </div>
      {d.returnReason && d.returnReason !== 'done' && (
        <p className="mt-1.5 flex items-center gap-1 text-[12px] font-semibold text-warn"><BatteryLow className="size-3.5" />{t(`campus.reason.${d.returnReason}`)}</p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
        <Meter label={t('campus.battery')} value={d.battery} tone={low ? 'bg-crit' : d.battery < 50 ? 'bg-warn' : 'bg-ok'} />
        <Meter label={t('campus.payload')} value={d.payload} tone="bg-info" />
        <Stat icon={Gauge} label={t('campus.altitude')} value={`${Math.round(d.altitude)} ${t('campus.m')}`} />
        <Stat icon={Ruler} label={t('campus.distance')} value={d.distanceM == null ? '—' : `${d.distanceM} ${t('campus.m')}`} />
        <Stat icon={Clock} label={t('campus.eta')} value={fmtEta(d.etaS, t)} />
      </div>
    </Card>
  );
}

function Meter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="flex justify-between text-ink-subtle"><span>{label}</span><span className="num font-semibold text-ink">{Math.round(value)}%</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-soft"><div className={cx('h-full rounded-full', tone)} style={{ width: `${value}%` }} /></div>
    </div>
  );
}
function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-ink-subtle">
      <Icon className="size-3.5" />{label}
      <span className="num ms-auto font-semibold text-ink">{value}</span>
    </div>
  );
}
