import { useId } from 'react'
import { Ban, CalendarClock, Check, CircleSlash, Clock, Flag, Pencil, Search, TriangleAlert, Undo2, X, type LucideIcon } from 'lucide-react'
import { useLang } from '../i18n'

export type SealKind = 'done' | 'blocked' | 'refused' | 'cancelled' | 'undone' | 'scheduled' | 'error'

const INK: Record<SealKind, string> = {
  done: 'var(--jade)',
  blocked: 'var(--cinnabar)',
  refused: 'var(--ink)',
  cancelled: 'var(--ink-2)',
  undone: 'var(--ink-2)',
  scheduled: 'var(--ink)',
  error: 'var(--ink-2)',
}
const CENTER: Record<SealKind, string> = {
  done: '已办成',
  blocked: '已拦截',
  refused: '已拒绝',
  cancelled: '已取消',
  undone: '已撤销',
  scheduled: '已安排',
  error: '出错',
}
const BOTTOM: Record<SealKind, string> = {
  done: 'DONE',
  blocked: 'BLOCKED',
  refused: 'REFUSED',
  cancelled: 'CANCELLED',
  undone: 'UNDONE',
  scheduled: 'SCHEDULED',
  error: 'ERROR',
}

/**
 * A round company seal (公章-style), stamped onto an outcome.
 * Rim text, a centre word and a bottom line, with a slightly uneven ink texture.
 */
export function Seal({ kind, size = 168, animate = true, rotate = -8 }: { kind: SealKind; size?: number; animate?: boolean; rotate?: number }) {
  const uid = useId().replace(/:/g, '')
  const color = INK[kind]
  return (
    <div
      className={animate ? 'seal-stamp' : ''}
      style={{ width: size, height: size, ['--seal-rot' as string]: `${rotate}deg`, transform: animate ? undefined : `rotate(${rotate}deg)`, opacity: 0.92 }}
      role="img"
      aria-label={BOTTOM[kind]}
    >
      <svg viewBox="0 0 200 200" width={size} height={size}>
        <defs>
          <filter id={`ink-${uid}`} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.5" result="speckle" />
            <feComposite in="SourceGraphic" in2="speckle" operator="in" />
          </filter>
          <path id={`rim-${uid}`} d="M 32 100 A 68 68 0 1 1 168 100" />
        </defs>
        <g filter={`url(#ink-${uid})`} fill={color} stroke={color}>
          <circle cx="100" cy="100" r="92" fill="none" strokeWidth="7" />
          <circle cx="100" cy="100" r="82" fill="none" strokeWidth="1.6" />
          <text fontSize="17" fontWeight="700" letterSpacing="4" stroke="none" style={{ fontFamily: '"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif' }}>
            <textPath href={`#rim-${uid}`} startOffset="50%" textAnchor="middle">
              银行代办　规则审核专用
            </textPath>
          </text>
          <text x="100" y="116" textAnchor="middle" fontSize="40" fontWeight="800" stroke="none" style={{ fontFamily: '"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif' }}>
            {CENTER[kind]}
          </text>
          <line x1="52" y1="132" x2="148" y2="132" strokeWidth="1.6" />
          <text x="100" y="152" textAnchor="middle" fontSize={BOTTOM[kind].length > 8 ? 12 : 15} fontWeight="700" letterSpacing="3" stroke="none" style={{ fontFamily: '"Geist Variable",sans-serif' }}>
            {BOTTOM[kind]}
          </text>
        </g>
      </svg>
    </div>
  )
}

/** A small status icon for list rows: a picture anyone can read (a tick, a clock, a flag), never a lone character. */
export type MarkKind = 'done' | 'blocked' | 'refused' | 'pending' | 'scheduled' | 'cancelled' | 'undone' | 'query' | 'flag' | 'change' | 'error'
const MARKS: Record<MarkKind, { icon: LucideIcon; color: string; en: string; zh: string }> = {
  done: { icon: Check, color: 'var(--jade)', en: 'Done', zh: '已完成' },
  query: { icon: Search, color: 'var(--jade)', en: 'Looked up', zh: '已查询' },
  blocked: { icon: Ban, color: 'var(--cinnabar)', en: 'Blocked', zh: '已拦截' },
  refused: { icon: X, color: 'var(--ink)', en: 'Not done', zh: '未办理' },
  pending: { icon: Clock, color: 'var(--ink-2)', en: 'Waiting', zh: '等待中' },
  scheduled: { icon: CalendarClock, color: 'var(--ink)', en: 'Scheduled', zh: '已预约' },
  cancelled: { icon: CircleSlash, color: 'var(--ink-2)', en: 'Cancelled', zh: '已取消' },
  undone: { icon: Undo2, color: 'var(--ink-2)', en: 'Undone', zh: '已撤销' },
  flag: { icon: Flag, color: 'var(--cinnabar)', en: 'Worth a look', zh: '需留意' },
  change: { icon: Pencil, color: 'var(--ink)', en: 'Changed', zh: '有变更' },
  error: { icon: TriangleAlert, color: 'var(--ink-2)', en: 'Error', zh: '出错' },
}
export function SealMark({ kind, size = 30 }: { kind: MarkKind; size?: number }) {
  const { tr } = useLang()
  const { icon: Glyph, color, en, zh } = MARKS[kind]
  return (
    <span role="img" aria-label={tr(en, zh)} title={tr(en, zh)}
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
      <Glyph size={Math.round(size * 0.52)} strokeWidth={2.4} aria-hidden />
    </span>
  )
}

/** The brand mark: a square name seal (方章) reading 代办, top to bottom, in the brand green.
 *  A placeholder: the final logo replaces this one function. */
export function BrandSeal({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="shrink-0" style={{ color: 'var(--action)' }}>
      <rect x="1.6" y="1.6" width="36.8" height="36.8" rx="9" fill="none" stroke="currentColor" strokeWidth="3" />
      <g fill="currentColor" fontSize="15.5" fontWeight="700" textAnchor="middle" style={{ fontFamily: '"PingFang SC","Noto Sans SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif' }}>
        <text x="20" y="18.2">代</text>
        <text x="20" y="34.4">办</text>
      </g>
    </svg>
  )
}
