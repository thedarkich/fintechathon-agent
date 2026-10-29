import type {
  AuditEntry,
  AuditLabels,
  ChatResult,
  ConversationItem,
  Directory,
  ScreenAction,
  Message,
  OperatorDetail,
  Overview,
  Payee,
  Plan,
  PlanResult,
  PlanRow,
  PlacesResult,
  QueueItem,
  Report,
  Anomaly,
  BankCard,
  Note,
  PayeeSms,
  Scheduled,
  Sms,
  Subscriptions,
  Transfer,
  Txn,
  TxnQuery,
  UploadResult,
  Wealth,
  Lock,
  WechatLink,
  WechatReply,
} from './types'
import { getDeviceId } from '../lib/device'

type Lang = 'zh' | 'en'

export class RateLimitedError extends Error {
  constructor(public message_en: string, public message_zh: string) {
    super(message_en)
  }
}

export class AuthError extends Error {}

/** Any other refusal from the bank: carries the server's own bilingual message and code. */
export class ApiError extends Error {
  constructor(public status: number, public code: string | undefined, public en: string, public zh: string) {
    super(en)
  }
}

export const errorText = (error: unknown, lang: Lang) =>
  error instanceof ApiError ? (lang === 'zh' ? error.zh : error.en)
    : error instanceof RateLimitedError ? (lang === 'zh' ? error.message_zh : error.message_en)
      : error instanceof AuthError ? (lang === 'zh' ? '登录已失效，请重新登录。' : 'Your session ended. Sign in again.')
        : lang === 'zh' ? '暂时无法连接，请检查网络后重试。' : "Can't reach the bank right now. Check your connection and try again."

// The operator console also accepts the server's admin token. It is kept for this tab only (sessionStorage), never
// in localStorage: security best practice, a long-lived secret must not outlive the tab where a script could read it.
const ADMIN_KEY = 'ba_admin_token'
let memoryToken: string | null = null
try {
  localStorage.removeItem(ADMIN_KEY) // a copy left by an older version
} catch {
  /* storage unavailable */
}
export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}
export function setAdminToken(token: string) {
  try {
    sessionStorage.setItem(ADMIN_KEY, token)
  } catch {
    /* storage unavailable: token lives for this page only */
  }
  memoryToken = token
}
export function clearAdminToken() {
  try {
    sessionStorage.removeItem(ADMIN_KEY)
  } catch {
    /* ignore */
  }
  memoryToken = null
}

async function request<T>(path: string, init: RequestInit = {}, admin = false): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('X-Device-Id', getDeviceId())
  if (admin) {
    const token = getAdminToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  let res: Response
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init, headers })
  } catch {
    throw new TypeError('network') // net.ts counts a TypeError as "server unreachable"
  }
  const body = await res.json().catch(() => ({}))
  if (res.status === 429) throw new RateLimitedError(body.message_en ?? 'Too many attempts. Wait a minute and try again.', body.message_zh ?? '尝试过于频繁，请稍后再试。')
  // a wrong PIN, SMS code or passkey is a 401 too, with its own code and message: only a missing session signs you out
  const signedOut = !body.code || body.code === 'NOT_SIGNED_IN'
  if (res.status === 401 && signedOut && path !== '/api/me') throw new AuthError(body.message_en ?? 'Sign in first.')
  if (!res.ok) throw new ApiError(res.status, body.code, body.message_en ?? `${res.status} on ${path}`, body.message_zh ?? '请求未完成。')
  return body as T
}

/** The chat app's side of the WeChat assistant: its own token and never the bank session's cookie, as a real chat
 * app's servers would call the bank. It can ask and plan; nothing it holds can approve. */
export async function wechatSay(token: string, text: string, lang: Lang): Promise<WechatReply[]> {
  let res: Response
  try {
    res = await fetch('/api/channels/wechat/message', {
      method: 'POST', credentials: 'omit', cache: 'no-store', body: JSON.stringify({ text, lang }),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new TypeError('network')
  }
  const body = await res.json().catch(() => ({}))
  if (res.status === 429) throw new RateLimitedError(body.message_en ?? 'Too many messages. Wait a minute.', body.message_zh ?? '消息太频繁，请稍后再试。')
  if (!res.ok) throw new ApiError(res.status, body.code, body.message_en ?? 'The message was not delivered.', body.message_zh ?? '消息没有送达。')
  return body.replies as WechatReply[]
}

const post = <T,>(path: string, data: unknown = {}, admin = false) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }, admin)

export const api = {
  mode: 'live' as const,

  // the WeChat assistant (simulated): linking happens in the bank app, with the signed-in session and the PIN
  wechatLink: () => request<WechatLink>('/api/wechat/link'),
  linkWechat: (pin: string) => post<WechatLink & { token: string }>('/api/wechat/link', { pin }),
  unlinkWechat: () => post<WechatLink>('/api/wechat/unlink'),
  health: () => request<{ ok: boolean; planner: 'ai' | 'offline'; demo_tools: boolean }>('/api/health'),

  // the assistant
  conversation: (id?: string | null) => request<ChatResult>(`/api/conversation${id ? `?conversation_id=${id}` : ''}`),
  newConversation: () => post<ChatResult>('/api/conversation/new'),
  conversations: () => request<{ items: ConversationItem[] }>('/api/conversations'),
  hideConversation: (id: string) => post<{ ok: boolean }>(`/api/conversations/${id}/hide`),
  chat: (message: string, conversation_id: string | null, lang: Lang, attachment_id?: string | null) =>
    post<ChatResult>('/api/chat', { message, conversation_id, lang, attachment_id: attachment_id ?? null }),
  plan: (id: string, lang: Lang) => request<Plan>(`/api/plans/${id}?lang=${lang}`),
  plans: (lang: Lang, limit = 100) => request<{ items: PlanRow[] }>(`/api/plans?lang=${lang}&limit=${limit}`),
  approve: (id: string, approval_hash: string, lang: Lang) => post<PlanResult>(`/api/plans/${id}/approve`, { approval_hash, lang }),
  cancel: (id: string, rollback: boolean, lang: Lang) => post<PlanResult>(`/api/plans/${id}/cancel`, { rollback, lang }),
  edit: (id: string, step_id: string, args: Record<string, unknown>, lang: Lang) => post<PlanResult>(`/api/plans/${id}/edit`, { step_id, args, lang }),
  purpose: (id: string, step_id: string, purpose: string, lang: Lang) => post<PlanResult>(`/api/plans/${id}/purpose`, { step_id, purpose, lang }),
  answer: (id: string, value: unknown, lang: Lang) => post<PlanResult>(`/api/plans/${id}/answer`, { value, lang }),
  sms: (id: string) => post<{ challenge_id: string; phone: string; expires_in: number }>(`/api/plans/${id}/sms`),
  passkeyOptions: (id: string) => post<unknown>(`/api/plans/${id}/passkey-options`),
  verify: (id: string, body: Record<string, unknown>) => post<PlanResult>(`/api/plans/${id}/verify`, body),
  upload: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<UploadResult>('/api/uploads', { method: 'POST', body: form })
  },

  // the bank, read directly
  overview: (lang: Lang) => request<Overview>(`/api/bank/overview?lang=${lang}`),
  transactions: (days = 90, q = '', limit = 200, offset = 0) => request<{ count: number; items: Txn[] }>(`/api/bank/transactions?days=${days}&limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  searchTransactions: (query: TxnQuery, offset = 0, size = 10) => request<{ count: number; items: Txn[] }>(`/api/bank/transactions/search?${new URLSearchParams([
    ...Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)]),
    ['offset', String(offset)], ['size', String(size)],
  ])}`),
  report: (period: 'month' | 'year', offset: number) => request<Report>(`/api/bank/report?period=${period}&offset=${offset}`),
  anomalies: () => request<{ items: Anomaly[] }>('/api/bank/anomalies'),
  subscriptions: (lang: Lang) => request<Subscriptions>(`/api/bank/subscriptions?lang=${lang}`),
  cards: (lang: Lang) => request<{ items: BankCard[] }>(`/api/bank/cards?lang=${lang}`),
  payees: () => request<{ items: Payee[] }>('/api/bank/payees'),
  wealth: (lang: Lang) => request<Wealth>(`/api/bank/wealth?lang=${lang}`),
  scheduled: () => request<Scheduled>('/api/bank/scheduled'),
  transfers: (lang: Lang) => request<{ items: Transfer[] }>(`/api/bank/transfers?lang=${lang}`),
  payeePhone: () => request<{ items: PayeeSms[] }>('/api/payee-phone'),
  notifications: (lang: Lang) => request<{ items: Note[] }>(`/api/notifications?lang=${lang}`),
  readNotifications: () => post('/api/notifications/read'),
  // real places from the map services: the location goes only here, and only when the customer allowed it
  // (in the body, not the address, so no access log records it; to about 10 m, which a search needs no finer than)
  places: (q: string, where: { lat?: number; lon?: number; near?: string | null }, lang: Lang, ref?: string | null) => {
    const located = !where.near && where.lat !== undefined && where.lon !== undefined
    return post<PlacesResult>('/api/places/search', {
      q, lang, ref: ref || null, near: where.near || null,
      lat: located ? Number(where.lat!.toFixed(4)) : null, lon: located ? Number(where.lon!.toFixed(4)) : null,
    })
  },

  // the app's own screens: lookups read; anything that pays becomes a plan to confirm
  screenPlan: (action: ScreenAction, args: Record<string, unknown>, lang: Lang) => post<{ plan: Plan }>('/api/screens/plan', { action, args, lang }),
  directory: (phone: string, lang: Lang) => request<Directory>(`/api/directory?phone=${phone}&lang=${lang}`),
  phone: () => request<{ number: string; items: Sms[] }>('/api/phone'),
  audit: (limit = 300, planId?: string | null) => request<{ items: AuditEntry[]; labels: AuditLabels }>(`/api/audit?limit=${limit}${planId ? `&plan_id=${planId}` : ''}`),
  auditVerify: () => request<{ ok: boolean; entries: number; head?: string; broken_at?: number }>('/api/audit/verify'),

  // safety and sign-in factors
  locks: (lang: Lang) => request<{ items: Lock[] }>(`/api/locks?lang=${lang}`),
  unlockSms: () => post<{ challenge_id: string; phone: string }>('/api/unlock/sms'),
  unlock: (pin: string, challenge_id: string, code: string, lang: Lang) => post<{ cleared: string[] }>('/api/unlock', { pin, challenge_id, code, lang }),
  passkeys: () => request<{ items: { id: string; label: string; created_at: string }[] }>('/api/passkeys'),
  passkeyRegisterOptions: () => post<unknown>('/api/passkeys/options'),
  passkeyRegister: (credential: unknown, label: string) => post('/api/passkeys', { credential, label }),

  // demo tools
  clock: () => request<{ now: string; offset_seconds: number }>('/api/demo/clock'),
  advance: (days: number, hours: number, lang: Lang) => post<{ now: string }>('/api/demo/advance', { days, hours, lang }),
  reset: () => post('/api/demo/reset'),
  demoTransfer: (id: string, outcome: 'next' | 'return', lang: Lang) =>
    post<Transfer>(`/api/demo/transfers/${id}`, { outcome, reason: 'NAME_MISMATCH', lang }),

  // operators
  queue: () => request<{ items: QueueItem[] }>('/api/operator/queue', {}, true),
  operatorDetail: (id: string) => request<OperatorDetail>(`/api/operator/conversations/${id}`, {}, true),
  operatorReply: (id: string, text: string) => post<Message>(`/api/operator/conversations/${id}/reply`, { text }, true),
  operatorRelease: (id: string) => post(`/api/operator/conversations/${id}/release`, {}, true),
  operatorUnlock: (id: string) => post(`/api/operator/users/${id}/unlock`, {}, true),
  operatorCancel: (planId: string) => post(`/api/operator/plans/${planId}/cancel`, {}, true),
}
