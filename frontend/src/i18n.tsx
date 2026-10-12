import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'zh' | 'en'
type Ctx = { lang: Lang; setLang: (l: Lang) => void; tr: (en: string, zh: string) => string }
const LangContext = createContext<Ctx | null>(null)
const KEY = 'ba_lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* storage blocked */
  }
  const nav = (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase()
  return nav.startsWith('en') ? 'en' : 'zh'
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])
  const value = useMemo<Ctx>(() => ({
    lang,
    setLang: (l: Lang) => {
      setLangState(l)
      try { localStorage.setItem(KEY, l) } catch { /* storage blocked */ }
    },
    tr: (en, zh) => (lang === 'zh' ? zh : en),
  }), [lang])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): Ctx {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang outside LangProvider')
  return ctx
}
