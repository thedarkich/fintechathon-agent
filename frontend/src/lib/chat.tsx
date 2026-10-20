import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useLang } from '../i18n'
import { api, errorText } from '../api/client'
import type { Message, Plan, PlanResult } from '../api/types'

type Chat = {
  conversationId: string | null
  messages: Message[]
  escalated: boolean
  pending: string | null
  error: string
  planId: string | null
  setPlanId: (id: string | null) => void
  send: (text: string, attachmentId?: string) => Promise<void>
  apply: (result: PlanResult) => void
  reload: () => Promise<void>
  newConversation: () => Promise<void>
  openConversation: (id: string) => Promise<void>
}
const ChatContext = createContext<Chat | null>(null)

const BANK_QUERIES = ['conversations', 'bills', 'transfers', 'overview', 'transactions', 'report', 'cards', 'subscriptions', 'wealth', 'scheduled', 'notifications', 'audit', 'phone', 'locks', 'plans', 'payees', 'anomalies', 'clock']

/** One conversation shared by every workspace page, so a button on Controls can ask the assistant and land here. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { lang } = useLang()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [escalated, setEscalated] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [planId, setPlanId] = useState<string | null>(null)
  const starting = useRef<Promise<string> | null>(null)  // a new chat the server is still opening

  const refreshBank = useCallback(() => {
    for (const key of BANK_QUERIES) void qc.invalidateQueries({ queryKey: [key] })
  }, [qc])

  /** A reply's plan is written in the language the customer typed; the slip follows the interface language. */
  const showPlan = useCallback((plan: Plan, written: string | undefined) => {
    setPlanId(plan.id)
    if (!written || written === lang) qc.setQueryData(['plan', plan.id, lang], plan)
    else void qc.invalidateQueries({ queryKey: ['plan', plan.id, lang] })
  }, [lang, qc])

  const reload = useCallback(async () => {
    const body = await api.conversation(conversationId)
    setConversationId(body.conversation_id)
    setMessages(body.messages)
    setEscalated(body.escalated)
    const last = [...body.messages].reverse().find((m) => m.plan_id)
    if (last?.plan_id) setPlanId(last.plan_id)
  }, [conversationId])

  useEffect(() => { void reload().catch(() => undefined) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (text: string, attachmentId?: string) => {
    const message = text.trim()
    if (!message || pending) return
    setPending(message)
    setError('')
    navigate('/assistant')
    try {
      // a message typed straight after "New chat" belongs to the new chat, not the one on screen before it
      const target = starting.current ? await starting.current.catch(() => conversationId) : conversationId
      const body = await api.chat(message, target, lang, attachmentId)
      setConversationId(body.conversation_id)
      setEscalated(body.escalated)
      setMessages((current) => [...current, ...body.messages])
      // a follow-up can replace or stop an earlier card ('改成300', '算了'): every card on screen re-reads its plan
      void qc.invalidateQueries({ queryKey: ['plan'] })
      if (body.plan) showPlan(body.plan, body.messages[body.messages.length - 1]?.lang)
      refreshBank()
    } catch (err) {
      setError(errorText(err, lang))
    } finally {
      setPending(null)
    }
  }, [conversationId, lang, pending, navigate, qc, refreshBank, showPlan])

  const apply = useCallback((result: PlanResult) => {
    if (result.plan.source === 'screen') {
      qc.setQueryData(['plan', result.plan.id, lang], result.plan)
      refreshBank()
      return
    }
    setMessages((current) => [...current, ...result.messages])
    showPlan(result.plan, result.messages[result.messages.length - 1]?.lang)
    refreshBank()
  }, [lang, qc, refreshBank, showPlan])

  const newConversation = useCallback(async () => {
    setMessages([])
    setEscalated(false)
    setPlanId(null)
    setError('')
    const started = api.newConversation().then((body) => body.conversation_id)
    starting.current = started
    try {
      setConversationId(await started)
    } finally {
      if (starting.current === started) starting.current = null
    }
  }, [])

  /** A chat from the history list: its messages come back as they were, cards and all. */
  const openConversation = useCallback(async (id: string) => {
    try {
      const body = await api.conversation(id)
      setConversationId(body.conversation_id)
      setMessages(body.messages)
      setEscalated(body.escalated)
      setError('')
      setPlanId([...body.messages].reverse().find((m) => m.plan_id)?.plan_id ?? null)
    } catch (err) {
      setError(errorText(err, lang))
    }
  }, [lang])

  return (
    <ChatContext.Provider value={{ conversationId, messages, escalated, pending, error, planId, setPlanId, send, apply, reload, newConversation, openConversation }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat outside ChatProvider')
  return ctx
}
