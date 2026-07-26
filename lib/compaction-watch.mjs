import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

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
    retentionDays: integer(env.COMPACTION_WATCH_RETENTION_DAYS, 7, 0),
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
  return { automatic: 0, manual: 0, notices: {}, pending: null, prompts: 0, repeatNotice: null }
}

function validState(value) {
  if (!value || typeof value !== 'object') return null
  const automaticCount = integer(value.automatic ?? value.count, -1)
  const manualCount = integer(value.manual, 0)
  if (automaticCount < 0 || manualCount < 0) return null
  return { automatic: automaticCount, manual: manualCount, notices: value.notices && typeof value.notices === 'object' ? value.notices : {}, pending: value.pending && typeof value.pending === 'object' ? value.pending : null, prompts: integer(value.prompts, 0), repeatNotice: value.repeatNotice && typeof value.repeatNotice === 'object' ? value.repeatNotice : null }
}

async function load(file) {
  try {
    const state = validState(JSON.parse(await readFile(file, 'utf8')))
    return { state: state || emptyState(), corrupt: !state }
  } catch (error) {
    return { state: emptyState(), corrupt: error?.code !== 'ENOENT' }
  }
}

async function atomicWrite(file, value) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
  await rename(temporary, file)
}

async function lock(path, wait = 5000) {
  const until = Date.now() + wait
  while (Date.now() < until) {
    try {
      await mkdir(path)
      return true
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      await sleep(10)
    }
  }
  return false
}

function statusFrom(state, input, options, extra = {}) {
  const config = settings(options)
  const manual = state.manual
  const automaticCount = state.automatic
  const count = automaticCount + (config.autoOnly ? 0 : manual)
  const level = count >= config.strong ? 'strong' : count >= config.soft ? 'soft' : 'none'
  return { ...identity(input, options), automatic: automaticCount, count, level, manual, thresholds: { soft: config.soft, strong: config.strong }, trigger: String(input.trigger || 'auto'), warningDue: false, ...extra }
}

function noticeDue(state, status, config) {
  if (status.level === 'none') return false
  const scope = config.autoOnly ? 'automatic' : 'all'
  const previous = state.notices[scope] || { count: 0, level: 'none' }
  return previous.level !== status.level
}

export async function recordCompaction(input = {}, options = {}) {
  const supplied = request(input, options)
  input = supplied.event
  options = supplied.options
  try {
    const root = directory(options)
    const id = identity(input, options)
    const file = join(root, `${id.key}.json`)
    const lockPath = `${file}.lock`
    await mkdir(root, { recursive: true, mode: 0o700 })
    if (!await lock(lockPath, integer(options.lockWaitMs, 1000, 1))) {
      const current = await load(file)
      return statusFrom(current.state, input, options, { blocked: true, corrupt: current.corrupt })
    }
    try {
      const current = await load(file)
      const state = current.state
      if (automatic(input.trigger)) state.automatic++
      else state.manual++
      const status = statusFrom(state, input, options, { corrupt: current.corrupt })
      const config = settings(options)
      status.warningDue = noticeDue(state, status, config)
      if (status.warningDue) {
        state.notices[config.autoOnly ? 'automatic' : 'all'] = { count: status.count, level: status.level }
        state.pending = { count: status.count, level: status.level, thresholds: status.thresholds }
      }
      state.updatedAt = new Date().toISOString()
      await atomicWrite(file, state)
      return status
    } finally {
      await rmdir(lockPath).catch(() => {})
    }
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
    const file = join(root, `${id.key}.json`)
    const lockPath = `${file}.lock`
    await mkdir(root, { recursive: true, mode: 0o700 })
    if (!await lock(lockPath, integer(options.lockWaitMs, 1000, 1))) return null
    try {
      const current = await load(file)
      if (!current.state.pending) return null
      const pending = current.state.pending
      current.state.pending = null
      current.state.repeatNotice = { prompt: current.state.prompts, level: pending.level }
      current.state.updatedAt = new Date().toISOString()
      await atomicWrite(file, current.state)
      return statusFrom(current.state, input, options, { count: pending.count, level: pending.level, thresholds: pending.thresholds, warningDue: true })
    } finally {
      await rmdir(lockPath).catch(() => {})
    }
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
    const file = join(root, `${id.key}.json`)
    const lockPath = `${file}.lock`
    await mkdir(root, { recursive: true, mode: 0o700 })
    if (!await lock(lockPath, integer(options.lockWaitMs, 1000, 1))) return null
    try {
      const current = await load(file)
      const config = settings(options)
      const state = current.state
      state.prompts++
      const status = statusFrom(state, input, options)
      const previous = state.repeatNotice
      const due = status.level !== 'none' && !state.pending && (!previous || previous.level !== status.level || state.prompts - integer(previous.prompt, 0) >= config.cadence)
      if (due) state.repeatNotice = { prompt: state.prompts, level: status.level }
      state.updatedAt = new Date().toISOString()
      await atomicWrite(file, state)
      return due ? { ...status, warningDue: true } : null
    } finally {
      await rmdir(lockPath).catch(() => {})
    }
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
    const current = await load(join(root, `${id.key}.json`))
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

export async function prune(options = {}) {
  const root = directory(options)
  const cutoff = Date.now() - settings(options).retentionDays * 86400000
  let removed = 0
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      if ((await stat(join(root, entry.name))).mtimeMs < cutoff) {
        await rm(join(root, entry.name))
        removed++
      }
    }
  } catch {}
  return removed
}
