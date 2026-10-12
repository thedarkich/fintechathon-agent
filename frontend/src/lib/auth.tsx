import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, call } from './api'

export interface User { id: string; name: string; email: string; phone: string; operator: boolean; has_pin: boolean }
type Auth = { user: User | null; loading: boolean; signedIn: (u: User) => void; logout: () => Promise<void> }
const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()
  const refresh = useCallback(async () => {
    try {
      const { user } = await call<{ user: User }>('/api/me')
      setUser(user)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const signedIn = (next: User) => { qc.clear(); setUser(next) }
  const logout = async () => {
    await call('/api/logout', {})
    qc.clear()
    setUser(null)
  }
  return <AuthContext.Provider value={{ user, loading, signedIn, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
