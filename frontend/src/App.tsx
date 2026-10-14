import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ServerBanner } from './components/ServerBanner'
import { Header } from './components/Header'
import { SignedInGate } from './components/bits'
import { isServerProblem, markServer } from './lib/net'
import { AuthProvider } from './lib/auth'
import { ChatProvider } from './lib/chat'
import { LangProvider } from './i18n'
import LandingPage from './pages/Landing'

/** After a redeploy, an open tab asks for chunks that no longer exist: reload once to pick up the new build. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function page<P extends Record<string, any>>(load: () => Promise<{ default: React.ComponentType<P> }>) {
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

const AuthPage = page(() => import('./pages/Auth'))
const TeamAccess = page(() => import('./pages/TeamAccess'))
const Assistant = page(() => import('./pages/Assistant'))
const Home = page(() => import('./pages/Home'))
const Send = page(() => import('./pages/Send'))
const Payments = page(() => import('./pages/Payments'))
const Qr = page(() => import('./pages/Qr'))
const Accounts = page(() => import('./pages/Accounts'))
const How = page(() => import('./pages/How'))
const Bills = page(() => import('./pages/Bills'))
const Wealth = page(() => import('./pages/Wealth'))
const Controls = page(() => import('./pages/Controls'))
const Ledger = page(() => import('./pages/Ledger'))
const Operator = page(() => import('./pages/Operator'))
const Register = () => <AuthPage register />

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => isServerProblem(err) && markServer(false),
    onSuccess: () => markServer(true),
  }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 1000 },
  },
})

function Loading() {
  return <div className="mx-auto mt-24 h-2 w-40 animate-pulse rounded-full bg-paper2" aria-label="Loading" />
}

/** Every workspace page shares one header and one conversation, so asking from any page continues the same thread. */
function Workspace() {
  return (
    <div className="workspace">
      <Header />
      <SignedInGate>
        <ChatProvider>
          <Suspense fallback={<Loading />}><Outlet /></Suspense>
        </ChatProvider>
      </SignedInGate>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LangProvider>
        <ServerBanner />
        {/* hash routes: the server never needs an SPA fallback, and links survive WeChat's in-app browser */}
        <HashRouter>
          <AuthProvider>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<AuthPage />} />
                <Route path="/signup" element={<Register />} />
                <Route path="/team-token" element={<TeamAccess />} />
                <Route path="/how" element={<How />} />
                <Route element={<Workspace />}>
                  <Route path="/home" element={<Home />} />
                  <Route path="/send" element={<Send />} />
                  <Route path="/payments" element={<Payments />} />
                  <Route path="/qr" element={<Qr />} />
                  <Route path="/assistant" element={<Assistant />} />
                  <Route path="/accounts" element={<Accounts />} />
                  <Route path="/transfers" element={<Navigate to="/accounts#transfers" replace />} />
                  <Route path="/bills" element={<Bills />} />
                  <Route path="/wealth" element={<Wealth />} />
                  <Route path="/controls" element={<Controls />} />
                  <Route path="/ledger" element={<Ledger />} />
                </Route>
                <Route path="/operator" element={<Operator />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </HashRouter>
      </LangProvider>
    </QueryClientProvider>
  )
}
