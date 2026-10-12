import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LangSwitch, Mark, ThemeSwitch, TierChip } from '../components/Chrome'
import { useLang } from '../i18n'
import { call, errorText } from '../lib/api'
import { useAuth, type User } from '../lib/auth'

function ExampleSlip() {
  const { tr } = useLang()
  return (
    <div className="space-y-3" aria-hidden="true">
      <p className="ml-auto w-fit rounded-2xl rounded-br-md bg-indigo px-4 py-2 text-[15px] text-[var(--indigo-ink)]">{tr('Send Mom 200', '给妈妈转200')}</p>
      <div className="slip tier-yellow">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-ink2">{tr('Transfer', '转账')}</span>
          <TierChip tier="yellow" />
        </div>
        <p className="num mt-1 text-3xl font-bold tracking-tight">¥200.00</p>
        <p className="mt-1 text-sm text-ink2">{tr('To Wang Xiuying (Mom), ICBC ****7801', '收款人 王秀英（妈妈）中国工商银行 ****7801')}</p>
        <div className="slip-perf flex items-center justify-between text-xs text-ink3">
          <span>{tr("Today's payments stay at or under ¥1,000", '当日累计付款不超过 ¥1,000')}</span>
          <span className="font-semibold text-indigo">{tr('Confirm', '确认执行')}</span>
        </div>
      </div>
      <div className="slip tier-red">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-ink2">{tr('Transfer', '转账')}</span>
          <TierChip tier="red" />
        </div>
        <p className="num mt-1 text-3xl font-bold tracking-tight">¥3,200.00</p>
        <p className="mt-1 text-sm text-ink2">{tr('Needs your PIN plus an SMS code or passkey', '需要交易密码加短信验证码或通行密钥')}</p>
      </div>
    </div>
  )
}

export default function AuthPage({ register = false }: { register?: boolean }) {
  const { tr, lang } = useLang()
  const { signedIn } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', pin: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = register ? form : { email: form.email, password: form.password }
      const { user } = await call<{ user: User }>(register ? '/api/register' : '/api/login', body)
      signedIn(user)
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorText(err, lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2.5 font-bold"><Mark /><span>{tr('Banking AI Agent', '银行 AI 助手')}</span></div>
        <div className="flex items-center gap-2"><LangSwitch /><ThemeSwitch /></div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-10 px-4 pb-16 pt-6 md:grid-cols-[1.1fr_1fr] md:pt-14">
        <div>
          <h1 className="keep text-[34px] font-extrabold leading-[1.15] tracking-tight md:text-[44px]">
            {tr('Say what you need. The assistant plans it. Fixed rules and you decide.', '说一句话，办成银行业务。助手负责规划，规则和你说了算。')}
          </h1>
          <p className="mt-4 max-w-md text-ink2">
            {tr('Questions run straight away. Anything that moves money or changes a card shows you a slip first, and larger amounts need your PIN and a code.',
              '查询类操作直接执行。动钱、改卡之前，先给你看清每一笔；大额还要交易密码和验证码。')}
          </p>
          <div className="mt-8 max-w-sm"><ExampleSlip /></div>
        </div>
        <form onSubmit={submit} className="h-fit rounded-2xl border border-rule bg-sheet p-6 md:mt-4" noValidate>
          <h2 className="text-xl font-bold">{register ? tr('Open a demo account', '开通演示账户') : tr('Sign in', '登录')}</h2>
          {register && <p className="mt-1 text-sm text-ink2">{tr('You get your own simulated bank with two years of history. No real money is involved.', '系统会为你生成一个独立的模拟银行账户，含近两年的交易记录，不涉及真实资金。')}</p>}
          <div className="mt-5 space-y-3.5">
            {register && (
              <label className="block text-sm font-semibold">{tr('Name', '姓名')}
                <input className="field mt-1.5 font-normal" value={form.name} onChange={set('name')} autoComplete="name" required minLength={2} />
              </label>
            )}
            <label className="block text-sm font-semibold">{tr('Email', '邮箱')}
              <input className="field mt-1.5 font-normal" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
            </label>
            <label className="block text-sm font-semibold">{tr('Password (10+ characters)', '登录密码（至少 10 位）')}
              <input className="field mt-1.5 font-normal" type="password" value={form.password} onChange={set('password')} autoComplete={register ? 'new-password' : 'current-password'} required minLength={10} />
            </label>
            {register && (
              <label className="block text-sm font-semibold">{tr('6-digit transaction PIN', '6 位交易密码')}
                <input className="field num mt-1.5 font-normal tracking-[0.4em]" inputMode="numeric" pattern="\d{6}" maxLength={6} value={form.pin}
                  onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} autoComplete="off" required />
                <span className="mt-1 block text-xs font-normal text-ink3">{tr('Used for high-risk actions. Not repeated or sequential digits.', '用于高风险操作，不能是重复或连续数字。')}</span>
              </label>
            )}
          </div>
          {error && <p role="alert" className="mt-4 rounded-lg bg-vermilion-wash px-3 py-2 text-sm text-vermilion">{error}</p>}
          <button className="btn btn-primary mt-5 w-full" disabled={busy}>
            {busy ? tr('Please wait…', '请稍候…') : register ? tr('Open account', '开通账户') : tr('Sign in', '登录')}
          </button>
          <p className="mt-4 text-center text-sm text-ink2">
            {register ? <>{tr('Already have an account?', '已有账户？')} <Link className="font-semibold text-indigo" to="/">{tr('Sign in', '登录')}</Link></>
              : <>{tr('New here?', '第一次使用？')} <Link className="font-semibold text-indigo" to="/signup">{tr('Open a demo account', '开通演示账户')}</Link></>}
          </p>
        </form>
      </main>
    </div>
  )
}
