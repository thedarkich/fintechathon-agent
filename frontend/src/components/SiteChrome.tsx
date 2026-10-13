import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { clearAdminToken, getAdminToken } from '../api/client'
import { isOperator, useAuth } from '../lib/auth'
import { useLang } from '../i18n'
import { BrandSeal } from './Seal'
import { LangSwitch, ThemeSwitch } from './Toggles'

export function SiteHeader({ workspace = false, status }: { workspace?: boolean; status?: string }) {
  const { tr, t } = useLang()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const queries = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signedIn = !!user || !!getAdminToken()
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
  const home = user ? '/assistant' : getAdminToken() ? '/operator' : '/login'
  const links = (workspace
    ? [['/assistant', tr('Assistant', '助手')], ['/accounts', tr('Accounts', '账户')], ['/transfers', tr('Transfers', '转账')], ['/bills', tr('Bills', '账单')], ['/wealth', tr('Wealth', '理财')], ['/controls', tr('Controls', '控制台')], ['/ledger', tr('Ledger', '账本')], ['/operator', tr('Operator', '客服')]]
    : [['/?section=workflow', tr('How it works', '工作流程')], ['/?section=stack', tr('Building blocks', '核心能力')], [home, tr('Workspace', '工作台')]]
  ).filter(([to]) => to !== '/operator' || isOperator(user)).filter(([to]) => !workspace || user || to === '/operator')
  return <header className="site-header">
    <div className="site-topbar">
      <Link to="/" className="site-brand" aria-label={tr('Bank Agent home', '银行代办首页')}><BrandSeal size={40} /><span>{t.brand_en}</span></Link>
      <div className="site-actions">
        <LangSwitch /><ThemeSwitch />
        {signedIn ? <>
          <span className="account-label" title={user?.email}>{user ? user.name : tr('Operator token', '工作人员令牌')}</span>
          {workspace ? <button type="button" className="site-button secondary" disabled={busy} onClick={() => void signOut()}>{busy ? tr('Signing out…', '正在退出…') : tr('Sign out', '退出登录')}</button>
            : <Link className="site-button" to={home}>{tr('Open workspace', '进入工作台')} <span aria-hidden>→</span></Link>}
        </> : <>
          <Link className="site-signin" to="/login">{tr('Sign in', '登录')}</Link>
          <Link className="site-button" to="/signup">{tr('Get started', '开始使用')} <span aria-hidden>→</span></Link>
        </>}
      </div>
    </div>
    <div className="site-subbar">
      <nav aria-label={tr('Main navigation', '主导航')}>
        {links.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => workspace && isActive ? 'is-active' : ''}>{label}</NavLink>)}
      </nav>
      {workspace && status && <span className="site-network"><span className="status-dot" />{status}</span>}
    </div>
    {error && <p className="site-error" role="alert">{error}</p>}
  </header>
}

export function SiteFooter() {
  const { tr, t } = useLang()
  return <footer className="site-footer"><Link className="site-brand" to="/"><BrandSeal size={36} /><span>{t.brand_en}</span></Link><span>© 2026 {t.brand_en} · {t.tagline}</span><Link to="/ledger">{tr('Open your ledger', '查看你的账本')} →</Link></footer>
}
