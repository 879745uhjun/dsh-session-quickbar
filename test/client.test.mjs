import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * A wiring test for the browser half. It loads the real `client.js` through a
 * module-loader stub, feeds it a minimal React (no render happens during
 * apply), and drives the plugin context. It proves registration, the public
 * registry contract, takeover CSS, and the built-in action set without a DOM
 * renderer.
 */

const posts = []

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
globalThis.fetch = async (url, options) => {
  posts.push({ url, options })
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, config: {} }),
  }
}

await import('../client.js')

/** The React stand-in: apply only needs createElement and hook identities. */
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

/** A client context fake that records slot registrations and effects. */
function createClientContext() {
  const registrations = []
  const effects = []
  const localeRegistrations = []
  const ctx = {
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') effects.push(dispose)
      return dispose
    },
    get() {
      return undefined
    },
    slots: {
      inject(key, callback) {
        callback()
        return () => {}
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    locale: {
      register(namespace, dictionaries) {
        localeRegistrations.push({ namespace, dictionaries })
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
  return { ctx, registrations, effects, localeRegistrations }
}

const definition = globalThis.window.__capturedDefinition
const module = definition.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error('unexpected module ' + specifier)
})
const { ctx, registrations, localeRegistrations } = createClientContext()
module.inject.forEach((name) => assert.ok(name === 'slots' || name === 'locale'))
module.apply(ctx)

test('the plugin exposes the registry contract other plugins adopt', () => {
  const api = globalThis.window.dshSessionQuickbar
  assert.ok(api)
  assert.equal(api.version, 1)
  assert.equal(typeof api.register, 'function')
  assert.deepEqual(api.list().map((action) => action.id), ['star', 'todo', 'archive', 'pin', 'copy-id', 'notify', 'pack', 'token', 'boxes'])
})

test('the strip, the menu entry, the page, the panel entry, and the dialog are registered', () => {
  const keys = registrations.map((entry) => entry.options.name)
  assert.deepEqual(keys, [
    'sidebar.workspaces.session.row.action',
    'sidebar.workspaces.session.menu.item',
    'main',
    'sidebar.panellist',
    'shell.overlay',
    'shell.overlay',
    'sidebar.panellist.actions',
    'plugins.detail.section',
  ])
  const strip = registrations[0].options
  assert.equal(strip.order, 40)
  assert.equal(strip.id, 'session-quickbar')
  assert.equal(typeof registrations[0].component, 'function')
  const page = registrations.find((entry) => entry.options.name === 'main')
  assert.equal(page.options.key, 'session-quickbar')
})

test('takeover targets only the seat that holds the bar and marks its own node', () => {
  const css = (globalThis.window.__styles ?? {})['dsh-session-quickbar/QuickBar.css'] ?? ''
  assert.ok(css.includes('[data-slot="sidebar.workspaces.session.row.action"]:has(> [data-dsh-quickbar]:not([data-sq-keep]))'))
  assert.ok(css.includes('display:none!important'))
  assert.ok(css.includes('.sq-bar{'))
})

test('overlay shadows and the backdrop come from theme variables', () => {
  const css = (globalThis.window.__styles ?? {})['dsh-session-quickbar/QuickBar.css'] ?? ''
  assert.ok(css.includes(':root{--sq-shadow:'), 'light shadow variable')
  assert.ok(css.includes('body[data-ds-dark-theme]{--sq-shadow:'), 'dark shadow override')
  assert.ok(css.includes('var(--sq-shadow)'), 'shadow usage')
  assert.ok(css.includes('var(--sq-backdrop)'), 'backdrop usage')
  const bare = css.split('\n').filter((line) => !line.includes('--sq-shadow') && !line.includes('--sq-backdrop'))
  assert.equal(bare.join('\n').includes('#000'), false, 'no bare #000 outside the variable definitions')
  assert.equal(css.includes('prefers-color-scheme'), false, 'the theme attribute decides, not the OS scheme')
})

test('an external plugin can register a button, and the Host hears about it', () => {
  const api = globalThis.window.dshSessionQuickbar
  const before = posts.length
  const dispose = api.register({
    id: 'ru-word-card',
    labels: { zh: '词卡', en: 'Word card' },
    order: 120,
    icon: 'M3 8h10',
    onActivate() {},
  })
  assert.equal(api.list().some((action) => action.id === 'ru-word-card'), true)
  api.unregister('ru-word-card')
  assert.equal(api.list().some((action) => action.id === 'ru-word-card'), false)
  dispose()
  // The registration POST is async and fire-and-forget; give it a tick.
  return new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
    assert.ok(posts.length >= before)
    assert.ok(posts.slice(before).some((post) => post.url === '/session-quickbar'
      && String(post.options?.body ?? '').includes('ru-word-card')))
  })
})

test('invalid registrations are refused without breaking the registry', () => {
  const api = globalThis.window.dshSessionQuickbar
  api.register({ id: 'bad id', onActivate() {} })
  api.register({ id: 'no-handler' })
  api.register({ id: 'star', onActivate() {} })
  const ids = api.list().map((action) => action.id)
  assert.equal(ids.includes('bad id'), false)
  assert.equal(ids.includes('no-handler'), false)
  assert.equal(ids.filter((id) => id === 'star').length, 1)
})

test('the plugin detail self-test registers with the spec metadata', () => {
  const section = registrations.find((entry) => entry.options.name === 'plugins.detail.section')
  assert.ok(section, 'the detail section is registered')
  assert.equal(section.options.id, 'dsh-session-quickbar.selftest')
  assert.equal(section.options.order, 90)
  assert.equal(section.options.locale, 'session-quickbar')
})

test('the dictionaries cover the baseline locales', () => {
  assert.equal(localeRegistrations.length, 1)
  const { namespace, dictionaries } = localeRegistrations[0]
  assert.equal(namespace, 'session-quickbar')
  assert.ok(dictionaries.zh)
  assert.ok(dictionaries.en)
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort())
})
