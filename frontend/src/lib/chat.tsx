import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useLang } from '../i18n'
import { call, errorText, type ChatResult, type Message, type PlanResult } from './api'

type Chat = {
  conversationId: string | null
  messages: Message[]
  escalated: boolean
  pending: string | null
  error: string
  planId: string | null
  setPlanId: (id: string | null) => void
  send: (text: string) => Promise<void>
  apply: (result: PlanResult) => void
  reload: () => Promise<void>
  newConversation: () => Promise<void>
}
const ChatContext = createContext<Chat | null>(null)

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
    for (const key of ['overview', 'transactions', 'report', 'cards', 'subscriptions', 'wealth', 'scheduled', 'notifications', 'audit', 'phone', 'locks', 'plans']) {
      void qc.invalidateQueries({ queryKey: [key] })
    }
  }, [qc])

  const reload = useCallback(async () => {
    const body = await call<ChatResult>(`/api/conversation${conversationId ? `?conversation_id=${conversationId}` : ''}`)
    setConversationId(body.conversation_id)
    setMessages(body.messages)
    setEscalated(body.escalated)
    const last = [...body.messages].reverse().find((m) => m.plan_id)
    if (last?.plan_id) setPlanId(last.plan_id)
  }, [conversationId])

  useEffect(() => { void reload().catch(() => undefined) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (text: string) => {
    const message = text.trim()
    if (!message || pending) return
    setPending(message)
    setError('')
    navigate('/')
    try {
      const body = await call<ChatResult>('/api/chat', { message, conversation_id: conversationId, lang })
      setConversationId(body.conversation_id)
      setEscalated(body.escalated)
      setMessages((current) => [...current, ...body.messages])
      if (body.plan) {
        setPlanId(body.plan.id)
        qc.setQueryData(['plan', body.plan.id, lang], body.plan)
      }
      refreshBank()
    } catch (err) {
      setError(errorText(err, lang))
    } finally {
      setPending(null)
    }
  }, [conversationId, lang, pending, navigate, qc, refreshBank])

  const apply = useCallback((result: PlanResult) => {
    setMessages((current) => [...current, ...result.messages])
    setPlanId(result.plan.id)
    qc.setQueryData(['plan', result.plan.id, lang], result.plan)
    refreshBank()
  }, [lang, qc, refreshBank])

  const newConversation = useCallback(async () => {
    const body = await call<ChatResult>('/api/conversation/new', {})
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
