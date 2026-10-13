import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLang } from '../i18n'
import { SiteHeader, SiteFooter } from '../components/SiteChrome'
import { getAdminToken } from '../api/client'
import { useAuth } from '../lib/auth'
import '../landing.css'

/** Fades `.reveal` elements in as they scroll into view, then hands them back to their own styles (hover lifts, transitions). */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal'))
    if (!els.length) return
    const timers: number[] = []
    const show = (el: HTMLElement) => {
      el.classList.add('revealed')
      const delay = parseFloat(el.style.getPropertyValue('--reveal-delay')) || 0
      timers.push(window.setTimeout(() => el.classList.remove('reveal', 'revealed'), delay + 800))
    }
    // no observer (older in-app browsers): show everything rather than leave it invisible
    if (!('IntersectionObserver' in window)) {
      els.forEach(show)
      return () => timers.forEach(clearTimeout)
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { show(e.target as HTMLElement); io.unobserve(e.target) }
      })
    }, { threshold: 0.12 })
    els.forEach((el) => io.observe(el))
    return () => { io.disconnect(); timers.forEach(clearTimeout) }
  }, [])
}

/** Pulls a call-to-action a few pixels toward the mouse. Touch input is ignored so a tap never leaves it offset. */
function Magnetic({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  function onMove(e: React.PointerEvent) {
    const el = ref.current
    if (!el || e.pointerType !== 'mouse') return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left - r.width / 2) / (r.width / 2)
    const y = (e.clientY - r.top - r.height / 2) / (r.height / 2)
    el.style.transform = `translate(${x * 5}px, ${y * 5}px)`
  }
  function reset() { const el = ref.current; if (el) el.style.transform = '' }
  return <div ref={ref} className="magnetic" onPointerMove={onMove} onPointerLeave={reset}>{children}</div>
}

const delay = (ms: number) => ({ ['--reveal-delay' as string]: `${ms}ms` })

export default function LandingPage() {
  const { tr } = useLang()
  const { user } = useAuth()
  const signedIn = !!user || !!getAdminToken()
  const workspace = user ? '/assistant' : getAdminToken() ? '/operator' : '/login'
  const start = signedIn ? workspace : '/signup'
  const [params] = useSearchParams()
  const [demo, setDemo] = useState<'request' | 'rules' | 'receipt'>('request')
  const [copied, setCopied] = useState(false)
  const sample = JSON.stringify({ action: 'transfer', payee: '房东', amount_yuan: 3200, memo: '房租' }, null, 2)
  useReveal()
  useEffect(() => {
    document.title = tr('Bank Agent · Say it once. The rules decide.', '银行代办 · 说一句话，规则来把关。')
    const section = params.get('section')
    if (section === 'workflow' || section === 'stack') document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' })
    else window.scrollTo(0, 0)
  }, [params, tr])
  const steps = [
    ['01', tr('You ask', '你提出需求'), tr('Text, voice or a receipt photo, in Chinese or English.', '文字、语音或小票照片，中文英文都行。')],
    ['02', tr('The rules decide', '规则来判定'), tr('Queries run. Small payments ask you. Large ones need your PIN and a code.', '查询直接执行，小额要你确认，大额要交易密码和验证码。')],
    ['03', tr('Follow the receipt', '查看执行回执'), tr('Done, scheduled or stopped. Every decision has a record.', '办成、预约或拦下，每次决定都有记录。')],
  ]
  return <div className="public-site landing-page"><SiteHeader />
    <main className="landing-main" id="main-content" tabIndex={-1}>
      <div className="campaign-strip reveal"><span className="mono-label">◆ {tr('SIMULATED BANK · DEMO', '模拟银行 · 演示')}</span><strong>{tr('Let the assistant do your banking. Keep every payment within your rules.', '让助手替你办银行业务，每一笔都在你的规则之内。')}</strong><Link to={start} className="site-button">{tr('Get started', '开始使用')} <span aria-hidden>→</span></Link></div>
      <section className="hero-card reveal" style={delay(60)}>
        <div className="hero-copy reveal" style={delay(120)}><p className="mono-label">// {tr('SAY IT ONCE. THE RULES DECIDE.', '说一句话，规则来把关。')}</p>
          <h1>{tr('AI plans the request.', 'AI 拆解请求。')}<br /><span>{tr('The bank’s rules call the shots.', '规则拍板。')}</span></h1>
          <p>{tr('Ask in Chinese or English. The AI turns it into steps; fixed rules decide what runs, what needs your OK and what needs your PIN.', '用中文或英文说出需求。AI 拆成步骤，固定规则决定哪些直接办、哪些要你确认、哪些要交易密码。')}</p>
          <div className="hero-actions"><Magnetic><Link to={start} className="site-button">{tr('Open your bank', '开启你的银行')} <span aria-hidden>→</span></Link></Magnetic>{!signedIn && <Link to="/login" className="site-button secondary">{tr('Sign in', '登录')}</Link>}</div>
          <p className="hero-note">{tr('Simulated bank · No real money moves', '模拟银行 · 不涉及真实资金')}</p>
        </div>
        <div className="hero-demo reveal" style={delay(240)}><p className="mono-label">◆ {tr('ONE REQUEST. CLEAR BOUNDARIES.', '一句话请求，清晰的边界。')}</p>
          <div className="demo-options" role="group" aria-label={tr('Request demonstration steps', '请求演示步骤')}>
            {(['request', 'rules', 'receipt'] as const).map((v, i) => <button key={v} aria-pressed={demo === v} onClick={() => { setDemo(v); setCopied(false) }}>{['↗', '◇', '✓'][i]} {v === 'request' ? tr('Request', '请求') : v === 'rules' ? tr('Rules', '规则检查') : tr('Receipt', '执行回执')}</button>)}
          </div>
          <div className="terminal-card"><div className="terminal-bar"><div className="terminal-lights"><i /><i /><i /></div><span>bank-agent / {demo}</span><span className="terminal-badge">{tr('EXAMPLE', '演示样例')}</span><button type="button" title={tr('Copy the sample plan', '复制计划样例')} aria-label={tr('Copy the sample plan', '复制计划样例')} onClick={async () => { try { await navigator.clipboard.writeText(sample); setCopied(true) } catch { setCopied(false) } }}>{copied ? '✓' : '⧉'}</button></div>
            <div className="terminal-body" aria-live="polite">
              <p className="terminal-comment">{demo === 'request' ? tr('The customer asks; the AI proposes a plan. It can’t do anything else.', '客户提出需求，AI 提出计划，除此之外它什么也做不了。') : demo === 'rules' ? tr('Fixed code checks every step before anything moves.', '任何钱款移动前，固定代码先检查每一步。') : tr('The receipt explains what happened.', '回执记录发生了什么。')}</p>
              {demo === 'request' ? <pre><span className="terminal-prompt">{'>'} 给房东转3200房租{'\n'}</span>{sample}</pre> : demo === 'rules' ? <div className="terminal-checks"><p>✓ {tr('Payee matched to your list: Zhao Jianhua (landlord) ****7722', '收款人已匹配：赵建华（房东）****7722')}</p><p>✓ {tr('No attempt to get around the rules', '没有绕过规则的企图')}</p><p>◆ {tr('Today’s payments ¥3,200 > ¥1,000: red tier', '当日累计 ¥3,200 超过 ¥1,000：红色等级')}</p><p>◆ {tr('Needs your PIN plus an SMS code or passkey', '需要交易密码加短信验证码或通行密钥')}</p></div> : <div className="terminal-checks"><p>✓ {tr('Done · ¥3,200.00 to Zhao Jianhua', '已办成 · 向赵建华转账 ¥3,200.00')}</p><p>↳ {tr('Ledger entry #42 · hash 6f3a…e91c', '账本第 42 条 · 哈希 6f3a…e91c')}</p><p>↳ {tr('The AI never saw the PIN or the code', 'AI 从未看到交易密码和验证码')}</p></div>}
              <div className="terminal-output"><p>↳ {tr('AI proposes · rules decide · you approve', 'AI 提议 · 规则拍板 · 你来确认')}</p><p>✓ {tr('Your rules decide what moves.', '让规则决定，钱能否转出。')}</p></div>
            </div>
          </div>
          <p className="demo-caption">{tr('Illustrative example. Nothing is sent from this page.', '此处仅展示样例，不会执行任何操作。')}</p>
        </div>
      </section>
      <section className="launch-card reveal"><div><p className="mono-label">// {tr('READY FOR YOUR FIRST REQUEST', '从第一句话开始')}</p><h2>{tr('Open your bank.', '进入你的银行。')}</h2><p>{tr('Ask for a balance, a transfer, a split bill or a birthday plan. Every step is checked and lands in your ledger.', '查余额、转账、AA 收款或准备生日惊喜，每一步都经过检查，并记入你的账本。')}</p></div><Magnetic><Link to={start} className="site-button">{tr('Open your bank', '进入你的银行')} <span aria-hidden>→</span></Link></Magnetic></section>
      <section className="workflow-section" id="workflow"><div className="reveal"><p className="mono-label">// {tr('HOW IT WORKS', '工作流程')}</p><h2>{tr('From one sentence to a receipt.', '从一句话，到一张回执。')}</h2></div><div className="workflow-grid">{steps.map(([n, title, text], i) => <article key={n} className="reveal" style={delay(i * 90)}><span className="mono-label">{n}</span><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section className="stack-section" id="stack"><div className="reveal"><p className="mono-label">// {tr('BUILDING BLOCKS', '核心能力')}</p><h2>{tr('Explore your', '探索你的')} <span>{tr('bank.', '银行。')}</span></h2><p className="section-copy">{tr('Four connected tools. One record of every decision.', '四个互相连接的工具，让每次决定都有迹可循。')}</p></div>
        <div className="stack-grid">{[
          ['01', tr('Assistant', '助手'), tr('Transfers, bill analysis, cards, wealth, subscriptions and birthday plans, in one conversation. Stop or undo at any time.', '转账、账单分析、卡片、理财、订阅和生日惊喜，在同一个对话里完成，随时可以停止或撤销。'), tr('Plan · Approve · Undo', '计划 · 确认 · 撤销'), '/assistant'],
          ['02', tr('Transfers', '转账'), tr('Each transfer clears the way it would at a bank in China: same bank or 超级网银, instant or delayed arrival, a name check, and cancel before it lands.', '每笔转账都像在国内银行一样处理：行内或超级网银，实时或延时到账，户名核对，到账前可以撤销。'), tr('Clearing · Arrival · Name check', '清算 · 到账 · 户名核对'), '/transfers'],
          ['03', tr('Cards & controls', '卡片与控制'), tr('Freeze a card, change a limit, switch off overseas payments, add a passkey.', '冻结卡片、调整限额、关闭境外支付、添加通行密钥。'), tr('Cards · Limits · Locks', '卡片 · 限额 · 安全锁'), '/controls'],
          ['04', tr('Ledger', '账本'), tr('Every request, plan, rule decision and result, chained by hashes so nothing can be quietly changed.', '每一次请求、计划、规则判定和结果，都用哈希串起来，无法被悄悄改动。'), tr('Audit · Hash chain · Receipts', '审计 · 哈希链 · 回执'), '/ledger'],
        ].map(([n, title, text, tags, to], i) => <Link className="stack-card reveal" to={to} key={n} style={delay(i * 90)}><span className="stack-number">{n}</span><h3>{title}</h3><p>{text}</p><span className="stack-tags">{tags}</span><strong>{tr('Explore', '打开查看')} →</strong></Link>)}</div>
      </section>
    </main><SiteFooter />
  </div>
}
