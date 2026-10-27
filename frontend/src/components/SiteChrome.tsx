import { useEffect, useRef, useState, type RefObject } from 'react'
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

/** True while the floating header sits over a field of night sky (anything marked data-surface="dark"),
 *  so it can turn to dark glass there and back to light glass over the cream. */
function useOverDark(bar: RefObject<HTMLElement>, key: string) {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    let frame = 0
    const check = () => {
      frame = 0
      const el = bar.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const under = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).find((n) => !el.contains(n))
      setDark(!!under?.closest('[data-surface="dark"]'))
    }
    const later = () => { if (!frame) frame = requestAnimationFrame(check) }
    check()
    window.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', later)
    return () => { window.removeEventListener('scroll', later); window.removeEventListener('resize', later); cancelAnimationFrame(frame) }
  }, [bar, key])
  return dark
}

/**
 * The header: floating glass over the page. The logo on the left; signed in, the app's pages in a pill;
 * on the right a pill with the language, the theme and the account (Log in and Sign up when signed out).
 */
export function SiteHeader({ workspace = false, status }: { workspace?: boolean; status?: string }) {
  const { tr, t } = useLang()
  const { user } = useAuth()
  const { signOut, busy, error } = useSignOut()
  const workspaceLinks = useWorkspaceLinks()
  const bar = useRef<HTMLElement>(null)
  const nav = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  const overDark = useOverDark(bar, pathname)
  // on a narrow screen the app's menu scrolls sideways; keep the current page's link in view
  useEffect(() => {
    const show = () => {
      const box = nav.current?.getBoundingClientRect()
      const link = nav.current?.querySelector('.is-active')?.getBoundingClientRect()
      if (nav.current && box && link) nav.current.scrollLeft += link.left + link.width / 2 - (box.left + box.width / 2)
    }
    show()
    const watcher = new ResizeObserver(show)
    if (nav.current) watcher.observe(nav.current)
    return () => watcher.disconnect()
  }, [pathname, workspace, user?.id])
  const signedIn = !!user || !!getAdminToken()
  const home = user ? '/home' : getAdminToken() ? '/operator' : '/login'
  const links = workspace ? workspaceLinks.filter(([to]) => user || to === '/operator') : []

  return <header ref={bar} className={`site-header ${workspace ? 'is-workspace' : ''} ${overDark ? 'is-over-dark' : ''}`}>
    <div className="site-header-inner">
      <Link to={workspace && user ? '/home' : '/'} className="site-brand site-glass" aria-label={tr('Bank Agent home', '银行代办首页')}><BrandSeal size={30} /><span>{tr(t.brand_en, t.brand)}</span></Link>
      {links.length > 0 && <nav ref={nav} className="site-mainnav site-glass" aria-label={tr('Main navigation', '主导航')}>
        {links.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => isActive || (to === '/home' && HOME_SERVICES.test(pathname)) ? 'is-active' : ''}>{label}</NavLink>)}
      </nav>}
      <div className="site-actions site-glass">
        {workspace && status && <span className="site-network">{status}</span>}
        <LangSwitch /><ThemeSwitch />
        {signedIn ? <>
          <span className="account-pill" title={user?.email}>{user ? (user.demo ? tr(`${user.name} · demo`, `${user.name} · 演示`) : user.name) : tr('Operator token', '工作人员令牌')}</span>
          {workspace ? <button type="button" className="site-signout" disabled={busy} onClick={() => void signOut()}>{busy ? tr('Signing out…', '正在退出…') : tr('Sign out', '退出')}</button>
            : <Link className="site-pill" to={home}><span className="pill-long">{tr('Open the app', '进入银行')}</span><span className="pill-short">{tr('Open', '进入')}</span></Link>}
        </> : <>
          <Link className="site-login" to="/login">{tr('Log in', '登录')}</Link>
          <Link className="site-pill" to="/signup">{tr('Sign up', '注册')}</Link>
        </>}
      </div>
    </div>
    {error && <p className="site-error" role="alert">{error}</p>}
  </header>
}

/** The close of every page: a sand-coloured card with the promise and the links, the name at full width,
 *  and the small print. `credits` lists the photographs a page shows, as their licences require. */
export function SiteFooter({ credits }: { credits?: string }) {
  const { tr, t } = useLang()
  const name = tr(t.brand_en, t.brand)
  return <footer className="site-footer">
    <div className="site-footer-card">
      <div className="site-footer-lead">
        <h2>{tr('Say it once.', '你说一句，')}<br />{tr('We do it.', '我来办。')}</h2>
        <p>{tr('Answers are written by the bank’s own code from your records; the AI only reads what you asked. Check the confirm card before any money moves.', '回答由银行程序根据你的记录生成，AI 只负责理解你的话。动钱之前，请核对确认卡片。')}</p>
      </div>
      <nav aria-label={tr('About the bank', '了解银行')}>
        <Link to="/?section=features">{tr('What it does', '能做什么')}</Link>
        <Link to="/?section=steps">{tr('How it works', '怎么办')}</Link>
        <Link to="/?section=check">{tr('Check a payment', '算一算')}</Link>
        <Link to="/how">{tr('How it stays safe', '安全原理')}</Link>
      </nav>
      <nav aria-label={tr('Your account', '你的账户')}>
        <Link to="/login">{tr('Log in', '登录')}</Link>
        <Link to="/signup">{tr('Sign up', '注册')}</Link>
        <Link to="/team-token">{tr('Bank staff', '工作人员入口')}</Link>
      </nav>
    </div>
    <p className="site-wordmark" aria-hidden>{[...name].map((ch, k) => <span key={k} style={{ ['--k' as string]: k }}>{ch === ' ' ? ' ' : ch}</span>)}</p>
    <div className="site-footer-notes">
      <p>{tr('A simulated bank built for a competition. No real money moves, and no real bank is connected.', '参赛用的模拟银行，不涉及真实资金，也没有连接任何真实银行。')} {tr('Works in any phone browser, WeChat’s included.', '手机浏览器即可使用，微信里也能打开。')}</p>
      <p>© 2026 {name} · {t.tagline}</p>
      {credits && <p className="site-credits">{credits}</p>}
    </div>
  </footer>
}
