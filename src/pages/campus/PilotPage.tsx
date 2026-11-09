import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BatteryWarning, Building2, Car, CheckCircle2, Clock, Flame, Gauge, HelpCircle, Leaf, Lock, LogOut, MapPin, Plane, Rocket, Ruler, TriangleAlert, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useI18n } from '@/i18n';
import { api, setToken, useToken } from '@/lib/api';
import type { ApiError } from '@/lib/api';
import { Button, Callout, Card, Field, Input, cx, useMutation } from '@/components/ui';
import { CampusMap, AGENT_COLOR } from '@/components/CampusMap';
import { AGENTS, STATIONS, droneAt } from '@shared/campus';
import type { DroneRec, DroneView, FireType, Hotspot, Plan, Report } from '@shared/campus';

type ActiveFire = Report & { plan: Plan; assigned: string[] };
interface StateRes { serverTime: number; drones: DroneRec[]; active: ActiveFire[]; hotspots: Hotspot[]; resolvedToday: number }
const TYPE_ICON: Record<FireType, LucideIcon> = { vegetation: Leaf, building: Building2, vehicle: Car, electrical: Zap, other: HelpCircle };

export default function PilotPage() {
  return useToken() ? <Console /> : <PilotLogin />;
}

function PilotLogin() {
  const { t } = useI18n();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string }>('/login', { username: u, password: p });
      setToken(r.token);
    } catch (e) {
      setErr(t(`errors.${(e as ApiError).code}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto flex min-h-[calc(100vh-56px)] max-w-sm items-center px-4 py-10">
      <Card className="w-full p-6 sm:p-7">
        <span className="flex size-12 items-center justify-center rounded-xl bg-surface-selected text-brand"><Plane className="size-6" aria-hidden /></span>
        <h1 className="mt-4 text-[22px] font-bold">{t('pilot.title')}</h1>
        <p className="mb-6 text-[14px] text-ink-muted">{t('pilot.signInLead')}</p>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('pilot.username')}>{(fp) => <Input {...fp} dir="ltr" autoComplete="username" autoCapitalize="none" value={u} onChange={(e) => setU(e.target.value)} />}</Field>
          <Field label={t('pilot.password')}>{(fp) => <Input {...fp} dir="ltr" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} />}</Field>
          {err && <Callout tone="crit">{err}</Callout>}
          <Button variant="primary" size="lg" icon={Lock} className="w-full" type="submit" loading={busy} disabled={!u || !p}>{t('pilot.signIn')}</Button>
        </form>
      </Card>
    </div>
  );
}

/** Re-render on an interval so live numbers (battery, ETA) tick between polls. */
function useClock(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const i = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(i);
  }, [ms]);
}

const fmtEta = (s: number | null, t: (k: string) => string) =>
  s == null ? '—' : s < 60 ? `${s} ${t('pilot.s')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} ${t('pilot.min')}`;

function Console() {
  const { t } = useI18n();
  const [st, setSt] = useState<StateRes | null>(null);
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<'fires' | 'drones' | 'insights'>('fires');
  const [selFire, setSelFire] = useState<number | null>(null);
  const [selDrone, setSelDrone] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const { run, busy } = useMutation();
  useClock(500);

  const load = async () => {
    try {
      const x = await api<StateRes>('/state');
      setOffset(x.serverTime - Date.now());
      setSt(x);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(t(`errors.${(e as ApiError).code}`));
    }
  };
  useEffect(() => {
    load();
    const i = setInterval(load, 2000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = Date.now() + offset;
  const views = useMemo(() => (st?.drones ?? []).map((d) => droneAt(d, now)), [st, now]);
  const flying = views.filter((d) => d.phase === 'enroute' || d.phase === 'onscene' || d.phase === 'returning');
  const readyCount = views.filter((d) => d.phase === 'ready').length;

  const launch = async (id: number) => (await run(() => api(`/reports/${id}/dispatch`, {}))) && load();
  const resolve = async (id: number) => (await run(() => api(`/reports/${id}/resolve`, {}))) && load();

  return (
    <div className="flex flex-col lg:h-[calc(100vh-56px)] lg:flex-row">
      <div className="relative h-[46vh] min-h-[320px] lg:h-auto lg:flex-1">
        <CampusMap drones={st?.drones} clockOffset={offset} fires={st?.active} hotspots={st?.hotspots} selectedFire={selFire} selectedDrone={selDrone}
          onFire={(id) => (setSelFire(id), setTab('fires'))} onDrone={(id) => (setSelDrone(id), setTab('drones'))} className="size-full" />
        <div className="pointer-events-none absolute bottom-7 start-3 flex flex-wrap gap-1.5">
          {AGENTS.map((a) => (
            <span key={a} className="flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-[12px] font-semibold text-white backdrop-blur">
              <span className="size-2.5 rounded-full" style={{ background: AGENT_COLOR[a] }} />{t(`pilot.agents.${a}`)}
            </span>
          ))}
          <span className="flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-[12px] font-semibold text-white backdrop-blur"><span className="size-2.5 rounded-sm bg-[#e02424]" />{t('pilot.hotspots')}</span>
        </div>
      </div>

      <aside className="flex w-full flex-col border-line bg-surface lg:w-[420px] lg:border-s">
        <div className="border-b border-line px-4 pb-3 pt-4">
          <div className="flex items-center gap-2">
            <h1 className="text-[18px] font-bold">{t('pilot.title')}</h1>
            <span className="rounded-sm border border-dashed border-gold/70 px-1.5 text-[11px] font-semibold text-gold">{t('pilot.simulated')}</span>
            <button onClick={() => setToken(null)} className="ms-auto inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink">
              <LogOut className="size-4" aria-hidden />{t('pilot.signOut')}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label={t('pilot.active')} value={st?.active.length} tone={st?.active.length ? 'text-crit' : 'text-ink'} />
            <Stat label={t('pilot.inAir')} value={st ? flying.length : undefined} tone="text-info" />
            <Stat label={t('pilot.ready')} value={st ? readyCount : undefined} tone="text-ok" />
          </div>
          {loadErr && <p role="alert" className="mt-2 text-[13px] font-medium text-crit">{loadErr}</p>}
        </div>

        <div role="tablist" className="flex border-b border-line px-2">
          {(['fires', 'drones', 'insights'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cx('relative h-11 flex-1 cursor-pointer text-[14px] font-semibold transition-colors', tab === k ? 'text-brand after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand' : 'text-ink-subtle hover:text-ink')}>
              {t(`pilot.tabs.${k}`)}
              {k === 'fires' && !!st?.active.length && <span className="num ms-1.5 rounded-full bg-crit px-1.5 text-[11px] text-white">{st.active.length}</span>}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {tab === 'fires' && (!st?.active.length ? (
            <div className="px-4 py-12 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-ok-soft text-ok"><CheckCircle2 className="size-6" /></span>
              <p className="mt-3 font-semibold">{t('pilot.noFires')}</p>
              <p className="text-[13px] text-ink-subtle">{t('pilot.noFiresLead')}</p>
            </div>
          ) : st.active.map((f) => (
            <FireCard key={f.id} f={f} views={views} selected={selFire === f.id} busy={busy} onSelect={() => setSelFire(f.id)} onLaunch={() => launch(f.id)} onResolve={() => resolve(f.id)} onDrone={(id) => (setSelDrone(id), setTab('drones'))} />
          )))}

          {tab === 'drones' && (
            <>
              {flying.map((d) => <DroneCard key={d.id} d={d} selected={selDrone === d.id} onSelect={() => setSelDrone(d.id)} />)}
              <h3 className="px-1 pt-1 text-[12px] font-bold uppercase tracking-wide text-ink-subtle">{t('pilot.stations')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {STATIONS.map((s) => <StationCard key={s.id} id={s.id} views={views} />)}
              </div>
            </>
          )}

          {tab === 'insights' && <Insights hotspots={st?.hotspots ?? []} />}
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | undefined; tone: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <p className={cx('num text-[22px] font-bold leading-none', tone)}>{value ?? '–'}</p>
      <p className="mt-1 truncate text-[12px] text-ink-subtle">{label}</p>
    </div>
  );
}

function FireCard({ f, views, selected, busy, onSelect, onLaunch, onResolve, onDrone }: { f: ActiveFire; views: DroneView[]; selected: boolean; busy: boolean; onSelect: () => void; onLaunch: () => void; onResolve: () => void; onDrone: (id: string) => void }) {
  const { t, fmtRel } = useI18n();
  const Icon = TYPE_ICON[f.type];
  const assigned = views.filter((d) => d.reportId === f.id);
  const plan = f.plan;
  return (
    <Card className={cx('overflow-hidden transition-shadow', selected && 'ring-2 ring-crit')} onClick={onSelect}>
      <div className="flex items-start gap-3 p-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-crit-soft text-crit"><Icon className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[15px] font-bold">{t(`report.types.${f.type}`)}</p>
            <span className={cx('rounded-sm px-1.5 text-[12px] font-semibold', f.size === 'large' ? 'bg-crit text-white' : f.size === 'medium' ? 'bg-warn-soft text-warn' : 'bg-neutral-soft text-ink-muted')}>
              <Flame className="me-0.5 inline size-3" aria-hidden />{t(`report.sizes.${f.size}`)}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-ink-subtle">{fmtRel(new Date(f.createdAt).toISOString())} · <span className="mono" dir="ltr">{f.ref}</span></p>
          {f.details && <p className="mt-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink-muted">{f.details}</p>}
        </div>
      </div>

      {assigned.length > 0 && (
        <div className="border-t border-line px-3.5 py-2.5">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-subtle">{t('pilot.assigned')}</p>
          {assigned.map((d) => (
            <button key={d.id} onClick={(e) => (e.stopPropagation(), onDrone(d.id))} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-[13px] hover:bg-surface-hover">
              <AgentDot a={d.agent} /><span className="num w-9 font-bold">{d.id}</span>
              <PhaseBadge d={d} />
              <span className="num ms-auto text-ink-muted">{Math.round(d.battery)}%</span>
              <span className="num w-14 text-end font-semibold">{d.phase === 'onscene' ? `${Math.round(d.payload)}%` : fmtEta(d.etaS, t)}</span>
            </button>
          ))}
        </div>
      )}

      {plan.required > 0 && (
        <div className="border-t border-line bg-surface-2 px-3.5 py-3">
          <p className="mb-2 text-[13px] font-bold">{t('pilot.needs', { n: plan.required, agent: t(`pilot.agents.${plan.agent}`) })}</p>
          {plan.drones.map((d) => (
            <div key={d.id} className="flex items-center gap-2 py-1 text-[13px]">
              <AgentDot a={d.agent} /><span className="num w-9 font-bold">{d.id}</span>
              <span className="text-ink-muted">{t(`pilot.agents.${d.agent}`)}</span>
              <span className="num ms-auto flex items-center gap-1 text-ink-muted"><Ruler className="size-3.5" aria-hidden />{d.distanceM} {t('pilot.m')}</span>
              <span className="num flex w-16 items-center justify-end gap-1 font-semibold"><Clock className="size-3.5" aria-hidden />{fmtEta(d.etaS, t)}</span>
            </div>
          ))}
          {plan.shortage > 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-[12px] font-semibold text-warn">
              <TriangleAlert className="size-3.5" aria-hidden />{plan.drones.length ? t('pilot.shortage', { n: plan.shortage }) : t('pilot.noneReady')}
            </p>
          )}
          {plan.drones.length > 0 && (
            <Button variant="emergency" icon={Rocket} className="mt-2.5 w-full" loading={busy} onClick={(e) => (e.stopPropagation(), onLaunch())}>
              {assigned.length ? t('pilot.reinforce') : plan.drones.length === 1 ? t('pilot.launch1') : t('pilot.launch', { n: plan.drones.length })}
            </Button>
          )}
        </div>
      )}

      {f.status === 'dispatched' && (
        <div className="border-t border-line p-3">
          <Button variant="secondary" icon={CheckCircle2} className="w-full" onClick={(e) => (e.stopPropagation(), onResolve())}>{t('pilot.resolve')}</Button>
        </div>
      )}
    </Card>
  );
}

function DroneCard({ d, selected, onSelect }: { d: DroneView; selected: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  const low = d.battery < 30;
  return (
    <Card className={cx('p-3.5', selected && 'ring-2 ring-brand', d.reason === 'battery' && 'border-warn')} onClick={onSelect}>
      <div className="flex items-center gap-2">
        <AgentDot a={d.agent} size="size-3.5" />
        <span className="num text-[15px] font-bold">{d.id}</span>
        <span className="text-[13px] text-ink-muted">{t(`pilot.agents.${d.agent}`)}</span>
        <span className="ms-auto"><PhaseBadge d={d} /></span>
      </div>
      {d.reason && d.reason !== 'done' && (
        <p className="mt-2 flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-[12px] font-semibold text-warn"><BatteryWarning className="size-3.5" aria-hidden />{t(`pilot.reason.${d.reason}`)}</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
        <Meter label={t('pilot.battery')} value={d.battery} bar={low ? 'bg-crit' : d.battery < 50 ? 'bg-warn' : 'bg-ok'} />
        <Meter label={t('pilot.payload')} value={d.payload} bar="bg-info" />
        <Row icon={Gauge} label={t('pilot.altitude')} value={`${Math.round(d.altitude)} ${t('pilot.m')}`} />
        <Row icon={Ruler} label={t('pilot.distance')} value={d.distanceM == null ? '—' : `${d.distanceM} ${t('pilot.m')}`} />
        <Row icon={Clock} label={t('pilot.eta')} value={d.phase === 'onscene' ? '—' : fmtEta(d.etaS, t)} />
      </div>
    </Card>
  );
}

function StationCard({ id, views }: { id: (typeof STATIONS)[number]['id']; views: DroneView[] }) {
  const { lang, t } = useI18n();
  const s = STATIONS.find((x) => x.id === id)!;
  const here = views.filter((v) => v.home === id && (v.phase === 'ready' || v.phase === 'charging'));
  return (
    <Card className="p-3">
      <p className="text-[13px] font-semibold">{s.name[lang]}</p>
      <div className="mt-2 space-y-1.5">
        {AGENTS.map((a) => {
          const v = here.find((x) => x.agent === a);
          return (
            <div key={a} className="flex items-center gap-2 text-[12px]">
              <AgentDot a={a} />
              {v ? (
                <>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-soft"><div className={cx('h-full rounded-full', v.phase === 'ready' ? 'bg-ok' : 'bg-warn')} style={{ width: `${v.battery}%` }} /></div>
                  <span className="num w-8 text-end text-ink-muted">{Math.round(v.battery)}%</span>
                </>
              ) : <span className="flex-1 text-ink-subtle">{t('pilot.assigned')}</span>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Insights({ hotspots }: { hotspots: Hotspot[] }) {
  const { t } = useI18n();
  const sug = hotspots.filter((h) => h.suggest);
  return (
    <>
      <p className="px-1 text-[13px] text-ink-muted">{t('pilot.hotspotsLead')}</p>
      {sug.length ? sug.map((h, i) => (
        <Card key={i} className="flex items-center gap-3 border-gold/60 p-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--gold-fill)_18%,transparent)] text-gold"><MapPin className="size-5" aria-hidden /></span>
          <div>
            <p className="text-[14px] font-bold">{t('pilot.suggest')}</p>
            <p className="text-[12px] text-ink-muted">{t('pilot.suggestWhy', { n: h.count, m: h.nearestM })}</p>
          </div>
        </Card>
      )) : <Card className="p-4 text-center text-[13px] text-ink-subtle">{t('pilot.noSuggest')}</Card>}
      {hotspots.filter((h) => !h.suggest).map((h, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-[13px]">
          <span className="size-3 rounded-sm bg-[#e02424]" aria-hidden />
          <span className="font-semibold"><span className="num">{h.count}</span></span>
          <span className="ms-auto text-ink-subtle"><span className="num">{h.nearestM}</span> {t('pilot.m')}</span>
        </div>
      ))}
    </>
  );
}

const AgentDot = ({ a, size = 'size-3' }: { a: DroneView['agent']; size?: string }) => <span className={cx(size, 'shrink-0 rounded-full ring-1 ring-black/15')} style={{ background: AGENT_COLOR[a] }} aria-hidden />;

function PhaseBadge({ d }: { d: DroneView }) {
  const { t } = useI18n();
  const cls = d.phase === 'onscene' ? 'bg-crit-soft text-crit' : d.phase === 'enroute' ? 'bg-info-soft text-info' : d.phase === 'returning' ? 'bg-neutral-soft text-ink-muted' : d.phase === 'ready' ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn';
  return <span className={cx('rounded-sm px-1.5 py-0.5 text-[12px] font-semibold', cls)}>{t(`pilot.phase.${d.phase}`)}</span>;
}
function Meter({ label, value, bar }: { label: string; value: number; bar: string }) {
  return (
    <div>
      <div className="flex justify-between text-ink-subtle"><span>{label}</span><span className="num font-semibold text-ink">{Math.round(value)}%</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-soft"><div className={cx('h-full rounded-full transition-[width] duration-500', bar)} style={{ width: `${value}%` }} /></div>
    </div>
  );
}
function Row({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-ink-subtle">
      <Icon className="size-3.5" aria-hidden />{label}<span className="num ms-auto font-semibold text-ink">{value}</span>
    </div>
  );
}
