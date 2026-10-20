import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { AuditEntry } from '../api/types'
import { useLang } from '../i18n'
import { Badge, PageHead, PageTabs, Section, Segmented, useTab } from '../components/bits'
import { Requests } from '../components/Requests'
import { SealMark, type MarkKind } from '../components/Seal'
import { clock, shortAddr, timeAgo } from '../lib/format'

type Kind = 'all' | 'requests' | 'decisions' | 'actions' | 'security'

const KINDS: Record<string, { mark: MarkKind; zh: string; en: string; group: Exclude<Kind, 'all'> }> = {
  request: { mark: 'pending', zh: '收到请求', en: 'Request', group: 'requests' },
  plan_proposed: { mark: 'change', zh: '提出计划', en: 'Plan proposed', group: 'requests' },
  plan_rejected: { mark: 'refused', zh: '计划被拒', en: 'Plan rejected', group: 'security' },
  resolution: { mark: 'query', zh: '匹配记录', en: 'Matched to records', group: 'requests' },
  clarification: { mark: 'pending', zh: '追问细节', en: 'Asked a question', group: 'requests' },
  account_opened: { mark: 'done', zh: '开通账户', en: 'Account opened', group: 'security' },
  passkey_added: { mark: 'done', zh: '添加通行密钥', en: 'Passkey added', group: 'security' },
  demo_clock: { mark: 'change', zh: '演示：银行时钟前进', en: 'Demo: bank clock moved', group: 'actions' },
  demo_reset: { mark: 'change', zh: '演示：重置银行', en: 'Demo: bank reset', group: 'actions' },
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
    case 'notification': {
      const [kind, , extra] = s(d.key).split(':')
      const names: Record<string, [string, string]> = {
        birthday: ['生日提醒', 'Birthday reminder'], anomaly: ['可疑交易提醒', 'Unusual transaction alert'],
        collection: ['AA 收款通知', 'Split bill update'], declined: ['交易被拒通知', 'Declined payment notice'],
        plan: ['计划通知', 'Plan update'], renewal: ['续费提醒', 'Renewal reminder'],
        scheduled: ['预约转账通知', 'Scheduled transfer notice'], transfer: ['转账通知', 'Transfer update'],
      }
      const name = names[kind] ? names[kind][lang === 'zh' ? 0 : 1] : kind
      return kind === 'birthday' && extra ? `${name} · ${extra}` : name
    }
    case 'demo_transfer': return d.outcome === 'return' ? (lang === 'zh' ? '对方银行退回' : 'the payee bank returns it') : (lang === 'zh' ? '立即清算' : 'cleared now')
    case 'demo_clock': {
      const hours = Math.round(Number(d.advanced_seconds) / 3600)
      return hours % 24 === 0 ? (lang === 'zh' ? `前进 ${hours / 24} 天` : `${hours / 24} day(s) forward`) : (lang === 'zh' ? `前进 ${hours} 小时` : `${hours} hour(s) forward`)
    }
    case 'account_opened': return d.demo ? (lang === 'zh' ? '演示账户，自带模拟银行' : 'demo account with its own simulated bank') : (lang === 'zh' ? '模拟银行已开通' : 'simulated bank opened')
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
  const [tab, setTab] = useTab(['requests', 'audit'] as const, 'requests')
  const [kind, setKind] = useState<Kind>('all')
  const entries = useQuery({ queryKey: ['audit', 'ledger'], queryFn: () => api.audit(1000), refetchInterval: tab === 'audit' ? 4000 : false, enabled: tab === 'audit' })
  const chain = useQuery({ queryKey: ['audit', 'verify'], queryFn: api.auditVerify, refetchInterval: 10_000 })
  const all = entries.data?.items ?? []
  const rows = kind === 'all' ? all : all.filter((e) => info(e.kind).group === kind)
  const fresh = useArrivals(entries.data?.items)

  return (
    <main tabIndex={-1} className="page-content ">
      <PageHead title={t.ledger_title} right={chain.data && (
        <Badge tone={chain.data.ok ? 'green' : 'red'} className="px-3 py-1.5 text-sm">
          <SealMark kind={chain.data.ok ? 'done' : 'blocked'} size={18} />
          {chain.data.ok ? tr('Record checked: nothing changed', '记录已核验：未被改动') : tr('Record check failed', '记录核验未通过')}
        </Badge>
      )} />
      <PageTabs label={t.ledger_title} value={tab} onChange={setTab}
        options={[['requests', tr('Your requests', '你办过的事')], ['audit', tr('Audit log (for reviewers)', '审计日志（供审核）')]] as const} />

      {tab === 'requests' && <Requests />}

      {tab === 'audit' && <Section title={tr('Every step the bank took', '银行的每一步记录')}
        aside={chain.data && (
          <p className={`text-sm ${chain.data.ok ? 'text-jade' : 'font-semibold text-cinnabar'}`} title={chain.data.head}>
            {chain.data.ok ? tr(`Chain intact · ${chain.data.entries} entries`, `哈希链完整 · ${chain.data.entries} 条`) : tr(`Chain broken at entry ${chain.data.broken_at}`, `哈希链在第 ${chain.data.broken_at} 条断开`)}
          </p>
        )}>
      <p className="mb-3 max-w-2xl text-sm text-ink2">{tr('The technical record behind every request. Each entry includes a fingerprint (hash) of the one before, so any later change to the record would show.', '每个请求背后的技术记录。每一条都带有上一条的指纹（哈希），之后若有任何改动都会被发现。')}</p>
      <Segmented label={t.ledger_title} value={kind} onChange={setKind}
        options={[['all', tr('All', '全部')], ['requests', tr('Requests & plans', '请求与计划')], ['decisions', tr('Decisions', '判定与确认')], ['actions', tr('Actions', '执行')], ['security', tr('Security', '安全')]] as const} />

      {entries.isLoading ? <div className="mt-3 h-64 animate-pulse rounded-box bg-paper2" aria-hidden /> : rows.length === 0 ? <p className="mt-6 text-ink2">{t.ledger_empty}</p> : <>
        {/* desktop: a ruled ledger page */}
        <div className="mt-3 hidden overflow-x-auto card md:block">
          <table className="w-full min-w-[760px] border-collapse text-left text-body">
            <thead>
              <tr className="rule-b bg-paper text-cap font-semibold text-ink2">
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
                    <td className="num px-3 py-2.5 font-mono text-cap text-ink2">{e.seq}</td>
                    <td className="num px-3 py-2.5 font-mono text-cap text-ink2" title={e.at}>{clock(e.at)}</td>
                    <td className="px-3 py-2"><span className="flex items-center gap-2"><SealMark kind={meta.mark} size={26} /><span className="font-semibold" style={{ color: markInk(meta.mark) }}>{lang === 'zh' ? meta.zh : meta.en}</span></span></td>
                    <td className="max-w-[28rem] break-words px-3 py-2.5 text-body">{detail(e, lang)}</td>
                    <td className="px-3 py-2.5 font-mono text-cap text-ink2" title={e.hash}>{shortAddr(e.hash, 6, 4)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* phone: one slip per entry */}
        <ol className="mt-3 divide-y divide-rule card md:hidden">
          {rows.map((e) => {
            const meta = info(e.kind)
            return (
              <li key={e.seq} className={`grid grid-cols-[auto_1fr_auto] gap-x-3 px-3 py-2.5 ${fresh.has(e.seq) ? 'row-new' : ''}`}>
                <SealMark kind={meta.mark} size={30} />
                <div className="min-w-0">
                  <p className="font-semibold leading-snug" style={{ color: markInk(meta.mark) }}>{lang === 'zh' ? meta.zh : meta.en}</p>
                  <p className="truncate text-body text-ink2">{detail(e, lang)}</p>
                </div>
                <div className="text-right"><p className="font-mono text-xs text-ink2">#{e.seq}</p><p className="text-xs text-ink2">{timeAgo(e.at, lang)}</p></div>
              </li>
            )
          })}
        </ol>
      </>}
      </Section>}
    </main>
  )
}
