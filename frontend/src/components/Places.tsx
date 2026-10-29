import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LocateFixed, MapPin, Phone, Star } from 'lucide-react'
import { api, errorText } from '../api/client'
import type { Card, Place, PlaceSource, Plan as PlanData } from '../api/types'
import { useLang } from '../i18n'
import { usePlan } from './PlanView'
import { ScreenConfirm, useScreenPlan } from './ScreenPlan'

const SOURCE_NAMES: Record<PlaceSource, [string, string]> = {
  amap: ['Amap', '高德地图'], qq: ['Tencent Maps', '腾讯位置服务'], osm: ['OpenStreetMap', 'OpenStreetMap'],
}

type Where = { lat?: number; lon?: number; status: 'asking' | 'device' | 'refused' | 'named' }

// this visit's location, so a second search doesn't ask again (it is never stored)
let remembered: { lat: number; lon: number } | null = null

/** The customer's location, asked of the browser when a search needs it; a named place needs none. */
function useWhere(named: boolean) {
  const [where, setWhere] = useState<Where>(() =>
    named ? { status: 'named' } : remembered ? { ...remembered, status: 'device' } : { status: 'asking' })
  const ask = () => {
    if (!('geolocation' in navigator)) return setWhere({ status: 'refused' })
    setWhere({ status: 'asking' })
    navigator.geolocation.getCurrentPosition(
      (position) => {
        remembered = { lat: position.coords.latitude, lon: position.coords.longitude }
        setWhere({ ...remembered, status: 'device' })
      },
      () => setWhere({ status: 'refused' }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    )
  }
  useEffect(() => {
    if (!named && !remembered) ask()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return { where, ask }
}

function distance(m: number | null, zh: boolean) {
  if (m === null) return ''
  if (m < 1000) return zh ? `${m} 米` : `${m} m`
  return zh ? `${(m / 1000).toFixed(1)} 公里` : `${(m / 1000).toFixed(1)} km`
}

// where nobody books a table (the backend's NOT_DINING in app/agent/actions/places.py)
const NOT_DINING = /花店|鲜花|花卉|蛋糕|面包|礼品|超市|取款|atm|银行|florist|flower|bakery|cake|gift|supermarket|bank/i

/** Choosing a place for something else (a shop for an order) instead of booking a table there. */
type Pick = { label: string; busy: boolean; chosen?: string | null; onPick: (place: Place) => void }

/** Real places near the customer, for what they asked for ('火锅', 'coffee'), each one bookable (or, with pick, choosable). */
export function PlacesCard({ what, label, near, party, date, time, searchRef, pick }: { what: string; label?: string; near?: string | null; party?: number | null; date?: string | null; time?: string | null; searchRef?: string | null; pick?: Pick }) {
  const { tr, lang } = useLang()
  const { where, ask } = useWhere(!!near)
  const ready = where.status !== 'asking'
  const found = useQuery({
    queryKey: ['places', what, near ?? null, where.lat?.toFixed(3) ?? null, where.lon?.toFixed(3) ?? null, lang, searchRef ?? null],
    queryFn: () => api.places(what, near ? { near } : { lat: where.lat, lon: where.lon }, lang, searchRef),
    enabled: ready, staleTime: 600_000, retry: false,
  })
  const data = found.data
  const around = data?.located === 'device' ? tr('you', '你') : data?.label ?? ''
  const used = data ? (Object.entries(data.sources) as [PlaceSource, string][]).filter(([, s]) => s === 'ok').map(([k]) => k) : []

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-4 py-3">
        <p className="min-w-0 flex-1 font-semibold">
          {data ? tr(`${label ?? what} near ${around}`, `${around}附近的${label ?? what}`) : tr(`${label ?? what} nearby`, `附近的${label ?? what}`)}
        </p>
        {data?.located === 'fallback' && where.status !== 'asking' && !near && (
          <button type="button" onClick={ask} className="btn btn-line gap-1.5 py-1 text-sm"><LocateFixed size={14} />{tr('Use my location', '用我的位置')}</button>
        )}
      </div>
      {!ready && <p className="px-4 py-4 text-sm text-ink2">{tr('Finding where you are: your browser will ask whether to share your location.', '正在获取你的位置：浏览器会问你是否允许。')}</p>}
      {ready && found.isLoading && <p className="px-4 py-4 text-sm text-ink2">{tr('Searching the maps…', '正在地图上搜索…')}</p>}
      {found.error && <p role="alert" className="px-4 py-4 text-sm text-cinnabar">{errorText(found.error, lang)}</p>}
      {data && (data.located === 'fallback' || data.near_missed) && (
        <p className="border-b border-rule bg-[var(--amber-wash)] px-4 py-2 text-cap">
          {data.near_missed
            ? tr(`Couldn't find “${near}” on the map, so this searched around ${data.label ?? 'you'}.`, `地图上没找到“${near}”，先按${data.label ?? '你的位置'}搜索。`)
            : tr(`No location shared, so this searched around ${data.label}.`, `没有拿到你的位置，先按${data.label}搜索。`)}
        </p>
      )}
      {data && data.items.length === 0 && (
        <p className="px-4 py-4 text-sm text-ink2">{tr(`No “${label ?? what}” within ${data.radius_m / 1000} km of ${around}.`, `${around}附近 ${data.radius_m / 1000} 公里内没找到“${label ?? what}”。`)}</p>
      )}
      {data && data.items.length > 0 && data.radius_m > 3000 && (
        <p className="border-b border-rule px-4 py-2 text-cap text-ink2">{tr(`Little within 3 km, so this looked up to ${data.radius_m / 1000} km away.`, `3 公里内不多，已扩大到 ${data.radius_m / 1000} 公里。`)}</p>
      )}
      {data && data.items.length > 0 && (
        <ol className="divide-y divide-rule">
          {data.items.map((place) => <PlaceRow key={place.id} place={place} party={party} date={date} time={time} pick={pick}
            bookable={!NOT_DINING.test(what)} />)}
        </ol>
      )}
      {data && (
        <p className="border-t border-rule px-4 py-2.5 text-xs leading-relaxed text-ink2">
          {used.length
            ? tr(`From ${used.map((s) => SOURCE_NAMES[s][0]).join(', ')}.`, `数据来自${used.map((s) => SOURCE_NAMES[s][1]).join('、')}。`)
            : tr('No map service answered just now.', '地图服务暂时没有回应。')}
          {used.includes('osm') && ' © OpenStreetMap contributors.'}
          {' '}{tr('Your location is used only for this search and goes only to these map services; it is not saved.', '位置只用于这次搜索，只发给这些地图服务，不会保存。')}
        </p>
      )}
    </div>
  )
}

function PlaceRow({ place, party, date, time, pick, bookable }: { place: Place; party?: number | null; date?: string | null; time?: string | null; pick?: Pick; bookable: boolean }) {
  const { tr, lang } = useLang()
  const zh = lang === 'zh'
  const [open, setOpen] = useState(false)
  const tel = place.phone.split(/[;；,，]/)[0]?.replace(/[^\d+-]/g, '')
  const meta = [
    place.category,
    place.rating ? `★ ${place.rating.toFixed(1)}` : '',
    place.cost_yuan ? tr(`about ¥${Math.round(place.cost_yuan)} a person`, `人均 ¥${Math.round(place.cost_yuan)}`) : '',
    distance(place.distance_m, zh),
  ].filter(Boolean)
  return (
    <li className="px-4 py-3">
      <div className="flex gap-3">
        <span className="num mt-0.5 w-5 shrink-0 text-right text-sm font-semibold text-ink2">{place.rank}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{place.name}</p>
          {meta.length > 0 && <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-cap text-ink2">
            {meta.map((m, i) => <span key={i} className={m.startsWith('★') ? 'flex items-center gap-0.5 text-[var(--amber-ink)]' : ''}>
              {m.startsWith('★') ? <><Star size={12} className="fill-current" />{m.slice(2)}</> : m}</span>)}
          </p>}
          {place.address && <p className="mt-0.5 text-cap text-ink2">{place.address}</p>}
          {place.hours && <p className="mt-0.5 text-cap text-ink2">{tr('Hours', '营业')} {place.hours}</p>}
          {place.photos.length > 0 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {place.photos.map((src, i) => <img key={src} src={src} loading="lazy" decoding="async" alt={tr(`${place.name}, photo ${i + 1}`, `${place.name}照片 ${i + 1}`)}
                onError={(e) => { e.currentTarget.hidden = true }} className="h-20 w-28 shrink-0 rounded-box bg-paper2 object-cover" />)}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {pick
              ? <button type="button" disabled={pick.busy} aria-pressed={pick.chosen === place.id} onClick={() => pick.onPick(place)} className="btn btn-ink py-1.5 text-sm">{pick.chosen === place.id ? tr('Chosen', '已选') : pick.label}</button>
              : bookable && <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="btn btn-ink py-1.5 text-sm">{tr('Book a table', '订座')}</button>}
            <a href={place.map_url} target="_blank" rel="noopener noreferrer" className="btn btn-line gap-1 py-1.5 text-sm"><MapPin size={14} />{tr('Map', '地图')}</a>
            {tel && <a href={`tel:${tel}`} className="btn btn-line gap-1 py-1.5 text-sm"><Phone size={14} />{tr('Call', '电话')}</a>}
          </div>
          {open && !pick && <BookTable place={place} party={party} date={date} time={time} />}
        </div>
        <span className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
          {place.sources.map((s) => <span key={s} className="rounded-full bg-paper2 px-2 py-0.5 text-[11px] text-ink2">{SOURCE_NAMES[s][zh ? 1 : 0]}</span>)}
        </span>
      </div>
    </li>
  )
}

const TIMES = Array.from({ length: 24 }, (_, i) => `${String(10 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)

/** The bank's own date (the demo clock can be ahead of the real one), so 'tomorrow' is tomorrow for the bank too. */
function useBankToday() {
  const clock = useQuery({ queryKey: ['clock'], queryFn: api.clock, staleTime: 60_000 })
  return clock.data?.now.slice(0, 10)
}

function addDays(day: string, days: number) {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** When and for how many: the booking then waits on the same confirm card as everything else. */
function BookTable({ place, party, date, time }: { place: Place; party?: number | null; date?: string | null; time?: string | null }) {
  const { tr } = useLang()
  const today = useBankToday()
  const screen = useScreenPlan()
  const [day, setDay] = useState(date ?? '')
  const [at, setAt] = useState(time && TIMES.includes(time) ? time : '19:00')
  const [people, setPeople] = useState(party ?? 2)
  useEffect(() => {
    if (!day && today) setDay(addDays(today, 1))
  }, [today, day])

  if (screen.planId) {
    return (
      <div className="mt-3 space-y-3">
        <ScreenConfirm planId={screen.planId} again={tr('Book another', '再订一个')} onAgain={screen.reset} />
        <Booked planId={screen.planId} />
      </div>
    )
  }
  return (
    <form className="mt-3 grid gap-2 rounded-tile bg-paper2 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
      onSubmit={(e) => { e.preventDefault(); void screen.start('book_table', { place: place.id, at: `${day}T${at}`, party: people }) }}>
      <label className="grid gap-1 text-cap text-ink2">{tr('Day', '日期')}
        <input type="date" className="field" required value={day} min={today} max={today ? addDays(today, 60) : undefined}
          onChange={(e) => setDay(e.target.value)} />
      </label>
      <label className="grid gap-1 text-cap text-ink2">{tr('Time', '时间')}
        <select className="field" value={at} onChange={(e) => setAt(e.target.value)}>
          {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-cap text-ink2">{tr('People', '人数')}
        <select className="field" value={people} onChange={(e) => setPeople(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <button className="btn btn-ink py-2.5" disabled={screen.busy || !day}>{screen.busy ? tr('Checking…', '核对中…') : tr('Book', '订座')}</button>
      {screen.error && <p role="alert" className="text-sm text-cinnabar sm:col-span-4">{screen.error}</p>}
      <p className="text-xs text-ink2 sm:col-span-4">{tr('A demo: the booking is recorded by the bank but not sent to the restaurant.', '演示：订座会记在银行里，但不会发给餐厅。')}</p>
    </form>
  )
}

/** Once a booking is confirmed (from the card, or from WeChat in the app): its code and how to reach the place. */
export function Booked({ planId }: { planId: string }) {
  const plan = usePlan(planId)
  const booking = plan.data?.steps[0]?.booking
  return booking ? <ReservationCard card={booking} /> : null
}

/** A booking made: the place, when, for how many, and its code. */
export function ReservationCard({ card }: { card: Card }) {
  const { tr } = useLang()
  const tel = String(card.phone ?? '').split(/[;；,，]/)[0]?.replace(/[^\d+-]/g, '')
  return (
    <div className="card p-4">
      <p className="text-cap text-ink2">{tr('Table booked', '已订座')}</p>
      <p className="mt-1 font-semibold">{card.name}</p>
      <p className="num mt-1 text-lg font-semibold">{card.date} {card.time}　{tr(`${card.party} people`, `${card.party} 位`)}</p>
      <p className="mt-1 text-sm">{tr('Booking code', '订座号')} <span className="num font-semibold tracking-wider">{card.code}</span></p>
      {card.address && <p className="mt-1 text-cap text-ink2">{card.address}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {card.map_url && <a href={card.map_url} target="_blank" rel="noopener noreferrer" className="btn btn-line gap-1 py-1.5 text-sm"><MapPin size={14} />{tr('Map', '地图')}</a>}
        {tel && <a href={`tel:${tel}`} className="btn btn-line gap-1 py-1.5 text-sm"><Phone size={14} />{tr('Call to confirm', '打电话确认')}</a>}
      </div>
      <p className="mt-3 text-xs text-ink2">{tr('A demo: the restaurant isn\'t told about this booking.', '演示：这条订座不会发给餐厅。')}</p>
    </div>
  )
}

/** The customer's upcoming bookings. */
export function ReservationsCard({ card }: { card: Card }) {
  const { tr } = useLang()
  if (!card.items?.length) return null
  return (
    <ol className="card divide-y divide-rule">
      {card.items.map((r: { code: string; name: string; address: string; date: string; time: string; party: number }) => (
        <li key={r.code} className="flex items-baseline gap-3 px-4 py-2.5">
          <span className="num shrink-0 font-semibold">{r.date.slice(5)} {r.time}</span>
          <span className="min-w-0 flex-1 truncate">{r.name}</span>
          <span className="shrink-0 text-cap text-ink2">{tr(`${r.party} people`, `${r.party} 位`)} · {r.code}</span>
        </li>
      ))}
    </ol>
  )
}

// what each kind of partner order looks for on the map (the words Amap and Tencent index), and what the card calls it
const SHOP_KINDS: Record<string, { query: string; zh: string; en: string }> = {
  florist: { query: '花店', zh: '花店', en: 'Florist' },
  bakery: { query: '蛋糕店', zh: '蛋糕店', en: 'Cake shop' },
  gift: { query: '礼品店', zh: '礼品店', en: 'Gift shop' },
  restaurant: { query: '餐厅', zh: '餐厅', en: 'Restaurant' },
}

/**
 * On a plan with partner-shop orders (the birthday plan's flowers and cake), each order can go to a real shop nearby
 * instead. Choosing one changes the plan, so it is checked again and needs its own confirmation.
 */
export function ShopPicker({ plan, busy, onPick }: { plan: PlanData; busy: boolean; onPick: (stepId: string, place: Place) => void }) {
  const { tr } = useLang()
  const [open, setOpen] = useState<string | null>(null)
  const orders = plan.steps.filter((s) => s.action === 'merchant_order' && s.status === 'pending' && s.shop_kind && SHOP_KINDS[s.shop_kind])
  if (!orders.length) return null
  return (
    <div className="tile mt-3 p-4 max-sm:p-3">
      <p className="font-semibold">{tr('Use real shops near you', '换成附近真实的店')}</p>
      <p className="mt-1 text-xs text-ink2">{tr('Shops from the maps. A demo: the shop isn\'t sent the order, and the price is for reference.', '来自地图上的真实店铺。演示：订单不会发给店家，价格为参考价。')}</p>
      <ul className="mt-2 divide-y divide-rule">
        {orders.map((s) => {
          const kind = SHOP_KINDS[s.shop_kind!]
          return (
            <li key={s.id} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-sm">
                  <span className="text-ink2">{tr(`${kind.en}: `, `${kind.zh}：`)}</span>
                  <span className="font-semibold">{s.shop_place?.name ?? tr('the bank\'s partner shop', '银行合作商户')}</span>
                </span>
                <button type="button" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)} className="btn btn-line py-1 text-sm">
                  {open === s.id ? tr('Close', '收起') : s.shop_place ? tr('Change', '换一家') : tr('Choose one', '选一家')}
                </button>
              </div>
              {open === s.id && (
                <div className="mt-2">
                  <PlacesCard what={kind.query} label={tr(kind.en.toLowerCase(), kind.zh)}
                    pick={{ label: tr('Choose', '选这家'), busy, chosen: s.shop_place?.id, onPick: (place) => { onPick(s.id, place); setOpen(null) } }} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
