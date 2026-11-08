import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import ar from './ar';
import en from './en';

export type Lang = 'ar' | 'en';
const dicts = { ar, en } as const;

function lookup(obj: unknown, path: string): unknown {
  // Keys may themselves contain dots (e.g. "report.new"), so try the longest matching key first.
  let cur: any = obj;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    let found = false;
    for (let j = parts.length; j > i; j--) {
      const key = parts.slice(i, j).join('.');
      if (key in cur) {
        cur = cur[key];
        i = j - 1;
        found = true;
        break;
      }
    }
    if (!found) return undefined;
  }
  return cur;
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

interface I18n {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  setLang: (l: Lang) => void;
  t: TFn;
  /** Locale for Intl formatting. Arabic uses Latin digits for operational consistency. */
  locale: string;
  fmtDateTime: (iso: string | null | undefined) => string;
  fmtTime: (iso: string | null | undefined, seconds?: boolean) => string;
  fmtDate: (iso: string | null | undefined) => string;
  fmtRel: (iso: string | null | undefined) => string;
  fmtNum: (n: number | null | undefined, digits?: number) => string;
}

const Ctx = createContext<I18n | null>(null);

const initialLang = (): Lang => {
  try {
    const s = localStorage.getItem('fg.lang');
    if (s === 'en' || s === 'ar') return s;
  } catch {
    /* storage unavailable */
  }
  return 'ar';
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    try {
      localStorage.setItem('fg.lang', lang);
    } catch {
      /* ignore */
    }
  }, [lang, dir]);

  const t = useCallback<TFn>(
    (key, vars) => {
      let v = lookup(dicts[lang], key);
      if (typeof v !== 'string') v = lookup(dicts.en, key);
      let s = typeof v === 'string' ? v : key;
      if (vars) for (const [k, val] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(val));
      return s;
    },
    [lang],
  );

  const value = useMemo<I18n>(() => {
    const locale = lang === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB';
    const dt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' });
    const tm = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Muscat' });
    const tms = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Muscat' });
    const d = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Asia/Muscat' });
    const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    return {
      lang,
      dir,
      setLang: setLangState,
      t,
      locale,
      fmtDateTime: (iso) => (iso ? dt.format(new Date(iso)) : '—'),
      fmtTime: (iso, seconds) => (iso ? (seconds ? tms : tm).format(new Date(iso)) : '—'),
      fmtDate: (iso) => (iso ? d.format(new Date(iso)) : '—'),
      fmtRel: (iso) => {
        if (!iso) return '—';
        const s = (new Date(iso).getTime() - Date.now()) / 1000;
        const a = Math.abs(s);
        if (a < 45) return t('common.justNow');
        if (a < 3600) return rel.format(Math.round(s / 60), 'minute');
        if (a < 86400) return rel.format(Math.round(s / 3600), 'hour');
        return rel.format(Math.round(s / 86400), 'day');
      },
      fmtNum: (n, digits = 0) =>
        n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }),
    };
  }, [lang, dir, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useI18n outside provider');
  return c;
}
