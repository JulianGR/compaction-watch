#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { claimNotification, claimRepeatNotification, formatWarning, notificationCommand, prune, readStatus, recordCompaction } from '../lib/compaction-watch.mjs'

async function input() {
  try {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  } catch {
    return {}
  }
}

function notify(message) {
  const command = notificationCommand(process.platform, 'compaction-watch', message)
  if (!command) return
  try {
    const child = spawn(command.command, command.args, { detached: true, stdio: 'ignore' })
    child.unref()
    child.on('error', () => {})
  } catch {}
}

function hostOutput(message, host) {
  return String(host || process.env.AGENT_COMPACTION_WATCH_HOST || '').toLowerCase() === 'codex' ? JSON.stringify({ systemMessage: message }) : message
}

async function main() {
  const command = process.argv[2] || 'count'
  const hostIndex = process.argv.indexOf('--host')
  const host = hostIndex >= 0 ? process.argv[hostIndex + 1] : undefined
  if (command === 'prune') return process.stdout.write(`${await prune()}\n`)
  const payload = await input()
  const request = { host, event: payload }
  if (command === 'status') return process.stdout.write(`${JSON.stringify(await readStatus(request))}\n`)
  if (command === 'count') {
    await recordCompaction(request)
    return
  }
  if (command === 'notify') {
    const status = process.argv.includes('--repeat') ? await claimRepeatNotification(request) : await claimNotification(request)
    const message = status?.warningDue ? formatWarning(status) : null
    if (message) {
      if (!process.argv.includes('--repeat')) notify(message)
      process.stdout.write(`${hostOutput(message, host)}\n`)
    }
    return
  }
  process.stderr.write('Usage: compaction-watch <count|notify|status|prune>\n')
  process.exitCode = 1
}

main().catch(() => { process.exitCode = 0 })
