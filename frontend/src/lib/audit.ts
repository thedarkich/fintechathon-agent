import type { AuditEntry, AuditLabels } from '../api/types'
import type { MarkKind } from '../components/Seal'
import { actionLabel } from './actions'
import { shortAddr } from './format'

type Lang = 'zh' | 'en'
export type AuditGroup = 'requests' | 'decisions' | 'actions' | 'security'

/** Each kind of audit entry: its seal, its name and the filter it belongs to. */
const KINDS: Record<string, { mark: MarkKind; zh: string; en: string; group: AuditGroup }> = {
  request: { mark: 'pending', zh: '收到请求', en: 'Request', group: 'requests' },
  places_search: { mark: 'query', zh: '搜索附近地点', en: 'Searched nearby places', group: 'requests' },
  plan_proposed: { mark: 'change', zh: '提出计划', en: 'Plan proposed', group: 'requests' },
  plan_rejected: { mark: 'refused', zh: '计划被拒', en: 'Plan rejected', group: 'security' },
  followup_error: { mark: 'change', zh: '追问未能承接', en: 'Follow-up not linked', group: 'requests' },
  followup_invalid: { mark: 'change', zh: '追问未能承接', en: 'Follow-up not linked', group: 'requests' },
  resolution: { mark: 'query', zh: '匹配记录', en: 'Matched to records', group: 'requests' },
  clarification: { mark: 'pending', zh: '追问细节', en: 'Asked a question', group: 'requests' },
  account_opened: { mark: 'done', zh: '开通账户', en: 'Account opened', group: 'security' },
  passkey_added: { mark: 'done', zh: '添加通行密钥', en: 'Passkey added', group: 'security' },
  demo_clock: { mark: 'change', zh: '演示：银行时钟前进', en: 'Demo: bank clock moved', group: 'actions' },
  demo_reset: { mark: 'change', zh: '演示：重置银行', en: 'Demo: bank reset', group: 'actions' },
  edited: { mark: 'change', zh: '修改步骤', en: 'Step edited', group: 'requests' },
  policy: { mark: 'change', zh: '规则判定', en: 'Rule decided', group: 'decisions' },
  purpose: { mark: 'change', zh: '选择用途', en: 'Purpose chosen', group: 'decisions' },
  approval_requested: { mark: 'pending', zh: '等待确认', en: 'Waiting for approval', group: 'decisions' },
  approved: { mark: 'done', zh: '已确认', en: 'Approved', group: 'decisions' },
  verified: { mark: 'done', zh: '已验证', en: 'Verified', group: 'decisions' },
  challenge_sent: { mark: 'pending', zh: '已发验证码', en: 'Code sent', group: 'decisions' },
  verification_failed: { mark: 'blocked', zh: '验证失败', en: 'Check failed', group: 'security' },
  cancelled: { mark: 'cancelled', zh: '已取消', en: 'Cancelled', group: 'decisions' },
  step_started: { mark: 'pending', zh: '开始执行', en: 'Step started', group: 'actions' },
  step_done: { mark: 'done', zh: '步骤完成', en: 'Step done', group: 'actions' },
  step_failed: { mark: 'refused', zh: '步骤未完成', en: 'Step failed', group: 'actions' },
  compensated: { mark: 'undone', zh: '已撤销', en: 'Undone', group: 'actions' },
  scheduled_check: { mark: 'scheduled', zh: '预约复核', en: 'Scheduled re-check', group: 'actions' },
  scheduled_run: { mark: 'scheduled', zh: '预约执行', en: 'Scheduled run', group: 'actions' },
  sandbox_run: { mark: 'query', zh: '沙箱运行', en: 'Sandbox run', group: 'actions' },
  upload: { mark: 'query', zh: '读取小票', en: 'Receipt read', group: 'actions' },
  reserve_released: { mark: 'change', zh: '预留退回', en: 'Reserve returned', group: 'actions' },
  transfer: { mark: 'done', zh: '转账进度', en: 'Transfer stage', group: 'actions' },
  demo_transfer: { mark: 'change', zh: '演示：推进转账', en: 'Demo: transfer moved', group: 'actions' },
  notification: { mark: 'pending', zh: '提醒', en: 'Reminder', group: 'actions' },
  screening: { mark: 'flag', zh: '安全标记', en: 'Flagged', group: 'security' },
  lock: { mark: 'blocked', zh: '安全锁开启', en: 'Safety lock on', group: 'security' },
  unlock: { mark: 'change', zh: '安全锁解除', en: 'Safety lock lifted', group: 'security' },
  operator: { mark: 'change', zh: '人工客服', en: 'Operator', group: 'security' },
  model_unavailable: { mark: 'error', zh: '模型不可用', en: 'Model unavailable', group: 'security' },
  channel_linked: { mark: 'done', zh: '绑定微信助手', en: 'WeChat linked', group: 'security' },
  channel_unlinked: { mark: 'change', zh: '解除微信绑定', en: 'WeChat unlinked', group: 'security' },
}

export const auditKind = (kind: string) => KINDS[kind] ?? { mark: 'change' as MarkKind, zh: kind, en: kind, group: 'actions' as const }

// the words the app uses elsewhere for the same things (the tier tags, the verify dialog)
const TIER: Record<string, [string, string]> = { green: ['直接办', 'Done right away'], yellow: ['需确认', 'Needs your OK'], red: ['需验证', 'Needs PIN + code'] }
const APPROVED: Record<string, [string, string]> = {
  confirm: ['你点了确认', 'You tapped Confirm'], sms: ['你输入了交易密码和短信验证码', 'You entered your PIN and an SMS code'],
  passkey: ['你输入了交易密码并用了通行密钥', 'You entered your PIN and used a passkey'],
}
const VERIFIED: Record<string, [string, string]> = { sms: ['交易密码和短信验证码都正确', 'PIN and SMS code both correct'], passkey: ['交易密码和通行密钥都通过', 'PIN and passkey both passed'] }
const FAILED: Record<string, [string, string]> = { pin: ['交易密码错误', 'Wrong PIN'], sms: ['短信验证码错误', 'Wrong SMS code'], passkey: ['通行密钥未通过', 'Passkey check failed'] }
const SOURCE: Record<string, [string, string]> = { ai: ['AI 模型', 'AI model'], offline: ['规则规划器', 'Rules planner'], followup: ['承接上文', 'Follow-up'], screen: ['App 页面', 'App screen'] }
const OPERATOR: Record<string, [string, string]> = {
  escalated: ['转给人工客服', 'Handed to bank staff'], reply: ['客服回复了你', 'Bank staff replied'],
  released: ['客服把对话交还给助手', 'Bank staff handed the chat back'], cancelled_plan: ['客服停止了这个计划', 'Bank staff stopped this plan'],
}

/**
 * What an entry records, in plain words, and the codes it holds as written (for reviewers, who can match a rule code
 * such as R_LARGE_PAYMENT to the tier table). Code meanings come from the bank (`labels`), so they match the confirm
 * cards.
 */
export function describeAudit(e: AuditEntry, labels: AuditLabels | undefined, lang: Lang): { text: string; codes: string } {
  const d = e.data as Record<string, unknown>
  const zh = lang === 'zh'
  const tr = (en: string, cn: string) => (zh ? cn : en)
  const pick = (pair: [string, string] | undefined, fallback: string) => (pair ? pair[zh ? 0 : 1] : fallback)
  const s = (v: unknown) => (v === undefined || v === null ? '' : String(v))
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  const word = (kind: string, code: unknown) => pick(labels?.[kind]?.[s(code)], s(code))
  const step = (id: unknown) => (/^s\d+$/.test(s(id)) ? tr(`Step ${s(id).slice(1)}`, `第 ${s(id).slice(1)} 步`) : s(id))
  // the bank's texts are written to stand alone: in an English list, later ones start in lower case ("…; over ¥500…")
  const join = (parts: string[]) => parts.filter(Boolean)
    .map((p, i) => (!zh && i > 0 && /^[A-Z][a-z]/.test(p) ? p[0].toLowerCase() + p.slice(1) : p)).join(zh ? '；' : '; ')
  const money = (fen: unknown) => `¥${(Number(fen) / 100).toFixed(2)}`
  const decision = () => {
    const signals = list(d.signals)
    const why = join([word('rule', d.rule), ...signals.map((x) => word('signal', x)), d.blocked_by ? word('lock', d.blocked_by) : ''])
    return {
      text: `${d.step ? `${step(d.step)} · ` : ''}${pick(TIER[s(d.tier)], s(d.tier))}${why ? (zh ? '：' : ': ') + why : ''}${d.recheck ? tr(' (checked again before running)', '（执行前复核）') : ''}`,
      codes: [s(d.step), s(d.tier), s(d.rule), signals.join(', '), d.blocked_by ? s(d.blocked_by) : ''].filter(Boolean).join(' · '),
    }
  }

  switch (e.kind) {
    case 'request': return { text: `${d.channel === 'wechat' ? tr('WeChat: ', '微信：') : ''}“${s(d.text)}”`, codes: '' }
    case 'plan_proposed': {
      const actions = ((d.plan as { steps?: { action: string }[] } | undefined)?.steps ?? []).map((x) => x.action)
      const errors = list(d.errors)
      return {
        text: `${pick(SOURCE[s(d.source)], s(d.source))}${d.model ? ` (${s(d.model)})` : ''}${zh ? '：' : ': '}${actions.map((a) => actionLabel(a, lang)).join(' → ') || tr('no steps', '无步骤')}`,
        codes: `${s(d.source)}: ${actions.join(' → ') || '—'}${errors.length ? ` · ${errors.join(', ')}` : ''}`,
      }
    }
    case 'plan_rejected': return { text: tr("It failed the bank's checks and was not used", '没有通过银行的校验，没有使用'), codes: list(d.errors).join(', ') }
    case 'followup_error': case 'followup_invalid':
      return { text: tr('The message was read on its own instead', '改为单独理解这句话'), codes: d.error ? s(d.error) : list(d.errors).join(', ') }
    case 'policy': case 'scheduled_check': return decision()
    case 'purpose': return { text: `${step(d.step)} · ${tr('what it is for', '用途')}${zh ? '：' : ': '}${word('purpose', d.purpose)}`, codes: `${s(d.step)} · ${s(d.purpose)}` }
    case 'resolution': case 'step_started': case 'step_done': case 'step_failed': case 'compensated':
      return { text: `${step(d.step)} · ${actionLabel(s(d.action), lang)}`, codes: `${s(d.step)} · ${s(d.action)}${d.code ? ` · ${s(d.code)}` : ''}` }
    case 'clarification':
      return { text: `${step(d.step)} · ${d.answered ? tr('your answer was used', '已用上你的回答') : tr('asked you for a detail', '向你询问细节')}`, codes: `${s(d.step)} · ${s(d.field)}` }
    case 'edited': return { text: `${step(d.step)} · ${tr('details changed before approval', '确认前修改了内容')}`, codes: `${s(d.step)} · ${list(d.fields).join(', ')}` }
    case 'approval_requested': return { text: `${pick(TIER[s(d.tier)], s(d.tier))} · ${list(d.steps).map(step).join(zh ? '、' : ', ')}`, codes: `${s(d.tier)} · ${list(d.steps).join(', ')}` }
    case 'approved': return { text: pick(APPROVED[s(d.method)], s(d.method)), codes: `${s(d.tier)} · ${s(d.method)}` }
    case 'verified': return { text: pick(VERIFIED[s(d.method)], s(d.method)), codes: s(d.method) }
    case 'verification_failed': return { text: pick(FAILED[s(d.factor)], s(d.factor)), codes: s(d.factor) }
    case 'challenge_sent': return { text: tr(`SMS code sent to ${s(d.phone)}`, `短信验证码已发到 ${s(d.phone)}`), codes: '' }
    case 'screening': return { text: join(list(d.flags).map((x) => word('flag', x))), codes: list(d.flags).join(', ') }
    case 'lock': return { text: word('lock', d.reason), codes: `${s(d.scope)} · ${s(d.reason)}` }
    case 'unlock': return { text: d.by === 'operator' ? tr('Lifted by bank staff', '由客服解除') : tr('Lifted after you verified', '你验证身份后解除'), codes: `${s(d.scope)} · ${s(d.reason)} · ${s(d.by)}` }
    case 'transfer':
      return {
        text: [word('status', d.status), word('route', d.route), word('arrival', d.arrival), money(d.fen), d.reason ? word('return', d.reason) : ''].filter(Boolean).join(' · '),
        codes: [s(d.status), s(d.route), s(d.arrival), s(d.reason)].filter(Boolean).join(' · '),
      }
    case 'scheduled_run': return { text: tr(`${money(d.fen)} sent as scheduled`, `已按预约转出 ${money(d.fen)}`), codes: '' }
    case 'reserve_released': return { text: tr('The unused money set aside went back to your account', '没用完的预留资金已退回账户'), codes: '' }
    case 'sandbox_run':
      return { text: d.error ? tr('The analysis code was stopped in the sandbox', '分析代码在沙箱里被拦下') : tr(`The analysis code ran in the sandbox (${s(d.ms)} ms)`, `分析代码在沙箱里运行（${s(d.ms)} 毫秒）`),
        codes: `${shortAddr(s(d.code_hash), 8, 6)}${d.error ? ` · ${s(d.error)}` : ''}` }
    case 'upload': {
      const flags = list(d.flags)
      const read = d.read_by === 'model' ? tr('read by the AI model', '由 AI 模型读取') : tr('read by the rules', '由规则读取')
      return { text: join([`${d.kind === 'pdf' ? 'PDF' : tr('Photo', '照片')} ${read}`, ...flags.map((x) => word('flag', x))]), codes: [s(d.kind), s(d.read_by), flags.join(', ')].filter(Boolean).join(' · ') }
    }
    case 'cancelled': return { text: `${tr('stopped', '停止')} ${s(d.stopped)} · ${tr('undone', '撤销')} ${s(d.compensated)}`, codes: '' }
    case 'operator': return { text: pick(OPERATOR[s(d.event)], s(d.event)), codes: '' }
    case 'model_unavailable': return { text: tr("The AI model didn't answer; the rules planner answered instead", 'AI 模型没有回应，改由规则规划器回答'), codes: s(d.error) }
    case 'channel_linked': return { text: tr(`WeChat ID ${s(d.openid)}`, `微信号 ${s(d.openid)}`), codes: '' }
    case 'channel_unlinked': return { text: tr('This WeChat can no longer reach the account', '这个微信不能再访问账户'), codes: '' }
    case 'passkey_added': return { text: s(d.label), codes: '' }
    case 'notification': {
      const [kind, , extra] = s(d.key).split(':')
      const names: Record<string, [string, string]> = {
        birthday: ['生日提醒', 'Birthday reminder'], anomaly: ['可疑交易提醒', 'Unusual transaction alert'],
        collection: ['AA 收款通知', 'Split bill update'], declined: ['交易被拒通知', 'Declined payment notice'],
        plan: ['计划通知', 'Plan update'], renewal: ['续费提醒', 'Renewal reminder'],
        scheduled: ['预约转账通知', 'Scheduled transfer notice'], transfer: ['转账通知', 'Transfer update'],
      }
      const name = pick(names[kind], kind)
      return { text: kind === 'birthday' && extra ? `${name} · ${extra}` : name, codes: '' }
    }
    case 'demo_transfer': return { text: d.outcome === 'return' ? tr('the payee bank returns it', '对方银行退回') : tr('cleared now', '立即清算'), codes: '' }
    case 'demo_clock': {
      const hours = Math.round(Number(d.advanced_seconds) / 3600)
      return { text: hours % 24 === 0 ? tr(`${hours / 24} day(s) forward`, `前进 ${hours / 24} 天`) : tr(`${hours} hour(s) forward`, `前进 ${hours} 小时`), codes: '' }
    }
    case 'demo_reset': return { text: tr('Every simulated record back to the start', '所有模拟数据回到初始状态'), codes: '' }
    case 'account_opened': return { text: d.demo ? tr('demo account with its own simulated bank', '演示账户，自带模拟银行') : tr('simulated bank opened', '模拟银行已开通'), codes: '' }
    default: return { text: '', codes: JSON.stringify(d).slice(0, 140) }
  }
}
