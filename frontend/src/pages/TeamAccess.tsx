import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { setAdminToken } from '../api/client'
import { useLang } from '../i18n'
import { SiteHeader, SiteFooter } from '../components/SiteChrome'

/** Operators open the console with the server's admin token, kept in this browser only. */
export default function TeamAccess() {
  const { tr } = useLang()
  useEffect(() => { document.title = tr('Central Union Bank · Operator access', '中联银行 · 工作人员访问') }, [tr])
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !token.trim()) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/operator/queue', { headers: { Authorization: `Bearer ${token.trim()}` }, cache: 'no-store', redirect: 'error' })
      if (response.status === 401 || response.status === 403) { setError(tr('Access token rejected. Check it with the bank’s administrator.', '访问令牌无效，请向管理员核对。')); return }
      if (!response.ok) throw new Error('Access unavailable')
      setAdminToken(token.trim()); setToken(''); navigate('/operator', { replace: true })
    } catch { setError(tr('Could not reach the operator console. Please try again.', '无法连接客服工作台，请稍后重试。')) }
    finally { setBusy(false) }
  }
  return <div className="public-site"><SiteHeader />
    <main className="auth-main" tabIndex={-1}>
      <div className="auth-intro"><p className="mono-label">{tr('Human takeover', '人工接管')}</p><h1>{tr('People can step in.', '人可以随时接手。')}<br /><span>{tr('They can’t approve for you.', '但不能替你确认。')}</span></h1><p>{tr('When a customer asks for a person, or a safety lock trips, the conversation lands here with its plans and its ledger.', '客户要求转人工，或触发安全锁时，会话会连同计划和账本一起转到这里。')}</p>
        <div className="auth-flow">{[[tr('Read the conversation', '查看会话'), tr('Messages, plans and the audit trail', '消息、计划与审计记录')], [tr('Reply or cancel', '回复或取消'), tr('Answer the customer, stop a waiting plan', '回复客户，停止等待中的计划')], [tr('Customer stays in charge', '客户掌控确认权'), tr('Approval and verification stay with the customer', '确认和验证始终由客户完成')]].map(([title, text], i) => <div className="auth-flow-row" key={title}><span>{i === 2 ? '✓' : i + 1}</span><div><strong>{title}</strong><p>{text}</p></div></div>)}</div>
      </div>
      <section className="auth-card" aria-labelledby="access-title"><p className="mono-label">{tr('Operator access', '工作人员访问')}</p><h2 id="access-title">{tr('Open the console.', '进入客服工作台。')}</h2><p className="auth-subtitle">{tr('Use the access token from the server configuration (ADMIN_TOKEN).', '使用服务器配置中的访问令牌（ADMIN_TOKEN）。')}</p>
        <form className="mt-7" onSubmit={submit}><label className="auth-field">{tr('Operator access token', '工作人员访问令牌')}<input type="password" required autoComplete="off" value={token} onChange={e => setToken(e.target.value)} spellCheck={false} /></label>
          {error && <p className="auth-message" role="alert">{error}</p>}
          <button className="site-button auth-submit" disabled={busy || !token.trim()}>{busy ? tr('Checking access…', '正在验证…') : tr('Open console', '进入工作台')} <span aria-hidden>→</span></button>
        </form><p className="auth-access-note">{tr('An operator account works too: sign in with it and open the Operator page.', '也可以用工作人员账户登录，然后打开“客服”页面。')}</p><Link className="auth-switch flex min-h-11 items-center justify-center" to="/login">{tr('Sign in with an account instead', '改用账户登录')} →</Link>
      </section>
    </main><SiteFooter /></div>
}
