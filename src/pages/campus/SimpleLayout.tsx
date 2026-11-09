import { Link, NavLink, Outlet } from 'react-router-dom';
import { Flame, Plane } from 'lucide-react';
import { useI18n } from '@/i18n';
import { LanguageSwitcher, LogoMark, Wordmark } from '@/components/domain';
import { cx } from '@/components/ui';

export function SimpleLayout() {
  const { t } = useI18n();
  const link = ({ isActive }: { isActive: boolean }) =>
    cx('inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] sm:px-3.5 font-semibold transition-colors duration-150', isActive ? 'bg-brand text-on-brand' : 'text-ink-muted hover:bg-surface-hover hover:text-ink');
  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <header className="sticky top-0 z-40 h-14 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-full max-w-[1500px] items-center gap-2.5 px-3 sm:px-5">
          <Link to="/" className="flex items-center gap-2.5 rounded-md" aria-label="ResQAir">
            <LogoMark className="size-9" />
            <span className="flex flex-col leading-none">
              <Wordmark className="text-[18px]" />
              <span className="mt-0.5 hidden text-[11px] text-ink-subtle sm:block">{t('brand.college')}</span>
            </span>
          </Link>
          <nav className="ms-auto flex items-center gap-1" aria-label="Main">
            <NavLink to="/" end className={link}><Flame className="size-4" aria-hidden /><span>{t('nav.report')}</span></NavLink>
            <NavLink to="/pilot" className={link}><Plane className="size-4" aria-hidden /><span>{t('nav.pilot')}</span></NavLink>
            <LanguageSwitcher />
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
