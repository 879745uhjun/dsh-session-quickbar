/**
 * dsh-session-quickbar — Host half.
 *
 * Owns the quick-action strip on the right of every Session row in the
 * workspace sidebar: which buttons a Session shows, in what order, and
 * whether the bar replaces the buttons other plugins put in that seat.
 *
 * The browser half renders the strip. This half is the durable authority for
 * the layout, the shared action registry, and the channel between the bar and
 * the Sessions that author plugins:
 *
 *  - GET  /session-quickbar         returns the whole layout document;
 *  - POST /session-quickbar         applies one mutation and returns the document;
 *  - GET  /session-quickbar/events  pushes each committed document (Server-Sent Events);
 *  - the session_quickbar tool      reads/changes layouts, registers actions,
 *                                   subscribes a Session to changes, and
 *                                   delivers messages between Sessions.
 *
 * A Session that authors a plugin calls `register` to announce its button and
 * `watch` to hear about later layout changes; every change is also injected
 * into subscribed agents as one short message, so the authoring Session knows
 * where its button landed and can answer through `notify`.
 *
 * @module dsh-session-quickbar
 */
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync as readManifest, statSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cordis plugin name. */
export const name = 'dsh-session-quickbar'

/** Required Host services; the web route additionally waits for 'webServer'. */
export const inject = ['tools']

/** Same-origin route the browser half talks to. */
const ROUTE = '/session-quickbar'
/** Server-Sent Events route that pushes layout changes to every window. */
const EVENTS_ROUTE = '/session-quickbar/events'
/** Installed profile bundles that could contribute a button. */
const PLUGINS_ROUTE = '/session-quickbar/plugins'
/** SSE heartbeat interval; keeps idle proxies and sockets alive. */
const SSE_HEARTBEAT_MS = 20_000
/** Layout file format version. */
const FILE_VERSION = 1
/** Request-body ceiling for the browser route. */
const MAX_BODY_BYTES = 128 * 1024
/** Longest session id accepted (session ids are UUIDs, far shorter). */
const MAX_SESSION_ID_LENGTH = 200
/** Longest layout accepted for one scope. */
const MAX_ITEMS = 24
/** Longest action id. */
const MAX_ID_LENGTH = 80
/** Longest localized label. */
const MAX_LABEL_LENGTH = 40
/** Longest localized hint. */
const MAX_HINT_LENGTH = 160
/** Longest channel message. */
const MAX_TEXT_LENGTH = 4000
/** Most recent layout changes kept in the file. */
const MAX_LOG = 40
/** Most recent channel messages kept in the file. */
const MAX_MESSAGES = 120
/** Known-session cache size (ids and titles only). */
const MAX_KNOWN_SESSIONS = 300
/** Default page size of the messages action. */
const DEFAULT_MESSAGE_LIMIT = 20

/**
 * The seed registry: the built-in buttons the browser half already knows how
 * to draw. `todo`, `star`, and `copy-id` are provided by the bar itself, so a
 * user who disables the owning plugin still gets a working button.
 */
const BUILTIN_ACTIONS = [
  {
    id: 'star',
    order: 10,
    hiddenByDefault: true,
    labels: { zh: '星标', en: 'Star' },
    hint: { zh: '给这个会话打星标（复用会话星标插件的数据）', en: 'Star this session (uses the session-stars plugin data)' },
  },
  {
    id: 'todo',
    order: 20,
    labels: { zh: '待办', en: 'Todo' },
    hint: { zh: '勾选这个会话的待办（复用会话待办插件的数据）', en: 'Check this session todo (uses the session-todos plugin data)' },
  },
  {
    id: 'archive',
    order: 30,
    hiddenByDefault: true,
    labels: { zh: '归档', en: 'Archive' },
    hint: { zh: '归档或取消归档这个会话', en: 'Archive or unarchive this session' },
  },
  {
    id: 'pin',
    order: 40,
    hiddenByDefault: true,
    labels: { zh: '置顶', en: 'Pin' },
    hint: { zh: '置顶或取消置顶这个会话', en: 'Pin or unpin this session' },
  },
  {
    id: 'copy-id',
    order: 50,
    hiddenByDefault: true,
    labels: { zh: '复制 ID', en: 'Copy ID' },
    hint: { zh: '复制这个会话的 ID', en: 'Copy this session id' },
  },
  {
    id: 'notify',
    order: 60,
    labels: { zh: '完成提醒', en: 'Finish alert' },
    hint: { zh: '这个会话结束时在右下角弹出提醒（复用会话提醒插件）', en: 'Show a desktop card when this session finishes (uses the session-notify plugin)' },
  },
  {
    id: 'pack',
    order: 70,
    hiddenByDefault: true,
    labels: { zh: '打包', en: 'Pack' },
    hint: { zh: '把这个会话打包成可移植文件（复用会话迁移插件）', en: 'Pack this session into a portable file (uses the session-transfer plugin)' },
  },
  {
    id: 'token',
    order: 80,
    hiddenByDefault: true,
    labels: { zh: '用量', en: 'Usage' },
    hint: { zh: '这个会话的 token 用量，点开看明细（复用 Token 用量插件）', en: 'Token usage for this session, click for the breakdown (uses the token-usage plugin)' },
  },
  {
    id: 'boxes',
    order: 90,
    hiddenByDefault: true,
    labels: { zh: '盒子', en: 'Boxes' },
    hint: { zh: '把这个会话放进分组盒子（复用会话盒子插件）', en: 'Put this session into a group box (uses the session-boxes plugin)' },
  },
]

/** One warning sink that reports each distinct failure once. */
function createLogger() {
  const seen = new Set()
  return (message, error) => {
    const key = error === undefined ? message : message + ': ' + (error?.code ?? error?.message ?? String(error))
    if (seen.has(key)) return
    seen.add(key)
    if (error !== undefined) console.warn('[session-quickbar] ' + message, error)
    else console.warn('[session-quickbar] ' + message)
  }
}

/** A non-negative integer timestamp, or 0 when the value is unusable. */
function toTimestamp(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.floor(number)
}

/**
 * Installed profile bundles, read from the profile's node_modules manifests.
 * The browser half cross-references this list with the plugins actually loaded
 * in the page, so the settings page can show what could contribute a button.
 * Cached briefly: the list changes only when a bundle is installed or removed.
 */
function createPluginScanner(log) {
  let cached = { at: 0, rows: [] }
  const TTL_MS = 15_000
  const MAX_PACKAGES = 200
  const MAX_MANIFEST_BYTES = 256 * 1024

  function read() {
    const profileDir = process.env.DSH_PROFILE_DIR
    if (typeof profileDir !== 'string' || profileDir === '') return []
    const root = join(profileDir, 'node_modules')
    const rows = []
    const seen = new Set()
    const pending = [{ dir: root, depth: 0 }]
    while (pending.length > 0 && rows.length < MAX_PACKAGES) {
      const { dir, depth } = pending.pop()
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const path = join(dir, entry.name)
        if (entry.name.startsWith('@')) {
          if (depth === 0) pending.push({ dir: path, depth: depth + 1 })
          continue
        }
        try {
          if (!statSync(path).isDirectory()) continue
          const manifestPath = join(path, 'package.json')
          if (statSync(manifestPath).size > MAX_MANIFEST_BYTES) continue
          const pkg = JSON.parse(readManifest(manifestPath, 'utf8'))
          if (typeof pkg?.name !== 'string' || pkg.name === '' || seen.has(pkg.name)) continue
          seen.add(pkg.name)
          rows.push({
            name: pkg.name,
            version: typeof pkg.version === 'string' ? pkg.version : '',
            description: typeof pkg.description === 'string' ? pkg.description.slice(0, 240) : '',
            client: pkg.dsh?.client !== undefined,
            bundle: pkg.dsh?.bundle !== undefined,
          })
        } catch {
          /* a broken or unreadable package cannot contribute a button */
        }
      }
    }
    rows.sort((left, right) => left.name.localeCompare(right.name))
    return rows
  }

  return function scan() {
    const now = Date.now()
    if (now - cached.at < TTL_MS) return cached.rows
    try {
      cached = { at: now, rows: read() }
    } catch (error) {
      log('could not scan the profile plugins', error)
      cached = { at: now, rows: [] }
    }
    return cached.rows
  }
}

/** Trim and bound one free-form string. */
function normalizeText(value, limit) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, limit)
}

/** One valid action id, or null. */
function normalizeId(value) {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return null
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? id : null
}

/** One valid session id, or null. */
function normalizeSessionId(value) {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (id.length === 0 || id.length > MAX_SESSION_ID_LENGTH) return null
  return id
}

/** A `{ zh, en }` label pair, dropping empty entries. */
function normalizeLabels(value) {
  const labels = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return labels
  for (const key of ['zh', 'en']) {
    const text = normalizeText(value[key], MAX_LABEL_LENGTH)
    if (text !== '') labels[key] = text
  }
  return labels
}

/** A `{ zh, en }` hint pair, dropping empty entries. */
function normalizeHints(value) {
  const hints = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return hints
  for (const key of ['zh', 'en']) {
    const text = normalizeText(value[key], MAX_HINT_LENGTH)
    if (text !== '') hints[key] = text
  }
  return hints
}

/** One stored layout item, or null. */
function normalizeItem(value) {
  if (typeof value === 'string') {
    const id = normalizeId(value)
    return id === null ? null : { id, visible: true }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const id = normalizeId(value.id)
  if (id === null) return null
  return { id, visible: value.visible !== false }
}

/** A bounded, de-duplicated, ordered layout. */
function normalizeItems(raw) {
  if (!Array.isArray(raw)) return []
  const items = []
  const seen = new Set()
  for (const entry of raw.slice(0, MAX_ITEMS)) {
    const item = normalizeItem(entry)
    if (item === null || seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  return items
}

/** One registered action record, or null. */
function normalizeAction(value, fallbackSource = 'client') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const id = normalizeId(value.id)
  if (id === null) return null
  const order = Number(value.order)
  return {
    id,
    labels: normalizeLabels(value.labels),
    hint: normalizeHints(value.hint),
    order: Number.isFinite(order) ? Math.min(Math.max(Math.trunc(order), 0), 10_000) : 500,
    source: value.source === 'builtin' || value.source === 'tool' ? value.source : fallbackSource,
    ownerSession: normalizeSessionId(value.ownerSession),
    owner: normalizeText(value.owner, 120) || null,
    registeredAt: toTimestamp(value.registeredAt) || Date.now(),
  }
}

/** The built-in registry records, always authoritative for their own metadata. */
function builtinRegistry() {
  const actions = {}
  for (const entry of BUILTIN_ACTIONS) {
    actions[entry.id] = {
      id: entry.id,
      labels: { ...entry.labels },
      hint: { ...entry.hint },
      order: entry.order,
      source: 'builtin',
      ownerSession: null,
      owner: null,
      registeredAt: 0,
    }
  }
  return actions
}

/** One channel message, or null. */
function normalizeMessage(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const to = normalizeSessionId(value.to)
  if (to === null) return null
  const text = normalizeText(value.text, MAX_TEXT_LENGTH)
  if (text === '') return null
  return {
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : randomUUID(),
    at: toTimestamp(value.at) || Date.now(),
    from: normalizeText(value.from, MAX_SESSION_ID_LENGTH + 40) || 'user',
    to,
    text,
    kind: value.kind === 'change' ? 'change' : 'message',
    deliveredAt: toTimestamp(value.deliveredAt),
  }
}

/** Copy and validate a stored document, dropping anything unexpected. */
function normalizeDoc(raw) {
  const doc = {
    version: FILE_VERSION,
    updatedAt: toTimestamp(raw?.updatedAt),
    global: { items: [], takeover: true, updatedAt: 0 },
    sessions: {},
    panels: { hidden: [] },
    actions: builtinRegistry(),
    subscriptions: {},
    knownSessions: {},
    log: [],
    messages: [],
  }
  const globalRaw = raw?.global
  if (globalRaw !== null && typeof globalRaw === 'object') {
    doc.global.items = normalizeItems(globalRaw.items)
    doc.global.takeover = globalRaw.takeover !== false
    doc.global.updatedAt = toTimestamp(globalRaw.updatedAt)
  }
  const panelsRaw = raw?.panels
  if (panelsRaw !== null && typeof panelsRaw === 'object' && Array.isArray(panelsRaw.hidden)) {
    const seen = new Set()
    for (const value of panelsRaw.hidden.slice(0, MAX_ITEMS)) {
      const id = normalizeId(value)
      if (id === null || seen.has(id)) continue
      seen.add(id)
      doc.panels.hidden.push(id)
    }
  }
  const sessionsRaw = raw?.sessions
  if (sessionsRaw !== null && typeof sessionsRaw === 'object' && !Array.isArray(sessionsRaw)) {
    for (const [rawSessionId, value] of Object.entries(sessionsRaw)) {
      const sessionId = normalizeSessionId(rawSessionId)
      if (sessionId === null || value === null || typeof value !== 'object') continue
      if (!Array.isArray(value.items)) continue
      doc.sessions[sessionId] = {
        items: normalizeItems(value.items),
        updatedAt: toTimestamp(value.updatedAt),
      }
    }
  }
  const actionsRaw = raw?.actions
  if (actionsRaw !== null && typeof actionsRaw === 'object' && !Array.isArray(actionsRaw)) {
    for (const value of Object.values(actionsRaw)) {
      const action = normalizeAction(value)
      if (action === null || doc.actions[action.id]?.source === 'builtin') continue
      doc.actions[action.id] = action
    }
  }
  const subscriptionsRaw = raw?.subscriptions
  if (subscriptionsRaw !== null && typeof subscriptionsRaw === 'object') {
    for (const [rawSessionId, value] of Object.entries(subscriptionsRaw)) {
      const sessionId = normalizeSessionId(rawSessionId)
      if (sessionId === null || value === null || typeof value !== 'object') continue
      doc.subscriptions[sessionId] = {
        since: toTimestamp(value.since) || Date.now(),
        note: normalizeText(value.note, MAX_HINT_LENGTH),
      }
    }
  }
  const knownRaw = raw?.knownSessions
  if (knownRaw !== null && typeof knownRaw === 'object' && !Array.isArray(knownRaw)) {
    let count = 0
    for (const [rawSessionId, value] of Object.entries(knownRaw)) {
      if (count >= MAX_KNOWN_SESSIONS) break
      const sessionId = normalizeSessionId(rawSessionId)
      if (sessionId === null || value === null || typeof value !== 'object') continue
      doc.knownSessions[sessionId] = {
        title: normalizeText(value.title, 200),
        cwd: normalizeText(value.cwd, 500),
        updatedAt: toTimestamp(value.updatedAt),
        archived: value.archived === true,
        running: value.running === true,
        seenAt: toTimestamp(value.seenAt) || Date.now(),
      }
      count++
    }
  }
  if (Array.isArray(raw?.log)) {
    for (const value of raw.log.slice(-MAX_LOG)) {
      if (value === null || typeof value !== 'object') continue
      doc.log.push({
        at: toTimestamp(value.at),
        by: normalizeText(value.by, MAX_SESSION_ID_LENGTH + 40) || 'user',
        scope: value.scope === 'session' ? 'session' : 'global',
        sessionId: normalizeSessionId(value.sessionId),
        summary: normalizeText(value.summary, 300),
      })
    }
  }
  if (Array.isArray(raw?.messages)) {
    for (const value of raw.messages.slice(-MAX_MESSAGES)) {
      const message = normalizeMessage(value)
      if (message !== null) doc.messages.push(message)
    }
  }
  return doc
}

/** A JSON-safe deep copy of the current document. */
function snapshotDoc(doc) {
  return JSON.parse(JSON.stringify(doc))
}

/** The layout in force for one Session, plus where it came from. */
function effectiveLayout(doc, sessionId) {
  if (sessionId !== null && doc.sessions[sessionId] !== undefined) {
    return { items: doc.sessions[sessionId].items, source: 'session', updatedAt: doc.sessions[sessionId].updatedAt }
  }
  if (doc.global.items.length > 0) {
    return { items: doc.global.items, source: 'global', updatedAt: doc.global.updatedAt }
  }
  const items = BUILTIN_ACTIONS
    .filter((entry) => entry.hiddenByDefault !== true)
    .map((entry) => ({ id: entry.id, visible: true }))
  return { items, source: 'default', updatedAt: 0 }
}

/** Human-readable layout names for change summaries. */
function layoutLabel(doc, id) {
  const labels = doc.actions[id]?.labels ?? {}
  return labels.zh ?? labels.en ?? id
}

/** One Chinese summary line describing a layout. */
function describeLayout(doc, items) {
  if (items.length === 0) return '空（不显示任何按钮）'
  return items
    .map((item, index) => (item.visible ? '' : '×') + (index + 1) + '.' + layoutLabel(doc, item.id))
    .join('、')
}

/** Compare two layouts by meaning, returning the ids whose state changed. */
function changedIds(before, after) {
  const ids = new Set()
  for (const item of before) ids.add(item.id)
  for (const item of after) ids.add(item.id)
  const state = (items) => {
    const map = new Map()
    items.forEach((item, index) => map.set(item.id, String(index) + ':' + String(item.visible)))
    return map
  }
  const left = state(before)
  const right = state(after)
  const changed = []
  for (const id of ids) {
    if (left.get(id) !== right.get(id)) changed.push(id)
  }
  return changed
}

/**
 * One durable layout document backed by a single JSON file.
 * Reads are served from memory after the first load; writes are serialized
 * and published atomically (temporary file, then rename).
 */
function createStore(file, log) {
  let doc = normalizeDoc(null)
  let loaded = null
  let writeChain = Promise.resolve()
  const listeners = new Set()

  function emit(change) {
    const snapshot = snapshotDoc(doc)
    for (const listener of listeners) {
      try {
        listener(snapshot, change)
      } catch (error) {
        log('a layout listener failed', error)
      }
    }
  }

  function load() {
    if (loaded !== null) return loaded
    loaded = (async () => {
      try {
        const text = await readFile(file, 'utf8')
        doc = normalizeDoc(JSON.parse(text))
      } catch (error) {
        if (error?.code !== 'ENOENT') log('could not read ' + file, error)
      }
    })()
    return loaded
  }

  function persist() {
    doc.updatedAt = Date.now()
    const body = JSON.stringify(doc, null, 2)
    writeChain = writeChain
      .then(async () => {
        await mkdir(dirname(file), { recursive: true })
        const temporary = file + '.' + process.pid + '.' + Date.now() + '.tmp'
        await writeFile(temporary, body, 'utf8')
        await rename(temporary, file)
      })
      .catch((error) => {
        log('could not write ' + file, error)
      })
    return writeChain
  }

  function record(entry) {
    doc.log.push(entry)
    if (doc.log.length > MAX_LOG) doc.log.splice(0, doc.log.length - MAX_LOG)
  }

  return {
    load,
    snapshot: () => snapshotDoc(doc),
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    /** Replace the layout of one scope. */
    async setLayout({ scope, sessionId, items, takeover, by }) {
      await load()
      const nextItems = normalizeItems(items)
      if (scope === 'session') {
        const before = effectiveLayout(doc, sessionId).items
        doc.sessions[sessionId] = { items: nextItems, updatedAt: Date.now() }
        const after = effectiveLayout(doc, sessionId).items
        const changed = changedIds(before, after)
        record({
          at: Date.now(),
          by,
          scope: 'session',
          sessionId,
          summary: '会话快捷栏改为：' + describeLayout(doc, nextItems),
        })
        await persist()
        emit({ kind: 'layout', scope: 'session', sessionId, changed, by })
        return
      }
      if (takeover !== undefined) doc.global.takeover = takeover !== false
      const before = effectiveLayout(doc, null).items
      doc.global.items = nextItems
      doc.global.updatedAt = Date.now()
      const after = effectiveLayout(doc, null).items
      const changed = changedIds(before, after)
      record({
        at: Date.now(),
        by,
        scope: 'global',
        sessionId: null,
        summary: '全局快捷栏改为：' + describeLayout(doc, nextItems),
      })
      await persist()
      emit({ kind: 'layout', scope: 'global', sessionId: null, changed, by })
    },

    /** Remove one scope override, restoring the inherited layout. */
    async resetLayout({ scope, sessionId, by }) {
      await load()
      const target = scope === 'session' ? sessionId : null
      const before = effectiveLayout(doc, target).items
      if (scope === 'session') {
        if (doc.sessions[sessionId] === undefined) return
        delete doc.sessions[sessionId]
        record({ at: Date.now(), by, scope: 'session', sessionId, summary: '会话快捷栏恢复为全局设置' })
      } else {
        doc.global.items = []
        doc.global.takeover = true
        doc.global.updatedAt = Date.now()
        record({ at: Date.now(), by, scope: 'global', sessionId: null, summary: '全局快捷栏恢复为默认按钮' })
      }
      const after = effectiveLayout(doc, target).items
      const changed = changedIds(before, after)
      await persist()
      emit({ kind: 'layout', scope, sessionId, changed, by, reset: true })
    },

    /** Add or update one registered action. */
    async registerAction(action, by) {
      await load()
      const existing = doc.actions[action.id]
      if (existing !== undefined && existing.source === 'builtin') {
        return { ok: false, error: action.id + ' is a built-in action' }
      }
      doc.actions[action.id] = {
        ...action,
        source: action.source === 'tool' ? 'tool' : 'client',
        registeredAt: existing?.registeredAt ?? Date.now(),
      }
      record({
        at: Date.now(),
        by,
        scope: 'global',
        sessionId: null,
        summary: '登记按钮：' + action.id + '（' + (action.labels.zh ?? action.labels.en ?? '') + '）',
      })
      await persist()
      emit({ kind: 'action', actionId: action.id, by })
      return { ok: true }
    },

    /** Drop one non-built-in registered action. */
    async unregisterAction(id, by) {
      await load()
      const existing = doc.actions[id]
      if (existing === undefined) return { ok: false, error: 'unknown action ' + id }
      if (existing.source === 'builtin') return { ok: false, error: id + ' is a built-in action' }
      delete doc.actions[id]
      record({ at: Date.now(), by, scope: 'global', sessionId: null, summary: '移除按钮：' + id })
      await persist()
      emit({ kind: 'action', actionId: id, removed: true, by })
      return { ok: true }
    },

    /** Replace the hidden sidebar panel entries. */
    async setPanels(hidden, by) {
      await load()
      const next = []
      const seen = new Set()
      for (const value of Array.isArray(hidden) ? hidden.slice(0, MAX_ITEMS) : []) {
        const id = normalizeId(value)
        if (id === null || seen.has(id)) continue
        seen.add(id)
        next.push(id)
      }
      doc.panels.hidden = next
      record({
        at: Date.now(),
        by,
        scope: 'global',
        sessionId: null,
        summary: '面板入口收进「更多」：' + (next.length === 0 ? '无' : next.join('、')),
      })
      await persist()
      emit({ kind: 'panels', hidden: next, by })
    },

    /** Subscribe a Session to layout changes. */
    async watch(sessionId, note) {
      await load()
      doc.subscriptions[sessionId] = { since: Date.now(), note }
      await persist()
      return snapshotDoc(doc)
    },

    /** Unsubscribe a Session. */
    async unwatch(sessionId) {
      await load()
      if (doc.subscriptions[sessionId] === undefined) return false
      delete doc.subscriptions[sessionId]
      await persist()
      return true
    },

    /** Remember session titles reported by the browser half, for title targeting. */
    async noteSessions(rows) {
      await load()
      let changed = false
      for (const row of rows) {
        const sessionId = normalizeSessionId(row?.id)
        if (sessionId === null) continue
        const title = normalizeText(row.title, 200)
        const cwd = normalizeText(row.cwd, 500)
        const previous = doc.knownSessions[sessionId]
        if (previous !== undefined && previous.title === title && previous.cwd === cwd
          && previous.archived === (row.archived === true) && previous.running === (row.running === true)) {
          previous.seenAt = Date.now()
          continue
        }
        doc.knownSessions[sessionId] = {
          title,
          cwd,
          updatedAt: toTimestamp(row.updatedAt),
          archived: row.archived === true,
          running: row.running === true,
          seenAt: Date.now(),
        }
        changed = true
      }
      const ids = Object.keys(doc.knownSessions)
      if (ids.length > MAX_KNOWN_SESSIONS) {
        ids.sort((left, right) => (doc.knownSessions[left].seenAt ?? 0) - (doc.knownSessions[right].seenAt ?? 0))
        for (const id of ids.slice(0, ids.length - MAX_KNOWN_SESSIONS)) delete doc.knownSessions[id]
        changed = true
      }
      if (changed) await persist()
      return changed
    },

    /** Session lookup: exact id first, then an exact title, then a unique title fragment. */
    resolveSession(target) {
      const text = typeof target === 'string' ? target.trim() : ''
      if (text === '') return null
      const exactId = normalizeSessionId(text)
      if (exactId !== null && doc.knownSessions[exactId] !== undefined) return exactId
      const rows = Object.entries(doc.knownSessions)
      const byTitle = rows.filter(([, value]) => value.title === text)
      if (byTitle.length === 1) return byTitle[0][0]
      if (exactId !== null && byTitle.length === 0 && text.length > 20) return exactId
      const lower = text.toLowerCase()
      const matches = rows.filter(([, value]) => value.title.toLowerCase().includes(lower))
      if (matches.length === 1) return matches[0][0]
      if (matches.length > 1) return { ambiguous: matches.map(([id, value]) => ({ id, title: value.title })) }
      return exactId
    },

    /** Queue one channel message; delivery is attempted by the caller. */
    async appendMessage(message) {
      await load()
      const entry = normalizeMessage(message)
      if (entry === null) return null
      doc.messages.push(entry)
      if (doc.messages.length > MAX_MESSAGES) doc.messages.splice(0, doc.messages.length - MAX_MESSAGES)
      await persist()
      return entry
    },

    /** Mark one message delivered. */
    async markDelivered(id) {
      await load()
      const entry = doc.messages.find((message) => message.id === id)
      if (entry === undefined || entry.deliveredAt !== 0) return
      entry.deliveredAt = Date.now()
      await persist()
    },

    /** Messages addressed to one Session, oldest first. */
    inboxOf(sessionId, limit) {
      return snapshotDoc(doc).messages
        .filter((message) => message.to === sessionId)
        .slice(-limit)
    },
  }
}

/** Answer one JSON response with no-store caching. */
function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** Read a bounded UTF-8 request body. */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body is too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', reject)
  })
}

/** Refuse a cross-site POST; same-origin requests and plain HTTP clients pass. */
function isAcceptableOrigin(request) {
  const origin = request.headers.origin
  if (origin === undefined) return true
  if (origin === 'null') return false
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

/** Validate one mutation payload from the browser half. */
function readMutation(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'body must be a JSON object' }
  }
  const action = payload.action ?? 'set'
  if (action === 'set') {
    const scope = payload.scope === 'session' ? 'session' : 'global'
    const sessionId = scope === 'session' ? normalizeSessionId(payload.sessionId) : null
    if (scope === 'session' && sessionId === null) return { ok: false, error: 'sessionId is required for a session layout' }
    if (!Array.isArray(payload.items)) return { ok: false, error: 'items must be an array' }
    if (payload.items.length > MAX_ITEMS) return { ok: false, error: 'items must hold at most ' + MAX_ITEMS + ' entries' }
    const items = normalizeItems(payload.items)
    if (items.length !== payload.items.length) return { ok: false, error: 'every item needs a unique, valid id' }
    if (scope === 'global' && payload.takeover !== undefined && typeof payload.takeover !== 'boolean') {
      return { ok: false, error: 'takeover must be a boolean' }
    }
    return {
      ok: true,
      mutation: {
        action,
        scope,
        sessionId,
        items,
        takeover: scope === 'global' ? payload.takeover : undefined,
      },
    }
  }
  if (action === 'reset') {
    const scope = payload.scope === 'session' ? 'session' : 'global'
    const sessionId = scope === 'session' ? normalizeSessionId(payload.sessionId) : null
    if (scope === 'session' && sessionId === null) return { ok: false, error: 'sessionId is required for a session layout' }
    return { ok: true, mutation: { action, scope, sessionId } }
  }
  if (action === 'register-action') {
    const id = normalizeId(payload.id)
    if (id === null) return { ok: false, error: 'id must be a valid action id' }
    const labels = normalizeLabels(payload.labels)
    if (labels.zh === undefined && labels.en === undefined) return { ok: false, error: 'labels needs at least one language' }
    const order = Number(payload.order)
    return {
      ok: true,
      mutation: {
        action,
        record: {
          id,
          labels,
          hint: normalizeHints(payload.hint),
          order: Number.isFinite(order) ? Math.trunc(order) : 500,
          source: 'client',
          ownerSession: null,
          owner: normalizeText(payload.owner, 120) || null,
        },
      },
    }
  }
  if (action === 'unregister-action') {
    const id = normalizeId(payload.id)
    if (id === null) return { ok: false, error: 'id must be a valid action id' }
    return { ok: true, mutation: { action, id } }
  }
  if (action === 'panels') {
    if (!Array.isArray(payload.hidden)) return { ok: false, error: 'hidden must be an array' }
    if (payload.hidden.length > MAX_ITEMS) return { ok: false, error: 'hidden holds at most ' + MAX_ITEMS + ' entries' }
    const hidden = []
    const seen = new Set()
    for (const value of payload.hidden) {
      const id = normalizeId(value)
      if (id === null) return { ok: false, error: 'every hidden entry needs a valid panel id' }
      if (seen.has(id)) continue
      seen.add(id)
      hidden.push(id)
    }
    return { ok: true, mutation: { action, hidden } }
  }
  if (action === 'catalog') {
    if (!Array.isArray(payload.rows)) return { ok: false, error: 'rows must be an array' }
    const rows = []
    for (const row of payload.rows.slice(0, MAX_KNOWN_SESSIONS)) {
      const id = normalizeSessionId(row?.id)
      if (id === null) continue
      rows.push({
        id,
        title: normalizeText(row.title, 200),
        cwd: normalizeText(row.cwd, 500),
        updatedAt: toTimestamp(row.updatedAt),
        archived: row.archived === true,
        running: row.running === true,
      })
    }
    return { ok: true, mutation: { action, rows } }
  }
  return { ok: false, error: 'unknown action "' + String(action) + '"' }
}

/** The browser-facing plugin survey: installed profile bundles with a client half. */
function createPluginsRoute(scan, log) {
  return function handleSessionQuickbarPlugins(request, response) {
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET', 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
      return
    }
    if (!isAcceptableOrigin(request)) {
      sendJson(response, 403, { ok: false, error: 'cross-origin request refused' })
      return
    }
    try {
      sendJson(response, 200, { ok: true, plugins: scan() })
    } catch (error) {
      log('could not scan the profile plugins', error)
      sendJson(response, 500, { ok: false, error: 'could not scan plugins' })
    }
  }
}

/** The browser-facing JSON route: GET the document, POST one mutation. */
function createRouteHandler(store, log, onMutation) {
  return async function handleSessionQuickbar(request, response) {
    try {
      if (!isAcceptableOrigin(request)) {
        sendJson(response, 403, { ok: false, error: 'cross-origin request refused' })
        return
      }
      if (request.method === 'GET') {
        await store.load()
        sendJson(response, 200, { ok: true, config: store.snapshot() })
        return
      }
      if (request.method === 'POST') {
        let payload
        try {
          payload = JSON.parse(await readBody(request, MAX_BODY_BYTES))
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error.message === 'request body is too large' ? error.message : 'invalid JSON body' })
          return
        }
        const parsed = readMutation(payload)
        if (!parsed.ok) {
          sendJson(response, 400, { ok: false, error: parsed.error })
          return
        }
        await onMutation(parsed.mutation)
        sendJson(response, 200, { ok: true, config: store.snapshot() })
        return
      }
      response.writeHead(405, { allow: 'GET, POST', 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
    } catch (error) {
      log('request failed', error)
      try {
        sendJson(response, 500, { ok: false, error: 'internal error' })
      } catch {
        response.destroy()
      }
    }
  }
}

/** Server-Sent Events hub: pushes each committed document to every open window. */
function createEventHub(store, log) {
  const clients = new Set()
  let closed = false
  const unsubscribe = store.subscribe((doc) => {
    if (closed) return
    const frame = 'event: config\ndata: ' + JSON.stringify({ ok: true, config: doc }) + '\n\n'
    for (const client of clients) {
      try {
        client.write(frame)
      } catch {
        clients.delete(client)
      }
    }
  })

  function attach(request, response) {
    if (closed) {
      sendJson(response, 503, { ok: false, error: 'event stream is shutting down' })
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET', 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
      return
    }
    if (!isAcceptableOrigin(request)) {
      sendJson(response, 403, { ok: false, error: 'cross-origin request refused' })
      return
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    response.write('retry: 3000\n\n')

    let heartbeat = null
    let detached = false
    const cleanup = () => {
      if (detached) return
      detached = true
      if (heartbeat !== null) clearInterval(heartbeat)
      clients.delete(response)
    }
    request.on('close', cleanup)
    response.on('close', cleanup)
    heartbeat = setInterval(() => {
      try {
        response.write(': ping\n\n')
      } catch {
        cleanup()
      }
    }, SSE_HEARTBEAT_MS)
    heartbeat.unref?.()

    void store.load().then(() => {
      if (detached) return
      clients.add(response)
      try {
        response.write('event: config\ndata: ' + JSON.stringify({ ok: true, config: store.snapshot() }) + '\n\n')
      } catch {
        cleanup()
      }
    }, (error) => {
      log('could not start the event stream', error)
      cleanup()
      try {
        response.end()
      } catch {
        /* the socket is already gone */
      }
    })
  }

  return {
    attach,
    close() {
      if (closed) return
      closed = true
      unsubscribe()
      for (const client of clients) {
        try {
          client.end()
        } catch {
          /* the client disconnected first */
        }
      }
      clients.clear()
    },
  }
}

/** One identified user-role message carrying injected text. */
function injectedMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'session-quickbar' },
  }
}

/** The session_quickbar agent tool over the same store and channel. */
function createTool({ store, log, deliver, agents, scanPlugins }) {
  return {
    name: 'session_quickbar',
    description:
      'Read or change the quick-action bar on the right of every Session row in the DeepSeek Harness sidebar, and talk to the Sessions that author plugins. '
      + 'The bar shows registered buttons (star, todo, archive, pin, copy-id, and any button a plugin registered through the browser half). A layout is an ordered list of action ids with a visibility flag; a Session layout overrides the global layout. '
      + 'Use action "get" to read the layout in force, "set" to replace one layout, "reset" to drop an override, "register" to announce a button id you are building, "unregister" to remove it, "watch"/"unwatch" to subscribe this Session to layout changes, "notify" to send a message to another Session, "messages" to read the channel, "sessions" to list known Session ids and titles, and "plugins" to list the installed profile bundles that could contribute a button. '
      + 'Registering and watching is how an authoring Session learns where its button landed; every layout change is injected into watching Sessions, and they answer with "notify". A notify wakes an idle target by default (pass wake:false to queue silently).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set', 'reset', 'register', 'unregister', 'watch', 'unwatch', 'notify', 'messages', 'sessions', 'plugins'],
          description: 'Operation to perform.',
        },
        sessionId: {
          type: 'string',
          description: 'Target Session id (or, for "notify"/"messages", an id, an exact title, or a unique title fragment). Omit for get/set/watch to use the calling Session where that makes sense.',
        },
        scope: {
          type: 'string',
          enum: ['global', 'session'],
          description: 'Layout scope for "set" and "reset"; defaults to "global".',
        },
        order: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ordered action ids for "set", left to right. Ids omitted from order and hidden are removed from the layout.',
        },
        hidden: {
          type: 'array',
          items: { type: 'string' },
          description: 'Action ids that stay in the layout but render hidden; used by "set".',
        },
        takeover: {
          type: 'boolean',
          description: 'Global only: whether the bar replaces the buttons other plugins put in the row action seat; used by "set" with scope "global".',
        },
        id: {
          type: 'string',
          description: 'Action id for "register"/"unregister"; lowercase letters, digits, dot, dash, underscore.',
        },
        owner: {
          type: 'string',
          description: 'Optional package name that owns the button (for example "dsh-session-stars"); used by "register" so the settings page can show which plugins already contribute a button.',
        },
        zh: {
          type: 'string',
          description: 'Chinese label for "register".',
        },
        en: {
          type: 'string',
          description: 'English label for "register".',
        },
        hint: {
          type: 'string',
          description: 'One-line Chinese hint describing what the button does; used by "register".',
        },
        position: {
          type: 'integer',
          description: 'Default position for "register" (ascending; built-ins run 10..90, and the default layout is the todo square plus the finish alert).',
        },
        note: {
          type: 'string',
          description: 'Optional note recorded with "watch".',
        },
        text: {
          type: 'string',
          description: 'Message body for "notify" (at most 4000 characters).',
        },
        wake: {
          type: 'boolean',
          description: 'Whether "notify" wakes an idle target Session into a new turn; defaults to true so the message is visible and acted on. Pass false to queue it as context for the next step of that Session.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum rows for "messages" and "sessions"; defaults to 20.',
        },
        with: {
          type: 'string',
          description: 'Only show messages exchanged with this Session id or title; used by "messages".',
        },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const action = args?.action
      const caller = typeof exec?.agent?.id === 'string' ? exec.agent.id : null
      await store.load()

      /** The layout report shared by get, set, and reset. */
      const readLayout = (target) => {
        const resolved = target === undefined || target === null ? null : store.resolveSession(target)
        if (resolved !== null && typeof resolved === 'object') {
          return { ok: false, error: 'sessionId matches several Sessions', candidates: resolved.ambiguous }
        }
        const sessionId = resolved ?? null
        const doc = store.snapshot()
        const layout = effectiveLayout(doc, sessionId)
        const position = new Map(layout.items.map((item, index) => [item.id, index]))
        const items = layout.items.map((item, index) => ({
          id: item.id,
          visible: item.visible,
          position: index + 1,
          labels: doc.actions[item.id]?.labels ?? {},
          hint: doc.actions[item.id]?.hint ?? {},
          source: doc.actions[item.id]?.source ?? 'unknown',
          ownerSession: doc.actions[item.id]?.ownerSession ?? null,
          owner: doc.actions[item.id]?.owner ?? null,
        }))
        const unplaced = Object.values(doc.actions)
          .filter((entry) => !position.has(entry.id))
          .map((entry) => ({ id: entry.id, labels: entry.labels, order: entry.order, source: entry.source, ownerSession: entry.ownerSession }))
        return {
          ok: true,
          action: 'get',
          sessionId,
          scope: layout.source,
          takeover: doc.global.takeover,
          items,
          unplaced,
          subscriptions: Object.entries(doc.subscriptions).map(([id, value]) => ({ sessionId: id, since: value.since, note: value.note })),
          recentChanges: doc.log.slice(-8),
          recentMessages: doc.messages.slice(-8).map((message) => ({ from: message.from, to: message.to, text: message.text, at: message.at, kind: message.kind })),
        }
      }

      if (action === 'get') {
        const target = args?.sessionId === undefined ? caller : args.sessionId
        return readLayout(target)
      }

      if (action === 'set') {
        const scope = args?.scope === 'session' ? 'session' : 'global'
        let sessionId = null
        if (scope === 'session') {
          const target = args?.sessionId ?? caller
          const resolved = target === undefined || target === null ? null : store.resolveSession(target)
          if (resolved !== null && typeof resolved === 'object') {
            return { ok: false, error: 'sessionId matches several Sessions', candidates: resolved.ambiguous }
          }
          if (resolved === null) return { ok: false, error: 'sessionId is required for a session layout' }
          sessionId = resolved
        }
        if (!Array.isArray(args?.order) && !Array.isArray(args?.hidden) && args?.takeover === undefined) {
          return { ok: false, error: 'set needs order, hidden, or takeover' }
        }
        const orderIds = Array.isArray(args?.order) ? args.order.map(normalizeId).filter((id) => id !== null) : null
        const hiddenIds = Array.isArray(args?.hidden) ? args.hidden.map(normalizeId).filter((id) => id !== null) : []
        let items
        if (orderIds !== null) {
          const hidden = new Set(hiddenIds)
          items = orderIds.map((id) => ({ id, visible: !hidden.has(id) }))
          for (const id of hiddenIds) {
            if (!orderIds.includes(id)) items.push({ id, visible: false })
          }
        } else {
          const current = effectiveLayout(store.snapshot(), sessionId).items
          const hidden = new Set(hiddenIds)
          items = current.map((item) => ({ id: item.id, visible: !hidden.has(item.id) }))
        }
        if (items.length > MAX_ITEMS) return { ok: false, error: 'a layout holds at most ' + MAX_ITEMS + ' entries' }
        if (items.length === 0) return { ok: false, error: 'a layout needs at least one action id' }
        await store.setLayout({
          scope,
          sessionId,
          items,
          takeover: scope === 'global' ? args?.takeover : undefined,
          by: caller === null ? 'agent' : 'agent:' + caller,
        })
        return readLayout(sessionId ?? undefined)
      }

      if (action === 'reset') {
        const scope = args?.scope === 'session' ? 'session' : 'global'
        const target = args?.sessionId ?? caller
        const resolved = scope === 'session' && target !== undefined && target !== null ? store.resolveSession(target) : null
        if (scope === 'session' && (resolved === null || typeof resolved === 'object')) {
          return { ok: false, error: resolved === null ? 'sessionId is required for a session layout' : 'sessionId matches several Sessions', candidates: resolved }
        }
        await store.resetLayout({
          scope,
          sessionId: resolved ?? null,
          by: caller === null ? 'agent' : 'agent:' + caller,
        })
        return readLayout(resolved ?? undefined)
      }

      if (action === 'register') {
        const id = normalizeId(args?.id)
        if (id === null) return { ok: false, error: 'id must be lowercase letters, digits, dot, dash, or underscore' }
        const labels = normalizeLabels({ zh: args?.zh, en: args?.en })
        if (labels.zh === undefined && labels.en === undefined) return { ok: false, error: 'register needs zh or en' }
        const position = Number(args?.position)
        const result = await store.registerAction({
          id,
          labels,
          hint: normalizeHints({ zh: args?.hint }),
          order: Number.isFinite(position) ? Math.trunc(position) : 500,
          source: 'tool',
          ownerSession: caller,
          owner: normalizeText(args?.owner, 120) || null,
        }, caller === null ? 'agent' : 'agent:' + caller)
        if (!result.ok) return { ok: false, error: result.error }
        if (caller !== null) await store.watch(caller, 'registered ' + id)
        const doc = store.snapshot()
        return {
          ok: true,
          action: 'register',
          id,
          ownerSession: caller,
          watched: caller !== null,
          note: 'The browser half still needs window.dshSessionQuickbar.register({ id: "' + id + '", ... }) so the bar can draw and click it.',
          layout: effectiveLayout(doc, caller).items,
        }
      }

      if (action === 'unregister') {
        const id = normalizeId(args?.id)
        if (id === null) return { ok: false, error: 'id must be lowercase letters, digits, dot, dash, or underscore' }
        const result = await store.unregisterAction(id, caller === null ? 'agent' : 'agent:' + caller)
        if (!result.ok) return { ok: false, error: result.error }
        return { ok: true, action: 'unregister', id }
      }

      if (action === 'watch' || action === 'unwatch') {
        const target = args?.sessionId ?? caller
        const resolved = target === undefined || target === null ? null : store.resolveSession(target)
        if (resolved === null || typeof resolved === 'object') {
          return { ok: false, error: resolved === null ? 'sessionId is required when no calling Session exists' : 'sessionId matches several Sessions', candidates: resolved }
        }
        if (action === 'unwatch') {
          const removed = await store.unwatch(resolved)
          return { ok: true, action: 'unwatch', sessionId: resolved, wasWatching: removed }
        }
        await store.watch(resolved, normalizeText(args?.note, MAX_HINT_LENGTH))
        return { ok: true, action: 'watch', sessionId: resolved, note: 'Layout changes will be injected into this Session.' }
      }

      if (action === 'notify') {
        const target = args?.sessionId
        if (target === undefined || target === null) return { ok: false, error: 'sessionId is required for notify' }
        const resolved = store.resolveSession(target)
        if (resolved === null) {
          return { ok: false, error: 'unknown Session "' + String(target) + '"; open its settings page once so the bar learns its title, or pass its exact session id' }
        }
        if (resolved !== null && typeof resolved === 'object') {
          return { ok: false, error: 'sessionId matches several Sessions; pass the exact id', candidates: resolved.ambiguous }
        }
        const text = normalizeText(args?.text, MAX_TEXT_LENGTH)
        if (text === '') return { ok: false, error: 'text is required for notify' }
        const message = await store.appendMessage({
          from: caller === null ? 'user' : caller,
          to: resolved,
          text,
          kind: 'message',
        })
        if (message === null) return { ok: false, error: 'could not store the message' }
        const delivered = deliver(message, args?.wake !== false)
        return {
          ok: true,
          action: 'notify',
          messageId: message.id,
          to: resolved,
          delivered,
          note: delivered ? 'The message entered that Session inbox.' : 'Queued: that Session is not loaded, so the message is delivered when it starts.',
        }
      }

      if (action === 'messages') {
        const doc = store.snapshot()
        const limit = Math.min(Math.max(Number.isFinite(Number(args?.limit)) ? Math.trunc(Number(args.limit)) : DEFAULT_MESSAGE_LIMIT, 1), 50)
        let rows = doc.messages
        if (typeof args?.with === 'string' && args.with.trim() !== '') {
          const resolved = store.resolveSession(args.with)
          if (resolved !== null && typeof resolved === 'object') {
            return { ok: false, error: 'with matches several Sessions', candidates: resolved.ambiguous }
          }
          const withId = resolved
          rows = rows.filter((message) => (withId === null ? false : message.from === withId || message.to === withId))
        }
        return {
          ok: true,
          action: 'messages',
          count: rows.length,
          messages: rows.slice(-limit).map((message) => ({
            id: message.id,
            at: message.at,
            from: message.from,
            to: message.to,
            kind: message.kind,
            delivered: message.deliveredAt !== 0,
            text: message.text,
          })),
        }
      }

      if (action === 'sessions') {
        const doc = store.snapshot()
        const limit = Math.min(Math.max(Number.isFinite(Number(args?.limit)) ? Math.trunc(Number(args.limit)) : 50, 1), 200)
        const rows = Object.entries(doc.knownSessions)
          .map(([id, value]) => ({
            sessionId: id,
            title: value.title,
            cwd: value.cwd,
            archived: value.archived,
            running: value.running,
            loaded: agents.has(id),
            watching: doc.subscriptions[id] !== undefined,
            layoutScope: doc.sessions[id] !== undefined ? 'session' : 'global',
            updatedAt: value.updatedAt,
          }))
          .sort((left, right) => Number(right.running) - Number(left.running) || right.updatedAt - left.updatedAt)
          .slice(0, limit)
        const result = { ok: true, action: 'sessions', count: rows.length, sessions: rows }
        if (rows.length === 0) result.note = 'Open 快捷栏 once so the browser half reports session titles.'
        return result
      }

      if (action === 'plugins') {
        const doc = store.snapshot()
        const rows = typeof scanPlugins === 'function' ? scanPlugins() : []
        const owners = new Map()
        for (const entry of Object.values(doc.actions)) {
          if (typeof entry.owner !== 'string' || entry.owner === '') continue
          if (!owners.has(entry.owner)) owners.set(entry.owner, [])
          owners.get(entry.owner).push(entry.id)
        }
        const builtinOwners = { 'dsh-session-stars': ['star'], 'dsh-session-todos': ['todo'] }
        const plugins = rows
          .filter((row) => row.client === true)
          .map((row) => ({
            name: row.name,
            version: row.version,
            description: row.description,
            client: row.client === true,
            registered: owners.get(row.name) ?? [],
            builtin: builtinOwners[row.name] ?? [],
          }))
        return {
          ok: true,
          action: 'plugins',
          count: plugins.length,
          plugins,
          note: 'A plugin with a browser half can register a button through window.dshSessionQuickbar.register; the same call is reported to this registry. Pass owner when calling action=register so the settings page can name the source. Built-in entries are already drawn by the bar.',
        }
      }

      return { ok: false, error: 'unknown action "' + String(action) + '"' }
    },
  }
}

/**
 * Register the durable layout file, its browser routes, the agent tool, and the
 * Session channel.
 * @param ctx - Host context carrying the tool registry.
 */
export function apply(ctx) {
  const homePath = ctx.get('dshHomePath')
  const file = typeof homePath === 'function'
    ? homePath('session-quickbar.json')
    : join(homedir(), '.dsh', 'session-quickbar.json')
  const log = createLogger()
  const store = createStore(file, log)
  const events = createEventHub(store, log)
  const scanPlugins = createPluginScanner(log)
  const agents = new Map()

  /** Deliver one queued message to a live agent; false when it is not loaded. */
  function deliverTo(agent, message, wake) {
    const prefix = '[会话快捷栏] '
    const reply = message.from === 'user' ? '' : '\n\n（回复请调用 session_quickbar action=notify，sessionId=' + message.from + '）'
    const text = message.kind === 'change'
      ? prefix + message.text
      : prefix + '来自 ' + message.from + ' 的消息：\n' + message.text + reply
    try {
      const payload = injectedMessage(text)
      if (wake === true && typeof agent.followup === 'function') agent.followup(payload)
      else if (typeof agent.inject === 'function') agent.inject(payload)
      else return false
    } catch (error) {
      log('could not deliver a message to ' + message.to, error)
      return false
    }
    void store.markDelivered(message.id)
    return true
  }

  function deliver(message, wake) {
    const agent = agents.get(message.to)
    if (agent === undefined) return false
    return deliverTo(agent, message, wake)
  }

  /** Inject one change notice into every watching Session and every affected owner. */
  function notifyChange(change) {
    const doc = change.doc
    const actor = change.by ?? 'user'
    const targets = new Map()
    const shortId = (id) => (typeof id === 'string' && id.length > 12 ? id.slice(0, 8) + '…' : String(id))
    const scopeText = change.kind === 'layout'
      ? (change.scope === 'session' ? '会话 ' + shortId(change.sessionId) + ' 的快捷栏' : '全局快捷栏')
      : change.kind === 'action'
        ? '快捷栏按钮列表'
        : ''
    const headline = change.kind === 'layout'
      ? scopeText + (change.reset === true ? '已恢复默认。' : '已更新。')
      : change.kind === 'action'
        ? (change.removed === true ? '按钮 ' + change.actionId + ' 已从注册表移除。' : '新按钮 ' + change.actionId + ' 已登记。')
        : '快捷栏已更新。'
    for (const sessionId of Object.keys(doc.subscriptions)) {
      if (actor === 'agent:' + sessionId) continue
      const layout = effectiveLayout(doc, sessionId)
      targets.set(sessionId, headline + ' 你当前的快捷栏：' + describeLayout(doc, layout.items)
        + '。查看请用 session_quickbar action=get，登记/回复用 action=notify。')
    }
    if (change.kind === 'layout' && Array.isArray(change.changed)) {
      const scopeName = change.scope === 'session' ? '会话 ' + shortId(change.sessionId) + ' 的' : '全局'
      for (const id of change.changed) {
        const owner = doc.actions[id]?.ownerSession
        if (typeof owner !== 'string' || owner === '' || actor === 'agent:' + owner) continue
        const layout = effectiveLayout(doc, change.sessionId ?? null)
        const position = layout.items.findIndex((item) => item.id === id)
        const visible = position !== -1 && layout.items[position].visible
        const where = scopeName + '快捷栏'
        const state = position === -1 ? '已移除' : visible ? '在第 ' + String(position + 1) + ' 位显示' : '被隐藏'
        targets.set(owner, '你登记的按钮 ' + id + ' 在' + where + '中' + state + '。')
      }
    }
    for (const [sessionId, note] of targets) {
      if (note === undefined) continue
      void store.appendMessage({
        from: actor,
        to: sessionId,
        text: note,
        kind: 'change',
      }).then((message) => {
        if (message !== null) deliver(message, false)
      })
    }
  }

  ctx.effect(() => () => events.close(), 'session-quickbar: event stream')

  // Layout changes feed the channel for every surface, with or without a browser.
  ctx.effect(() => store.subscribe((_doc, change) => {
    if (change === undefined) return
    notifyChange({ ...change, doc: store.snapshot() })
  }), 'session-quickbar: change notices')

  ctx.effect(() => ctx.tools.register(createTool({ store, log, deliver, agents, scanPlugins })), 'session-quickbar: agent tool')

  // Remember every live agent so a channel message can reach it, and flush the
  // messages that were queued while it was not loaded.
  ctx.effect(() => ctx.on('agent/created', ({ agent }) => {
    if (agent === null || typeof agent !== 'object' || typeof agent.id !== 'string') return
    agents.set(agent.id, agent)
    void store.load().then(() => {
      const pending = store.inboxOf(agent.id, 20).filter((message) => message.deliveredAt === 0)
      // Only the last explicit message wakes the fresh Session: it then sees every
      // earlier message as injected context, and layout notices never wake anyone.
      const waker = [...pending].reverse().find((message) => message.kind !== 'change')
      for (const message of pending) deliverTo(agent, message, message === waker)
    }, (error) => log('could not load queued messages', error))
  }), 'session-quickbar: agent channel')

  ctx.effect(() => ctx.on('agent/disposed', ({ agent }) => {
    if (agent !== null && typeof agent === 'object' && typeof agent.id === 'string') agents.delete(agent.id)
  }), 'session-quickbar: agent channel cleanup')

  // The browser and desktop compositions mount a web server; other surfaces
  // still get the file-backed tool and channel without an HTTP route.
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const onMutation = async (mutation) => {
        if (mutation.action === 'set') {
          await store.setLayout({
            scope: mutation.scope,
            sessionId: mutation.sessionId,
            items: mutation.items,
            takeover: mutation.takeover,
            by: 'user',
          })
          return
        }
        if (mutation.action === 'reset') {
          await store.resetLayout({ scope: mutation.scope, sessionId: mutation.sessionId, by: 'user' })
          return
        }
        if (mutation.action === 'register-action') {
          const result = await store.registerAction(mutation.record, 'user')
          if (!result.ok) log('could not register ' + mutation.record.id + ': ' + result.error)
          return
        }
        if (mutation.action === 'unregister-action') {
          await store.unregisterAction(mutation.id, 'user')
          return
        }
        if (mutation.action === 'panels') {
          await store.setPanels(mutation.hidden, 'user')
          return
        }
        if (mutation.action === 'catalog') {
          await store.noteSessions(mutation.rows)
        }
      }
      const removeConfig = scope.webServer.register({ kind: 'exact', path: ROUTE, handler: createRouteHandler(store, log, onMutation) })
      const removeEvents = scope.webServer.register({ kind: 'exact', path: EVENTS_ROUTE, handler: events.attach })
      const removePlugins = scope.webServer.register({ kind: 'exact', path: PLUGINS_ROUTE, handler: createPluginsRoute(scanPlugins, log) })
      return () => {
        removePlugins()
        removeEvents()
        removeConfig()
      }
    }, 'session-quickbar: browser routes')
  })
}
