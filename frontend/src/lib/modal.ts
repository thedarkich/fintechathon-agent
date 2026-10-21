import { useEffect, useRef, type RefObject } from 'react'

const stack: HTMLElement[] = []

/**
 * A modal window: the page behind stops scrolling, focus moves in and goes back where it was on close, and Escape
 * closes only the window on top (the verification dialog can open over a request's details).
 * Runs once per opening, so a parent re-rendering never pulls focus back to the first field.
 */
export function useModal(ref: RefObject<HTMLElement>, onClose: () => void, focus: (el: HTMLElement) => void = (el) => el.focus()) {
  const close = useRef(onClose)
  close.current = onClose
  const first = useRef(focus)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    stack.push(el)
    first.current(el)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && stack[stack.length - 1] === el) close.current() }
    window.addEventListener('keydown', onKey)
    return () => {
      stack.splice(stack.indexOf(el), 1)
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
      before?.focus?.({ preventScroll: true })
    }
  }, [ref])
}
