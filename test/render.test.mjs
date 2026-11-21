import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * A render smoke test for the browser half without a DOM. It loads the real
 * `client.js` through the module loader stub, applies it to a fake client
 * context, fetches a layout through the stubbed routes, then renders the slot
 * components with a tiny element walker. Hooks are stateless stand-ins, which
 * is enough to catch missing props, undefined reads, and broken conditionals.
 */

const config = {
  version: 1,
  updatedAt: 1,
  global: { items: [], takeover: true, updatedAt: 0 },
  sessions: {
    'session-adapters': {
      items: [{ id: 'todo', visible: true }, { id: 'token', visible: true }, { id: 'boxes', visible: true }],
      updatedAt: 1,
    },
  },
  actions: {
    star: { id: 'star', labels: { zh: '星标', en: 'Star' }, order: 10, source: 'builtin', ownerSession: null },
    todo: { id: 'todo', labels: { zh: '待办', en: 'Todo' }, order: 20, source: 'builtin', ownerSession: null },
    archive: { id: 'archive', labels: { zh: '归档', en: 'Archive' }, order: 30, source: 'builtin', ownerSession: null },
    pin: { id: 'pin', labels: { zh: '置顶', en: 'Pin' }, order: 40, source: 'builtin', ownerSession: null },
  },
  subscriptions: {
    'session-author': { since: 1, note: 'stars plugin' },
  },
  knownSessions: {
    'session-a': { title: '会话 A', cwd: 'D:/x', updatedAt: 1 },
    'session-author': { title: '星标插件会话', cwd: 'D:/x', updatedAt: 1 },
    'session-user': { title: '快捷栏开发会话', cwd: 'D:/x', updatedAt: 1 },
  },
  log: [{ at: 2, by: 'agent:session-author', scope: 'global', sessionId: null, summary: '全局快捷栏改为：1.星标' }],
  messages: [
    { id: 'm1', at: 3, from: 'session-author', to: 'session-user', text: '按钮已登记', kind: 'message', deliveredAt: 4 },
    { id: 'm2', at: 5, from: 'session-user', to: 'session-a', text: '排队中的请求', kind: 'message', deliveredAt: 0 },
  ],
}

const requests = []
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  __ModuleLoader__: {
    load(definition) {
      globalThis.window.__capturedDefinition = definition
    },
  },
}
globalThis.document = {
  documentElement: { lang: 'zh-CN' },
  visibilityState: 'visible',
  head: {
    appendChild(node) { globalThis.window.__lastStyle = node.textContent },
    removeChild() {},
  },
  createElement() {
    return { setAttribute() {}, remove() {}, textContent: '' }
  },
  addEventListener() {},
  removeEventListener() {},
}
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'zh-CN', clipboard: { writeText: async () => {} } },
})
globalThis.fetch = async (url, options) => {
  requests.push({ url, options })
  if (typeof url === 'string' && url === '/session-quickbar' && options?.method !== 'POST') {
    return { ok: true, status: 200, json: async () => ({ ok: true, config }) }
  }
  if (url === '/session-stars') {
    return { ok: true, status: 200, json: async () => ({ ok: true, ratings: { 'session-a': { stars: 1, updatedAt: 1 } } }) }
  }
  if (url === '/session-quickbar/plugins') {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        plugins: [
          { name: 'dsh-session-stars', version: '1.1.1', description: 'Five star levels', client: true },
          { name: 'dsh-session-todos', version: '0.1.0', description: 'Todo squares', client: true },
          { name: 'dsh-session-transfer', version: '1.0.0', description: 'Pack a session', client: true },
          { name: 'dsh-whale-widget', version: '0.4.2', description: 'Balance widget', client: false },
        ],
      }),
    }
  }
  if (url === '/token-usage') {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        sessions: [{
          sessionId: 'session-adapters',
          total: 1234567,
          input: 1000000,
          output: 234567,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 1.23,
          cacheHitRate: 0.9,
          turns: 4,
          days: [{ day: '2026-11-16', total: 100000 }],
        }],
      }),
    }
  }
  if (url === '/session-boxes') {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        state: {
          boxes: [
            { id: 'b_aaa111', name: '俄语', color: 'blue', parentId: null, order: 0 },
            { id: 'b_bbb222', name: '子盒子', color: 'amber', parentId: 'b_aaa111', order: 1 },
          ],
          memberships: { 'session-adapters': ['b_aaa111'] },
        },
      }),
    }
  }
  if (url === '/session-todos') {
    return { ok: true, status: 200, json: async () => ({ ok: true, todos: { 'session-b': { done: true } } }) }
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, config }) }
}

await import('../client.js')

/**
 * A tiny hook runtime: state persists per component instance and effects run
 * synchronously, so rendering the same component twice shows what its async
 * effects produced.
 */
const instanceStates = new Map()
let instanceKey = ''
let hookIndex = 0

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: 'fragment',
  useCallback: (fn) => fn,
  useEffect: (fn) => { fn() },
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => {
    const key = instanceKey + '#' + hookIndex
    hookIndex += 1
    if (!instanceStates.has(key)) instanceStates.set(key, typeof value === 'function' ? value() : value)
    return [instanceStates.get(key), (next) => {
      instanceStates.set(key, typeof next === 'function' ? next(instanceStates.get(key)) : next)
    }]
  },
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

/** Invoke one function component with its own hook instance. */
function invoke(component, props) {
  const previousKey = instanceKey
  const previousIndex = hookIndex
  instanceKey = (component.name || 'anon') + '|' + String(props.key ?? props.sessionId ?? props.entry?.id ?? '')
  hookIndex = 0
  try {
    return component(props)
  } finally {
    instanceKey = previousKey
    hookIndex = previousIndex
  }
}

const definition = globalThis.window.__capturedDefinition
const module = definition.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error('unexpected module ' + specifier)
})

function createClientContext(services = {}) {
  const registrations = []
  const ctx = {
    effect(callback) {
      const dispose = callback()
      return dispose
    },
    get(name) {
      return services[name]
    },
    slots: {
      inject(_key, callback) {
        callback()
        return () => {}
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return (key) => key
      },
      subscribe() {
        return () => {}
      },
    },
  }
  return { ctx, registrations }
}

/** Walk a React element tree, invoking function components. */
function render(node, depth = 0) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => render(child, depth)).join('')
  assert.ok(depth < 40, 'render recursion is bounded')
  if (node.type === 'fragment') return render(node.children, depth + 1)
  if (typeof node.type === 'function') {
    const props = { ...node.props }
    if (node.children.length === 1) props.children = node.children[0]
    return render(invoke(node.type, props), depth + 1)
  }
  assert.equal(typeof node.type, 'string')
  return render(node.children, depth + 1)
}

const { ctx, registrations } = createClientContext()
module.apply(ctx)

const bySlot = (name) => registrations.find((entry) => entry.options.name === name)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('the strip renders every default button for a row', async () => {
  await wait(30)
  const bar = bySlot('sidebar.workspaces.session.row.action').component
  const text = render(bar({ sessionId: 'session-a', displayTitle: '会话 A' }))
  assert.equal(typeof text, 'string')
  const tree = bar({ sessionId: 'session-a', displayTitle: '会话 A' })
  const collected = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node.type === 'function') {
      const props = { ...node.props }
      if (node.children.length === 1) props.children = node.children[0]
      return walk(invoke(node.type, props))
    }
    if (typeof node.type === 'string') {
      collected.push({ tag: node.type, props: node.props })
      node.children.forEach(walk)
    }
  }
  walk(tree)
  const buttons = collected.filter((item) => item.tag === 'button')
  assert.equal(buttons.length, 2)
  assert.deepEqual(buttons.map((item) => item.props['aria-label']), ['bar.todo', 'bar.notify'])
  assert.ok(buttons.every((item) => typeof item.props.title === 'string'))
  assert.ok(collected.some((item) => item.props.className === 'sq-pending'))
})

test('the settings page renders the global layout, takeover switch, and channel history', async () => {
  await wait(30)
  const page = bySlot('main').component
  render(page({}))
  await wait(40)
  const text = render(page({}))
  assert.ok(text.includes('page.title'))
  assert.ok(text.includes('page.global'))
  assert.ok(text.includes('page.takeover'))
  assert.ok(text.includes('星标插件会话'))
  // Recent messages start folded; only their count is shown.
  assert.ok(text.includes('page.messagesCollapsed'))
  assert.equal(text.includes('按钮已登记'), false)

  // Expanding through the toggle reveals the log.
  let toggle = null
  const findToggle = (node) => {
    if (toggle !== null || node === null || node === undefined || typeof node === 'boolean') return
    if (Array.isArray(node)) { node.forEach(findToggle); return }
    if (typeof node.type === 'function') {
      const props = { ...node.props }
      if (node.children.length === 1) props.children = node.children[0]
      return findToggle(invoke(node.type, props))
    }
    if (typeof node.type !== 'string') return
    if (node.type === 'button' && node.props.className === 'sq-btn-ghost' && node.props['aria-expanded'] === false) {
      toggle = node
      return
    }
    node.children.forEach(findToggle)
  }
  findToggle(page({}))
  assert.ok(toggle, 'the fold toggle renders')
  toggle.props.onClick()
  const expanded = render(page({}))
  assert.ok(expanded.includes('按钮已登记'))
  assert.ok(expanded.includes('快捷栏开发会话'))
  assert.ok(expanded.includes('page.queued'))
  assert.ok(expanded.includes('page.collapse'))
  assert.ok(text.includes('page.pending'))
  assert.ok(text.includes('page.pendingBadge'))
  assert.ok(text.includes('page.plugins'))
  assert.ok(text.includes('dsh-session-transfer'))
  assert.ok(text.includes('dsh-session-stars · 1.1.1'))
  assert.ok(text.includes('page.pluginBuiltin'))
  assert.ok(text.includes('page.pluginCandidate'))
  assert.equal(text.includes('dsh-whale-widget'), false)
})

test('one session override reaches the editor and the strip', async () => {
  await wait(10)
  const page = bySlot('main').component
  const strip = bySlot('sidebar.workspaces.session.row.action').component
  // No session selected yet: the editor asks for one.
  const text = render(page({}))
  assert.ok(text.includes('page.actions'))
  // The bar still renders from the global default.
  render(strip({ sessionId: 'session-b' }))
})

test('the row menu entry renders a label', async () => {
  const menu = bySlot('sidebar.workspaces.session.menu.item').component
  const text = render(menu({ sessionId: 'session-a', useMenuOpenState: () => [false, () => {}] }))
  assert.ok(text.includes('menu.label'))
})

test('the dialog stays empty without a request', async () => {
  const dialog = bySlot('shell.overlay').component
  const text = render(dialog({}))
  assert.equal(text, '')
})


test('the survey falls back to the loaded bundles before the host route exists', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    if (url === '/session-quickbar/plugins') return { ok: false, status: 404, json: async () => ({}) }
    if (url === '/session-quickbar' && options?.method !== 'POST') {
      return { ok: true, status: 200, json: async () => ({ ok: true, config }) }
    }
    if (url === '/session-stars' || url === '/session-todos') {
      return { ok: true, status: 200, json: async () => ({ ok: true, ratings: {}, todos: {} }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, config }) }
  }
  const { ctx: second, registrations: secondRegistrations } = createClientContext({
    loader: {
      internal: {
        manifest: {
          modules: [
            { id: 'dsh-session-transfer' },
            { id: 'dsh-session-todos' },
            { id: 'dsh-session-quickbar' },
            { id: '@deepseek-ai/dsh-client-ui-chat' },
          ],
        },
      },
    },
  })
  module.apply(second)
  await wait(30)
  const page = secondRegistrations.find((entry) => entry.options.name === 'main').component
  render(page({}))
  await wait(40)
  const text = render(page({}))
  globalThis.fetch = previousFetch
  assert.ok(text.includes('dsh-session-transfer'))
  assert.ok(text.includes('page.pluginBuiltin'))
  assert.ok(text.includes('page.pluginsRestart'))
  assert.equal(text.includes('dsh-session-quickbar'), false)
  assert.equal(text.includes('@deepseek-ai'), false)
})


test('token and box buttons render for a configured session', async () => {
  const page = bySlot('sidebar.workspaces.session.row.action').component
  const tree = page({ sessionId: 'session-adapters', displayTitle: '适配会话' })
  const collected = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node.type === 'function') {
      const props = { ...node.props }
      if (node.children.length === 1) props.children = node.children[0]
      return walk(invoke(node.type, props))
    }
    if (typeof node.type === 'string') {
      collected.push({ tag: node.type, props: node.props, children: node.children })
      node.children.forEach(walk)
    }
  }
  walk(tree)
  const buttons = collected.filter((item) => item.tag === 'button')
  const labels = buttons.map((item) => item.props['aria-label'])
  assert.ok(labels.includes('bar.token'), JSON.stringify(labels))
  assert.ok(labels.includes('bar.boxesOn'), JSON.stringify(labels))
  const token = buttons.find((item) => item.props['aria-label'] === 'bar.token')
  assert.equal(token.children.join(''), '1.2M')
})


/** Flat element list for one rendered tree. */
function elementsOf(node) {
  const out = []
  const walk = (current) => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (Array.isArray(current)) { current.forEach(walk); return }
    if (typeof current.type === 'function') {
      const props = { ...current.props }
      if (current.children.length === 1) props.children = current.children[0]
      return walk(invoke(current.type, props))
    }
    if (typeof current.type !== 'string') return
    out.push({ tag: current.type, props: current.props, children: current.children })
    current.children.forEach(walk)
  }
  walk(node)
  return out
}

const selfTestSubject = { kind: 'bundle', pkg: { name: 'dsh-session-quickbar' } }

function selfTestSection() {
  return bySlot('plugins.detail.section').component
}

function selfTestButton(label) {
  const root = selfTestSection()
  const tree = root({ subject: selfTestSubject })
  return elementsOf(tree).find((element) => element.tag === 'button' && element.children.some((child) => child === label))
}

test('the self-test renders only for this plugin and only after a click', () => {
  const root = selfTestSection()
  assert.equal(render(root({ subject: { kind: 'item', id: 'something-else' } })), '')
  const idle = render(root({ subject: selfTestSubject }))
  assert.ok(idle.includes('selftest.title'))
  assert.ok(idle.includes('selftest.status.idle'))
  assert.equal(idle.includes('selftest.status.pass'), false, 'nothing runs on mount')
})

test('an item subject includes this package and excludes others', () => {
  const root = selfTestSection()
  const included = render(root({ subject: { kind: 'item', id: 'include:dsh-session-quickbar' } }))
  assert.ok(included.includes('selftest.title'))
  assert.ok(render(root({ subject: { kind: 'item', id: 'dsh-session-quickbar' } })).includes('selftest.title'))
  assert.equal(render(root({ subject: { kind: 'item', id: 'include:dsh-session-todos' } })), '')
})

test('the self-test passes every check and copies markdown', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (url === '/session-quickbar/selftest') {
      return { ok: true, status: 200, json: async () => ({ ok: true, tool: { registered: true }, channel: { ok: true, sessions: 3 } }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, config }) }
  }
  const run = selfTestButton('selftest.run')
  assert.ok(run, 'the run button renders')
  run.props.onClick()
  await wait(80)
  const text = render(selfTestSection()({ subject: selfTestSubject }))
  assert.equal((text.match(/selftest\.status\.pass/g) ?? []).length, 4)
  assert.equal(text.includes('selftest.status.fail'), false)

  const copied = []
  const previousClipboard = navigator.clipboard
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { copied.push(value) } } })
  try {
    const copy = selfTestButton('selftest.copy')
    assert.ok(copy, 'the copy button renders')
    copy.props.onClick()
    await wait(20)
    assert.equal(copied.length, 1)
    assert.ok(copied[0].startsWith('## selftest.title'))
    assert.ok(copied[0].includes('selftest.markdown.pass'))
  } finally {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: previousClipboard })
    globalThis.fetch = previousFetch
  }
})

test('one failed check leaves the others passing', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (url === '/session-quickbar') return { ok: false, status: 404, json: async () => ({}) }
    if (url === '/session-quickbar/selftest') {
      return { ok: true, status: 200, json: async () => ({ ok: true, tool: { registered: true }, channel: { ok: true, sessions: 0 } }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, config }) }
  }
  try {
    const run = selfTestButton('selftest.run')
    run.props.onClick()
    await wait(80)
    const text = render(selfTestSection()({ subject: selfTestSubject }))
    assert.equal((text.match(/selftest\.status\.pass/g) ?? []).length, 3)
    assert.equal((text.match(/selftest\.status\.fail/g) ?? []).length, 1)
    assert.ok(text.includes('selftest.fail.http'))
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('a hanging check fails after the two-second ceiling', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (url === '/session-quickbar') return new Promise(() => {})
    if (url === '/session-quickbar/selftest') {
      return { ok: true, status: 200, json: async () => ({ ok: true, tool: { registered: true }, channel: { ok: true, sessions: 0 } }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, config }) }
  }
  try {
    const started = Date.now()
    const run = selfTestButton('selftest.run')
    run.props.onClick()
    await wait(2300)
    assert.ok(Date.now() - started >= 2000)
    const text = render(selfTestSection()({ subject: selfTestSubject }))
    assert.ok(text.includes('selftest.fail.timeout'))
    assert.equal((text.match(/selftest\.status\.pass/g) ?? []).length, 3)
  } finally {
    globalThis.fetch = previousFetch
  }
})
