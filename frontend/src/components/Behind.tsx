import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ShieldAlert, Smartphone } from 'lucide-react'
import { useLang } from '../i18n'
import { call, errorText, type Plan } from '../lib/api'
import { useChat } from '../lib/chat'
import { actionLabel, usePlan } from './Slip'
import { usePhone } from './Verify'

const STATUS_COLOR: Record<string, string> = {
  done: 'var(--jade)', pending: 'var(--amber)', waiting: 'var(--indigo)', failed: 'var(--vermilion)',
  cancelled: 'var(--ink-3)', skipped: 'var(--ink-3)', compensated: 'var(--ink-3)',
}
const STEP_STATUS: Record<string, [string, string]> = {
  done: ['完成', 'done'], pending: ['待确认', 'awaiting approval'], waiting: ['等待中', 'waiting'], failed: ['失败', 'failed'],
  cancelled: ['已取消', 'cancelled'], skipped: ['已跳过', 'skipped'], compensated: ['已撤销', 'undone'], new: ['待处理', 'new'],
}

/** The plan as a dependency graph: one column per depth, arrows from each step to what it waits for. */
function Graph({ plan }: { plan: Plan }) {
  const { lang } = useLang()
  const depth: Record<string, number> = {}
  for (const step of plan.steps) depth[step.id] = step.after.length ? 1 + Math.max(...step.after.map((d) => depth[d] ?? 0)) : 0
  const columns = Math.max(...Object.values(depth)) + 1
  const rows: Record<number, string[]> = {}
  for (const step of plan.steps) (rows[depth[step.id]] ??= []).push(step.id)
  const W = 150, H = 60, GX = 34, GY = 16
  const pos = (id: string) => ({ x: depth[id] * (W + GX), y: rows[depth[id]].indexOf(id) * (H + GY) })
  const height = Math.max(...Object.values(rows).map((r) => r.length)) * (H + GY) - GY
  const width = columns * (W + GX) - GX
  return (
    <div className="overflow-x-auto pb-2">
      <svg width={width} height={height} role="img" aria-label={lang === 'zh' ? '计划依赖图' : 'Plan dependency graph'} className="block">
        <defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-3)" /></marker></defs>
        {plan.steps.flatMap((s) => s.after.map((d) => {
          const a = pos(d), b = pos(s.id)
          return <path key={`${d}-${s.id}`} d={`M${a.x + W},${a.y + H / 2} C${a.x + W + GX / 2},${a.y + H / 2} ${b.x - GX / 2},${b.y + H / 2} ${b.x},${b.y + H / 2}`} fill="none" stroke="var(--ink-3)" strokeWidth="1.2" markerEnd="url(#arrow)" />
        }))}
        {plan.steps.map((s) => {
          const p = pos(s.id)
          const tier = s.tier ?? 'green'
          return (
            <g key={s.id} transform={`translate(${p.x},${p.y})`}>
              <rect width={W} height={H} rx="6" fill="var(--sheet)" stroke="var(--rule)" />
              <rect width="6" height={H} rx="3" fill={tier === 'red' ? 'var(--vermilion)' : tier === 'yellow' ? 'var(--amber)' : 'var(--jade)'} />
              <text x="16" y="23" fontSize="13" fontWeight="700" fill="var(--ink)">{s.id} {actionLabel(s.action, lang)}</text>
              <circle cx="20" cy="44" r="4" fill={STATUS_COLOR[s.status] ?? 'var(--ink-3)'} />
              <text x="30" y="48" fontSize="12" fill="var(--ink-2)">{(STEP_STATUS[s.status] ?? [s.status, s.status])[lang === 'zh' ? 0 : 1]}{s.run_at ? ` ${s.run_at.slice(5, 10)}` : ''}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function PlanTab({ planId }: { planId: string | null }) {
  const { tr, lang } = useLang()
  const plan = usePlan(planId)
  if (!planId) return <p className="text-sm text-ink2">{tr('Ask the assistant something; its plan appears here.', '向助手提一个请求，它的执行计划会显示在这里。')}</p>
  if (!plan.data) return null
  const p = plan.data
  return (
    <div>
      <p className="text-sm text-ink2">{tr('Request', '请求')}</p>
      <p className="keep mt-0.5 font-semibold">“{p.request}”</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-well px-2.5 py-2"><dt className="text-ink3">{tr('Planned by', '规划来源')}</dt><dd className="mt-0.5 font-semibold">{p.source === 'ai' ? tr('AI model', 'AI 模型') : tr('Offline planner', '离线规划器')}</dd></div>
        <div className="rounded-lg bg-well px-2.5 py-2"><dt className="text-ink3">{tr('Highest tier', '最高等级')}</dt><dd className="mt-0.5 font-semibold">{{ green: tr('Green', '绿'), yellow: tr('Yellow', '黄'), red: tr('Red', '红') }[p.tier]}</dd></div>
        <div className="rounded-lg bg-well px-2.5 py-2"><dt className="text-ink3">{tr('Status', '状态')}</dt><dd className="mt-0.5 font-semibold">{p.status}</dd></div>
      </dl>
      {p.flags.length > 0 && <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-vermilion-wash px-3 py-2 text-xs text-vermilion"><ShieldAlert size={14} className="mt-px shrink-0" />{tr('Screening flagged this request: ', '安全筛查标记：')}{p.flags.join(', ')}</p>}
      <div className="mt-4"><Graph plan={p} /></div>
      <ol className="mt-3 space-y-2">
        {p.steps.map((s) => (
          <li key={s.id} className="rounded-xl border border-rule bg-sheet px-3 py-2.5 text-sm">
            <p className="font-semibold">{s.id} {actionLabel(s.action, lang)} <span className="font-normal text-ink3">{s.rule}</span></p>
            <p className="keep mt-0.5 text-ink2">{s.text}</p>
            {s.rule_text && <p className="mt-0.5 text-xs text-ink3">{s.rule_text}</p>}
          </li>
        ))}
      </ol>
    </div>
  )
}

interface AuditItem { seq: number; kind: string; plan_id: string | null; data: Record<string, unknown>; at: string; hash: string }

function AuditTab({ planId }: { planId: string | null }) {
  const { tr } = useLang()
  const entries = useQuery({ queryKey: ['audit', planId], queryFn: () => call<{ items: AuditItem[] }>(`/api/audit?limit=80${planId ? `&plan_id=${planId}` : ''}`) })
  const chain = useQuery({ queryKey: ['audit', 'verify'], queryFn: () => call<{ ok: boolean; entries: number; head?: string }>('/api/audit/verify') })
  return (
    <div>
      {chain.data && (
        <p className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${chain.data.ok ? 'bg-jade-wash text-jade' : 'bg-vermilion-wash text-vermilion'}`}>
          <CheckCircle2 size={14} />
          {chain.data.ok ? tr(`Hash chain intact: ${chain.data.entries} entries`, `哈希链完整：共 ${chain.data.entries} 条记录`) : tr('Hash chain broken', '哈希链校验失败')}
        </p>
      )}
      <p className="mt-3 text-xs text-ink3">{planId ? tr('Entries for the latest plan, newest first.', '最新计划的记录，按时间倒序。') : tr('Latest entries.', '最近的记录。')}</p>
      <ol className="mt-2 space-y-1.5">
        {entries.data?.items.map((e) => (
          <li key={e.seq} className="rounded-lg border border-rule bg-sheet px-3 py-2 text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold">#{e.seq} {e.kind}</span>
              <span className="num text-ink3">{e.at.slice(11, 19)}</span>
            </div>
            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[11px] text-ink2">{JSON.stringify(e.data)}</pre>
            <p className="num mt-1 truncate text-[10px] text-ink3">{e.hash}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

function PhoneTab() {
  const { tr, lang } = useLang()
  const phone = usePhone(true)
  return (
    <div className="mx-auto max-w-xs rounded-[28px] border-[6px] border-ink bg-paper p-3">
      <p className="flex items-center justify-center gap-1.5 text-xs text-ink3"><Smartphone size={13} />{phone.data?.number ?? ''}</p>
      <p className="mt-1 text-center text-[11px] text-ink3">{tr('Simulated phone: SMS a real bank would send', '模拟手机：真实银行会发送的短信')}</p>
      <ol className="mt-3 space-y-2">
        {phone.data?.items.length === 0 && <li className="text-center text-xs text-ink3">{tr('No messages yet.', '暂无短信。')}</li>}
        {phone.data?.items.map((m) => (
          <li key={m.id} className="rounded-2xl rounded-tl-md bg-sheet px-3 py-2 text-xs leading-relaxed">
            {lang === 'zh' ? m.text : m.text_en}
            <span className="num mt-1 block text-[10px] text-ink3">{m.at.slice(11, 16)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function DemoTab() {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const { reload, newConversation } = useChat()
  const clock = useQuery({ queryKey: ['clock'], queryFn: () => call<{ now: string; offset_seconds: number }>('/api/demo/clock') })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function run(path: string, body: object, done: string) {
    setBusy(true)
    setMessage('')
    try {
      await call(path, { ...body, lang })
      await qc.invalidateQueries()
      await reload()
      setMessage(done)
    } catch (err) {
      setMessage(errorText(err, lang))
    } finally {
      setBusy(false)
    }
  }
  const days = clock.data ? Math.round(clock.data.offset_seconds / 86400 * 10) / 10 : 0
  return (
    <div className="space-y-5">
      <div>
        <p className="font-semibold">{tr('Bank clock', '银行时钟')}</p>
        <p className="num mt-1 text-2xl font-bold">{clock.data?.now.slice(0, 16).replace('T', ' ')}</p>
        <p className="text-xs text-ink3">{days ? tr(`${days} days ahead of real time`, `比真实时间快 ${days} 天`) : tr('Real time', '与真实时间一致')}</p>
        <p className="mt-2 text-sm text-ink2">{tr('Move time forward to watch scheduled steps run, subscriptions renew, salary arrive and friends pay their share.', '把时间往前拨，可以看到预约操作执行、订阅续费、工资到账和朋友付 AA 款。')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[[0, 1, tr('+1 hour', '+1 小时')], [1, 0, tr('+1 day', '+1 天')], [7, 0, tr('+7 days', '+7 天')], [30, 0, tr('+30 days', '+30 天')]].map(([d, h, label]) => (
            <button key={String(label)} className="btn btn-quiet" disabled={busy} onClick={() => run('/api/demo/advance', { days: d, hours: h }, tr('Time moved forward.', '时间已前进。'))}>{label}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="font-semibold">{tr('Start over', '重新开始')}</p>
        <p className="mt-1 text-sm text-ink2">{tr('Restore your simulated bank to its starting data. The audit log is kept.', '把模拟银行恢复到初始数据。审计记录会保留。')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-quiet" disabled={busy} onClick={() => void newConversation()}>{tr('New conversation', '新对话')}</button>
          <button className="btn btn-quiet text-vermilion" disabled={busy} onClick={() => window.confirm(tr('Reset your demo bank?', '确定重置演示银行吗？')) && run('/api/demo/reset', {}, tr('Demo bank reset.', '演示银行已重置。'))}>{tr('Reset demo bank', '重置演示银行')}</button>
        </div>
      </div>
      {message && <p role="status" className="text-sm text-ink2">{message}</p>}
    </div>
  )
}

export function Behind() {
  const { tr } = useLang()
  const { planId } = useChat()
  const [tab, setTab] = useState<'plan' | 'audit' | 'phone' | 'demo'>('plan')
  const tabs = [['plan', tr('Plan', '计划')], ['audit', tr('Audit trail', '审计记录')], ['phone', tr('Phone', '手机')], ['demo', tr('Demo tools', '演示工具')]] as const
  return (
    <div className="flex h-full flex-col">
      <div className="hidden border-b border-rule px-6 pb-3 pt-5 lg:block">
        <h2 className="text-lg font-bold">{tr('Behind the scenes', '幕后')}</h2>
        <p className="text-sm text-ink2">{tr('What the assistant proposed, which rule decided each step, and the record it left.', '助手提出了什么、每一步由哪条规则决定，以及留下的记录。')}</p>
      </div>
      <div role="tablist" className="flex gap-1 border-b border-rule px-4 lg:px-6">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold ${tab === key ? 'border-indigo text-indigo' : 'border-transparent text-ink3 hover:text-ink2'}`}>{label}</button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-6" role="tabpanel">
        {tab === 'plan' && <PlanTab planId={planId} />}
        {tab === 'audit' && <AuditTab planId={planId} />}
        {tab === 'phone' && <PhoneTab />}
        {tab === 'demo' && <DemoTab />}
      </div>
    </div>
  )
}
