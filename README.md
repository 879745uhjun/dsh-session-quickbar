# dsh-session-quickbar

English | [中文](README.zh.md)

One configurable quick-action strip on the right of every Session row in the DeepSeek Harness sidebar — plus a two-way channel between that strip and the Sessions that author plugins.

## What it does

- **One owner for that seat.** The strip registers itself in `sidebar.workspaces.session.row.action` and, in takeover mode (the default), hides the other entries in the same seat while it is present. What you configure is what the row shows, instead of whatever order the installed plugins happened to register in.
- **Built-in buttons that reuse existing data.** Star reads and writes the `session-stars` route; the todo square reads and writes the `session-todos` route; pin and archive go through the public `uiWorkspace` service (a Session that is still working gets the same stop-and-archive confirmation). Copy ID is available but hidden by default.
- **Per-session layouts.** A global default, plus an override per Session. Hidden buttons keep their place and can be switched back on; order is up/down in the settings page.
- **Customizable sidebar entries.** The settings page lists the sidebar panel entries; unchecking one moves it out of the left rail and into the host's **More** menu, where it stays one click away. The choice persists in `session-quickbar.json`.
- **A plugin survey.** The settings page lists the installed profile bundles that have a browser half and marks each one **Built in**, **Registered**, **Available**, or **Not loaded**, so it is obvious which plugins still need to adopt the bar. `session_quickbar action=plugins` returns the same survey to agents.
- **A real settings page.** Sidebar panel list entry **快捷栏 / Quick bar**, or right-click-free row menu entry **快捷栏设置…** on any Session row. The page edits the global layout or one Session's layout, shows where each button comes from, and lists the channel's subscribed Sessions and recent messages.
- **Live everywhere.** Layout changes are pushed over Server-Sent Events, so every open window re-renders without a reload.
- **A channel for plugin-authoring Sessions.** `session_quickbar` (Host tool) lets any Session read or change a layout, register the button it is building, subscribe to changes, and message another Session. Every layout change is injected into subscribed Sessions as one short message, and registered owners hear where their button landed. Those Sessions answer with `notify`, so the bar and the Sessions that maintain it can talk both ways.

## Where it lives

```
sidebar row (hovered)
┌──────────────────────────────────────────────────────────────┐
│ ● 会话标题                                 …   ★  ☑  ▣  📌  │
└──────────────────────────────────────────────────────────────┘
   Quick bar, order from the settings page
```

Settings page: left panel list → **快捷栏**, or the Session row menu → **快捷栏设置…**.

## Configuration

Open the settings page:

- **全局默认 / Global default** — the layout every Session inherits, plus the takeover switch.
- **单个会话 / One session** — pick a Session, then toggle and reorder just that row. **改用全局布局** drops the override.
- **恢复默认 / Restore defaults** — clears the explicit layout so the built-in default applies again: the todo square and the finish alert, two buttons.

The layout file is `session-quickbar.json` under `$DSH_HOME`. Deleting it restores the defaults. Turn the plugin off and the strip disappears; the star and todo plugins keep their own buttons.

## What the takeover changes

While the strip is present and takeover is on, the CSS rule hides the other entries in the same slot — including the host's archive and pin buttons, which the bar re-draws itself. If the bar ever fails to render (or the plugin is disabled), the rule is inert and the original entries return. Set takeover off in the settings page to keep both sets (useful while a plugin has not migrated yet).

## Action registration (for other plugins)

Any client plugin can contribute a button without touching this package:

```js
const dispose = window.dshSessionQuickbar.register({
  id: 'my-button',
  owner: 'my-plugin',         // optional package name, shown as Registered on the survey
  labels: { zh: '我的按钮', en: 'My button' },
  hint: { zh: '一句话说明', en: 'One-line hint' },
  order: 120,
  icon: 'M3 8h10',            // 16×16 path data, optional when Component is set
  isActive: (sessionId) => false,
  onActivate: (sessionId) => { /* … */ },
  subscribe: (listener) => { /* call listener when isActive changes */ return () => {} },
})
```

Call `dispose()` when your plugin unloads. `star`, `todo`, `archive`, `pin`, and `copy-id` are reserved. A component instead of `onActivate` is also accepted (`Component: ({ sessionId }) => …`). The registration is reported to the Host registry so authoring Sessions and the `session_quickbar` tool can see it.

The full contract, including the Host tool and the migration steps for a plugin that already draws its own row button, is in [CONTRACT.md](CONTRACT.md).

## Limitations

- The strip only controls its own seat. Other rows, the row menu, and the conversation header are untouched.
- The bar cannot call another plugin's React code except through the registry; an unmigrated plugin's button is hidden by takeover rather than adopted.
- Channel targets resolve by exact Session id, exact title, or a unique title fragment. Titles are reported by the browser half when the settings page is open; without that, pass the exact id.
- Messages for a Session that is not loaded stay queued until it starts; they are then injected in order and wake it once, so the request is visible in its conversation. The settings page lists them under **Session channel → Waiting for delivery**, and a queued Session row carries an amber count; a `notify` also wakes a loaded idle Session by default (`wake: false` queues silently), while layout change notices never wake one.
- Touch layouts keep the host's rule that only the pin action stays visible; the strip follows that rule.

## Install from GitHub

```sh
dsh plugin --profile desktop add github:879745uhjun/dsh-session-quickbar
```

Reload the Web UI page after installing.
