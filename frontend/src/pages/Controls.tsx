import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { api, errorText } from '../api/client'
import type { BankCard } from '../api/types'
import { useLang } from '../i18n'
import { PageHead, Section } from '../components/bits'
import { usePhone } from '../components/Verify'
import { useAuth } from '../lib/auth'
import { useOverview } from '../lib/bank'
import { useChat } from '../lib/chat'
import { stamp, yuan } from '../lib/format'
import { createPasskey, passkeysSupported } from '../lib/passkey'
import { EMPTY, LIST } from './Accounts'

type Status = { tone: 'ok' | 'err' | 'wait'; text: string } | null

export default function Controls() {
  const { tr, lang } = useLang()
  const overview = useOverview()
  const { send, pending } = useChat()
  const location = useLocation()
  const subs = useQuery({ queryKey: ['subscriptions', lang], queryFn: () => api.subscriptions(lang) })
  const [status, setStatus] = useState<Status>(null)
  useEffect(() => { if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView() }, [location.hash])
  const d = overview.data
  const ask = (text: string) => void send(text)
  const active = subs.data?.items.filter((s) => s.status === 'active') ?? []

  return (
    <main tabIndex={-1} className="page-content">
      <PageHead title={tr('Cards & security', '卡片与安全')} />
      {!d ? <div className="h-64 animate-pulse rounded-box bg-paper2" /> : <>
        <Section title={tr('Cards', '银行卡')}
          aside={<button type="button" className="btn btn-line py-1.5 text-sm" disabled={!!pending} onClick={() => ask(tr('Apply for a virtual card for online shopping', '申请一张网购用的虚拟卡'))}>{tr('New virtual card', '申请虚拟卡')}</button>}>
          <div className="grid gap-4 md:grid-cols-2">
            {d.cards.map((c) => <CardTile key={c.id} card={c} ask={ask} busy={!!pending} />)}
          </div>
        </Section>

        <Section title={tr('Subscriptions', '自动续费')} className="mt-10"
          aside={subs.data && <span className="text-sm text-ink2">{tr(`${yuan(subs.data.monthly_fen)} a month`, `每月约 ${yuan(subs.data.monthly_fen)}`)}</span>}>
          {!subs.data ? <div className="h-24 animate-pulse rounded-box bg-paper2" /> : !active.length ? <p className={EMPTY}>{tr('No active subscriptions.', '没有正在扣费的订阅。')}</p> : <>
            {subs.data.overlaps.length > 0 && <p className="mb-3 rounded-box bg-[var(--cinnabar-wash)] px-4 py-2.5 text-sm">{subs.data.overlaps.map((o) => tr(`You pay for ${o.merchants.length} ${o.group} services.`, `你同时订阅了 ${o.merchants.length} 个${o.group === 'music' ? '音乐' : '视频'}会员。`)).join(' ')}</p>}
            <ul className={LIST}>
              {active.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{s.merchant}{s.new && <span className="ml-2 text-xs font-normal text-cinnabar">{tr('new', '近期开通')}</span>}</p>
                    <p className="text-xs text-ink2">{s.cycle === 'monthly' ? tr('monthly', '每月') : tr('yearly', '每年')} · {tr(`next ${s.next_charge_on}`, `下次 ${s.next_charge_on}`)}</p>
                  </div>
                  <span className="num font-mono">{yuan(s.fen)}</span>
                  <span className="inline-flex gap-2">
                    <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={!!pending} onClick={() => ask(tr(`Remind me 3 days before ${s.merchant} renews`, `${s.merchant}续费前3天提醒我`))}>{tr('Remind', '提醒')}</button>
                    <button type="button" className="btn btn-line py-1 text-[0.85rem] text-cinnabar" disabled={!!pending} onClick={() => ask(tr(`Cancel ${s.merchant}`, `取消${s.merchant}`))}>{tr('Cancel', '取消')}</button>
                  </span>
                </li>
              ))}
            </ul>
          </>}
        </Section>

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-2">
          <LockPanel />
          <PasskeyPanel setStatus={setStatus} />
        </div>
        <DemoPanel setStatus={setStatus} />
      </>}

      {status && (
        <div role="status" className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4">
          <div className={`mx-auto flex max-w-xl items-center gap-3 rounded-box border bg-field px-4 py-3 shadow-[0_2px_0_var(--shadow)] ${status.tone === 'err' ? 'border-cinnabar' : status.tone === 'ok' ? 'border-jade' : 'border-ink'}`}>
            <span className={`min-w-0 flex-1 text-[0.95rem] ${status.tone === 'err' ? 'text-cinnabar' : ''}`}>{status.text}</span>
            {status.tone !== 'wait' && <button type="button" className="text-ink2" onClick={() => setStatus(null)} aria-label={lang === 'zh' ? '关闭' : 'Dismiss'}>✕</button>}
          </div>
        </div>
      )}
    </main>
  )
}

/** One card: its state and limit, the four switches (tap to change), and what you can do with it. */
function CardTile({ card: c, ask, busy }: { card: BankCard; ask: (t: string) => void; busy: boolean }) {
  const { tr } = useLang()
  const id = c.last4
  const lost = c.status === 'lost'
  const switches = [
    ['online', c.online, tr('Online', '网上支付'), tr('online payments', '网上支付')],
    ['overseas', c.overseas, tr('Overseas', '境外支付'), tr('overseas payments', '境外支付')],
    ['atm', c.atm, 'ATM', tr('ATM withdrawals', 'ATM 取现')],
    ['contactless', c.contactless, tr('Contactless', '闪付'), tr('contactless', '闪付')],
  ] as const
  const state = { active: tr('Active', '正常'), frozen: tr('Frozen', '已冻结'), lost: tr('Reported lost', '已挂失'), pending: tr('On its way', '寄送中') }[c.status]
  return (
    <div className={`ruled bg-field p-4 ${lost ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{c.name} <span className="font-mono text-[0.9rem] text-ink2">{c.last4}</span></p>
          <p className="text-xs text-ink2">{tr(`Daily limit ${yuan(c.daily_limit_fen)} · expires ${c.expires}`, `日限额 ${yuan(c.daily_limit_fen)} · 有效期 ${c.expires}`)}</p>
        </div>
        <span className={`shrink-0 text-sm font-semibold ${c.status === 'active' ? 'text-jade' : c.status === 'frozen' || lost ? 'text-cinnabar' : 'text-ink2'}`}>{state}</span>
      </div>
      {!lost && <>
        <div className="mt-3 flex flex-wrap gap-2">
          {switches.map(([key, on, label, word]) => (
            <button key={key} type="button" disabled={busy} aria-pressed={on}
              className={`rounded-full px-3 py-1 text-[0.8rem] font-semibold ${on ? 'bg-ink text-field' : 'border border-rule text-ink2'}`}
              onClick={() => ask(on ? tr(`Turn off ${word} on card ${id}`, `关闭尾号${id}的卡的${word}`) : tr(`Turn on ${word} on card ${id}`, `开通尾号${id}的卡的${word}`))}>
              {label} {on ? tr('on', '开') : tr('off', '关')}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-rule pt-3">
          {c.status === 'active'
            ? <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={busy} onClick={() => ask(tr(`Freeze card ${id}`, `冻结尾号${id}的卡`))}>{tr('Freeze', '冻结')}</button>
            : <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={busy} onClick={() => ask(tr(`Unfreeze card ${id}`, `解冻尾号${id}的卡`))}>{tr('Unfreeze', '解冻')}</button>}
          <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={busy} onClick={() => ask(tr(`Change the daily limit of card ${id}`, `调整尾号${id}的卡的限额`))}>{tr('Limit', '限额')}</button>
          <button type="button" className="btn btn-line ml-auto py-1 text-[0.85rem] text-cinnabar" disabled={busy} onClick={() => ask(tr(`Report card ${id} lost`, `挂失尾号${id}的卡`))}>{tr('Report lost', '挂失')}</button>
        </div>
      </>}
    </div>
  )
}

function LockPanel() {
  const { tr, lang } = useLang()
  const { user } = useAuth()
  const overview = useOverview()
  const qc = useQueryClient()
  const [pin, setPin] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const phone = usePhone(!!challenge)
  const locks = overview.data?.locks ?? []
  const sendCode = async () => {
    setMessage('')
    try { setChallenge((await api.unlockSms()).challenge_id) } catch (err) { setMessage(errorText(err, lang)) }
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.unlock(pin, challenge!, code, lang)
      setMessage(tr('Unlocked.', '已解除。')); setPin(''); setCode(''); setChallenge(null)
      void qc.invalidateQueries()
    } catch (err) { setMessage(errorText(err, lang)) }
  }
  return (
    <Section id="security" title={tr('Safety lock', '安全锁')}
      aside={<span className={`text-sm font-semibold ${locks.length ? 'text-cinnabar' : 'text-jade'}`}>{locks.length ? tr('On', '已开启') : tr('Off', '未开启')}</span>}>
      <div className="ruled bg-field p-4">
        {locks.length === 0 ? <p className="text-sm text-ink2">{tr('Turns on by itself after repeated failed checks or attempts to get around the rules.', '多次验证失败或试图绕过规则时会自动开启。')}</p> : (
          <>
            {locks.map((l) => <p key={l.reason} className="border-l-2 border-cinnabar px-3 py-1 text-[0.95rem]">{l.text}</p>)}
            {locks.some((l) => l.scope !== 'red') && (
              <form onSubmit={submit} className="mt-3 grid gap-2">
                <input className="field num tracking-[0.4em]" type="password" inputMode="numeric" maxLength={6} placeholder={tr('Transaction PIN', '交易密码')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label={tr('Transaction PIN', '交易密码')} />
                {user?.demo_pin && (
                  <p className="flex items-center justify-between gap-2 text-xs text-ink2">
                    {tr(`Demo account: the PIN is ${user.demo_pin}`, `演示账户：交易密码是 ${user.demo_pin}`)}
                    <button type="button" className="font-semibold text-[var(--action)]" onClick={() => setPin(user.demo_pin ?? '')}>{tr('Fill it in', '填入')}</button>
                  </p>
                )}
                {!challenge ? <button type="button" className="btn btn-line py-1.5" onClick={() => void sendCode()}>{tr('Send a code to my phone', '发送验证码到我的手机')}</button> : <>
                  <input className="field num tracking-[0.4em]" inputMode="numeric" maxLength={6} placeholder={tr('SMS code', '短信验证码')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label={tr('SMS code', '短信验证码')} />
                  {phone.data?.items[0] && <p className="border-l-2 border-ink2 bg-paper px-3 py-2 text-xs">{lang === 'zh' ? phone.data.items[0].text : phone.data.items[0].text_en}</p>}
                  <button className="btn btn-ink py-1.5" disabled={pin.length !== 6 || code.length !== 6}>{tr('Verify and unlock', '验证并解除')}</button>
                </>}
              </form>
            )}
            {locks.every((l) => l.scope === 'red') && <p className="mt-2 text-sm text-ink2">{tr('Clears by itself after 30 minutes, or bank staff can lift it.', '30 分钟后自动解除，或由银行工作人员解除。')}</p>}
          </>
        )}
        {message && <p role="status" className="mt-2 text-sm text-ink2">{message}</p>}
      </div>
    </Section>
  )
}

function PasskeyPanel({ setStatus }: { setStatus: (s: Status) => void }) {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const keys = useQuery({ queryKey: ['passkeys'], queryFn: api.passkeys })
  async function add() {
    setStatus({ tone: 'wait', text: tr('Follow your device’s prompt…', '请按设备提示操作…') })
    try {
      const credential = await createPasskey(await api.passkeyRegisterOptions())
      await api.passkeyRegister(credential, navigator.platform || 'device')
      setStatus({ tone: 'ok', text: tr('Passkey added. You can use it instead of an SMS code.', '通行密钥已添加，之后可以代替短信验证码。') })
      void qc.invalidateQueries({ queryKey: ['passkeys'] })
      void qc.invalidateQueries({ queryKey: ['overview'] })
    } catch (err) {
      setStatus({ tone: 'err', text: err instanceof DOMException ? tr('Passkey setup was cancelled.', '已取消添加通行密钥。') : errorText(err, lang) })
    }
  }
  return (
    <Section title={tr('Passkeys', '通行密钥')}
      aside={<button type="button" className="btn btn-line py-1.5 text-sm" disabled={!passkeysSupported()} onClick={() => void add()}>{tr('Add', '添加')}</button>}>
      {keys.data?.items.length
        ? <ul className={LIST}>{keys.data.items.map((k) => <li key={k.id} className="flex justify-between px-4 py-3 text-sm"><span>{k.label || tr('Device', '设备')}</span><span className="font-mono text-xs text-ink2">{k.created_at.slice(0, 10)}</span></li>)}</ul>
        : <p className={EMPTY}>{passkeysSupported() ? tr('Use face or fingerprint unlock instead of an SMS code.', '用面容或指纹代替短信验证码。') : tr('Needs HTTPS and a supported browser.', '需要 HTTPS 和支持的浏览器。')}</p>}
    </Section>
  )
}

function DemoPanel({ setStatus }: { setStatus: (s: Status) => void }) {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const { reload, newConversation } = useChat()
  const clock = useQuery({ queryKey: ['clock'], queryFn: api.clock })
  const [busy, setBusy] = useState(false)
  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true)
    setStatus({ tone: 'wait', text: tr('Working…', '处理中…') })
    try {
      await task()
      await qc.invalidateQueries()
      await reload()
      setStatus({ tone: 'ok', text: done })
    } catch (err) {
      setStatus({ tone: 'err', text: errorText(err, lang) })
    } finally {
      setBusy(false)
    }
  }
  const days = clock.data ? Math.round((clock.data.offset_seconds / 86400) * 10) / 10 : 0
  const here = typeof window !== 'undefined' ? window.location.origin + '/' : ''
  return (
    <Section title={tr('Demo tools', '演示工具')} className="mt-10">
      <div className="ruled flex flex-wrap items-center gap-x-8 gap-y-4 bg-field p-4">
        <div>
          <p className="text-xs text-ink2">{tr('Bank clock', '银行时钟')}{days ? tr(` (+${days} days)`, `（快 ${days} 天）`) : ''}</p>
          <p className="num cond text-[1.5rem] font-bold leading-tight">{clock.data ? stamp(clock.data.now) : '—'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {([[0, 1, tr('+1 hour', '+1 小时')], [1, 0, tr('+1 day', '+1 天')], [7, 0, tr('+7 days', '+7 天')], [30, 0, tr('+30 days', '+30 天')]] as const).map(([d, h, label]) => (
            <button key={label} type="button" className="btn btn-line py-1.5" disabled={busy} onClick={() => void run(() => api.advance(d, h, lang), tr('Time moved forward.', '时间已前进。'))}>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <button type="button" className="btn btn-line py-1.5" disabled={busy} onClick={() => void newConversation()}>{tr('New chat', '新对话')}</button>
          <button type="button" className="btn btn-line py-1.5 text-cinnabar" disabled={busy} onClick={() => window.confirm(tr('Reset your demo bank to its starting data? Your history is kept.', '把演示银行恢复到初始数据？你的记录会保留。')) && void run(api.reset, tr('Demo bank reset.', '演示银行已重置。'))}>{tr('Reset bank', '重置银行')}</button>
        </div>
        {here && !/localhost|127\.0\.0\.1/.test(here) && (
          <div className="flex w-full items-center gap-4 border-t border-rule pt-4">
            <div className="w-fit shrink-0 bg-[#fff] p-2 ruled"><QRCodeSVG value={here} size={80} bgColor="#ffffff" fgColor="#1d2836" level="M" marginSize={0} /></div>
            <p className="text-sm text-ink2">{tr('Open it on your phone.', '用手机打开。')}<span className="mt-1 block break-all font-mono text-xs">{here.replace(/^https?:\/\//, '')}</span></p>
          </div>
        )}
      </div>
    </Section>
  )
}
