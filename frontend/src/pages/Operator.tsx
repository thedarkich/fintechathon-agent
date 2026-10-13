import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorText } from '../api/client'
import { useLang } from '../i18n'
import { Header } from '../components/Header'
import { OperatorGate, Panel } from '../components/bits'
import { Icon } from '../components/Icon'
import { SealMark } from '../components/Seal'
import { markColor, markFor, statusLabel } from '../components/PlanView'
import { clock } from '../lib/format'

/** Human takeover. Operators read, reply, cancel and lift locks; there is deliberately no approve button. */
export default function OperatorPage() {
  return (
    <div className="workspace">
      <Header />
      <OperatorGate><Operator /></OperatorGate>
    </div>
  )
}

function Operator() {
  const { tr, lang, t } = useLang()
  const qc = useQueryClient()
  const queue = useQuery({ queryKey: ['operator'], queryFn: api.queue, refetchInterval: 5000 })
  const [selected, setSelected] = useState<string | null>(null)
  const detail = useQuery({ queryKey: ['operator', selected], queryFn: () => api.operatorDetail(selected!), enabled: !!selected, refetchInterval: 4000 })
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const act = async (task: () => Promise<unknown>) => {
    setError('')
    try {
      await task()
      void qc.invalidateQueries({ queryKey: ['operator'] })
    } catch (err) {
      setError(errorText(err, lang))
    }
  }
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!reply.trim() || !selected) return
    await act(() => api.operatorReply(selected, reply.trim()))
    setReply('')
  }
  const items = queue.data?.items ?? []
  const d = detail.data
  return (
    <main tabIndex={-1} className="page-content ">
      <h1 className="cond text-[2.4rem] font-extrabold leading-tight">{tr('Operator console', '客服工作台')}</h1>
      <p className="max-w-[44rem] text-ink2">{tr('Conversations a customer handed over, and customers under a safety lock. You can reply, cancel a waiting plan, hand the customer back to the assistant or lift a lock. You can never approve a step for a customer.', '客户转人工的会话，以及被安全锁限制的客户。你可以回复、取消等待中的计划、交还助手或解除安全锁，但不能替客户确认任何步骤。')}</p>
      <dl className="metric-grid mt-7">
        <div className="metric-card"><dt>{tr('Waiting', '待处理')}<Icon name="inbox" size={17} /></dt><dd>{queue.isLoading ? '—' : items.length}</dd></div>
        <div className="metric-card"><dt>{tr('Under a safety lock', '安全锁中')}<Icon name="lock" size={17} /></dt><dd className="text-cinnabar">{items.filter((i) => i.locked).length}</dd></div>
        <div className="metric-card"><dt>{tr('Handed over', '转人工')}<Icon name="users" size={17} /></dt><dd>{items.filter((i) => i.reason !== 'safety lock').length}</dd></div>
        <div className="metric-card"><dt>{tr('Approve on behalf', '代为确认')}<Icon name="shield" size={17} /></dt><dd className="!text-[1.3rem]">{tr('Not possible', '不可能')}</dd></div>
      </dl>
      {queue.error && <p role="alert" className="mt-4 font-semibold text-cinnabar">{errorText(queue.error, lang)}</p>}
      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Panel title={tr('Queue', '队列')}>
          {items.length === 0 ? <p className="px-4 py-4 text-ink2">{tr('No one is waiting.', '暂无待处理会话。')}</p> : (
            <ul className="divide-y divide-rule">
              {items.map((item) => (
                <li key={item.conversation_id}>
                  <button type="button" onClick={() => setSelected(item.conversation_id)} className={`w-full px-4 py-3 text-left ${selected === item.conversation_id ? 'bg-sheet shadow-[inset_3px_0_0_var(--ink)]' : 'hover:bg-sheet'}`}>
                    <p className="font-semibold">{item.user}</p>
                    <p className="text-xs text-ink2">{item.email}</p>
                    <p className={`mt-1 text-xs ${item.locked ? 'font-semibold text-cinnabar' : 'text-ink2'}`}>{item.reason}{item.locked ? tr(', safety lock on', '，安全锁开启') : ''}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {!d ? <p className="ruled bg-field px-4 py-10 text-center text-ink2">{tr('Choose a conversation on the left.', '从左侧选择一个会话。')}</p> : (
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Panel title={d.user.name} note={d.user.email} right={<span className="flex flex-wrap gap-2">
              {d.locks.length > 0 && <button type="button" className="btn btn-line py-1.5" onClick={() => void act(() => api.operatorUnlock(d.conversation_id))}>{tr('Lift safety lock', '解除安全锁')}</button>}
              {d.escalated && <button type="button" className="btn btn-line py-1.5" onClick={() => void act(() => api.operatorRelease(d.conversation_id))}>{tr('Hand back to assistant', '交还助手')}</button>}
            </span>}>
              <ol className="max-h-[55dvh] space-y-2 overflow-y-auto p-4">
                {d.messages.map((m) => (
                  <li key={m.id} className="text-sm"><span className="font-semibold text-ink2">{m.role === 'user' ? tr('Customer', '客户') : m.role === 'operator' ? tr('Operator', '客服') : m.role === 'system' ? tr('System', '系统') : tr('Assistant', '助手')}: </span><span className="whitespace-pre-wrap">{m.text}</span></li>
                ))}
              </ol>
              <form onSubmit={send} className="flex gap-2 border-t border-rule p-3">
                <input className="field" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={tr('Reply to the customer', '回复客户')} aria-label={tr('Reply', '回复')} />
                <button className="btn btn-ink shrink-0 py-1.5">{tr('Send', '发送')}</button>
              </form>
              {error && <p className="px-4 pb-3 text-sm text-cinnabar">{error}</p>}
            </Panel>
            <div className="space-y-5">
              <Panel title={tr('Plans', '计划')}>
                <ul className="divide-y divide-rule">
                  {d.plans.map((p) => {
                    const mark = markFor({ status: p.status, tier: p.tier, reason: p.steps.find((s) => s.error)?.error ?? null })
                    return (
                      <li key={p.id} className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
                        <SealMark kind={mark} size={24} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{p.request}</p>
                          <p className="text-xs" style={{ color: markColor(mark) }}>{statusLabel(p.status, t)}</p>
                          {['awaiting_approval', 'scheduled', 'clarifying'].includes(p.status) && <button type="button" className="mt-1 text-xs font-semibold text-cinnabar underline decoration-rule underline-offset-4" onClick={() => void act(() => api.operatorCancel(p.id))}>{tr('Cancel plan', '取消计划')}</button>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </Panel>
              <Panel title={tr('Record', '记录')}>
                <ul className="max-h-80 divide-y divide-rule overflow-y-auto">
                  {d.audit.map((e) => <li key={e.seq} className="flex justify-between gap-2 px-4 py-1.5 text-xs"><span className="font-semibold">#{e.seq} {e.kind}</span><span className="font-mono text-ink2">{clock(e.at)}</span></li>)}
                </ul>
              </Panel>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
