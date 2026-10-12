import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bell, ChartColumn, Eye, Landmark, Menu, MessageCircle, TrendingUp, X } from 'lucide-react'
import { Behind } from '../components/Behind'
import { Mark } from '../components/Chrome'
import { useLang } from '../i18n'
import { call } from '../lib/api'
import { ChatProvider } from '../lib/chat'

export interface Overview {
  now: string
  name: string
  accounts: { id: string; kind: string; name: string; number: string; fen: number; release_on: string | null }[]
  cash_fen: number
  invest_fen: number
  month_spend_fen: number
  month_income_fen: number
  cards: { id: string; kind: string; name: string; last4: string; status: string; daily_limit_fen: number; online: boolean; overseas: boolean; atm: boolean; contactless: boolean; expires: string }[]
  unread: number
  locks: { scope: string; reason: string; text: string; expires_at: string | null }[]
  has_passkey: boolean
}

export function useOverview() {
  const { lang } = useLang()
  return useQuery({ queryKey: ['overview', lang], queryFn: () => call<Overview>(`/api/bank/overview?lang=${lang}`), refetchInterval: 20_000 })
}

function Tabs() {
  const { tr } = useLang()
  const tabs = [
    ['/', MessageCircle, tr('Assistant', '助手')],
    ['/accounts', Landmark, tr('Accounts', '账户')],
    ['/bills', ChartColumn, tr('Bills', '账单')],
    ['/wealth', TrendingUp, tr('Wealth', '理财')],
    ['/more', Menu, tr('More', '更多')],
  ] as const
  return (
    <nav aria-label={tr('Main', '主导航')} className="safe-bottom grid grid-cols-5 border-t border-rule bg-sheet pt-1.5">
      {tabs.map(([to, Icon, label]) => (
        <NavLink key={to} to={to} end={to === '/'}
          className={({ isActive }) => `flex flex-col items-center gap-0.5 rounded-lg py-1 text-[11px] font-semibold ${isActive ? 'text-indigo' : 'text-ink3 hover:text-ink2'}`}>
          <Icon size={20} strokeWidth={2} aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function Shell() {
  const { tr, lang } = useLang()
  const overview = useOverview()
  const navigate = useNavigate()
  const [behind, setBehind] = useState(false)
  const now = overview.data?.now
  return (
    <ChatProvider>
      <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(380px,460px)_1fr]">
        <div className="flex h-dvh flex-col bg-paper lg:border-r lg:border-rule">
          <header className="flex items-center gap-2.5 border-b border-rule bg-sheet px-4 py-2.5">
            <Mark size={26} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[15px] font-bold">{tr('Banking AI Agent', '银行 AI 助手')}</p>
              {now && <p className="num text-[11px] text-ink3">{tr('Bank time', '银行时间')} {new Date(now).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
            </div>
            <button type="button" onClick={() => navigate('/accounts#notifications')} className="relative rounded-lg p-2 text-ink2 hover:text-ink" aria-label={tr('Reminders', '提醒')}>
              <Bell size={19} />
              {!!overview.data?.unread && <span className="num absolute right-0.5 top-0.5 min-w-4 rounded-full bg-vermilion px-1 text-center text-[10px] font-bold leading-4 text-white">{overview.data.unread}</span>}
            </button>
            <button type="button" onClick={() => setBehind(true)} className="flex items-center gap-1 rounded-lg border border-rule px-2 py-1 text-xs font-semibold text-ink2 lg:hidden">
              <Eye size={14} />{tr('Behind the scenes', '幕后')}
            </button>
          </header>
          {!!overview.data?.locks.length && (
            <p role="alert" className="border-b border-rule bg-vermilion-wash px-4 py-2 text-sm text-vermilion">
              {overview.data.locks[0].text} <button className="font-semibold underline" onClick={() => navigate('/more#security')}>{tr('Details', '查看')}</button>
            </p>
          )}
          <main className="scroll-thin min-h-0 flex-1 overflow-y-auto"><Outlet /></main>
          <Tabs />
        </div>
        <aside className="hidden h-dvh min-w-0 overflow-hidden lg:block"><Behind /></aside>
        {behind && (
          <div className="fixed inset-0 z-40 flex flex-col bg-paper lg:hidden" role="dialog" aria-modal="true" aria-label={tr('Behind the scenes', '幕后')}>
            <div className="flex items-center justify-between border-b border-rule bg-sheet px-4 py-2.5">
              <p className="font-bold">{tr('Behind the scenes', '幕后')}</p>
              <button type="button" onClick={() => setBehind(false)} className="rounded-lg p-1.5 text-ink2" aria-label={tr('Close', '关闭')}><X size={20} /></button>
            </div>
            <div className="min-h-0 flex-1"><Behind /></div>
          </div>
        )}
      </div>
    </ChatProvider>
  )
}
