import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SendHorizontal } from 'lucide-react'
import { api, ApiError, errorText, wechatSay } from '../api/client'
import type { WechatReply } from '../api/types'
import { useLang } from '../i18n'
import { Badge, Notice, PageHead, Section, TierTag } from '../components/bits'
import { Icon } from '../components/Icon'
import { BrandMark } from '../components/Seal'
import { useAuth } from '../lib/auth'

type Line = { id: number; from: 'me' | 'bank' | 'note'; reply?: WechatReply; text?: string }

/** This tab's storage, which may be missing (private windows, blocked site data): the page works without it. The chat's
 * credential lives here too, never in localStorage (security best practice, as for the operator token): it is gone
 * when the tab closes, and linking again takes the PIN. */
function stored<T>(key: string, fallback: T): T {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback }
}
function keep(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
}
function drop(key: string) {
  try { localStorage.removeItem(key); sessionStorage.removeItem(key) } catch { /* storage unavailable */ }
}

/**
 * The WeChat assistant, simulated: the chat on the left stands in for the WeChat Mini Program, the panel on the right
 * is the bank app. "IM 里说，App 里确认": the chat holds only its own token, so it can ask and plan; every yes is
 * given in the app, on the same confirm card as everywhere else.
 */
export default function Wechat() {
  const { tr, lang } = useLang()
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const tokenKey = `ba_wechat_token_${user?.id}`
  const chatKey = `ba_wechat_chat_${user?.id}`
  const link = useQuery({ queryKey: ['wechat-link'], queryFn: api.wechatLink })
  const [token, setToken] = useState<string | null>(() => stored<string | null>(tokenKey, null))
  const [lines, setLines] = useState<Line[]>(() => stored<Line[]>(chatKey, []))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [pin, setPin] = useState('')
  const [linking, setLinking] = useState(false)
  const [message, setMessage] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const ready = !!(link.data?.linked && token)

  useEffect(() => { keep(chatKey, lines.slice(-60)) }, [chatKey, lines])
  useEffect(() => { try { localStorage.removeItem(tokenKey) } catch { /* storage unavailable */ } }, [tokenKey])  // a copy an older version left
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [lines, busy])

  const add = (...more: Omit<Line, 'id'>[]) => setLines((all) => [...all, ...more.map((l, i) => ({ ...l, id: Date.now() + i }))])

  async function say(words: string) {
    const clean = words.trim()
    if (!clean || !token || busy) return
    setText('')
    add({ from: 'me', text: clean })
    setBusy(true)
    try {
      const replies = await wechatSay(token, clean, lang)
      add(...replies.map((reply) => ({ from: 'bank' as const, reply })))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_LINKED') {
        drop(tokenKey); setToken(null); void qc.invalidateQueries({ queryKey: ['wechat-link'] })
      }
      add({ from: 'note', text: errorText(err, lang) })
    } finally {
      setBusy(false)
    }
  }

  async function linkNow(e: FormEvent) {
    e.preventDefault()
    setLinking(true); setMessage('')
    try {
      const linked = await api.linkWechat(pin)
      keep(tokenKey, linked.token); setToken(linked.token); setPin('')
      add({ from: 'note', text: tr(`Linked to your Central Union Bank account (WeChat ID ${linked.openid}).`, `已绑定中联银行账户（微信号 ${linked.openid}）。`) })
      void qc.invalidateQueries({ queryKey: ['wechat-link'] })
    } catch (err) {
      setMessage(errorText(err, lang))
    } finally {
      setLinking(false)
    }
  }

  async function unlinkNow() {
    setLinking(true); setMessage('')
    try {
      await api.unlinkWechat()
      drop(tokenKey); setToken(null)
      add({ from: 'note', text: tr('Unlinked: this WeChat can no longer reach your account.', '已解除绑定：这个微信不能再访问你的账户。') })
      void qc.invalidateQueries({ queryKey: ['wechat-link'] })
    } catch (err) {
      setMessage(errorText(err, lang))
    } finally {
      setLinking(false)
    }
  }

  const suggestions = [tr('How much did I spend this month?', '这个月花了多少'), tr('Any unusual charges?', '最近有没有异常交易'),
    tr('Send Mum 200', '给妈妈转200'), tr('Send Zhou Kai 800', '给周凯转800')]

  const bubble = (l: Line) => {
    if (l.from === 'me') return <p className="keep ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-tile rounded-br-md bg-[var(--action)] px-3.5 py-2 text-body text-[var(--action-ink)]">{l.text}</p>
    if (l.from === 'note') return <p className="mx-auto max-w-[90%] text-center text-xs text-ink2">{l.text}</p>
    const r = l.reply!
    let body
    if (r.kind === 'text') body = <p className="whitespace-pre-wrap">{r.text}</p>
    else if (r.kind === 'link') body = <Link to={r.url.replace(/^\/#/, '')} className="font-semibold text-[var(--action)]">{r.text}</Link>
    else body = (
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 font-semibold"><Icon name="lock" size={14} />{r.text}</p>
        <ul className="space-y-1 text-sm">{r.lines.map((x, i) => <li key={i}>· {x}</li>)}</ul>
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink2"><TierTag tier={r.tier} />{tr(`Needs ${r.needs}`, `需要：${r.needs}`)}</p>
        <button type="button" className="btn btn-ink w-full py-2 text-sm" onClick={() => navigate(`/confirm/${r.plan_id}`)}>{tr('Open the bank app to confirm', '去银行 App 确认')}</button>
      </div>
    )
    return (
      <div className="flex gap-2">
        <span className="mt-0.5 shrink-0"><BrandMark size={26} /></span>
        <div className="card w-fit max-w-[85%] !rounded-tile !rounded-tl-md px-3.5 py-2 text-body">{body}</div>
      </div>
    )
  }

  return (
    <main tabIndex={-1} className="page-content">
      <PageHead title={tr('WeChat assistant (simulated)', '微信助手（模拟）')} />
      <Notice icon="chat" title={tr('A simulation of the coming WeChat Mini Program', '模拟演示：将来会做成微信小程序')}>
        {tr('Ask in WeChat, confirm in the app. In the chat you can ask and start requests; anything that moves money or changes a setting is confirmed only in the bank app.',
          'IM 里说，App 里确认。在微信里可以查询、可以发起请求；任何动钱或改设置的操作，都只能回到银行 App 里确认。')}
      </Notice>

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <section aria-label={tr('Simulated WeChat chat', '模拟的微信聊天')} className="mx-auto w-full max-w-[400px] overflow-hidden rounded-[28px] border border-[var(--rule)] bg-[var(--card)] shadow-[0_12px_40px_var(--shadow)]">
          <header className="flex items-center gap-2 border-b border-[var(--rule)] px-4 py-3">
            <BrandMark size={24} />
            <p className="flex-1 font-semibold">{tr('Central Union Bank assistant', '中联银行助手')}</p>
            <Badge tone="grey">{tr('Simulated', '模拟')}</Badge>
          </header>
          <div className="h-[460px] space-y-3 overflow-y-auto bg-paper2 px-3 py-4" aria-live="polite">
            {!ready && <p className="mx-auto max-w-[90%] text-center text-xs text-ink2">{tr('Link your bank account first, under “Link WeChat” (in the bank app).', '请先在“绑定微信”里绑定银行账户（在银行 App 里完成）。')}</p>}
            {lines.map((l) => <div key={l.id} className="msg-in">{bubble(l)}</div>)}
            {busy && <p className="flex items-center gap-2 text-sm text-ink2" role="status"><span className="typing-dots" aria-hidden><i /><i /><i /></span>{tr('Replying…', '正在回复…')}</p>}
            <div ref={end} />
          </div>
          <div className="border-t border-[var(--rule)] p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => <button key={s} type="button" disabled={!ready || busy} onClick={() => void say(s)} className="btn btn-line shrink-0 px-3 py-1 text-xs">{s}</button>)}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void say(text) }}>
              <input className="field flex-1" value={text} maxLength={1000} disabled={!ready} onChange={(e) => setText(e.target.value)}
                placeholder={ready ? tr('Message the bank…', '给银行发消息…') : tr('Not linked yet', '尚未绑定')} aria-label={tr('Message', '消息')} />
              <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-box bg-[var(--action)] text-[var(--action-ink)] disabled:opacity-40" disabled={!ready || busy || !text.trim()} aria-label={tr('Send', '发送')}><SendHorizontal size={18} /></button>
            </form>
          </div>
        </section>

        <div className={`space-y-8 ${ready ? '' : 'max-lg:order-first'}`}>
          <Section title={tr('Link WeChat (in the bank app)', '绑定微信（在银行 App 里）')}
            aside={<Badge tone={ready ? 'green' : 'grey'}>{ready ? tr('Linked', '已绑定') : tr('Not linked', '未绑定')}</Badge>}>
            <div className="card space-y-3 p-5 max-sm:p-4">
              {ready ? <>
                <p className="text-sm">{tr(`WeChat ID ${link.data?.openid}, linked ${link.data?.linked_at?.slice(0, 10)}.`, `微信号 ${link.data?.openid}，${link.data?.linked_at?.slice(0, 10)} 绑定。`)}</p>
                <button type="button" className="btn btn-line text-cinnabar" disabled={linking} onClick={() => void unlinkNow()}>{tr('Unlink', '解除绑定')}</button>
              </> : <form onSubmit={linkNow} className="grid gap-2">
                <p className="text-sm text-ink2">{link.data?.linked
                  ? tr('Another device is linked. Linking here replaces it.', '已在其他设备绑定；在这里绑定会替换它。')
                  : tr('Linking lets this WeChat ask about your account. Enter your transaction PIN to allow it.', '绑定后，这个微信可以查询你的账户。请输入交易密码确认。')}</p>
                <input className="field num tracking-[0.4em]" type="password" inputMode="numeric" maxLength={6} value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder={tr('Transaction PIN', '交易密码')} aria-label={tr('Transaction PIN', '交易密码')} />
                {user?.demo_pin && (
                  <p className="flex items-center justify-between gap-2 text-xs text-ink2">
                    {tr(`Demo account: the PIN is ${user.demo_pin}`, `演示账户：交易密码是 ${user.demo_pin}`)}
                    <button type="button" className="min-h-10 px-2 font-semibold text-[var(--action)]" onClick={() => setPin(user.demo_pin ?? '')}>{tr('Fill it in', '填入')}</button>
                  </p>
                )}
                <button className="btn btn-ink" disabled={linking || pin.length !== 6}>{linking ? tr('Linking…', '绑定中…') : tr('Link WeChat', '确认绑定')}</button>
              </form>}
              {message && <p role="alert" className="text-sm text-cinnabar">{message}</p>}
            </div>
          </Section>

          <Section title={tr('What the WeChat assistant can and can’t do', '微信助手能做什么、不能做什么')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="card space-y-1.5 p-5 text-sm max-sm:p-4">
                <p className="mb-1 font-semibold text-jade">{tr('Can', '可以')}</p>
                <p>· {tr('Answer questions: balances, spending, unusual charges', '查询：余额、账单、异常交易')}</p>
                <p>· {tr('Start requests: transfers, card changes, a birthday plan', '发起请求：转账、卡片设置、生日计划')}</p>
                <p>· {tr('Ask you to choose when something is unclear', '有歧义时让你选择')}</p>
              </div>
              <div className="card space-y-1.5 p-5 text-sm max-sm:p-4">
                <p className="mb-1 font-semibold text-cinnabar">{tr('Can’t', '不可以')}</p>
                <p>· {tr('Approve anything: every yes is given in the bank app, with your PIN and an SMS code when the rules say so', '确认任何操作：都要回到银行 App，按规则输入交易密码和短信验证码')}</p>
                <p>· {tr('Show full card or phone numbers: they are masked in the chat', '显示完整卡号和手机号：聊天里一律脱敏')}</p>
                <p>· {tr('Work while the safety lock is on, or after you unlink', '安全锁开启或解除绑定后继续使用')}</p>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </main>
  )
}
