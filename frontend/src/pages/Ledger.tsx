import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { AuditEntry } from '../api/types'
import { useLang } from '../i18n'
import { Badge, LoadError, PageHead, PageTabs, Section, Segmented, useTab } from '../components/bits'
import { Requests } from '../components/Requests'
import { SealMark, type MarkKind } from '../components/Seal'
import { auditKind, describeAudit, type AuditGroup } from '../lib/audit'
import { shortAddr, stamp, timeAgo } from '../lib/format'

type Kind = 'all' | AuditGroup

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
  const rows = kind === 'all' ? all : all.filter((e) => auditKind(e.kind).group === kind)
  const labels = entries.data?.labels
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
      <p className="mb-3 max-w-2xl text-sm text-ink2">{tr('The technical record behind every request. Each entry includes a fingerprint (hash) of the one before, so any later change to the record would show. Under each entry, in small type, are the codes it holds as written (for example R_LARGE_PAYMENT: the rule that set the tier).', '每个请求背后的技术记录。每一条都带有上一条的指纹（哈希），之后若有任何改动都会被发现。每条下面的小字是记录里原样保存的代码（例如 R_LARGE_PAYMENT：决定等级的那条规则）。')}</p>
      <Segmented label={t.ledger_title} value={kind} onChange={setKind}
        options={[['all', tr('All', '全部')], ['requests', tr('Requests & plans', '请求与计划')], ['decisions', tr('Decisions', '判定与确认')], ['actions', tr('Actions', '执行')], ['security', tr('Security', '安全')]] as const} />

      {entries.isLoading ? <div className="mt-3 h-64 animate-pulse rounded-box bg-paper2" aria-hidden /> : entries.isError && !entries.data ? <LoadError retry={() => void entries.refetch()} /> : rows.length === 0 ? <p className="mt-6 text-ink2">{t.ledger_empty}</p> : <>
        {/* desktop: a ruled ledger page */}
        <div className="mt-3 hidden overflow-x-auto card md:block">
          <table className="w-full min-w-[760px] border-collapse text-left text-body">
            <thead>
              <tr className="rule-b bg-paper text-cap font-semibold text-ink2">
                <th className="w-[4.5rem] px-3 py-2 font-normal">#</th>
                <th className="w-[8rem] px-3 py-2 font-normal">{t.col_time}</th>
                <th className="w-[12rem] px-3 py-2 font-normal">{t.col_event}</th>
                <th className="px-3 py-2 font-normal">{t.col_detail}</th>
                <th className="w-[9rem] px-3 py-2 font-normal">{t.col_hash}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const meta = auditKind(e.kind)
                const said = describeAudit(e, labels, lang)
                return (
                  <tr key={e.seq} className={`rule-b align-top last:border-b-0 ${fresh.has(e.seq) ? 'row-new' : ''}`}>
                    <td className="num px-3 py-2.5 font-mono text-cap text-ink2">{e.seq}</td>
                    <td className="num whitespace-nowrap px-3 py-2.5 font-mono text-cap text-ink2" title={e.at}>{stamp(e.at)}</td>
                    <td className="px-3 py-2"><span className="flex items-center gap-2"><SealMark kind={meta.mark} size={26} /><span className="font-semibold" style={{ color: markInk(meta.mark) }}>{lang === 'zh' ? meta.zh : meta.en}</span></span></td>
                    <td className="max-w-[32rem] break-words px-3 py-2.5 text-body">
                      {said.text}
                      {said.codes && <p className="mt-0.5 break-all font-mono text-xs text-ink2">{said.codes}</p>}
                    </td>
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
            const meta = auditKind(e.kind)
            const said = describeAudit(e, labels, lang)
            return (
              <li key={e.seq} className={`grid grid-cols-[auto_1fr_auto] gap-x-3 px-3 py-2.5 ${fresh.has(e.seq) ? 'row-new' : ''}`}>
                <SealMark kind={meta.mark} size={30} />
                <div className="min-w-0">
                  <p className="font-semibold leading-snug" style={{ color: markInk(meta.mark) }}>{lang === 'zh' ? meta.zh : meta.en}</p>
                  <p className="line-clamp-3 text-body text-ink2" title={said.codes || undefined}>{said.text || said.codes}</p>
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
