import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLang } from '../i18n'
import { SiteFooter, SiteHeader } from '../components/SiteChrome'
import { Seal } from '../components/Seal'
import { getAdminToken } from '../api/client'
import { useAuth, useStartDemo } from '../lib/auth'
import { reduceMotion, useRise } from '../lib/motion'
import '../landing.css'

// hash routes own the URL fragment, so in-page links scroll instead of changing location.hash
const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' })

/** The hero's chat drifts up a little as the page scrolls: the one moving picture. */
function useDrift() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || reduceMotion()) return
    let frame = 0
    const update = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const progress = Math.max(-1, Math.min(1, (window.innerHeight / 2 - (r.top + r.height / 2)) / window.innerHeight))
      el.style.setProperty('--drift', progress.toFixed(3))
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [])
  return ref
}

/** The real flow, playing on a loop: ask, check the card, confirm, done, and Mom's phone gets the money. */
function ChatDemo() {
  const { tr } = useLang()
  const last = 6
  const [step, setStep] = useState(reduceMotion() ? last : 0)
  useEffect(() => {
    if (reduceMotion()) return
    const pause = [900, 1100, 1700, 900, 1300, 1600, 3600][step]
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
    <div className="lx-chat" data-ui aria-label={tr('Example: sending Mom 200', '示例：给妈妈转200')}>
      <div className="lx-chat-log">
        <p className="lx-bubble lx-me">{tr('Send Mom 200', '给妈妈转200')}</p>
        {step === 1 && <p className="lx-typing" aria-hidden><i /><i /><i /></p>}
        {step >= 2 && <p className="lx-bubble lx-bot">{tr('Please check:', '请核对：')}</p>}
        {step >= 2 && (
          <div className={`lx-confirm ${step >= 4 ? 'is-done' : ''}`}>
            <div className="lx-confirm-head">
              <b>{step >= 4 ? tr('Done', '已办好') : tr('Please confirm', '请确认')}</b>
              {step < 4 ? <span className="lx-tag">{tr('Needs your OK', '需确认')}</span> : <Seal kind="done" size={44} />}
            </div>
            <dl>{rows.map(([k, v], i) => <div key={k}><dt>{k}</dt><dd className={i === 2 ? 'lx-amount' : ''}>{v}</dd></div>)}</dl>
            {step < 4 && <div className="lx-confirm-actions"><span className={`lx-ui-btn ${step === 3 ? 'is-pressed' : ''}`}>{tr('Confirm', '确认')}</span><span className="lx-ui-btn lx-ui-line">{tr('Cancel', '取消')}</span></div>}
          </div>
        )}
        {step >= 4 && <p className="lx-bubble lx-bot">{tr('Sent ¥200.00 to Wang Xiuying. It has arrived.', '已向 王秀英 转账 ¥200.00，已到账。')}</p>}
      </div>
      <div className="lx-chat-input"><span>{tr('What do you need?', '说说你要办的事…')}</span><i aria-hidden /></div>
      <div className={`lx-sms ${step >= 5 ? 'is-shown' : ''}`} aria-hidden={step < 5}>
        <p className="lx-sms-who">{tr('Mom’s phone · Messages', '妈妈的手机 · 短信')}</p>
        <p>{tr('[ICBC] Your account ending 7801 received RMB 200.00 from Li Ming.', '【中国工商银行】您尾号7801的账户收到李明转账人民币200.00元。')}</p>
      </div>
    </div>
  )
}

/** Two contacts share a name: the bank asks, with both of them as choices. */
function TransferFragment() {
  const { tr } = useLang()
  const [picked, setPicked] = useState(0)
  const options: [string, string][] = [
    [tr('Zhang Wei · university friend', '张伟 · 大学同学'), tr('China Construction Bank ****5678', '中国建设银行 ****5678')],
    [tr('Zhang Wei · colleague, finance', '张薇 · 同事（财务）'), tr('Bank of Communications ****9876', '交通银行 ****9876')],
  ]
  return (
    <div className="lx-ui lx-ui-question" data-ui>
      <p className="lx-bubble lx-me">{tr('Send Zhang Wei 300', '给张伟转300')}</p>
      <div className="lx-ui-card">
        <p className="lx-ui-title">{tr('“Zhang Wei” matches two contacts. Which one?', '“张伟”对应两位联系人，是哪一位？')}</p>
        <div className="lx-ui-options" role="radiogroup" aria-label={tr('Choose a contact', '选择联系人')}>
          {options.map(([who, bank], i) => (
            <button key={who} type="button" role="radio" aria-checked={picked === i} className={picked === i ? 'is-on' : ''} onClick={() => setPicked(i)}>
              <b>{who}</b><span>{bank}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Last month by category, as the demo bank answers it: the five largest of the month's spending. */
function SpendingFragment() {
  const { tr } = useLang()
  const rows: [string, number][] = [
    [tr('Housing', '住房'), 3200], [tr('Dining', '餐饮'), 2516], [tr('Travel', '出行旅游'), 1753],
    [tr('Groceries', '日用超市'), 1096], [tr('Family', '家人'), 800],
  ]
  const max = Math.max(...rows.map(([, v]) => v))
  const yuan = (v: number) => '¥' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <div className="lx-ui lx-ui-spend" data-ui>
      <div className="lx-ui-head"><b>{tr('September · spent', '9 月 · 支出')}</b><span className="lx-ui-total">{yuan(10879.7)}</span></div>
      <ul>
        {rows.map(([name, v], i) => (
          <li key={name}>
            <span className="lx-ui-name">{name}</span>
            <span className="lx-ui-bar"><i style={{ width: `${(v / max) * 100}%` }} className={i === 0 ? 'is-top' : ''} /></span>
            <span className="lx-ui-val">{yuan(v)}</span>
          </li>
        ))}
      </ul>
      <p className="lx-ui-note">{tr('The largest is the rent: ¥3,200.00 to Zhao Jianhua, 29% of the month.', '最大一笔是房租：转给赵建华 ¥3,200.00，占当月 29%。')}</p>
    </div>
  )
}

/** Two of the bank's real products side by side, at the customer's risk level. */
function WealthFragment() {
  const { tr } = useLang()
  const products: [string, string, string, string, string][] = [
    [tr('Steady Money Market A', '稳享货币A'), 'R1', '1.62%', '1.65%', '¥1'],
    [tr('Anying Short-term Bond', '安盈短债'), 'R2', '2.45%', '2.80%', '¥100'],
  ]
  return (
    <div className="lx-ui lx-ui-wealth" data-ui>
      <table>
        <thead><tr><th scope="col">{tr('Product', '产品')}</th><th scope="col">{tr('Risk', '风险')}</th><th scope="col">{tr('7-day yield', '七日年化')}</th><th scope="col">{tr('Past year', '近一年')}</th><th scope="col">{tr('From', '起购')}</th></tr></thead>
        <tbody>{products.map(([name, risk, y, year, min], i) => (
          <tr key={name} className={i === 1 ? 'is-picked' : ''}><th scope="row">{name}</th><td>{risk}</td><td className="lx-ui-yield">{y}</td><td>{year}</td><td>{min}</td></tr>
        ))}</tbody>
      </table>
      <p className="lx-ui-note">{tr('Your risk test says R2 or lower, so higher-risk products are left out.', '你的风险测评为 R2 及以下，更高风险的产品不会推荐。')}</p>
    </div>
  )
}

/** The online card's switches. They work. */
function CardFragment() {
  const { tr } = useLang()
  const [frozen, setFrozen] = useState(false)
  const [on, setOn] = useState({ online: true, overseas: false, atm: false, contactless: false })
  const labels: [keyof typeof on, string][] = [['online', tr('Online payments', '网上支付')], ['overseas', tr('Overseas', '境外交易')], ['atm', tr('ATM', 'ATM 取现')], ['contactless', tr('Contactless', '闪付')]]
  return (
    <div className={`lx-ui lx-ui-card-controls ${frozen ? 'is-frozen' : ''}`} data-ui>
      <div className="lx-ui-plastic">
        <b>{tr('Online shopping card', '网购虚拟卡')}</b>
        <span>•••• 8831</span>
        <em>{frozen ? tr('Frozen', '已冻结') : tr('Active · ¥3,000.00 a day', '正常 · 每日 ¥3,000.00')}</em>
      </div>
      <ul>
        {labels.map(([key, label]) => (
          <li key={key}>
            <span>{label}</span>
            <button type="button" role="switch" aria-checked={on[key] && !frozen} disabled={frozen} aria-label={label}
              className={`lx-switch ${on[key] && !frozen ? 'is-on' : ''}`} onClick={() => setOn({ ...on, [key]: !on[key] })}><i /></button>
          </li>
        ))}
      </ul>
      <button type="button" className="lx-ui-btn lx-ui-wide" onClick={() => setFrozen(!frozen)}>{frozen ? tr('Unfreeze', '解冻') : tr('Freeze card', '冻结卡片')}</button>
    </div>
  )
}

/** Every automatic charge on the account, with the two music memberships found side by side. */
function SubscriptionsFragment() {
  const { tr } = useLang()
  const rows: [string, string, string, boolean][] = [
    [tr('Ledongli Fitness (Optics Valley)', '乐动力健身(光谷店)'), tr('Debit card · monthly', '借记卡 · 每月'), '¥199.00', false],
    [tr('China Telecom broadband', '中国电信 宽带'), tr('Direct debit · monthly', '代扣 · 每月'), '¥99.00', false],
    [tr('Tencent Video VIP', '腾讯视频VIP会员'), tr('Online card · monthly', '虚拟卡 · 每月'), '¥30.00', false],
    [tr('iQIYI VIP', '爱奇艺VIP会员'), tr('Online card · monthly', '虚拟卡 · 每月'), '¥25.00', false],
    [tr('NetEase Cloud Music', '网易云音乐 黑胶VIP'), tr('Online card · monthly', '虚拟卡 · 每月'), '¥15.00', true],
    [tr('QQ Music', 'QQ音乐 绿钻'), tr('Online card · monthly', '虚拟卡 · 每月'), '¥15.00', true],
  ]
  return (
    <div className="lx-ui lx-ui-subs" data-ui>
      <ul>{rows.map(([name, how, fen, dup]) => (
        <li key={name} className={dup ? 'is-flag' : ''}><span><b>{name}</b><small>{how}</small></span><span className="lx-ui-val">{fen}</span></li>
      ))}</ul>
      <p className="lx-ui-note is-flag">{tr('Two music memberships. Cancel one to save ¥180.00 a year.', '有两个音乐会员，取消一个每年省 ¥180.00。')}</p>
    </div>
  )
}

/** One sentence, three steps across three kinds of banking, each with its state. */
function PlanFragment() {
  const { tr } = useLang()
  const steps: [string, string, 'done' | 'set' | 'wait'][] = [
    [tr('Look up Chen Jing’s birthday', '查找陈静的生日'), tr('In 35 days', '还有 35 天'), 'done'],
    [tr('Set aside ¥1,000.00 for the gift', '预留 ¥1,000.00 买礼物'), tr('From the current account', '从活期账户'), 'set'],
    [tr('Order flowers and a cake', '订鲜花和蛋糕'), tr('Two days before, delivered home', '提前两天，送货到家'), 'wait'],
  ]
  const state = { done: tr('Done', '已完成'), set: tr('Set aside', '已预留'), wait: tr('Scheduled', '已安排') }
  return (
    <div className="lx-ui lx-ui-plan" data-ui>
      <p className="lx-bubble lx-me">{tr('My wife’s birthday is next month, help me prepare', '下个月老婆生日，帮我准备一下')}</p>
      <ol>{steps.map(([what, detail, s]) => (
        <li key={what} className={`is-${s}`}><span className="lx-ui-dot" aria-hidden /><span><b>{what}</b><small>{detail}</small></span><em>{state[s]}</em></li>
      ))}</ol>
    </div>
  )
}

/** Drag an amount and see which of the bank's rules applies. The thresholds are the bank's own. */
function RuleCheck() {
  const { tr } = useLang()
  const [amount, setAmount] = useState(800)
  const [fresh, setFresh] = useState(false)
  const strong = amount > 1000 || (fresh && amount > 500)
  const waits = fresh && amount > 500
  const figure = waits ? tr('2 hrs', '2 小时') : strong ? tr('PIN + code', '密码+验证码') : tr('1 tap', '点一下')
  const result = waits
    ? tr('It needs your PIN and a code, then arrives two hours later, so you can still cancel it.', '需要交易密码和验证码，并在 2 小时后到账，到账前还能撤销。')
    : strong
      ? tr('Over ¥1,000 today: your PIN and an SMS code, or a passkey. Then it arrives now.', '今天超过 ¥1,000：需要交易密码加短信验证码，或通行密钥，然后实时到账。')
      : tr('Your tap on Confirm is enough. It arrives now.', '你点“确认”就行，实时到账。')
  return (
    <div className="lx-check">
      <div className="lx-check-control" data-ui data-rise>
        <label htmlFor="lx-amount">
          <span>{tr('Today’s payments', '今日累计付款')}</span>
          <output htmlFor="lx-amount">¥{amount.toLocaleString('en-US')}.00</output>
        </label>
        <input id="lx-amount" type="range" min={50} max={3000} step={50} value={amount} onChange={(e) => setAmount(Number(e.target.value))}
          style={{ ['--fill' as string]: `${((amount - 50) / 2950) * 100}%` }} />
        <div className="lx-check-row">
          <span id="lx-fresh-label">{tr('To someone added today', '收款人是今天新加的')}</span>
          <button type="button" role="switch" aria-checked={fresh} aria-labelledby="lx-fresh-label" className={`lx-switch ${fresh ? 'is-on' : ''}`} onClick={() => setFresh(!fresh)}><i /></button>
        </div>
      </div>
      <div className="lx-check-result" data-rise>
        <p className="lx-figure" aria-live="polite">{figure}</p>
        <p className="lx-check-why">{result} {tr('Up to ¥1,000 a day, and up to ¥500 to a new contact, needs only your tap.', '每天累计 ¥1,000 以内、给新联系人 ¥500 以内，只需你点一下。')}</p>
      </div>
    </div>
  )
}

/** A capability: its claim on one side, the product doing it on the other. */
function Row({ id, title, text, say, tryIt, busy, children, wide = false }: {
  id?: string; title: string; text: string; say: string; tryIt: (s: string) => void; busy: boolean; children: ReactNode; wide?: boolean
}) {
  const { tr } = useLang()
  return (
    <article id={id} className={`lx-row ${wide ? 'is-wide' : ''}`}>
      <div className="lx-row-copy" data-rise>
        <h3>{title}</h3>
        <p>{text}</p>
        <button type="button" className="lx-link" disabled={busy} onClick={() => tryIt(say)}>{tr('Try', '试试')} “{say}”<span aria-hidden> ›</span></button>
      </div>
      <div className="lx-row-ui" data-rise>{children}</div>
    </article>
  )
}

export default function LandingPage() {
  const { tr, t } = useLang()
  const { user } = useAuth()
  const signedIn = !!user || !!getAdminToken()
  const navigate = useNavigate()
  const demo = useStartDemo()
  const [ask, setAsk] = useState('')
  const stage = useDrift()
  useRise()
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
    if (section) window.setTimeout(() => scrollToId(section), 60)
    else window.scrollTo(0, 0)
  }, [params, tr, t])

  const start = demo.busy ? tr('Opening your bank…', '正在开通…') : signedIn ? tr('Open the app', '进入银行') : tr('Try it now, no sign-up', '马上试试，不用注册')

  return <div className="public-site lx">
    <SiteHeader />
    <main id="main-content" tabIndex={-1}>
      <section className="lx-hero" aria-labelledby="lx-title">
        <div className="lx-hero-copy">
          <h1 id="lx-title" className="lx-h1">
            <span className="lx-line"><span>{tr('Say it once.', '你说一句，')}</span></span>
            <span className="lx-line"><span>{tr('We do it.', '我来办。')}</span></span>
          </h1>
          <p className="lx-lede">{tr('Banking you can talk to. Say what you need in Chinese or English; the bank checks it, and nothing moves until you say yes.', '能对话的银行。中文英文都行，说出你要办的事；银行先检查，你点头之前，钱一分不动。')}</p>
          <div className="lx-actions">
            <button type="button" className="site-button" disabled={demo.busy} onClick={() => void go('/home')}>{start}</button>
            <button type="button" className="lx-link" onClick={() => scrollToId('features')}>{tr('See what it does', '看看能做什么')}<span aria-hidden> ›</span></button>
          </div>
          {demo.error && <p role="alert" className="lx-error">{demo.error}</p>}
          <p className="lx-small">{tr('A simulated bank with made-up money. No real bank is connected.', '模拟银行，演示用的钱，不连接任何真实银行。')}</p>
        </div>
        <div className="lx-hero-stage" ref={stage}><ChatDemo /></div>
      </section>

      <section className="lx-section" id="features" aria-labelledby="features-h">
        <header className="lx-head" data-rise>
          <h2 id="features-h" className="lx-h2">{tr('Six kinds of banking. One sentence each.', '六类业务，一句话就办。')}</h2>
          <p className="lx-lede">{tr('Each one below is a real request with the demo bank’s real answer. Tap Try to send it yourself.', '下面每一句都是真实请求和演示银行的真实回答。点“试试”，自己发一次。')}</p>
        </header>
        <Row title={tr('Pay people by the name you call them.', '按你平时的叫法转账。')} text={tr('Name, nickname, phone number, or what they are to you. When two contacts share a name, it asks which one.', '姓名、昵称、手机号，或者“妈妈”“房东”都行。重名时，它会问你是哪一位。')}
          say={tr('Send Zhang Wei 300', '给张伟转300')} tryIt={tryIt} busy={demo.busy}><TransferFragment /></Row>
        <Row title={tr('See where the money went.', '看清钱花在哪了。')} text={tr('Spending by category, unusual charges flagged, and a report for any month or year.', '按类别看支出，异常消费会被标出，任意月份、年份都能出报告。')}
          say={tr('Where did my money go last month?', '上个月钱都花哪了')} tryIt={tryIt} busy={demo.busy}><SpendingFragment /></Row>
        <Row title={tr('Savings, at your risk level.', '理财，按你的风险等级来。')} text={tr('It compares the bank’s products against your risk test and never suggests one above it.', '按你的风险测评对比产品，不会推荐超出你承受能力的。')}
          say={tr('100000 for a year: what should I buy?', '有10万一年不用，推荐个理财')} tryIt={tryIt} busy={demo.busy}><WealthFragment /></Row>
        <Row title={tr('Freeze a card in one sentence.', '一句话冻结卡片。')} text={tr('Turn online, overseas, ATM or contactless payments on and off, change limits, or report a card lost.', '开关网上支付、境外交易、ATM 和闪付，调整限额，或挂失。')}
          say={tr('I lost my card', '我的卡丢了')} tryIt={tryIt} busy={demo.busy}><CardFragment /></Row>
        <Row title={tr('Find every automatic charge.', '找出每一笔自动扣费。')} text={tr('Memberships and direct debits in one list, with the ones you pay for twice.', '会员和代扣一张清单看完，重复订阅一眼就能发现。')}
          say={tr('What am I paying for every month?', '我有哪些自动续费')} tryIt={tryIt} busy={demo.busy}><SubscriptionsFragment /></Row>
        <Row title={tr('Several steps from one sentence.', '一句话，跨业务办好几步。')} text={tr('It plans across contacts, savings and shopping, and asks you once for the whole plan.', '跨联系人、预留资金和下单统一规划，整个计划只问你一次。')}
          say={tr('My wife’s birthday is next month, help me prepare', '下个月老婆生日，帮我准备一下')} tryIt={tryIt} busy={demo.busy} wide><PlanFragment /></Row>
      </section>

      <section className="lx-section lx-field" id="steps" aria-labelledby="steps-h">
        <div className="lx-column">
          <h2 id="steps-h" className="lx-h2" data-rise>{tr('Ask. Check. Done.', '说。核对。办好。')}</h2>
          <div className="lx-exchange" data-rise>
            <p className="lx-step">{tr('First, you say it.', '首先，你说一句。')}</p>
            <div className="lx-call" data-ui><span>{tr('Send Mom 200', '给妈妈转200')}</span><i aria-hidden /></div>
            <div className="lx-response" data-ui>
              <p>{tr('Transfer ¥200.00 to Wang Xiuying (Mom), ICBC ****7801', '向 王秀英（妈妈）转账 ¥200.00，中国工商银行 ****7801')}</p>
              <small>{tr('The AI only proposes this. It cannot move money.', 'AI 只能提议，自己动不了钱。')}</small>
            </div>
          </div>
          <div className="lx-exchange" data-rise>
            <p className="lx-step">{tr('Then, the bank’s rules check it.', '然后，银行的规则来检查。')}</p>
            <div className="lx-call lx-meter" data-ui>
              <span>{tr('Today’s payments', '今日累计')}</span><b>¥200.00 / ¥1,000.00</b>
              <span className="lx-meter-track"><i style={{ width: '20%' }} /></span>
            </div>
            <div className="lx-response" data-ui>
              <p>{tr('Under the daily limit, to a saved contact: your OK is enough.', '未超过每日额度，收款人是老联系人：你点头就行。')}</p>
              <small>{tr('Large or new: your PIN and a code. The AI never sees them.', '大额或新联系人：交易密码加验证码，AI 看不到。')}</small>
            </div>
          </div>
          <div className="lx-exchange" data-rise>
            <p className="lx-step">{tr('Finally, you say yes.', '最后，由你点头。')}</p>
            <div className="lx-result" data-ui>
              <div className="lx-receipt">
                <Seal kind="done" size={88} animate={false} />
                <div>
                  <p className="lx-receipt-amount">¥200.00</p>
                  <p>{tr('Sent to Wang Xiuying · arrived 12:41', '已转给 王秀英 · 12:41 到账')}</p>
                  <p className="lx-receipt-balance">{tr('Balance after ¥28,440.35', '交易后余额 ¥28,440.35')}</p>
                </div>
              </div>
              <div className="lx-sms is-shown is-static">
                <p className="lx-sms-who">{tr('Mom’s phone · Messages', '妈妈的手机 · 短信')}</p>
                <p>{tr('[ICBC] Your account ending 7801 received RMB 200.00 from Li Ming.', '【中国工商银行】您尾号7801的账户收到李明转账人民币200.00元。')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lx-section" id="check" aria-labelledby="check-h">
        <h2 id="check-h" className="lx-h2" data-rise>{tr('How much are you sending?', '这次要转多少？')}</h2>
        <RuleCheck />
      </section>

      <section className="lx-section lx-ask" id="ask" aria-labelledby="ask-h">
        <div className="lx-ask-main">
        <h2 id="ask-h" className="lx-h2" data-rise>{tr('Just say it.', '直接说。')}</h2>
        <p className="lx-lede" data-rise>{tr('A demo bank opens in a second, with two years of made-up history. Type what you need.', '一秒开好演示银行，自带两年的模拟流水。说说你要办的事。')}</p>
        <form onSubmit={(e) => { e.preventDefault(); if (ask.trim()) tryIt(ask.trim()) }} className="lx-askbox" data-rise>
          <input value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={200} aria-label={tr('What do you need?', '想办什么')} placeholder={tr('e.g. Send Mom 200', '例如：给妈妈转200')} />
          <button type="submit" className="site-button" disabled={!ask.trim() || demo.busy}>{demo.busy ? tr('Opening…', '正在开通…') : tr('Go', '去办')}</button>
        </form>
        <p className="lx-small" data-rise>{signedIn ? tr('A simulated bank for the competition. No real money moves.', '参赛演示用的模拟银行，不涉及真实资金。')
          : <>{tr('Opens a demo account with its own simulated bank. ', '会为你开一个自带模拟银行的演示账户。')}<Link to="/signup">{tr('Or create your own account', '或者注册自己的账户')}</Link></>}</p>
        </div>
        <div className="lx-chips" data-rise>
          <p>{tr('Or start with one of these:', '或者从这几句开始：')}</p>
          {[tr("What's my balance?", '我卡里还有多少钱'), tr('Anything suspicious this month?', '这个月有没有可疑交易'), tr('Freeze my virtual card', '冻结我的虚拟卡'), tr('Cancel iQIYI', '取消爱奇艺会员'), tr('Pay the electricity bill', '把电费交了')].map((text) => (
            <button key={text} type="button" disabled={demo.busy} onClick={() => tryIt(text)}><span>{text}</span><span aria-hidden>›</span></button>
          ))}
        </div>
      </section>
    </main>
    <SiteFooter />
  </div>
}
