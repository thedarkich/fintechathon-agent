import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeftRight, ChartPie, Check, CreditCard, Gift, Globe, Lock, MessageCircle, Mic, PiggyBank, Receipt, Repeat, Send,
  ShieldCheck, Snowflake, Wallet, type LucideIcon,
} from 'lucide-react'
import '@fontsource-variable/geist-mono'
import { useLang } from '../i18n'
import { SiteFooter, SiteHeader } from '../components/SiteChrome'
import { getAdminToken } from '../api/client'
import { useAuth, useStartDemo } from '../lib/auth'
import { reduceMotion, useRise } from '../lib/motion'
import '../landing.css'

// hash routes own the URL fragment, so in-page links scroll instead of changing location.hash
const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' })
const yuan = (v: number) => '¥' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const wait = (ms: number) => new Promise((done) => window.setTimeout(done, ms))
const IMG = import.meta.env.BASE_URL + 'img/'
const PHOTO = {
  tram: IMG + 'wuhan-optics-valley-modern-tram-5.jpg',
  metro: IMG + 'passengers-exit-or-enter-wuhan-metro-system.jpg',
  lunch: IMG + 'sz-shenzhen-guangming-songbai-road-yonghe-fast.jpg',
}
const css = (vars: Record<string, string | number>) => vars as CSSProperties

/** Runs `effect` on every scroll and resize frame (and once at the start), with the screen's height. */
function useOnScroll(effect: (vh: number) => void) {
  const latest = useRef(effect)
  latest.current = effect
  useEffect(() => {
    let frame = 0
    const run = () => { frame = 0; latest.current(window.innerHeight) }
    const later = () => { if (!frame) frame = requestAnimationFrame(run) }
    run()
    window.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', later)
    return () => { window.removeEventListener('scroll', later); window.removeEventListener('resize', later); cancelAnimationFrame(frame) }
  }, [])
}

/** True while the element is on screen, so loops only run where someone can see them. */
function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) { setOn(true); return }
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, on] as const
}

/** A demo's playhead: each step waits its pause, then the next; after the last a new round starts at 0. It runs
 *  only while `on`, and with reduced motion rests on the step `rest` (the finished picture, by default). */
function useLoop(pauses: number[], on: boolean, rest = pauses.length - 1) {
  const [step, setStep] = useState(reduceMotion() ? rest : 0)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!on || reduceMotion()) return
    const timer = window.setTimeout(() => {
      if (step >= pauses.length - 1) { setStep(0); setRound((r) => r + 1) } else setStep(step + 1)
    }, pauses[step])
    return () => window.clearTimeout(timer)
  }, [step, round, on])
  return { step, round }
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

/** A phone running the app: the status bar, a conversation, the ask bar and the four tabs. */
function Phone({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const { tr } = useLang()
  const tabs: [LucideIcon, string][] = [[Send, tr('Send', '转账')], [MessageCircle, tr('Ask', '助手')], [PiggyBank, tr('Save', '理财')], [Receipt, tr('Bills', '缴费')]]
  return (
    <div className={`lx-phone ${className}`} style={style} aria-hidden>
      <div className="lx-screen">
        <span className="lx-notch" />
        <div className="lx-status"><span>9:41</span><span>5G</span></div>
        <div className="lx-convo">{children}</div>
        <div className="lx-askbar"><span>{tr('Say what you need…', '说说你要办的事…')}</span><Mic size={14} /></div>
        <div className="lx-tabs">{tabs.map(([Icon, label], i) => <span key={label} className={i === 1 ? 'is-on' : ''}><Icon size={18} />{label}</span>)}</div>
      </div>
    </div>
  )
}

/** The link under a claim that sends its sentence to the assistant. */
function TryLink({ say, tryIt, busy, light = false }: { say: string; tryIt: (s: string) => void; busy: boolean; light?: boolean }) {
  const { tr } = useLang()
  return <button type="button" className={`lx-try ${light ? 'is-light' : ''}`} disabled={busy} onClick={() => tryIt(say)}>{tr('Try', '试试')} “{say}”<span aria-hidden> →</span></button>
}

/** A photograph that drifts a little inside its card as the page scrolls. */
function DriftingPhoto({ src }: { src: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useOnScroll((vh) => {
    const el = ref.current
    if (!el || reduceMotion()) return
    const r = el.parentElement!.getBoundingClientRect()
    el.style.setProperty('--py', ((r.top + r.height / 2 - vh / 2) * -0.08).toFixed(1) + 'px')
  })
  return <div ref={ref} className="lx-photo" style={{ backgroundImage: `url('${src}')` }} />
}

/* ---------- the night sky, one sentence ---------- */

function Hero({ start, onStart, busy, error }: { start: string; onStart: () => void; busy: boolean; error: string }) {
  const { tr } = useLang()
  const dots = [[0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [1, 0, 1, 0, 1], [0, 1, 1, 1, 0], [0, 0, 1, 0, 0]]
  return (
    <section className="lx-hero" data-surface="dark" aria-labelledby="lx-title">
      <span className="lx-cloud" /><span className="lx-cloud" /><span className="lx-cloud" /><span className="lx-cloud" />
      <div className="lx-hero-copy">
        <h1 id="lx-title">{[tr('Say it once.', '你说一句，'), tr('We do it.', '我来办。')].map((line, i) => <span key={line} style={css({ '--d': i })}>{line}</span>)}</h1>
        <p className="lx-hero-sub">{tr('Banking you can talk to, in Chinese or English. The bank checks it, and nothing moves until you say yes.', '能对话的银行，中文英文都行。银行先检查，你点头之前，钱一分不动。')}</p>
        <div className="lx-hero-actions">
          <button type="button" className="lx-btn is-light" disabled={busy} onClick={onStart}>{start}</button>
          <button type="button" className="lx-btn is-glass" onClick={() => scrollToId('features')}>{tr('See what it does', '看看能做什么')}</button>
        </div>
        {error && <p role="alert" className="lx-error">{error}</p>}
        <p className="lx-hero-note">{tr('A simulated bank with made-up money. No real bank is connected.', '模拟银行，演示用的钱，不连接任何真实银行。')}</p>
      </div>
      <button type="button" className="lx-scroll-cue" onClick={() => scrollToId('steps')}>
        {tr('Scroll', '向下看')}
        <span className="lx-dot-arrow" aria-hidden>{dots.map((row, r) => row.map((on, c) => <i key={`${r}${c}`} className={on ? 'is-on' : ''} style={css({ '--r': r })} />))}</span>
      </button>
    </section>
  )
}

/** The phone rises through a photograph of the city as the page scrolls, and the request plays out on it. */
function Rise() {
  const { tr } = useLang()
  const box = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(reduceMotion() ? 5 : 0)
  useOnScroll((vh) => {
    if (!box.current || !stage.current) return
    const r = box.current.getBoundingClientRect()
    const p = reduceMotion() ? 1 : clamp01(-r.top / (r.height - vh))
    stage.current.style.setProperty('--p', p.toFixed(3))
    setStep([0.3, 0.42, 0.54, 0.7, 0.82].filter((at) => p >= at).length)
  })
  const rows: [string, string][] = [[tr('To', '收款人'), tr('Wang Xiuying (Mom)', '王秀英（妈妈）')], [tr('Account', '收款账户'), tr('ICBC ****7801', '工商银行 ****7801')], [tr('Amount', '金额'), '¥200.00']]
  return (
    <section ref={box} className="lx-rise" id="steps" data-surface="dark" aria-labelledby="lx-rise-h">
      <div ref={stage} className="lx-rise-stage">
        <div className="lx-rise-photo" style={{ backgroundImage: `url('${PHOTO.tram}')` }} />
        <h2 id="lx-rise-h" className="lx-rise-caption">{tr('Everything you would ask a teller, from your pocket.', '柜台能办的事，口袋里说一句就行。')}</h2>
        <Phone className="is-rising">
          <p className={`lx-msg is-me ${step >= 1 ? 'is-shown' : ''}`}>{tr('Send Mom 200', '给妈妈转200')}</p>
          <p className={`lx-msg is-bot ${step >= 2 ? 'is-shown' : ''}`}>{tr('Please check:', '请核对：')}</p>
          <div className={`lx-msg is-sheet ${step >= 3 ? 'is-shown' : ''} ${step >= 4 ? 'is-done' : ''}`}>
            <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            <p className="lx-ok">{step >= 4 ? tr('Done ✓', '已办好 ✓') : tr('Confirm', '确认')}</p>
          </div>
          <p className={`lx-msg is-bot ${step >= 5 ? 'is-shown' : ''}`}>{tr('Sent ¥200.00. It has arrived.', '已转出 ¥200.00，已到账。')}</p>
        </Phone>
      </div>
    </section>
  )
}

/** A sentence that comes into focus word by word (character by character in Chinese) as it scrolls in;
 *  the second half is in the brand green. */
function Statement({ first, second, children }: { first: string; second: string; children?: ReactNode }) {
  const { lang } = useLang()
  const ref = useRef<HTMLParagraphElement>(null)
  const split = (s: string) => (lang === 'zh' ? [...s] : s.split(/\s+/)).filter(Boolean)
  const words: [string, boolean][] = [...split(first).map((w): [string, boolean] => [w, false]), ...split(second).map((w): [string, boolean] => [w, true])]
  const [lit, setLit] = useState(reduceMotion() ? 999 : 0)
  useOnScroll((vh) => {
    if (!ref.current || reduceMotion()) return
    const k = clamp01((vh * 0.85 - ref.current.getBoundingClientRect().top) / (vh * 0.5))
    setLit(Math.ceil(k * words.length * 1.15))
  })
  return (
    <section className="lx-statement">
      <p ref={ref} aria-label={`${first} ${second}`}>
        {words.map(([w, soft], i) => <span key={i} aria-hidden className={`lx-w ${i < lit ? 'is-lit' : ''} ${soft ? 'is-soft' : ''}`}>{lang === 'en' && i > 0 ? ' ' : ''}{w}</span>)}
      </p>
      {children}
    </section>
  )
}

/* ---------- what it does: photographs and the product working on them ---------- */

function TalkCard({ tryIt, busy }: { tryIt: (s: string) => void; busy: boolean }) {
  const { tr } = useLang()
  const [ref, on] = useOnScreen<HTMLElement>()
  const phone = useRef<HTMLDivElement>(null)
  const { step } = useLoop([600, 1300, 1300, 1300, 3600], on)
  useOnScroll((vh) => {
    const r = ref.current?.getBoundingClientRect()
    if (r && phone.current) phone.current.style.setProperty('--lift', reduceMotion() ? '0' : clamp01(r.top / vh).toFixed(3))
  })
  const say = tr('Send Zhang Wei 300', '给张伟转300')
  return (
    <article ref={ref} className="lx-card lx-card-big" data-surface="dark" data-rise aria-labelledby="lx-talk-h">
      <DriftingPhoto src={PHOTO.metro} />
      <span className="lx-eyebrow">{tr('Banking in your own words', '用自己的话办银行')}</span>
      <h2 id="lx-talk-h">{tr('Say it the way you would say it to a friend.', '像跟朋友说话一样，说出来就行。')}</h2>
      <TryLink say={say} tryIt={tryIt} busy={busy} light />
      <div ref={phone} className="lx-talk-phone">
        <Phone>
          <p className={`lx-msg is-me ${step >= 1 ? 'is-shown' : ''}`}>{say}</p>
          <p className={`lx-msg is-bot ${step >= 2 ? 'is-shown' : ''}`}>{tr('“Zhang Wei” matches two contacts: your university friend at CCB, or your colleague at BoCom?', '“张伟”对应两位联系人：建设银行的大学同学，还是交通银行的同事？')}</p>
          <p className={`lx-msg is-me ${step >= 3 ? 'is-shown' : ''}`}>{tr('My friend', '大学同学那个')}</p>
          <div className={`lx-msg is-sheet ${step >= 4 ? 'is-shown' : ''}`}>
            <dl>
              <div><dt>{tr('To', '收款人')}</dt><dd>{tr('Zhang Wei · friend', '张伟 · 大学同学')}</dd></div>
              <div><dt>{tr('Bank', '银行')}</dt><dd>{tr('CCB ****5678', '建设银行 ****5678')}</dd></div>
              <div><dt>{tr('Amount', '金额')}</dt><dd>¥300.00</dd></div>
            </dl>
            <p className="lx-ok">{tr('Waiting for your OK', '等你确认')}</p>
          </div>
        </Phone>
      </div>
    </article>
  )
}

function SpendCard({ tryIt, busy }: { tryIt: (s: string) => void; busy: boolean }) {
  const { tr } = useLang()
  const [ref, on] = useOnScreen<HTMLElement>()
  const rows: [string, number][] = [[tr('Housing', '住房'), 3200], [tr('Dining', '餐饮'), 2516], [tr('Travel', '出行'), 1753], [tr('Groceries', '日用超市'), 1096]]
  return (
    // whether it is playing goes in data-on, not the class list: the rise's `in` class lives there and React would wipe it
    <article ref={ref} className="lx-card lx-card-half" data-on={on} data-surface="dark" data-rise aria-labelledby="lx-spend-h">
      <DriftingPhoto src={PHOTO.lunch} />
      <div className="lx-spend" aria-hidden>
        <span>{tr('September · spent', '9 月 · 支出')}</span>
        <b><CountUp to={10879.7} run={on} /></b>
        <ul>{rows.map(([name, v], i) => (
          <li key={name} style={css({ '--k': i })}><span>{name}</span><span className="lx-bar"><i style={{ width: `${(v / 3200) * 100}%` }} /></span><span>{yuan(v)}</span></li>
        ))}</ul>
      </div>
      <h3 id="lx-spend-h">{tr('See where the money went.', '看清钱花在哪了。')}</h3>
      <p>{tr('Every lunch, every ride, every rent day, sorted by category, with the odd ones flagged.', '每顿午饭、每趟出行、每次交房租，都按类别归好，异常的会被标出来。')}</p>
      <TryLink say={tr('Where did my money go last month?', '上个月钱都花哪了')} tryIt={tryIt} busy={busy} light />
    </article>
  )
}

function VoiceCard({ tryIt, busy }: { tryIt: (s: string) => void; busy: boolean }) {
  const { tr } = useLang()
  return (
    <article className="lx-card lx-card-half lx-card-green" data-surface="dark" data-rise aria-labelledby="lx-voice-h">
      <div className="lx-voice" aria-hidden>
        <p className="lx-msg is-me is-shown">把电费交了</p>
        <div className="lx-wave">{Array.from({ length: 12 }, (_, k) => <i key={k} style={css({ '--k': k })} />)}</div>
        <p className="lx-msg is-bot is-shown">{tr('State Grid, September: ¥186.40. Pay it now?', '国家电网 9 月电费 ¥186.40，现在缴吗？')}</p>
      </div>
      <h3 id="lx-voice-h">{tr('Chinese or English. Typed or spoken.', '中文英文，打字说话，都行。')}</h3>
      <p>{tr('Type it, say it, or show it a receipt photo.', '打字、说话，或者拍一张小票给它看。')}</p>
      <TryLink say={tr('Pay the electricity bill', '把电费交了')} tryIt={tryIt} busy={busy} light />
    </article>
  )
}

function PlanCard({ tryIt, busy }: { tryIt: (s: string) => void; busy: boolean }) {
  const { tr } = useLang()
  const [ref, on] = useOnScreen<HTMLElement>()
  const { step } = useLoop([700, 1000, 1000, 3200], on)
  const steps: [string, string, string][] = [
    [tr('Look up Chen Jing’s birthday', '查找陈静的生日'), tr('In 35 days', '还有 35 天'), tr('Done', '已完成')],
    [tr('Set aside ¥1,000.00 for the gift', '预留 ¥1,000.00 买礼物'), tr('From the current account', '从活期账户'), tr('Set aside', '已预留')],
    [tr('Order flowers and a cake', '订鲜花和蛋糕'), tr('Two days before, delivered home', '提前两天，送货到家'), tr('Scheduled', '已安排')],
  ]
  const say = tr('My wife’s birthday is next month, help me prepare', '下个月老婆生日，帮我准备一下')
  return (
    <article ref={ref} className="lx-card lx-card-night" id="plans" data-surface="dark" data-rise aria-labelledby="lx-plans-h">
      <span className="lx-cloud" /><span className="lx-cloud" />
      <div>
        <span className="lx-eyebrow">{tr('One sentence, several steps', '一句话，办好几步')}</span>
        <h2 id="lx-plans-h">{tr('Hand it the whole errand.', '整件事，交给它。')}</h2>
        <p className="lx-lead">{tr('It plans across contacts, savings and shopping, shows you every step, and asks once for the whole plan.', '跨联系人、预留资金和下单统一规划，每一步都给你看，整个计划只问你一次。')}</p>
        <TryLink say={say} tryIt={tryIt} busy={busy} light />
      </div>
      <div className="lx-plan" aria-hidden>
        <p className="lx-msg is-me is-shown">{say}</p>
        <ol>{steps.map(([what, detail, state], i) => (
          <li key={what} className={step > i ? 'is-on' : ''}><span className="lx-tick"><Check size={15} /></span><span><b>{what}</b><small>{detail}</small></span><em>{state}</em></li>
        ))}</ol>
      </div>
    </article>
  )
}

function CardFeature({ tryIt, busy }: { tryIt: (s: string) => void; busy: boolean }) {
  const { tr } = useLang()
  const [ref, on] = useOnScreen<HTMLElement>()
  const { step } = useLoop([1800, 2800], on, 0)
  const frozen = step === 1
  return (
    <article ref={ref} className="lx-feature" data-rise aria-labelledby="lx-f1">
      <h3 id="lx-f1">{tr('Lost your card? Say so.', '卡丢了？说一声。')}</h3>
      <p>{tr('“I lost my card” freezes it on the spot. Unfreeze it the same way.', '说一句“我的卡丢了”，马上冻结；解冻也一样简单。')}</p>
      <TryLink say={tr('I lost my card', '我的卡丢了')} tryIt={tryIt} busy={busy} />
      <div className={`lx-feature-ui ${frozen ? 'is-frozen' : ''}`} aria-hidden>
        <div className="lx-plastic"><span>{tr('Online shopping card', '网购虚拟卡')}</span><span>•••• 8831</span><span>{frozen ? tr('Frozen', '已冻结') : tr('Active', '正常')}</span><i className="lx-frost"><Snowflake /></i></div>
        <div className="lx-toggle"><span>{tr('Online payments', '网上支付')}</span><span className={`lx-sw ${frozen ? '' : 'is-on'}`} /></div>
        <div className="lx-toggle"><span>{tr('Overseas', '境外交易')}</span><span className={`lx-sw ${frozen ? '' : 'is-on'}`} /></div>
      </div>
    </article>
  )
}

function SubsFeature({ tryIt, busy }: { tryIt: (s: string) => void; busy: boolean }) {
  const { tr } = useLang()
  const [ref, on] = useOnScreen<HTMLElement>()
  const { step } = useLoop([900, 450, 450, 3400], on)
  const rows: [string, string, number][] = [
    [tr('Fitness club', '乐动力健身'), '¥199.00', 0], [tr('Tencent Video', '腾讯视频VIP'), '¥30.00', 0],
    [tr('NetEase Cloud Music', '网易云音乐'), '¥15.00', 1], [tr('QQ Music', 'QQ音乐'), '¥15.00', 2],
  ]
  return (
    <article ref={ref} className="lx-feature" data-rise aria-labelledby="lx-f2">
      <h3 id="lx-f2">{tr('Find the memberships you forgot.', '找出你忘了的会员。')}</h3>
      <p>{tr('Every automatic charge in one list, including the ones you pay for twice.', '所有自动扣费一张清单，连重复付费的也找出来。')}</p>
      <TryLink say={tr('What am I paying for every month?', '我有哪些自动续费')} tryIt={tryIt} busy={busy} />
      <div className="lx-feature-ui" aria-hidden>
        <ul className="lx-subs">{rows.map(([name, fen, dup]) => <li key={name} className={dup && step >= dup ? 'is-flag' : ''}><span>{name}</span><span>{fen}</span></li>)}</ul>
        <p className={`lx-save ${step >= 3 ? 'is-shown' : ''}`}>{tr('Cancel one, save ¥180.00 a year', '取消一个，每年省 ¥180.00')}</p>
      </div>
    </article>
  )
}

function GaugeFeature({ tryIt, busy }: { tryIt: (s: string) => void; busy: boolean }) {
  const { tr } = useLang()
  const [ref, on] = useOnScreen<HTMLElement>()
  const { step } = useLoop([700, 1000, 3800], on)
  const arcs = ['M20 100 A80 80 0 0 1 35.3 53', 'M37.5 49.5 A80 80 0 0 1 75.3 24', 'M79.5 22.7 A80 80 0 0 1 120.5 22.7', 'M124.7 24 A80 80 0 0 1 162.5 49.5', 'M164.7 53 A80 80 0 0 1 180 100']
  return (
    <article ref={ref} className="lx-feature" data-rise aria-labelledby="lx-f3">
      <h3 id="lx-f3">{tr('Savings that match your nerve.', '理财，按你的胆量来。')}</h3>
      <p>{tr('It never suggests a product above your risk test.', '不会推荐超出你风险测评的产品。')}</p>
      <TryLink say={tr('100000 for a year: what should I buy?', '有10万一年不用，推荐个理财')} tryIt={tryIt} busy={busy} />
      <div className="lx-feature-ui lx-gauge" aria-hidden>
        <svg viewBox="0 0 200 108">
          {arcs.map((d, i) => <path key={d} d={d} className={`lx-arc is-r${i + 1}`} />)}
          <g className="lx-needle" style={{ transform: `rotate(${[-90, 70, -36][step]}deg)` }}><line x1="100" y1="100" x2="100" y2="36" /><circle cx="100" cy="100" r="7" /></g>
        </svg>
        <div className="lx-prod"><span>{tr('Steady Money Market A', '稳享货币A')} · R1</span><span>1.62%</span></div>
        <div className="lx-prod"><span>{tr('Anying Short-term Bond', '安盈短债')} · R2</span><span>2.45%</span></div>
        <div className={`lx-prod ${step === 2 ? 'is-out' : ''}`}><span>{tr('Tech Growth Equity', '科技成长股票')} · R4</span><Lock size={13} /></div>
      </div>
    </article>
  )
}

/** Real requests, scrolling up the page in four columns, each in both languages. Tap one to send it. */
function RequestWall({ tryIt, busy }: { tryIt: (s: string) => void; busy: boolean }) {
  const { tr } = useLang()
  const says: [LucideIcon, string, string, string][] = [
    [Send, 'Send Mom 200', '给妈妈转200', tr('Transfers', '转账')], [Snowflake, 'I lost my card', '我的卡丢了', tr('Cards', '卡片')],
    [ChartPie, 'Where did my money go last month?', '上个月钱都花哪了', tr('Spending', '账单')], [Receipt, 'Pay the electricity bill', '把电费交了', tr('Bills', '缴费')],
    [Repeat, 'What am I paying for every month?', '我有哪些自动续费', tr('Subscriptions', '订阅')], [PiggyBank, '100000 for a year: what should I buy?', '有10万一年不用，推荐个理财', tr('Savings', '理财')],
    [ShieldCheck, 'Anything suspicious this month?', '这个月有没有可疑交易', tr('Security', '安全')], [Wallet, "What's my balance?", '我卡里还有多少钱', tr('Accounts', '账户')],
    [ArrowLeftRight, 'Send Zhang Wei 300', '给张伟转300', tr('Transfers', '转账')], [CreditCard, 'Freeze my virtual card', '冻结我的虚拟卡', tr('Cards', '卡片')],
    [Globe, 'Turn on overseas payments', '开通境外支付', tr('Cards', '卡片')], [Gift, 'My wife’s birthday is next month, help me prepare', '下个月老婆生日，帮我准备一下', tr('Plans', '计划')],
  ]
  const columns = [0, 1, 2, 3].map((c) => says.filter((_, i) => i % 4 === c))
  return (
    <div className="lx-wall">
      {columns.map((list, c) => (
        <div key={c} className="lx-col">
          {[0, 1].map((copy) => list.map(([Icon, en, zh, tag]) => (
            <button key={`${copy}${en}`} type="button" className="lx-say" disabled={busy} onClick={() => tryIt(tr(en, zh))}
              tabIndex={copy ? -1 : undefined} aria-hidden={copy ? true : undefined}>
              <q>{tr(en, zh)}</q>
              <small><Icon size={13} />{tag}<span>{tr(zh, en)}</span></small>
            </button>
          )))}
        </div>
      ))}
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
  const tone = waits ? 'is-wait' : strong ? 'is-strong' : 'is-tap'
  const figure = waits ? tr('2 hrs', '2 小时') : strong ? tr('PIN + code', '密码+验证码') : tr('1 tap', '点一下')
  const result = waits
    ? tr('It needs your PIN and a code, then arrives two hours later, so you can still cancel it.', '需要交易密码和验证码，并在 2 小时后到账，到账前还能撤销。')
    : strong
      ? tr('Over ¥1,000 today: your PIN and an SMS code, or a passkey. Then it arrives now.', '今天超过 ¥1,000：需要交易密码加短信验证码，或通行密钥，然后实时到账。')
      : tr('Your tap on Confirm is enough. It arrives now.', '你点“确认”就行，实时到账。')
  return (
    <div className="lx-check" data-ui>
      <div className="lx-check-control">
        <label htmlFor="lx-amount">
          <span>{tr('How much are you sending today?', '今天一共要转多少？')}</span>
          <output htmlFor="lx-amount">¥{amount.toLocaleString('en-US')}.00</output>
        </label>
        <input id="lx-amount" type="range" min={50} max={3000} step={50} value={amount} onChange={(e) => setAmount(Number(e.target.value))}
          style={css({ '--fill': `${((amount - 50) / 2950) * 100}%` })} />
        <div className="lx-check-row">
          <span id="lx-fresh-label">{tr('To someone added today', '收款人是今天新加的')}</span>
          <button type="button" role="switch" aria-checked={fresh} aria-labelledby="lx-fresh-label" className={`lx-sw is-button ${fresh ? 'is-on' : ''}`} onClick={() => setFresh(!fresh)} />
        </div>
      </div>
      <div className="lx-check-result">
        <p className={`lx-figure ${tone}`} aria-live="polite" key={figure}>{figure}</p>
        <p className="lx-check-why">{result} {tr('Up to ¥1,000 a day, and up to ¥500 to a new contact, needs only your tap.', '每天累计 ¥1,000 以内、给新联系人 ¥500 以内，只需你点一下。')}</p>
      </div>
    </div>
  )
}

function Faq() {
  const { tr } = useLang()
  const [open, setOpen] = useState(-1)
  const items: [string, string][] = [
    [tr('Is this a real bank?', '这是真的银行吗？'), tr('No. It is a simulated bank built for a competition, with made-up money and two years of made-up history. No real bank is connected.', '不是。这是为比赛搭建的模拟银行，钱和近两年的流水都是演示数据，不连接任何真实银行。')],
    [tr('Can the AI move my money by itself?', 'AI 能自己动我的钱吗？'), tr('No. It can only propose a plan. The bank’s rules check it, and nothing moves until you confirm. Larger or new payments also need your PIN and an SMS code, or a passkey.', '不能。它只能提出计划，由银行规则检查，你确认之前什么都不会发生。大额或给新联系人的付款，还需要交易密码加短信验证码，或通行密钥。')],
    [tr('Which languages does it understand?', '它听得懂哪些语言？'), tr('Chinese and English, typed or spoken, and a receipt photo works too.', '中文和英文，打字、语音都行，也可以拍小票。')],
    [tr('What if I pick the wrong person?', '如果选错了收款人怎么办？'), tr('When a name matches more than one contact, it asks which one. Payments over ¥500 to someone added today wait two hours, so you can still cancel them.', '一个名字对应多位联系人时，它会先问你是哪一位。给今天新加的联系人付款超过 ¥500，会等 2 小时再到账，期间还能撤销。')],
  ]
  return (
    <section className="lx-faq" id="faq" aria-labelledby="lx-faq-h">
      <h2 id="lx-faq-h">{tr('Questions', '常见问题')}</h2>
      {items.map(([q, a], i) => (
        <div key={q} className={`lx-qa ${open === i ? 'is-open' : ''}`}>
          <button type="button" aria-expanded={open === i} aria-controls={`lx-qa-${i}`} onClick={() => setOpen(open === i ? -1 : i)}>{q}<span className="lx-plus" aria-hidden>+</span></button>
          <div className="lx-a" id={`lx-qa-${i}`} role="region"><div><p>{a}</p></div></div>
        </div>
      ))}
    </section>
  )
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
  const credits = tr(
    'Photographs: “Wuhan Optics Valley Modern Tram (5)” and “Passengers exit or enter Wuhan Metro system by QR code (1)” by Painjet, CC BY-SA 4.0; “Shenzhen Guangming Songbai Road, Yonghe Fast Food Restaurant” by LemAIEOPLLY 223 Liuam, CC0; all via Wikimedia Commons.',
    '照片：Painjet 拍摄的《武汉光谷现代有轨电车 (5)》与《乘客扫码进出武汉地铁 (1)》，CC BY-SA 4.0；LemAIEOPLLY 223 Liuam 拍摄的《深圳光明松白路永和快餐》，CC0；均来自维基共享资源。')

  return <div className="public-site lx">
    <SiteHeader />
    <main id="main-content" tabIndex={-1} className="lx-main">
      <Hero start={start} onStart={() => void go('/home')} busy={demo.busy} error={demo.error} />
      <Rise />
      <Statement first={tr('It reads your spending,', '它看得懂你的开销，')} second={tr('flags what looks wrong, and never moves a yuan without your yes.', '会标出不对劲的地方，没有你点头，一分钱也不动。')}>
        <button type="button" className="lx-btn is-white" onClick={() => scrollToId('features')}>{tr('See it work', '看看怎么办')} <span aria-hidden>→</span></button>
      </Statement>

      <div className="lx-cards" id="features">
        <TalkCard tryIt={tryIt} busy={demo.busy} />
        <div className="lx-pair">
          <SpendCard tryIt={tryIt} busy={demo.busy} />
          <VoiceCard tryIt={tryIt} busy={demo.busy} />
        </div>
      </div>

      <Statement first={tr('The AI only proposes.', 'AI 只负责提议。')} second={tr('The bank’s own rules decide what moves, and you have the last word.', '动不动钱，由银行自己的规则决定，最后由你点头。')} />

      <div className="lx-cards"><PlanCard tryIt={tryIt} busy={demo.busy} /></div>

      <section aria-labelledby="lx-trio-h">
        <h2 id="lx-trio-h" className="lx-center-h">{tr('Small sentences, big relief.', '一句小话，省一大堆事。')}</h2>
        <div className="lx-trio">
          <CardFeature tryIt={tryIt} busy={demo.busy} />
          <SubsFeature tryIt={tryIt} busy={demo.busy} />
          <GaugeFeature tryIt={tryIt} busy={demo.busy} />
        </div>
      </section>

      <section aria-labelledby="lx-wall-h">
        <h2 id="lx-wall-h" className="lx-center-h is-big">{tr('Things people say to their bank, when the bank listens.', '银行肯听，大家就这样说。')}</h2>
        <RequestWall tryIt={tryIt} busy={demo.busy} />
      </section>

      <section className="lx-safe" id="check" data-surface="dark" aria-labelledby="lx-safe-h">
        <span className="lx-cloud" /><span className="lx-cloud" />
        <h2 id="lx-safe-h">{tr('An assistant that can’t move money on its own.', '一个自己动不了钱的助手。')}</h2>
        <div className="lx-safe-grid">
          {([
            [tr('Proposes', '提议'), tr('The AI only drafts.', 'AI 只写草稿。'), tr('It writes the plan. It has no way to send, approve or skip a step.', '它只负责写计划，没有办法转账、批准或跳过任何一步。')],
            [tr('Checks', '检查'), tr('The bank’s rules decide.', '银行规则来定。'), tr('Limits, new contacts and odd patterns are checked in code, outside the AI.', '限额、新联系人、异常模式，都由 AI 之外的代码检查。')],
            [tr('Confirms', '确认'), tr('You say yes.', '由你点头。'), tr('Large or new payments need your PIN and a code, which the AI never sees.', '大额或新联系人的付款要交易密码和验证码，AI 看不到。')],
          ] as [string, string, string][]).map(([n, title, text]) => <div key={n}><span className="lx-n">{n}</span><b>{title}</b><p>{text}</p></div>)}
        </div>
        <RuleCheck />
        <Link className="lx-try is-light" to="/how">{tr('How it stays safe', '安全原理')}<span aria-hidden> →</span></Link>
      </section>

      <section className="lx-ask" id="ask" aria-labelledby="lx-ask-h">
        <h2 id="lx-ask-h">{tr('Just say it.', '直接说。')}</h2>
        <p>{tr('A demo bank opens in a second, with two years of made-up history. Type what you need.', '一秒开好演示银行，自带两年的模拟流水。说说你要办的事。')}</p>
        <form onSubmit={(e) => { e.preventDefault(); if (ask.trim()) tryIt(ask.trim()) }} className="lx-askbox">
          <input value={ask} onChange={(e) => setAsk(e.target.value)} onFocus={() => setAskFocus(true)} onBlur={() => setAskFocus(false)}
            maxLength={200} aria-label={tr('What do you need?', '想办什么')} placeholder={placeholder} />
          <button type="submit" className="lx-btn is-dark" disabled={!ask.trim() || demo.busy}>{demo.busy ? tr('Opening…', '正在开通…') : tr('Go', '去办')}</button>
        </form>
        <div className="lx-chips">
          {[tr("What's my balance?", '我卡里还有多少钱'), tr('Anything suspicious this month?', '这个月有没有可疑交易'), tr('Freeze my virtual card', '冻结我的虚拟卡'), tr('Cancel iQIYI', '取消爱奇艺会员'), tr('Pay the electricity bill', '把电费交了')].map((text) => (
            <button key={text} type="button" disabled={demo.busy} onClick={() => tryIt(text)}>{text}<span aria-hidden>›</span></button>
          ))}
        </div>
        <p className="lx-small">{signedIn ? tr('A simulated bank for the competition. No real money moves.', '参赛演示用的模拟银行，不涉及真实资金。')
          : <>{tr('Opens a demo account with its own simulated bank. ', '会为你开一个自带模拟银行的演示账户。')}<Link to="/signup">{tr('Or create your own account', '或者注册自己的账户')}</Link></>}</p>
      </section>

      <Faq />
    </main>
    <SiteFooter credits={credits} />
  </div>
}
