/** WeChat's in-app browser (and, later, a mini-program web-view) reports MicroMessenger in its user agent. */
export const inWeChat = () => typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent)

/** Inside a mini-program web-view, WeChat also sets this flag. */
export const inMiniProgram = () =>
  inWeChat() && (/miniProgram/i.test(navigator.userAgent) || (window as unknown as { __wxjs_environment?: string }).__wxjs_environment === 'miniprogram')
