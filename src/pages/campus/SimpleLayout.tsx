import { NavLink, Outlet } from 'react-router-dom';
import { Flame, Plane } from 'lucide-react';
import { useI18n } from '@/i18n';
import { LanguageSwitcher, LogoMark } from '@/components/domain';
import { cx } from '@/components/ui';

export function SimpleLayout() {
  const { t } = useI18n();
  const link = ({ isActive }: { isActive: boolean }) =>
    cx('inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[14px] font-semibold transition-colors', isActive ? 'bg-surface-selected text-brand' : 'text-ink-muted hover:bg-surface-hover hover:text-ink');
  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:px-5">
          <LogoMark className="size-8" />
          <span className="hidden text-[14px] font-bold text-ink sm:block">{t('campus.college')}</span>
          <nav className="ms-auto flex items-center gap-1">
            <NavLink to="/" end className={link}><Flame className="size-4" aria-hidden />{t('campus.reportTitle')}</NavLink>
            <NavLink to="/pilot" className={link}><Plane className="size-4" aria-hidden />{t('campus.pilot')}</NavLink>
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
