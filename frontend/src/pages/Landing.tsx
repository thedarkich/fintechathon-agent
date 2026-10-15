import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLang } from '../i18n'
import { SiteHeader, SiteFooter } from '../components/SiteChrome'
import { HeroSlider, type Slide } from '../components/HeroSlider'
import { Icon, type IconName } from '../components/Icon'
import { Seal } from '../components/Seal'
import { getAdminToken } from '../api/client'
import { useAuth, useStartDemo } from '../lib/auth'
import { yuan } from '../lib/format'
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
    [tr('Account', '收款账户'), tr('ICBC ****7801', '中国工商银行 ****7801')],
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
            <div className={`lp-card ${step >= 4 ? 'is-done' : ''}`}>
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

/** A phone screen for the other slides: the same frame as the demo, showing one screen of the app. */
function PhoneScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="lp-phones">
      <div className="lp-phone">
        <div className="lp-phone-bar"><span>9:41</span><b>{title}</b><span>•••</span></div>
        <div className="lp-screen">{children}</div>
      </div>
    </div>
  )
}

function TransferScreen() {
  const { tr } = useLang()
  return (
    <PhoneScreen title={tr('Transfers', '转账')}>
      <p className="lp-field"><span>+86</span> 135 1234 0000</p>
      <div className="lp-who"><span className="lp-avatar">*</span><div><b>*艳</b><small>{tr('Agricultural Bank of China', '中国农业银行')}</small></div></div>
      <p className="lp-warn">{tr('First transfer to this number: check the name.', '第一次转给这个号码：请核对姓名。')}</p>
      <p className="lp-big">¥200</p>
      <span className="lp-btn">{tr('Send ¥200.00', '转账 ¥200.00')}</span>
      <p className="lp-fine">{tr('Over ¥500 to someone new: PIN + code, arrives in 2 hours.', '给新收款人超过 ¥500：需验证，2 小时后到账。')}</p>
    </PhoneScreen>
  )
}

function PayScreen() {
  const { tr } = useLang()
  return (
    <PhoneScreen title={tr('QR pay', '扫码付')}>
      <div className="lp-who"><span className="lp-avatar"><Icon name="qr" size={18} /></span><div><b>{tr('Luckin Coffee', '瑞幸咖啡（光谷广场店）')}</b><small className="lp-ok">{tr('Registered with the bank', '本行登记商户')}</small></div></div>
      <p className="lp-big">¥18.50</p>
      <span className="lp-btn">{tr('Pay ¥18.50', '付款 ¥18.50')}</span>
      <div className="lp-bill"><span><b>{tr('State Grid', '国家电网 电费')}</b><small>{tr('Pays itself on 10-20, up to ¥300', '10-20 自动缴，上限 ¥300')}</small></span><b>¥233.85</b></div>
      <div className="lp-bill"><span><b>{tr('Wuhan Water', '武汉水务 水费')}</b><small>{tr('Due now', '待缴')}</small></span><b>¥52.63</b></div>
    </PhoneScreen>
  )
}

const TIERS = {
  yellow: ['Needs your OK', '需确认'],
  red: ['Needs PIN + code', '需验证'],
} as const

/** How the bank's fixed rules would treat a payment: the same thresholds as the server's policy. */
function RuleCheck({ onTry }: { onTry: (path: string) => void }) {
  const { tr } = useLang()
  const [kind, setKind] = useState<'transfer' | 'bill' | 'qr'>('transfer')
  const [amount, setAmount] = useState(200)
  const [paid, setPaid] = useState(0)
  const [fresh, setFresh] = useState(false)
  const total = paid + amount
  const newPayee = kind === 'transfer' && fresh && amount > 500
  const tier = total > 1000 || newPayee ? 'red' : 'yellow'
  const why = newPayee
    ? tr(`Over ¥500 to a payee added today: your PIN and a code, and the money arrives 2 hours later so you can still cancel.`, '给今天新加的收款人超过 ¥500：需要交易密码和验证码，钱 2 小时后到账，到账前可以撤销。')
    : total > 1000
      ? tr(`Today's payments would reach ${yuan(total * 100)}, over ¥1,000: your PIN and an SMS code, or a passkey.`, `今天累计将达 ${yuan(total * 100)}，超过 ¥1,000：需要交易密码和短信验证码，或通行密钥。`)
      : tr(`Today's payments stay at ${yuan(total * 100)}, under ¥1,000: you see the details and tap Confirm.`, `今天累计 ${yuan(total * 100)}，不超过 ¥1,000：看清楚后点“确认”即可。`)
  const kinds = [['transfer', tr('Transfer', '转账')], ['bill', tr('Pay a bill', '缴费')], ['qr', tr('QR pay', '扫码付')]] as const
  return (
    <div className="lp-calc">
      <div role="tablist" className="lp-pills lp-calc-tabs">
        {kinds.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={kind === key} onClick={() => setKind(key)}>{label}</button>)}
      </div>
      <div className="lp-calc-body">
        <div className="lp-calc-form">
          <label className="lp-calc-label" htmlFor="calc-amount">{tr('Amount', '金额')}</label>
          <p className="lp-calc-amount">{yuan(amount * 100)}</p>
          <input id="calc-amount" type="range" min={10} max={3000} step={10} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          <div className="lp-calc-scale"><span>¥10</span><span>¥3,000</span></div>
          <p className="lp-calc-label">{tr('Already paid today', '今天已经付了')}</p>
          <div className="lp-pills">
            {[0, 300, 800].map((n) => <button key={n} type="button" aria-pressed={paid === n} onClick={() => setPaid(n)}>{yuan(n * 100)}</button>)}
          </div>
          {kind === 'transfer' && <>
            <p className="lp-calc-label">{tr('Who to', '收款人')}</p>
            <div className="lp-pills">
              <button type="button" aria-pressed={!fresh} onClick={() => setFresh(false)}>{tr('Paid before', '转过的人')}</button>
              <button type="button" aria-pressed={fresh} onClick={() => setFresh(true)}>{tr('Added today', '今天新加的')}</button>
            </div>
          </>}
        </div>
        <div className="lp-calc-result" aria-live="polite">
          <div className="lp-frost">
            <p className="lp-calc-label">{tr('The bank’s rules say', '银行规则的判断')}</p>
            <p className="lp-calc-tier">{tr(TIERS[tier][0], TIERS[tier][1])}</p>
            <p className="lp-calc-why">{why}</p>
          </div>
          <div className="lp-actions">
            <button type="button" className="site-button cta" onClick={() => onTry(kind === 'transfer' ? '/send' : kind === 'bill' ? '/payments' : '/qr')}>{tr('Try it with a demo account', '用演示账户试试')}</button>
            <Link to="/how" className="site-button ghost">{tr('The rules', '规则原理')}</Link>
          </div>
          <p className="lp-calc-note">{tr('An illustration of the bank’s fixed rules; nothing is sent.', '示意规则判断，不会提交任何内容。')}</p>
        </div>
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
  const actions = <>
    <button type="button" className="site-button cta" disabled={demo.busy} onClick={() => void go('/home')}>{start}</button>
    <Link to="/how" className="site-button ghost">{tr('How it stays safe', '安全原理')}</Link>
  </>
  const slides: Slide[] = [
    { key: 'ask', title: <>{tr('Say it once.', '你说一句，')}<br />{tr('We do it.', '我来办。')}</>,
      lead: tr('Send money, check your spending, freeze a card or plan a birthday, in Chinese or English. Before any money moves, you see exactly what will happen and say yes.', '转账、查账、冻结卡片、准备生日，用中文或英文说一句就行。动钱之前，你会看清楚要办什么，由你来点头。'),
      visual: <PhoneDemo /> },
    { key: 'phone', title: <>{tr('See who it is,', '先看清是谁，')}<br />{tr('then send.', '再转账。')}</>,
      lead: tr('Type a phone number and the bank shows whose account it is, with the name masked. A first transfer to someone new is checked harder.', '输入手机号，银行先告诉你这是谁的账户（姓名打码）。第一次转给新的人，检查更严。'),
      visual: <TransferScreen /> },
    { key: 'pay', title: <>{tr('Scan, pay bills,', '扫码付、缴费，')}<br />{tr('one step each.', '一步到位。')}</>,
      lead: tr('Pay a shop by its code, top up a phone, pay electricity and water, or let a bill pay itself, never above the limit you set.', '扫商户的码付款，充话费、交水电，也可以让账单自动缴，但绝不超过你设的上限。'),
      visual: <PayScreen /> },
  ]
  const services: [string, IconName, string, string][] = [
    ['/qr', 'qr', 'QR pay', '扫码付'], ['/send', 'send', 'Transfers', '转账'], ['/payments', 'receipt', 'Payments', '缴费'], ['/assistant', 'chat', 'Assistant', '助手'],
    ['/bills', 'chart', 'Spending', '账单'], ['/wealth', 'trend', 'Invest', '理财'], ['/controls', 'card', 'Cards', '卡片'], ['/how', 'shield', 'Safety', '安全'],
  ]
  const examples = [tr("What's my balance?", '我卡里还有多少钱'), tr('Where did my money go last month?', '上个月钱都花哪了'), tr('Freeze my virtual card', '冻结我的虚拟卡'), tr('Cancel iQIYI', '取消爱奇艺会员'), tr("It's my wife's birthday next month, help me prepare", '下个月老婆生日，帮我准备一下')]
  const features: [IconName, string, string, string][] = [
    ['arrow', tr('Send money in one sentence', '一句话转账'), tr('See who, how much and when it arrives, then confirm.', '看清收款人、金额和到账时间再确认。'), tr('Send Mom 200', '给妈妈转200')],
    ['chart', tr('Ask where your money went', '钱花哪了，一问就知'), tr('Categories, trends and anything suspicious.', '分类、走势、可疑交易，一目了然。'), tr('Where did my money go last month?', '上个月钱都花哪了')],
    ['card', tr('Lost your card? Freeze it now', '卡丢了，先冻结'), tr('Freeze, report lost, change a limit, just by saying so.', '冻结、挂失、调限额，说一声就办。'), tr('I lost my card', '我的卡丢了')],
    ['bell', tr('Cancel what you don’t use', '不用的会员，一句话取消'), tr('Every monthly charge found for you, duplicates included.', '自动找出每月扣钱的会员，重复的一目了然。'), tr('What am I paying for every month?', '我有哪些自动续费')],
    ['trend', tr('Investing, explained', '理财，问得明白'), tr('Suggestions that fit your risk test, nothing above it.', '按风险测评推荐，超出承受能力的不让买。'), tr('I have 100000 for a year. What should I invest in?', '有10万一年不用，推荐个理财')],
    ['clock', tr('A birthday, planned in one go', '生日，一句话安排'), tr('Money set aside, flowers and a cake ordered in time.', '预留礼物钱，提前订好花和蛋糕。'), tr('My wife’s birthday is next month', '下个月老婆生日，帮我准备一下')],
  ]
  const safety: [string, string][] = [
    [tr('Nothing moves without your yes', '动钱之前，先问你'), tr('You see who, how much and when, then tap Confirm.', '先看收款人、金额和到账时间，你点“确认”才办。')],
    [tr('Big payments need your PIN', '大额要验证'), tr('Over ¥1,000 a day: PIN and an SMS code. The AI never sees them.', '当天超过 ¥1,000：交易密码加短信验证码，AI 看不到。')],
    [tr('Anything odd waits', '有风险，先等等'), tr('A large payment to someone new arrives 2 hours later.', '给新收款人的大额转账，2 小时后才到账。')],
  ]

  return <div className="public-site landing-page"><SiteHeader />
    <main className="lp" id="main-content" tabIndex={-1}>
      <HeroSlider slides={slides} actions={actions} />
      {demo.error && <p role="alert" className="lp-error">{demo.error}</p>}

      <nav className="lp-services" aria-label={tr('Services', '服务')}>
        {services.map(([to, icon, en, zh]) => to === '/how'
          ? <Link key={to} to={to} className="lp-service"><span><Icon name={icon} size={24} /></span>{tr(en, zh)}</Link>
          : <button key={to} type="button" className="lp-service" disabled={demo.busy} onClick={() => void go(to)}><span><Icon name={icon} size={24} /></span>{tr(en, zh)}</button>)}
      </nav>

      <div className="lp-info">
        <section className="lp-info-card" aria-labelledby="try-title">
          <div className="lp-info-head"><h2 id="try-title">{tr('Try saying', '试着这样说')}</h2><span>{tr('Opens a demo account', '会开一个演示账户')}</span></div>
          <ul className="lp-rows">
            {examples.slice(0, 4).map((text) => (
              <li key={text}><button type="button" disabled={demo.busy} onClick={() => tryIt(text)}><span>“{text}”</span><Icon name="arrow" size={16} /></button></li>
            ))}
          </ul>
        </section>
        <section className="lp-info-card lp-info-safe" aria-labelledby="safe-title">
          <div className="min-w-0">
            <h2 id="safe-title">{tr('The AI never touches your money', 'AI 碰不到你的钱')}</h2>
            <ul className="lp-steps">
              {safety.map(([title, text]) => <li key={title}><b>{title}</b><span>{text}</span></li>)}
            </ul>
            <Link to="/how" className="site-button secondary lp-white">{tr('See how it works', '看看原理')}</Link>
          </div>
          <span className="lp-info-seal" aria-hidden><Seal kind="done" size={132} /></span>
        </section>
      </div>

      <section className="lp-section" id="features">
        <h2>{tr('One sentence does it', '一句话，能办这些事')}</h2>
        <div className="lp-tiles">
          {features.map(([icon, title, text, example]) => (
            <article key={title} className="lp-tile">
              <h3>{title}</h3>
              <p>{text}</p>
              <div className="lp-tile-card">
                <span className="lp-tile-icon"><Icon name={icon} size={20} /></span>
                <p>“{example}”</p>
                <button type="button" disabled={demo.busy} onClick={() => tryIt(example)}>{tr('Try it', '试试这句')}</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section" id="calc">
        <h2>{tr('Will it need your OK?', '算一算：要不要确认？')}</h2>
        <RuleCheck onTry={(path) => void go(path)} />
      </section>

      <section className="lp-section lp-ask" id="ask">
        <h2>{tr('What do you need? Just say it.', '想办什么，直接说')}</h2>
        <form onSubmit={(e) => { e.preventDefault(); if (ask.trim()) tryIt(ask.trim()) }} className="lp-ask-box">
          <Icon name="chat" size={20} />
          <input value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={200} aria-label={tr('What do you need?', '想办什么')} placeholder={tr('e.g. Send Mom 200', '例如：给妈妈转200')} />
          <button type="submit" className="site-button" disabled={!ask.trim() || demo.busy}>{tr('Go', '去办')}</button>
        </form>
        <div className="lp-pills lp-ask-chips">
          {[tr('Send Mom 200', '给妈妈转200'), tr('What subscriptions do I have?', '我有哪些自动续费'), tr('Anything suspicious?', '有没有可疑交易'), tr('Freeze my virtual card', '冻结我的虚拟卡')].map((text) => (
            <button key={text} type="button" disabled={demo.busy} onClick={() => tryIt(text)}>{text}</button>
          ))}
        </div>
        <p className="lp-note">{signedIn ? tr('A simulated bank for the competition. No real money moves.', '参赛演示用的模拟银行，不涉及真实资金。')
          : <>{tr('Opens a demo account with its own simulated bank. ', '会为你开一个自带模拟银行的演示账户。')}<Link to="/signup" className="lp-link">{tr('Or create your own account', '或者注册自己的账户')}</Link></>}</p>
      </section>
    </main><SiteFooter />
  </div>
}
