import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Mic, Paperclip, SendHorizontal } from 'lucide-react'
import { api, errorText } from '../api/client'
import type { UploadResult } from '../api/types'
import { useLang } from '../i18n'
import { Icon, type IconName } from '../components/Icon'
import { BrandSeal } from '../components/Seal'
import { Result } from '../components/Results'
import { useAuth } from '../lib/auth'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'
import { prepareUpload } from '../lib/upload'

/** Things to try, one per kind of task, in the words a customer would use. */
const SUGGESTIONS: [IconName, string, string][] = [
  ['wallet', "What's my balance?", '我卡里还有多少钱'],
  ['arrow', 'Send Mom 200', '给妈妈转200'],
  ['chart', 'Where did my money go last month?', '上个月钱都花哪了'],
  ['flag', 'Anything suspicious on my account?', '最近有没有可疑交易'],
  ['card', 'Freeze my virtual card', '冻结我的虚拟卡'],
  ['bell', 'What subscriptions am I paying for?', '我有哪些自动续费'],
  ['users', "Split last night's hotpot with Liu Yang and Wang Fang", '昨晚海底捞和刘洋、王芳AA'],
  ['trend', "I have 100000 I won't need for a year. What should I invest in?", '有10万一年不用，推荐个理财'],
  ['clock', "My wife's birthday is next month: set aside 1000 and order flowers and a cake two days before", '下个月老婆生日，帮我预留1000元，提前两天订花和蛋糕'],
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Recognition: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined

export default function Assistant() {
  const { tr, lang } = useLang()
  const { user } = useAuth()
  const { messages, pending, error, send, escalated, newConversation } = useChat()
  const notes = useQuery({ queryKey: ['notifications', lang], queryFn: () => api.notifications(lang) })
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<UploadResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [listening, setListening] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const asked = useRef(false)

  // a sentence tapped on the landing page arrives as ?ask=…
  useEffect(() => {
    const ask = params.get('ask')
    if (ask && !asked.current) {
      asked.current = true
      setParams({}, { replace: true })
      void send(ask)
    }
  }, [params, setParams, send])
  useEffect(() => { if (messages.length || pending) end.current?.scrollIntoView({ block: 'end' }) }, [messages.length, pending])

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

  return (
    <main tabIndex={-1} className="page-content">
      <div className="mx-auto flex min-h-[calc(100dvh-210px)] w-full max-w-3xl flex-col">
        <div className="flex items-center justify-between gap-3">
          <h1 className="cond text-2xl font-extrabold">{tr('Assistant', '助手')}</h1>
          {messages.length > 0 && <button type="button" className="btn btn-line shrink-0 whitespace-nowrap py-1.5 text-sm" onClick={() => void newConversation()}>{tr('New chat', '新对话')}</button>}
        </div>

        <div className="flex-1 space-y-5 py-5" aria-live="polite">
          {messages.length === 0 && !pending && (
            <div className="pt-4">
              <p className="cond text-[1.9rem] font-extrabold leading-tight">{name ? tr(`Hi ${name}. What can I do for you?`, `${name}，你好。今天想办点什么？`) : tr('What can I do for you?', '今天想办点什么？')}</p>
              <p className="mt-2 text-ink2">{tr('Just say it, in Chinese or English. I always ask before any money moves.', '直接说就行，中文英文都可以。动钱之前，我都会先问你。')}</p>
              {tips.length > 0 && (
                <div className="mt-6 space-y-2">
                  <p className="text-sm font-semibold text-ink2">{tr('You might want to', '你可能需要')}</p>
                  {tips.map((n) => (
                    <button key={n.id} type="button" disabled={!!pending} onClick={() => void send(n.suggestion!)} className="flex w-full items-start gap-3 rounded-box border border-rule bg-field px-4 py-3 text-left hover:border-[var(--action)]">
                      <Icon name={n.kind === 'anomaly' ? 'flag' : n.kind === 'birthday' ? 'clock' : 'bell'} size={18} className="mt-0.5 shrink-0 text-[var(--action)]" />
                      <span className="min-w-0"><span className="block font-semibold">{n.title}</span><span className="block text-sm text-ink2">{n.suggestion}</span></span>
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-6 text-sm font-semibold text-ink2">{tr('Try one of these', '试试这样说')}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map(([icon, en, zh]) => (
                  <button key={zh} type="button" disabled={!!pending} onClick={() => void send(lang === 'zh' ? zh : en)} className="flex items-center gap-2.5 rounded-box border border-rule bg-field px-3 py-2.5 text-left text-[0.93rem] hover:border-[var(--action)]">
                    <Icon name={icon} size={17} className="shrink-0 text-[var(--action)]" />
                    <span className="min-w-0">{lang === 'zh' ? zh : en}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === 'user') {
              const file = m.cards.find((c) => c.type === 'attachment')
              return (
                <div key={m.id} className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1.5">
                  {file && <img src={file.preview} alt={tr('Attached receipt', '附带的小票')} className="h-28 ruled bg-white object-contain" />}
                  <p className="keep whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--action)] px-4 py-2.5 text-[0.95rem] text-[var(--action-ink)]">{m.text}</p>
                </div>
              )
            }
            if (m.role === 'system') return <p key={m.id} className="mx-auto max-w-[90%] text-center text-xs text-ink2">{m.text}</p>
            return (
              <div key={m.id} className="flex gap-2.5">
                <span className="mt-0.5 shrink-0">{m.role === 'operator' ? <span className="agent-avatar !h-7 !w-7"><Icon name="users" size={14} /></span> : <BrandSeal size={28} />}</span>
                <div className="min-w-0 flex-1 space-y-2.5">
                  {m.role === 'operator' && <p className="text-xs font-semibold text-ink2">{tr('Bank staff', '人工客服')}</p>}
                  {m.text && <p className="keep whitespace-pre-wrap text-[0.97rem] leading-relaxed">{m.text}</p>}
                  {m.cards.map((card, i) => <Result key={`${m.id}-${i}`} card={card} />)}
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

        <form onSubmit={submit} className="sticky bottom-0 -mx-1 bg-paper px-1 pb-4 pt-2">
          {escalated && <p className="mb-2 text-xs font-semibold text-ink2">{tr('A member of bank staff is handling this conversation.', '人工客服正在处理本次对话。')}</p>}
          {attachment && (
            <div className="mb-2 flex items-center gap-3 rounded-box border border-rule bg-sheet p-2">
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
          <div className="flex items-end gap-2 rounded-2xl border border-rule2 bg-field p-1.5 shadow-[0_6px_24px_var(--shadow)] focus-within:border-[var(--action)]">
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="sr-only" onChange={(e) => void attach(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink2 hover:bg-paper2" aria-label={tr('Attach a receipt', '添加小票')} title={tr('Attach a receipt photo or PDF', '添加小票照片或 PDF')}>
              <Paperclip size={18} className={uploading ? 'step-live' : ''} />
            </button>
            {Recognition && (
              <button type="button" onClick={listen} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${listening ? 'bg-ink text-field' : 'text-ink2 hover:bg-paper2'}`} aria-label={tr('Speak', '语音输入')} aria-pressed={listening} title={tr('Speak', '语音输入')}>
                <Mic size={18} />
              </button>
            )}
            <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} maxLength={2000}
              placeholder={tr('What do you need?', '说说你要办的事…')}
              aria-label={tr('Message', '消息')} className="max-h-32 min-h-[40px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[0.97rem] outline-none focus-visible:outline-none" />
            <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--action)] text-[var(--action-ink)] disabled:opacity-40" disabled={(!text.trim() && !attachment) || !!pending} aria-label={tr('Send', '发送')}><SendHorizontal size={18} /></button>
          </div>
          <p className="mt-1.5 text-center text-[0.72rem] text-ink2">{tr('Simulated bank. Money only moves after you confirm.', '模拟银行。只有你确认后，钱才会动。')}</p>
        </form>
      </div>
    </main>
  )
}
