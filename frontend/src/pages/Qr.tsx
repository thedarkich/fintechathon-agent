import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { BadgeCheck, Camera, Store } from 'lucide-react'
import { api, errorText } from '../api/client'
import type { QrMerchant, QrRead } from '../api/types'
import { useLang } from '../i18n'
import { PageHead, Segmented } from '../components/bits'
import { ScreenConfirm, useScreenPlan } from '../components/ScreenPlan'
import { yuan } from '../lib/format'

/** A code is a link to this pay screen, so a phone camera opens the app straight on the payment. */
const linkFor = (payload: string) => `${window.location.origin}${window.location.pathname}#/qr?p=${encodeURIComponent(payload)}`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Detector: any = typeof window !== 'undefined' ? (window as any).BarcodeDetector : undefined
const canScan = !!Detector && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** The phone's camera, where the browser can read QR codes itself. */
function CameraScan({ onCode }: { onCode: (text: string) => void }) {
  const { tr } = useLang()
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'off' | 'on' | 'blocked'>('off')
  const stop = useRef<() => void>(() => undefined)
  useEffect(() => () => stop.current(), [])

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      const detector = new Detector({ formats: ['qr_code'] })
      if (video.current) {
        video.current.srcObject = stream
        await video.current.play()
      }
      setState('on')
      const timer = window.setInterval(async () => {
        if (!video.current) return
        const codes = await detector.detect(video.current).catch(() => [])
        if (codes[0]?.rawValue) {
          stop.current()
          onCode(codes[0].rawValue)
        }
      }, 350)
      stop.current = () => {
        window.clearInterval(timer)
        stream.getTracks().forEach((t) => t.stop())
        setState('off')
      }
    } catch {
      setState('blocked')
    }
  }

  return (
    <div>
      <div className={`relative overflow-hidden rounded-box bg-ink ${state === 'on' ? '' : 'hidden'}`}>
        <video ref={video} muted playsInline className="aspect-square w-full object-cover" />
        <span className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/80" aria-hidden />
      </div>
      {state !== 'on' && (
        <button type="button" onClick={() => void start()} className="btn btn-ink flex w-full items-center justify-center gap-2 py-3 text-base">
          <Camera size={18} />{tr('Scan with the camera', '打开摄像头扫码')}
        </button>
      )}
      {state === 'blocked' && <p className="mt-2 text-sm text-cinnabar">{tr('The camera is off for this site. Allow it in the browser, or tap a shop’s code below.', '没有摄像头权限。请在浏览器里允许，或点下面商户的码。')}</p>}
    </div>
  )
}

/** Pay a shop: scan its code (or, in the demo, tap it), check the shop and amount, confirm. */
export default function Qr() {
  const { tr, lang } = useLang()
  const [params, setParams] = useSearchParams()
  const shops = useQuery({ queryKey: ['qr-merchants', lang], queryFn: () => api.qrMerchants(lang), staleTime: 300_000 })
  const [tab, setTab] = useState<'scan' | 'till'>('scan')
  const [scanned, setScanned] = useState<{ text: string; read: QrRead } | null>(null)
  const [error, setError] = useState('')
  const [amount, setAmount] = useState('')
  const flow = useScreenPlan()

  async function handle(text: string) {
    setError('')
    setAmount('')
    try {
      setScanned({ text, read: await api.qrRead(text, lang) })
      setTab('scan')
    } catch (err) {
      setError(errorText(err, lang))
    }
  }
  // opened from a phone camera: the code's link carries the payment
  useEffect(() => {
    const p = params.get('p')
    if (p) {
      setParams({}, { replace: true })
      void handle(p)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const done = () => { flow.reset(); setScanned(null) }
  const read = scanned?.read
  const fen = read?.valid ? read.fen ?? (Number(amount) > 0 ? Math.round(Number(amount) * 100) : null) : null

  return (
    <main tabIndex={-1} className="page-content">
      <PageHead title={tr('QR pay', '扫码付')} right={
        <Segmented label={tr('QR pay', '扫码付')} value={tab} onChange={setTab} options={[['scan', tr('Pay', '付款')], ['till', tr('Demo till', '演示收银台')]] as const} />} />

      {tab === 'till' ? <Till shops={shops.data?.items ?? []} onScan={(p) => void handle(p)} /> : (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <section aria-label={tr('Payment', '付款')} className="space-y-4">
            {flow.planId ? <ScreenConfirm planId={flow.planId} again={tr('Done', '完成')} onAgain={done} />
              : read?.valid ? (
                <div className="ruled bg-field px-5 py-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-wash)] text-[var(--action)]"><Store size={24} /></span>
                    <span className="min-w-0"><span className="block font-semibold leading-snug">{read.merchant.name}</span>
                      <span className="flex items-center gap-1 text-xs text-jade"><BadgeCheck size={14} />{tr(`Registered with the bank · ${read.merchant.city}`, `本行登记商户 · ${read.merchant.city}`)}</span></span>
                  </div>
                  {read.fen ? (
                    <p className="num mt-5 font-mono text-[2.3rem] font-bold">{yuan(read.fen)}</p>
                  ) : (
                    <div className="mt-5 flex items-baseline gap-2 border-b-2 border-rule2 focus-within:border-[var(--action)]">
                      <span className="font-mono text-2xl text-ink2">¥</span>
                      <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="0" autoFocus aria-label={tr('Amount', '金额')}
                        className="num min-w-0 flex-1 bg-transparent py-2 font-mono text-[2.2rem] font-bold outline-none focus-visible:outline-none" />
                    </div>
                  )}
                  {read.order && <p className="mt-1 text-sm text-ink2">{tr(`Order ${read.order}`, `订单号 ${read.order}`)}</p>}
                  {flow.error && <p role="alert" className="mt-3 text-sm font-semibold text-cinnabar">{flow.error}</p>}
                  <div className="mt-5 flex gap-2">
                    <button type="button" className="btn btn-ink flex-1 py-3 text-base" disabled={!fen || flow.busy}
                      onClick={() => void flow.start('qr_pay', { code: read.merchant.code, amount_yuan: fen! / 100, ...(read.order ? { order: read.order } : {}) })}>
                      {fen ? tr(`Pay ${yuan(fen)}`, `付款 ${yuan(fen)}`) : tr('Pay', '付款')}
                    </button>
                    <button type="button" className="btn btn-line px-5" onClick={() => setScanned(null)}>{tr('Cancel', '取消')}</button>
                  </div>
                </div>
              ) : <>
                {read && !read.valid && <NotOurs text={scanned!.text} onAgain={() => setScanned(null)} />}
                {canScan ? <CameraScan onCode={(t) => void handle(t)} /> : (
                  <p className="ruled bg-field px-4 py-4 text-sm text-ink2">{tr('This browser can’t read QR codes from the camera. On a phone, open the camera app and scan the shop’s code: it opens this screen. In the demo, tap a code.', '这个浏览器不能用摄像头读二维码。用手机自带相机扫商户的码，会直接打开这个页面；演示时点一下右边的码即可。')}</p>
                )}
                {error && <p role="alert" className="text-sm font-semibold text-cinnabar">{error}</p>}
              </>}
          </section>

          <section aria-label={tr('Demo shops', '演示商户')}>
            <h2 className="text-lg font-semibold">{tr('Shops’ codes', '商户收款码')}</h2>
            <p className="mb-3 text-sm text-ink2">{tr('Demo: tap a code to scan it.', '演示：点一下就算扫码。')}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(shops.data?.items ?? []).map((s) => (
                <button key={s.code} type="button" onClick={() => void handle(s.payload)} className="flex flex-col items-center gap-2 rounded-box border border-rule bg-field p-3 text-center hover:border-[var(--action)]">
                  <span className="rounded-[6px] bg-[#fff] p-1.5"><QRCodeSVG value={linkFor(s.payload)} size={96} bgColor="#ffffff" fgColor="#1d2836" level="M" marginSize={0} /></span>
                  <span className="text-xs leading-snug">{s.name}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

/** A code that isn't one of the bank's payment codes: say what it would do instead, and never open it. */
function NotOurs({ text, onAgain }: { text: string; onAgain: () => void }) {
  const { tr } = useLang()
  let host = ''
  try { host = /^https?:\/\//i.test(text) ? new URL(text).host : '' } catch { /* not a link */ }
  return (
    <div className="rounded-box border-2 border-cinnabar bg-field px-4 py-3">
      <p className="font-semibold text-cinnabar">{tr('This is not a payment code from our bank', '这不是本行的收款码')}</p>
      <p className="mt-1 text-sm">{host ? tr(`It would open a website: ${host}. The bank never asks you to scan a code to sign in or type a password or code.`, `它会打开一个网站：${host}。银行不会让你扫码登录，或输入密码、验证码。`)
        : tr(`It says: “${text.slice(0, 60)}”`, `内容：“${text.slice(0, 60)}”`)}</p>
      <button type="button" className="mt-2 text-sm font-semibold text-[var(--action)]" onClick={onAgain}>{tr('Scan again', '重新扫码')}</button>
    </div>
  )
}

/** The demo's shop side: type the sale's amount and the till shows a code that carries it. */
function Till({ shops, onScan }: { shops: QrMerchant[]; onScan: (payload: string) => void }) {
  const { tr } = useLang()
  const [shop, setShop] = useState('')
  const [amount, setAmount] = useState('')
  const [payload, setPayload] = useState('')
  const chosen = shops.find((s) => s.code === shop) ?? shops[0]
  const fen = Math.round(Number(amount) * 100)
  const make = () => {
    if (!chosen || !(fen > 0)) return
    const order = 'T' + Date.now().toString(36).slice(-6).toUpperCase()
    setPayload(`BAQR1:${chosen.code}:${fen}:${order}`)
  }
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section className="space-y-4">
        <p className="text-sm text-ink2">{tr('This is the shop’s side of the demo. Pick a shop, type the sale, and pay its code from the Pay tab or another phone.', '这是演示里商户那一侧：选商户、输入金额，生成本单收款码，再用“付款”或另一台手机扫码。')}</p>
        <div className="flex flex-wrap gap-2">
          {shops.map((s) => (
            <button key={s.code} type="button" onClick={() => { setShop(s.code); setPayload('') }}
              className={`rounded-full border px-3 py-1 text-sm ${s.code === chosen?.code ? 'border-[var(--action)] bg-[var(--accent-wash)] font-semibold text-[var(--action)]' : 'border-rule bg-field'}`}>{s.name}</button>
          ))}
        </div>
        <div className="flex items-baseline gap-2 border-b-2 border-rule2 focus-within:border-[var(--action)]">
          <span className="font-mono text-2xl text-ink2">¥</span>
          <input value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setPayload('') }} inputMode="decimal" placeholder="0" aria-label={tr('Sale amount', '收款金额')}
            className="num min-w-0 flex-1 bg-transparent py-2 font-mono text-[2rem] font-bold outline-none focus-visible:outline-none" />
        </div>
        <button type="button" className="btn btn-ink w-full py-3 text-base" disabled={!(fen > 0) || fen > 5_000_000} onClick={make}>{tr('Show the code', '生成收款码')}</button>
      </section>
      {payload && chosen && (
        <section className="flex flex-col items-center gap-3 ruled bg-field px-6 py-6 text-center">
          <p className="font-semibold">{chosen.name}</p>
          <p className="num font-mono text-3xl font-bold">{yuan(fen)}</p>
          <button type="button" onClick={() => onScan(payload)} className="rounded-[8px] bg-[#fff] p-3" aria-label={tr('Pay this code here', '在本机付款')}>
            <QRCodeSVG value={linkFor(payload)} size={200} bgColor="#ffffff" fgColor="#1d2836" level="M" marginSize={0} />
          </button>
          <p className="text-sm text-ink2">{tr('Scan with another phone, or tap the code to pay it here.', '用另一台手机扫码，或点这个码在本机付款。')}</p>
        </section>
      )}
    </div>
  )
}
