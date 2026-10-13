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

/** 'MM-DD HH:MM' in China time (bank times already carry +08:00). */
export function stamp(iso: string): string {
  return iso.slice(5, 16).replace('T', ' ')
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

export const category = (code: string, lang: 'zh' | 'en') => (CATEGORY[code] ?? CATEGORY.other)[lang === 'zh' ? 0 : 1]
