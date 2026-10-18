import { useSyncExternalStore } from 'react'

/**
 * Large text (长辈版 / 大字版): everything 25% bigger, and Home reduced to the four things people do most.
 * Banks in mainland China offer this mode for older customers. The choice is remembered on this device
 * and applied before the first paint (see index.html).
 */
export type TextSize = 'normal' | 'large'
const KEY = 'ba_text'
const listeners = new Set<() => void>()

function saved(): TextSize {
  try {
    return localStorage.getItem(KEY) === 'large' ? 'large' : 'normal'
  } catch {
    return 'normal'
  }
}

let current: TextSize = typeof window !== 'undefined' ? saved() : 'normal'

function apply(size: TextSize) {
  document.documentElement.setAttribute('data-text', size)
}

export function setTextSize(size: TextSize) {
  current = size
  apply(size)
  try {
    localStorage.setItem(KEY, size)
  } catch {
    /* storage blocked: the choice lasts for this page */
  }
  listeners.forEach((listener) => listener())
}

export function useTextSize(): [TextSize, (size: TextSize) => void] {
  const size = useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => current, () => 'normal' as TextSize)
  return [size, setTextSize]
}
