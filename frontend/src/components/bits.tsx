import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { getAdminToken } from '../api/client'
import type { Tier } from '../api/types'
import { useLang } from '../i18n'
import { isOperator, useAuth } from '../lib/auth'

/** Workspace pages open for a signed-in customer. */
export function SignedInGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { user, loading } = useAuth()
  const { tr } = useLang()
  if (user) return <>{children}</>
  if (loading) return <div className="session-state" role="status">{tr('Checking your session…', '正在检查登录状态…')}</div>
  return <Navigate to={'/login?next=' + encodeURIComponent(location.pathname)} replace />
}

/** The operator console: an operator account or the server's admin token. */
export function OperatorGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const { tr } = useLang()
  if (isOperator(user)) return <>{children}</>
  if (loading) return <div className="session-state" role="status">{tr('Checking your session…', '正在检查登录状态…')}</div>
  return (
    <div className="mx-auto mt-16 max-w-md px-4 text-center">
      <p className="cond text-2xl font-bold">{tr('This page is for bank operators.', '此页面仅供银行工作人员使用。')}</p>
      <p className="mt-2 text-sm text-ink2">{tr('Operators read conversations that were handed over, reply, cancel plans and lift safety locks. They can never approve a step for a customer.', '工作人员可以查看转人工的会话、回复、取消计划和解除安全锁，但不能替客户确认任何操作。')}</p>
      <Link className="btn btn-ink mt-4 inline-block" to={'/team-token' + (getAdminToken() ? '' : '?next=/operator')}>{tr('Use an operator token', '使用工作人员令牌')}</Link>
    </div>
  )
}

/** The three levels in plain words: done right away, needs your OK, needs your PIN and a code. */
export function TierTag({ tier }: { tier: Tier | null | undefined }) {
  const { tr } = useLang()
  if (!tier) return null
  if (tier === 'green') return <span className="inline-flex items-center rounded-full border border-jade px-2 py-px text-[0.72rem] font-semibold leading-tight text-jade">{tr('Done right away', '直接办')}</span>
  if (tier === 'yellow') return <span className="inline-flex items-center rounded-full bg-ink px-2 py-px text-[0.72rem] font-semibold leading-tight text-field">{tr('Needs your OK', '需确认')}</span>
  return <span className="inline-flex items-center rounded-full bg-cinnabar px-2 py-px text-[0.72rem] font-semibold leading-tight text-white">{tr('Needs PIN + code', '需验证')}</span>
}

/** The page title, with the page's own controls on the right. No intro text: the page shows what it is. */
export function PageHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="cond text-[2rem] font-extrabold leading-tight">{title}</h1>
      {right}
    </div>
  )
}

/** One block of a page: a heading with an optional count or action beside it, then the content. */
export function Section({ title, aside, id, className = '', children }: { title: string; aside?: ReactNode; id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-6 ${className}`}>
      <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
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

/** A panel with a heading bar, as on the controls page. */
export function Panel({ title, note, right, children, id }: { title: string; note?: string; right?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="ruled overflow-hidden bg-field" id={id}>
      <div className="panel-heading"><div>
        <h2 className="cond text-xl font-bold leading-tight">{title}</h2>
        {note && <p className="text-sm text-ink2">{note}</p>}
      </div>{right}</div>
      {children}
    </section>
  )
}
