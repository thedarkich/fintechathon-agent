import { useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLang } from '../i18n'
import { api } from '../api/client'
import { useAuth } from '../lib/auth'
import { SiteHeader } from './SiteChrome'

/** The workspace header: the same two-row navigation as the public site, with the bank's clock on the right. */
export function Header({ compact = false }: { compact?: boolean }) {
  const { tr, lang } = useLang()
  const { user } = useAuth()
  const loc = useLocation()
  useEffect(() => { window.scrollTo(0, 0); document.title = tr('Bank Agent', '银行代办') + ' · ' + loc.pathname.slice(1) }, [loc.pathname, tr])
  const overview = useQuery({ queryKey: ['overview', lang], queryFn: () => api.overview(lang), enabled: !!user, staleTime: 15_000 })
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 60_000 })
  const now = overview.data?.now
  const when = now ? new Date(now).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
  const planner = health.data ? (health.data.planner === 'ai' ? tr('AI planner', 'AI 规划') : tr('Offline planner', '离线规划')) : ''
  const status = [user ? tr(`Bank time ${when}`, `银行时间 ${when}`) : '', planner, tr('Simulated bank · no real money', '模拟银行 · 不涉及真实资金')].filter(Boolean).join(' · ')
  return <div className={compact ? 'site-workspace-header compact' : 'site-workspace-header'}>
    <a className="skip-link" href={'#' + loc.pathname} onClick={e => { e.preventDefault(); document.querySelector<HTMLElement>('main')?.focus() }}>{tr('Skip to content', '跳到正文')}</a>
    <SiteHeader workspace status={status} />
  </div>
}
