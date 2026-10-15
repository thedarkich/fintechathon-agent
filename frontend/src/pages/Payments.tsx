import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { api, errorText } from '../api/client'
import type { BillerCategory, Provider, SavedBill } from '../api/types'
import { useLang } from '../i18n'
import { Icon, type IconName } from '../components/Icon'
import { PageHead, ServiceTile } from '../components/bits'
import { ScreenConfirm, useScreenPlan } from '../components/ScreenPlan'
import { yuan } from '../lib/format'

const LIST = 'divide-y divide-[var(--rule)] ruled bg-field'
const PHONE = /^1[3-9]\d{9}$/


/** Where a saved bill stands this month, in a few words. */
function BillState({ bill }: { bill: SavedBill }) {
  const { tr } = useLang()
  if (bill.provider.category === 'mobile') return <span className="text-sm text-ink2">{tr('Top up', '充值')}</span>
  if (bill.due_fen) {
    return bill.autopay && bill.next_autopay_on
      ? <span className="text-right"><span className="num block font-mono font-semibold">{yuan(bill.due_fen)}</span><span className="block text-xs text-jade">{tr(`pays itself ${bill.next_autopay_on.slice(5)}`, `${bill.next_autopay_on.slice(5)} 自动缴`)}</span></span>
      : <span className="text-right"><span className="num block font-mono font-semibold">{yuan(bill.due_fen)}</span><span className="block text-xs font-semibold text-cinnabar">{tr('due', '待缴')}</span></span>
  }
  return <span className="text-sm text-jade">{bill.autopay ? tr('Paid · automatic', '已缴清 · 自动缴费') : tr('Paid', '已缴清')}</span>
}

/** Bills and top-ups: pick what to pay, see what is due, pay it or let it pay itself up to a limit. */
export default function Payments() {
  const { tr, lang } = useLang()
  const [params, setParams] = useSearchParams()
  const catalogue = useQuery({ queryKey: ['billers', lang], queryFn: () => api.billers(lang), staleTime: 300_000 })
  const bills = useQuery({ queryKey: ['bills', lang], queryFn: () => api.bills(lang) })
  const [search, setSearch] = useState('')
  const categories = catalogue.data?.categories ?? []
  const providerCode = params.get('p')
  const category = categories.find((c) => c.code === params.get('c')) ?? categories.find((c) => c.providers.some((p) => p.code === providerCode))
  const icons = Object.fromEntries(categories.map((c) => [c.code, c.icon]))
  const open = (c: BillerCategory, p?: Provider, account?: string) =>
    setParams({ c: c.code, ...(p ? { p: p.code } : {}), ...(account ? { a: account } : {}) })

  if (category) {
    const provider = category.providers.find((p) => p.code === providerCode) ?? category.providers[0]
    return (
      <main tabIndex={-1} className="page-content">
        <button type="button" onClick={() => setParams({})} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--action)]"><ChevronLeft size={16} />{tr('Payments', '缴费')}</button>
        <PageHead title={category.name} />
        <PayForm key={`${provider.code}:${params.get('a') ?? ''}`} category={category} provider={provider}
          saved={(bills.data?.items ?? []).filter((b) => b.provider.code === provider.code)}
          initial={params.get('a') ?? ''} onProvider={(p) => open(category, p)} />
      </main>
    )
  }

  const matches = search.trim()
    ? categories.flatMap((c) => c.providers.filter((p) => `${p.name}${c.name}`.toLowerCase().includes(search.trim().toLowerCase())).map((p) => ({ c, p })))
    : []
  return (
    <main tabIndex={-1} className="page-content">
      <PageHead title={tr('Payments', '缴费')} />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-6">
          <label className="flex items-center gap-2 rounded-box border border-rule2 bg-field px-4 focus-within:border-[var(--action)]">
            <Search size={18} className="text-ink2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('Search: electricity, China Mobile…', '搜索：电费、中国移动…')} aria-label={tr('Search providers', '搜索缴费单位')}
              className="min-w-0 flex-1 bg-transparent py-2.5 outline-none focus-visible:outline-none" />
          </label>
          {search.trim() ? (
            matches.length ? (
              <ul className={LIST}>
                {matches.map(({ c, p }) => (
                  <li key={p.code}><button type="button" onClick={() => open(c, p)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sheet">
                    <Icon name={c.icon as IconName} size={18} className="text-[var(--action)]" /><span className="flex-1 font-semibold">{p.name}</span><span className="text-sm text-ink2">{c.name}</span>
                  </button></li>
                ))}
              </ul>
            ) : <p className="ruled bg-field px-4 py-4 text-sm text-ink2">{tr('Nothing matches.', '没有找到。')}</p>
          ) : (
            <nav aria-label={tr('Kinds of payment', '缴费类别')} className="service-panel">
              {categories.map((c) => <ServiceTile key={c.code} icon={c.icon as IconName} label={c.name} onClick={() => open(c)} />)}
            </nav>
          )}
        </div>

        <section>
          <h2 className="mb-2 text-xl font-bold">{tr('My payments', '我的缴费')}</h2>
          {!bills.data ? <div className="h-40 animate-pulse rounded-box bg-paper2" aria-hidden /> : !bills.data.items.length ? (
            <p className="ruled bg-field px-4 py-4 text-sm text-ink2">{tr('Bills you pay and save show up here.', '缴费时选择“保存”，下次就会出现在这里。')}</p>
          ) : (
            <ul className={LIST}>
              {bills.data.items.map((b) => (
                <li key={b.id}>
                  <button type="button" onClick={() => { const c = categories.find((x) => x.code === b.provider.category); if (c) open(c, b.provider, b.account) }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sheet">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-wash)] text-[var(--action)]"><Icon name={(icons[b.provider.category] ?? 'receipt') as IconName} size={20} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{b.provider.name}</span>
                      <span className="block truncate text-xs text-ink2">{b.label ? `${b.label} · ` : ''}<span className="font-mono">{b.account}</span></span></span>
                    <BillState bill={b} />
                    <ChevronRight size={16} className="shrink-0 text-ink2" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink2">{tr('Automatic payments never pay more than the limit you set: a bigger bill waits for you.', '自动缴费不会超过你设的上限：账单更大时会提醒你手动缴。')}</p>
        </section>
      </div>
    </main>
  )
}

function PayForm({ category, provider, saved, initial, onProvider }: { category: BillerCategory; provider: Provider; saved: SavedBill[]; initial: string; onProvider: (p: Provider) => void }) {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const flow = useScreenPlan()
  const mobile = category.code === 'mobile'
  const [account, setAccount] = useState(initial)
  const [checked, setChecked] = useState(initial && !mobile ? initial : '')
  const [topUp, setTopUp] = useState<number | null>(null)
  const [custom, setCustom] = useState('')
  const [save, setSave] = useState(true)
  const [limit, setLimit] = useState('300')
  const [removeError, setRemoveError] = useState('')
  const lookup = useQuery({
    queryKey: ['bills', 'lookup', provider.code, checked, lang], queryFn: () => api.billLookup(provider.code, checked, lang),
    enabled: !!checked && provider.billed, retry: false,
  })
  const bill = lookup.data
  useEffect(() => { if (bill?.autopay_limit_fen) setLimit(String(bill.autopay_limit_fen / 100)) }, [bill?.autopay_limit_fen])
  const amount = topUp ?? (Number(custom) > 0 ? Number(custom) : null)
  const isSaved = saved.some((s) => s.account === (mobile ? account : checked))
  const again = () => { flow.reset(); setTopUp(null); setCustom('') }

  const check = (e: FormEvent) => { e.preventDefault(); if (account.trim()) setChecked(account.trim().toUpperCase().replace(/\s/g, '')) }
  const remove = async (id: string) => {
    setRemoveError('')
    try {
      await api.removeBill(id)
      await qc.invalidateQueries({ queryKey: ['bills'] })
    } catch (err) {
      setRemoveError(errorText(err, lang))
    }
  }

  if (flow.planId) return <div className="max-w-xl"><ScreenConfirm planId={flow.planId} again={tr('Done', '完成')} onAgain={again} /></div>

  return (
    <div className="max-w-xl space-y-5">
      {category.providers.length > 1 && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tr('Provider', '缴费单位')}>
          {category.providers.map((p) => (
            <button key={p.code} type="button" role="radio" aria-checked={p.code === provider.code} onClick={() => onProvider(p)}
              className={`rounded-full border px-4 py-1.5 text-[0.93rem] ${p.code === provider.code ? 'border-[var(--action)] bg-[var(--accent-wash)] font-semibold text-[var(--action)]' : 'border-rule bg-field'}`}>{p.name}</button>
          ))}
        </div>
      )}

      {saved.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {saved.map((s) => (
            <button key={s.id} type="button" onClick={() => { setAccount(s.account); if (!mobile) setChecked(s.account) }}
              className="rounded-full border border-rule bg-field px-3 py-1 font-mono text-sm hover:border-[var(--action)]">{s.label ? `${s.label} ` : ''}{s.account}</button>
          ))}
        </div>
      )}

      <form onSubmit={check} className="flex gap-2">
        <input value={account} onChange={(e) => { setAccount(e.target.value); if (mobile) setChecked('') }} aria-label={provider.account_label}
          placeholder={mobile ? '139 1234 5678' : category.code === 'fines' ? tr('Plate, e.g. 鄂A12345', '车牌号，例如 鄂A12345') : provider.account_label}
          inputMode={category.code === 'fines' ? 'text' : 'numeric'} autoComplete="off"
          className="num min-w-0 flex-1 rounded-box border border-rule2 bg-field px-4 py-2.5 font-mono text-[1.05rem] outline-none focus:border-[var(--action)]" />
        {!mobile && <button className="btn btn-ink px-5" disabled={!account.trim() || lookup.isFetching}>{tr('Check', '查询')}</button>}
      </form>

      {mobile ? (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {(provider.top_ups ?? []).map((n) => (
              <button key={n} type="button" onClick={() => { setTopUp(n); setCustom('') }}
                className={`rounded-box border py-3 font-mono text-lg font-bold ${topUp === n ? 'border-[var(--action)] bg-[var(--accent-wash)] text-[var(--action)]' : 'border-rule bg-field'}`}>¥{n}</button>
            ))}
          </div>
          <input value={custom} onChange={(e) => { setCustom(e.target.value.replace(/[^\d]/g, '').slice(0, 3)); setTopUp(null) }} inputMode="numeric"
            placeholder={tr('Other amount, up to ¥500', '其他金额，最多 ¥500')} aria-label={tr('Other amount', '其他金额')}
            className="w-full rounded-box border border-rule2 bg-field px-4 py-2.5 outline-none focus:border-[var(--action)]" />
          {!isSaved && PHONE.test(account.replace(/\s/g, '')) && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />{tr('Save this number to My payments', '保存到“我的缴费”')}</label>
          )}
          {flow.error && <p role="alert" className="text-sm font-semibold text-cinnabar">{flow.error}</p>}
          <button type="button" className="btn btn-ink w-full py-3 text-base" disabled={!PHONE.test(account.replace(/\s/g, '')) || !amount || flow.busy}
            onClick={() => void flow.start('bill_pay', { provider: provider.code, account: account.replace(/\s/g, ''), amount_yuan: amount, save: save && !isSaved })}>
            {amount ? tr(`Top up ¥${amount}`, `充值 ¥${amount}`) : tr('Top up', '充值')}
          </button>
        </div>
      ) : <>
        {lookup.isFetching && <div className="h-36 animate-pulse rounded-box bg-paper2" aria-hidden />}
        {lookup.isError && <p role="alert" className="text-sm font-semibold text-cinnabar">{errorText(lookup.error, lang)}</p>}
        {bill && !lookup.isFetching && (
          <div className="space-y-4">
            <dl className="divide-y divide-[var(--rule)] ruled bg-field px-4 text-[0.95rem]">
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-ink2">{provider.account_label}</dt><dd className="font-mono">{bill.account}</dd></div>
              {bill.holder && <div className="flex justify-between gap-4 py-2.5"><dt className="text-ink2">{tr('Name on the bill', '户名')}</dt><dd className="font-semibold">{bill.holder}</dd></div>}
              {bill.period && <div className="flex justify-between gap-4 py-2.5"><dt className="text-ink2">{tr('Bill', '账单')}</dt><dd>{lang === 'zh' ? `${bill.period.slice(0, 4)}年${Number(bill.period.slice(5))}月` : bill.period}</dd></div>}
              {bill.detail && <div className="flex justify-between gap-4 py-2.5"><dt className="text-ink2">{tr('Offence', '违法行为')}</dt><dd className="text-right">{bill.detail}</dd></div>}
              <div className="flex items-baseline justify-between gap-4 py-3"><dt className="text-ink2">{tr('Due', '待缴')}</dt>
                <dd className={`num font-mono text-2xl font-bold ${bill.due_fen ? '' : 'text-jade'}`}>{bill.due_fen ? yuan(bill.due_fen) : category.code === 'fines' ? tr('No fines', '没有罚款') : tr('Paid', '已缴清')}</dd></div>
            </dl>
            {bill.holder && <p className="-mt-2 text-xs text-ink2">{tr('Check the name on the bill: a wrong account number pays someone else’s bill.', '请核对户名：户号输错会替别人缴费。')}</p>}
            {!!bill.due_fen && <>
              {!bill.saved_id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />{tr('Save to My payments', '保存到“我的缴费”')}</label>}
              {flow.error && <p role="alert" className="text-sm font-semibold text-cinnabar">{flow.error}</p>}
              <button type="button" className="btn btn-ink w-full py-3 text-base" disabled={flow.busy}
                onClick={() => void flow.start('bill_pay', { provider: provider.code, account: bill.account, save: save && !bill.saved_id })}>
                {tr(`Pay ${yuan(bill.due_fen)}`, `缴费 ${yuan(bill.due_fen)}`)}
              </button>
            </>}

            {category.code !== 'fines' && (
              <div className="ruled bg-field px-4 py-3">
                <p className="font-semibold">{tr('Automatic payment', '自动缴费')}</p>
                {bill.autopay ? <>
                  <p className="mt-1 text-sm text-ink2">{tr(`On: each bill up to ${yuan(bill.autopay_limit_fen ?? 0)} is paid on ${bill.next_autopay_on?.slice(5) ?? ''} every month.`, `已开通：每月账单不超过 ${yuan(bill.autopay_limit_fen ?? 0)} 时自动缴，下次 ${bill.next_autopay_on ?? ''}。`)}</p>
                  <button type="button" className="btn btn-line mt-3 py-1.5 text-sm" disabled={flow.busy}
                    onClick={() => void flow.start('bill_autopay', { provider: provider.code, account: bill.account, on: false })}>{tr('Turn off', '关闭')}</button>
                </> : <>
                  <p className="mt-1 text-sm text-ink2">{tr('Pay this bill every month by itself, but never more than:', '每月自动缴这张账单，但不超过：')}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="font-mono text-ink2">¥</span>
                    <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, '').slice(0, 4))} inputMode="numeric" aria-label={tr('Monthly limit', '每月上限')}
                      className="num w-24 rounded-box border border-rule2 bg-paper px-3 py-1.5 font-mono outline-none focus:border-[var(--action)]" />
                    <button type="button" className="btn btn-line py-1.5 text-sm" disabled={flow.busy || !(Number(limit) > 0)}
                      onClick={() => void flow.start('bill_autopay', { provider: provider.code, account: bill.account, on: true, limit_yuan: Number(limit) })}>{tr('Turn on', '开通')}</button>
                  </div>
                </>}
              </div>
            )}
            {bill.saved_id && (
              <button type="button" className="text-sm font-semibold text-ink2 hover:text-cinnabar" onClick={() => void remove(bill.saved_id!)}>
                {tr('Remove from My payments', '从“我的缴费”移除')}{bill.autopay ? tr(' (stops automatic payment)', '（同时停止自动缴费）') : ''}
              </button>
            )}
            {removeError && <p role="alert" className="text-sm font-semibold text-cinnabar">{removeError}</p>}
          </div>
        )}
      </>}
    </div>
  )
}
