import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { AuditEntry } from '../api/types'
import { useLang } from '../i18n'
import { Icon } from '../components/Icon'
import { SealMark, type MarkKind } from '../components/Seal'
import { clock, shortAddr, timeAgo } from '../lib/format'

type Kind = 'all' | 'requests' | 'decisions' | 'actions' | 'security'

const KINDS: Record<string, { mark: MarkKind; zh: string; en: string; group: Exclude<Kind, 'all'> }> = {
  request: { mark: 'pending', zh: '收到请求', en: 'Request', group: 'requests' },
  plan_proposed: { mark: 'change', zh: '提出计划', en: 'Plan proposed', group: 'requests' },
  plan_rejected: { mark: 'refused', zh: '计划被拒', en: 'Plan rejected', group: 'security' },
  resolution: { mark: 'query', zh: '匹配记录', en: 'Matched to records', group: 'requests' },
  clarification: { mark: 'pending', zh: '追问细节', en: 'Asked a question', group: 'requests' },
  edited: { mark: 'change', zh: '修改步骤', en: 'Step edited', group: 'requests' },
  policy: { mark: 'change', zh: '规则判定', en: 'Rule decided', group: 'decisions' },
  approval_requested: { mark: 'pending', zh: '等待确认', en: 'Waiting for approval', group: 'decisions' },
  approved: { mark: 'done', zh: '已确认', en: 'Approved', group: 'decisions' },
  verified: { mark: 'done', zh: '已验证', en: 'Verified', group: 'decisions' },
  challenge_sent: { mark: 'pending', zh: '已发验证码', en: 'Code sent', group: 'decisions' },
  verification_failed: { mark: 'blocked', zh: '验证失败', en: 'Check failed', group: 'security' },
  cancelled: { mark: 'cancelled', zh: '已取消', en: 'Cancelled', group: 'decisions' },
  step_started: { mark: 'pending', zh: '开始执行', en: 'Step started', group: 'actions' },
  step_done: { mark: 'done', zh: '步骤完成', en: 'Step done', group: 'actions' },
  step_failed: { mark: 'refused', zh: '步骤未完成', en: 'Step failed', group: 'actions' },
  compensated: { mark: 'undone', zh: '已撤销', en: 'Undone', group: 'actions' },
  scheduled_check: { mark: 'scheduled', zh: '预约复核', en: 'Scheduled re-check', group: 'actions' },
  scheduled_run: { mark: 'scheduled', zh: '预约执行', en: 'Scheduled run', group: 'actions' },
  sandbox_run: { mark: 'query', zh: '沙箱运行', en: 'Sandbox run', group: 'actions' },
  upload: { mark: 'query', zh: '读取小票', en: 'Receipt read', group: 'actions' },
  reserve_released: { mark: 'change', zh: '预留退回', en: 'Reserve returned', group: 'actions' },
  transfer: { mark: 'done', zh: '转账进度', en: 'Transfer stage', group: 'actions' },
  demo_transfer: { mark: 'change', zh: '演示：推进转账', en: 'Demo: transfer moved', group: 'actions' },
  notification: { mark: 'pending', zh: '提醒', en: 'Reminder', group: 'actions' },
  screening: { mark: 'flag', zh: '安全标记', en: 'Flagged', group: 'security' },
  lock: { mark: 'blocked', zh: '安全锁开启', en: 'Safety lock on', group: 'security' },
  unlock: { mark: 'change', zh: '安全锁解除', en: 'Safety lock lifted', group: 'security' },
  operator: { mark: 'change', zh: '人工客服', en: 'Operator', group: 'security' },
  model_unavailable: { mark: 'error', zh: '模型不可用', en: 'Model unavailable', group: 'security' },
}

const info = (kind: string) => KINDS[kind] ?? { mark: 'change' as MarkKind, zh: kind, en: kind, group: 'actions' as const }

/** A short, code-written description of what the entry records. */
function detail(e: AuditEntry, lang: 'zh' | 'en'): string {
  const d = e.data as Record<string, unknown>
  const s = (v: unknown) => (v === undefined || v === null ? '' : String(v))
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  switch (e.kind) {
    case 'request': return `“${s(d.text)}”`
    case 'plan_proposed': {
      const plan = d.plan as { steps?: { action: string }[] } | undefined
      const errors = list(d.errors)
      return `${s(d.source)}: ${(plan?.steps ?? []).map((x) => x.action).join(' → ') || (lang === 'zh' ? '无步骤' : 'no steps')}${errors.length ? ` · ${errors.join(', ')}` : ''}`
    }
    case 'plan_rejected': return list(d.errors).join(', ')
    case 'policy': {
      const signals = list(d.signals)
      return `${s(d.step)} · ${s(d.tier)} · ${s(d.rule)}${signals.length ? ` · ${signals.join(', ')}` : ''}${d.recheck ? (lang === 'zh' ? ' · 执行前复核' : ' · re-check') : ''}`
    }
    case 'resolution': return `${s(d.step)} · ${s(d.action)}`
    case 'step_started': case 'step_done': case 'step_failed': case 'compensated': return `${s(d.step)} · ${s(d.action)}${d.code ? ` · ${s(d.code)}` : ''}`
    case 'approval_requested': return `${s(d.tier)} · ${list(d.steps).join(', ')}`
    case 'approved': return `${s(d.tier)} · ${s(d.method)}`
    case 'verified': return s(d.method)
    case 'verification_failed': return s(d.factor)
    case 'challenge_sent': return `${s(d.kind)} → ${s(d.phone)}`
    case 'screening': return list(d.flags).join(', ')
    case 'lock': case 'unlock': return `${s(d.scope)} · ${s(d.reason)}${d.by ? ` · ${s(d.by)}` : ''}`
    case 'sandbox_run': return `${shortAddr(s(d.code_hash), 8, 6)}${d.ms !== undefined ? ` · ${s(d.ms)} ms` : ''}${d.error ? ` · ${s(d.error)}` : ''}`
    case 'upload': {
      const flags = list(d.flags)
      return `${s(d.kind)} · ${s(d.read_by)}${flags.length ? ` · ${flags.join(', ')}` : ''}`
    }
    case 'cancelled': return `${lang === 'zh' ? '停止' : 'stopped'} ${s(d.stopped)} · ${lang === 'zh' ? '撤销' : 'undone'} ${s(d.compensated)}`
    case 'notification': return s(d.key)
    case 'transfer': return `${s(d.status)} · ${s(d.route)} · ${s(d.arrival)} · ¥${(Number(d.fen) / 100).toFixed(2)}${d.reason ? ` · ${s(d.reason)}` : ''}`
    default: return JSON.stringify(d).slice(0, 140)
  }
}

/** Entries that arrived after the first load, so new rows can be marked as they land. */
function useArrivals(entries: AuditEntry[] | undefined) {
  const seen = useRef<Set<number> | null>(null)
  const [fresh, setFresh] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (!entries) return
    if (seen.current === null) {
      seen.current = new Set(entries.map((e) => e.seq))
      return
    }
    const added = entries.filter((e) => !seen.current!.has(e.seq))
    if (added.length === 0) return
    added.forEach((e) => seen.current!.add(e.seq))
    setFresh(new Set(added.map((e) => e.seq)))
  }, [entries])
  return fresh
}

const markInk = (mark: MarkKind) =>
  mark === 'done' || mark === 'query' ? 'var(--jade)' : mark === 'blocked' || mark === 'flag' ? 'var(--cinnabar)' : 'var(--ink)'

export default function Ledger() {
  const { t, tr, lang } = useLang()
  const [kind, setKind] = useState<Kind>('all')
  const entries = useQuery({ queryKey: ['audit', 'ledger'], queryFn: () => api.audit(1000), refetchInterval: 4000 })
  const chain = useQuery({ queryKey: ['audit', 'verify'], queryFn: api.auditVerify, refetchInterval: 10_000 })
  const all = entries.data?.items ?? []
  const rows = kind === 'all' ? all : all.filter((e) => info(e.kind).group === kind)
  const fresh = useArrivals(entries.data?.items)
  const count = (kinds: string[]) => all.filter((e) => kinds.includes(e.kind)).length

  return (
    <main tabIndex={-1} className="page-content ">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="cond text-[2.4rem] font-extrabold leading-tight sm:text-[2.9rem]">{t.ledger_title}</h1>
          <p className="max-w-[38rem] text-ink2">{t.ledger_sub}</p>
        </div>
        {chain.data && (
          <p className={`text-sm ${chain.data.ok ? 'text-ink2' : 'font-semibold text-cinnabar'}`}>
            {chain.data.ok
              ? <>{tr(`Hash chain intact, ${chain.data.entries} entries, head`, `哈希链完整，共 ${chain.data.entries} 条，最新`)} <span className="font-mono text-ink" title={chain.data.head}>{shortAddr(chain.data.head, 8, 6)}</span></>
              : tr(`Hash chain broken at entry ${chain.data.broken_at}`, `哈希链在第 ${chain.data.broken_at} 条断开`)}
          </p>
        )}
      </div>

      <dl className="metric-grid mt-7">
        {[
          { label: tr('Requests', '请求'), value: count(['request']), icon: 'chat' as const, tone: '' },
          { label: tr('Steps done', '完成的步骤'), value: count(['step_done', 'scheduled_run']), icon: 'check' as const, tone: 'text-jade' },
          { label: tr('Approvals and checks', '确认与验证'), value: count(['approved', 'verified']), icon: 'shield' as const, tone: '' },
          { label: tr('Security events', '安全事件'), value: count(['screening', 'lock', 'verification_failed', 'plan_rejected']), icon: 'flag' as const, tone: 'text-cinnabar' },
        ].map((x) => <div className="metric-card" key={x.label}><dt>{x.label}<Icon name={x.icon} size={17} /></dt><dd className={x.tone}>{entries.isLoading ? '—' : x.value}</dd></div>)}
      </dl>
      <p className="mt-3 text-xs text-ink2">{tr('PINs, codes and passwords are never written here. Each row stores the hash of the row before it; the chain is checked again every few seconds.', '交易密码、验证码和登录密码从不写入账本。每条记录都保存上一条的哈希，系统每隔几秒重新校验整条链。')}</p>

      <div className="mb-4 mt-9 flex items-center gap-2"><Icon name="activity" size={19} /><h2 className="text-lg font-semibold">{tr('Recent activity', '最近记录')}</h2></div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tab-scroll flex gap-1" role="tablist" aria-label={t.ledger_title}>
          {([['all', tr('All', '全部')], ['requests', tr('Requests & plans', '请求与计划')], ['decisions', tr('Decisions', '判定与确认')], ['actions', tr('Actions', '执行')], ['security', tr('Security', '安全')]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded-box px-3 py-1.5 text-[0.95rem] ${kind === k ? 'bg-ink text-field' : 'text-ink hover:bg-paper2'}`}>{label}</button>
          ))}
        </div>
      </div>

      {entries.isLoading ? <div className="mt-3 h-64 animate-pulse rounded-box bg-paper2" aria-hidden /> : rows.length === 0 ? <p className="mt-6 text-ink2">{t.ledger_empty}</p> : <>
        {/* desktop: a ruled ledger page */}
        <div className="mt-3 hidden overflow-x-auto ruled bg-field md:block">
          <table className="w-full min-w-[760px] border-collapse text-left text-[0.95rem]">
            <thead>
              <tr className="rule-b bg-paper text-[0.85rem] text-rule2">
                <th className="w-[4.5rem] px-3 py-2 font-normal">#</th>
                <th className="w-[6.5rem] px-3 py-2 font-normal">{t.col_time}</th>
                <th className="w-[12rem] px-3 py-2 font-normal">{t.col_event}</th>
                <th className="px-3 py-2 font-normal">{t.col_detail}</th>
                <th className="w-[9rem] px-3 py-2 font-normal">{t.col_hash}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const meta = info(e.kind)
                return (
                  <tr key={e.seq} className={`rule-b align-top last:border-b-0 ${fresh.has(e.seq) ? 'row-new' : ''}`}>
                    <td className="num px-3 py-2.5 font-mono text-[0.85rem] text-ink2">{e.seq}</td>
                    <td className="num px-3 py-2.5 font-mono text-[0.85rem] text-ink2" title={e.at}>{clock(e.at)}</td>
                    <td className="px-3 py-2"><span className="flex items-center gap-2"><SealMark kind={meta.mark} size={26} /><span className="font-semibold" style={{ color: markInk(meta.mark) }}>{lang === 'zh' ? meta.zh : meta.en}</span></span></td>
                    <td className="max-w-[28rem] break-words px-3 py-2.5 text-[0.9rem]">{detail(e, lang)}</td>
                    <td className="px-3 py-2.5 font-mono text-[0.8rem] text-ink2" title={e.hash}>{shortAddr(e.hash, 6, 4)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* phone: one slip per entry */}
        <ol className="mt-3 divide-y divide-rule ruled bg-field md:hidden">
          {rows.map((e) => {
            const meta = info(e.kind)
            return (
              <li key={e.seq} className={`grid grid-cols-[auto_1fr_auto] gap-x-3 px-3 py-2.5 ${fresh.has(e.seq) ? 'row-new' : ''}`}>
                <SealMark kind={meta.mark} size={30} />
                <div className="min-w-0">
                  <p className="font-semibold leading-snug" style={{ color: markInk(meta.mark) }}>{lang === 'zh' ? meta.zh : meta.en}</p>
                  <p className="truncate text-[0.9rem] text-ink2">{detail(e, lang)}</p>
                </div>
                <div className="text-right"><p className="font-mono text-xs text-ink2">#{e.seq}</p><p className="text-xs text-ink2">{timeAgo(e.at, lang)}</p></div>
              </li>
            )
          })}
        </ol>
      </>}
    </main>
  )
}
