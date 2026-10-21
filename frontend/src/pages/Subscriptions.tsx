import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { Badge, EMPTY, LIST, Notice, PageHead, Section, StatTile } from '../components/bits'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'

/** Card 05, subscriptions and direct debits: what renews when, the next charge, and services you pay for twice. */
export default function Subscriptions() {
  const { tr, lang } = useLang()
  const { send, pending } = useChat()
  const subs = useQuery({ queryKey: ['subscriptions', lang], queryFn: () => api.subscriptions(lang) })
  const ask = (text: string) => void send(text)
  const active = (subs.data?.items ?? []).filter((s) => s.status === 'active').sort((a, b) => a.next_charge_on.localeCompare(b.next_charge_on))
  const next = active[0]
  const overlaps = subs.data?.overlaps ?? []
  const group = (g: string) => (g === 'music' ? tr('music', '音乐') : tr('video', '视频'))

  return (
    <main tabIndex={-1} className="page-content scope-subs">
      <PageHead title={tr('Subscriptions', '自动续费')}
        right={<button type="button" className="btn btn-ink px-5" disabled={!!pending} onClick={() => ask(tr('What am I paying for every month?', '我有哪些自动续费'))}>{tr('Ask the assistant', '让助手看看')}</button>} />
      {!subs.data ? <div className="h-64 animate-pulse rounded-box bg-paper2" /> : <>
        <div className="stat-grid grid gap-4 max-sm:gap-3 sm:grid-cols-3">
          <StatTile icon="wallet" label={tr('Each month, about', '每月约')} value={yuan(subs.data.monthly_fen)} />
          <StatTile icon="bell" label={tr('Renewing automatically', '正在自动扣费')} value={active.length} sub={tr('services', '个服务')} />
          <StatTile icon="flag" tint={overlaps.length ? 'red' : 'scope'} label={tr('Paid for twice', '重复订阅')} value={overlaps.length}
            sub={overlaps.length ? tr('kinds of service', '类服务重复') : tr('nothing doubled', '没有重复')} valueClass={overlaps.length ? 'text-cinnabar' : ''} />
        </div>

        {next && (
          <Notice tone="highlight" icon="clock" className="mt-6"
            title={tr(`Next charge: ${next.merchant}, ${yuan(next.fen)} on ${next.next_charge_on}`, `下次扣费：${next.merchant}，${next.next_charge_on} 扣 ${yuan(next.fen)}`)}
            action={!next.remind_days_before && <button type="button" className="btn btn-line bg-[var(--card)] px-4 text-sm" disabled={!!pending} onClick={() => ask(tr(`Remind me 3 days before ${next.merchant} renews`, `${next.merchant}续费前3天提醒我`))}>{tr('Remind me', '提前提醒')}</button>}>
            {next.remind_days_before ? tr(`You’ll get a reminder ${next.remind_days_before} days before.`, `会提前 ${next.remind_days_before} 天提醒你。`) : tr('Not using it? Cancel before then.', '不用了？在那之前取消即可。')}
          </Notice>
        )}
        {overlaps.map((o) => (
          <Notice key={o.group} tone="alert" className="mt-3" title={tr(`You pay for ${o.merchants.length} ${group(o.group)} services`, `你同时订阅了 ${o.merchants.length} 个${group(o.group)}会员`)}
            action={<button type="button" className="btn btn-line bg-[var(--card)] px-4 text-sm text-cinnabar" disabled={!!pending} onClick={() => ask(tr('What am I paying for every month?', '我有哪些自动续费'))}>{tr('Sort it out', '处理一下')}</button>}>
            {o.merchants.join(lang === 'zh' ? '、' : ', ')}
          </Notice>
        ))}

        <Section title={tr('Automatic payments', '自动扣费')} className="mt-8">
          {!active.length ? <p className={EMPTY}>{tr('No active subscriptions.', '没有正在扣费的订阅。')}</p> : (
            <ul className={LIST}>
              {active.map((s) => (
                <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{s.merchant}{s.new && <Badge tone="amber" className="ml-2">{tr('new', '近期开通')}</Badge>}</p>
                    <p className="text-xs text-ink2">{s.cycle === 'monthly' ? tr('monthly', '每月') : tr('yearly', '每年')} · {tr(`next ${s.next_charge_on}`, `下次 ${s.next_charge_on}`)}{s.remind_days_before ? tr(` · reminder ${s.remind_days_before} days before`, ` · 提前 ${s.remind_days_before} 天提醒`) : ''}</p>
                  </div>
                  <span className="num font-semibold">{yuan(s.fen)}</span>
                  <span className="col-span-2 inline-flex justify-end gap-2 sm:col-span-1">
                    <button type="button" className="btn btn-line px-4 text-sm" disabled={!!pending} onClick={() => ask(tr(`Remind me 3 days before ${s.merchant} renews`, `${s.merchant}续费前3天提醒我`))}>{tr('Remind', '提醒')}</button>
                    <button type="button" className="btn btn-cinnabar px-4 text-sm" disabled={!!pending} onClick={() => ask(tr(`Cancel ${s.merchant}`, `取消${s.merchant}`))}>{tr('Cancel', '取消')}</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </>}
    </main>
  )
}
