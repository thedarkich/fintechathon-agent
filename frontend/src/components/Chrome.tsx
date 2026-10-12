import { Moon, Sun } from 'lucide-react'
import { useLang } from '../i18n'
import { useTheme } from '../lib/theme'
import type { Tier } from '../lib/api'

/** The mark: a counter slip with its tier ribbon. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--indigo)" />
      <rect x="8" y="7" width="17" height="19" rx="2.5" fill="var(--sheet)" />
      <rect x="8" y="7" width="4" height="19" rx="1.5" fill="var(--jade)" />
      <rect x="14.5" y="12" width="7.5" height="2" rx="1" fill="var(--indigo)" />
      <rect x="14.5" y="17" width="5" height="2" rx="1" fill="var(--ink-3)" />
    </svg>
  )
}

export function LangSwitch() {
  const { lang, setLang } = useLang()
  return (
    <div role="group" aria-label="语言 Language" className="flex overflow-hidden rounded-lg border border-rule text-xs font-semibold">
      {([['zh', '中文'], ['en', 'EN']] as const).map(([code, label]) => (
        <button key={code} type="button" lang={code === 'zh' ? 'zh-CN' : 'en'} aria-pressed={lang === code} onClick={() => setLang(code)}
          className={`px-2.5 py-1 ${lang === code ? 'bg-ink text-sheet' : 'text-ink2 hover:text-ink'}`}>{label}</button>
      ))}
    </div>
  )
}

export function ThemeSwitch() {
  const { tr } = useLang()
  const [theme, setTheme] = useTheme()
  const dark = theme === 'dark'
  return (
    <button type="button" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? tr('Light theme', '浅色模式') : tr('Dark theme', '深色模式')}
      className="rounded-lg border border-rule p-1.5 text-ink2 hover:text-ink">
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}

export function TierChip({ tier }: { tier: Tier | null | undefined }) {
  const { tr } = useLang()
  if (!tier) return null
  const label = { green: tr('Automatic', '自动执行'), yellow: tr('Confirm', '需确认'), red: tr('Strong check', '强验证') }[tier]
  return <span className={`tier-chip tier-${tier}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{label}</span>
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-rule px-4 py-6 text-center text-sm text-ink2">{children}</p>
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
