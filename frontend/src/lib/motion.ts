import { useEffect } from 'react'

export const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The parts of each section rise into place once, in turn, as the section scrolls in. Without script, or with
 *  reduced motion, nothing is ever hidden: the page only opts in to the starting state once this runs. */
export function useRise() {
  useEffect(() => {
    const root = document.documentElement
    if (reduceMotion() || !('IntersectionObserver' in window)) return
    root.classList.add('lx-motion')
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } })
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
    document.querySelectorAll('[data-rise]').forEach((el) => io.observe(el))
    return () => { io.disconnect(); root.classList.remove('lx-motion') }
  }, [])
}
