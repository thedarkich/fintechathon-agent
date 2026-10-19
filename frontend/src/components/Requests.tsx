import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { PlanRow } from '../api/types'
import { useLang } from '../i18n'
import { usePlans } from '../lib/bank'
import { clock, stamp, yuan } from '../lib/format'
import { Section } from './bits'
import { Icon } from './Icon'
import { ConfirmCard, markColor, markFor, statusLabel } from './PlanView'
import { SealMark } from './Seal'

/** Everything the customer has asked for, newest first; a row opens its card and its trail in the history. */
export function Requests() {
  const { tr } = useLang()
  const plans = usePlans()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const rows = plans.data?.items ?? []
  const shown = search ? rows.filter((p) => p.request.toLowerCase().includes(search.toLowerCase())) : rows
  return (
    <Section title={tr('What you asked for', '你办过的事')}
      aside={<label className="flex w-full items-center gap-2 rounded-box bg-[var(--field)] px-3 py-2 sm:w-60"><Icon name="search" size={16} className="text-ink2" /><input className="min-w-0 w-full bg-transparent text-sm" aria-label={tr('Search', '搜索')} placeholder={tr('Search…', '搜索…')} value={search} onChange={(e) => setSearch(e.target.value)} /></label>}>
      <RequestList rows={shown} loading={plans.isLoading} selected={selected} onSelect={setSelected} />
      {selected && <RequestModal planId={selected} row={rows.find((r) => r.id === selected)} onClose={() => setSelected(null)} />}
    </Section>
  )
}

function RequestList({ rows, loading, selected, onSelect }: { rows: PlanRow[]; loading: boolean; selected: string | null; onSelect: (id: string) => void }) {
  const { t, tr } = useLang()
  if (loading) return <div className="h-48 animate-pulse rounded-box bg-paper2" aria-hidden />
  if (rows.length === 0) return <p className="py-6 text-ink2">{tr('Nothing yet. Ask the assistant something.', '还没有记录，先去问问助手吧。')}</p>
  return (
    <ul className="card divide-y divide-[var(--rule)] overflow-hidden">
      {rows.map((p) => {
        const mark = p.outcome === 'returned' || p.outcome === 'cancelled' ? 'undone' : p.outcome === 'waiting' ? 'scheduled' : markFor(p)
        const label = p.outcome === 'returned' ? tr('Returned', '已退回') : p.outcome === 'cancelled' ? tr('Cancelled', '已撤销')
          : p.outcome === 'waiting' ? tr('On its way', '等待到账') : statusLabel(p.status, t)
        const active = p.id === selected
        return (
          <li key={p.id}>
            <button type="button" onClick={() => onSelect(p.id)} aria-current={active || undefined}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${active ? 'bg-sheet' : 'hover:bg-sheet'}`}>
              <SealMark kind={mark} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold" title={p.request}>{p.request}</span>
                <span className="block truncate text-xs text-ink2" title={p.reason ?? undefined}>
                  <span className="font-semibold" style={{ color: p.outcome === 'returned' ? 'var(--cinnabar)' : markColor(mark) }}>{label}</span>
                  {' · '}{stamp(p.created_at)}{p.reason ? ` · ${p.reason}` : ''}
                </span>
              </span>
              {p.fen ? <span className="num shrink-0 font-bold">{yuan(p.fen)}</span> : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function RequestModal({ planId, row, onClose }: { planId: string; row?: PlanRow; onClose: () => void }) {
  const { tr } = useLang()
  const trail = useQuery({ queryKey: ['audit', 'plan', planId], queryFn: () => api.audit(200, planId) })
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
      before?.focus?.({ preventScroll: true })
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-[rgba(0,0,0,0.55)] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={tr('What happened', '办理详情')} tabIndex={-1} className="flex h-full w-full flex-col overflow-hidden bg-field outline-none sm:h-auto sm:max-h-[92dvh] sm:max-w-5xl sm:rounded-box sm:border sm:border-rule2">
        <div className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={row?.request}>“{row?.request ?? ''}”</p>
            <p className="text-xs text-ink2">{row ? clock(row.created_at) : ''}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-box px-2 py-1 text-lg text-ink2 hover:bg-paper2" aria-label={tr('Close', '关闭')}>✕</button>
        </div>
        <div className="grid flex-1 content-start gap-6 overflow-y-auto p-4 lg:grid-cols-2 lg:p-6">
          <div className="min-w-0"><ConfirmCard planId={planId} /></div>
          <div className="min-w-0">
            <h3 className="cond text-lg font-bold">{tr('Every step, as recorded', '每一步的记录')}</h3>
            <p className="mb-2 text-xs text-ink2">{tr('Technical record from the audit log, oldest first.', '审计日志中的技术记录，按时间先后排列。')}</p>
            {!trail.data ? <div className="h-40 animate-pulse rounded-box bg-paper2" /> : (
              <ol className="divide-y divide-rule ruled">
                {trail.data.items.slice().reverse().map((e) => (
                  <li key={e.seq} className="px-3 py-2 text-sm">
                    <p className="flex items-baseline justify-between gap-3"><span className="font-semibold">#{e.seq} {e.kind}</span><span className="num font-mono text-xs text-ink2">{clock(e.at)}</span></p>
                    <p className="mt-0.5 break-all font-mono text-[0.75rem] text-ink2">{JSON.stringify(e.data).slice(0, 220)}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
