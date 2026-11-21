import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Hub-first data/event selection: the browser half must read /session-meta and
 * subscribe to window.dshSessionEvents when they work, and fall back to the
 * four adapter routes and their streams when they do not.
 */

class FakeEventSource {
  static instances = []

  constructor(url) {
    this.url = url
    this.listeners = new Map()
    this.closed = false
    FakeEventSource.instances.push(this)
  }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name).add(listener)
  }

  removeEventListener(name, listener) {
    this.listeners.get(name)?.delete(listener)
  }

  close() {
    this.closed = true
  }
}

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
    appendChild(node) {
      globalThis.window.__styles = globalThis.window.__styles ?? {}
      globalThis.window.__styles[node.pluginCss ?? 'anonymous'] = node.textContent
    },
    removeChild() {},
  },
  createElement() {
    const node = { pluginCss: '', textContent: '', remove() {} }
    node.setAttribute = (name, value) => {
      if (name === 'data-plugin-css') node.pluginCss = value
    }
    return node
  },
  addEventListener() {},
  removeEventListener() {},
}
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'zh-CN', clipboard: { writeText: async () => {} } },
})
Object.defineProperty(globalThis, 'EventSource', { configurable: true, writable: true, value: FakeEventSource })

/** One fake bus with an off spy. */
function createBus() {
  const listeners = new Set()
  let offCalls = 0
  return {
    version: 1,
    on(listener) {
      listeners.add(listener)
      return () => {
        offCalls += 1
        listeners.delete(listener)
      }
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event)
    },
    get offCalls() {
      return offCalls
    },
    get size() {
      return listeners.size
    },
  }
}

const metaDoc = {
  ok: true,
  generatedAt: 1,
  truncated: false,
  total: 2,
  sources: {
    stars: { state: 'ok', updatedAt: 1, count: 1 },
    todos: { state: 'ok', updatedAt: 2, count: 1 },
    boxes: { state: 'ok', updatedAt: 3, count: 1 },
    notify: { state: 'empty', updatedAt: 4, count: 0 },
  },
  sessions: {
    'session-a': { stars: 3, todo: { done: true, priority: 'high', dueAt: 5 }, boxes: ['b_1'] },
    'session-b': { stars: 0, watching: true },
  },
}

const url = (path) => path
let calls = []
let metaMode = 'ok'
let etag = '"etag-1"'

function respond(path, options) {
  calls.push({ url: path, headers: options?.headers ?? {} })
  if (path === url('/session-meta')) {
    if (metaMode === '404') return { ok: false, status: 404, json: async () => ({}) }
    if (options?.headers?.['if-none-match'] === etag) {
      return { ok: true, status: 304, headers: { get: (name) => (name === 'etag' ? etag : null) }, json: async () => null }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'etag' ? etag : null) },
      json: async () => metaDoc,
    }
  }
  if (path === url('/session-stars')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, ratings: {} }) }
  if (path === url('/session-todos')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, todos: {} }) }
  if (path === url('/session-notify')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, watched: {} }) }
  if (path === url('/session-boxes')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, state: { boxes: [], memberships: {} } }) }
  if (path === url('/token-usage')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, byId: {} }) }
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, config: {} }) }
}

globalThis.fetch = async (path, options) => respond(path, options)

await import('../client.js')

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'fragment',
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

const definition = globalThis.window.__capturedDefinition
const module = definition.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error('unexpected module ' + specifier)
})

/** Apply one instance and return the effect disposers. */
function apply() {
  FakeEventSource.instances = []
  calls = []
  const disposers = []
  const ctx = {
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    get() {
      return undefined
    },
    slots: {
      inject(_key, callback) { callback(); return () => {} },
      register() { return () => {} },
    },
    locale: {
      register() { return () => {} },
      bind() { return (key) => key },
      subscribe() { return () => {} },
    },
  }
  module.apply(ctx)
  return { disposers, dispose() { for (const dispose of disposers.reverse()) dispose() } }
}

const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))
const fetched = (path) => calls.filter((call) => call.url === path)
const adapterCalls = () => ['/session-stars', '/session-todos', '/session-notify', '/session-boxes']
  .map((path) => fetched(path).length)
const streamUrls = () => FakeEventSource.instances.map((source) => source.url)

test('hub mode reads /session-meta once and opens no adapter stream', async () => {
  metaMode = 'ok'
  const bus = createBus()
  globalThis.window.dshSessionEvents = bus
  const app = apply()
  await wait()
  assert.equal(fetched('/session-meta').length, 1)
  assert.deepEqual(adapterCalls(), [0, 0, 0, 0])
  assert.deepEqual(streamUrls(), ['/session-quickbar/events'])
  assert.equal(bus.size, 1)
  app.dispose()
  assert.equal(bus.offCalls, 1)
  delete globalThis.window.dshSessionEvents
})

test('a bus event triggers one revalidation and no adapter request', async () => {
  metaMode = 'ok'
  const bus = createBus()
  globalThis.window.dshSessionEvents = bus
  const app = apply()
  await wait()
  calls = []
  bus.emit({ source: 'todos', sessionId: 'session-a', kind: 'changed' })
  await wait()
  assert.equal(fetched('/session-meta').length, 1)
  assert.equal(fetched('/session-meta')[0].headers['if-none-match'], etag)
  assert.deepEqual(adapterCalls(), [0, 0, 0, 0])
  app.dispose()
  delete globalThis.window.dshSessionEvents
})

test('a hub 404 falls back to the four adapter routes and their streams', async () => {
  metaMode = '404'
  const bus = createBus()
  globalThis.window.dshSessionEvents = bus
  const app = apply()
  await wait(120)
  assert.deepEqual(adapterCalls(), [1, 1, 1, 1])
  assert.deepEqual(streamUrls().sort(), [
    '/session-notify/events',
    '/session-quickbar/events',
    '/session-stars/events',
    '/session-todos/events',
  ])
  app.dispose()
  delete globalThis.window.dshSessionEvents
})

test('a missing bus goes straight to the adapter path without a hub request', async () => {
  metaMode = 'ok'
  delete globalThis.window.dshSessionEvents
  const app = apply()
  await wait(120)
  assert.equal(fetched('/session-meta').length, 0)
  assert.deepEqual(adapterCalls(), [1, 1, 1, 1])
  assert.equal(streamUrls().includes('/session-stars/events'), true)
  app.dispose()
})

test('unloading closes the streams and removes the public API', () => {
  metaMode = 'ok'
  const bus = createBus()
  globalThis.window.dshSessionEvents = bus
  const app = apply()
  assert.ok(globalThis.window.dshSessionQuickbar)
  app.dispose()
  assert.equal(bus.offCalls, 1)
  assert.equal(FakeEventSource.instances.every((source) => source.closed), true)
  assert.equal('dshSessionQuickbar' in globalThis.window, false)
  delete globalThis.window.dshSessionEvents
})
