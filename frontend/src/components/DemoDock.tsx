import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { FlaskConical, X } from 'lucide-react'
import { api, errorText } from '../api/client'
import { useLang } from '../i18n'
import { useChat } from '../lib/chat'
import { stamp } from '../lib/format'

/**
 * Tools for showing the demo, kept apart from the bank's own pages: move the bank's clock (so scheduled
 * steps, renewals and birthdays happen now), start a new chat, or reset the demo bank.
 * A small button in the corner of every page opens them; it only exists while the server's demo tools are on.
 */
export function DemoDock() {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const { reload, newConversation } = useChat()
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 60_000 })
  const [open, setOpen] = useState(false)
  const clock = useQuery({ queryKey: ['clock'], queryFn: api.clock, enabled: open })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [open])

  if (!health.data?.demo_tools) return null

  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true)
    setStatus(null)
    try {
      await task()
      await qc.invalidateQueries()
      await reload()
      setStatus({ ok: true, text: done })
    } catch (err) {
      setStatus({ ok: false, text: errorText(err, lang) })
    } finally {
      setBusy(false)
    }
  }
  async function startChat() {
    setBusy(true)
    setStatus(null)
    try {
      await newConversation()
      setStatus({ ok: true, text: tr('New chat started.', '已开始新对话。') })
    } catch (err) {
      setStatus({ ok: false, text: errorText(err, lang) })
    } finally {
      setBusy(false)
    }
  }
  const days = clock.data ? Math.round((clock.data.offset_seconds / 86400) * 10) / 10 : 0
  const here = typeof window !== 'undefined' ? window.location.origin + '/' : ''
  const steps = [[0, 1, tr('+1 hour', '+1 小时')], [1, 0, tr('+1 day', '+1 天')], [7, 0, tr('+7 days', '+7 天')], [30, 0, tr('+30 days', '+30 天')]] as const

  return <>
    <button type="button" className="demo-dock-button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="demo-dock" aria-label={tr('Demo tools', '演示工具')}>
      <FlaskConical size={16} aria-hidden /><span className="demo-dock-label">{tr('Demo tools', '演示工具')}</span>
    </button>
    {open && (
      <div id="demo-dock" ref={panel} tabIndex={-1} role="dialog" aria-label={tr('Demo tools', '演示工具')} className="demo-dock-panel">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{tr('Demo tools', '演示工具')}</p>
            <p className="text-xs text-ink2">{tr('For showing the demo. A real bank has none of these.', '仅用于演示，真实银行没有这些功能。')}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-[var(--field)]" aria-label={tr('Close', '关闭')}><X size={16} /></button>
        </div>

        <p className="text-xs text-ink2">{tr('Bank clock', '银行时钟')}{days ? tr(` (${days} days ahead)`, `（快 ${days} 天）`) : ''}</p>
        <p className="num text-[1.4rem] font-semibold leading-tight">{clock.data ? stamp(clock.data.now) : '—'}</p>
        <p className="mb-2 mt-1 text-xs text-ink2">{tr('Move time forward to see scheduled transfers, renewals and reminders happen.', '让时间前进，就能看到预约转账、续费和提醒的发生。')}</p>
        <div className="grid grid-cols-4 gap-1.5">
          {steps.map(([d, h, label]) => (
            <button key={label} type="button" className="btn btn-line whitespace-nowrap px-1 py-1.5 text-sm" disabled={busy} onClick={() => void run(() => api.advance(d, h, lang), tr('Time moved forward.', '时间已前进。'))}>{label}</button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1.5 border-t border-rule pt-4">
          <button type="button" className="btn btn-line py-1.5 text-sm" disabled={busy} onClick={() => void startChat()}>{tr('Start a new chat', '开始新对话')}</button>
          <button type="button" className="btn btn-line py-1.5 text-sm text-cinnabar" disabled={busy}
            onClick={() => window.confirm(tr('Reset your demo bank to its starting data? Your history is kept.', '把演示银行恢复到初始数据？你的记录会保留。')) && void run(api.reset, tr('Demo bank reset.', '演示银行已重置。'))}>{tr('Reset the bank', '重置银行')}</button>
        </div>

        {status && <p role="status" className={`mt-3 text-sm ${status.ok ? 'text-jade' : 'text-cinnabar'}`}>{status.text}</p>}

        {here && !/localhost|127\.0\.0\.1/.test(here) && (
          <div className="mt-4 flex items-center gap-3 border-t border-rule pt-4">
            <div className="w-fit shrink-0 bg-[#fff] p-1.5 ruled"><QRCodeSVG value={here} size={72} bgColor="#ffffff" fgColor="#1d2836" level="M" marginSize={0} /></div>
            <p className="text-sm text-ink2">{tr('Open it on your phone.', '用手机打开。')}<span className="mt-1 block break-all font-mono text-xs">{here.replace(/^https?:\/\//, '')}</span></p>
          </div>
        )}
      </div>
    )}
  </>
}
