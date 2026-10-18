import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useLang } from '../i18n'
import { Icon, type IconName } from './Icon'
import { useSignOut, useWorkspaceLinks } from './SiteChrome'

/** On a phone the menu sits at the bottom, under the thumb: four places and a More sheet with the rest. */
const TABS: [string, IconName, string, string][] = [
  ['/home', 'home', 'Home', '首页'],
  ['/send', 'send', 'Transfers', '转账'],
  ['/bills', 'chart', 'Spending', '账单'],
  ['/assistant', 'chat', 'Assistant', '助手'],
]

export function TabBar() {
  const { tr } = useLang()
  const { pathname } = useLocation()
  const pages = useWorkspaceLinks()
  const { signOut, busy, error } = useSignOut()
  const [open, setOpen] = useState(false)
  const first = useRef<HTMLAnchorElement>(null)
  const rest = [...pages.filter(([to]) => !TABS.some(([t]) => t === to)), ['/how', tr('How it stays safe', '安全原理')]] as [string, string][]
  const inMore = rest.some(([to]) => to === pathname)

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    first.current?.focus()
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [open])

  return <>
    <nav className="tabbar" aria-label={tr('Main navigation', '主导航')}>
      {TABS.map(([to, icon, en, zh]) => (
        <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'is-active' : ''}>
          <Icon name={icon} size={22} /><span>{tr(en, zh)}</span>
        </NavLink>
      ))}
      <button type="button" onClick={() => setOpen(true)} className={inMore ? 'is-active' : ''} aria-expanded={open} aria-haspopup="dialog">
        <Menu size={22} aria-hidden /><span>{tr('More', '更多')}</span>
      </button>
    </nav>
    {open && <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={tr('All pages', '全部页面')} className="sheet-up fixed inset-x-0 bottom-0 z-50 rounded-t-panel bg-paper px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_40px_var(--shadow)]">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-lg font-bold">{tr('All pages', '全部页面')}</p>
          <button type="button" onClick={() => setOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--field)]" aria-label={tr('Close', '关闭')}><X size={18} /></button>
        </div>
        <ul className="divide-y divide-[var(--rule)] ruled">
          {rest.map(([to, label], i) => (
            <li key={to}><Link ref={i === 0 ? first : undefined} to={to} aria-current={to === pathname ? 'page' : undefined}
              className={`flex items-center justify-between px-4 py-3.5 text-[1rem] ${to === pathname ? 'font-semibold text-[var(--action)]' : ''}`}>{label}<span aria-hidden className="text-ink2">›</span></Link></li>
          ))}
        </ul>
        <button type="button" className="btn btn-line mt-3 w-full py-3" disabled={busy} onClick={() => void signOut()}>{busy ? tr('Signing out…', '正在退出…') : tr('Sign out', '退出登录')}</button>
        {error && <p role="alert" className="mt-2 text-sm text-cinnabar">{error}</p>}
      </div>
    </>}
  </>
}
