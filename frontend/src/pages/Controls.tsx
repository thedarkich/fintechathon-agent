import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { api, errorText } from '../api/client'
import type { BankCard } from '../api/types'
import { useLang } from '../i18n'
import { Badge, EMPTY, LIST, Notice, PageHead, PageTabs, Section, useTab } from '../components/bits'
import { usePhone } from '../components/Verify'
import { useAuth } from '../lib/auth'
import { useOverview } from '../lib/bank'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'
import { createPasskey, passkeysSupported } from '../lib/passkey'

type Status = { tone: 'ok' | 'err' | 'wait'; text: string } | null

/** Card 04, card management: the cards and their switches, and the safety lock and passkeys. */
export default function Controls() {
  const [params] = useSearchParams()
  // subscriptions have their own page now; an older link still lands there
  if (params.get('tab') === 'subscriptions') return <Navigate to="/subscriptions" replace />
  return <CardsPage />
}

function CardsPage() {
  const { tr, lang } = useLang()
  const overview = useOverview()
  const { send, pending } = useChat()
  const [tab, setTab] = useTab(['cards', 'security'] as const, 'cards')
  const [status, setStatus] = useState<Status>(null)
  const d = overview.data
  const ask = (text: string) => void send(text)
  const locked = (d?.locks ?? []).length > 0

  return (
    <main tabIndex={-1} className="page-content scope-cards">
      <PageHead title={tr('Cards', '卡片')} />
      <PageTabs label={tr('Cards', '卡片')} value={tab} onChange={setTab}
        options={[['cards', tr('Cards', '银行卡')], ['security', locked ? tr('Security (locked)', '安全（已锁定）') : tr('Security', '安全')]] as const} />
      {!d ? <div className="h-64 animate-pulse rounded-box bg-paper2" /> : <>
        {tab === 'cards' && <Section title={tr('Your cards', '你的银行卡')}
          aside={<button type="button" className="btn btn-line px-4 text-sm" disabled={!!pending} onClick={() => ask(tr('Apply for a virtual card for online shopping', '申请一张网购用的虚拟卡'))}>{tr('New virtual card', '申请虚拟卡')}</button>}>
          <p className="mb-4 max-w-2xl text-sm text-ink2">{tr('Tap a switch to turn it on or off. Making a card safer needs your OK; making it riskier also needs your PIN and a code.', '点开关即可开启或关闭。让卡更安全只需确认；让卡风险更高还需要交易密码和验证码。')}</p>
          <div className="grid gap-4 md:grid-cols-2">
            {d.cards.map((c) => <CardTile key={c.id} card={c} ask={ask} busy={!!pending} />)}
          </div>
        </Section>}

        {tab === 'security' && <div className="grid items-start gap-8 lg:grid-cols-2">
          <LockPanel />
          <PasskeyPanel setStatus={setStatus} />
        </div>}
      </>}

      {status && (
        <div role="status" className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-40 px-4 pb-4">
          <div className={`card mx-auto flex max-w-xl items-center gap-3 px-4 py-3 ${status.tone === 'err' ? 'text-cinnabar' : ''}`}>
            <span className="min-w-0 flex-1 text-body">{status.text}</span>
            {status.tone !== 'wait' && <button type="button" className="grid h-10 w-10 place-items-center text-ink2" onClick={() => setStatus(null)} aria-label={lang === 'zh' ? '关闭' : 'Dismiss'}>✕</button>}
          </div>
        </div>
      )}
    </main>
  )
}

/** The card itself, small: green for the debit card, dark for the virtual one, grey with a lock when it can't be used. */
function CardFace({ card: c }: { card: BankCard }) {
  const { tr } = useLang()
  const off = c.status === 'frozen' || c.status === 'lost'
  const face = off ? 'linear-gradient(135deg, #8a929c, #6b737d)' : c.kind === 'virtual' ? 'linear-gradient(135deg, #2b2357, #5b3fb8)' : 'var(--hero)'
  return (
    <div className="relative flex h-[76px] w-[120px] shrink-0 flex-col justify-between overflow-hidden rounded-box p-2.5 text-white shadow-[0_6px_16px_var(--shadow)]" style={{ background: face }} aria-hidden>
      <span className="flex items-center justify-between text-[0.62rem] font-bold opacity-90">{tr('Bank Agent', '银行代办')}<span>{c.kind === 'virtual' ? tr('Virtual', '虚拟') : tr('Debit', '借记')}</span></span>
      {c.kind === 'debit' && <span className="h-3.5 w-5 rounded-[3px] bg-[#e9d18c]" />}
      <span className="font-mono text-xs tracking-wider">•••• {c.last4}</span>
      {off && <span className="absolute inset-0 grid place-items-center bg-black/25"><Lock size={20} /></span>}
    </div>
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
    <div className={`card p-5 max-sm:p-4 ${lost ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-4">
        <CardFace card={c} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="font-bold">{c.name} <span className="font-mono text-body font-normal text-ink2">{c.last4}</span></p>
            <Badge tone={c.status === 'active' ? 'green' : c.status === 'frozen' || lost ? 'red' : 'grey'}>{state}</Badge>
          </div>
          <p className="mt-1 text-xs text-ink2">{tr(`Daily limit ${yuan(c.daily_limit_fen)}`, `日限额 ${yuan(c.daily_limit_fen)}`)}</p>
          <p className="text-xs text-ink2">{tr(`Expires ${c.expires}`, `有效期 ${c.expires}`)}</p>
        </div>
      </div>
      {!lost && <>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {switches.map(([key, on, label, word]) => (
            <button key={key} type="button" disabled={busy} aria-pressed={on}
              className={`flex min-h-11 flex-col items-center justify-center rounded-box px-2 py-1.5 text-cap font-semibold leading-tight ${on ? 'bg-[var(--accent-wash)] text-jade' : 'bg-[var(--field)] text-ink2'}`}
              onClick={() => ask(on ? tr(`Turn off ${word} on card ${id}`, `关闭尾号${id}的卡的${word}`) : tr(`Turn on ${word} on card ${id}`, `开通尾号${id}的卡的${word}`))}>
              <span>{label}</span><span className="text-xs font-bold">{on ? tr('On', '已开') : tr('Off', '已关')}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-4">
          {c.status === 'active'
            ? <button type="button" className="btn btn-line px-4 text-sm" disabled={busy} onClick={() => ask(tr(`Freeze card ${id}`, `冻结尾号${id}的卡`))}>{tr('Freeze', '冻结')}</button>
            : <button type="button" className="btn btn-line px-4 text-sm" disabled={busy} onClick={() => ask(tr(`Unfreeze card ${id}`, `解冻尾号${id}的卡`))}>{tr('Unfreeze', '解冻')}</button>}
          <button type="button" className="btn btn-line px-4 text-sm" disabled={busy} onClick={() => ask(tr(`Change the daily limit of card ${id}`, `调整尾号${id}的卡的限额`))}>{tr('Limit', '限额')}</button>
          <button type="button" className="btn btn-cinnabar ml-auto px-4 text-sm" disabled={busy} onClick={() => ask(tr(`Report card ${id} lost`, `挂失尾号${id}的卡`))}>{tr('Report lost', '挂失')}</button>
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
      aside={<Badge tone={locks.length ? 'red' : 'green'}>{locks.length ? tr('On', '已开启') : tr('Off', '未开启')}</Badge>}>
      <div className="card space-y-3 p-5 max-sm:p-4">
        {locks.length === 0 ? <p className="text-sm text-ink2">{tr('Turns on by itself after repeated failed checks or attempts to get around the rules.', '多次验证失败或试图绕过规则时会自动开启。')}</p> : (
          <>
            {locks.map((l) => <Notice key={l.reason} tone="alert">{l.text}</Notice>)}
            {locks.some((l) => l.scope !== 'red') && (
              <form onSubmit={submit} className="grid gap-2">
                <input className="field num tracking-[0.4em]" type="password" inputMode="numeric" maxLength={6} placeholder={tr('Transaction PIN', '交易密码')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label={tr('Transaction PIN', '交易密码')} />
                {user?.demo_pin && (
                  <p className="flex items-center justify-between gap-2 text-xs text-ink2">
                    {tr(`Demo account: the PIN is ${user.demo_pin}`, `演示账户：交易密码是 ${user.demo_pin}`)}
                    <button type="button" className="min-h-10 px-2 font-semibold text-[var(--action)]" onClick={() => setPin(user.demo_pin ?? '')}>{tr('Fill it in', '填入')}</button>
                  </p>
                )}
                {!challenge ? <button type="button" className="btn btn-line" onClick={() => void sendCode()}>{tr('Send a code to my phone', '发送验证码到我的手机')}</button> : <>
                  <input className="field num tracking-[0.4em]" inputMode="numeric" maxLength={6} placeholder={tr('SMS code', '短信验证码')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label={tr('SMS code', '短信验证码')} />
                  {phone.data?.items[0] && <p className="tile px-3 py-2 text-xs">{lang === 'zh' ? phone.data.items[0].text : phone.data.items[0].text_en}</p>}
                  <button className="btn btn-ink" disabled={pin.length !== 6 || code.length !== 6}>{tr('Verify and unlock', '验证并解除')}</button>
                </>}
              </form>
            )}
            {locks.every((l) => l.scope === 'red') && <p className="text-sm text-ink2">{tr('Clears by itself after 30 minutes, or bank staff can lift it.', '30 分钟后自动解除，或由银行工作人员解除。')}</p>}
          </>
        )}
        {message && <p role="status" className="text-sm text-ink2">{message}</p>}
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
      aside={<button type="button" className="btn btn-line px-4 text-sm" disabled={!passkeysSupported()} onClick={() => void add()}>{tr('Add', '添加')}</button>}>
      {keys.data?.items.length
        ? <ul className={LIST}>{keys.data.items.map((k) => <li key={k.id} className="flex justify-between px-4 py-3 text-sm"><span>{k.label || tr('Device', '设备')}</span><span className="font-mono text-xs text-ink2">{k.created_at.slice(0, 10)}</span></li>)}</ul>
        : <p className={EMPTY}>{passkeysSupported() ? tr('Use face or fingerprint unlock instead of an SMS code.', '用面容或指纹代替短信验证码。') : tr('Needs HTTPS and a supported browser.', '需要 HTTPS 和支持的浏览器。')}</p>}
    </Section>
  )
}
