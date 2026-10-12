import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Mic, Paperclip, SendHorizontal, UserRound, X } from 'lucide-react'
import { CardView } from '../components/Cards'
import { Mark } from '../components/Chrome'
import { useLang } from '../i18n'
import { errorText, uploadFile, type UploadResult } from '../lib/api'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'

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
  ['I have 100000 I won\'t need for a year. What should I invest in?', '有10万一年不用，推荐个理财'],
]

function Thinking() {
  const { tr } = useLang()
  return (
    <p className="flex items-center gap-2 text-sm text-ink3" role="status">
      <span className="live-dot h-2 w-2 rounded-full bg-indigo" aria-hidden />
      {tr('Planning and checking the rules…', '正在规划并核对规则…')}
    </p>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Recognition: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined

export default function Chat() {
  const { tr, lang } = useLang()
  const { messages, pending, error, send, escalated } = useChat()
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<UploadResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [listening, setListening] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages.length, pending])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!text.trim() && !attachment) return
    const value = text.trim() || tr('What does this receipt say?', '这张小票多少钱')
    setText('')
    const id = attachment?.id
    setAttachment(null)
    void send(value, id)
  }

  async function attach(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      setAttachment(await uploadFile(file))
    } catch (err) {
      setUploadError(errorText(err, lang))
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
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit()
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-5 px-4 pb-4 pt-5">
        {messages.length === 0 && !pending && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{tr('What do you need today?', '今天想办点什么？')}</h1>
            <p className="mt-1.5 text-sm text-ink2">{tr('Ask in Chinese or English. Questions run straight away; anything that moves money or changes a card waits for your OK.', '中文或英文都可以。查询会直接执行；动钱、改卡的操作会先等你确认。')}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {SUGGESTIONS.map(([en, zh]) => (
                <button key={zh} type="button" onClick={() => void send(lang === 'zh' ? zh : en)} className="rounded-xl border border-rule bg-sheet px-3 py-2 text-left text-sm hover:border-indigo">{lang === 'zh' ? zh : en}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === 'user') {
            const file = m.cards.find((c) => c.type === 'attachment')
            return (
              <div key={m.id} className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1.5">
                {file && <img src={file.preview} alt={tr('Attached receipt', '附带的小票')} className="h-28 rounded-xl border border-rule bg-white object-contain" />}
                <p className="keep whitespace-pre-wrap rounded-2xl rounded-br-md bg-indigo px-4 py-2 text-[15px] text-[var(--indigo-ink)]">{m.text}</p>
              </div>
            )
          }
          if (m.role === 'system') {
            return <p key={m.id} className="mx-auto max-w-[90%] text-center text-xs text-ink3">{m.text}</p>
          }
          return (
            <div key={m.id} className="flex gap-2.5">
              <span className="mt-0.5 shrink-0">{m.role === 'operator' ? <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-wash text-amber"><UserRound size={14} /></span> : <Mark size={24} />}</span>
              <div className="min-w-0 flex-1 space-y-3">
                {m.role === 'operator' && <p className="text-xs font-semibold text-amber">{tr('Bank operator', '人工客服')}</p>}
                {m.text && <p className="keep whitespace-pre-wrap text-[15px] leading-relaxed">{m.text}</p>}
                {m.cards.map((card, i) => <CardView key={`${m.id}-${i}`} card={card} />)}
              </div>
            </div>
          )
        })}
        {pending && <><p className="keep ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-indigo px-4 py-2 text-[15px] text-[var(--indigo-ink)] opacity-70">{pending}</p><Thinking /></>}
        {error && <p role="alert" className="rounded-lg bg-vermilion-wash px-3 py-2 text-sm text-vermilion">{error}</p>}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="sticky bottom-0 border-t border-rule bg-paper px-3 py-2.5">
        {escalated && <p className="mb-2 text-xs text-amber">{tr('A bank operator is handling this conversation.', '人工客服正在处理本次对话。')}</p>}
        {attachment && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border border-rule bg-sheet p-2">
            {attachment.preview && <img src={attachment.preview} alt="" className="h-12 w-12 rounded-md bg-white object-contain" />}
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-semibold">{attachment.reading.merchant || tr('Receipt', '小票')}</p>
              <p className="text-xs text-ink3">
                {attachment.reading.total_fen !== null ? `${tr('Total', '合计')} ${yuan(attachment.reading.total_fen)}` : tr("Couldn't read a total", '未读出金额')}
                {attachment.read_by === 'rules' ? tr(', read from the PDF text', '，从 PDF 文字读取') : tr(', read by the AI model', '，由 AI 模型读取')}
              </p>
              {attachment.flags.length > 0 && <p className="text-xs font-semibold text-vermilion">{tr('Hidden text or instructions found: they will be ignored, and actions need strong verification.', '发现隐藏文字或指令：不会执行，相关操作需强验证。')}</p>}
            </div>
            <button type="button" onClick={() => setAttachment(null)} className="rounded-lg p-1 text-ink2" aria-label={tr('Remove attachment', '移除附件')}><X size={16} /></button>
          </div>
        )}
        {uploadError && <p role="alert" className="mb-2 text-xs text-vermilion">{uploadError}</p>}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={(e) => void attach(e.target.files?.[0])} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="btn btn-quiet h-11 w-11 shrink-0 p-0" aria-label={tr('Attach a receipt', '添加小票')}>
            <Paperclip size={18} className={uploading ? 'live-dot' : ''} />
          </button>
          {Recognition && (
            <button type="button" onClick={listen} className={`btn h-11 w-11 shrink-0 p-0 ${listening ? 'btn-primary' : 'btn-quiet'}`} aria-label={tr('Speak', '语音输入')} aria-pressed={listening}>
              <Mic size={18} />
            </button>
          )}
          <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} maxLength={2000}
            placeholder={tr('Type what you need, e.g. "send Mom 200"', '说说你要办的事，例如“给妈妈转200”')}
            aria-label={tr('Message', '消息')} className="field max-h-32 min-h-[44px] min-w-0 flex-1 resize-none overflow-hidden" />
          <button className="btn btn-primary h-11 w-11 shrink-0 p-0" disabled={(!text.trim() && !attachment) || !!pending} aria-label={tr('Send', '发送')}><SendHorizontal size={18} /></button>
        </div>
      </form>
    </div>
  )
}
