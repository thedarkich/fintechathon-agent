import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { clearAdminToken, getAdminToken } from '../api/client'
import { isOperator, useAuth } from '../lib/auth'
import { useLang } from '../i18n'
import { BrandSeal } from './Seal'
import { LangSwitch, ThemeSwitch } from './Toggles'

// screens opened from the home grid: the Home tab stays lit while they are open
const HOME_SERVICES = /^\/(send|payments|qr)$/

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

/** The pages of the signed-in app, in menu order. */
export function useWorkspaceLinks(): [string, string][] {
  const { tr } = useLang()
  const { user } = useAuth()
  return ([
    ['/home', tr('Home', '首页')], ['/assistant', tr('Assistant', '助手')], ['/accounts', tr('Accounts', '账户与转账')],
    ['/bills', tr('Spending', '账单')], ['/wealth', tr('Invest', '理财')], ['/controls', tr('Cards', '卡片与安全')],
    ['/ledger', tr('History', '记录')], ['/operator', tr('Staff', '客服')],
  ] as [string, string][]).filter(([to]) => to !== '/operator' || isOperator(user))
}

/**
 * The header: a white bar that stays at the top, the logo on the left across two rows,
 * small links and the account controls above, the main menu below.
 */
export function SiteHeader({ workspace = false, status }: { workspace?: boolean; status?: string }) {
  const { tr, t } = useLang()
  const { user } = useAuth()
  const { signOut, busy, error } = useSignOut()
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
  // on a phone the public menu scrolls sideways; keep the current page's link in view
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
    : [['/?section=features', tr('What it does', '能做什么')], ['/?section=calc', tr('Check a payment', '算一算')], ['/?section=ask', tr('Just say it', '直接说')], ['/how', tr('How it stays safe', '安全原理')]]
  const minor: [string, string][] = [['/', tr('Personal', '个人客户')], ['/team-token', tr('Bank staff', '工作人员')], ['/how', tr('About this demo', '关于本演示')]]

  return <header className={`site-header ${workspace ? 'is-workspace' : ''} ${scrolled ? 'is-scrolled' : ''}`}>
    <div className="site-header-inner">
      <Link to={workspace && user ? '/home' : '/'} className="site-brand" aria-label={tr('Bank Agent home', '银行代办首页')}><BrandSeal size={40} /><span>{tr(t.brand_en, t.brand)}</span></Link>
      <div className="site-rows">
        <div className="site-toprow">
          {workspace
            ? <p className="site-network">{status && <><span className="status-dot" />{status}</>}<Link to="/how" className="site-minor-link">{tr('How it stays safe', '安全原理')}</Link></p>
            : <nav className="site-minor" aria-label={tr('Sections', '栏目')}>{minor.map(([to, label], i) => <Link key={label} to={to} className={i === 0 ? 'is-current' : ''}>{label}</Link>)}</nav>}
          <div className="site-actions">
            <LangSwitch /><ThemeSwitch />
            {signedIn ? <>
              <span className="account-pill" title={user?.email}>{user ? (user.demo ? tr(`${user.name} · demo`, `${user.name} · 演示`) : user.name) : tr('Operator token', '工作人员令牌')}</span>
              {workspace ? <button type="button" className="site-signout" disabled={busy} onClick={() => void signOut()}>{busy ? tr('Signing out…', '正在退出…') : tr('Sign out', '退出')}</button>
                : <Link className="site-pill" to={home}><span className="pill-long">{tr('Open the app', '进入银行')}</span><span className="pill-short">{tr('Open', '进入')}</span></Link>}
            </> : <Link className="site-pill" to="/login">{tr('Sign in', '登录')}</Link>}
          </div>
        </div>
        <nav ref={nav} className="site-mainnav" aria-label={tr('Main navigation', '主导航')}>
          {links.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => (workspace || to === '/how') && (isActive || (to === '/home' && HOME_SERVICES.test(pathname))) ? 'is-active' : ''}>{label}</NavLink>)}
        </nav>
      </div>
    </div>
    {error && <p className="site-error" role="alert">{error}</p>}
  </header>
}

/** A grey band at the bottom of every page: where to learn more, and what this site is. */
export function SiteFooter() {
  const { tr, t } = useLang()
  return <footer className="site-footer">
    <div className="site-footer-inner">
      <div className="site-footer-main">
        <nav aria-label={tr('More', '更多')}>
          <Link to="/how">{tr('How it stays safe', '安全原理')}</Link>
          <Link to="/?section=features">{tr('What it does', '能做什么')}</Link>
          <Link to="/team-token">{tr('Bank staff', '工作人员入口')}</Link>
        </nav>
        <p>{tr('A simulated bank built for a competition. No real money moves, and no real bank is connected.', '参赛用的模拟银行，不涉及真实资金，也没有连接任何真实银行。')}</p>
        <p>{tr('Answers are written by the bank’s own code from your records; the AI only reads what you asked. Check the confirm card before any money moves.', '回答由银行程序根据你的记录生成，AI 只负责理解你的话。动钱之前，请核对确认卡片。')}</p>
      </div>
      <div className="site-footer-side">
        <Link className="site-brand" to="/"><BrandSeal size={32} /><span>{tr(t.brand_en, t.brand)}</span></Link>
        <p>{tr('Works in any phone browser, WeChat’s included.', '手机浏览器即可使用，微信里也能打开。')}</p>
        <p>© 2026 {tr(t.brand_en, t.brand)} · {t.tagline}</p>
      </div>
    </div>
  </footer>
}
