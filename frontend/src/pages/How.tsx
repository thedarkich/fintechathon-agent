import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLang } from '../i18n'
import { SiteFooter, SiteHeader } from '../components/SiteChrome'
import { Icon, type IconName } from '../components/Icon'
import { TierTag } from '../components/bits'
import { useAuth, useStartDemo } from '../lib/auth'
import '../landing.css'

/** How it stays safe: the one page with the inside view, for judges and the curious. */
export default function How() {
  const { tr, t } = useLang()
  const { user } = useAuth()
  const navigate = useNavigate()
  const demo = useStartDemo()
  const tryIt = async () => {
    const outcome = user ? 'ok' : await demo.start()
    if (outcome !== 'error') navigate(outcome === 'ok' ? '/assistant' : '/signup')
  }
  const [view, setView] = useState<'request' | 'rules' | 'result'>('request')
  useEffect(() => { document.title = tr(`${t.brand_en} · How it stays safe`, `${t.brand} · 安全原理`); window.scrollTo(0, 0) }, [tr, t])
  const plan = JSON.stringify({ steps: [{ id: 's1', action: 'transfer', args: { payee: '房东', amount_yuan: 3200, memo: '房租' } }] }, null, 2)
  const roles: [IconName, string, string][] = [
    ['chat', tr('You say what you need', '你说出需求'), tr('In Chinese or English, typed, spoken or with a receipt photo. A PIN or code typed by mistake is hidden at once.', '中文英文都行，打字、语音或拍小票。误打的密码和验证码会立刻被隐藏。')],
    ['agents', tr('The AI turns it into steps', 'AI 把它拆成步骤'), tr('It may only choose from a fixed list of 43 bank actions. It never sees your account, can’t move money and can’t approve anything.', '只能从固定的 43 个银行操作里选。它看不到你的账户，不能动钱，也不能批准任何事。')],
    ['shield', tr('The bank’s rules check every step', '银行规则逐步检查'), tr('Fixed code matches names to your own records and decides what each step needs: nothing, your OK, or your PIN and a code.', '固定代码把名字和你自己的记录核对，并决定每一步需要什么：直接办、你确认，还是交易密码加验证码。')],
    ['check', tr('You have the last word', '最后由你决定'), tr('You see exactly what will happen before it happens. Every step is kept in a record that can’t be quietly changed.', '办之前你会看清楚要办什么。每一步都记在无法被悄悄改动的记录里。')],
  ]
  const levels: ['green' | 'yellow' | 'red', string, string][] = [
    ['green', tr('Questions: balance, spending, reports, unusual transactions, investment returns', '查询：余额、消费、报告、异常交易、理财收益'), tr('Answered right away', '马上回答')],
    ['yellow', tr('Payments while today’s total stays at or under ¥1,000; cancelling a subscription; a virtual card; a split bill; making a card safer', '当天累计不超过 ¥1,000 的付款；取消订阅；申请虚拟卡；AA 收款；让卡更安全的设置'), tr('You check the details and tap Confirm', '你核对内容后点“确认”')],
    ['red', tr('Payments that take today’s total over ¥1,000; changing a password; reporting a card lost; unfreezing or raising a limit; buying investments', '使当天累计超过 ¥1,000 的付款；改密码；挂失；解冻或提高限额；申购理财'), tr('Your PIN plus an SMS code, or your face or fingerprint (passkey)', '交易密码加短信验证码，或面容、指纹（通行密钥）')],
  ]
  const guards: [string, string][] = [
    [tr('The AI can’t see your data', 'AI 看不到你的数据'), tr('It gets your words only. Balances, names in your records, notes and receipts never reach it, so text hidden in them can’t instruct it.', '它只收到你说的话。余额、记录里的名字、备注和小票内容都不会给它，藏在里面的文字也就无法指挥它。')],
    [tr('A yes is tied to the exact details', '确认绑定确切内容'), tr('Your confirmation covers exactly what you saw. If anything changes, you have to confirm again.', '你的确认只对你看到的内容有效，内容一改就要重新确认。')],
    [tr('Odd transfers wait two hours', '可疑转账延时到账'), tr('A large payment to someone added today arrives two hours later, and can be cancelled until then. The other bank checks the name and returns the money if it doesn’t match.', '给今天新加的收款人转大额，2 小时后才到账，到账前可以撤销。对方银行核对户名，不符就退回。')],
    [tr('Tricks are spotted', '识别绕过规则的话术'), tr('“Ignore the rules”, “I’m from the bank”, “already verified”, scam scripts: flagged, and they only make the checks stricter.', '“忽略规则”“我是银行工作人员”“已经验证过了”、诈骗话术：会被标记，只会让检查更严格。')],
    [tr('A safety lock', '安全锁'), tr('Too many failed codes or suspicious requests pause the assistant or payments until you verify yourself.', '验证码错太多次或可疑请求太多，助手或付款会暂停，直到你验证身份。')],
    [tr('Generated code runs in a sandbox', '生成的代码在沙箱里运行'), tr('For questions like “coffee on weekend nights”, the AI writes a short calculation that runs isolated: no files, no network, strict time and memory limits.', '像“周末晚上喝了多少咖啡”这样的问题，AI 会写一小段计算代码，在隔离环境里运行：不能读写文件、不能联网，时间和内存都受限。')],
    [tr('Every step is recorded', '每一步都有记录'), tr('Requests, decisions and results are chained by hashes, so the record can be checked and can’t be quietly edited.', '请求、判定和结果用哈希串起来，记录可以核验，无法被悄悄修改。')],
    [tr('A person can take over', '可以转人工'), tr('Ask for a person at any time. Staff can answer or stop a request, but can never approve a payment for you.', '随时可以要求人工。客服可以回复或停止请求，但永远不能替你确认付款。')],
  ]

  return <div className="public-site landing-page"><SiteHeader />
    <main className="lp" id="main-content" tabIndex={-1}>
      <section className="lp-banner">
        <div className="lp-banner-copy">
          <p className="lp-eyebrow">{tr('How it stays safe', '安全原理')}</p>
          <h1>{tr('The AI proposes.', 'AI 只提议，')}<br />{tr('Rules decide. You say yes.', '规则做决定，你来点头。')}</h1>
          <p>{tr('Letting an AI act on a bank account is only safe if it can’t act alone. Here is how that works.', '让 AI 操作银行账户，前提是它不能自作主张。下面是具体做法。')}</p>
        </div>
        <ol className="lp-flow" aria-label={tr('Who does what', '分工')}>
          <li><span className="lp-flow-icon"><Icon name="agents" size={20} /></span><span><b>{tr('The AI proposes', 'AI 提议')}</b><small>{tr('From a fixed list of 43 actions', '只能从固定的 43 个操作里选')}</small></span></li>
          <li><span className="lp-flow-icon"><Icon name="shield" size={20} /></span><span><b>{tr('The rules decide', '规则决定')}</b><small>{tr('Right away, your OK, or PIN + code', '直接办、需确认，还是需验证')}</small></span></li>
          <li><span className="lp-flow-icon"><Icon name="check" size={20} /></span><span><b>{tr('You say yes', '你来点头')}</b><small>{tr('Nothing moves before you confirm', '你确认之前，钱一分不动')}</small></span></li>
        </ol>
      </section>

      <div className="lp-grid lp-grid-4">
        {roles.map(([icon, title, text], i) => (
          <article key={title} className="lp-point"><span className="lp-icon"><Icon name={icon} size={20} /></span><h3>{i + 1}. {title}</h3><p>{text}</p></article>
        ))}
      </div>

      <section className="lp-section">
        <h2>{tr('Three levels, decided by fixed rules', '三个等级，由固定规则决定')}</h2>
        <div className="mt-8 divide-y divide-[var(--rule)] overflow-hidden rounded-panel bg-[var(--field)]">
          {levels.map(([tier, what, how]) => (
            <div key={tier} className="grid gap-2 px-6 py-5 sm:grid-cols-[9rem_1fr_16rem] sm:items-center">
              <span><TierTag tier={tier} /></span>
              <p className="text-[0.95rem] leading-relaxed">{what}</p>
              <p className="text-sm font-semibold text-ink2">{how}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-sm text-ink2">{tr('A warning sign only ever makes a level stricter, never looser.', '风险信号只会让等级更严，不会更松。')}</p>
      </section>

      <section className="lp-section">
        <h2>{tr('One request, step by step', '一个请求的完整过程')}</h2>
        <p className="lp-section-lead">{tr('“Pay my landlord 3200 for rent”: what the AI produced, what the rules checked, and what happened.', '“给房东转3200房租”：AI 给出了什么、规则检查了什么、最后发生了什么。')}</p>
        <div className="lp-pills lp-calc-tabs" role="group" aria-label={tr('Stage', '阶段')}>
          {(['request', 'rules', 'result'] as const).map((v, i) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{i + 1}. {v === 'request' ? tr('What the AI proposed', 'AI 提出的计划') : v === 'rules' ? tr('What the rules checked', '规则检查') : tr('What happened', '结果')}</button>)}
        </div>
        <div className="terminal-card mx-auto mt-6 max-w-3xl"><div className="terminal-bar"><div className="terminal-lights"><i /><i /><i /></div><span>{view}</span><span className="terminal-badge">{tr('EXAMPLE', '示例')}</span></div>
          <div className="terminal-body" aria-live="polite">
            {view === 'request' ? <>
              <p className="terminal-comment">{tr('The AI may only return this shape. Any extra field, unknown action or bad value is rejected.', 'AI 只能返回这种格式，多出的字段、未知操作或错误的值都会被拒绝。')}</p>
              <pre><span className="terminal-prompt">{'>'} 给房东转3200房租{'\n'}</span>{plan}</pre>
            </> : view === 'rules' ? <div className="terminal-checks">
              <p>✓ {tr('“房东” matched to your payee: Zhao Jianhua (landlord), ABC ****7722', '“房东”匹配到你的收款人：赵建华（房东）中国农业银行 ****7722')}</p>
              <p>✓ {tr('Balance and the ¥50,000 single-transfer limit checked', '已核对余额和单笔 ¥50,000 上限')}</p>
              <p>✓ {tr('Nothing in the request tries to get around the rules', '请求中没有绕过规则的内容')}</p>
              <p>● {tr('Today’s payments would be ¥3,200, over ¥1,000: needs your PIN and an SMS code', '当天累计将达 ¥3,200，超过 ¥1,000：需要交易密码和短信验证码')}</p>
            </div> : <div className="terminal-checks">
              <p>✓ {tr('You checked the card and entered your PIN and the code', '你核对了确认卡，并输入了交易密码和验证码')}</p>
              <p>✓ {tr('¥3,200.00 sent to Zhao Jianhua through the interbank system; arrived', '¥3,200.00 经超级网银转给赵建华，已到账')}</p>
              <p>↳ {tr('Every stage written to your history, chained by hashes', '每个阶段都写入记录，并用哈希串联')}</p>
              <p>↳ {tr('The AI never saw the PIN or the code', 'AI 自始至终没有看到交易密码和验证码')}</p>
            </div>}
          </div>
        </div>
      </section>

      <section className="lp-section">
        <h2>{tr('What else protects you', '还有哪些保护')}</h2>
        <div className="lp-grid">
          {guards.map(([title, text]) => <article key={title} className="lp-point"><h3 className="!mt-0">{title}</h3><p>{text}</p></article>)}
        </div>
      </section>

      <section className="lp-section">
        <h2>{tr('Tested, not just promised', '经过测试，不只是承诺')}</h2>
        <div className="lp-grid">
          {[['224', tr('everyday requests understood correctly', '个日常请求全部理解正确')], ['69', tr('attempts to get around the rules: none ran without your OK', '次绕过规则的尝试：没有一次未经你确认就执行')], ['96', tr('automated tests on every rule and boundary', '个自动化测试覆盖每条规则和边界')]].map(([n, text]) => (
            <article key={n} className="lp-point"><p className="text-[2.8rem] font-extrabold leading-none text-[var(--action)]">{n}</p><p className="mt-2">{text}</p></article>
          ))}
        </div>
        <p className="mt-3 text-center text-sm text-ink2">{tr('Measured with the built-in rule-based planner. The AI model planner will be measured before we publish numbers for it.', '以上数字来自内置的规则规划器；接入 AI 模型后会先测量，再公布它的数字。')}</p>
      </section>

      <section className="lp-cta">
        <h2>{tr('See it for yourself.', '亲自试一试。')}</h2>
        <p>{tr('Try a large transfer to the seller added today, or tell it to ignore the rules, and watch what happens.', '试试给今天新加的卖家转一大笔钱，或者让它“忽略规则”，看看会发生什么。')}</p>
        <button type="button" className="site-button cta" disabled={demo.busy} onClick={() => void tryIt()}>{user ? tr('Open the assistant', '打开助手') : tr('Try it now, no sign-up', '马上试试，不用注册')}</button>
        {demo.error && <p role="alert" className="mt-3 text-sm font-semibold">{demo.error}</p>}
      </section>
    </main><SiteFooter />
  </div>
}
