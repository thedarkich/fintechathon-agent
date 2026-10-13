import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { getAdminToken } from '../api/client'
import { useLang } from '../i18n'
import { authRequest, landingFor, useAuth, workspaceDestination } from '../lib/auth'
import { SiteHeader, SiteFooter } from '../components/SiteChrome'

const weakPin = (pin: string) => new Set(pin).size === 1 || '0123456789'.includes(pin) || '9876543210'.includes(pin)

export default function AuthPage({ register = false }: { register?: boolean }) {
  const { tr } = useLang()
  const { user, loading, error: sessionError, signedIn, refresh } = useAuth()
  const [params] = useSearchParams()
  const location = useLocation()
  const next = workspaceDestination(params.get('next'))
  const suffix = params.get('next') ? '?next=' + encodeURIComponent(next) : ''
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pin, setPin] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  useEffect(() => {
    setName(''); setEmail(''); setPassword(''); setConfirm(''); setPin(''); setErrors({}); setMessage(''); setVisible(false)
    document.title = (register ? tr('Create account', '创建账户') : tr('Sign in', '登录')) + ' · ' + tr('Bank Agent', '银行代办')
    window.scrollTo(0, 0)
  }, [register, location.pathname, tr])
  if (user) return <Navigate to={landingFor(user, next)} replace />
  if (getAdminToken() && !user && !loading) return <Navigate to="/operator" replace />
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const invalid: Record<string, string> = {}
    if (register && (name.trim().length < 2 || name.trim().length > 60)) invalid.name = tr('Use 2–60 characters for your name.', '姓名需为 2–60 个字符。')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) invalid.email = tr('Enter a valid email address.', '请输入有效的邮箱地址。')
    if (password.length < 10 || password.length > 128) invalid.password = tr('Use 10–128 characters.', '密码需为 10–128 个字符。')
    if (register && password !== confirm) invalid.confirm = tr('Your passwords do not match.', '两次输入的密码不一致。')
    if (register && (!/^\d{6}$/.test(pin) || weakPin(pin))) invalid.pin = tr('Use 6 digits that are not repeated or sequential.', '请使用 6 位数字，不能是重复或连续数字。')
    setErrors(invalid); setMessage('')
    if (Object.keys(invalid).length) { document.getElementById(Object.keys(invalid)[0])?.focus(); return }
    setBusy(true)
    try {
      const body: Record<string, string> = register ? { name: name.trim(), email: email.trim(), password, pin } : { email: email.trim(), password }
      const { response, result } = await authRequest(register ? '/api/register' : '/api/login', body)
      if (response.ok && result.user) { setPassword(''); setConfirm(''); setPin(''); signedIn(result.user); return }
      const messages: Record<number, string> = {
        401: tr('Email or password is incorrect.', '邮箱或密码不正确。'),
        403: tr('Refresh this page and try again.', '请刷新页面后重试。'),
        409: tr('This email already has an account. Sign in instead.', '该邮箱已注册，请直接登录。'),
        422: result.message_en ? tr(result.message_en, result.message_zh ?? result.message_en) : tr('Check your name, email, password and PIN.', '请检查姓名、邮箱、密码和交易密码。'),
        429: tr('Too many attempts. Please retry in 15 minutes.', '尝试过于频繁，请在 15 分钟后重试。'),
        503: tr('Accounts are temporarily unavailable.', '账户服务暂不可用。'),
      }
      setMessage(messages[response.status] ?? tr('Unable to sign in. Please retry.', '暂时无法登录，请重试。'))
    } catch { setMessage(tr('Could not reach the server. Please retry.', '无法连接登录服务，请重试。')) }
    finally { setBusy(false) }
  }
  const fieldError = (key: string) => errors[key] && <p id={key + '-error'} className="auth-field-error">{errors[key]}</p>
  return <div className="public-site"><SiteHeader />
    <main className="auth-main" tabIndex={-1}>
      <div className="auth-intro"><p className="mono-label">// {tr('SAY IT ONCE. THE RULES DECIDE.', '说一句话，规则来把关。')}</p><h1>{tr('AI plans the request.', 'AI 拆解请求。')}<br /><span>{tr('The bank’s rules call the shots.', '规则拍板。')}</span></h1><p>{tr('The AI turns what you say into steps. Fixed rules decide which run at once, which need your confirmation and which need your PIN and a code.', 'AI 把你的话拆成步骤，固定规则决定哪些直接办、哪些要你确认、哪些要交易密码和验证码。')}</p>
        <div className="auth-flow"><div className="mono-label">{tr('THE REQUEST WORKFLOW', '办理流程')}</div>{[
          [tr('You ask', '你提出需求'), tr('In Chinese or English, by text, voice or receipt photo', '中文或英文，文字、语音或小票照片')],
          [tr('Rules check', '规则检查'), tr('Tiers, the ¥1,000 daily total and safety locks', '分级规则、¥1,000 当日累计与安全锁')],
          [tr('You approve', '你来确认'), tr('A tap for small things, PIN and a code for large ones', '小事点一下，大事要交易密码和验证码')],
        ].map(([title, text], i) => <div className="auth-flow-row" key={title}><span>{i === 2 ? '✓' : '0' + (i + 1)}</span><div><strong>{title}</strong><p>{text}</p></div></div>)}</div>
        <p className="auth-local-note">{tr('Your simulated bank is private to your account · No real money moves', '你的模拟银行仅本账户可见 · 不涉及真实资金')}</p>
      </div>
      <section className="auth-card" aria-labelledby="auth-title"><p className="mono-label">{tr('LET’S GET YOU STARTED', '从这里开始')}</p><h2 id="auth-title">{register ? tr('Your bank starts here.', '开通你的银行。') : tr('Welcome back.', '欢迎回来。')}</h2><p className="auth-subtitle">{register ? tr('You get your own simulated bank with two years of history.', '系统会为你生成独立的模拟银行，含近两年的交易记录。') : tr('Sign in to your bank.', '登录你的银行。')}</p>
        <nav className="auth-tabs" aria-label={tr('Account access mode', '账户访问方式')}><Link to={'/login' + suffix} aria-current={!register ? 'page' : undefined} className={!register ? 'is-active' : ''}>{tr('Sign in', '登录')}</Link><Link to={'/signup' + suffix} aria-current={register ? 'page' : undefined} className={register ? 'is-active' : ''}>{tr('Create account', '创建账户')}</Link></nav>
        <form onSubmit={submit} noValidate aria-busy={busy}>
          <fieldset disabled={busy || loading}>
            {register && <label className="auth-field" htmlFor="name">{tr('Full name', '姓名')}<input id="name" autoComplete="name" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder={tr('Your name', '你的姓名')} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-error' : undefined} />{fieldError('name')}</label>}
            <label className="auth-field" htmlFor="email">{tr('Email address', '邮箱地址')}<input id="email" type="email" autoComplete="username" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} />{fieldError('email')}</label>
            <div className="auth-field"><div className="auth-label-row"><label htmlFor="password">{tr('Password', '密码')}</label><span>{tr('10 characters minimum', '至少 10 个字符')}</span></div><div className="auth-password"><input id="password" type={visible ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={tr('Enter your password', '输入密码')} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined} /><button type="button" aria-label={visible ? tr('Hide password', '隐藏密码') : tr('Show password', '显示密码')} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{fieldError('password')}</div>
            {register && <label className="auth-field" htmlFor="confirm">{tr('Confirm password', '确认密码')}<input id="confirm" type="password" autoComplete="new-password" maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={tr('Enter your password again', '再次输入密码')} aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? 'confirm-error' : undefined} />{fieldError('confirm')}</label>}
            {register && <div className="auth-field"><div className="auth-label-row"><label htmlFor="pin">{tr('Transaction PIN', '交易密码')}</label><span>{tr('6 digits, for high-risk actions', '6 位数字，用于高风险操作')}</span></div><input id="pin" className="num tracking-[0.4em]" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" aria-invalid={!!errors.pin} aria-describedby={errors.pin ? 'pin-error' : undefined} />{fieldError('pin')}</div>}
            {message && <p className="auth-message" role="alert">{message}</p>}
            <button type="submit" className="site-button auth-submit">{busy ? tr('Please wait…', '请稍候…') : register ? tr('Create account', '创建账户') : tr('Sign in', '登录')} <span aria-hidden>→</span></button>
          </fieldset>
        </form>
        {sessionError && <p className="auth-message" role="alert">{sessionError} <button type="button" onClick={() => void refresh()}>{tr('Retry', '重试')}</button></p>}
        <p className="auth-switch">{register ? tr('Already have an account?', '已经有账户？') : tr('New here?', '第一次使用？')} <Link to={(register ? '/login' : '/signup') + suffix}>{register ? tr('Sign in', '登录') : tr('Create an account', '创建账户')}</Link></p>
        <p className="auth-switch">{tr('Bank operator?', '银行工作人员？')} <Link to="/team-token">{tr('Use an operator token', '使用工作人员令牌')}</Link></p>
        <div className="auth-access-note"><LockKeyhole size={18} /><p>{tr('This signs you in to your bank.', '这是你的银行登录。')}<br />{tr('Large payments still need your PIN and a code.', '大额操作仍需交易密码和验证码。')}</p></div>
      </section>
    </main><SiteFooter />
  </div>
}
