export function shortAddr(a?: string | null, lead = 6, tail = 4): string {
  if (!a) return '—'
  if (a.length <= lead + tail + 2) return a
  return `${a.slice(0, lead)}…${a.slice(-tail)}`
}

/** Integer fen → '¥1,234.50' (negative as '-¥1,234.50'). */
export function yuan(fen?: number | null): string {
  if (fen === null || fen === undefined) return '—'
  const sign = fen < 0 ? '-' : ''
  const abs = Math.abs(Math.round(fen))
  return `${sign}¥${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`
}

export function fmtInt(n?: number | null): string {
  if (n === null || n === undefined) return '0'
  return n.toLocaleString('en-US')
}

export function timeAgo(iso: string, lang: 'zh' | 'en'): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return lang === 'zh' ? `${s} 秒前` : `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return lang === 'zh' ? `${m} 分钟前` : `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return lang === 'zh' ? `${h} 小时前` : `${h} h ago`
  return new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB')
}

/** HH:MM:SS in China time. */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Shanghai' })
}

const CHINA = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

/** 'MM-DD HH:MM' in China time. Bank times already carry +08:00; others (SMS, sign-in) are UTC and converted. */
export function stamp(iso: string): string {
  if (iso.endsWith('+08:00')) return iso.slice(5, 16).replace('T', ' ')
  const moment = new Date(iso)
  if (Number.isNaN(moment.getTime())) return iso.slice(5, 16).replace('T', ' ')
  const part = (type: string) => CHINA.formatToParts(moment).find((p) => p.type === type)?.value ?? ''
  return `${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}

export function pct(x?: number | null): string {
  if (x === null || x === undefined) return '—'
  return `${Math.round(x * 100)}%`
}

export const CATEGORY: Record<string, [string, string]> = {
  income: ['收入', 'Income'], housing: ['住房', 'Housing'], utilities: ['生活缴费', 'Utilities & phone'],
  dining: ['餐饮', 'Dining'], groceries: ['买菜超市', 'Groceries'], shopping: ['购物', 'Shopping'],
  transport: ['交通', 'Transport'], travel: ['旅行', 'Travel'], entertainment: ['娱乐', 'Entertainment'],
  digital: ['会员订阅', 'Digital subscriptions'], health: ['医疗健康', 'Health & fitness'], family: ['家人', 'Family'],
  transfer: ['转账', 'Transfers'], gifts: ['礼物', 'Gifts'], wealth: ['理财', 'Investments'],
  internal: ['内部划转', 'Internal moves'], other: ['其他', 'Other'],
}

/**
 * One colour per spending category, the same in every chart: the eight most common take the eight slots of a
 * palette validated for colour-blind separation (in this order), five more were checked against them, and
 * income, investments, internal moves and other share a neutral grey. Every category also has its own icon
 * and its text label, so colour is never the only way to tell categories apart.
 */
const CATEGORY_SLOT: Record<string, number> = {
  housing: 1, dining: 2, groceries: 3, shopping: 4, health: 5, travel: 6, utilities: 7, transport: 8,
  family: 9, transfer: 10, digital: 11, entertainment: 12, gifts: 13,
}
export const categoryColor = (code?: string | null) => (code && CATEGORY_SLOT[code] ? `var(--cat-${CATEGORY_SLOT[code]})` : 'var(--cat-other)')

export const category = (code: string, lang: 'zh' | 'en') => (CATEGORY[code] ?? CATEGORY.other)[lang === 'zh' ? 0 : 1]
