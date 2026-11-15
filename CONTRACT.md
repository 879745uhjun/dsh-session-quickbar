# 快捷栏登记契约（给插件制作会话）

这份文档面向“正在制作或维护某个 DSH 插件”的会话。装好 `dsh-session-quickbar` 之后，会话行右侧那一排（`sidebar.workspaces.session.row.action`）由快捷栏统一渲染；你的插件不再自己往这个槽位注册按钮，而是向快捷栏登记一个动作。登记分两半，缺一不可：

| 半边 | 在哪 | 作用 |
| --- | --- | --- |
| 宿主注册（元数据 + 归属 + 订阅） | `session_quickbar` 工具，`action=register` | 让其他会话、设置页、通道知道这个按钮存在、属于哪个会话 |
| 浏览器注册（渲染 + 点击） | `window.dshSessionQuickbar.register(...)` | 快捷栏据此画出按钮并执行点击 |

只做宿主注册，设置页能看到这个 id，但行里不会出现按钮；只做浏览器注册，按钮立刻出现，但宿主注册表里没有归属，通道不会通知你。

---

## 一、浏览器半边：`window.dshSessionQuickbar`

快捷栏客户端模块加载后，页面上会出现：

```js
window.dshSessionQuickbar = {
  version: 1,
  register(descriptor) {
    // 返回 dispose 函数；重复 id 会替换旧登记
  },
  unregister(id) {},
  list() {},   // [{ id, labels, order }]
}
```

### descriptor 字段

```js
{
  id: 'ru-word-card',        // 必填，唯一，/^[A-Za-z0-9][A-Za-z0-9._-]*$/
  labels: { zh: '词卡', en: 'Word card' },   // 必填至少一种，≤40 字
  hint: { zh: '打开俄语词卡', en: 'Open the word card' },  // 可选，≤160 字
  owner: 'dsh-session-stars', // 可选，所属包名；设置页据此显示“已登记”
  order: 120,                // 可选，默认 500；内置按钮是 10/20/30/40/50
  icon: 'M3 8h10',           // 可选，16×16 viewBox 的 SVG path d；无 Component 时用它画
  isActive: (sessionId) => false,     // 可选，返回 true 时按钮高亮
  onActivate: (sessionId) => {},      // 与 Component 二选一
  Component: ({ sessionId, ctx, active }) => null,  // 可选，自己画整个按钮
  subscribe: (listener) => () => {},  // 可选，isActive 变化时调用 listener 让快捷栏重画
}
```

保留 id：`star`、`todo`、`archive`、`pin`、`copy-id`。用这些 id 登记会被拒绝（宿主内置按钮已经占用）。

`owner` 会随登记一起上报到宿主注册表；设置页的「可加入快捷栏的插件」据此把按钮归到包名下，显示“已登记”。不传也能用，只是归属那一栏显示不出来。

### 生命周期

```js
// 在客户端插件 apply 里登记
let dispose = null
ctx.effect(() => {
  dispose = window.dshSessionQuickbar?.register({ ... })
  return () => { if (typeof dispose === 'function') dispose() }
}, 'my-plugin: quickbar button')
```

`window.dshSessionQuickbar` 可能比你的客户端模块晚加载。可以轮询一次 `setTimeout(…, 200)`，或在 `apply` 里最多重试 20 次；快捷栏会在你登记后自动出现按钮。**不要**直接往 `sidebar.workspaces.session.row.action` 再注册一遍，否则接管模式下会被隐藏、设置页还会出现两份来源。

### 自己读数据

快捷栏只负责画按钮和转发点击，不代理你的业务数据。你的按钮需要状态时，沿用你原来的同源路由，并在 `subscribe` 里通知变化：

```js
const state = { cards: {}, listeners: new Set() }
function emit() { for (const fn of state.listeners) fn() }
const dispose = window.dshSessionQuickbar.register({
  id: 'ru-word-card',
  labels: { zh: '词卡', en: 'Word card' },
  order: 120,
  isActive: (sessionId) => state.cards[sessionId]?.open === true,
  onActivate: async (sessionId) => { /* POST 到你的路由 */ },
  subscribe: (listener) => { state.listeners.add(listener); return () => state.listeners.delete(listener) },
})
```

---

## 二、宿主半边：`session_quickbar` 工具

工具在**你自己的制作会话**里调用；调用会话就是按钮的归属会话（owner）。

### 登记按钮并自动订阅

```json
{
  "action": "register",
  "id": "ru-word-card",
  "zh": "词卡",
  "en": "Word card",
  "hint": "打开俄语词卡",
  "position": 120,
  "owner": "dsh-ru-word-card"
}
```

返回里的 `ownerSession` 就是本会话；`watched: true` 表示之后布局变更会注入到本会话。宿主注册表会立刻出现这个按钮，设置页也能看到它。

### 读取当前布局

```json
{ "action": "get" }
```

返回：`scope`（`default` / `global` / `session`）、`takeover`、`items`（含 `visible`、`position`、`labels`、`source`、`ownerSession`）、`unplaced`（已登记但不在当前布局里的按钮）、`subscriptions`、`recentChanges`、`recentMessages`。

### 调整布局

```json
{ "action": "set", "scope": "global", "order": ["star", "ru-word-card", "todo", "archive"], "hidden": ["todo"] }
```

- `scope: "session"` 时必须给 `sessionId`（可以是会话 id、精确标题或唯一标题片段）。
- `order` 是完整的排列；不在 `order` 也不在 `hidden` 里的 id 会从布局中移除。
- `hidden` 里的 id 保留位置但隐藏。

### 订阅 / 退订

```json
{ "action": "watch", "note": "ru-word-card 插件维护" }
{ "action": "unwatch" }
```

订阅后，**任何**布局变更都会以一条消息注入本会话（下一条被接纳的步骤里可见）。你登记的按钮被移动、隐藏、删除时，也会单独通知你。

### 给别的会话发消息

```json
{ "action": "notify", "sessionId": "会话待办勾选插件与待办页", "text": "我把你的待办方格收进了快捷栏，位置 2；请移除你原来的 trailing 注册。" }
```

- `sessionId` 支持精确 id、精确标题、唯一标题片段。
- 默认 `wake: true`：目标会话空闲时直接开新一轮，消息在对话里可见并会被处理；`wake: false` 只把它作为下一步的上下文。
- 目标会话没加载时消息排队，返回 `delivered: false`；它下次启动时按顺序注入，并用最后一条显式消息唤醒一次（布局变更通知只注入、不唤醒）。
- 排队情况在「快捷栏」设置页的「会话通道 → 待投递」里可见；该会话的行上也会出现一个琥珀色计数。
- 对方回复同样用 `notify`，`sessionId` 填你的会话 id（消息里会显示来源）。

### 查看通道历史

```json
{ "action": "messages", "limit": 20, "with": "会话待办勾选插件与待办页" }
{ "action": "sessions", "limit": 50 }
```

`sessions` 列出的标题来自浏览器端在“快捷栏”设置页打开时上报的会话目录；没打开过页面就只有 id。

### 看看哪些插件能接入

```json
{ "action": "plugins" }
```

返回 profile 里已安装、带浏览器半边（`dsh.client`）的插件：`name`、`version`、`description`、`client`、`registered`（通过 `owner` 关联到的按钮 id）、`builtin`（快捷栏已内置的适配，例如 `dsh-session-stars` 的 `star`）。设置页里对应「可加入快捷栏的插件」卡片：已内置 / 已登记 / 可接入 / 未启用。

---

## 三、迁移清单：已有行按钮的插件

适用于目前自己注册 `sidebar.workspaces.session.row.action`（可能还有 `sidebar.session.row.trailing`）的插件，例如会话星标、会话待办、词卡类插件。

1. **删掉动作槽注册。** 在 `client.js` 里删除或注释掉 `ctx.slots.inject('sidebar.workspaces.session.row.action', ...)` 这一段；`sidebar.workspaces.session.menu.item` 的菜单项可以保留（快捷栏没有接管菜单）。
2. **保留数据路由。** 你的 `/…` 路由、SSE、`session_*` 工具都不动；快捷栏内置的星标/待办就是直接读写这两条路由的。
3. **加一个浏览器登记。** 在 `apply` 里按上面的示例注册一个 id（建议 `<包名去前缀>`，如 `session-stars` → `star-levels`；不要用保留 id）。`onActivate` 里调用你原来的写入逻辑。
4. **加一个宿主登记。** 在你的制作会话里调用 `session_quickbar`，`action=register`，`id` 与浏览器登记一致，`zh`/`en` 填按钮名，`position` 取 60 以上（避开内置 10–50）。
5. **保留还是删除 trailing 方块？** `sidebar.session.row.trailing` 是静止状态那一格，快捷栏没有接管它。如果你希望静止时也不出现，一并删掉；否则保留，悬停时由快捷栏统一渲染。
6. **验证。**
   - 打开“快捷栏”设置页：你的按钮应出现在列表里，来源显示“插件”，可显示/隐藏/上移/下移。
   - 会话行悬停：按钮出现，点击执行原动作，`isActive` 状态会随数据变化。
   - 在会话里调用 `session_quickbar` `action=get`，`unplaced` 里能看到你的 id，`ownerSession` 是你。
   - 把按钮隐藏再显示，你的会话应收到两条变更通知（证明通道是通的）。

## 四、约束与边界

- 快捷栏接管的是**同一槽位**：它在渲染时隐藏该槽位里其他条目（含宿主归档/置顶）。所以迁移完成前，你的旧按钮会被隐藏，不会出现两份；如果你希望过渡期两份都显示，让用户在设置页关闭“接管这一排动作”。
- 快捷栏不能调用你的 React 组件渲染逻辑，除非你登记 `Component`；登记的组件会在快捷栏的树里渲染，需要自己处理样式（建议只用 `--dsw-alias-*` 主题变量）。
- 浏览器登记只对当前窗口有效；宿主登记持久化在 `$DSH_HOME/session-quickbar.json`，重启后仍在。
- 同一 id 重复登记会替换旧登记；插件卸载时务必 dispose，否则按钮会留在列表里但点击无效。
