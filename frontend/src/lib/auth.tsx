import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { clearAdminToken, getAdminToken } from '../api/client'
import type { User } from '../api/types'
import { useLang } from '../i18n'
import { getDeviceId } from './device'

export type { User }
type AuthResult = { response: { ok: boolean; status: number }; result: { user?: User; code?: string; message_en?: string; message_zh?: string } }
type Auth = {
  user: User | null; loading: boolean; error: string
  refresh: () => Promise<void>; signedIn: (user: User) => void; logout: () => Promise<void>
}
const AuthContext = createContext<Auth | null>(null)

/** Account endpoints use the HttpOnly session cookie. */
export async function authRequest(path: string, data?: Record<string, string>): Promise<AuthResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(path, {
      method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-Device-Id': getDeviceId(), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal,
    })
    return { response, result: await response.json().catch(() => ({})) }
  } finally { clearTimeout(timer) }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { tr } = useLang()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState<'' | 'unavailable' | 'unreachable'>('')
  const qc = useQueryClient()
  const revision = useRef(0)
  const signedInRef = useRef(false)
  const setAccount = useCallback((next: User | null) => {
    revision.current++
    signedInRef.current = !!next
    void qc.cancelQueries()
    qc.clear()  // nothing private from the previous account stays cached
    setUser(next)
    setProblem('')
    setLoading(false)
  }, [qc])
  const refresh = useCallback(async () => {
    const current = revision.current
    try {
      const { response, result } = await authRequest('/api/me')
      if (revision.current !== current) return
      if (response.ok && result.user) { signedInRef.current = true; setUser(result.user); setProblem('') }
      else if (response.status === 401) { if (signedInRef.current) setAccount(null); else { setUser(null); setProblem('') } }
      else setProblem('unavailable')
    } catch {
      if (revision.current === current) setProblem('unreachable')
    } finally { if (revision.current === current) setLoading(false) }
  }, [setAccount])
  useEffect(() => {
    void refresh()
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60_000)
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])
  const logout = async () => {
    const { response } = await authRequest('/api/logout', {})
    if (!response.ok) throw new Error('logout failed')
    clearAdminToken()
    setAccount(null)
  }
  const error = problem === 'unavailable' ? tr('The sign-in service is unavailable. Try again shortly.', '登录服务暂不可用，请稍后重试。')
    : problem === 'unreachable' ? tr("Can't reach the sign-in service. Try again shortly.", '无法连接登录服务，请稍后重试。') : ''
  return <AuthContext.Provider value={{ user, loading, error, refresh, signedIn: setAccount, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

/** One click into a fresh demo bank: no email or password to invent; its PIN is shown where it is needed. */
export function useStartDemo() {
  const { signedIn } = useAuth()
  const { lang, tr } = useLang()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 'ok' when signed in; 'off' when this server has no demo accounts (sign up instead); 'error' otherwise. */
  const start = useCallback(async (): Promise<'ok' | 'off' | 'error'> => {
    setBusy(true)
    setError('')
    try {
      const { response, result } = await authRequest('/api/demo/start', { lang })
      if (response.ok && result.user) { signedIn(result.user); return 'ok' }
      if (response.status === 403) return 'off'
      setError(response.status === 429 ? tr('Too many demo accounts from here. Try again in an hour.', '这里开的演示账户太多了，请一小时后再试。')
        : tr('Could not open a demo account. Please retry.', '暂时无法开通演示账户，请重试。'))
    } catch {
      setError(tr('Could not reach the server. Please retry.', '无法连接服务器，请重试。'))
    } finally {
      setBusy(false)
    }
    return 'error'
  }, [lang, signedIn, tr])
  return { start, busy, error }
}

/** The operator console: an operator account, or the server's admin token. */
export const isOperator = (user: User | null) => !!getAdminToken() || !!user?.operator

/** Where a sign-in should land. */
export const landingFor = (user: User | null, path: string) => (!user && getAdminToken() ? '/operator' : path)

export function workspaceDestination(value: string | null) {
  if (!value) return '/home'
  return /^\/(home|send|assistant|accounts|transfers|bills|wealth|controls|subscriptions|ledger|operator)(?:\?[^#]*)?$/.test(value) ? value : '/home'
}
