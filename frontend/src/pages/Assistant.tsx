import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic, PanelLeftOpen, Paperclip, SendHorizontal, SquarePen } from 'lucide-react'
import { api, errorText } from '../api/client'
import type { UploadResult } from '../api/types'
import { useLang } from '../i18n'
import { Icon, type IconName } from '../components/Icon'
import { BrandSeal } from '../components/Seal'
import { Result } from '../components/Results'
import { ChatHistory } from '../components/ChatHistory'
import { ReplyText } from '../components/ReplyText'
import { useAuth } from '../lib/auth'
import { useChat } from '../lib/chat'
import { stamp, yuan } from '../lib/format'
import { prepareUpload } from '../lib/upload'
import { inWeChat } from '../lib/wechat'

/** Things to try, one per kind of task, in the words a customer would use. */
const SUGGESTIONS: [IconName, string, string][] = [
  ['wallet', "What's my balance?", '我卡里还有多少钱'],
  ['arrow', 'Send Mom 200', '给妈妈转200'],
  ['chart', 'Where did my money go last month?', '上个月钱都花哪了'],
  ['flag', 'Anything suspicious?', '有没有可疑交易'],
  ['card', 'Freeze my virtual card', '冻结我的虚拟卡'],
  ['bell', 'What subscriptions do I have?', '我有哪些自动续费'],
  ['trend', 'Recommend a low-risk product', '推荐一个稳健的理财'],
  ['clock', "Plan my wife's birthday next month", '下个月老婆生日，帮我准备一下'],
]

/** Answers whose card holds the details: the chat shows only the reply's first line, its headline. */
const DATA_CARDS = new Set(['balances', 'transactions', 'spending', 'report', 'anomalies', 'subscriptions', 'cards', 'holdings', 'products', 'compare', 'analysis'])

const WIDE = '(min-width: 1024px)'  // from here the chat list sits beside the chat; below, it is a drawer
const SIDEBAR_KEY = 'chat-history'

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  useEffect(() => {
    const query = window.matchMedia(WIDE)
    const change = () => setWide(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return wide
}

function sidebarStored(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) !== 'closed' } catch { return true }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// WeChat's webview has no browser speech recognition; the keyboard's own microphone works there.
const Recognition: any = typeof window !== 'undefined' && !inWeChat() ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined

export default function Assistant() {
  const { tr, lang } = useLang()
  const { user } = useAuth()
  const { conversationId, messages, pending, error, send, escalated, newConversation, openConversation } = useChat()
  const qc = useQueryClient()
  const notes = useQuery({ queryKey: ['notifications', lang], queryFn: () => api.notifications(lang) })
  const chats = useQuery({ queryKey: ['conversations'], queryFn: api.conversations })
  const wide = useWide()
  const [pinned, setPinned] = useState(sidebarStored)  // the desktop choice, remembered
  const [drawer, setDrawer] = useState(false)  // the phone drawer, closed on every visit
  const open = wide ? pinned : drawer
  const drawerStart = useRef<HTMLButtonElement>(null)
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<UploadResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [listening, setListening] = useState(false)
  const [hint, setHint] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const asked = useRef(false)

  // a sentence tapped on the landing page arrives as ?ask=… and is sent; a page's action arrives as ?hint=…,
  // an example that waits in the empty box for the customer's own words
  useEffect(() => {
    const ask = params.get('ask')
    const example = params.get('hint')
    if (ask && !asked.current) {
      asked.current = true
      setParams({}, { replace: true })
      void send(ask)
    } else if (example) {
      setHint(example)
      setParams({}, { replace: true })
      box.current?.focus()
    }
  }, [params, setParams, send])
  useEffect(() => { if (messages.length || pending) end.current?.scrollIntoView({ block: 'end' }) }, [messages.length, pending])

  // the phone drawer: focus moves in, Escape closes it, the page behind stays still
  useEffect(() => {
    if (wide || !drawer) return
    drawerStart.current?.focus()
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    const overflow = document.body.style.overflow
    document.addEventListener('keydown', escape)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', escape); document.body.style.overflow = overflow }
  }, [wide, drawer])

  const showHistory = (value: boolean) => {
    if (!wide) return setDrawer(value)
    setPinned(value)
    try { localStorage.setItem(SIDEBAR_KEY, value ? 'open' : 'closed') } catch { /* storage blocked: the choice lasts this visit */ }
  }
  const pick = (id: string) => {
    if (!wide) setDrawer(false)
    if (id !== conversationId) void openConversation(id)
  }
  const fresh = () => {
    if (!wide) setDrawer(false)
    void newConversation()
  }
  const remove = async (id: string) => {
    try {
      await api.hideConversation(id)
      if (id === conversationId) await newConversation()
    } finally {
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    }
  }

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
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()  // otherwise the newline lands in the emptied box
      submit()
    }
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

  const name = user?.name ?? ''
  const tips = (notes.data?.items ?? []).filter((n) => n.suggestion && !n.read).slice(0, 2)
  const title = chats.data?.items.find((c) => c.id === conversationId)?.title || messages.find((m) => m.role === 'user')?.text || ''
  const history = (first?: typeof drawerStart) => (
    <ChatHistory items={chats.data?.items} active={conversationId} busy={!!pending} first={first}
      onPick={pick} onNew={fresh} onRemove={(id) => void remove(id)} onClose={() => showHistory(false)} />
  )

  return (
    <main tabIndex={-1} className="page-content !max-w-[1280px]">
      <div className="flex items-start gap-6">
      {wide && open && (
        <aside className="sticky top-[calc(var(--header-h)+16px)] flex max-h-[calc(100dvh-var(--header-h)-2rem)] w-64 shrink-0 flex-col rounded-panel bg-[var(--field)]">{history()}</aside>
      )}
      {!wide && open && <>
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setDrawer(false)} aria-hidden />
        <aside role="dialog" aria-modal="true" aria-label={tr('Chat history', '对话记录')} className="drawer-in fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-[320px] flex-col bg-paper shadow-[0_0_40px_var(--shadow)]">{history(drawerStart)}</aside>
      </>}

      <div className="mx-auto flex min-h-[calc(100dvh-210px)] w-full min-w-0 max-w-3xl flex-1 flex-col">
        {(!open || messages.length > 0) && (
          <div className="sticky top-[var(--header-h)] z-10 -mx-1 flex min-h-[52px] items-center gap-2 bg-paper px-1 py-2">
            {!open && (
              <button type="button" onClick={() => showHistory(true)} aria-expanded={false} aria-label={tr('Show chat history', '展开对话记录')} title={tr('Chat history', '对话记录')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rule text-ink2 hover:bg-paper2">
                <PanelLeftOpen size={18} />
              </button>
            )}
            {messages.length > 0 && <h1 className="min-w-0 flex-1 truncate !text-base !font-semibold !tracking-normal" title={title}>{title}</h1>}
            {messages.length > 0 && !open && (
              <button type="button" className="btn btn-line shrink-0 gap-1.5 whitespace-nowrap py-1.5 text-sm" onClick={fresh} disabled={!!pending}>
                <SquarePen size={15} />{tr('New chat', '新对话')}
              </button>
            )}
          </div>
        )}

        <div className="flex-1 space-y-5 py-5" aria-live="polite">
          {messages.length === 0 && !pending && (
            <div className="pt-6">
              <h1 className="cond text-[2rem] font-extrabold leading-tight">{name ? tr(`Hi ${name}. What can I do for you?`, `${name}，你好。今天想办点什么？`) : tr('What can I do for you?', '今天想办点什么？')}</h1>
              {tips.length > 0 && (
                <div className="mt-6 space-y-2">
                  {tips.map((n) => (
                    <button key={n.id} type="button" disabled={!!pending} onClick={() => void send(n.suggestion!)} className="flex w-full items-start gap-3 rounded-[18px] bg-[var(--field)] px-4 py-3 text-left hover:bg-paper2">
                      <Icon name={n.kind === 'anomaly' ? 'flag' : n.kind === 'birthday' ? 'clock' : 'bell'} size={18} className="mt-0.5 shrink-0 text-[var(--action)]" />
                      <span className="min-w-0"><span className="block font-semibold">{n.title}</span><span className="block text-sm text-ink2">{n.suggestion}</span></span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-6 flex flex-wrap gap-2">
                {SUGGESTIONS.map(([icon, en, zh]) => (
                  <button key={zh} type="button" disabled={!!pending} onClick={() => void send(lang === 'zh' ? zh : en)} className="flex items-center gap-2 rounded-[12px] bg-[var(--field)] px-3.5 py-2 text-left text-[0.93rem] font-medium hover:bg-paper2">
                    <Icon name={icon} size={16} className="shrink-0 text-[var(--action)]" />
                    <span>{lang === 'zh' ? zh : en}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === 'user') {
              const file = m.cards.find((c) => c.type === 'attachment')
              return (
                <div key={m.id} className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1.5" title={stamp(m.at)}>
                  {file && <img src={file.preview} alt={tr('Attached receipt', '附带的小票')} className="h-28 ruled bg-white object-contain" />}
                  <p className="keep whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--action)] px-4 py-2.5 text-[0.95rem] text-[var(--action-ink)]">{m.text}</p>
                </div>
              )
            }
            if (m.role === 'system') return <p key={m.id} className="mx-auto max-w-[90%] text-center text-xs text-ink2">{m.text}</p>
            return (
              <div key={m.id} className="flex gap-2.5" title={stamp(m.at)}>
                <span className="mt-0.5 shrink-0">{m.role === 'operator' ? <span className="agent-avatar !h-7 !w-7"><Icon name="users" size={14} /></span> : <BrandSeal size={28} />}</span>
                <div className="min-w-0 flex-1 space-y-2.5">
                  {m.role === 'operator' && <p className="text-xs font-semibold text-ink2">{tr('Bank staff', '人工客服')}</p>}
                  {m.text && <div className="bot-bubble w-fit max-w-full rounded-[18px] rounded-tl-md bg-[var(--field)] px-4 py-2.5"><ReplyText text={m.cards.some((c) => DATA_CARDS.has(c.type)) ? m.text.split('\n')[0].replace(/[:：]\s*$/, '') : m.text} /></div>}
                  {m.cards.filter((card) => card.type !== 'receipt').map((card, i) => <Result key={`${m.id}-${i}`} card={card} />)}
                </div>
              </div>
            )
          })}
          {pending && <>
            <p className="keep ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[var(--action)] px-4 py-2.5 text-[0.95rem] text-[var(--action-ink)] opacity-70">{pending}</p>
            <p className="flex items-center gap-2 text-sm text-ink2" role="status"><span className="step-live inline-block h-2 w-2 rounded-full bg-jade" aria-hidden />{tr('Working on it…', '正在处理…')}</p>
          </>}
          {error && <p role="alert" className="text-sm font-semibold text-cinnabar">{error}</p>}
          <div ref={end} />
        </div>

        <form onSubmit={submit} className="sticky bottom-[var(--tabbar-h)] -mx-1 bg-paper px-1 pb-4 pt-2">
          {escalated && <p className="mb-2 text-xs font-semibold text-ink2">{tr('A member of bank staff is handling this conversation.', '人工客服正在处理本次对话。')}</p>}
          {attachment && (
            <div className="mb-2 flex items-center gap-3 rounded-[14px] bg-[var(--field)] p-2">
              {attachment.preview && <img src={attachment.preview} alt="" className="h-12 w-12 rounded-[4px] bg-white object-contain" />}
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-semibold">{attachment.reading.merchant || tr('Receipt', '小票')}</p>
                <p className="text-xs text-ink2">{attachment.reading.total_fen !== null ? `${tr('Total', '合计')} ${yuan(attachment.reading.total_fen)}` : tr("Couldn't read a total", '未读出金额')}</p>
                {attachment.flags.length > 0 && <p className="text-xs font-semibold text-cinnabar">{tr('This file has hidden text or instructions. They will be ignored, and anything based on it will need your PIN and a code.', '这个文件里有隐藏文字或指令，会被忽略；基于它的操作需要交易密码和验证码。')}</p>}
              </div>
              <button type="button" onClick={() => setAttachment(null)} className="rounded-box px-2 py-1 text-ink2 hover:bg-paper2" aria-label={tr('Remove attachment', '移除附件')}>✕</button>
            </div>
          )}
          {uploadError && <p role="alert" className="mb-2 text-xs font-semibold text-cinnabar">{uploadError}</p>}
          <div className="flex items-end gap-2 rounded-[16px] border border-transparent bg-[var(--field)] p-1.5 shadow-[0_6px_24px_var(--shadow)] focus-within:border-[var(--action)]">
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="sr-only" onChange={(e) => void attach(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink2 hover:bg-paper2" aria-label={tr('Attach a receipt', '添加小票')} title={tr('Attach a receipt photo or PDF', '添加小票照片或 PDF')}>
              <Paperclip size={18} className={uploading ? 'step-live' : ''} />
            </button>
            {Recognition && (
              <button type="button" onClick={listen} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${listening ? 'bg-ink text-field' : 'text-ink2 hover:bg-paper2'}`} aria-label={tr('Speak', '语音输入')} aria-pressed={listening} title={tr('Speak', '语音输入')}>
                <Mic size={18} />
              </button>
            )}
            <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} maxLength={2000}
              placeholder={hint ? tr(`e.g. ${hint}`, `例如：${hint}`) : tr('What do you need?', '说说你要办的事…')}
              aria-label={tr('Message', '消息')} className="max-h-32 min-h-[40px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[0.97rem] outline-none focus-visible:outline-none" />
            <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--action)] text-[var(--action-ink)] disabled:opacity-40" disabled={(!text.trim() && !attachment) || !!pending} aria-label={tr('Send', '发送')}><SendHorizontal size={18} /></button>
          </div>
        </form>
      </div>
      </div>
    </main>
  )
}
