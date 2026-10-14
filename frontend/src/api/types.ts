// Shapes returned by the bank backend (backend/app/api). Amounts are integer fen.

export type Tier = 'green' | 'yellow' | 'red'
export type PlanStatus = 'clarifying' | 'awaiting_approval' | 'running' | 'scheduled' | 'done' | 'failed' | 'cancelled' | 'rolled_back'
export type StepStatus = 'new' | 'pending' | 'waiting' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled' | 'compensated'

export interface User {
  id: string
  name: string
  email: string
  phone: string
  operator: boolean
  has_pin: boolean
  demo?: boolean
  demo_pin?: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Card = { type: string; [key: string]: any }

export interface Message {
  id: string
  at: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  text: string
  lang: string
  plan_id: string | null
  cards: Card[]
}

/** Who a phone number belongs to, before a transfer by phone number. */
export type Directory =
  | { kind: 'self' | 'none' }
  | { kind: 'payee'; payee: { id: string; name: string; note: string | null; bank: string; account_tail: string } }
  | { kind: 'directory'; name: string; bank: string; same_bank: boolean }

export interface Provider { code: string; category: string; name: string; account_label: string; billed: boolean; top_ups: number[] | null }
export interface BillerCategory { code: string; name: string; icon: string; providers: Provider[] }
export interface SavedBill {
  id: string
  provider: Provider
  account: string
  label: string | null
  autopay: boolean
  autopay_limit_fen: number | null
  next_autopay_on: string | null
  billed_fen: number | null
  due_fen: number | null
  period: string | null
}
export interface BillLookup {
  provider: Provider
  account: string
  holder: string | null
  period: string | null
  billed_fen: number | null
  due_fen: number | null
  detail: string | null
  saved_id: string | null
  autopay: boolean
  autopay_limit_fen: number | null
  next_autopay_on: string | null
}
export interface QrMerchant { code: string; name: string; city: string; category: string; payload: string }
export type QrRead = { valid: false } | { valid: true; merchant: Omit<QrMerchant, 'payload'>; fen: number | null; order: string | null }
export type ScreenAction = 'transfer' | 'phone_transfer' | 'bill_pay' | 'bill_autopay' | 'qr_pay'

/** One past chat in the assistant's history list. */
export interface ConversationItem {
  id: string
  title: string
  updated_at: string
  messages: number
  escalated: boolean
}

export interface PlanStep {
  id: string
  action: string
  status: StepStatus
  tier: Tier | null
  rule: string | null
  rule_text: string | null
  signals: string[]
  text: string
  /** the facts to check before saying yes (payee, account, amount, arrival…); empty for actions shown by text */
  details: { label: string; value: string }[]
  signal_codes: string[]
  after: string[]
  run_at: string | null
  error: string | null
  error_code: string | null
  irreversible: boolean
  fen: number | null
}

export interface Plan {
  id: string
  status: PlanStatus
  tier: Tier
  source: string
  flags: string[]
  approval_hash: string | null
  ask: { field: string; zh: string; en: string; options: any[] } | null // eslint-disable-line @typescript-eslint/no-explicit-any
  steps: PlanStep[]
  created_at: string
  request: string
}

export interface PlanRow {
  id: string
  status: PlanStatus
  tier: Tier
  request: string
  created_at: string
  source: string
  flags: string[]
  steps: number
  actions: string[]
  fen: number | null
  reason: string | null
  outcome: 'returned' | 'cancelled' | 'waiting' | null  // what the bank did with a finished plan's transfer
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

export interface BankCard {
  id: string
  kind: 'debit' | 'virtual'
  name: string
  last4: string
  status: 'active' | 'frozen' | 'lost' | 'pending'
  daily_limit_fen: number
  online: boolean
  overseas: boolean
  atm: boolean
  contactless: boolean
  expires: string
}

export interface Lock { scope: string; reason: string; text: string; since?: string; expires_at: string | null }

export interface Overview {
  now: string
  name: string
  accounts: { id: string; kind: 'checking' | 'savings' | 'reserve'; name: string; number: string; fen: number; release_on: string | null }[]
  cash_fen: number
  invest_fen: number
  month_spend_fen: number
  month_income_fen: number
  cards: BankCard[]
  unread: number
  locks: Lock[]
  has_passkey: boolean
}

export interface Txn { id: string; at: string; merchant: string; fen: number; category: string; channel: string; status: string; kind: string }

export interface Report {
  period: 'month' | 'year'
  start: string
  end: string
  complete: boolean
  spend_fen: number
  income_fen: number
  net_fen: number
  count: number
  previous_spend_fen: number
  categories: { category: string; fen: number; share: number }[]
  top_merchants: { merchant: string; fen: number }[]
  largest: { id: string; at: string; merchant: string; fen: number; category: string }[]
  series: { label: string; fen: number }[]
}

export interface Anomaly {
  txn_id: string | null
  at: string
  merchant: string | null
  fen: number
  code: string
  reason_en: string
  reason_zh: string
  status: string
  card_id: string | null
  category?: string
  average_fen?: number
}

export interface Subscription {
  id: string
  merchant: string
  fen: number
  cycle: 'monthly' | 'yearly'
  status: 'active' | 'cancelled'
  next_charge_on: string
  category: string
  new: boolean
  remind_days_before: number | null
  charges: number
}

export interface Subscriptions {
  items: Subscription[]
  overlaps: { group: string; ids: string[]; merchants: string[]; monthly_fen: number }[]
  monthly_fen: number
}

export interface Payee {
  id: string
  name: string
  name_en: string
  note: string | null
  note_en: string | null
  bank: string
  bank_en: string
  account_tail: string
  phone: string
  relationship: string | null
  birthday: string | null
  created_at: string
}

export type TransferStatus = 'accepted' | 'clearing' | 'arrived' | 'returned' | 'cancelled'

/** A transfer as the simulated bank processes it (backend bank/transfers.py). */
export interface Transfer {
  id: string
  payee_id: string
  payee: string
  bank: string
  account_tail: string
  fen: number
  memo: string | null
  route: 'internal' | 'ibps'
  route_label: string
  arrival: 'instant' | 'standard' | 'next_day'
  arrival_label: string
  arrival_reason: string | null
  status: TransferStatus
  status_label: string
  reason: string | null
  created_at: string
  arrive_at: string
  finished_at: string | null
  cancellable: boolean
  plan_id: string | null
  events: { at: string; status: TransferStatus; text: string }[]
}

/** A text the payee's phone received from their bank (the other half of the two-phone demo). */
export interface PayeeSms {
  id: string
  at: string
  payee: string
  payee_en: string
  text: string
  text_en: string
}

export interface Scheduled {
  transfers: { id: string; payee: string; payee_en: string; fen: number; run_at: string; repeat: string; status: string }[]
  collections: { id: string; title: string; total_fen: number; status: string; participants: { name: string; name_en: string; share_fen: number; status: string }[] }[]
}

export interface Product {
  code: string
  name: string
  kind: string
  risk_level: number
  yield_bp: number
  return_1y_bp: number
  max_drawdown_bp: number
  min_fen: number
  redeem_days: number
  fee_bp: number
  description: string
  suitable: boolean
}

export interface Holding { code: string; name: string; principal_fen: number; value_fen: number; gain_fen: number; return_pct: number; since: string; risk_level: number }

export interface Wealth {
  holdings: { items: Holding[]; value_fen: number; gain_fen: number }
  products: { items: Product[]; level: number | null }
  profile: { level: number; assessed_at: string } | null
}

export interface Note { id: string; at: string; kind: string; read: boolean; title: string; body: string; suggestion: string | null }

export interface Sms { id: string; at: string; text: string; text_en: string }

export interface AuditEntry { seq: number; kind: string; plan_id: string | null; data: Record<string, unknown>; at: string; hash: string; prev_hash: string }

export interface UploadResult {
  id: string
  kind: string
  read_by: 'model' | 'rules'
  reading: { is_receipt: boolean; merchant: string; date: string | null; total_fen: number | null; items: { name: string; fen: number }[] }
  flags: string[]
  preview: string | null
}

export interface QueueItem { conversation_id: string; user: string; email: string; reason: string | null; locked: boolean }

export interface OperatorDetail {
  conversation_id: string
  escalated: boolean
  user: { name: string; email: string }
  messages: Message[]
  plans: Plan[]
  locks: { scope: string; reason: string; since: string }[]
  audit: { seq: number; kind: string; plan_id: string | null; at: string; data: Record<string, unknown> }[]
}
