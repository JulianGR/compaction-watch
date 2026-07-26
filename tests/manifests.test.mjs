import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

async function manifest(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
}

function command(adapter) {
  return adapter.hooks[0].command
}

test('the installed root includes the Node runtime and all host manifests', async () => {
  await Promise.all([
    access(new URL('../bin/compaction-watch.mjs', import.meta.url)),
    access(new URL('../lib/compaction-watch.mjs', import.meta.url)),
    access(new URL('../.claude-plugin/plugin.json', import.meta.url)),
    access(new URL('../.codex-plugin/plugin.json', import.meta.url)),
    access(new URL('../kimi.plugin.json', import.meta.url))
  ])
  const [claudeMarketplace, claude, codex, codexMarketplace, kimi] = await Promise.all([
    manifest('../.claude-plugin/marketplace.json'),
    manifest('../.claude-plugin/plugin.json'),
    manifest('../.codex-plugin/plugin.json'),
    manifest('../.agents/plugins/marketplace.json'),
    manifest('../kimi.plugin.json')
  ])
  assert.equal(claudeMarketplace.plugins[0].source, './')
  assert.equal(codexMarketplace.plugins[0].source.path, './')
  assert.equal(codexMarketplace.plugins[0].policy.installation, 'AVAILABLE')
  assert.equal(codexMarketplace.plugins[0].policy.authentication, 'ON_INSTALL')
  assert.equal(codexMarketplace.plugins[0].category, 'Productivity')
  assert.equal(claude.name, 'compaction-watch')
  assert.equal(codex.name, 'compaction-watch')
  assert.equal(kimi.name, 'compaction-watch')
  assert.equal('hooks' in codex, false)
})

test('the repository has no nested package or machine-local packaging instructions', async () => {
  const [readme, claude] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../CLAUDE.md', import.meta.url), 'utf8')
  ])
  await assert.rejects(access(new URL('../plugins/compaction-watch/.claude-plugin/plugin.json', import.meta.url)))
  assert.doesNotMatch(`${readme}\n${claude}`, /C:\\Users\\jules/)
  assert.match(readme, /hook JSON.*cwd.*session_id/is)
})

test('Claude declares every lifecycle adapter inline', async () => {
  const claude = await manifest('../.claude-plugin/plugin.json')
  const hooks = claude.hooks
  assert.deepEqual(Object.keys(hooks).sort(), ['PostCompact', 'PreCompact', 'SessionStart', 'UserPromptSubmit'])
  assert.equal(hooks.PreCompact[0].matcher, 'auto')
  assert.equal(hooks.PostCompact[0].matcher, 'auto')
  assert.match(command(hooks.PreCompact[0]), /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/compaction-watch\.mjs" count --host claude/)
  assert.match(command(hooks.PostCompact[0]), /notify --host claude/)
  assert.match(command(hooks.UserPromptSubmit[0]), /notify --repeat --host claude/)
  assert.match(command(hooks.SessionStart[0]), /prune --host claude/)
  for (const adapters of Object.values(hooks)) assert.ok(adapters[0].hooks[0].timeout > 0)
})

test('Codex discovers every lifecycle adapter from hooks/hooks.json', async () => {
  const hooks = (await manifest('../hooks/hooks.json')).hooks
  assert.deepEqual(Object.keys(hooks).sort(), ['PostCompact', 'PreCompact', 'SessionStart', 'UserPromptSubmit'])
  assert.equal(hooks.PreCompact[0].matcher, 'auto')
  assert.equal(hooks.PostCompact[0].matcher, 'auto')
  assert.match(command(hooks.PreCompact[0]), /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/compaction-watch\.mjs" count --host codex/)
  assert.match(command(hooks.PostCompact[0]), /notify --host codex/)
  assert.match(command(hooks.UserPromptSubmit[0]), /notify --repeat --host codex/)
  assert.match(command(hooks.SessionStart[0]), /prune --host codex/)
  for (const adapters of Object.values(hooks)) assert.ok(adapters[0].hooks[0].timeout > 0)
})

test('Kimi runs every lifecycle adapter from its plugin root', async () => {
  const kimi = await manifest('../kimi.plugin.json')
  assert.equal(kimi.hooks.length, 4)
  const byEvent = Object.fromEntries(kimi.hooks.map(adapter => [adapter.event, adapter]))
  assert.deepEqual(Object.keys(byEvent).sort(), ['PostCompact', 'PreCompact', 'SessionStart', 'UserPromptSubmit'])
  assert.equal(byEvent.PreCompact.matcher, 'auto')
  assert.equal(byEvent.PostCompact.matcher, 'auto')
  assert.equal(byEvent.PreCompact.command, 'node ./bin/compaction-watch.mjs count --host kimi')
  assert.equal(byEvent.PostCompact.command, 'node ./bin/compaction-watch.mjs notify --host kimi')
  assert.equal(byEvent.UserPromptSubmit.command, 'node ./bin/compaction-watch.mjs notify --repeat --host kimi')
  assert.equal(byEvent.SessionStart.command, 'node ./bin/compaction-watch.mjs prune --host kimi')
  for (const adapter of kimi.hooks) assert.ok(adapter.timeout > 0)
})
