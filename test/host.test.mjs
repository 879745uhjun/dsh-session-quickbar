import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply } from '../index.js'

/** A Host context fake: it records effects, events, routes, and the tool. */
function createHarness(home) {
  const tools = []
  const listeners = new Map()
  const disposers = []
  const routes = new Map()
  const webServer = {
    register({ path, handler }) {
      routes.set(path, handler)
      return () => routes.delete(path)
    },
  }
  const scope = {
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    webServer,
  }
  const ctx = {
    get(name) {
      if (name === 'dshHomePath') return (file) => join(home, file)
      return undefined
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    inject(services, callback) {
      if (services.includes('webServer')) callback(scope)
    },
  }
  return {
    ctx,
    tools,
    listeners,
    routes,
    dispose() {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

/** A live-agent fake that records what it receives. */
function createAgent(id) {
  const injected = []
  const woken = []
  return {
    id,
    injected,
    woken,
    inject(message) { injected.push(message) },
    followup(message) { woken.push(message); injected.push(message) },
  }
}

async function withHarness(run) {
  const home = await mkdtemp(join(tmpdir(), 'session-quickbar-'))
  const harness = createHarness(home)
  apply(harness.ctx)
  try {
    await run({ home, ...harness, tool: harness.tools[0] })
  } finally {
    harness.dispose()
    await rm(home, { recursive: true, force: true })
  }
}

const exec = (sessionId) => ({ agent: { id: sessionId } })

test('the tool schema is a JSON Schema object root', async () => {
  await withHarness(async ({ tool }) => {
    assert.equal(tool.parameters.type, 'object', 'object root')
    assert.equal(typeof tool.parameters.properties, 'object', 'properties map')
    assert.deepEqual(tool.parameters.required, ['action'], 'root required')
    assert.equal(tool.parameters.action, undefined, 'no bare property table')
    for (const [name, schema] of Object.entries(tool.parameters.properties)) {
      assert.equal(schema.required, undefined, `${name} must not carry property-level required`)
    }
  })
})

test('the default layout is the todo square and the finish alert', async () => {
  await withHarness(async ({ tool }) => {
    const result = await tool.execute({ action: 'get' }, exec('session-a'))
    assert.equal(result.ok, true)
    assert.equal(result.scope, 'default')
    assert.deepEqual(result.items.map((item) => item.id), ['todo', 'notify'])
    assert.equal(result.takeover, true)
  })
})

test('a global layout applies to every session and persists', async () => {
  await withHarness(async ({ tool, home }) => {
    const set = await tool.execute({ action: 'set', order: ['pin', 'star'], hidden: ['star'] }, exec('session-a'))
    assert.equal(set.ok, true)
    assert.deepEqual(set.items.map((item) => item.id), ['pin', 'star'])
    assert.equal(set.items[1].visible, false)

    const read = await tool.execute({ action: 'get' }, exec('session-b'))
    assert.equal(read.scope, 'global')
    assert.deepEqual(read.items.map((item) => item.id), ['pin', 'star'])

    const file = JSON.parse(await readFile(join(home, 'session-quickbar.json'), 'utf8'))
    assert.deepEqual(file.global.items, [{ id: 'pin', visible: true }, { id: 'star', visible: false }])
  })
})

test('one session can override the global layout and fall back again', async () => {
  await withHarness(async ({ tool }) => {
    await tool.execute({ action: 'set', order: ['star', 'archive'] }, exec('session-a'))
    await tool.execute({ action: 'set', scope: 'session', sessionId: 'session-b', order: ['copy-id'] }, exec('session-a'))

    const own = await tool.execute({ action: 'get', sessionId: 'session-b' }, exec('session-a'))
    assert.equal(own.scope, 'session')
    assert.deepEqual(own.items.map((item) => item.id), ['copy-id'])

    const inherited = await tool.execute({ action: 'get', sessionId: 'session-c' }, exec('session-a'))
    assert.equal(inherited.scope, 'global')

    await tool.execute({ action: 'reset', scope: 'session', sessionId: 'session-b' }, exec('session-a'))
    const after = await tool.execute({ action: 'get', sessionId: 'session-b' }, exec('session-a'))
    assert.equal(after.scope, 'global')
  })
})

test('registering an action records its owner and subscribes that session', async () => {
  await withHarness(async ({ tool }) => {
    const result = await tool.execute({
      action: 'register',
      id: 'ru-word-card',
      zh: '俄语卡片',
      en: 'Word card',
      hint: '打开这个会话的俄语词卡',
      position: 15,
    }, exec('session-stars-author'))
    assert.equal(result.ok, true)
    assert.equal(result.ownerSession, 'session-stars-author')
    assert.equal(result.watched, true)

    const read = await tool.execute({ action: 'get' }, exec('session-stars-author'))
    assert.equal(read.unplaced.some((item) => item.id === 'ru-word-card'), true)
    const owner = read.unplaced.find((item) => item.id === 'ru-word-card')
    assert.equal(owner.ownerSession, 'session-stars-author')
    assert.deepEqual(owner.labels, { zh: '俄语卡片', en: 'Word card' })
    assert.equal(read.subscriptions.some((item) => item.sessionId === 'session-stars-author'), true)
    assert.equal(read.recentChanges.at(-1).summary.includes('ru-word-card'), true)
  })
})

test('layout changes reach subscribed agents, and agents can answer each other', async () => {
  await withHarness(async ({ tool, listeners }) => {
    const author = createAgent('session-author')
    listeners.get('agent/created')({ agent: author })
    await new Promise((resolve) => setTimeout(resolve, 20))

    await tool.execute({ action: 'watch', sessionId: 'session-author', note: 'stars plugin' }, exec('session-author'))
    await tool.execute({ action: 'set', order: ['star', 'todo'] }, exec('session-user'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.ok(author.injected.length >= 1)
    assert.match(author.injected[0].content[0].text, /快捷栏/)
    assert.equal(author.woken.length, 0)

    const sent = await tool.execute({ action: 'notify', sessionId: 'session-author', text: '按钮已搬到第 2 位' }, exec('session-user'))
    assert.equal(sent.ok, true)
    assert.equal(sent.delivered, true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(author.woken.length, 1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.ok(author.injected.some((message) => message.content[0].text.includes('按钮已搬到第 2 位')))

    const messages = await tool.execute({ action: 'messages', with: 'session-author' }, exec('session-user'))
    assert.equal(messages.ok, true)
    assert.ok(messages.messages.some((message) => message.text.includes('按钮已搬到第 2 位')))
  })
})

test('messages queue for a session that is not loaded yet', async () => {
  await withHarness(async ({ tool, listeners }) => {
    await tool.execute({ action: 'notify', sessionId: 'session-later', text: '等你打开再发' }, exec('session-user'))
    const second = await tool.execute({ action: 'notify', sessionId: 'session-later', text: '第二条也排着' }, exec('session-user'))
    assert.equal(second.ok, true)
    assert.equal(second.delivered, false)

    const agent = createAgent('session-later')
    listeners.get('agent/created')({ agent })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(agent.injected.length, 2)
    assert.ok(agent.injected[0].content[0].text.includes('等你打开再发'))
    assert.equal(agent.woken.length, 1)
    assert.ok(agent.woken[0].content[0].text.includes('第二条也排着'))
  })
})

test('the browser route serves and mutates the document', async () => {
  await withHarness(async ({ routes }) => {
    const handler = routes.get('/session-quickbar')
    assert.equal(typeof handler, 'function')
    const server = createServer((request, response) => { void handler(request, response) })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    const base = 'http://127.0.0.1:' + port
    try {
      const first = await fetch(base + '/session-quickbar')
      const firstBody = await first.json()
      assert.equal(first.status, 200)
      assert.equal(firstBody.ok, true)
      assert.deepEqual(firstBody.config.global.items, [])
      assert.equal(firstBody.config.actions.star.source, 'builtin')

      const posted = await fetch(base + '/session-quickbar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set', scope: 'global', items: [{ id: 'archive', visible: true }] }),
      })
      const postedBody = await posted.json()
      assert.equal(posted.status, 200)
      assert.equal(postedBody.ok, true)
      assert.deepEqual(postedBody.config.global.items, [{ id: 'archive', visible: true }])

      const refused = await fetch(base + '/session-quickbar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set', scope: 'session' }),
      })
      assert.equal(refused.status, 400)
      const refusedBody = await refused.json()
      assert.equal(refusedBody.ok, false)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

test('the route refuses a cross-site caller', async () => {
  await withHarness(async ({ routes }) => {
    const handler = routes.get('/session-quickbar')
    const server = createServer((request, response) => { void handler(request, response) })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/session-quickbar', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
        body: JSON.stringify({ action: 'reset', scope: 'global' }),
      })
      assert.equal(response.status, 403)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

/** The tool framework rejects values that JSON cannot round-trip losslessly. */
function assertLossless(value) {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
}

test('every tool result survives a lossless JSON round trip', async () => {
  await withHarness(async ({ tool, routes }) => {
    const handler = routes.get('/session-quickbar')
    const server = createServer((request, response) => { void handler(request, response) })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    const base = 'http://127.0.0.1:' + port
    try {
      await fetch(base + '/session-quickbar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'catalog',
          rows: [
            { id: 'session-a', title: '会话 A', cwd: 'D:/x', running: false },
            { id: 'session-b', title: '会话 B', cwd: 'D:/y', running: true },
          ],
        }),
      })
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }

    const results = []
    results.push(await tool.execute({ action: 'get' }, exec('session-a')))
    results.push(await tool.execute({ action: 'set', order: ['pin', 'star'], hidden: ['star'] }, exec('session-a')))
    results.push(await tool.execute({ action: 'set', scope: 'session', sessionId: 'session-b', order: ['archive'] }, exec('session-a')))
    results.push(await tool.execute({ action: 'get', sessionId: '会话 B' }, exec('session-a')))
    results.push(await tool.execute({ action: 'register', id: 'lossless-action', zh: '无损' }, exec('session-a')))
    results.push(await tool.execute({ action: 'watch', sessionId: 'session-b', note: '' }, exec('session-a')))
    results.push(await tool.execute({ action: 'unwatch', sessionId: 'session-b' }, exec('session-a')))
    results.push(await tool.execute({ action: 'notify', sessionId: '会话 A', text: 'hi' }, exec('session-b')))
    results.push(await tool.execute({ action: 'messages', with: 'session-a' }, exec('session-b')))
    results.push(await tool.execute({ action: 'sessions' }, exec('session-a')))
    results.push(await tool.execute({ action: 'unregister', id: 'lossless-action' }, exec('session-a')))
    results.push(await tool.execute({ action: 'reset', scope: 'session', sessionId: 'session-b' }, exec('session-a')))
    results.push(await tool.execute({ action: 'reset', scope: 'global' }, exec('session-a')))

    for (const result of results) {
      assert.equal(result.ok, true, JSON.stringify(result))
      assertLossless(result)
    }
  })
})


test('the plugin survey reads profile manifests and keeps client bundles', async () => {
  const home = await mkdtemp(join(tmpdir(), 'session-quickbar-survey-'))
  const profile = join(home, 'profile')
  const modules = join(profile, 'node_modules')
  const writePackage = async (dir, pkg) => {
    await mkdir(join(modules, dir), { recursive: true })
    await writeFile(join(modules, dir, 'package.json'), JSON.stringify(pkg))
  }
  await writePackage('pkg-client', { name: 'pkg-client', version: '1.2.3', description: 'has a client half', dsh: { client: { platform: 'web' } } })
  await writePackage('pkg-host', { name: 'pkg-host', version: '0.1.0', description: 'host only' })
  await writePackage('@scope/pkg-scoped', { name: '@scope/pkg-scoped', version: '2.0.0', dsh: { client: { platform: 'web' } } })
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = profile
  const harness = createHarness(home)
  apply(harness.ctx)
  try {
    const survey = await harness.tools[0].execute({ action: 'plugins' }, exec('session-a'))
    assert.equal(survey.ok, true)
    assert.equal(survey.count, 2)
    assert.deepEqual(survey.plugins.map((row) => row.name), ['@scope/pkg-scoped', 'pkg-client'])
    assert.equal(survey.plugins.every((row) => row.client === true), true)

    const handler = harness.routes.get('/session-quickbar/plugins')
    assert.equal(typeof handler, 'function')
    const server = createServer((request, response) => { void handler(request, response) })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/session-quickbar/plugins')
      const body = await response.json()
      assert.equal(body.ok, true)
      assert.equal(body.plugins.length, 3)
      const hostOnly = body.plugins.find((row) => row.name === 'pkg-host')
      assert.equal(hostOnly.client, false)
      assert.equal(hostOnly.description, 'host only')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  } finally {
    harness.dispose()
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    await rm(home, { recursive: true, force: true })
  }
})

test('the panel visibility list is stored and returned', async () => {
  await withHarness(async ({ tool, routes, store }) => {
    void tool
    void store
    const handler = routes.get('/session-quickbar')
    const server = createServer((request, response) => { void handler(request, response) })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    const base = 'http://127.0.0.1:' + port
    try {
      const posted = await fetch(base + '/session-quickbar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'panels', hidden: ['todos', 'plugins', 'todos'] }),
      })
      const body = await posted.json()
      assert.equal(posted.status, 200)
      assert.deepEqual(body.config.panels.hidden, ['todos', 'plugins'])

      const invalid = await fetch(base + '/session-quickbar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'panels', hidden: ['bad id'] }),
      })
      assert.equal(invalid.status, 400)

      const read = await fetch(base + '/session-quickbar')
      const readBody = await read.json()
      assert.deepEqual(readBody.config.panels.hidden, ['todos', 'plugins'])
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
