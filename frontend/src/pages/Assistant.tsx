import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Mic, Paperclip, SendHorizontal } from 'lucide-react'
import { api, errorText } from '../api/client'
import type { PlanRow, UploadResult } from '../api/types'
import { useLang } from '../i18n'
import { Icon } from '../components/Icon'
import { BrandSeal, SealMark } from '../components/Seal'
import { PlanView, markColor, markFor, statusLabel } from '../components/PlanView'
import { Result } from '../components/Results'
import { useOverview, usePlans } from '../lib/bank'
import { useChat } from '../lib/chat'
import { clock, yuan } from '../lib/format'
import { prepareUpload } from '../lib/upload'

const SUGGESTIONS: [string, string][] = [
  ["What's my balance?", '我卡里还有多少钱'],
  ['Send Mom 200', '给妈妈转200'],
  ['Pay my landlord 3200 for rent', '给房东转3200房租'],
  ['How much did I spend last month?', '上个月花了多少钱'],
  ['Anything unusual on my account?', '最近有没有异常交易'],
  ['How much did I spend on coffee on weekends after 8pm?', '周末晚上8点后喝咖啡花了多少钱'],
  ['What subscriptions am I paying for?', '我有哪些自动续费'],
  ["Split last night's hotpot with Liu Yang and Wang Fang", '昨晚海底捞和刘洋、王芳AA'],
  ["My wife's birthday is next month: set aside 1000 and order flowers and a cake two days before", '下个月老婆生日，帮我预留1000元，提前两天订花和蛋糕'],
  ['Freeze my virtual card', '冻结我的虚拟卡'],
  ["I have 100000 I won't need for a year. What should I invest in?", '有10万一年不用，推荐个理财'],
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Recognition: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined

export default function Assistant() {
  const { tr } = useLang()
  const plans = usePlans()
  const overview = useOverview()
  const { planId } = useChat()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const rows = plans.data?.items ?? []
  const shown = rows.filter((p) => p.request.toLowerCase().includes(search.toLowerCase()))
  const hasPasskey = !!overview.data?.has_passkey

  return (
    <main tabIndex={-1} className="page-content ">
      <div>
        <h1 className="cond text-[2.4rem] font-extrabold leading-tight">{tr('Assistant', '助手')}</h1>
        <p className="mt-2 text-sm text-ink2">{tr('Tell the assistant what you need. It plans the steps; the bank’s rules decide which run at once, which wait for your confirmation and which need your PIN and a code.', '告诉助手你要办什么。它拆出步骤，银行规则决定哪些直接执行、哪些等你确认、哪些需要交易密码和验证码。')}</p>
      </div>

      <dl className="metric-grid mt-7">
        {[
          { label: tr('Requests', '请求'), value: rows.length, icon: 'chat' as const },
          { label: tr('Done', '已办成'), value: rows.filter((p) => p.status === 'done').length, icon: 'check' as const },
          { label: tr('Waiting for you', '等你确认'), value: rows.filter((p) => p.status === 'awaiting_approval' || p.status === 'clarifying').length, icon: 'clock' as const },
          { label: tr('Stopped or flagged', '已拦下或被标记'), value: rows.filter((p) => p.status === 'failed' || p.flags.length).length, icon: 'flag' as const },
        ].map((x) => <div className="metric-card" key={x.label}><dt>{x.label}<Icon name={x.icon} size={17} /></dt><dd>{plans.isLoading ? '—' : x.value}</dd></div>)}
      </dl>
      <Roles />

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Conversation />
        <section id="plan-panel" className="ruled scroll-mt-6 bg-field" aria-label={tr('Current plan', '当前计划')}>
          <div className="panel-heading"><div><h2>{tr('Approval slip', '审批单')}</h2><p>{tr('The latest plan: each step, the rule that decided it, and your decision.', '最新的计划：每一步、决定它的规则，以及你的决定。')}</p></div><Icon name="shield" className="text-ink2" /></div>
          <div className="p-4">
            {planId ? <PlanView planId={planId} hasPasskey={hasPasskey} /> : <p className="py-10 text-center text-sm text-ink2">{tr('Ask for something on the left. Its plan appears here.', '在左侧提出一个请求，它的计划会出现在这里。')}</p>}
          </div>
        </section>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
        <h2 className="cond text-xl font-bold">{tr('Your requests', '你的请求')}</h2>
        <label className="flex w-full items-center gap-2 rounded-box border border-rule bg-field px-3 py-2 sm:w-64"><Icon name="search" size={16} className="text-ink2" /><input className="min-w-0 w-full bg-transparent text-sm" aria-label={tr('Search requests', '搜索请求')} placeholder={tr('Search requests…', '搜索请求…')} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      </div>
      <div className="mt-3">
        <PlansTable rows={search ? shown : rows} loading={plans.isLoading} selected={selected} onSelect={setSelected} />
      </div>
      {selected && <PlanModal planId={selected} row={rows.find((r) => r.id === selected)} hasPasskey={hasPasskey} onClose={() => setSelected(null)} />}
    </main>
  )
}

// one column on phones, 2×2 on tablets, one row on wide screens
const ROLE_BORDERS = ['', 'border-t sm:border-l sm:border-t-0', 'border-t xl:border-l xl:border-t-0', 'border-t sm:border-l xl:border-t-0']

/** What happens to a request, stated once: the AI plans, the rules decide, you approve. */
function Roles() {
  const { tr } = useLang()
  const steps = [
    [tr('You ask', '你提出需求'), tr('Type, speak or attach a receipt, in Chinese or English. Typed PINs and codes are hidden at once.', '打字、说话或附上小票，中英文都可以。误打的密码和验证码会立刻被隐藏。')],
    [tr('The AI plans', 'AI 拆解计划'), tr('It turns the request into steps from a fixed list of bank actions. It cannot run them, approve them or see your data.', '把请求拆成固定操作清单里的步骤。它不能执行、不能批准，也看不到你的数据。')],
    [tr('The rules decide', '规则来判定'), tr('Fixed code matches names to your records and gives each step a tier: green runs, yellow asks, red needs a strong check.', '固定代码把名字匹配到你的记录，并给每一步分级：绿色直接执行，黄色需确认，红色需强验证。')],
    [tr('You approve', '你来确认'), tr('One tap for yellow; your PIN plus an SMS code or passkey for red. Everything lands in your ledger.', '黄色点一下确认；红色要交易密码加短信验证码或通行密钥。每一步都记入账本。')],
  ]
  return (
    <ol className="mt-5 grid overflow-hidden ruled bg-field sm:grid-cols-2 xl:grid-cols-4" aria-label={tr('How a request is decided', '请求如何被决定')}>
      {steps.map(([title, text], i) => (
        <li key={title} className={`border-rule p-3 ${ROLE_BORDERS[i]}`}>
          <p className="text-xs font-semibold text-rule2">0{i + 1}</p>
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 text-[0.85rem] leading-snug text-ink2">{text}</p>
        </li>
      ))}
    </ol>
  )
}

function Conversation() {
  const { tr, lang } = useLang()
  const { messages, pending, error, send, escalated, newConversation } = useChat()
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 60_000 })
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<UploadResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [listening, setListening] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [messages.length, pending])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!text.trim() && !attachment) return
    const value = text.trim() || tr('What does this receipt say?', '这张小票多少钱')
    setText('')
    const id = attachment?.id
    setAttachment(null)
    void send(value, id)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit()
  }
  async function attach(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      setAttachment(await api.upload(await prepareUpload(file)))
    } catch (err) {
      setUploadError(err instanceof Error && 'code' in err && (err.code === 'too_big' || err.code === 'wrong_type')
        ? tr('Use a PDF, PNG or JPG under 5 MB.', '请使用 5 MB 以内的 PDF、PNG 或 JPG。') : errorText(err, lang))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  /** Voice input where the browser offers speech recognition; the words land in the box to check before sending. */
  function listen() {
    if (!Recognition || listening) return
    const recognition = new Recognition()
    recognition.lang = lang === 'zh' ? 'zh-CN' : 'en-US'
    recognition.interimResults = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => setText(Array.from(event.results).map((r: any) => r[0].transcript).join(''))
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    setListening(true)
    recognition.start()
  }

  return (
    <section className="ruled bg-field" aria-label={tr('Conversation', '对话')}>
      <div className="panel-heading">
        <div><h2>{tr('Conversation', '对话')}</h2><p>{health.data?.planner === 'ai' ? tr('Planned by the AI model; checked by the bank’s rules.', '由 AI 模型规划，由银行规则检查。') : tr('Offline planner (no AI key needed); checked by the bank’s rules.', '离线规划器（无需 AI 密钥），由银行规则检查。')}</p></div>
        <button type="button" className="btn btn-line shrink-0 whitespace-nowrap py-1.5 text-sm" onClick={() => void newConversation()}>{tr('New conversation', '新对话')}</button>
      </div>
      <div ref={list} className="max-h-[34rem] min-h-[18rem] space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && !pending && (
          <div>
            <p className="cond text-xl font-bold">{tr('What do you need today?', '今天想办点什么？')}</p>
            <p className="mt-1 text-sm text-ink2">{tr('Try one of these, or type your own.', '试试下面这些，或者直接输入。')}</p>
            <div className="demo-options">
              {SUGGESTIONS.map(([en, zh]) => <button key={zh} type="button" onClick={() => void send(lang === 'zh' ? zh : en)}>{lang === 'zh' ? zh : en}</button>)}
            </div>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === 'user') {
            const file = m.cards.find((c) => c.type === 'attachment')
            return (
              <div key={m.id} className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1.5">
                {file && <img src={file.preview} alt={tr('Attached receipt', '附带的小票')} className="h-28 ruled bg-white object-contain" />}
                <p className="keep whitespace-pre-wrap rounded-box bg-[var(--action)] px-3 py-2 text-[0.95rem] text-[var(--action-ink)]">{m.text}</p>
              </div>
            )
          }
          if (m.role === 'system') return <p key={m.id} className="mx-auto max-w-[90%] text-center text-xs text-ink2">{m.text}</p>
          return (
            <div key={m.id} className="flex gap-2.5">
              <span className="mt-0.5 shrink-0">{m.role === 'operator' ? <span className="agent-avatar !h-7 !w-7"><Icon name="users" size={14} /></span> : <BrandSeal size={26} />}</span>
              <div className="min-w-0 flex-1 space-y-2.5">
                {m.role === 'operator' && <p className="text-xs font-semibold text-ink2">{tr('Bank operator', '人工客服')}</p>}
                {m.text && <p className="keep whitespace-pre-wrap text-[0.95rem] leading-relaxed">{m.text}</p>}
                {m.cards.map((card, i) => <Result key={`${m.id}-${i}`} card={card} />)}
              </div>
            </div>
          )
        })}
        {pending && <>
          <p className="keep ml-auto w-fit max-w-[85%] rounded-box bg-[var(--action)] px-3 py-2 text-[0.95rem] text-[var(--action-ink)] opacity-70">{pending}</p>
          <p className="flex items-center gap-2 text-sm text-ink2" role="status"><span className="step-live inline-block h-2 w-2 rounded-full bg-jade" aria-hidden />{tr('Planning and checking the rules…', '正在规划并核对规则…')}</p>
        </>}
        {error && <p role="alert" className="text-sm font-semibold text-cinnabar">{error}</p>}
      </div>
      <form onSubmit={submit} className="border-t border-rule p-3">
        {escalated && <p className="mb-2 text-xs font-semibold text-ink2">{tr('A bank operator is handling this conversation.', '人工客服正在处理本次对话。')}</p>}
        {attachment && (
          <div className="mb-2 flex items-center gap-3 rounded-box border border-rule bg-sheet p-2">
            {attachment.preview && <img src={attachment.preview} alt="" className="h-12 w-12 rounded-[4px] bg-white object-contain" />}
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-semibold">{attachment.reading.merchant || tr('Receipt', '小票')}</p>
              <p className="text-xs text-ink2">
                {attachment.reading.total_fen !== null ? `${tr('Total', '合计')} ${yuan(attachment.reading.total_fen)}` : tr("Couldn't read a total", '未读出金额')}
                {attachment.read_by === 'rules' ? tr(', read from the PDF text', '，从 PDF 文字读取') : tr(', read by the AI model', '，由 AI 模型读取')}
              </p>
              {attachment.flags.length > 0 && <p className="text-xs font-semibold text-cinnabar">{tr('Hidden text or instructions found: they will be ignored, and actions need strong verification.', '发现隐藏文字或指令：不会执行，相关操作需强验证。')}</p>}
            </div>
            <button type="button" onClick={() => setAttachment(null)} className="rounded-box px-2 py-1 text-ink2 hover:bg-paper2" aria-label={tr('Remove attachment', '移除附件')}>✕</button>
          </div>
        )}
        {uploadError && <p role="alert" className="mb-2 text-xs font-semibold text-cinnabar">{uploadError}</p>}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="sr-only" onChange={(e) => void attach(e.target.files?.[0])} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="btn btn-line h-11 w-11 shrink-0 p-0" aria-label={tr('Attach a receipt', '添加小票')} title={tr('Attach a receipt', '添加小票')}>
            <Paperclip size={18} className={uploading ? 'step-live' : ''} />
          </button>
          {Recognition && (
            <button type="button" onClick={listen} className={`btn h-11 w-11 shrink-0 p-0 ${listening ? 'btn-ink' : 'btn-line'}`} aria-label={tr('Speak', '语音输入')} aria-pressed={listening} title={tr('Speak', '语音输入')}>
              <Mic size={18} />
            </button>
          )}
          <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} maxLength={2000}
            placeholder={tr('Type what you need, e.g. "send Mom 200"', '说说你要办的事，例如“给妈妈转200”')}
            aria-label={tr('Message', '消息')} className="field max-h-32 min-h-[44px] min-w-0 flex-1 resize-none overflow-hidden" />
          <button className="btn btn-ink h-11 w-11 shrink-0 p-0" disabled={(!text.trim() && !attachment) || !!pending} aria-label={tr('Send', '发送')}><SendHorizontal size={18} /></button>
        </div>
      </form>
    </section>
  )
}

function PlansTable({ rows, loading, selected, onSelect }: { rows: PlanRow[]; loading: boolean; selected: string | null; onSelect: (id: string) => void }) {
  const { t, tr } = useLang()
  if (loading) return <div className="h-64 animate-pulse rounded-box bg-paper2" aria-hidden />
  if (rows.length === 0) return <p className="py-8 text-ink2">{tr('Nothing yet. Ask the assistant above.', '还没有记录，在上面向助手提一个请求。')}</p>
  return (
    <div className="min-w-0 self-start overflow-x-auto ruled bg-field">
      <table className="w-full min-w-[44rem] border-collapse text-left text-[0.93rem]">
        <thead>
          <tr className="rule-b bg-paper text-[0.84rem] text-rule2">
            <th className="px-3 py-2 font-normal">{t.col_time}</th>
            <th className="px-3 py-2 font-normal">{t.col_request}</th>
            <th className="px-3 py-2 font-normal">{t.col_event}</th>
            <th className="px-3 py-2 font-normal">{t.col_reason}</th>
            <th className="px-3 py-2 text-right font-normal">{t.col_amount}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const mark = markFor(p)
            const active = p.id === selected
            return (
              <tr key={p.id} onClick={() => onSelect(p.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(p.id)} tabIndex={0} aria-selected={active}
                className={`rule-b cursor-pointer last:border-b-0 ${active ? 'bg-sheet shadow-[inset_3px_0_0_var(--ink)]' : 'hover:bg-sheet'}`}>
                <td className="num px-3 py-2 font-mono text-[0.83rem] text-ink2">{clock(p.created_at)}</td>
                <td className="max-w-[18rem] truncate px-3 py-2" title={p.request}>{p.request}</td>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <SealMark kind={mark} size={26} />
                    <span className="whitespace-nowrap font-semibold" style={{ color: markColor(mark) }}>{statusLabel(p.status, t)}</span>
                    {p.flags.length > 0 && <SealMark kind="flag" size={22} />}
                  </span>
                </td>
                <td className="max-w-[16rem] truncate px-3 py-2" title={p.reason ?? ''}>{p.reason || <span className="text-ink2">—</span>}</td>
                <td className="num whitespace-nowrap px-3 py-2 text-right font-mono">{p.fen ? yuan(p.fen) : <span className="text-ink2">—</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PlanModal({ planId, row, hasPasskey, onClose }: { planId: string; row?: PlanRow; hasPasskey: boolean; onClose: () => void }) {
  const { tr } = useLang()
  const trail = useQuery({ queryKey: ['audit', 'plan', planId], queryFn: () => api.audit(200, planId) })
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // the list stays mounted underneath, so its search and scroll position survive closing
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
      before?.focus?.({ preventScroll: true })
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-[rgba(0,0,0,0.55)] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={tr('Request detail', '请求详情')} tabIndex={-1} className="flex h-full w-full flex-col overflow-hidden bg-field outline-none sm:h-auto sm:max-h-[92dvh] sm:max-w-6xl sm:rounded-box sm:border-[1.5px] sm:border-rule2">
        <div className="flex items-start justify-between gap-3 border-b-[1.5px] border-rule2 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={row?.request}>“{row?.request ?? ''}”</p>
            <p className="text-xs text-ink2">{row ? clock(row.created_at) : ''}{row ? `, ${row.source === 'ai' ? tr('AI planner', 'AI 规划') : row.source === 'scheduler' ? tr('scheduler', '定时任务') : tr('offline planner', '离线规划器')}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-box px-2 py-1 text-lg text-ink2 hover:bg-paper2" aria-label={tr('Close', '关闭')}>✕</button>
        </div>
        <div className="grid flex-1 content-start gap-6 overflow-y-auto p-4 lg:grid-cols-2 lg:p-6">
          <div className="min-w-0"><PlanView planId={planId} hasPasskey={hasPasskey} /></div>
          <div className="min-w-0 space-y-5">
            <Section title={tr('Ledger entries for this request', '这项请求的账本记录')}>
              {!trail.data ? <div className="h-40 animate-pulse rounded-box bg-paper2" /> : (
                <ol className="divide-y divide-rule ruled">
                  {trail.data.items.slice().reverse().map((e) => (
                    <li key={e.seq} className="px-3 py-2 text-sm">
                      <p className="flex items-baseline justify-between gap-3"><span className="font-semibold">#{e.seq} {e.kind}</span><span className="num font-mono text-xs text-ink2">{clock(e.at)}</span></p>
                      <p className="mt-0.5 break-all font-mono text-[0.75rem] text-ink2">{JSON.stringify(e.data).slice(0, 220)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
            <p className="font-mono text-xs text-ink2">id {planId}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 className="cond text-lg font-bold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}
