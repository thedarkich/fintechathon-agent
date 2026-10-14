import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLang } from '../i18n'
import { SiteHeader, SiteFooter } from '../components/SiteChrome'
import { Icon, type IconName } from '../components/Icon'
import { Seal } from '../components/Seal'
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

export default function LandingPage() {
  const { tr, t } = useLang()
  const { user } = useAuth()
  const signedIn = !!user || !!getAdminToken()
  const navigate = useNavigate()
  const demo = useStartDemo()
  // signed out, a click opens a fresh demo bank first: nothing to fill in before the first sentence
  const go = async (path: string) => {
    if (!user && getAdminToken()) { navigate('/operator'); return }
    const outcome = user ? 'ok' : await demo.start()
    if (outcome !== 'error') navigate(outcome === 'ok' ? path : '/signup')
  }
  const tryIt = (text: string) => void go(`/assistant?ask=${encodeURIComponent(text)}`)
  const cta = (
    <button type="button" className="site-button" disabled={demo.busy} onClick={() => void go('/assistant')}>
      {demo.busy ? tr('Opening your bank…', '正在开通…') : signedIn ? tr('Open the assistant', '打开助手') : tr('Try it now, no sign-up', '马上试试，不用注册')} <span aria-hidden>→</span>
    </button>
  )
  const [params] = useSearchParams()
  useEffect(() => {
    document.title = tr(`${t.brand_en} · Say it once. We do it.`, `${t.brand} · 你说一句，我来办`)
    const section = params.get('section')
    if (section) document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' })
    else window.scrollTo(0, 0)
  }, [params, tr, t])

  const examples = [tr("What's my balance?", '我卡里还有多少钱'), tr('Where did my money go last month?', '上个月钱都花哪了'), tr('Freeze my virtual card', '冻结我的虚拟卡'), tr('Cancel iQIYI', '取消爱奇艺会员'), tr("It's my wife's birthday next month, help me prepare", '下个月老婆生日，帮我准备一下')]
  const features: [IconName, string, string, string][] = [
    ['arrow', tr('Send money in one sentence', '一句话转账'), tr('See who, how much and when it arrives, then confirm. The money lands right away.', '看清收款人、金额和到账时间再确认，钱马上就到。'), tr('“Send Mom 200”', '“给妈妈转200”')],
    ['chart', tr('Ask where your money went', '钱花哪了，一问就知'), tr('Categories, trends and anything suspicious, even “coffee on weekend nights”.', '分类、走势、可疑交易，连“周末晚上喝了多少咖啡”都能算。'), tr('“Where did my money go last month?”', '“上个月钱都花哪了”')],
    ['card', tr('Lost your card? Freeze it now', '卡丢了，先冻结'), tr('Freeze, report lost, change a limit or turn off overseas payments, just by saying so.', '冻结、挂失、调限额、关境外支付，说一声就办。'), tr('“I lost my card”', '“我的卡丢了”')],
    ['bell', tr('Cancel what you don’t use', '不用的会员，一句话取消'), tr('Every monthly charge found for you, with the duplicates and the forgotten trials.', '自动找出每月扣钱的会员，重复的、忘了的一目了然。'), tr('“What am I paying for every month?”', '“我有哪些自动续费”')],
    ['trend', tr('Investing, explained', '理财，问得明白'), tr('Suggestions that fit your risk test. Anything above your level can’t be bought.', '按你的风险测评推荐，超出承受能力的产品不会让你买。'), tr('“I have 100000 for a year. What should I invest in?”', '“有10万一年不用，推荐个理财”')],
    ['clock', tr('A birthday, planned in one go', '生日，一句话安排'), tr('Money set aside, flowers and a cake ordered two days before, paid when it’s time.', '预留礼物钱，提前两天订花和蛋糕，到时自动下单。'), tr('“My wife’s birthday is next month”', '“下个月老婆生日，帮我准备一下”')],
  ]
  const safety: [string, string][] = [
    [tr('Nothing moves without your yes', '动钱之前，先问你'), tr('Every payment shows who, how much and when it arrives. It only happens when you tap Confirm.', '每笔付款都先给你看收款人、金额和到账时间，你点“确认”才会办。')],
    [tr('Big payments need your PIN', '大额要验证'), tr('Over ¥1,000 in a day needs your PIN and an SMS code, or your face or fingerprint. The AI never sees them.', '当天累计超过 ¥1,000，要交易密码和短信验证码，或面容、指纹。AI 看不到它们。')],
    [tr('Anything odd waits', '有风险，先等等'), tr('A large payment to someone added today arrives two hours later, and you can cancel until then. If the name doesn’t match the account, the money comes back.', '给今天新加的收款人转大额，钱 2 小时后才到，到账前随时可以撤销；户名对不上，钱会退回。')],
  ]

  return <div className="public-site landing-page"><SiteHeader />
    <main className="landing-main lp" id="main-content" tabIndex={-1}>
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">{tr('AI banking assistant · simulated bank demo', 'AI 银行助手 · 模拟银行演示')}</p>
          <h1>{tr('Say it once.', '你说一句，')}<br /><span>{tr('We do it.', '我来办。')}</span></h1>
          <p className="lp-lead">{tr('Send money, check your spending, freeze a card, cancel a subscription or plan a birthday, in Chinese or English. Before any money moves, you see exactly what will happen and say yes.', '转账、查账、冻结卡片、取消订阅、准备生日，用中文或英文说一句就行。动钱之前，你会看清楚要办什么，由你来点头。')}</p>
          <div className="lp-actions">
            {cta}
            <Link to="/how" className="lp-link">{tr('How it stays safe', '它为什么安全')}</Link>
          </div>
          {demo.error && <p role="alert" className="lp-note !text-[var(--cinnabar)]">{demo.error}</p>}
          <p className="lp-note">{signedIn ? tr('A simulated bank for the competition. No real money moves.', '参赛演示用的模拟银行，不涉及真实资金。')
            : tr('Opens a demo account with its own simulated bank. No real money moves.', '会为你开一个演示账户，自带一个模拟银行，不涉及真实资金。')}</p>
        </div>
        <PhoneDemo />
      </section>

      <section className="lp-try" aria-label={tr('Things to say', '可以这样说')}>
        <p>{tr('Try saying', '试着说')}</p>
        <div>{examples.map((text) => <button type="button" key={text} disabled={demo.busy} onClick={() => tryIt(text)} className="lp-chip">{text}</button>)}</div>
      </section>

      <section className="lp-section" id="features">
        <h2>{tr('What you can do with one sentence', '一句话，能办这些事')}</h2>
        <div className="lp-grid">
          {features.map(([icon, title, text, example]) => (
            <article key={title} className="lp-feature">
              <span className="lp-icon"><Icon name={icon} size={20} /></span>
              <h3>{title}</h3>
              <p>{text}</p>
              <p className="lp-example">{example}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-safety" id="safety">
        <h2>{tr('The AI never touches your money.', 'AI 碰不到你的钱。')}</h2>
        <p className="lp-section-lead">{tr('The AI only understands what you said. The bank’s fixed rules decide what needs your OK, and you have the last word.', 'AI 只负责听懂你的话；需不需要确认，由银行的固定规则决定；最后由你拍板。')}</p>
        <div className="lp-grid lp-grid-3">
          {safety.map(([title, text], i) => (
            <article key={title} className="lp-point"><span className="lp-step">{i + 1}</span><h3>{title}</h3><p>{text}</p></article>
          ))}
        </div>
        <Link to="/how" className="lp-link mt-6 inline-block">{tr('See how it works inside →', '看看内部是怎么做的 →')}</Link>
      </section>

      <section className="lp-cta">
        <h2>{tr('Try one sentence now.', '现在就说一句试试。')}</h2>
        <p>{tr('Every new account gets its own simulated bank with two years of history.', '每个新账户都有一个自带两年流水的模拟银行。')}</p>
        {cta}
        {!signedIn && <p className="mt-4 text-sm"><Link to="/signup" className="lp-link">{tr('Or create your own account', '或者注册自己的账户')}</Link></p>}
      </section>
    </main><SiteFooter />
  </div>
}
