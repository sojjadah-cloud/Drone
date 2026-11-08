import { useId } from 'react';
import type { ReactNode } from 'react';
import {
  AlertOctagon, AlertTriangle, ArrowDown, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, CheckCircle2, ChevronDown, CircleDashed,
  CircleDot, Clock, Factory, Flame, Globe, Home, Leaf, Loader2, MapPin, Navigation, PauseCircle, Plane, PlugZap, Satellite, ShieldAlert,
  Signal, SignalLow, SignalZero, Truck, Wrench, XCircle, Building2, HelpCircle, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, cx, toneDot, toneText } from './ui';
import type { Tone } from './ui';
import { useI18n } from '@/i18n';
import type {
  DroneStatus, FireType, IncidentStatus, MissionStatus, Priority, ReportStatus, SuppressionStep, TelemetryDTO, TimelineEntry,
} from '@shared/domain';

// -----------------------------------------------------------------------------
// Brand
// -----------------------------------------------------------------------------
export function LogoMark({ className = 'size-9' }: { className?: string }) {
  // Unique gradient id per instance: a gradient defined inside a hidden (display:none) SVG doesn't paint elsewhere.
  const gid = `fg-gold-${useId().replace(/:/g, '')}`;
  return (
    // FIREGUARD's own mark (gold-on-green). Deliberately not derived from any official emblem.
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ecd393" />
          <stop offset=".55" stopColor="#c9a24d" />
          <stop offset="1" stopColor="#9c7a2e" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="9" fill="#005041" />
      <rect x=".75" y=".75" width="38.5" height="38.5" rx="8.25" fill="none" stroke={`url(#${gid})`} strokeOpacity=".45" strokeWidth="1" />
      <path d="M20 6.5l11 4.8v7.9c0 6.8-4.6 12-11 14-6.4-2-11-7.2-11-14v-7.9l11-4.8z" fill="none" stroke={`url(#${gid})`} strokeWidth="1.9" />
      <path d="M20.5 13c.5 3 4.4 4.4 4.4 8.7A4.9 4.9 0 0 1 20 26.5a4.9 4.9 0 0 1-4.9-4.8c0-2.2 1.2-3.5 2.3-4.4.1 1.4.9 2.3 1.7 2.7-.5-2.8.3-5.4 1.4-7z" fill={`url(#${gid})`} />
      <path d="M13.5 29.6h13" stroke={`url(#${gid})`} strokeWidth="1.2" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

export function Logo({ inverted, compact }: { inverted?: boolean; compact?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className={cx('font-[Inter] text-[17px] font-bold tracking-[0.12em]', inverted ? 'text-white' : 'text-pine-900')}>FIREGUARD</span>
          <span className={cx('mt-1 hidden text-[11px] font-medium sm:block', inverted ? 'text-gold-300/80' : 'text-ink-subtle')}>{lang === 'ar' ? t('brand.nameAlt') : t('brand.tagline')}</span>
        </span>
      )}
    </span>
  );
}

export function LanguageSwitcher({ className, inverted }: { className?: string; inverted?: boolean }) {
  const { lang, setLang, t } = useI18n();
  const next = lang === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      lang={next}
      aria-label={`${t('common.language')}: ${next === 'en' ? 'English' : 'العربية'}`}
      className={cx(
        'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold transition-colors duration-150',
        inverted ? 'text-white/85 hover:bg-white/10 hover:text-white' : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
        className,
      )}
    >
      <Globe className="size-4" aria-hidden />
      {next === 'en' ? 'English' : 'العربية'}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Priority & status
// -----------------------------------------------------------------------------
export const priorityTone: Record<Priority, Tone> = { P1: 'crit', P2: 'warn', P3: 'info', P4: 'neutral' };
const priorityIcon: Record<Priority, LucideIcon> = { P1: AlertOctagon, P2: AlertTriangle, P3: CircleDot, P4: ArrowDown };

export function PriorityBadge({ p, short }: { p: Priority; short?: boolean }) {
  const { t } = useI18n();
  return (
    <Badge tone={priorityTone[p]} icon={priorityIcon[p]} solid={p === 'P1'}>
      <span className="num">{short ? p : t(`priority.${p}`)}</span>
    </Badge>
  );
}

const incidentTone: Record<IncidentStatus, Tone> = { verified: 'warn', response_assigned: 'info', in_progress: 'crit', resolved: 'ok', closed: 'neutral' };
const reportTone: Record<ReportStatus, Tone> = { submitted: 'warn', under_review: 'info', verified: 'ok', rejected: 'neutral', duplicate: 'neutral', cancelled: 'neutral' };
export const droneTone: Record<DroneStatus, Tone> = { available: 'ok', in_mission: 'info', charging: 'gold', maintenance: 'warn', offline: 'neutral', restricted: 'crit' };
const missionTone: Record<MissionStatus, Tone> = { planned: 'neutral', authorized: 'gold', preflight: 'info', active: 'ok', paused: 'warn', returning: 'info', completed: 'neutral', aborted: 'crit' };
const suppTone: Record<SuppressionStep, Tone> = { requested: 'warn', target_confirmed: 'info', readiness_verified: 'info', safety_approved: 'gold', released: 'crit', outcome_recorded: 'ok', cancelled: 'neutral' };

const droneIcon: Record<DroneStatus, LucideIcon> = { available: CheckCircle2, in_mission: Plane, charging: PlugZap, maintenance: Wrench, offline: CircleDashed, restricted: ShieldAlert };
const incidentIcon: Record<IncidentStatus, LucideIcon> = { verified: CheckCircle2, response_assigned: Users, in_progress: Flame, resolved: CheckCircle2, closed: XCircle };
const missionIcon: Record<MissionStatus, LucideIcon> = { planned: Clock, authorized: CheckCircle2, preflight: CheckCircle2, active: Navigation, paused: PauseCircle, returning: Home, completed: CheckCircle2, aborted: XCircle };

type StatusKind =
  | { kind: 'incident'; value: IncidentStatus }
  | { kind: 'report'; value: ReportStatus }
  | { kind: 'drone'; value: DroneStatus }
  | { kind: 'mission'; value: MissionStatus }
  | { kind: 'supp'; value: SuppressionStep };

export function StatusIndicator(props: StatusKind & { variant?: 'badge' | 'dot' }) {
  const { t } = useI18n();
  const tone =
    props.kind === 'incident' ? incidentTone[props.value]
    : props.kind === 'report' ? reportTone[props.value]
    : props.kind === 'drone' ? droneTone[props.value]
    : props.kind === 'mission' ? missionTone[props.value]
    : suppTone[props.value];
  const icon =
    props.kind === 'drone' ? droneIcon[props.value] : props.kind === 'incident' ? incidentIcon[props.value] : props.kind === 'mission' ? missionIcon[props.value] : undefined;
  const label = t(`status.${props.kind}.${props.value}`);
  if (props.variant === 'dot')
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-ink">
        <span className={cx('size-2 shrink-0 rounded-full', toneDot[tone])} aria-hidden />
        {label}
      </span>
    );
  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}

export const fireTypeIcon: Record<FireType, LucideIcon> = { vegetation: Leaf, building: Building2, vehicle: Truck, industrial: Factory, other: HelpCircle };

export function FireTypeLabel({ type }: { type: FireType }) {
  const { t } = useI18n();
  const Icon = fireTypeIcon[type];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-4 text-ink-subtle" aria-hidden />
      {t(`options.fireType.${type}`)}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Telemetry atoms
// -----------------------------------------------------------------------------
export function batteryTone(v: number | undefined): Tone {
  if (v == null) return 'neutral';
  return v < 25 ? 'crit' : v < 45 ? 'warn' : 'ok';
}

export function BatteryIndicator({ value, compact }: { value: number | undefined | null; compact?: boolean }) {
  const { t } = useI18n();
  const v = value ?? undefined;
  const tone = batteryTone(v);
  const Icon = v == null ? BatteryWarning : v < 25 ? BatteryLow : v < 60 ? BatteryMedium : BatteryFull;
  return (
    <span className={cx('inline-flex items-center gap-1.5', toneText[tone])} aria-label={`${t('gcs.battery')} ${v == null ? '—' : Math.round(v) + '%'}`}>
      <Icon className="size-4 shrink-0" aria-hidden />
      {!compact && (
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-neutral-soft" aria-hidden>
          <span className={cx('block h-full rounded-full', toneDot[tone])} style={{ width: `${v ?? 0}%` }} />
        </span>
      )}
      <span className="num text-[13px] font-semibold">{v == null ? '—' : `${Math.round(v)}%`}</span>
    </span>
  );
}

export function LinkIndicator({ value, lost }: { value: number | undefined | null; lost?: boolean }) {
  const { t } = useI18n();
  const tone: Tone = lost || value == null ? 'crit' : value < 50 ? 'warn' : 'ok';
  const Icon = lost || value == null ? SignalZero : value < 50 ? SignalLow : Signal;
  return (
    <span className={cx('inline-flex items-center gap-1', toneText[tone])} aria-label={`${t('gcs.signal')} ${value ?? '—'}%`}>
      <Icon className="size-4" aria-hidden />
      <span className="num text-[13px] font-semibold">{lost || value == null ? '—' : `${value}%`}</span>
    </span>
  );
}

export function GpsIndicator({ t: tel }: { t: TelemetryDTO | undefined | null }) {
  const { t } = useI18n();
  const tone: Tone = !tel ? 'neutral' : tel.gpsFix === '3d' || tel.gpsFix === 'rtk' ? 'ok' : tel.gpsFix === '2d' ? 'warn' : 'crit';
  return (
    <span className={cx('inline-flex items-center gap-1', toneText[tone])} aria-label={`${t('gcs.gps')} ${tel?.gpsFix ?? '—'}`}>
      <Satellite className="size-4" aria-hidden />
      <span className="num text-[13px] font-semibold uppercase">{tel ? `${tel.gpsFix} · ${tel.satellites}` : '—'}</span>
    </span>
  );
}

export function PayloadIndicator({ type, capacity, unit, remaining }: { type: string; capacity: number; unit: string; remaining?: number }) {
  const { t } = useI18n();
  if (type === 'camera_only') return <span className="text-[13px] text-ink-subtle">{t('options.payload.camera_only')}</span>;
  return (
    <span className="inline-flex items-center gap-2 text-[13px]">
      <span className="font-medium">{t(`options.payload.${type}`)}</span>
      <span className="num text-ink-subtle">
        {capacity} {unit}
      </span>
      {remaining !== undefined && <span className="num font-semibold text-info">{Math.round(remaining)}%</span>}
    </span>
  );
}

export function LiveDot({ tone = 'ok', label }: { tone?: Tone; label?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold', toneText[tone])}>
      <span className={cx('pulse-dot size-2 rounded-full', toneDot[tone])} aria-hidden />
      {label}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Timeline
// -----------------------------------------------------------------------------
const eventTone = (kind: string): Tone =>
  kind.includes('aborted') || kind.includes('released') ? 'crit'
  : kind.includes('verified') || kind.includes('resolved') || kind.includes('confirmed') ? 'ok'
  : kind.startsWith('mission') ? 'info'
  : kind.startsWith('suppression') ? 'gold'
  : 'neutral';

export function IncidentTimeline({ items }: { items: TimelineEntry[] }) {
  const { t, fmtDateTime } = useI18n();
  return (
    <ol className="relative space-y-0">
      {items.map((e, i) => {
        const tone = eventTone(e.kind);
        const label = t(`incidents.events.${e.kind}`) === `incidents.events.${e.kind}` ? e.kind.replace(/[._]/g, ' ') : t(`incidents.events.${e.kind}`);
        return (
          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < items.length - 1 && <span className="absolute start-[7px] top-5 h-[calc(100%-12px)] w-px bg-line" aria-hidden />}
            <span className={cx('relative mt-1 size-[15px] shrink-0 rounded-full border-[3px] border-surface ring-1 ring-line', toneDot[tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink">{label}</p>
              <p className="text-[12px] text-ink-subtle">
                <time className="num" dateTime={e.at}>{fmtDateTime(e.at)}</time>
                {e.actor && <> · {e.actor}</>}
              </p>
              {typeof e.detail?.resolution === 'string' && <p className="mt-1 text-[12px] text-ink-muted">{e.detail.resolution}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function SectionTitle({ children, actions, icon: Icon }: { children: ReactNode; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-ink-subtle">
        {Icon && <Icon className="size-4" aria-hidden />}
        {children}
      </h3>
      {actions}
    </div>
  );
}

export function Coords({ lat, lng }: { lat: number; lng: number }) {
  return (
    <span className="num inline-flex items-center gap-1 text-[13px]" dir="ltr">
      <MapPin className="size-3.5 text-ink-subtle" aria-hidden />
      {lat.toFixed(5)}, {lng.toFixed(5)}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin', className)} aria-hidden />;
}

export { ChevronDown };
