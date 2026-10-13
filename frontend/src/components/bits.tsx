import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { getAdminToken } from '../api/client'
import type { Tier } from '../api/types'
import { useLang } from '../i18n'
import { isOperator, useAuth } from '../lib/auth'

/** Live countdown to an ISO time; calls onDone once when it passes. */
export function Countdown({ to, onDone }: { to: string; onDone?: () => void }) {
  const target = new Date(to).getTime()
  const [left, setLeft] = useState(() => Math.max(0, target - Date.now()))
  useEffect(() => {
    const t = setInterval(() => {
      const l = Math.max(0, target - Date.now())
      setLeft(l)
      if (l === 0) {
        clearInterval(t)
        onDone?.()
      }
    }, 250)
    return () => clearInterval(t)
  }, [target, onDone])
  const s = Math.ceil(left / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const txt = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
  return <span className="num cond font-bold">{txt}</span>
}

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

/** The permission tier of a step, in the same small-tag style as the controls page. */
export function TierTag({ tier }: { tier: Tier | null | undefined }) {
  const { tr } = useLang()
  if (!tier) return null
  if (tier === 'green') return <span className="inline-flex items-center rounded-[2px] border border-jade px-1.5 py-px text-[0.72rem] font-semibold leading-tight text-jade">{tr('automatic', '自动')}</span>
  if (tier === 'yellow') return <span className="inline-flex items-center rounded-[2px] bg-ink px-1.5 py-px text-[0.72rem] font-semibold leading-tight text-field">{tr('confirm', '需确认')}</span>
  return <span className="inline-flex items-center rounded-[2px] border border-dashed border-cinnabar px-1.5 py-px text-[0.72rem] font-semibold leading-tight text-cinnabar">{tr('strong check', '强验证')}</span>
}

export function Problem({ text }: { text: string | null | undefined }) {
  return text ? <p role="alert" className="mt-2 text-sm font-semibold text-cinnabar">{text}</p> : null
}

/** A titled card, as on the wallet page: a numbered title, a one-line purpose, then the content. */
export function Card({ title, sub, right, children, id }: { title: string; sub?: string; right?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="ruled bg-field p-4" id={id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="cond text-xl font-bold">{title}</h2>
          {sub && <p className="mt-0.5 text-sm leading-snug text-ink2">{sub}</p>}
        </div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
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

export function Figure({ label, value, unit, color, icon }: { label: string; value: string; unit?: string; color?: string; icon?: ReactNode }) {
  return (
    <div className="metric-card">
      <dt>{label}{icon}</dt>
      <dd style={{ color: color ?? 'var(--ink)' }}>
        {value}
        {unit && <small>{unit}</small>}
      </dd>
    </div>
  )
}
