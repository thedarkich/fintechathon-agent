import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { SendHorizontal, UserRound } from 'lucide-react'
import { CardView } from '../components/Cards'
import { Mark } from '../components/Chrome'
import { useLang } from '../i18n'
import { useChat } from '../lib/chat'

const SUGGESTIONS: [string, string][] = [
  ["What's my balance?", '我卡里还有多少钱'],
  ['Send Mom 200', '给妈妈转200'],
  ['Pay my landlord 3200 for rent', '给房东转3200房租'],
  ['How much did I spend last month?', '上个月花了多少钱'],
  ['Anything unusual on my account?', '最近有没有异常交易'],
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

export default function Chat() {
  const { tr, lang } = useLang()
  const { messages, pending, error, send, escalated } = useChat()
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages.length, pending])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!text.trim()) return
    const value = text
    setText('')
    void send(value)
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
            return <p key={m.id} className="keep ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-indigo px-4 py-2 text-[15px] text-[var(--indigo-ink)]">{m.text}</p>
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
        <div className="flex items-end gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} maxLength={2000}
            placeholder={tr('Type what you need, e.g. "send Mom 200"', '说说你要办的事，例如“给妈妈转200”')}
            aria-label={tr('Message', '消息')} className="field max-h-32 min-h-[44px] flex-1 resize-none overflow-hidden" />
          <button className="btn btn-primary h-11 w-11 p-0" disabled={!text.trim() || !!pending} aria-label={tr('Send', '发送')}><SendHorizontal size={18} /></button>
        </div>
      </form>
    </div>
  )
}
