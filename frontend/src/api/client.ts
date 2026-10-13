import type {
  AuditEntry,
  ChatResult,
  Message,
  OperatorDetail,
  Overview,
  Payee,
  Plan,
  PlanResult,
  PlanRow,
  QueueItem,
  Report,
  Anomaly,
  BankCard,
  Note,
  Scheduled,
  Sms,
  Subscriptions,
  Txn,
  UploadResult,
  Wealth,
  Lock,
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

// The operator console also accepts the server's admin token, kept in this browser only.
const ADMIN_KEY = 'ba_admin_token'
let memoryToken: string | null = null
export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}
export function setAdminToken(token: string) {
  try {
    localStorage.setItem(ADMIN_KEY, token)
  } catch {
    /* storage unavailable: token lives for this page only */
  }
  memoryToken = token
}
export function clearAdminToken() {
  try {
    localStorage.removeItem(ADMIN_KEY)
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
  if (res.status === 401 && path !== '/api/me') throw new AuthError(body.message_en ?? 'Sign in first.')
  if (!res.ok) throw new ApiError(res.status, body.code, body.message_en ?? `${res.status} on ${path}`, body.message_zh ?? '请求未完成。')
  return body as T
}

const post = <T,>(path: string, data: unknown = {}, admin = false) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }, admin)

export const api = {
  mode: 'live' as const,
  health: () => request<{ ok: boolean; planner: 'ai' | 'offline'; demo_tools: boolean }>('/api/health'),

  // the assistant
  conversation: (id?: string | null) => request<ChatResult>(`/api/conversation${id ? `?conversation_id=${id}` : ''}`),
  newConversation: () => post<ChatResult>('/api/conversation/new'),
  chat: (message: string, conversation_id: string | null, lang: Lang, attachment_id?: string | null) =>
    post<ChatResult>('/api/chat', { message, conversation_id, lang, attachment_id: attachment_id ?? null }),
  plan: (id: string, lang: Lang) => request<Plan>(`/api/plans/${id}?lang=${lang}`),
  plans: (lang: Lang, limit = 100) => request<{ items: PlanRow[] }>(`/api/plans?lang=${lang}&limit=${limit}`),
  approve: (id: string, approval_hash: string, lang: Lang) => post<PlanResult>(`/api/plans/${id}/approve`, { approval_hash, lang }),
  cancel: (id: string, rollback: boolean, lang: Lang) => post<PlanResult>(`/api/plans/${id}/cancel`, { rollback, lang }),
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
  transactions: (days = 90, q = '', limit = 200) => request<{ count: number; items: Txn[] }>(`/api/bank/transactions?days=${days}&limit=${limit}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  report: (period: 'month' | 'year', offset: number) => request<Report>(`/api/bank/report?period=${period}&offset=${offset}`),
  anomalies: () => request<{ items: Anomaly[] }>('/api/bank/anomalies'),
  subscriptions: (lang: Lang) => request<Subscriptions>(`/api/bank/subscriptions?lang=${lang}`),
  cards: (lang: Lang) => request<{ items: BankCard[] }>(`/api/bank/cards?lang=${lang}`),
  payees: () => request<{ items: Payee[] }>('/api/bank/payees'),
  wealth: (lang: Lang) => request<Wealth>(`/api/bank/wealth?lang=${lang}`),
  scheduled: () => request<Scheduled>('/api/bank/scheduled'),
  notifications: (lang: Lang) => request<{ items: Note[] }>(`/api/notifications?lang=${lang}`),
  readNotifications: () => post('/api/notifications/read'),
  phone: () => request<{ number: string; items: Sms[] }>('/api/phone'),
  audit: (limit = 300, planId?: string | null) => request<{ items: AuditEntry[] }>(`/api/audit?limit=${limit}${planId ? `&plan_id=${planId}` : ''}`),
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

  // operators
  queue: () => request<{ items: QueueItem[] }>('/api/operator/queue', {}, true),
  operatorDetail: (id: string) => request<OperatorDetail>(`/api/operator/conversations/${id}`, {}, true),
  operatorReply: (id: string, text: string) => post<Message>(`/api/operator/conversations/${id}/reply`, { text }, true),
  operatorRelease: (id: string) => post(`/api/operator/conversations/${id}/release`, {}, true),
  operatorUnlock: (id: string) => post(`/api/operator/users/${id}/unlock`, {}, true),
  operatorCancel: (planId: string) => post(`/api/operator/plans/${planId}/cancel`, {}, true),
}
