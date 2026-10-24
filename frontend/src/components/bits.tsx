import type { ReactNode } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { getAdminToken } from '../api/client'
import type { Tier } from '../api/types'
import { useLang } from '../i18n'
import { isOperator, useAuth } from '../lib/auth'
import { Icon, type IconName } from './Icon'

/** Workspace pages open for a signed-in customer. */
export function SignedInGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { user, loading } = useAuth()
  const { tr } = useLang()
  if (user) return <>{children}</>
  if (loading) return <div className="session-state" role="status">{tr('Checking your session…', '正在检查登录状态…')}</div>
  return <Navigate to={'/login?next=' + encodeURIComponent(location.pathname)} replace />
}

/** A section whose data didn't arrive: say so and offer to try again, instead of a skeleton that never ends. */
export function LoadError({ retry, className = '' }: { retry: () => void; className?: string }) {
  const { tr } = useLang()
  return (
    <p role="alert" className={`flex flex-wrap items-center gap-x-3 py-6 text-ink2 ${className}`}>
      {tr('This could not be loaded.', '暂时无法加载。')}
      <button type="button" className="min-h-10 font-semibold text-[var(--action)]" onClick={retry}>{tr('Retry', '重试')}</button>
    </p>
  )
}

/** The operator console: an operator account or the server's admin token. */
export function OperatorGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const { tr } = useLang()
  if (isOperator(user)) return <>{children}</>
  if (loading) return <div className="session-state" role="status">{tr('Checking your session…', '正在检查登录状态…')}</div>
  return (
    <div className="mx-auto mt-16 max-w-md px-4 text-center">
      <p className="cond text-2xl font-semibold">{tr('This page is for bank operators.', '此页面仅供银行工作人员使用。')}</p>
      <p className="mt-2 text-sm text-ink2">{tr('Operators read conversations that were handed over, reply, cancel plans and lift safety locks. They can never approve a step for a customer.', '工作人员可以查看转人工的会话、回复、取消计划和解除安全锁，但不能替客户确认任何操作。')}</p>
      <Link className="btn btn-ink mt-4 inline-block" to={'/team-token' + (getAdminToken() ? '' : '?next=/operator')}>{tr('Use an operator token', '使用工作人员令牌')}</Link>
    </div>
  )
}

export type Tint = 'green' | 'blue' | 'violet' | 'amber' | 'red' | 'cyan' | 'ink' | 'scope'

/** A small pill: pale green for good news, amber for "needs a look", red for a warning. */
export function Badge({ tone = 'green', children, className = '' }: { tone?: Tint | 'grey'; children: ReactNode; className?: string }) {
  const cls = tone === 'amber' ? 'badge-amber' : tone === 'red' ? 'badge-red' : tone === 'grey' || tone === 'blue' || tone === 'violet' || tone === 'cyan' || tone === 'ink' || tone === 'scope' ? 'badge-grey' : 'badge-green'
  return <span className={`badge ${cls} ${className}`}>{children}</span>
}

/** The three levels in plain words: done right away, needs your OK, needs your PIN and a code. */
export function TierTag({ tier }: { tier: Tier | null | undefined }) {
  const { tr } = useLang()
  if (!tier) return null
  if (tier === 'green') return <Badge tone="green">{tr('Done right away', '直接办')}</Badge>
  if (tier === 'yellow') return <Badge tone="amber">{tr('Needs your OK', '需确认')}</Badge>
  return <Badge tone="red">{tr('Needs PIN + code', '需验证')}</Badge>
}

/** A white card with a soft shadow. */
export function Card({ children, className = '', as: Tag = 'div', ...rest }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' | 'ul' | 'ol'; 'aria-label'?: string; 'aria-labelledby'?: string }) {
  return <Tag className={`card ${className}`} {...rest}>{children}</Tag>
}

/** A pastel circle holding an icon. */
export function IconDot({ icon, tint = 'scope', size = 44 }: { icon: IconName; tint?: Tint; size?: number }) {
  return <span className={`icon-dot tint-${tint}`} style={{ width: size, height: size }} aria-hidden><Icon name={icon} size={Math.round(size * 0.45)} /></span>
}

/** A thick rounded bar, filled to a share (0–1). */
export function ThickBar({ share, color }: { share: number; color?: string }) {
  return <div className="bar-thick" aria-hidden><span style={{ width: `${Math.max(2, Math.min(1, share) * 100)}%`, ...(color ? { background: color } : {}) }} /></div>
}

/**
 * One figure, as in the reference: a pastel icon circle and a label, the number big and bold underneath,
 * then a small note, a coloured percentage or a thick bar.
 */
export function StatTile({ icon, tint = 'scope', label, value, sub, delta, share, className = '', valueClass = '' }: {
  icon?: IconName; tint?: Tint; label: string; value: ReactNode; sub?: ReactNode
  delta?: { text: string; good: boolean } | null; share?: number; className?: string; valueClass?: string
}) {
  return (
    <div className={`card min-w-0 p-5 max-sm:p-4 ${className}`}>
      <div className="flex items-center gap-3">
        {icon && <IconDot icon={icon} tint={tint} size={40} />}
        <span className="stat-label min-w-0 flex-1 leading-snug">{label}</span>
        {delta && <span className={`text-sm font-semibold ${delta.good ? 'text-jade' : 'text-cinnabar'}`}>{delta.text}</span>}
      </div>
      <p className={`stat-value num mt-3 ${valueClass}`}>{value}</p>
      {sub && <p className="mt-1 text-sm text-ink2">{sub}</p>}
      {share !== undefined && <div className="mt-3"><ThickBar share={share} /></div>}
    </div>
  )
}

/** A level out of five as five rounded pills, and "n/5" beside them. */
export function RatingPills({ value, max = 5, tone = 'scope', label, showValue = true }: { value: number; max?: number; tone?: 'scope' | 'green' | 'amber' | 'red'; label: string; showValue?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" role="img" aria-label={`${label} ${value}/${max}`}>
      <span className={`pills is-${tone}`}>{Array.from({ length: max }, (_, i) => <i key={i} className={i < value ? 'on' : ''} />)}</span>
      {showValue && <b className="num text-sm">{value}/{max}</b>}
    </span>
  )
}

/** A message in a coloured box: a pale-red alert, a cream highlight, or green information. */
export function Notice({ tone = 'info', title, children, icon, action, className = '' }: {
  tone?: 'alert' | 'highlight' | 'info'; title?: ReactNode; children?: ReactNode; icon?: IconName; action?: ReactNode; className?: string
}) {
  return (
    <div className={`notice notice-${tone} ${className}`} role={tone === 'alert' ? 'alert' : undefined}>
      <span className="notice-icon" aria-hidden>{icon ? <Icon name={icon} size={15} /> : tone === 'info' ? 'i' : '!'}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="notice-title">{title}</p>}
        {children && <div className={title ? 'notice-body' : 'text-body leading-snug'}>{children}</div>}
      </div>
      {action && <div className="notice-action shrink-0 self-center">{action}</div>}
    </div>
  )
}

/** The page title, with the page's own controls on the right. No intro text: the page shows what it is. */
export function PageHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1>{title}</h1>
      {right}
    </div>
  )
}

/** One block of a page: a heading with an optional count or action beside it, then the content. */
export function Section({ title, aside, id, className = '', children }: { title: string; aside?: ReactNode; id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-6 ${className}`}>
      <div className="mb-3 flex min-h-10 flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Opens the assistant ready to type, with an example as the placeholder (for actions that need details). */
export function AskButton({ label, hint, className = 'btn btn-line py-1.5 text-sm' }: { label: string; hint: string; className?: string }) {
  return <Link to={`/assistant?hint=${encodeURIComponent(hint)}`} className={className}>{label}</Link>
}

/** One service, as on a bank app's home screen: a pastel icon square with its name underneath. */
export function ServiceTile({ icon, tint = 'green', label, to }: { icon: IconName; tint?: Tint; label: string; to: string }) {
  return <Link to={to} className="service-tile"><span className={`service-icon tint-${tint}`}><Icon name={icon} size={24} /></span><span className="service-label">{label}</span></Link>
}

/** Pill tabs: a pale track with the chosen option in solid green. */
export function Segmented<T extends string>({ value, options, onChange, label, className = '', stretch = false }: {
  value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; label: string; className?: string; stretch?: boolean
}) {
  return (
    <div role="tablist" aria-label={label} className={`segmented tab-scroll inline-flex max-w-full gap-1 rounded-tile p-1 ${className}`}>
      {options.map(([key, text]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} onClick={() => onChange(key)}
          className={`${stretch ? 'flex-1' : ''} whitespace-nowrap rounded-box px-4 py-2 text-body font-semibold ${value === key ? 'segmented-on' : 'text-ink2 hover:text-ink'}`}>{text}</button>
      ))}
    </div>
  )
}

/**
 * The page's open tab, kept in the address (?tab=…) so a link or a reload opens the same tab.
 * An older #anchor link (e.g. /send#payees) opens the tab of that name.
 */
export function useTab<T extends string>(keys: readonly T[], fallback: T): [T, (tab: T) => void] {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const wanted = (params.get('tab') ?? location.hash.slice(1)) as T
  const tab = keys.includes(wanted) ? wanted : fallback
  const choose = (next: T) => setParams((current) => {
    const p = new URLSearchParams(current)
    if (next === fallback) p.delete('tab'); else p.set('tab', next)
    return p
  }, { replace: true })
  return [tab, choose]
}

/** A page split into a few parts: one tab per part, so the page shows one thing at a time. */
export function PageTabs<T extends string>({ value, options, onChange, label }: {
  value: T; options: readonly (readonly [T, string])[]; onChange: (tab: T) => void; label: string
}) {
  return <Segmented className="mb-6" label={label} value={value} options={options} onChange={onChange} />
}

/** A panel with a heading bar, as on the controls page. */
export function Panel({ title, note, right, children, id }: { title: string; note?: string; right?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="card overflow-hidden" id={id}>
      <div className="panel-heading"><div>
        <h2 className="cond text-xl font-semibold leading-tight">{title}</h2>
        {note && <p className="text-sm text-ink2">{note}</p>}
      </div>{right}</div>
      {children}
    </section>
  )
}

/**
 * Pages of a long list: previous, the page numbers (both ends and the ones next to the current page), next.
 * Too narrow for numbers (a phone, a chat card), it reads "3 / 91" between the arrows.
 */
export function Pager({ page, pages, onChange, label }: { page: number; pages: number; onChange: (page: number) => void; label: string }) {
  const { tr } = useLang()
  if (pages <= 1) return null
  const shown = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  const items: (number | 'gap')[] = []
  shown.forEach((n, i) => {
    if (i && n - shown[i - 1] > 1) items.push('gap')
    items.push(n)
  })
  return (
    <nav aria-label={label} className="pager">
      <button type="button" className="pager-step" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label={tr('Previous page', '上一页')}>‹</button>
      <span className="pager-numbers">
        {items.map((n, i) => n === 'gap'
          ? <span key={`gap-${i}`} className="pager-gap" aria-hidden>…</span>
          : <button key={n} type="button" className="pager-num num" aria-current={n === page ? 'page' : undefined} aria-label={tr(`Page ${n}`, `第 ${n} 页`)}
              onClick={() => onChange(n)}>{n}</button>)}
      </span>
      <span className="pager-compact num">{page} / {pages}</span>
      <button type="button" className="pager-step" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label={tr('Next page', '下一页')}>›</button>
    </nav>
  )
}

/** The list style used everywhere: a white card, rows separated by hairlines. */
export const LIST = 'card divide-y divide-[var(--rule)] overflow-hidden'
export const ROW = 'flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-3 text-body'
export const EMPTY = 'card px-4 py-4 text-sm text-ink2'
