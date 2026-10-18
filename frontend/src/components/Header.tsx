import { useLocation } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLang } from '../i18n'
import { api } from '../api/client'
import { useAuth } from '../lib/auth'
import { SiteHeader } from './SiteChrome'

const PAGE_TITLES: Record<string, [string, string]> = {
  home: ['Home', '首页'], send: ['Send money', '转账'],
  assistant: ['Assistant', '助手'], accounts: ['Accounts', '账户'], bills: ['Spending', '账单'],
  wealth: ['Invest', '理财'], controls: ['Cards & security', '卡片与安全'], ledger: ['History', '记录'], operator: ['Staff', '客服'],
}

/** The workspace header: one row of pages, with the bank's clock in the account menu. `extra` sits before the account (the demo tools). */
export function Header({ compact = false, extra }: { compact?: boolean; extra?: ReactNode }) {
  const { tr, lang } = useLang()
  const { user } = useAuth()
  const loc = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
    const page = PAGE_TITLES[loc.pathname.slice(1)]
    document.title = tr('Bank Agent', '银行代办') + (page ? ' · ' + tr(page[0], page[1]) : '')
  }, [loc.pathname, tr])
  const overview = useQuery({ queryKey: ['overview', lang], queryFn: () => api.overview(lang), enabled: !!user, staleTime: 15_000 })
  const now = overview.data?.now
  const when = now ? new Date(now).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
  const status = [user ? tr(`Bank time ${when}`, `银行时间 ${when}`) : '', tr('Simulated bank, no real money', '模拟银行，不涉及真实资金')].filter(Boolean).join(' · ')
  return <div className={compact ? 'site-workspace-header compact' : 'site-workspace-header'}>
    <a className="skip-link" href={'#' + loc.pathname} onClick={e => { e.preventDefault(); document.querySelector<HTMLElement>('main')?.focus() }}>{tr('Skip to content', '跳到正文')}</a>
    <SiteHeader workspace status={status} extra={extra} />
  </div>
}
