import { useId } from 'react';
import { Globe } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cx } from './ui';

/** ResQAir mark: quadcopter over a flame, gold on green. */
export function LogoMark({ className = 'size-9' }: { className?: string }) {
  // Unique gradient id per instance: a gradient inside a hidden SVG would not paint elsewhere.
  const gid = `rq-gold-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ecd393" />
          <stop offset="1" stopColor="#b8862a" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="#005041" />
      <g stroke={`url(#${gid})`} strokeWidth="1.8" fill="none" strokeLinecap="round">
        <path d="M13 13l5 4M27 13l-5 4M13 27l5-4M27 27l-5-4" />
        <circle cx="11" cy="11" r="3.6" />
        <circle cx="29" cy="11" r="3.6" />
        <circle cx="11" cy="29" r="3.6" />
        <circle cx="29" cy="29" r="3.6" />
      </g>
      <path d="M20.3 14.5c.4 2.2 3.3 3.3 3.3 6.5A3.6 3.6 0 0 1 20 24.6a3.6 3.6 0 0 1-3.6-3.5c0-1.6.9-2.6 1.7-3.2.1 1 .6 1.7 1.2 2-.4-2 .2-4 1-5.4z" fill="#e2362f" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('font-[Inter] font-extrabold tracking-tight text-ink', className)} dir="ltr">
      ResQ<span className="text-brand">Air</span>
    </span>
  );
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  const next = lang === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      lang={next}
      aria-label={`${t('common.language')}: ${next === 'en' ? 'English' : 'العربية'}`}
      className={cx('inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink', className)}
    >
      <Globe className="size-4" aria-hidden />
      <span className="hidden sm:inline">{next === 'en' ? 'English' : 'العربية'}</span>
    </button>
  );
}
