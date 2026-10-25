import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeftRight, ArrowUp, Banknote, Bell, CalendarCheck, ChartPie, Check, CreditCard, Gift, Globe, HandCoins, Landmark,
  Lock, Mic, PiggyBank, QrCode, Receipt, Repeat, Send, ShieldCheck, Smartphone, Snowflake, TrendingUp, Wallet, type LucideIcon,
} from 'lucide-react'
import { useLang } from '../i18n'
import { SiteFooter, SiteHeader } from '../components/SiteChrome'
import { Seal } from '../components/Seal'
import { getAdminToken } from '../api/client'
import { useAuth, useStartDemo } from '../lib/auth'
import { reduceMotion, useRise } from '../lib/motion'
import '../landing.css'

// hash routes own the URL fragment, so in-page links scroll instead of changing location.hash
const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' })
const yuan = (v: number) => '¥' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const wait = (ms: number) => new Promise((done) => window.setTimeout(done, ms))

/** True while the element is on screen, so loops only run where someone can see them. */
function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) { setOn(true); return }
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, on] as const
}

/** A demo's playhead: each step waits its pause, then the next; after the last, a new round starts at 0.
 *  It runs only while `on`, stops for good once the visitor takes over (`held`), and with reduced motion
 *  rests on the step `rest` (the finished picture, by default). */
function useLoop(pauses: number[], on: boolean, held = false, rest = pauses.length - 1) {
  const [step, setStep] = useState(reduceMotion() ? rest : 0)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!on || held || reduceMotion()) return
    const timer = window.setTimeout(() => {
      if (step >= pauses.length - 1) { setStep(0); setRound((r) => r + 1) } else setStep(step + 1)
    }, pauses[step])
    return () => window.clearTimeout(timer)
  }, [step, round, on, held])
  return { step, round }
}

/** A number that glides to its new value instead of jumping, rounded to `grain`. */
function useTween(value: number, grain = 1, ms = 700) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (reduceMotion()) { from.current = value; setShown(value); return }
    const start = from.current, t0 = performance.now()
    let frame = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      from.current = start + (value - start) * (1 - (1 - k) ** 3)
      setShown(Math.round(from.current / grain) * grain)
      if (k < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, grain, ms])
  return shown
}

/** Counts up from zero once `run` turns on. */
function CountUp({ to, run }: { to: number; run: boolean }) {
  const [v, setV] = useState(reduceMotion() ? to : 0)
  useEffect(() => {
    if (!run || reduceMotion()) return
    const t0 = performance.now()
    let frame = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 1600)
      setV(to * (1 - (1 - k) ** 3))
      if (k < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [run, to])
  return <>{yuan(v)}</>
}

/** Types its text out, one character at a time. */
function Typed({ text }: { text: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (n >= text.length) return
    const timer = window.setTimeout(() => setN(n + 1), 70)
    return () => window.clearTimeout(timer)
  }, [n, text])
  return <>{text.slice(0, n)}<i className="lx-caret" aria-hidden /></>
}

/* ---------- hero ---------- */

type Scene = { icon: LucideIcon; ask: string; title: string; rows: [string, string][]; big: number; done: string; confirm: boolean; sms?: boolean }

/** Four real requests on a loop: ask, check the card, confirm, done. The icon each one uses lights up in the orbit. */
function HeroStage() {
  const { tr } = useLang()
  const [ref, on] = useOnScreen<HTMLDivElement>()
  const scenes: Scene[] = [
    { icon: Send, ask: tr('Send Mom 200', '给妈妈转200'), title: tr('Please confirm', '请确认'), big: 2, confirm: true, sms: true,
      rows: [[tr('To', '收款人'), tr('Wang Xiuying (Mom)', '王秀英（妈妈）')], [tr('Account', '收款账户'), tr('ICBC ****7801', '中国工商银行 ****7801')], [tr('Amount', '金额'), '¥200.00']],
      done: tr('Sent ¥200.00 to Wang Xiuying. It has arrived.', '已向 王秀英 转账 ¥200.00，已到账。') },
    { icon: Snowflake, ask: tr('Freeze my online card', '冻结我的网购卡'), title: tr('Please confirm', '请确认'), big: -1, confirm: true,
      rows: [[tr('Card', '卡片'), tr('Online shopping card •••• 8831', '网购虚拟卡 •••• 8831')], [tr('Effect', '效果'), tr('All payments stop', '所有交易暂停')], [tr('Undo', '恢复'), tr('Any time, in one sentence', '随时一句话解冻')]],
      done: tr('Card •••• 8831 is frozen.', '尾号 8831 的卡已冻结。') },
    { icon: Receipt, ask: tr('Pay the electricity bill', '把电费交了'), title: tr('Please confirm', '请确认'), big: 2, confirm: true,
      rows: [[tr('To', '缴费单位'), tr('State Grid · electricity', '国家电网 · 电费')], [tr('Period', '账期'), tr('September', '9 月')], [tr('Amount', '金额'), '¥186.40']],
      done: tr('Paid ¥186.40 to State Grid.', '已向国家电网缴费 ¥186.40。') },
    { icon: ChartPie, ask: tr('Where did my money go last month?', '上个月钱都花哪了'), title: tr('September · spent', '9 月 · 支出'), big: 0, confirm: false,
      rows: [[tr('Total', '合计'), '¥10,879.70'], [tr('Housing', '住房'), '¥3,200.00'], [tr('Dining', '餐饮'), '¥2,516.00']],
      done: tr('The largest is the rent: ¥3,200.00 to Zhao Jianhua, 29% of the month.', '最大一笔是房租：转给赵建华 ¥3,200.00，占当月 29%。') },
  ]
  const { step, round } = useLoop([700, 1000, 1500, 300, 900, 2800], on)
  const sc = scenes[round % scenes.length]
  const inner: LucideIcon[] = [Send, Snowflake, Receipt, ChartPie, QrCode, PiggyBank, ShieldCheck, ArrowLeftRight]
  const outer: LucideIcon[] = [Wallet, CreditCard, Banknote, Landmark, HandCoins, Globe, Bell, CalendarCheck, TrendingUp, Smartphone, Lock, Gift]
  const ring = (icons: LucideIcon[], which: string) => (
    <div className={`lx-ring ${which}`} aria-hidden>
      {icons.map((Icon, k) => (
        <span key={k} className="lx-orb" style={{ ['--a' as string]: `${(360 / icons.length) * k}deg` }}>
          <span className={`lx-orb-icon ${Icon === sc.icon ? 'is-lit' : ''}`}><Icon /></span>
        </span>
      ))}
    </div>
  )
  return (
    <div className="lx-hero-stage" ref={ref}>
      {ring(outer, 'is-outer')}
      {ring(inner, 'is-inner')}
      <div className="lx-chat" data-ui aria-label={tr('Examples of requests, playing on a loop', '请求示例，循环播放')}>
        <div className="lx-chat-log">
          <p className="lx-bubble lx-me" key={`ask${round}`}>{sc.ask}</p>
          {step === 1 && <p className="lx-typing" aria-hidden><i /><i /><i /></p>}
          {step >= 2 && (
            <div className={`lx-confirm ${sc.confirm && step >= 4 ? 'is-done' : ''}`} key={`card${round}`}>
              <div className="lx-confirm-head">
                <b>{sc.confirm && step >= 4 ? tr('Done', '已办好') : sc.title}</b>
                {sc.confirm && (step < 4 ? <span className="lx-tag">{tr('Needs your OK', '需确认')}</span> : <Seal kind="done" size={44} />)}
              </div>
              <dl>{sc.rows.map(([k, v], i) => <div key={k}><dt>{k}</dt><dd className={i === sc.big ? 'lx-amount' : ''}>{v}</dd></div>)}</dl>
              {sc.confirm && step < 4 && <div className="lx-confirm-actions"><span className={`lx-ui-btn ${step === 3 ? 'is-pressed' : ''}`}>{tr('Confirm', '确认')}</span><span className="lx-ui-btn lx-ui-line">{tr('Cancel', '取消')}</span></div>}
            </div>
          )}
          {step >= 4 && <p className="lx-bubble lx-bot" key={`done${round}`}>{sc.done}</p>}
        </div>
        <div className="lx-chat-input"><span>{tr('What do you need?', '说说你要办的事…')}</span><i aria-hidden><Mic size={15} /></i></div>
      </div>
      <div className={`lx-sms ${sc.sms && step >= 5 ? 'is-shown' : ''}`} aria-hidden={!(sc.sms && step >= 5)}>
        <p className="lx-sms-who">{tr('Mom’s phone · Messages', '妈妈的手机 · 短信')}</p>
        <p>{tr('[ICBC] Your account ending 7801 received RMB 200.00 from Li Ming.', '【中国工商银行】您尾号7801的账户收到李明转账人民币200.00元。')}</p>
      </div>
    </div>
  )
}

/** Real requests scrolling past in two rows, each in both languages. Tap one to send it. */
function SayStrip({ tryIt, busy }: { tryIt: (s: string) => void; busy: boolean }) {
  const { tr } = useLang()
  const says: [LucideIcon, string, string][] = [
    [Send, 'Send Mom 200', '给妈妈转200'], [Snowflake, 'I lost my card', '我的卡丢了'], [ChartPie, 'Where did my money go last month?', '上个月钱都花哪了'],
    [Receipt, 'Pay the electricity bill', '把电费交了'], [Repeat, 'What am I paying for every month?', '我有哪些自动续费'], [PiggyBank, '100000 for a year: what should I buy?', '有10万一年不用，推荐个理财'],
    [ShieldCheck, 'Anything suspicious this month?', '这个月有没有可疑交易'], [Wallet, "What's my balance?", '我卡里还有多少钱'], [Globe, 'Turn on overseas payments', '开通境外支付'],
    [ArrowLeftRight, 'Send Zhang Wei 300', '给张伟转300'], [CreditCard, 'Freeze my virtual card', '冻结我的虚拟卡'], [Gift, 'My wife’s birthday is next month, help me prepare', '下个月老婆生日，帮我准备一下'],
  ]
  const rows = [says.slice(0, 6), says.slice(6)]
  return (
    <section className="lx-say" aria-label={tr('Things you can say', '可以这样说')}>
      <p className="lx-say-head">{tr('Say it your way, in either language', '中文英文，怎么说都行')}</p>
      {rows.map((row, r) => (
        <div key={r} className={`lx-marquee ${r ? 'is-reverse' : ''}`}>
          <div className="lx-marquee-track">
            {[0, 1].map((copy) => row.map(([Icon, en, zh]) => (
              <button key={`${copy}${en}`} type="button" className="lx-say-chip" disabled={busy} onClick={() => tryIt(tr(en, zh))}
                tabIndex={copy ? -1 : undefined} aria-hidden={copy ? true : undefined}>
                <span className="lx-say-icon"><Icon size={15} /></span>{tr(en, zh)}<span className="lx-say-other">{tr(zh, en)}</span>
              </button>
            )))}
          </div>
        </div>
      ))}
    </section>
  )
}

/* ---------- the tiles: each one plays its request on a loop, and the interactive ones hand over to the visitor ---------- */

/** A tile of the grid: the product doing it on top, the claim and a sentence to try below. */
function Tile({ id, size = '', title, text, say, tryIt, busy, children }: {
  id?: string; size?: string; title: string; text: string; say: string; tryIt: (s: string) => void; busy: boolean; children: (on: boolean) => ReactNode
}) {
  const { tr } = useLang()
  const [ref, on] = useOnScreen<HTMLElement>()
  // React owns this element's class list (is-live changes), so the rise's `in` is kept here instead of by useRise
  const seen = useRef(false)
  if (on) seen.current = true
  const spot = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  return (
    <article id={id} ref={ref} className={`lx-tile ${size} ${on ? 'is-live' : ''} ${seen.current ? 'in' : ''}`} onPointerMove={spot} data-rise>
      <div className="lx-tile-ui" data-ui>{children(on)}</div>
      <div className="lx-tile-copy">
        <h3>{title}</h3>
        <p>{text}</p>
        <button type="button" className="lx-link" disabled={busy} onClick={() => tryIt(say)}>{tr('Try', '试试')} “{say}”<span aria-hidden> ›</span></button>
      </div>
    </article>
  )
}

/** Two contacts share a name: the request types itself, the bank asks, a pointer picks. Tap one to take over. */
function TransferDemo({ on }: { on: boolean }) {
  const { tr } = useLang()
  const [mine, setMine] = useState<number | null>(null)
  const ask = tr('Send Zhang Wei 300', '给张伟转300')
  const { step } = useLoop([500, ask.length * 70 + 500, 900, 1100, 3200], on, mine !== null)
  const options: [string, string, string][] = [
    [tr('Zhang Wei', '张伟'), tr('university friend', '大学同学'), tr('China Construction Bank ****5678', '中国建设银行 ****5678')],
    [tr('Zhang Wei', '张薇'), tr('colleague, finance', '同事（财务）'), tr('Bank of Communications ****9876', '交通银行 ****9876')],
  ]
  const typed = mine !== null || step >= 2
  const picked = mine ?? (step >= 4 ? 0 : -1)
  return (
    <div className="lx-ui lx-ui-question">
      <p className="lx-bubble lx-me lx-typed">{typed ? ask : step === 1 ? <Typed text={ask} /> : <i className="lx-caret" aria-hidden />}</p>
      <div className={`lx-ui-card lx-reveal ${typed ? 'is-shown' : ''}`}>
        <p className="lx-ui-title">{tr('“Zhang Wei” matches two contacts. Which one?', '“张伟”对应两位联系人，是哪一位？')}</p>
        <div className="lx-ui-options is-pair" role="radiogroup" aria-label={tr('Choose a contact', '选择联系人')}>
          {options.map(([name, who, bank], i) => (
            <button key={i} type="button" role="radio" aria-checked={picked === i} className={picked === i ? 'is-on' : ''} onClick={() => setMine(i)}>
              <b>{name} · {who}</b><span>{bank}</span>
              {i === 0 && mine === null && <span className={`lx-cursor ${step === 3 ? 'is-moving' : step === 4 ? 'is-there' : ''}`} aria-hidden />}
            </button>
          ))}
        </div>
        <p className={`lx-ui-note is-ok ${picked >= 0 ? 'is-shown' : ''}`}><Check size={14} aria-hidden /> {picked >= 0
          ? tr(`¥300.00 to ${options[picked][0]} (${options[picked][1]}), waiting for your OK`, `向 ${options[picked][0]}（${options[picked][1]}）转账 ¥300.00，等你确认`)
          : ' '}</p>
      </div>
    </div>
  )
}

/** The online card's switches. They work; until someone touches them, the card freezes and thaws on its own. */
function CardDemo({ on: live }: { on: boolean }) {
  const { tr } = useLang()
  type Switches = { online: boolean; overseas: boolean; atm: boolean; contactless: boolean }
  const [mine, setMine] = useState<{ frozen: boolean; on: Switches } | null>(null)
  const { step } = useLoop([1800, 2800], live, mine !== null, 0)
  const auto = { frozen: step === 1, on: { online: true, overseas: false, atm: false, contactless: false } }
  const { frozen, on } = mine ?? auto
  const labels: [keyof Switches, string][] = [['online', tr('Online payments', '网上支付')], ['overseas', tr('Overseas', '境外交易')], ['atm', tr('ATM', 'ATM 取现')], ['contactless', tr('Contactless', '闪付')]]
  return (
    <div className={`lx-ui lx-ui-card-controls ${frozen ? 'is-frozen' : ''}`}>
      <div className="lx-ui-plastic">
        <b>{tr('Online shopping card', '网购虚拟卡')}</b>
        <span>•••• 8831</span>
        <em>{frozen ? tr('Frozen', '已冻结') : tr('Active · ¥3,000.00 a day', '正常 · 每日 ¥3,000.00')}</em>
        <i className="lx-frost" aria-hidden><Snowflake /></i>
      </div>
      <ul>
        {labels.map(([key, label]) => (
          <li key={key}>
            <span>{label}</span>
            <button type="button" role="switch" aria-checked={on[key] && !frozen} disabled={frozen} aria-label={label}
              className={`lx-switch ${on[key] && !frozen ? 'is-on' : ''}`} onClick={() => setMine({ frozen, on: { ...on, [key]: !on[key] } })}><i /></button>
          </li>
        ))}
      </ul>
      <button type="button" className="lx-ui-btn lx-ui-wide" onClick={() => setMine({ frozen: !frozen, on })}>{frozen ? tr('Unfreeze', '解冻') : tr('Freeze card', '冻结卡片')}</button>
    </div>
  )
}

/** Last month by category, as the demo bank answers it: the total counts up, the bars and the share of rent grow. */
function SpendingDemo({ on }: { on: boolean }) {
  const { tr } = useLang()
  const { round } = useLoop([9000], on)
  const rows: [string, number][] = [
    [tr('Housing', '住房'), 3200], [tr('Dining', '餐饮'), 2516], [tr('Travel', '出行旅游'), 1753],
    [tr('Groceries', '日用超市'), 1096], [tr('Family', '家人'), 800],
  ]
  const max = Math.max(...rows.map(([, v]) => v))
  return (
    <div className="lx-ui lx-ui-spend" key={round}>
      <div className="lx-ui-head">
        <div><b>{tr('September · spent', '9 月 · 支出')}</b><p className="lx-ui-total"><CountUp to={10879.7} run={on} /></p></div>
        <div className="lx-donut">
          <svg viewBox="0 0 160 160" aria-hidden><circle cx="80" cy="80" r="64" /><circle cx="80" cy="80" r="64" className="is-share" /></svg>
          <p><b>29%</b>{tr('rent', '房租')}</p>
        </div>
      </div>
      <ul>
        {rows.map(([name, v], i) => (
          <li key={name} style={{ ['--k' as string]: i }}>
            <span className="lx-ui-name">{name}</span>
            <span className="lx-ui-bar"><i style={{ width: `${(v / max) * 100}%` }} className={i === 0 ? 'is-top' : ''} /></span>
            <span className="lx-ui-val">{yuan(v)}</span>
          </li>
        ))}
      </ul>
      <p className="lx-ui-note">{tr('The largest is the rent: ¥3,200.00 to Zhao Jianhua.', '最大一笔是房租：转给赵建华 ¥3,200.00。')}</p>
    </div>
  )
}

/** Every automatic charge, read one by one, until the two music memberships turn up side by side. */
function SubscriptionsDemo({ on }: { on: boolean }) {
  const { tr } = useLang()
  const rows: [string, string, boolean][] = [
    [tr('Ledongli Fitness', '乐动力健身'), '¥199.00', false],
    [tr('China Telecom broadband', '中国电信 宽带'), '¥99.00', false],
    [tr('Tencent Video VIP', '腾讯视频VIP会员'), '¥30.00', false],
    [tr('iQIYI VIP', '爱奇艺VIP会员'), '¥25.00', false],
    [tr('NetEase Cloud Music', '网易云音乐 黑胶VIP'), '¥15.00', true],
    [tr('QQ Music', 'QQ音乐 绿钻'), '¥15.00', true],
  ]
  const { step } = useLoop([500, ...rows.map(() => 380), 3200], on)
  const found = step > rows.length
  return (
    <div className="lx-ui lx-ui-subs">
      <ul>{rows.map(([name, fen, dup], i) => (
        <li key={name} className={`${step === i + 1 ? 'is-reading' : ''} ${dup && step > i + 1 ? 'is-flag' : ''}`}><b>{name}</b><span className="lx-ui-val">{fen}</span></li>
      ))}</ul>
      <p className={`lx-save ${found ? 'is-shown' : ''}`}>{tr('Two music memberships. Cancel one to save ¥180.00 a year.', '有两个音乐会员，取消一个每年省 ¥180.00。')}</p>
    </div>
  )
}

/** One sentence, three steps across three kinds of banking, ticked off in turn. */
function PlanDemo({ on }: { on: boolean }) {
  const { tr } = useLang()
  const steps: [string, string, 'done' | 'set' | 'wait'][] = [
    [tr('Look up Chen Jing’s birthday', '查找陈静的生日'), tr('In 35 days', '还有 35 天'), 'done'],
    [tr('Set aside ¥1,000.00 for the gift', '预留 ¥1,000.00 买礼物'), tr('From the current account', '从活期账户'), 'set'],
    [tr('Order flowers and a cake', '订鲜花和蛋糕'), tr('Two days before, delivered home', '提前两天，送货到家'), 'wait'],
  ]
  const state = { done: tr('Done', '已完成'), set: tr('Set aside', '已预留'), wait: tr('Scheduled', '已安排') }
  const { step } = useLoop([700, 1100, 1100, 2800], on)
  return (
    <div className="lx-ui lx-ui-plan">
      <p className="lx-bubble lx-me">{tr('My wife’s birthday is next month, help me prepare', '下个月老婆生日，帮我准备一下')}</p>
      <ol style={{ ['--p' as string]: Math.max(0, step - 1) / (steps.length - 1) }}>
        {steps.map(([what, detail, s], i) => (
          <li key={what} className={step > i ? 'is-on' : ''}>
            <span className="lx-ui-dot" aria-hidden><Check size={13} /></span>
            <span><b>{what}</b><small>{detail}</small></span>
            <em>{state[s]}</em>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The risk scale: the needle sweeps up and settles on the customer's level, and what lies above it drops out. */
function WealthDemo({ on }: { on: boolean }) {
  const { tr } = useLang()
  const { step } = useLoop([600, 900, 3600], on)
  const angle = [-90, 70, -36][step]
  const products: [string, string, string, boolean][] = [
    [tr('Steady Money Market A', '稳享货币A'), 'R1', '1.62%', false],
    [tr('Anying Short-term Bond', '安盈短债'), 'R2', '2.45%', false],
    [tr('Tech Growth Equity', '科技成长股票'), 'R4', '', true],
  ]
  const arcs: [string, string][] = [
    ['M20 100 A80 80 0 0 1 35.3 53', 'r1'], ['M37.5 49.5 A80 80 0 0 1 75.3 24', 'r2'], ['M79.5 22.7 A80 80 0 0 1 120.5 22.7', 'r3'],
    ['M124.7 24 A80 80 0 0 1 162.5 49.5', 'r4'], ['M164.7 53 A80 80 0 0 1 180 100', 'r5'],
  ]
  return (
    <div className="lx-ui lx-ui-gauge">
      <svg viewBox="0 0 200 108" aria-hidden>
        {arcs.map(([d, c]) => <path key={c} d={d} className={`lx-arc is-${c}`} />)}
        <g className="lx-needle" style={{ transform: `rotate(${angle}deg)` }}><line x1="100" y1="100" x2="100" y2="36" /><circle cx="100" cy="100" r="7" /></g>
      </svg>
      <p className="lx-gauge-label">{tr('Your risk test', '你的风险测评')} <b>R2</b></p>
      <ul>{products.map(([name, risk, y, above]) => (
        <li key={name} className={above && step === 2 ? 'is-out' : ''}>
          <span>{name} · {risk}</span>{above ? <Lock size={14} aria-label={tr('Above your level', '超出你的等级')} /> : <span className="lx-ui-yield">{y}</span>}
        </li>
      ))}</ul>
    </div>
  )
}

/** A bill found by name: the amount appears, the confirm is pressed, the paid stamp lands. */
function BillDemo({ on }: { on: boolean }) {
  const { tr } = useLang()
  const { step } = useLoop([1400, 400, 3400], on)
  return (
    <div className={`lx-ui lx-ui-bill ${step === 2 ? 'is-paid' : ''}`}>
      <div className="lx-ui-bill-head"><span className="lx-ui-bill-icon"><Receipt size={18} /></span><span><b>{tr('State Grid', '国家电网')}</b><small>{tr('Electricity · September', '电费 · 9 月')}</small></span></div>
      <p className="lx-ui-bill-amount">¥186.40</p>
      {step === 2
        ? <div className="lx-ui-bill-stamp"><Seal kind="done" size={64} /><span>{tr('Paid from the current account', '已从活期账户缴清')}</span></div>
        : <span className={`lx-ui-btn lx-ui-wide ${step === 1 ? 'is-pressed' : ''}`}>{tr('Confirm', '确认')}</span>}
    </div>
  )
}

/** Drag an amount and see which of the bank's rules applies. Until someone does, it walks through all three.
 *  The thresholds are the bank's own. */
function RuleDemo({ on }: { on: boolean }) {
  const { tr } = useLang()
  const [mine, setMine] = useState<{ amount: number; fresh: boolean } | null>(null)
  const tiers = [{ amount: 200, fresh: false }, { amount: 1500, fresh: false }, { amount: 700, fresh: true }]
  const { step } = useLoop([3200, 3200, 3600], on, mine !== null, 0)
  const glide = useTween(tiers[step].amount, 50)
  const amount = mine ? mine.amount : glide
  const fresh = mine ? mine.fresh : tiers[step].fresh
  const strong = amount > 1000 || (fresh && amount > 500)
  const waits = fresh && amount > 500
  const tone = waits ? 'is-wait' : strong ? 'is-strong' : 'is-tap'
  const figure = waits ? tr('2 hrs', '2 小时') : strong ? tr('PIN + code', '密码+验证码') : tr('1 tap', '点一下')
  const result = waits
    ? tr('It needs your PIN and a code, then arrives two hours later, so you can still cancel it.', '需要交易密码和验证码，并在 2 小时后到账，到账前还能撤销。')
    : strong
      ? tr('Over ¥1,000 today: your PIN and an SMS code, or a passkey. Then it arrives now.', '今天超过 ¥1,000：需要交易密码加短信验证码，或通行密钥，然后实时到账。')
      : tr('Your tap on Confirm is enough. It arrives now.', '你点“确认”就行，实时到账。')
  return (
    <div className="lx-check">
      <div className="lx-check-control">
        <label htmlFor="lx-amount">
          <span>{tr('Today’s payments', '今日累计付款')}</span>
          <output htmlFor="lx-amount">¥{amount.toLocaleString('en-US')}.00</output>
        </label>
        <input id="lx-amount" type="range" min={50} max={3000} step={50} value={amount} onChange={(e) => setMine({ amount: Number(e.target.value), fresh })}
          style={{ ['--fill' as string]: `${((amount - 50) / 2950) * 100}%` }} />
        <div className="lx-check-row">
          <span id="lx-fresh-label">{tr('To someone added today', '收款人是今天新加的')}</span>
          <button type="button" role="switch" aria-checked={fresh} aria-labelledby="lx-fresh-label" className={`lx-switch ${fresh ? 'is-on' : ''}`} onClick={() => setMine({ amount, fresh: !fresh })}><i /></button>
        </div>
      </div>
      <div className="lx-check-result">
        <p className={`lx-figure ${tone}`} aria-live="polite" key={figure}>{figure}</p>
        <p className="lx-check-why">{result} {tr('Up to ¥1,000 a day, and up to ¥500 to a new contact, needs only your tap.', '每天累计 ¥1,000 以内、给新联系人 ¥500 以内，只需你点一下。')}</p>
      </div>
    </div>
  )
}

/* ---------- ask, check, done ---------- */

/** The three steps of a payment in a row; a coin travels along them as the page scrolls, lighting each it reaches. */
function Journey() {
  const { tr } = useLang()
  const ref = useRef<HTMLDivElement>(null)
  const [reached, setReached] = useState(reduceMotion() ? 3 : 1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduceMotion()) { el.style.setProperty('--jp', '1'); return }
    let frame = 0
    const update = () => {
      frame = 0
      // 0 when the row's top is 85% down the screen, 1 once it has climbed to 25%
      const p = Math.max(0, Math.min(1, (window.innerHeight * 0.85 - el.getBoundingClientRect().top) / (window.innerHeight * 0.6)))
      el.style.setProperty('--jp', p.toFixed(3))
      setReached(1 + Number(p >= 0.5) + Number(p >= 0.98))
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [])
  const stops: [LucideIcon, string, string, ReactNode][] = [
    [Mic, tr('First, you say it.', '首先，你说一句。'), tr('In your own words, Chinese or English.', '用你自己的话，中文英文都行。'),
      <><p>{tr('Transfer ¥200.00 to Wang Xiuying (Mom), ICBC ****7801', '向 王秀英（妈妈）转账 ¥200.00，中国工商银行 ****7801')}</p><small>{tr('The AI only proposes this. It cannot move money.', 'AI 只能提议，自己动不了钱。')}</small></>],
    [ShieldCheck, tr('Then, the bank’s rules check it.', '然后，银行的规则来检查。'), tr('Limits, new contacts and odd patterns, checked in code, not by the AI.', '限额、新联系人、异常模式，由代码检查，不由 AI 决定。'),
      <><div className="lx-meter"><span>{tr('Today’s payments', '今日累计')}</span><b>¥200.00 / ¥1,000.00</b><span className="lx-meter-track"><i style={{ width: '20%' }} /></span></div>
        <small>{tr('Under the daily limit, to a saved contact: your OK is enough.', '未超过每日额度，收款人是老联系人：你点头就行。')}</small></>],
    [Check, tr('Finally, you say yes.', '最后，由你点头。'), tr('Then it moves, and both of you get the proof.', '然后钱才动，双方都收到凭证。'),
      <><div className="lx-receipt"><Seal kind="done" size={56} animate={false} /><div><p className="lx-receipt-amount">¥200.00</p><p>{tr('Sent to Wang Xiuying · arrived 12:41', '已转给 王秀英 · 12:41 到账')}</p></div></div>
        <div className="lx-sms is-shown is-static"><p className="lx-sms-who">{tr('Mom’s phone · Messages', '妈妈的手机 · 短信')}</p><p>{tr('[ICBC] Your account ending 7801 received RMB 200.00 from Li Ming.', '【中国工商银行】您尾号7801的账户收到李明转账人民币200.00元。')}</p></div></>],
  ]
  return (
    <div className="lx-journey" ref={ref}>
      <div className="lx-path" aria-hidden><span className="lx-path-fill" /><span className="lx-coin"><Banknote size={20} /></span></div>
      <ol className="lx-stops">
        {stops.map(([Icon, title, text, ui], i) => (
          <li key={title} className={`lx-stop ${i < reached ? 'is-on' : ''}`}>
            <span className="lx-stop-badge" aria-hidden><Icon /></span>
            <h3>{title}</h3>
            <p>{text}</p>
            <div className="lx-stop-ui" data-ui>{ui}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The ask box's placeholder types out example requests while the box is empty and not in use. */
function useTypedPlaceholder(examples: string[], paused: boolean, fallback: string) {
  const [text, setText] = useState(fallback)
  const hold = useRef(paused)
  hold.current = paused
  const key = examples.join('|')
  useEffect(() => {
    setText(fallback)
    if (reduceMotion()) return
    let stop = false
    void (async () => {
      await wait(1200)
      for (let k = 0; !stop; k = (k + 1) % examples.length) {
        while (hold.current && !stop) await wait(400)
        const ex = examples[k]
        for (let n = 1; n <= ex.length && !stop; n++) { setText(ex.slice(0, n)); await wait(70) }
        await wait(1800)
        for (let n = ex.length; n >= 0 && !stop; n--) { setText(ex.slice(0, n)); await wait(28) }
        await wait(300)
      }
    })()
    return () => { stop = true }
  }, [key])
  return text || fallback
}

export default function LandingPage() {
  const { tr, t } = useLang()
  const { user } = useAuth()
  const signedIn = !!user || !!getAdminToken()
  const navigate = useNavigate()
  const demo = useStartDemo()
  const [ask, setAsk] = useState('')
  const [askFocus, setAskFocus] = useState(false)
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
  const placeholder = useTypedPlaceholder(
    [tr('Send Mom 200', '给妈妈转200'), tr('I lost my card', '我的卡丢了'), tr('Where did my money go last month?', '上个月钱都花哪了'), tr('Pay the electricity bill', '把电费交了'), tr('Cancel iQIYI', '取消爱奇艺会员')],
    askFocus || !!ask, tr('e.g. Send Mom 200', '例如：给妈妈转200'))
  const wordmark = tr(t.brand_en, t.brand)

  return <div className="public-site lx">
    <SiteHeader />
    <main id="main-content" tabIndex={-1}>
      <div className="lx-hero-wrap">
        <section className="lx-hero" aria-labelledby="lx-title">
          <div className="lx-hero-copy">
            <h1 id="lx-title" className="lx-h1">
              <span className="lx-line"><span>{tr('Say it once.', '你说一句，')}</span></span>
              <span className="lx-line"><span className="lx-accent">{tr('We do it.', '我来办。')}</span></span>
            </h1>
            <p className="lx-lede">{tr('Banking you can talk to. Say what you need in Chinese or English; the bank checks it, and nothing moves until you say yes.', '能对话的银行。中文英文都行，说出你要办的事；银行先检查，你点头之前，钱一分不动。')}</p>
            <div className="lx-actions">
              <button type="button" className="site-button" disabled={demo.busy} onClick={() => void go('/home')}>{start}</button>
              <button type="button" className="lx-link" onClick={() => scrollToId('features')}>{tr('See what it does', '看看能做什么')}<span aria-hidden> ›</span></button>
            </div>
            {demo.error && <p role="alert" className="lx-error">{demo.error}</p>}
            <p className="lx-small">{tr('A simulated bank with made-up money. No real bank is connected.', '模拟银行，演示用的钱，不连接任何真实银行。')}</p>
          </div>
          <HeroStage />
        </section>
      </div>

      <SayStrip tryIt={tryIt} busy={demo.busy} />

      <section className="lx-section" id="features" aria-labelledby="features-h">
        <header className="lx-head" data-rise>
          <h2 id="features-h" className="lx-h2">{tr('Six kinds of banking. One sentence each.', '六类业务，一句话就办。')}</h2>
          <p className="lx-lede">{tr('Each tile is a real request and the demo bank’s real answer, playing on its own. Tap Try to send it yourself.', '每一格都是真实请求和演示银行的真实回答，自动播放。点“试试”，自己发一次。')}</p>
        </header>
        <div className="lx-bento">
          <Tile size="is-wide" title={tr('Pay people by the name you call them.', '按你平时的叫法转账。')} text={tr('Name, nickname, phone number, or what they are to you. When two contacts share a name, it asks which one.', '姓名、昵称、手机号，或者“妈妈”“房东”都行。重名时，它会问你是哪一位。')}
            say={tr('Send Zhang Wei 300', '给张伟转300')} tryIt={tryIt} busy={demo.busy}>{(on) => <TransferDemo on={on} />}</Tile>
          <Tile title={tr('Freeze a card in one sentence.', '一句话冻结卡片。')} text={tr('Switch payment types on and off, or report a card lost.', '开关各类支付，或者挂失。')}
            say={tr('I lost my card', '我的卡丢了')} tryIt={tryIt} busy={demo.busy}>{(on) => <CardDemo on={on} />}</Tile>
          <Tile title={tr('See where the money went.', '看清钱花在哪了。')} text={tr('Spending by category, unusual charges flagged, and a report for any month or year.', '按类别看支出，异常消费会被标出，任意月份、年份都能出报告。')}
            say={tr('Where did my money go last month?', '上个月钱都花哪了')} tryIt={tryIt} busy={demo.busy}>{(on) => <SpendingDemo on={on} />}</Tile>
          <Tile title={tr('Find every automatic charge.', '找出每一笔自动扣费。')} text={tr('Memberships and direct debits in one list, with the ones you pay for twice.', '会员和代扣一张清单看完，重复订阅一眼就能发现。')}
            say={tr('What am I paying for every month?', '我有哪些自动续费')} tryIt={tryIt} busy={demo.busy}>{(on) => <SubscriptionsDemo on={on} />}</Tile>
          <Tile size="is-wide" title={tr('Several steps from one sentence.', '一句话，跨业务办好几步。')} text={tr('It plans across contacts, savings and shopping, and asks you once for the whole plan.', '跨联系人、预留资金和下单统一规划，整个计划只问你一次。')}
            say={tr('My wife’s birthday is next month, help me prepare', '下个月老婆生日，帮我准备一下')} tryIt={tryIt} busy={demo.busy}>{(on) => <PlanDemo on={on} />}</Tile>
          <Tile title={tr('Savings, at your risk level.', '理财，按你的风险等级来。')} text={tr('It never suggests a product above your risk test.', '不会推荐超出你风险测评的产品。')}
            say={tr('100000 for a year: what should I buy?', '有10万一年不用，推荐个理财')} tryIt={tryIt} busy={demo.busy}>{(on) => <WealthDemo on={on} />}</Tile>
          <Tile title={tr('Pay a bill by naming it.', '说一声，账单就交了。')} text={tr('Electricity, water, gas, phone and broadband. It finds the bill and the amount.', '电费、水费、燃气、话费、宽带，它会找到账单和金额。')}
            say={tr('Pay the electricity bill', '把电费交了')} tryIt={tryIt} busy={demo.busy}>{(on) => <BillDemo on={on} />}</Tile>
          <Tile id="check" size="is-wider" title={tr('The AI proposes. The bank’s rules decide.', 'AI 只提议，银行规则来定。')} text={tr('Drag the amount: bigger or newer payments ask for more.', '拖动金额试试：金额越大、收款人越新，要求越多。')}
            say={tr('Send Mom 1500', '给妈妈转1500')} tryIt={tryIt} busy={demo.busy}>{(on) => <RuleDemo on={on} />}</Tile>
        </div>
      </section>

      <section className="lx-section" id="steps" aria-labelledby="steps-h">
        <header className="lx-head" data-rise>
          <h2 id="steps-h" className="lx-h2">{tr('Ask. Check. Done.', '说。核对。办好。')}</h2>
          <p className="lx-lede">{tr('Follow the coin. Nothing reaches the next step until the one before it says so.', '跟着这枚硬币走。上一步不放行，下一步就不会发生。')}</p>
        </header>
        <Journey />
      </section>

      <section className="lx-section" id="ask" aria-labelledby="ask-h">
        <div className="lx-ask" data-rise>
          <span className="lx-ask-floaters" aria-hidden><Wallet /><CreditCard /><PiggyBank /><Landmark /></span>
          <h2 id="ask-h" className="lx-h2">{tr('Just say it.', '直接说。')}</h2>
          <p className="lx-lede">{tr('A demo bank opens in a second, with two years of made-up history. Type what you need.', '一秒开好演示银行，自带两年的模拟流水。说说你要办的事。')}</p>
          <form onSubmit={(e) => { e.preventDefault(); if (ask.trim()) tryIt(ask.trim()) }} className="lx-askbox">
            <input value={ask} onChange={(e) => setAsk(e.target.value)} onFocus={() => setAskFocus(true)} onBlur={() => setAskFocus(false)}
              maxLength={200} aria-label={tr('What do you need?', '想办什么')} placeholder={placeholder} />
            <button type="submit" className="site-button" disabled={!ask.trim() || demo.busy}>{demo.busy ? tr('Opening…', '正在开通…') : tr('Go', '去办')}</button>
          </form>
          <div className="lx-chips">
            {[tr("What's my balance?", '我卡里还有多少钱'), tr('Anything suspicious this month?', '这个月有没有可疑交易'), tr('Freeze my virtual card', '冻结我的虚拟卡'), tr('Cancel iQIYI', '取消爱奇艺会员'), tr('Pay the electricity bill', '把电费交了')].map((text) => (
              <button key={text} type="button" disabled={demo.busy} onClick={() => tryIt(text)}><span>{text}</span><span aria-hidden>›</span></button>
            ))}
          </div>
          <p className="lx-small">{signedIn ? tr('A simulated bank for the competition. No real money moves.', '参赛演示用的模拟银行，不涉及真实资金。')
            : <>{tr('Opens a demo account with its own simulated bank. ', '会为你开一个自带模拟银行的演示账户。')}<Link to="/signup">{tr('Or create your own account', '或者注册自己的账户')}</Link></>}</p>
        </div>
      </section>

      <div className="lx-close">
        <button type="button" className="lx-top" onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' })}><ArrowUp size={18} aria-hidden />{tr('Top', '顶部')}</button>
        <p className="lx-wordmark" aria-hidden>{[...wordmark].map((ch, k) => <span key={k} style={{ ['--k' as string]: k }}>{ch === ' ' ? ' ' : ch}</span>)}</p>
      </div>
    </main>
    <SiteFooter />
  </div>
}
