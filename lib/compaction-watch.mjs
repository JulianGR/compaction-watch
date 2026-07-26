import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join, resolve } from 'node:path'

const levels = ['none', 'soft', 'strong']

function integer(value, fallback, minimum = 0) {
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback
}

function enabled(value, fallback) {
  if (value === undefined) return fallback
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase())
}

function settings(options = {}) {
  const env = options.env || process.env
  const specified = options.thresholds || {}
  const soft = integer(specified.soft ?? env.COMPACTION_WATCH_SOFT_THRESHOLD ?? env.COMPACTION_WATCH_PREWARN_THRESHOLD, 5, 1)
  const strong = Math.max(soft, integer(specified.strong ?? env.COMPACTION_WATCH_STRONG_THRESHOLD ?? env.COMPACTION_WATCH_THRESHOLD, 10, 1))
  return {
    autoOnly: enabled(env.COMPACTION_WATCH_AUTO_ONLY, !enabled(env.COMPACTION_WATCH_INCLUDE_MANUAL, false)),
    cadence: integer(env.COMPACTION_WATCH_REMIND_EVERY, 5, 1),
    soft,
    strong
  }
}

function directory(options = {}) {
  const env = options.env || process.env
  return options.stateDir || env.AGENT_COMPACTION_WATCH_HOME || join(homedir(), '.agent-compaction-watch')
}

function automatic(trigger) {
  return ['auto', 'automatic'].includes(String(trigger || 'auto').toLowerCase())
}

function identity(input = {}, options = {}) {
  const platform = options.platform || process.platform
  let cwd = resolve(String(input.cwd || process.cwd()))
  if (platform === 'win32') cwd = cwd.toLowerCase()
  const host = String(options.host || hostname())
  const session = String(input.session_id || 'unknown')
  const key = createHash('sha256').update(`${host}\0${cwd}\0${session}`).digest('hex')
  return { cwd, host, key, session }
}

function request(input = {}, options = {}) {
  const event = input.event && typeof input.event === 'object' ? input.event : input
  return {
    event,
    options: {
      ...options,
      host: input.host ?? options.host,
      stateDir: input.stateRoot ?? options.stateDir,
      thresholds: input.thresholds ?? options.thresholds
    }
  }
}

function emptyState() {
  return { automatic: 0, manual: 0, notices: {}, pending: null, prompts: 0, repeatNotice: null, claims: {}, repeats: {} }
}

function validState(value) {
  if (!value || typeof value !== 'object') return null
  const automaticCount = integer(value.automatic ?? value.count, -1)
  const manualCount = integer(value.manual, 0)
  if (automaticCount < 0 || manualCount < 0) return null
  return { automatic: automaticCount, manual: manualCount, notices: value.notices && typeof value.notices === 'object' ? value.notices : {}, pending: value.pending && typeof value.pending === 'object' ? value.pending : null, prompts: integer(value.prompts, 0), repeatNotice: value.repeatNotice && typeof value.repeatNotice === 'object' ? value.repeatNotice : null, claims: {}, repeats: {} }
}

async function load(file) {
  try {
    const state = validState(JSON.parse(await readFile(file, 'utf8')))
    return { state: state || emptyState(), corrupt: !state }
  } catch (error) {
    return { state: emptyState(), corrupt: error?.code !== 'ENOENT' }
  }
}

function claim(state, scope, level) {
  return state.claims[scope]?.[level] || null
}

function addClaim(state, scope, level, value) {
  state.claims[scope] ||= {}
  state.claims[scope][level] = value
}

function addRepeat(state, scope, level, value) {
  state.repeats[scope] ||= {}
  const previous = state.repeats[scope][level]
  if (!previous || integer(value.prompt, 0) >= integer(previous.prompt, 0)) state.repeats[scope][level] = value
}

function inheritClaims(state) {
  for (const [scope, notice] of Object.entries(state.notices)) {
    const level = levels.indexOf(notice?.level)
    for (const value of levels.slice(1, level + 1)) {
      if (state.pending?.level !== value) addClaim(state, scope, value, { prompt: integer(state.repeatNotice?.prompt, 0) })
    }
  }
  if (state.repeatNotice?.level) addRepeat(state, 'automatic', state.repeatNotice.level, state.repeatNotice)
}

async function loadState(root, key) {
  const legacy = await load(join(root, `${key}.json`))
  const state = legacy.state
  let corrupt = legacy.corrupt
  inheritClaims(state)
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const match = entry.isFile() && entry.name.match(new RegExp(`^${key}\\.(event|prompt|notice|repeat)\\..+\\.json$`))
      if (!match) continue
      try {
        const value = JSON.parse(await readFile(join(root, entry.name), 'utf8'))
        if (match[1] === 'event' && typeof value === 'object') {
          if (automatic(value.trigger)) state.automatic++
          else state.manual++
        } else if (match[1] === 'prompt') {
          state.prompts++
        } else if (match[1] === 'notice' && value?.scope && levels.includes(value.level)) {
          addClaim(state, value.scope, value.level, value)
        } else if (match[1] === 'repeat' && value?.scope && levels.includes(value.level)) {
          addRepeat(state, value.scope, value.level, value)
        }
      } catch {
        corrupt = true
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') corrupt = true
  }
  return { state, corrupt }
}

async function append(root, key, type, value) {
  const file = join(root, `${key}.${type}.${randomUUID()}.json`)
  const temporary = `${file}.tmp`
  await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
  await rename(temporary, file)
}

async function create(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
    await link(temporary, file)
    return true
  } catch (error) {
    if (error?.code === 'EEXIST') return false
    throw error
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

function statusFrom(state, input, options, extra = {}) {
  const config = settings(options)
  const manual = state.manual
  const automaticCount = state.automatic
  const count = automaticCount + (config.autoOnly ? 0 : manual)
  const level = count >= config.strong ? 'strong' : count >= config.soft ? 'soft' : 'none'
  return { ...identity(input, options), automatic: automaticCount, count, level, manual, thresholds: { soft: config.soft, strong: config.strong }, trigger: String(input.trigger || 'auto'), warningDue: false, ...extra }
}

function pendingNotice(state, status, config) {
  const scope = config.autoOnly ? 'automatic' : 'all'
  if (state.pending && !claim(state, scope, state.pending.level)) return state.pending
  if (status.level === 'none') return null
  if (status.level === 'strong' && !claim(state, scope, 'strong')) return { count: config.strong, level: 'strong', thresholds: status.thresholds }
  if (!claim(state, scope, 'soft')) return { count: config.soft, level: 'soft', thresholds: status.thresholds }
  return null
}

export async function recordCompaction(input = {}, options = {}) {
  const supplied = request(input, options)
  input = supplied.event
  options = supplied.options
  try {
    const root = directory(options)
    const id = identity(input, options)
    await mkdir(root, { recursive: true, mode: 0o700 })
    const before = await loadState(root, id.key)
    const previous = statusFrom(before.state, input, options)
    await append(root, id.key, 'event', { trigger: input.trigger })
    const current = await loadState(root, id.key)
    const status = statusFrom(current.state, input, options, { corrupt: current.corrupt })
    status.warningDue = status.level !== 'none' && status.level !== previous.level
    return status
  } catch {
    return statusFrom(emptyState(), input, options, { failed: true })
  }
}

export async function claimNotification(input = {}, options = {}) {
  const supplied = request(input, options)
  input = supplied.event
  options = supplied.options
  try {
    const root = directory(options)
    const id = identity(input, options)
    await mkdir(root, { recursive: true, mode: 0o700 })
    const current = await loadState(root, id.key)
    const status = statusFrom(current.state, input, options)
    const config = settings(options)
    const pending = pendingNotice(current.state, status, config)
    if (!pending) return null
    const scope = config.autoOnly ? 'automatic' : 'all'
    if (!await create(join(root, `${id.key}.notice.${scope}.${pending.level}.json`), { scope, level: pending.level, prompt: current.state.prompts })) return null
    return { ...status, count: pending.count, level: pending.level, thresholds: pending.thresholds, warningDue: true }
  } catch {
    return null
  }
}

export async function claimRepeatNotification(input = {}, options = {}) {
  const supplied = request(input, options)
  input = supplied.event
  options = supplied.options
  try {
    const root = directory(options)
    const id = identity(input, options)
    await mkdir(root, { recursive: true, mode: 0o700 })
    await append(root, id.key, 'prompt', {})
    const current = await loadState(root, id.key)
    const config = settings(options)
    const status = statusFrom(current.state, input, options)
    const pending = pendingNotice(current.state, status, config)
    const scope = config.autoOnly ? 'automatic' : 'all'
    if (pending) {
      if (!await create(join(root, `${id.key}.notice.${scope}.${pending.level}.json`), { scope, level: pending.level, prompt: current.state.prompts })) return null
      return { ...status, count: pending.count, level: pending.level, thresholds: pending.thresholds, warningDue: true }
    }
    if (status.level === 'none') return null
    const previous = current.state.repeats[scope]?.[status.level] || claim(current.state, scope, status.level)
    const prompt = current.state.prompts
    if (!previous || prompt - integer(previous.prompt, 0) < config.cadence) return null
    const slot = Math.floor((prompt - integer(previous.prompt, 0)) / config.cadence)
    if (!await create(join(root, `${id.key}.repeat.${scope}.${status.level}.${integer(previous.prompt, 0)}.${slot}.json`), { scope, level: status.level, prompt })) return null
    return { ...status, warningDue: true }
  } catch {
    return null
  }
}

export async function readStatus(input = {}, options = {}) {
  const supplied = request(input, options)
  input = supplied.event
  options = supplied.options
  try {
    const root = directory(options)
    const id = identity(input, options)
    const current = await loadState(root, id.key)
    return statusFrom(current.state, input, options, { corrupt: current.corrupt })
  } catch {
    return statusFrom(emptyState(), input, options, { failed: true })
  }
}

export function formatWarning(status = {}) {
  if (!levels.includes(status.level) || status.level === 'none') return null
  const count = integer(status.count, 0)
  const threshold = status.level === 'strong' ? status.thresholds?.strong : status.thresholds?.soft
  return status.level === 'strong'
    ? `compaction-watch: ${count} compactions reached the strong threshold (${threshold}). Start a fresh session soon.`
    : `compaction-watch: ${count} compactions reached the soft threshold (${threshold}). Consider wrapping up this session.`
}

export function notificationCommand(platform, title, body) {
  const heading = String(title)
  const text = String(body)
  if (platform === 'linux') return { command: 'notify-send', args: [heading, text] }
  if (platform === 'darwin') return { command: 'osascript', args: ['-e', `display notification "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}" with title "${heading.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`] }
  if (platform === 'win32') {
    const quote = value => `'${value.replace(/'/g, "''").replace(/[\r\n]+/g, ' ')}'`
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `$m=${quote(text)};$t=${quote(heading)};(New-Object -ComObject Wscript.Shell).Popup($m,5,$t,64)|Out-Null`] }
  }
  return null
}

export async function prune() {
  return 0
}
