import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { clearAdminToken, getAdminToken } from '../api/client'
import { isOperator, useAuth } from '../lib/auth'
import { useLang } from '../i18n'
import { BrandSeal } from './Seal'
import { LangSwitch, TextSizeSwitch, ThemeSwitch } from './Toggles'

/** Signing out from the header or from the phone's More sheet. */
export function useSignOut() {
  const { tr } = useLang()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const queries = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function signOut() {
    setBusy(true); setError('')
    try {
      if (user) await logout()
      clearAdminToken()
      queries.clear()
      navigate('/login', { replace: true })
    } catch { setError(tr('Could not sign out. Please retry.', '退出未完成，请重试。')) }
    finally { setBusy(false) }
  }
  return { signOut, busy, error }
}

/** The pages of the signed-in app, in menu order: Home, the brief's five scenario pages, the assistant, the record. */
export function useWorkspaceLinks(): [string, string][] {
  const { tr } = useLang()
  const { user } = useAuth()
  return ([
    ['/home', tr('Home', '首页')], ['/send', tr('Transfers', '转账')], ['/bills', tr('Spending', '账单')],
    ['/wealth', tr('Invest', '理财')], ['/controls', tr('Cards', '卡片')], ['/subscriptions', tr('Subscriptions', '自动续费')],
    ['/assistant', tr('Assistant', '助手')], ['/ledger', tr('History', '记录')], ['/operator', tr('Staff', '客服')],
  ] as [string, string][]).filter(([to]) => to !== '/operator' || isOperator(user))
}

/** The signed-in person's name; opens what belongs to the account: the bank's time, how it stays safe, sign out. */
function AccountMenu({ status }: { status?: string }) {
  const { tr } = useLang()
  const { user } = useAuth()
  const { signOut, busy } = useSignOut()
  const menu = useRef<HTMLDetailsElement>(null)
  const { pathname } = useLocation()
  useEffect(() => { if (menu.current) menu.current.open = false }, [pathname])
  useEffect(() => {
    const away = (e: MouseEvent) => { if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])
  const name = user ? user.name : tr('Operator token', '工作人员令牌')
  return (
    <details ref={menu} className="account-menu">
      <summary aria-label={tr(`Account: ${name}`, `账户：${name}`)}>
        <span className="account-avatar" aria-hidden>{(user?.name ?? '?').slice(0, 1)}</span>
        <span className="account-name">{name}</span>
        {user?.demo && <span className="account-demo">{tr('demo', '演示')}</span>}
        <ChevronDown size={15} aria-hidden />
      </summary>
      <div className="account-menu-pop">
        {user?.email && <p className="truncate text-sm text-ink2">{user.email}</p>}
        {status && <p className="mt-1 text-xs text-ink2">{status}</p>}
        <Link to="/how" className="account-menu-item">{tr('How it stays safe', '安全原理')}</Link>
        <button type="button" className="account-menu-item" disabled={busy} onClick={() => void signOut()}>{busy ? tr('Signing out…', '正在退出…') : tr('Sign out', '退出登录')}</button>
      </div>
    </details>
  )
}

/**
 * The header: one white row that stays at the top, the same on the public site and in the app.
 * Logo and name, the pages, then large text, language and theme, and the account (or a sign-in button).
 */
export function SiteHeader({ workspace = false, status, extra }: { workspace?: boolean; status?: string; extra?: ReactNode }) {
  const { tr, t } = useLang()
  const { user } = useAuth()
  const { error } = useSignOut()
  const workspaceLinks = useWorkspaceLinks()
  const nav = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  // when the menu is wider than the screen it scrolls sideways; keep the current page's link in view
  useEffect(() => {
    const show = () => {
      const bar = nav.current?.getBoundingClientRect()
      const link = nav.current?.querySelector('.is-active')?.getBoundingClientRect()
      if (nav.current && bar && link) nav.current.scrollLeft += link.left + link.width / 2 - (bar.left + bar.width / 2)
    }
    show()
    const watcher = new ResizeObserver(show)
    if (nav.current) watcher.observe(nav.current)
    return () => watcher.disconnect()
  }, [pathname, workspace, user?.id])
  const signedIn = !!user || !!getAdminToken()
  const home = user ? '/home' : getAdminToken() ? '/operator' : '/login'
  const links: [string, string][] = workspace
    ? workspaceLinks.filter(([to]) => user || to === '/operator')
    : [['/?section=scenarios', tr('What it does', '能做什么')], ['/how', tr('How it stays safe', '安全原理')]]

  return <header className={`site-header ${workspace ? 'is-workspace' : 'is-public'} ${scrolled ? 'is-scrolled' : ''}`}>
    <div className="site-header-inner">
      <Link to={workspace && user ? '/home' : '/'} className="site-brand" aria-label={tr('Bank Agent home', '银行代办首页')}><BrandSeal size={36} /><span>{tr(t.brand_en, t.brand)}</span></Link>
      <nav ref={nav} className="site-mainnav" aria-label={tr('Main navigation', '主导航')}>
        {links.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => isActive && (workspace || to === '/how') ? 'is-active' : ''}>{label}</NavLink>)}
      </nav>
      <div className="site-actions">
        <TextSizeSwitch /><LangSwitch /><ThemeSwitch />
        {workspace ? <>
          {extra}
          {signedIn && <AccountMenu status={status} />}
        </> : signedIn
          ? <Link className="site-pill" to={home}><span className="pill-long">{tr('Open the app', '进入银行')}</span><span className="pill-short">{tr('Open', '进入')}</span></Link>
          : <Link className="site-pill" to="/login">{tr('Sign in', '登录')}</Link>}
      </div>
    </div>
    {error && <p className="site-error" role="alert">{error}</p>}
  </header>
}

/** The bottom of every page: a line of links, and what this site is. */
export function SiteFooter() {
  const { tr } = useLang()
  return <footer className="site-footer">
    <div className="site-footer-inner">
      <nav aria-label={tr('More', '更多')}>
        <Link to="/how">{tr('How it stays safe', '安全原理')}</Link>
        <Link to="/?section=scenarios">{tr('What it does', '能做什么')}</Link>
        <Link to="/team-token">{tr('Bank staff', '工作人员入口')}</Link>
      </nav>
      <p>{tr('A simulated bank built for a competition: no real money moves and no real bank is connected. Check the confirm card before any money moves.', '参赛用的模拟银行，不涉及真实资金，也没有连接任何真实银行。动钱之前，请核对确认卡片。')}</p>
    </div>
  </footer>
}
