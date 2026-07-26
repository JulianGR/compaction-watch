import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { formatWarning, notificationCommand, prune, readStatus, recordCompaction } from '../lib/compaction-watch.mjs'

async function makeStateDir() {
  return mkdtemp(join(tmpdir(), 'compaction-watch-'))
}

function hook(session_id = 'session-a', cwd = '/project-a', trigger = 'auto') {
  return { session_id, cwd, trigger }
}

function cli(args, payload, stateDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/compaction-watch.mjs', ...args], { cwd: new URL('..', import.meta.url), env: { ...process.env, AGENT_COMPACTION_WATCH_HOME: stateDir } })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`cli exited ${code}`)))
    child.stdin.end(JSON.stringify(payload))
  })
}

test('the fifth automatic compaction is a soft warning', async () => {
  const stateDir = await makeStateDir()
  try {
    let status
    const request = { host: 'codex', event: hook(), stateRoot: stateDir }
    for (let count = 0; count < 5; count++) status = await recordCompaction(request)
    assert.equal(status.count, 5)
    assert.equal(status.host, 'codex')
    assert.equal(status.level, 'soft')
    assert.match(formatWarning(status), /5 compactions/)
    assert.equal(status.warningDue, true)
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('manual compactions are excluded by default and included when overridden', async () => {
  const stateDir = await makeStateDir()
  try {
    const manual = await recordCompaction(hook('manual', '/project-a', 'manual'), { stateDir })
    assert.equal(manual.count, 0)
    assert.equal(manual.manual, 1)
    const included = await recordCompaction(hook('manual', '/project-a', 'manual'), { stateDir, env: { COMPACTION_WATCH_AUTO_ONLY: '0' } })
    assert.equal(included.count, 2)
    assert.equal(included.manual, 2)
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('state is isolated by host, session and normalized project path', async () => {
  const stateDir = await makeStateDir()
  try {
    await recordCompaction(hook('one', '/project/child/..'), { stateDir })
    await recordCompaction(hook('two', '/project'), { stateDir })
    await recordCompaction(hook('one', '/project'), { stateDir, host: 'other-host' })
    assert.equal((await readStatus(hook('one', '/project'), { stateDir })).count, 1)
    assert.equal((await readStatus(hook('two', '/project'), { stateDir })).count, 1)
    assert.equal((await readStatus(hook('one', '/project'), { stateDir, host: 'other-host' })).count, 1)
    assert.equal((await readStatus(hook('one', '/other'), { stateDir })).count, 0)
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('corrupt state recovers without throwing', async () => {
  const stateDir = await makeStateDir()
  try {
    await recordCompaction(hook(), { stateDir })
    const [name] = await readdir(stateDir)
    await writeFile(join(stateDir, name), '{')
    const status = await recordCompaction(hook(), { stateDir })
    assert.equal(status.count, 1)
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('threshold crossings are reported at the expected counts', async () => {
  const stateDir = await makeStateDir()
  try {
    let status
    for (let count = 0; count < 13; count++) {
      status = await recordCompaction(hook(), { stateDir, env: { COMPACTION_WATCH_REMIND_EVERY: '3' } })
      if ([5, 10].includes(status.count)) assert.equal(status.warningDue, true)
      else assert.equal(status.warningDue, false)
    }
    assert.equal(status.level, 'strong')
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('notification selection is native and safely argument based', () => {
  assert.deepEqual(notificationCommand('linux', 'title', 'a "quoted" message'), { command: 'notify-send', args: ['title', 'a "quoted" message'] })
  assert.equal(notificationCommand('darwin', 'title', 'a "quoted" message').command, 'osascript')
  const windows = notificationCommand('win32', "title'; Remove-Item", "a 'quoted' message")
  assert.equal(windows.command, 'powershell.exe')
  assert.match(windows.args.join(' '), /title''; Remove-Item/)
  assert.equal(notificationCommand('freebsd', 'title', 'body'), null)
})

test('count then notify increments once and only emits each pending threshold once', async () => {
  const stateDir = await makeStateDir()
  const event = hook('cli', '/project')
  try {
    for (let count = 0; count < 5; count++) assert.equal(await cli(['count', '--host', 'codex'], event, stateDir), '')
    const first = JSON.parse(await cli(['notify', '--host', 'codex'], event, stateDir))
    assert.match(first.systemMessage, /5 compactions/)
    assert.equal(await cli(['notify', '--host', 'codex'], event, stateDir), '')
    const status = JSON.parse(await cli(['status', '--host', 'codex'], event, stateDir))
    assert.equal(status.count, 5)
    for (let count = 0; count < 5; count++) await cli(['count', '--host', 'codex'], event, stateDir)
    const repeated = JSON.parse(await cli(['notify', '--host', 'codex'], event, stateDir))
    assert.match(repeated.systemMessage, /10 compactions/)
    assert.equal(await cli(['notify', '--host', 'codex'], event, stateDir), '')
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('repeat reminders are paced by prompts and never increment the compaction count', async () => {
  const stateDir = await makeStateDir()
  const event = hook('repeat', '/project')
  try {
    for (let count = 0; count < 5; count++) await cli(['count', '--host', 'claude'], event, stateDir)
    assert.match(await cli(['notify', '--host', 'claude'], event, stateDir), /5 compactions/)
    for (let prompt = 0; prompt < 4; prompt++) assert.equal(await cli(['notify', '--repeat', '--host', 'claude'], event, stateDir), '')
    assert.match(await cli(['notify', '--repeat', '--host', 'claude'], event, stateDir), /5 compactions/)
    const status = JSON.parse(await cli(['status', '--host', 'claude'], event, stateDir))
    assert.equal(status.count, 5)
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('a repeat delivers an undelivered threshold alert without incrementing the count', async () => {
  const stateDir = await makeStateDir()
  const event = hook('repeat-fallback', '/project')
  try {
    for (let count = 0; count < 5; count++) await cli(['count', '--host', 'claude'], event, stateDir)
    assert.match(await cli(['notify', '--repeat', '--host', 'claude'], event, stateDir), /5 compactions/)
    assert.equal(await cli(['notify', '--repeat', '--host', 'claude'], event, stateDir), '')
    assert.equal(JSON.parse(await cli(['status', '--host', 'claude'], event, stateDir)).count, 5)
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('a leftover legacy lock artifact does not block later counts', async () => {
  const stateDir = await makeStateDir()
  try {
    await recordCompaction(hook('legacy-lock'), { stateDir })
    const [entry] = await readdir(stateDir)
    const key = entry.match(/^[a-f0-9]{64}/)?.[0]
    await mkdir(join(stateDir, `${key}.json.lock`))
    assert.equal((await recordCompaction(hook('legacy-lock'), { stateDir })).count, 2)
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('pruning retains every event for an active session', async () => {
  const stateDir = await makeStateDir()
  const event = hook('active-retention')
  try {
    for (let count = 0; count < 5; count++) await recordCompaction(event, { stateDir })
    const old = new Date(Date.now() - 172800000)
    for (const name of await readdir(stateDir)) await utimes(join(stateDir, name), old, old)
    await recordCompaction(event, { stateDir })
    assert.equal(await prune({ stateDir, env: { COMPACTION_WATCH_RETENTION_DAYS: '1' } }), 0)
    assert.equal((await readStatus(event, { stateDir })).count, 6)
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('pruning preserves history while compactions are recorded', async () => {
  const stateDir = await makeStateDir()
  const event = hook('prune-race')
  try {
    await recordCompaction(event, { stateDir })
    const [first] = await readdir(stateDir)
    const key = first.match(/^[a-f0-9]{64}/)?.[0]
    await Promise.all(Array.from({ length: 1000 }, (_, count) => writeFile(join(stateDir, `${key}.event.seed-${count}.json`), JSON.stringify({ trigger: 'auto' }))))
    const old = new Date(Date.now() - 172800000)
    for (const name of await readdir(stateDir)) await utimes(join(stateDir, name), old, old)
    const pruning = prune({ stateDir, env: { COMPACTION_WATCH_RETENTION_DAYS: '1' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    await Promise.all(Array.from({ length: 20 }, () => recordCompaction(event, { stateDir })))
    assert.equal(await pruning, 0)
    assert.equal((await readStatus(event, { stateDir })).count, 1021)
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('concurrent independent processes preserve every update', async () => {
  const stateDir = await makeStateDir()
  const moduleUrl = new URL('../lib/compaction-watch.mjs', import.meta.url).href
  try {
    await Promise.all(Array.from({ length: 40 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '--eval', `import { recordCompaction } from ${JSON.stringify(moduleUrl)}; await recordCompaction({session_id:'parallel',cwd:'/project',trigger:'auto'},{stateDir:${JSON.stringify(stateDir)},lockWaitMs:1})`])
      child.on('error', reject)
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)))
    })))
    assert.equal((await readStatus(hook('parallel', '/project'), { stateDir })).count, 40)
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})
