import { getDeviceId } from './device'

export class ApiError extends Error {
  constructor(public status: number, public code: string | undefined, public en: string, public zh: string) {
    super(en)
  }
}

export async function call<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Device-Id': getDeviceId(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new ApiError(response.status, data.code, data.message_en ?? 'Request failed.', data.message_zh ?? '请求失败。')
    }
    return data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(0, 'NETWORK', "Can't reach the bank right now. Check your connection and try again.", '暂时无法连接，请检查网络后重试。')
  } finally {
    clearTimeout(timer)
  }
}

export const errorText = (error: unknown, lang: 'zh' | 'en') =>
  error instanceof ApiError ? (lang === 'zh' ? error.zh : error.en) : lang === 'zh' ? '出了点问题，请重试。' : 'Something went wrong. Try again.'

export type Tier = 'green' | 'yellow' | 'red'

export interface Message {
  id: string
  at: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  text: string
  lang: string
  plan_id: string | null
  cards: Card[]
}

export type Card = { type: string; [key: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any

export interface PlanStep {
  id: string
  action: string
  status: string
  tier: Tier | null
  rule: string | null
  rule_text: string | null
  signals: string[]
  text: string
  after: string[]
  run_at: string | null
  error: string | null
  error_code: string | null
  irreversible: boolean
  fen: number | null
}

export interface Plan {
  id: string
  status: string
  tier: Tier
  source: string
  flags: string[]
  approval_hash: string | null
  ask: { field: string; zh: string; en: string; options: any[] } | null // eslint-disable-line @typescript-eslint/no-explicit-any
  steps: PlanStep[]
  created_at: string
  request: string
}

export interface ChatResult {
  conversation_id: string
  escalated: boolean
  messages: Message[]
  plan: Plan | null
}

export interface PlanResult {
  plan: Plan
  messages: Message[]
}
