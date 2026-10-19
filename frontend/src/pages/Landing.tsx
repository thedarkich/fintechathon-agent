import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLang } from '../i18n'
import { SiteHeader, SiteFooter } from '../components/SiteChrome'
import { Icon, type IconName } from '../components/Icon'
import { Seal } from '../components/Seal'
import { Badge, IconDot, TierTag, type Tint } from '../components/bits'
import { getAdminToken } from '../api/client'
import { useAuth, useStartDemo } from '../lib/auth'
import '../landing.css'

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The real flow on a phone: ask, check the card, confirm, done, and Mum's phone gets the money. */
function PhoneDemo() {
  const { tr } = useLang()
  const last = 6
  const [step, setStep] = useState(reduceMotion() ? last : 0)
  useEffect(() => {
    if (reduceMotion()) return
    const pause = [900, 1100, 1700, 900, 1300, 1600, 3400][step]
    const timer = window.setTimeout(() => setStep(step >= last ? 0 : step + 1), pause)
    return () => window.clearTimeout(timer)
  }, [step])
  const rows: [string, string][] = [
    [tr('To', '收款人'), tr('Wang Xiuying (Mom)', '王秀英（妈妈）')],
    [tr('Amount', '金额'), '¥200.00'],
    [tr('Arrives', '到账'), tr('Now', '实时到账')],
  ]
  return (
    <div className="lp-phones" aria-label={tr('Example: sending Mom 200', '示例：给妈妈转200')}>
      <div className="lp-phone">
        <div className="lp-phone-bar"><span>9:41</span><b>{tr('Assistant', '助手')}</b><span>•••</span></div>
        <div className="lp-chat">
          {step >= 0 && <p className="lp-bubble lp-me">{tr('Send Mom 200', '给妈妈转200')}</p>}
          {step === 1 && <p className="lp-typing" aria-hidden><i /><i /><i /></p>}
          {step >= 2 && <p className="lp-bubble lp-bot">{tr('Please check:', '请核对：')}</p>}
          {step >= 2 && (
            <div className="lp-card">
              <div className="lp-card-head"><b>{step >= 4 ? tr('Done', '已办好') : tr('Please confirm', '请确认')}</b>{step < 4 ? <span className="lp-tag">{tr('Needs your OK', '需确认')}</span> : <Seal kind="done" size={40} />}</div>
              <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === tr('Amount', '金额') ? 'lp-amount' : ''}>{v}</dd></div>)}</dl>
              {step < 4 && <div className="lp-card-actions"><span className={`lp-btn ${step === 3 ? 'is-pressed' : ''}`}>{tr('Confirm', '确认')}</span><span className="lp-btn lp-btn-line">{tr('Cancel', '取消')}</span></div>}
            </div>
          )}
          {step >= 4 && <p className="lp-bubble lp-bot">{tr('Sent ¥200.00 to Wang Xiuying. It has arrived.', '已向 王秀英 转账 ¥200.00，已到账。')}</p>}
        </div>
        <div className="lp-input"><span>{tr('Type what you need…', '说说你要办的事…')}</span><i /></div>
      </div>
      <div className={`lp-notice ${step >= 5 ? 'is-shown' : ''}`} aria-hidden={step < 5}>
        <p className="lp-notice-who"><Icon name="phone" size={13} /> {tr('Mom’s phone', '妈妈的手机')}</p>
        <p>{tr('[ICBC] Your account ending 7801 received RMB 200.00 from Li Ming.', '【中国工商银行】您尾号7801的账户收到李明转账人民币200.00元。')}</p>
      </div>
    </div>
  )
}

export default function LandingPage() {
  const { tr, t } = useLang()
  const { user } = useAuth()
  const signedIn = !!user || !!getAdminToken()
  const navigate = useNavigate()
  const demo = useStartDemo()
  const [ask, setAsk] = useState('')
  // signed out, a click opens a fresh demo bank first: nothing to fill in before the first sentence
  const go = async (path: string) => {
    if (!user && getAdminToken()) { navigate('/operator'); return }
    const outcome = user ? 'ok' : await demo.start()
    if (outcome !== 'error') navigate(outcome === 'ok' ? path : '/signup')
  }
  const tryIt = (text: string) => void go(`/assistant?ask=${encodeURIComponent(text)}`)
  const [params] = useSearchParams()
  useEffect(() => {
    document.title = tr(`${t.brand_en} · Say it once. We do it.`, `${t.brand} · 你说一句，我来办`)
    const section = params.get('section')
    if (section) document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' })
    else window.scrollTo(0, 0)
  }, [params, tr, t])

  const start = demo.busy ? tr('Opening your bank…', '正在开通…') : signedIn ? tr('Open the app', '进入银行') : tr('Try it now, no sign-up', '马上试试，不用注册')
  // the brief's six scenarios, in its order, each with a sentence to try
  const scenarios: [IconName, Tint, string, string, string][] = [
    ['send', 'green', tr('Transfers', '转账'), tr('By phone number or payee; see who it is before you send.', '手机号或收款人都行，转账前先看清是谁。'), tr('Send Mom 200', '给妈妈转200')],
    ['chart', 'blue', tr('Spending', '账单'), tr('Where the money went, and anything that looks odd.', '钱花在哪了，有没有可疑交易。'), tr('Where did my money go last month?', '上个月钱都花哪了')],
    ['trend', 'violet', tr('Invest', '理财'), tr('Suggestions within your risk level, nothing above it.', '按你的风险等级推荐，超出的不让买。'), tr('100000 for a year: what should I buy?', '有10万一年不用，推荐个理财')],
    ['card', 'amber', tr('Cards', '卡片'), tr('Freeze, report lost or change a limit by saying so.', '冻结、挂失、调限额，说一声就办。'), tr('I lost my card', '我的卡丢了')],
    ['bell', 'blue', tr('Subscriptions', '自动续费'), tr('Every automatic charge, and services you pay for twice.', '每一笔自动扣费，重复的会员一目了然。'), tr('What am I paying for every month?', '我有哪些自动续费')],
    ['agents', 'green', tr('Many things in one sentence', '一句话办多件事'), tr('Money set aside now, flowers and a cake ordered in time.', '现在预留礼物钱，到时订好花和蛋糕。'), tr("It's my wife's birthday next month, help me prepare", '下个月老婆生日，帮我准备一下')],
  ]
  const chips = [tr('Send Mom 200', '给妈妈转200'), tr('What subscriptions do I have?', '我有哪些自动续费'), tr('Anything suspicious?', '有没有可疑交易'), tr('Freeze my virtual card', '冻结我的虚拟卡')]

  return <div className="public-site landing-page"><SiteHeader />
    <main className="lp" id="main-content" tabIndex={-1}>
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <Badge tone="green">{tr('A simulated bank · Chinese and English', '模拟银行 · 中英文都能说')}</Badge>
          <h1>{tr('Say it once.', '你说一句，')}<br />{tr('We do it.', '我来办。')}</h1>
          <p>{tr('Send money, check your spending, freeze a card or plan a birthday. Before any money moves, you see exactly what will happen and say yes.', '转账、查账、冻结卡片、准备生日，说一句就行。动钱之前，你会看清楚要办什么，由你来点头。')}</p>
          <div className="lp-actions">
            <button type="button" className="site-button cta" disabled={demo.busy} onClick={() => void go('/home')}>{start}</button>
            <Link to="/how" className="site-button secondary">{tr('How it stays safe', '安全原理')}</Link>
          </div>
          {demo.error && <p role="alert" className="lp-error">{demo.error}</p>}
        </div>
        <div className="lp-hero-visual"><PhoneDemo /></div>
      </section>

      <section className="lp-section" id="scenarios">
        <h2>{tr('Six kinds of banking, one sentence each', '六类业务，一句话就能办')}</h2>
        <div className="lp-scenarios">
          {scenarios.map(([icon, tint, name, line, example]) => (
            <article key={name} className="card lp-scenario">
              <div className="flex items-center gap-3"><IconDot icon={icon} tint={tint} /><h3>{name}</h3></div>
              <p className="lp-scenario-line">{line}</p>
              <p className="lp-scenario-say">“{example}”</p>
              <button type="button" className="btn btn-line mt-auto w-full" disabled={demo.busy} onClick={() => tryIt(example)}>{tr('Try it', '试一试')}</button>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section" id="safety">
        <h2>{tr('The AI never touches your money', 'AI 碰不到你的钱')}</h2>
        <ol className="lp-steps3">
          <li className="card">
            <IconDot icon="agents" tint="violet" />
            <h3>{tr('The AI proposes', 'AI 提议')}</h3>
            <p>{tr('It turns your words into steps from a fixed list of bank actions. It never sees your account and can’t approve anything.', '它把你的话拆成步骤，只能从固定的银行操作里选。它看不到你的账户，也不能批准任何事。')}</p>
          </li>
          <li className="card">
            <IconDot icon="shield" tint="blue" />
            <h3>{tr('The rules decide', '规则决定')}</h3>
            <p>{tr('Fixed code decides what each step needs:', '固定代码决定每一步需要什么：')}</p>
            <p className="mt-3 flex flex-wrap gap-1.5"><TierTag tier="green" /><TierTag tier="yellow" /><TierTag tier="red" /></p>
          </li>
          <li className="card">
            <IconDot icon="check" tint="green" />
            <h3>{tr('You say yes', '你来点头')}</h3>
            <p>{tr('Nothing moves before you confirm. Over ¥1,000 a day needs your PIN and an SMS code, which the AI never sees.', '你确认之前，钱一分不动。当天超过 ¥1,000 要交易密码加短信验证码，AI 看不到。')}</p>
          </li>
        </ol>
        <p className="mt-5 text-center"><Link to="/how" className="lp-link inline-flex min-h-11 items-center">{tr('See how it works', '看看原理')} →</Link></p>
      </section>

      <section className="lp-section lp-ask" id="ask">
        <h2>{tr('What do you need? Just say it.', '想办什么，直接说')}</h2>
        <form onSubmit={(e) => { e.preventDefault(); if (ask.trim()) tryIt(ask.trim()) }} className="lp-ask-box">
          <Icon name="chat" size={20} />
          <input value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={200} aria-label={tr('What do you need?', '想办什么')} placeholder={tr('e.g. Send Mom 200', '例如：给妈妈转200')} />
          <button type="submit" className="site-button" disabled={!ask.trim() || demo.busy}>{tr('Go', '去办')}</button>
        </form>
        <div className="lp-pills lp-ask-chips">
          {chips.map((text) => <button key={text} type="button" disabled={demo.busy} onClick={() => tryIt(text)}>{text}</button>)}
        </div>
        <p className="lp-note">{signedIn ? tr('A simulated bank for the competition. No real money moves.', '参赛演示用的模拟银行，不涉及真实资金。')
          : <>{tr('Opens a demo account with its own simulated bank. ', '会为你开一个自带模拟银行的演示账户。')}<Link to="/signup" className="lp-link">{tr('Or create your own account', '或者注册自己的账户')}</Link></>}</p>
      </section>
    </main><SiteFooter />
  </div>
}
