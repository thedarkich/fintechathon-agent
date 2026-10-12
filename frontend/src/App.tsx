import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LangProvider } from './i18n'
import { AuthProvider, useAuth } from './lib/auth'
import AuthPage from './pages/Auth'
import Shell from './pages/Shell'

/** After a redeploy, an open tab asks for chunks that no longer exist: reload once to pick up the new build. */
function page(load: () => Promise<{ default: React.ComponentType }>) {
  return lazy(() => load().catch((error) => {
    try {
      if (!sessionStorage.getItem('ba_reloaded')) {
        sessionStorage.setItem('ba_reloaded', '1')
        window.location.reload()
        return new Promise<never>(() => undefined)
      }
    } catch { /* storage blocked */ }
    throw error
  }).then((module) => {
    try { sessionStorage.removeItem('ba_reloaded') } catch { /* storage blocked */ }
    return module
  }))
}

const Chat = page(() => import('./pages/Chat'))
const Accounts = page(() => import('./pages/Accounts'))
const Bills = page(() => import('./pages/Bills'))
const CardsPage = page(() => import('./pages/CardsPage'))
const Wealth = page(() => import('./pages/Wealth'))
const More = page(() => import('./pages/More'))
const Operator = page(() => import('./pages/Operator'))

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 2000 } },
})

function Loading() {
  return <div className="mx-auto mt-24 h-1.5 w-32 animate-pulse rounded-full bg-well" role="status" aria-label="Loading" />
}

function Gate() {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) {
    return (
      <Routes>
        <Route path="/signup" element={<AuthPage register />} />
        <Route path="*" element={<AuthPage />} />
      </Routes>
    )
  }
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/operator" element={<Operator />} />
        <Route element={<Shell />}>
          <Route path="/" element={<Chat />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/wealth" element={<Wealth />} />
          <Route path="/more" element={<More />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LangProvider>
        <HashRouter>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </HashRouter>
      </LangProvider>
    </QueryClientProvider>
  )
}
