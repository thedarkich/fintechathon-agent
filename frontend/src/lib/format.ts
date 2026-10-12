export function yuan(fen?: number | null): string {
  if (fen === null || fen === undefined) return '—'
  const sign = fen < 0 ? '-' : ''
  const abs = Math.abs(fen)
  const whole = Math.floor(abs / 100).toLocaleString('en-US')
  return `${sign}¥${whole}.${String(abs % 100).padStart(2, '0')}`
}

export function shortTime(iso: string, lang: 'zh' | 'en'): string {
  const d = new Date(iso)
  return d.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai',
  })
}

export function day(iso: string): string {
  return iso.slice(0, 10)
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
