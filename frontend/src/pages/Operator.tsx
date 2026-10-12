import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mark } from '../components/Chrome'
import { useLang } from '../i18n'
import { call, errorText, type Message, type Plan } from '../lib/api'

interface QueueItem { conversation_id: string; user: string; email: string; reason: string | null; locked: boolean }
interface Detail {
  conversation_id: string; escalated: boolean; user: { name: string; email: string }; messages: Message[]; plans: Plan[]
  locks: { scope: string; reason: string }[]; audit: { seq: number; kind: string; at: string; data: Record<string, unknown> }[]
}

/** Human takeover: read the conversation, the plans and the audit trail; reply, cancel or unlock.
 * There is deliberately no approve button: approval and strong verification stay with the customer. */
export default function Operator() {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const queue = useQuery({ queryKey: ['operator'], queryFn: () => call<{ items: QueueItem[] }>('/api/operator/queue'), refetchInterval: 5000 })
  const [selected, setSelected] = useState<string | null>(null)
  const detail = useQuery({ queryKey: ['operator', selected], queryFn: () => call<Detail>(`/api/operator/conversations/${selected}`), enabled: !!selected, refetchInterval: 4000 })
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const act = async (path: string, body: object = {}) => {
    setError('')
    try {
      await call(path, body)
      void qc.invalidateQueries({ queryKey: ['operator'] })
    } catch (err) {
      setError(errorText(err, lang))
    }
  }
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!reply.trim()) return
    await act(`/api/operator/conversations/${selected}/reply`, { text: reply })
    setReply('')
  }
  if (queue.error) return <p className="p-6 text-sm text-vermilion">{errorText(queue.error, lang)} <Link className="underline" to="/">{tr('Back', '返回')}</Link></p>
  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 border-b border-rule bg-sheet px-5 py-3">
        <Mark /><p className="flex-1 font-bold">{tr('Operator console', '客服工作台')}</p>
        <Link className="text-sm font-semibold text-indigo" to="/">{tr('Back to the app', '返回应用')}</Link>
      </header>
      <div className="grid gap-5 p-5 md:grid-cols-[300px_1fr]">
        <aside>
          <h2 className="font-bold">{tr('Waiting', '待处理')}</h2>
          <ul className="mt-2 space-y-2">
            {queue.data?.items.length === 0 && <li className="text-sm text-ink2">{tr('No one is waiting.', '暂无待处理会话。')}</li>}
            {queue.data?.items.map((item) => (
              <li key={item.conversation_id}>
                <button onClick={() => setSelected(item.conversation_id)} className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${selected === item.conversation_id ? 'border-indigo bg-indigo-wash' : 'border-rule bg-sheet'}`}>
                  <p className="font-semibold">{item.user}</p>
                  <p className="text-xs text-ink3">{item.reason}{item.locked ? tr(', safety lock on', '，安全锁开启') : ''}</p>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        {detail.data && (
          <section className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="flex-1 font-bold">{detail.data.user.name} <span className="font-normal text-ink3">{detail.data.user.email}</span></h2>
                {detail.data.locks.length > 0 && <button className="btn btn-quiet" onClick={() => act(`/api/operator/users/${selected}/unlock`)}>{tr('Lift safety lock', '解除安全锁')}</button>}
                {detail.data.escalated && <button className="btn btn-quiet" onClick={() => act(`/api/operator/conversations/${selected}/release`)}>{tr('Hand back to assistant', '交还助手')}</button>}
              </div>
              <ol className="mt-3 max-h-[60dvh] space-y-2 overflow-y-auto rounded-2xl border border-rule bg-sheet p-4">
                {detail.data.messages.map((m) => (
                  <li key={m.id} className="text-sm"><span className="font-semibold text-ink2">{m.role}: </span><span className="whitespace-pre-wrap">{m.text}</span></li>
                ))}
              </ol>
              <form onSubmit={send} className="mt-3 flex gap-2">
                <input className="field" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={tr('Reply to the customer', '回复客户')} aria-label={tr('Reply', '回复')} />
                <button className="btn btn-primary">{tr('Send', '发送')}</button>
              </form>
              {error && <p className="mt-2 text-sm text-vermilion">{error}</p>}
            </div>
            <div className="space-y-4">
              <div>
                <h3 className="font-bold">{tr('Plans', '计划')}</h3>
                <ul className="mt-2 space-y-2">
                  {detail.data.plans.map((p) => (
                    <li key={p.id} className="rounded-xl border border-rule bg-sheet px-3 py-2 text-sm">
                      <p className="font-semibold">{p.request}</p>
                      <p className="text-xs text-ink3">{p.status}, {p.tier}</p>
                      {['awaiting_approval', 'scheduled', 'clarifying'].includes(p.status) && <button className="mt-1 text-xs font-semibold text-vermilion" onClick={() => act(`/api/operator/plans/${p.id}/cancel`)}>{tr('Cancel plan', '取消计划')}</button>}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-bold">{tr('Audit trail', '审计记录')}</h3>
                <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-xs">
                  {detail.data.audit.map((e) => <li key={e.seq} className="text-ink2">#{e.seq} {e.kind} {e.at.slice(11, 19)}</li>)}
                </ul>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
