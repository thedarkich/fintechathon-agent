import { Moon, Sun } from 'lucide-react'
import { useLang } from '../i18n'
import { useTextSize } from '../lib/textSize'
import { useTheme } from '../lib/theme'

/** 中文 / EN, both always visible so nobody has to guess that the page comes in two languages. */
export function LangSwitch({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const { lang, setLang } = useLang()
  const pad = size === 'lg' ? 'px-3 py-1.5' : 'px-2 py-1'
  return (
    <div role="group" aria-label="语言 Language" className="flex shrink-0 rounded-box bg-[var(--field)] p-0.5 text-sm font-semibold leading-none">
      {(
        [
          ['zh', '中文', '中'],
          ['en', 'EN', 'EN'],
        ] as const
      ).map(([code, full, short]) => (
        <button
          key={code}
          type="button"
          lang={code === 'zh' ? 'zh-CN' : 'en'}
          aria-label={code === 'zh' ? '中文' : 'English'}
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
          className={`${pad} rounded-box ${lang === code ? 'bg-paper text-ink shadow-[0_1px_3px_var(--shadow)]' : 'text-ink2 hover:text-ink'}`}
        >
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{full}</span>
        </button>
      ))}
    </div>
  )
}

/** Large text (大字版) on or off: the entry banks in China give older customers, always in the header. */
export function TextSizeSwitch() {
  const { tr } = useLang()
  const [size, setSize] = useTextSize()
  const large = size === 'large'
  const label = large ? tr('Standard text size', '标准字号') : tr('Large text', '大字版')
  return (
    <button
      type="button"
      onClick={() => setSize(large ? 'normal' : 'large')}
      aria-pressed={large}
      aria-label={tr('Large text', '大字版')}
      title={label}
      className={`inline-flex h-9 shrink-0 items-center justify-center rounded-box px-2 text-body font-bold ${large ? 'bg-[var(--action)] text-[var(--action-ink)]' : 'text-ink2 hover:bg-[var(--field)] hover:text-ink'}`}
    >
      {tr('A+', '大字')}
    </button>
  )
}

export function ThemeSwitch() {
  const { tr } = useLang()
  const [theme, setTheme] = useTheme()
  const dark = theme === 'dark'
  const label = dark ? tr('Light theme', '浅色模式') : tr('Dark theme', '深色模式')
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-box text-ink2 hover:bg-[var(--field)] hover:text-ink"
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  )
}
