import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
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
}
const ChatContext = createContext<Chat | null>(null)

const BANK_QUERIES = ['overview', 'transactions', 'report', 'cards', 'subscriptions', 'wealth', 'scheduled', 'notifications', 'audit', 'phone', 'locks', 'plans', 'payees', 'anomalies', 'clock']

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
      const body = await api.chat(message, conversationId, lang, attachmentId)
      setConversationId(body.conversation_id)
      setEscalated(body.escalated)
      setMessages((current) => [...current, ...body.messages])
      if (body.plan) showPlan(body.plan, body.messages[body.messages.length - 1]?.lang)
      refreshBank()
    } catch (err) {
      setError(errorText(err, lang))
    } finally {
      setPending(null)
    }
  }, [conversationId, lang, pending, navigate, refreshBank, showPlan])

  const apply = useCallback((result: PlanResult) => {
    setMessages((current) => [...current, ...result.messages])
    showPlan(result.plan, result.messages[result.messages.length - 1]?.lang)
    refreshBank()
  }, [refreshBank, showPlan])

  const newConversation = useCallback(async () => {
    const body = await api.newConversation()
    setConversationId(body.conversation_id)
    setMessages([])
    setEscalated(false)
    setPlanId(null)
  }, [])

  return (
    <ChatContext.Provider value={{ conversationId, messages, escalated, pending, error, planId, setPlanId, send, apply, reload, newConversation }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat outside ChatProvider')
  return ctx
}
