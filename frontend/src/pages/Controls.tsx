import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { api, errorText } from '../api/client'
import type { BankCard } from '../api/types'
import { useLang } from '../i18n'
import { Figure, Panel, TierTag } from '../components/bits'
import { Icon } from '../components/Icon'
import { usePhone } from '../components/Verify'
import { useOverview } from '../lib/bank'
import { useChat } from '../lib/chat'
import { stamp, yuan } from '../lib/format'
import { createPasskey, passkeysSupported } from '../lib/passkey'

export default function Controls() {
  const { tr, lang } = useLang()
  const overview = useOverview()
  const { send, pending } = useChat()
  const location = useLocation()
  const subs = useQuery({ queryKey: ['subscriptions', lang], queryFn: () => api.subscriptions(lang) })
  const keys = useQuery({ queryKey: ['passkeys'], queryFn: api.passkeys })
  const [status, setStatus] = useState<{ tone: 'ok' | 'err' | 'wait'; text: string } | null>(null)
  useEffect(() => { if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView() }, [location.hash])
  const d = overview.data
  const ask = (text: string) => void send(text)
  const activeCards = d?.cards.filter((c) => c.status === 'active').length ?? 0

  return (
    <main tabIndex={-1} className="page-content ">
      <h1 className="cond text-[2.4rem] font-extrabold leading-tight">{tr('Cards & controls', '卡片与控制台')}</h1>
      <p className="max-w-[44rem] text-ink2">{tr('Making a card safer needs one confirmation. Anything that makes it more usable again needs strong verification. Each button asks the assistant, so the change goes through the same rules and lands in your ledger.', '让卡片更安全只需一次确认；让它重新可用的操作需要强验证。每个按钮都会交给助手办理，同样经过规则检查并记入账本。')}</p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5"><TierTag tier="yellow" /> {tr('one confirmation', '确认一次')}</span>
        <span className="flex items-center gap-1.5"><TierTag tier="red" /> {tr('PIN plus an SMS code or passkey', '交易密码加短信验证码或通行密钥')}</span>
        <span className="flex items-center gap-1.5"><TierTag tier="green" /> {tr('runs at once (read-only)', '立即执行（只读）')}</span>
      </div>

      {!d ? <div className="mt-6 h-64 animate-pulse rounded-box bg-paper2" /> : (
        <div className="mt-6 space-y-6">
          <section aria-label={tr('Overview', '概览')}><dl className="metric-grid">
            <Figure label={tr('Cards', '卡片')} value={`${activeCards} / ${d.cards.length}`} unit={tr('active', '正常')} icon={<Icon name="card" size={17} />} />
            <Figure label={tr('Safety lock', '安全锁')} value={d.locks.length ? tr('On', '已开启') : tr('Off', '未开启')} color={d.locks.length ? 'var(--cinnabar)' : 'var(--jade)'} icon={<Icon name="lock" size={17} />} />
            <Figure label={tr('Subscriptions', '自动续费')} value={subs.data ? yuan(subs.data.monthly_fen) : '—'} unit={tr('/ month', '/月')} icon={<Icon name="clock" size={17} />} />
            <Figure label={tr('Passkeys', '通行密钥')} value={String(keys.data?.items.length ?? 0)} icon={<Icon name="shield" size={17} />} />
          </dl></section>

          <Panel title={tr('Cards', '卡片')} note={tr('Freeze, switches and limits. Reporting a card lost is permanent and orders a replacement.', '冻结、开关和限额。挂失是永久的，并会补发新卡。')}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] border-collapse text-left text-[0.93rem]">
                <thead>
                  <tr className="rule-b bg-paper text-[0.84rem] text-rule2">
                    <th className="px-4 py-2 font-normal">{tr('Card', '卡片')}</th>
                    <th className="px-3 py-2 font-normal">{tr('State', '状态')}</th>
                    <th className="px-3 py-2 text-right font-normal">{tr('Daily limit', '日限额')}</th>
                    {[tr('Online', '网上支付'), tr('Overseas', '境外支付'), 'ATM', tr('Contactless', '闪付')].map((h) => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}
                    <th className="px-4 py-2 text-right font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {d.cards.map((c) => <CardRow key={c.id} card={c} ask={ask} busy={!!pending} />)}
                </tbody>
              </table>
            </div>
            <div className="border-t border-rule px-4 py-3">
              <button type="button" className="btn btn-line py-1.5" disabled={!!pending} onClick={() => ask(tr('Apply for a virtual card for online shopping', '申请一张网购用的虚拟卡'))}>{tr('Apply for a virtual card', '申请虚拟卡')} <TierTag tier="yellow" /></button>
            </div>
          </Panel>

          <Panel title={tr('Subscriptions and direct debits', '自动续费与代扣')} note={tr('Found by fixed rules in your transactions: the same amount to the same merchant every month or year.', '由固定规则从交易中找出：每月或每年向同一商户扣同样的金额。')}>
            {!subs.data ? <div className="m-4 h-24 animate-pulse rounded-box bg-paper2" /> : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[44rem] border-collapse text-left text-[0.93rem]">
                    <thead><tr className="rule-b bg-paper text-[0.84rem] text-rule2"><th className="px-4 py-2 font-normal">{tr('Merchant', '商户')}</th><th className="px-3 py-2 font-normal">{tr('Cycle', '周期')}</th><th className="px-3 py-2 font-normal">{tr('Next charge', '下次扣费')}</th><th className="px-3 py-2 text-right font-normal">{tr('Amount', '金额')}</th><th className="px-4 py-2 text-right font-normal" /></tr></thead>
                    <tbody>
                      {subs.data.items.map((s) => (
                        <tr key={s.id} className={`rule-b align-top last:border-b-0 ${s.status === 'cancelled' ? 'text-ink2' : ''}`}>
                          <td className="px-4 py-2.5">{s.merchant}{s.new && <span className="ml-2 whitespace-nowrap rounded-box border border-rule px-1.5 py-0.5 text-xs text-ink2">{tr('started recently', '近期开通')}</span>}{s.status === 'cancelled' && <span className="ml-2 text-xs">{tr('cancelled', '已取消')}</span>}</td>
                          <td className="px-3 py-2.5 text-ink2">{s.cycle === 'monthly' ? tr('monthly', '每月') : tr('yearly', '每年')}</td>
                          <td className="num px-3 py-2.5 font-mono text-[0.85rem]">{s.next_charge_on}</td>
                          <td className="num px-3 py-2.5 text-right font-mono">{yuan(s.fen)}</td>
                          <td className="px-4 py-2 text-right">{s.status === 'active' && <span className="inline-flex gap-2">
                            <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={!!pending} onClick={() => ask(tr(`Remind me 3 days before ${s.merchant} renews`, `${s.merchant}续费前3天提醒我`))}>{tr('Remind', '提醒')}</button>
                            <button type="button" className="btn btn-cinnabar py-1 text-[0.85rem]" disabled={!!pending} onClick={() => ask(tr(`Cancel ${s.merchant}`, `取消${s.merchant}`))}>{tr('Cancel', '取消')}</button>
                          </span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {subs.data.overlaps.length > 0 && <p className="border-t border-rule px-4 py-3 text-sm text-ink2">{subs.data.overlaps.map((o) => tr(`You pay for ${o.merchants.length} ${o.group} services: ${o.merchants.join(', ')}.`, `你同时订阅了 ${o.merchants.length} 个${o.group === 'music' ? '音乐' : '视频'}会员：${o.merchants.join('、')}。`)).join(' ')}</p>}
              </>
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <LockPanel />
            <PasskeyPanel setStatus={setStatus} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <PhonePanel />
            <DemoPanel setStatus={setStatus} />
          </div>
        </div>
      )}

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

function CardRow({ card: c, ask, busy }: { card: BankCard; ask: (t: string) => void; busy: boolean }) {
  const { tr } = useLang()
  const id = c.last4
  const lost = c.status === 'lost'
  const switches = [
    ['online', c.online, tr('online payments', '网上支付')],
    ['overseas', c.overseas, tr('overseas payments', '境外支付')],
    ['atm', c.atm, tr('ATM withdrawals', 'ATM 取现')],
    ['contactless', c.contactless, tr('contactless', '闪付')],
  ] as const
  const state = { active: tr('Active', '正常'), frozen: tr('Frozen', '已冻结'), lost: tr('Reported lost', '已挂失'), pending: tr('On its way', '寄送中') }[c.status]
  return (
    <tr className={`rule-b align-top last:border-b-0 ${lost ? 'text-ink2' : ''}`}>
      <td className="px-4 py-2.5">{c.name} <span className="font-mono text-[0.85rem] text-ink2">****{c.last4}</span><span className="block text-xs text-ink2">{tr('expires', '有效期')} {c.expires}</span></td>
      <td className="px-3 py-2.5"><span className={`font-semibold ${c.status === 'active' ? 'text-jade' : c.status === 'frozen' || lost ? 'text-cinnabar' : 'text-ink2'}`}>{state}</span></td>
      <td className="num px-3 py-2.5 text-right font-mono">{yuan(c.daily_limit_fen)}</td>
      {switches.map(([key, on, word]) => (
        <td key={key} className="px-3 py-2">
          <button type="button" disabled={busy || lost} title={on ? tr(`Turn off ${word}`, `关闭${word}`) : tr(`Turn on ${word}`, `开通${word}`)}
            className={`rounded-[2px] px-2 py-0.5 text-[0.78rem] font-semibold ${on ? 'bg-ink text-field' : 'border border-rule text-ink2'}`}
            onClick={() => ask(on ? tr(`Turn off ${word} on card ${id}`, `关闭尾号${id}的卡的${word}`) : tr(`Turn on ${word} on card ${id}`, `开通尾号${id}的卡的${word}`))}>
            {on ? tr('on', '开') : tr('off', '关')}
          </button>
        </td>
      ))}
      <td className="px-4 py-2 text-right">
        {!lost && <span className="inline-flex flex-wrap justify-end gap-2">
          {c.status === 'active'
            ? <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={busy} onClick={() => ask(tr(`Freeze card ${id}`, `冻结尾号${id}的卡`))}>{tr('Freeze', '冻结')}</button>
            : <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={busy} onClick={() => ask(tr(`Unfreeze card ${id}`, `解冻尾号${id}的卡`))}>{tr('Unfreeze', '解冻')}</button>}
          <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={busy} onClick={() => ask(tr(`Change the daily limit of card ${id}`, `调整尾号${id}的卡的限额`))}>{tr('Limit', '限额')}</button>
          <button type="button" className="btn btn-cinnabar py-1 text-[0.85rem]" disabled={busy} onClick={() => ask(tr(`Report card ${id} lost`, `挂失尾号${id}的卡`))}>{tr('Report lost', '挂失')}</button>
        </span>}
      </td>
    </tr>
  )
}

function LockPanel() {
  const { tr, lang } = useLang()
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
    <Panel id="security" title={tr('Safety lock', '安全锁')} note={tr('Turns on by itself after repeated failed checks, attempts to get around the rules, or many payments to new payees.', '多次验证失败、试图绕过规则或短时间内多次向新收款人付款时自动开启。')}>
      <div className="p-4">
        {locks.length === 0 ? <p className="font-semibold text-jade">{tr('No lock is on.', '当前没有安全锁。')}</p> : (
          <>
            {locks.map((l) => <p key={l.reason} className="border-l-2 border-cinnabar bg-field px-3 py-2 text-[0.95rem]">{l.text}</p>)}
            {locks.some((l) => l.scope !== 'red') && (
              <form onSubmit={submit} className="mt-3 grid gap-2">
                <input className="field num tracking-[0.4em]" type="password" inputMode="numeric" maxLength={6} placeholder={tr('Transaction PIN', '交易密码')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label={tr('Transaction PIN', '交易密码')} />
                {!challenge ? <button type="button" className="btn btn-line py-1.5" onClick={() => void sendCode()}>{tr('Send a code to my phone', '发送验证码到我的手机')}</button> : <>
                  <input className="field num tracking-[0.4em]" inputMode="numeric" maxLength={6} placeholder={tr('SMS code', '短信验证码')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label={tr('SMS code', '短信验证码')} />
                  {phone.data?.items[0] && <p className="border-l-2 border-ink2 bg-paper px-3 py-2 text-xs">{tr('Simulated phone: ', '模拟手机：')}{lang === 'zh' ? phone.data.items[0].text : phone.data.items[0].text_en}</p>}
                  <button className="btn btn-ink py-1.5" disabled={pin.length !== 6 || code.length !== 6}>{tr('Verify and unlock', '验证并解除')}</button>
                </>}
              </form>
            )}
            {locks.every((l) => l.scope === 'red') && <p className="mt-2 text-sm text-ink2">{tr('A lock after failed verifications clears by itself after 30 minutes, or a bank operator can lift it.', '因验证失败触发的锁 30 分钟后自动解除，也可由银行工作人员解除。')}</p>}
          </>
        )}
        {message && <p role="status" className="mt-2 text-sm text-ink2">{message}</p>}
      </div>
    </Panel>
  )
}

function PasskeyPanel({ setStatus }: { setStatus: (s: { tone: 'ok' | 'err' | 'wait'; text: string } | null) => void }) {
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
    <Panel title={tr('Passkeys', '通行密钥')} note={tr('Face or fingerprint unlock on your device, or a security key, instead of an SMS code.', '用设备的面容或指纹解锁，或安全密钥，代替短信验证码。')}>
      <div className="p-4">
        {keys.data?.items.length ? <ul className="mb-3 divide-y divide-rule ruled">{keys.data.items.map((k) => <li key={k.id} className="flex justify-between px-3 py-2 text-sm"><span>{k.label || tr('Device', '设备')}</span><span className="font-mono text-xs text-ink2">{k.created_at.slice(0, 10)}</span></li>)}</ul> : <p className="mb-3 text-sm text-ink2">{tr('No passkey yet.', '还没有通行密钥。')}</p>}
        <button type="button" className="btn btn-ink py-1.5" disabled={!passkeysSupported()} onClick={() => void add()}>{tr('Add a passkey', '添加通行密钥')}</button>
        {!passkeysSupported() && <p className="mt-2 text-xs text-ink2">{tr('Passkeys need HTTPS (or localhost) and a supported browser.', '通行密钥需要 HTTPS（或 localhost）和支持的浏览器。')}</p>}
      </div>
    </Panel>
  )
}

function PhonePanel() {
  const { tr, lang } = useLang()
  const phone = usePhone(true)
  return (
    <Panel title={tr('Simulated phone', '模拟手机')} note={tr('The SMS a real bank would send to your phone. Codes include what they approve.', '真实银行会发到你手机上的短信。验证码会写明它用于哪项操作。')}>
      <div className="p-4">
        <p className="mb-2 font-mono text-xs text-ink2">{phone.data?.number}</p>
        {!phone.data?.items.length ? <p className="text-sm text-ink2">{tr('No messages yet.', '暂无短信。')}</p> : (
          <ol className="max-h-72 space-y-2 overflow-y-auto">
            {phone.data.items.map((m) => <li key={m.id} className="rounded-box border border-rule bg-sheet px-3 py-2 text-[0.85rem] leading-relaxed">{lang === 'zh' ? m.text : m.text_en}<span className="mt-1 block font-mono text-[0.72rem] text-ink2">{stamp(m.at)}</span></li>)}
          </ol>
        )}
      </div>
    </Panel>
  )
}

function DemoPanel({ setStatus }: { setStatus: (s: { tone: 'ok' | 'err' | 'wait'; text: string } | null) => void }) {
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
    <Panel title={tr('Demo tools', '演示工具')} note={tr('Move the bank’s clock forward to watch scheduled steps run, subscriptions renew and friends pay their share.', '把银行时钟往前拨，可以看到预约步骤执行、订阅续费和朋友付 AA 款。')}>
      <div className="p-4">
        <p className="text-sm text-ink2">{tr('Bank clock', '银行时钟')}</p>
        <p className="num cond text-[1.8rem] font-bold leading-tight">{clock.data ? stamp(clock.data.now) : '—'}</p>
        <p className="text-xs text-ink2">{days ? tr(`${days} days ahead of real time`, `比真实时间快 ${days} 天`) : tr('Real time', '与真实时间一致')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {([[0, 1, tr('+1 hour', '+1 小时')], [1, 0, tr('+1 day', '+1 天')], [7, 0, tr('+7 days', '+7 天')], [30, 0, tr('+30 days', '+30 天')]] as const).map(([d, h, label]) => (
            <button key={label} type="button" className="btn btn-line py-1.5" disabled={busy} onClick={() => void run(() => api.advance(d, h, lang), tr('Time moved forward.', '时间已前进。'))}>{label}</button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-4">
          <button type="button" className="btn btn-line py-1.5" disabled={busy} onClick={() => void newConversation()}>{tr('New conversation', '新对话')}</button>
          <button type="button" className="btn btn-cinnabar py-1.5" disabled={busy} onClick={() => window.confirm(tr('Reset your demo bank to its starting data? The ledger is kept.', '把演示银行恢复到初始数据？账本会保留。')) && void run(api.reset, tr('Demo bank reset.', '演示银行已重置。'))}>{tr('Reset demo bank', '重置演示银行')}</button>
        </div>
        {here && !/localhost|127\.0\.0\.1/.test(here) && (
          <div className="mt-4 flex items-center gap-4 border-t border-rule pt-4">
            <div className="w-fit shrink-0 bg-[#fff] p-2 ruled"><QRCodeSVG value={here} size={88} bgColor="#ffffff" fgColor="#1d2836" level="M" marginSize={0} /></div>
            <p className="text-sm text-ink2">{tr('Open the bank on your phone.', '用手机打开这个银行。')}<span className="mt-1 block break-all font-mono text-xs">{here.replace(/^https?:\/\//, '')}</span></p>
          </div>
        )}
      </div>
    </Panel>
  )
}
