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
const LAST = 6

/** The phone demo's clock: ask, think, the card, the tap, done, Mom's phone, a pause; then again. */
function useDemoStep() {
  const [step, setStep] = useState(reduceMotion() ? LAST : 0)
  useEffect(() => {
    if (reduceMotion()) return
    const pause = [900, 1100, 1700, 900, 1300, 1600, 3400][step]
    const timer = window.setTimeout(() => setStep(step >= LAST ? 0 : step + 1), pause)
    return () => window.clearTimeout(timer)
  }, [step])
  return step
}

/** The real flow on a phone: ask, check the card, confirm, done, and Mom's phone gets the money. */
function PhoneDemo({ step }: { step: number }) {
  const { tr } = useLang()
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
              <dl>{rows.map(([k, v], i) => <div key={k}><dt>{k}</dt><dd className={i === 1 ? 'lp-amount' : ''}>{v}</dd></div>)}</dl>
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
  const step = useDemoStep()
  // the four steps beside the phone, lit as the phone reaches them
  const now = step <= 1 ? 0 : step === 2 ? 1 : step <= 4 ? 2 : 3
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

  const start = demo.busy ? tr('Opening your bank…', '正在开通…') : signedIn ? tr('Open the app', '进入银行') : tr('Open the demo bank', '打开演示银行')
  const steps: [string, string][] = [
    [tr('Say it', '说一句'), tr('“Send Mom 200”', '“给妈妈转200”')],
    [tr('Check', '核对'), tr('The assistant lists who, how much and when', '助手列出收款人、金额和到账时间')],
    [tr('Confirm', '确认'), tr('Money moves only after you tap Confirm', '你点了确认，钱才会动')],
    [tr('Done', '到账'), tr('Mom’s phone gets the arrival text', '妈妈的手机收到到账短信')],
  ]
  // the brief's six scenarios, in its order, each with a sentence to try
  const scenarios: [IconName, Tint, string, string, string][] = [
    ['send', 'green', tr('Transfers', '转账'), tr('By phone number or payee; see who it is before you send.', '手机号或收款人都行，转账前先看清是谁。'), tr('Send Mom 200', '给妈妈转200')],
    ['chart', 'blue', tr('Spending', '账单'), tr('Where the money went, and anything that looks odd.', '钱花在哪了，有没有可疑交易。'), tr('Where did my money go last month?', '上个月钱都花哪了')],
    ['trend', 'violet', tr('Invest', '理财'), tr('Suggestions within your risk level, nothing above it.', '按你的风险等级推荐，超出的不让买。'), tr('100000 for a year: what should I buy?', '有10万一年不用，推荐个理财')],
    ['card', 'amber', tr('Cards', '卡片'), tr('Freeze, report lost or change a limit.', '冻结、挂失、调限额。'), tr('I lost my card', '我的卡丢了')],
    ['bell', 'cyan', tr('Subscriptions', '自动续费'), tr('Every automatic charge, and services you pay for twice.', '每一笔自动扣费，重复的会员一目了然。'), tr('Cancel iQIYI', '取消爱奇艺会员')],
    ['agents', 'ink', tr('Several things at once', '多件事一起办'), tr('Money set aside now, flowers and a cake ordered in time.', '现在预留礼物钱，到时订好花和蛋糕。'), tr("Wife's birthday next month, help me prepare", '下个月老婆生日，帮我准备一下')],
  ]
  // what each kind of request needs, from the fixed rules (backend/app/agent/policy.py)
  const ladder: ['green' | 'yellow' | 'red', string, string][] = [
    ['green', tr('Balances, spending, suspicious charges', '查余额、看账单、找可疑交易'), tr('Done right away; no money moves', '直接办好，不动钱')],
    ['yellow', tr('Transfers up to ¥1,000 a day, freezing a card, cancelling a subscription', '当天累计 ¥1,000 以内的转账、冻结卡片、取消自动续费'), tr('A confirm card first: nothing happens until you tap Confirm', '先给你一张确认卡片，你点了确认才办')],
    ['red', tr('Over ¥1,000 a day, buying investments, unfreezing a card or raising a limit', '当天累计超过 ¥1,000、买理财、解冻卡片或调高限额'), tr('Also needs your PIN and an SMS code', '还要输入交易密码和短信验证码')],
  ]
  const chips = [tr('Send Mom 200', '给妈妈转200'), tr('Where did my money go last month?', '上个月钱都花哪了'), tr('Anything suspicious?', '有没有可疑交易'), tr('Freeze my virtual card', '冻结我的虚拟卡')]

  return <div className="public-site landing-page"><SiteHeader />
    <main className="lp" id="main-content" tabIndex={-1}>
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <Badge tone="green">{tr('Mobile bank · AI assistant · demo', '手机银行 · AI 助手 · 演示')}</Badge>
          <h1>{tr('Say it once.', '你说一句，')}<br />{tr('We do it.', '我来办。')}</h1>
          <p className="lp-lead">{tr('Central Union Bank’s mobile app has an AI assistant. Send money, check spending, invest, manage cards and subscriptions, all in your own words.', '中联银行的手机银行里有个 AI 助手。转账、查账、理财、管卡片和自动续费，用平常的话说就行。')}</p>
          <ol className="lp-how" aria-label={tr('How it works', '怎么用')}>
            {steps.map(([title, line], i) => (
              <li key={title} className={i === now ? 'is-now' : i < now ? 'is-done' : ''}>
                <span className="lp-how-n" aria-hidden>{i + 1}</span>
                <span className="min-w-0"><b>{title}</b><small>{line}</small></span>
              </li>
            ))}
          </ol>
          <div className="lp-actions">
            <button type="button" className="site-button cta" disabled={demo.busy} onClick={() => void go('/home')}>{start}</button>
            <Link to="/how" className="site-button secondary">{tr('How it stays safe', '安全原理')}</Link>
          </div>
          <p className="lp-hero-note">{signedIn ? tr('A simulated bank: no real money moves.', '模拟银行，不涉及真实资金。') : tr('No sign-up: it opens a demo account with simulated money.', '不用注册，自带模拟账户，不涉及真实资金。')}</p>
          {demo.error && <p role="alert" className="lp-error">{demo.error}</p>}
        </div>
        <div className="lp-hero-visual"><PhoneDemo step={step} /></div>
      </section>

      <section className="lp-section" id="scenarios">
        <h2>{tr('Six kinds of banking you can just say', '能办的六类事')}</h2>
        <p className="lp-section-lead">{tr('Tap a sentence to try it in the demo bank.', '点一句话，在演示银行里试试。')}</p>
        <ul className="card lp-list divide-y divide-[var(--rule)]">
          {scenarios.map(([icon, tint, name, line, example]) => (
            <li key={name} className="lp-row">
              <IconDot icon={icon} tint={tint} size={44} />
              <span className="min-w-0 flex-1"><b>{name}</b><small>{line}</small></span>
              <button type="button" className="lp-say" disabled={demo.busy} onClick={() => tryIt(example)}
                aria-label={tr(`Try saying: ${example}`, `试试说：${example}`)}>“{example}”</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-section" id="safety">
        <h2>{tr('How your money stays safe', '钱怎么保证安全')}</h2>
        <p className="lp-section-lead">{tr("The AI only works out what you mean. It can't see your PIN or codes: fixed bank rules decide what each step needs.", 'AI 只负责听懂你的话，看不到你的密码和验证码。每一步要不要确认、要不要验证，由银行的固定规则决定。')}</p>
        <ul className="card lp-list divide-y divide-[var(--rule)]">
          {ladder.map(([tier, what, how]) => (
            <li key={tier} className="lp-rung">
              <span className="lp-rung-tag"><TierTag tier={tier} /></span>
              <span className="min-w-0"><b>{what}</b><small>{how}</small></span>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-center"><Link to="/how" className="lp-link inline-flex min-h-11 items-center">{tr('See how it works', '看看原理')}</Link></p>
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
        {!signedIn && <p className="lp-note"><Link to="/signup" className="lp-link">{tr('Or create your own account', '或者注册自己的账户')}</Link></p>}
      </section>
    </main><SiteFooter />
  </div>
}
