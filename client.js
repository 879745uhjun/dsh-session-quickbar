/**
 * dsh-session-quickbar — browser half.
 *
 * Owns the quick-action strip on the right of every Session row
 * ('sidebar.workspaces.session.row.action') and the settings page that shapes
 * it. The strip renders the buttons the Host document says are visible, in
 * order, and hides the entries other plugins put in that same seat while the
 * bar is in takeover mode.
 *
 * Built-in buttons reuse the data their owning plugins already expose:
 * '/session-stars' and '/session-todos' are read and written over their
 * same-origin routes, so starring and checking a todo stays one source of
 * truth. Any other plugin contributes a button through
 * `window.dshSessionQuickbar.register({ id, labels, order, Component })`;
 * that call also reports the button to the Host registry so authoring
 * Sessions and the session_quickbar tool can see it.
 *
 * Visible copy comes from the Client locale service; styling uses only theme
 * tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-quickbar',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'session-quickbar'
    const PANEL_ID = 'session-quickbar'
    const ENDPOINT = '/session-quickbar'
    const EVENTS = '/session-quickbar/events'
    const STARS_ENDPOINT = '/session-stars'
    const STARS_EVENTS = '/session-stars/events'
    const TODOS_ENDPOINT = '/session-todos'
    const TODOS_EVENTS = '/session-todos/events'
    const NOTIFY_ENDPOINT = '/session-notify'
    const NOTIFY_EVENTS = '/session-notify/events'
    const TRANSFER_EXPORT = '/session-transfer/export'
    const TOKEN_ENDPOINT = '/token-usage'
    const BOXES_ENDPOINT = '/session-boxes'
    const API_VERSION = 1
    const MAX_ITEMS = 24
    const MAX_CATALOG_ROWS = 200
    const COPIED_MS = 1200
    const BUILTIN_IDS = ['star', 'todo', 'archive', 'pin', 'copy-id']

    /* ------------------------------------------------------------------ *
     * Dictionaries (English is the key-set source of truth)
     * ------------------------------------------------------------------ */

    const EN = {
      'panel': 'Quick bar',
      'page.title': 'Session quick bar',
      'page.subtitle': 'The buttons on the right of every session row: which ones show, and in what order',
      'page.global': 'Global default',
      'page.session': 'One session',
      'page.pick': 'Choose a session',
      'page.search': 'Search sessions',
      'page.inherit': 'Inherited from the global default',
      'page.override': 'This session has its own layout',
      'page.reset': 'Restore defaults',
      'page.resetSession': 'Use the global layout',
      'page.takeover': 'Take over the action seat',
      'page.takeoverHint': 'The bar replaces the buttons other plugins and the host put in this seat',
      'page.actions': 'Buttons',
      'page.actionsHint': 'Hidden buttons keep their place and can be switched back on',
      'page.source.builtin': 'Built in',
      'page.source.client': 'Plugin',
      'page.source.tool': 'Registered',
      'page.owner': 'From session {id}',
      'page.moveUp': 'Move up',
      'page.moveDown': 'Move down',
      'page.show': 'Show this button',
      'page.hide': 'Hide this button',
      'page.empty': 'No button is available for this session yet',
      'page.live': 'Live updates on',
      'page.saved': 'Saved',
      'page.saving': 'Saving…',
      'page.error': 'Could not save the layout',
      'page.loadError': 'The layout is unavailable — the host route did not answer',
      'page.channel': 'Session channel',
      'page.channelHint': 'Registered authoring sessions hear about layout changes; they answer with the session_quickbar tool',
      'page.subscriptions': 'Subscribed sessions',
      'page.noSubscriptions': 'No session subscribed yet',
      'page.messages': 'Recent messages',
      'page.noMessages': 'No message yet',
      'page.pending': 'Waiting for delivery',
      'page.noPending': 'Nothing is queued',
      'page.pendingHint': 'Delivered when the target session starts',
      'page.pendingBadge': '{n} queued',
      'page.pendingMessages': 'Pending messages',
      'page.delivered': 'Delivered {time}',
      'page.queued': 'Queued',
      'page.plugins': 'Plugins that can join the bar',
      'page.pluginsHint': 'Any plugin with a browser half can register one button with the bar',
      'page.pluginsRefresh': 'Rescan',
      'page.pluginsEmpty': 'No plugin with a browser half was found',
      'page.pluginsError': 'Scan failed: the host did not answer',
      'page.pluginsRestart': 'The scan route arrives with the next app restart; reload the bar after restarting.',
      'page.pluginsCount': '{n} plugins',
      'page.pluginsNote': 'A candidate needs its authoring session to register a button through window.dshSessionQuickbar.register as CONTRACT.md describes; it then appears in the list above.',
      'page.pluginBuiltin': 'Built in',
      'page.pluginRegistered': 'Registered',
      'page.pluginCandidate': 'Available',
      'page.pluginInactive': 'Not loaded',
      'page.messagesCount': '{n} total',
      'page.unavailable': 'Its plugin is not installed',
      'page.count': '{n} buttons',
      'bar.star': 'Star',
      'bar.starOn': 'Remove star',
      'bar.todo': 'Mark this session todo done',
      'bar.todoDone': 'Done — click to reopen',
      'bar.todoDoing': 'In progress — click to mark done',
      'bar.archive': 'Archive session',
      'bar.unarchive': 'Unarchive session',
      'bar.pin': 'Pin session',
      'bar.unpin': 'Unpin session',
      'bar.copy': 'Copy session id',
      'bar.copied': 'Copied',
      'bar.notify': 'Alert me when this session finishes',
      'bar.notifyOn': 'Stop the finish alert',
      'bar.pack': 'Pack this session into a file',
      'bar.packBusy': 'Packing…',
      'bar.packDone': 'Pack downloaded',
      'bar.packFailed': 'Could not pack',
      'bar.packFailedReason': 'Could not pack: {reason}',
      'bar.token': '{n} tokens · {cost}',
      'bar.boxes': 'Group boxes',
      'bar.boxesOn': '{n} box(es) · {name}',
      'popover.token': 'Token usage',
      'popover.input': 'Input',
      'popover.output': 'Output',
      'popover.cacheRead': 'Cache read',
      'popover.cacheWrite': 'Cache write',
      'popover.cacheHit': 'Cache hit rate',
      'popover.noUsage': 'No usage recorded for this session yet',
      'popover.boxesTitle': 'Move into a box',
      'popover.noBoxes': 'No box yet — create one in the sidebar',
      'popover.clearBoxes': 'Remove from all boxes',
      'bar.settings': 'Quick bar settings',
      'bar.pending': '{n} messages are queued until this session starts',
      'menu.label': 'Quick bar…',
      'dialog.title': 'This session is still working',
      'dialog.body': 'Archiving stops the work listed below. Archive anyway?',
      'dialog.activity': '{n} activities in progress',
      'dialog.confirm': 'Stop and archive',
      'dialog.cancel': 'Cancel',
      'dialog.archiveTitle': 'Archive this session?',
    }

    const ZH = {
      'panel': '快捷栏',
      'page.title': '会话快捷栏',
      'page.subtitle': '每个会话行右侧那排按钮：显示哪些、按什么顺序',
      'page.global': '全局默认',
      'page.session': '单个会话',
      'page.pick': '选择一个会话',
      'page.search': '搜索会话',
      'page.inherit': '继承全局默认布局',
      'page.override': '这个会话有独立布局',
      'page.reset': '恢复默认',
      'page.resetSession': '改用全局布局',
      'page.takeover': '接管这一排动作',
      'page.takeoverHint': '打开后，快捷栏替换其他插件与宿主放在这一排的按钮',
      'page.actions': '按钮',
      'page.actionsHint': '隐藏的按钮会保留位置，随时可以重新打开',
      'page.source.builtin': '内置',
      'page.source.client': '插件',
      'page.source.tool': '会话登记',
      'page.owner': '来自会话 {id}',
      'page.moveUp': '上移',
      'page.moveDown': '下移',
      'page.show': '显示这个按钮',
      'page.hide': '隐藏这个按钮',
      'page.empty': '这个会话暂时没有可显示的按钮',
      'page.live': '实时同步已开启',
      'page.saved': '已保存',
      'page.saving': '保存中…',
      'page.error': '快捷栏保存失败',
      'page.loadError': '快捷栏暂时不可用：宿主路由没有响应',
      'page.channel': '会话通道',
      'page.channelHint': '登记过的插件制作会话会收到布局变更，并用 session_quickbar 工具回信',
      'page.subscriptions': '订阅变更的会话',
      'page.noSubscriptions': '还没有会话订阅',
      'page.messages': '最近消息',
      'page.noMessages': '还没有消息',
      'page.pending': '待投递',
      'page.noPending': '没有排队中的消息',
      'page.pendingHint': '目标会话启动后自动送达',
      'page.pendingBadge': '{n} 条',
      'page.pendingMessages': '排队的消息',
      'page.delivered': '已送达 {time}',
      'page.queued': '排队中',
      'page.plugins': '可加入快捷栏的插件',
      'page.pluginsHint': '有浏览器半边的插件都可以向快捷栏登记一个按钮',
      'page.pluginsRefresh': '重新扫描',
      'page.pluginsEmpty': '没有扫描到可接入的插件',
      'page.pluginsError': '扫描失败：宿主没有回答',
      'page.pluginsRestart': '扫描路由要等下次启动应用才生效，重启后再打开这一页。',
      'page.pluginsCount': '{n} 个插件',
      'page.pluginsNote': '「可接入」需要它的制作会话按 CONTRACT.md 用 window.dshSessionQuickbar.register 登记；登记后按钮会出现在上面的列表里。',
      'page.pluginBuiltin': '已内置',
      'page.pluginRegistered': '已登记',
      'page.pluginCandidate': '可接入',
      'page.pluginInactive': '未启用',
      'page.messagesCount': '共 {n} 条',
      'page.unavailable': '所属插件未安装',
      'page.count': '{n} 个按钮',
      'bar.star': '星标',
      'bar.starOn': '取消星标',
      'bar.todo': '标记这个会话的待办为已完成',
      'bar.todoDone': '已完成，点击取消',
      'bar.todoDoing': '正在做，点击标记完成',
      'bar.archive': '归档会话',
      'bar.unarchive': '取消归档',
      'bar.pin': '置顶会话',
      'bar.unpin': '取消置顶',
      'bar.copy': '复制会话 ID',
      'bar.copied': '已复制',
      'bar.notify': '这个会话结束时提醒我',
      'bar.notifyOn': '关闭完成提醒',
      'bar.pack': '把这个会话打包成文件',
      'bar.packBusy': '打包中…',
      'bar.packDone': '打包已下载',
      'bar.packFailed': '打包失败',
      'bar.packFailedReason': '打包失败：{reason}',
      'bar.token': '{n} tokens · {cost}',
      'bar.boxes': '分组盒子',
      'bar.boxesOn': '{n} 个盒子 · {name}',
      'popover.token': 'Token 用量',
      'popover.input': '输入',
      'popover.output': '输出',
      'popover.cacheRead': '缓存读',
      'popover.cacheWrite': '缓存写',
      'popover.cacheHit': '缓存命中率',
      'popover.noUsage': '这个会话还没有用量记录',
      'popover.boxesTitle': '移入分组盒子',
      'popover.noBoxes': '还没有盒子，先在侧边栏创建一个',
      'popover.clearBoxes': '移出全部盒子',
      'bar.settings': '快捷栏设置',
      'bar.pending': '有 {n} 条消息排队，等这个会话启动后送达',
      'menu.label': '快捷栏设置…',
      'dialog.title': '这个会话还在运行',
      'dialog.body': '归档会停止正在进行的工作。要继续吗？',
      'dialog.activity': '{n} 项活动正在进行',
      'dialog.confirm': '停止并归档',
      'dialog.cancel': '取消',
      'dialog.archiveTitle': '归档这个会话？',
    }

    const LOCALES = { zh: ZH, en: EN, ja: EN, es: EN, fr: EN, de: EN, ru: EN, pt: EN }

    /* ------------------------------------------------------------------ *
     * Styles — theme tokens only
     * ------------------------------------------------------------------ */

    const CSS = [
      '.sq-bar{display:inline-flex;align-items:center;gap:4px;flex:none}',
      '.sq-token{width:auto;min-width:22px;padding:0 5px;font-size:10px;font-variant-numeric:tabular-nums}',
      '.sq-boxbtn{gap:2px}',
      '.sq-boxdot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block;background:var(--dsw-alias-label-tertiary)}',
      '.sq-boxdot[data-color=blue]{background:var(--dsw-alias-state-business-primary)}',
      '.sq-boxdot[data-color=green]{background:var(--dsw-alias-state-success-primary)}',
      '.sq-boxdot[data-color=amber]{background:var(--dsw-alias-state-warn-primary)}',
      '.sq-boxdot[data-color=red]{background:var(--dsw-alias-state-error-primary)}',
      '.sq-boxdot[data-color=purple]{background:#a78bfa}',
      '.sq-boxdot[data-color=pink]{background:#f472b6}',
      '.sq-boxdot[data-color=cyan]{background:#22d3ee}',
      '.sq-boxdot[data-color=gray]{background:var(--dsw-alias-label-tertiary)}',
      '.sq-boxcount{font-size:9px;line-height:1;font-variant-numeric:tabular-nums}',
      '.sq-popover{position:fixed;z-index:62;box-sizing:border-box;padding:12px 14px;border-radius:12px;',
      'background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);',
      'box-shadow:0 14px 40px color-mix(in srgb,#000 30%,transparent);display:flex;flex-direction:column;gap:10px}',
      '.sq-popover-body{display:flex;flex-direction:column;gap:10px}',
      '.sq-popover-head{font-size:12px;line-height:17px;font-weight:600;overflow:hidden;',
      'text-overflow:ellipsis;white-space:nowrap}',
      '.sq-token-total{display:flex;align-items:baseline;justify-content:space-between;gap:8px;',
      'font-size:18px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.sq-token-cost{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary)}',
      '.sq-kv{display:grid;grid-template-columns:1fr auto;gap:4px 12px;margin:0;font-size:11px;line-height:16px}',
      '.sq-kv dt{color:var(--dsw-alias-label-tertiary)}',
      '.sq-kv dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}',
      '.sq-days{display:flex;flex-direction:column;gap:2px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:8px}',
      '.sq-day{display:flex;justify-content:space-between;font-size:10px;line-height:15px;',
      'color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.sq-boxlist{display:flex;flex-direction:column;gap:2px;max-height:240px;overflow:auto}',
      '.sq-boxrow{appearance:none;display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;',
      'border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);',
      'font:inherit;font-size:12px;line-height:18px;padding:5px 7px;text-align:left;cursor:pointer}',
      '.sq-boxrow:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.sq-boxrow[data-on=true]{background:var(--dsw-alias-bg-layer-2)}',
      '.sq-boxrow[data-depth="1"]{padding-left:20px}',
      '.sq-boxrow svg{width:12px;height:12px;margin-left:auto;color:var(--dsw-alias-state-success-primary)}',
      '.sq-boxname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sq-boxclear{align-self:flex-start}',
      '.sq-pending{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;',
      'padding:0 3px;border-radius:999px;font-size:9px;line-height:15px;font-weight:600;',
      'color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent)}',
      '.sq-btn{appearance:none;box-sizing:border-box;width:22px;height:22px;padding:0;margin:0;flex:none;',
      'border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;',
      'color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;',
      'cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.sq-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.sq-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.sq-btn[data-active=true]{color:var(--dsw-alias-state-business-primary)}',
      '.sq-btn[data-tone=warn][data-active=true]{color:var(--dsw-alias-state-warn-primary)}',
      '.sq-btn[data-busy=true]{opacity:.5;cursor:default}',
      '.sq-btn svg{width:14px;height:14px;display:block}',
      '.sq-square{box-sizing:border-box;width:15px;height:15px;border-radius:4px;display:inline-flex;',
      'align-items:center;justify-content:center;border:1.4px solid var(--dsw-alias-border-l2);',
      'color:transparent;transition:background .12s ease,border-color .12s ease,color .12s ease}',
      '.sq-square[data-state=doing]{border-color:var(--dsw-alias-state-business-primary);',
      'box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent)}',
      '.sq-square[data-state=done]{border-color:transparent;background:var(--dsw-alias-state-success-primary);color:#fff}',
      '.sq-square svg{width:10px;height:10px;display:block}',
      '.sq-page{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;',
      'color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}',
      '.sq-head{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;',
      'padding:20px 24px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.sq-title{margin:0;font-size:16px;line-height:22px;font-weight:600}',
      '.sq-sub{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.sq-mode{display:inline-flex;padding:2px;gap:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}',
      '.sq-mode button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);',
      'font:inherit;font-size:12px;line-height:18px;padding:4px 10px;border-radius:6px;cursor:pointer}',
      '.sq-mode button[data-on=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);',
      'box-shadow:0 0 0 .5px var(--dsw-alias-border-l2)}',
      '.sq-scroll{flex:1;min-height:0;overflow:auto;padding:16px 24px 32px;display:flex;flex-direction:column;gap:14px}',
      '.sq-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);',
      'padding:14px 16px;display:flex;flex-direction:column;gap:12px}',
      '.sq-cardhead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.sq-cardtitle{margin:0;font-size:13px;line-height:20px;font-weight:600}',
      '.sq-note{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.sq-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.sq-search{appearance:none;box-sizing:border-box;width:240px;max-width:100%;height:28px;padding:0 10px;',
      'border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
      '.sq-search::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.sq-search:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.sq-btn-ghost{appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;',
      'color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;',
      'padding:4px 10px;border-radius:7px;cursor:pointer}',
      '.sq-btn-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.sq-btn-ghost:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.sq-picker{display:flex;flex-direction:column;gap:4px;max-height:240px;overflow:auto;',
      'border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:6px}',
      '.sq-pick{appearance:none;display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;',
      'border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);',
      'font:inherit;font-size:12px;line-height:18px;padding:6px 8px;text-align:left;cursor:pointer}',
      '.sq-pick:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.sq-pick[data-on=true]{background:var(--dsw-alias-bg-layer-2)}',
      '.sq-pick-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sq-pick-meta{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.sq-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}',
      '.sq-rows{display:flex;flex-direction:column;gap:2px}',
      '.sq-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px}',
      '.sq-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.sq-row[data-hidden=true] .sq-row-label{color:var(--dsw-alias-label-tertiary)}',
      '.sq-check{appearance:none;box-sizing:border-box;width:15px;height:15px;padding:0;margin:0;flex:none;',
      'border-radius:4px;border:1.4px solid var(--dsw-alias-border-l2);background:transparent;cursor:pointer;',
      'display:inline-flex;align-items:center;justify-content:center;color:transparent}',
      '.sq-check[aria-checked=true]{border-color:transparent;background:var(--dsw-alias-state-success-primary);color:#fff}',
      '.sq-check:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
      '.sq-check svg{width:10px;height:10px;display:block}',
      '.sq-row-icon{flex:none;width:18px;display:inline-flex;align-items:center;justify-content:center;',
      'color:var(--dsw-alias-label-secondary)}',
      '.sq-row-icon svg{width:14px;height:14px;display:block}',
      '.sq-row-label{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.sq-row-name{font-size:13px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sq-row-hint{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sq-tag{flex:none;font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;',
      'color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}',
      '.sq-move{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);',
      'width:20px;height:20px;padding:0;border-radius:5px;display:inline-flex;align-items:center;',
      'justify-content:center;cursor:pointer;flex:none}',
      '.sq-move:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.sq-move:disabled{opacity:.3;cursor:default}',
      '.sq-move svg{width:12px;height:12px;display:block}',
      '.sq-switch{display:flex;align-items:center;gap:10px}',
      '.sq-switch input{appearance:none;box-sizing:border-box;width:30px;height:18px;border-radius:999px;',
      'border:0;background:var(--dsw-alias-bg-layer-3);position:relative;cursor:pointer;margin:0;flex:none;',
      'transition:background .12s ease}',
      '.sq-switch input::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;',
      'border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform .12s ease}',
      '.sq-switch input:checked{background:var(--dsw-alias-state-business-primary)}',
      '.sq-switch input:checked::after{transform:translateX(12px);background:#fff}',
      '.sq-switch input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
      '.sq-menu-item{appearance:none;display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;',
      'padding:6px 10px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;',
      'font-size:13px;line-height:18px;text-align:left;border-radius:var(--dsw-radius-sm,6px);cursor:pointer}',
      '.sq-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.sq-menu-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
      '.sq-menu-item .sq-row-label{display:block;flex:1;min-width:0}',
      '.sq-badge{flex:none;font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;',
      'color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}',
      '.sq-message-meta [data-state=queued]{color:var(--dsw-alias-state-warn-primary)}',
      '.sq-message-meta [data-state=delivered]{color:var(--dsw-alias-state-success-primary)}',
      '.sq-tag[data-state=builtin]{color:var(--dsw-alias-state-success-primary)}',
      '.sq-tag[data-state=registered]{color:var(--dsw-alias-state-business-primary)}',
      '.sq-tag[data-state=candidate]{color:var(--dsw-alias-label-secondary)}',
      '.sq-tag[data-state=inactive]{color:var(--dsw-alias-label-tertiary);opacity:.7}',
      '.sq-message{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:8px;',
      'background:var(--dsw-alias-bg-layer-2)}',
      '.sq-message-meta{display:flex;gap:8px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary)}',
      '.sq-message-text{font-size:12px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.sq-footer{display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap}',
      '.sq-state{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.sq-state[data-error=true]{color:var(--dsw-alias-state-error-primary)}',
      '.sq-backdrop{position:fixed;inset:0;z-index:60;background:color-mix(in srgb,#000 36%,transparent)}',
      '.sq-dialog{position:fixed;z-index:61;left:50%;top:50%;transform:translate(-50%,-50%);',
      'box-sizing:border-box;width:min(420px,calc(100vw - 40px));padding:18px 20px;border-radius:14px;',
      'background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);',
      'box-shadow:0 18px 50px color-mix(in srgb,#000 32%,transparent);display:flex;flex-direction:column;gap:10px}',
      '.sq-dialog h2{margin:0;font-size:15px;line-height:22px}',
      '.sq-dialog p{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.sq-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}',
      '.sq-primary{appearance:none;border:0;border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;',
      'line-height:18px;cursor:pointer;background:var(--dsw-alias-state-warn-primary);color:#fff}',
      '.sq-primary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
      '.sq-page,.sq-page *{box-sizing:border-box}',
      '.sq-scroll::-webkit-scrollbar{width:8px}',
      '.sq-scroll::-webkit-scrollbar-thumb{border-radius:4px;background:var(--dsw-alias-bg-layer-3)}',
      '@media (max-width:720px){.sq-head{padding:16px 16px 10px;flex-wrap:wrap}.sq-scroll{padding:12px 16px 28px}',
      '.sq-search{width:100%}.sq-page .sq-title{font-size:15px}}',
    ].join('\n')

    /**
     * The takeover rule. It matches only the row-action slot that actually
     * contains this bar, and only while the bar is not marked `data-sq-keep`
     * (takeover switched off). Missing the seam in a future host build leaves
     * the other entries visible instead of hiding the strip.
     */
    const SUPPRESS_CSS = [
      '[data-slot="sidebar.workspaces.session.row.action"]:has(> [data-dsh-quickbar]:not([data-sq-keep]))',
      '> :not([data-dsh-quickbar]){display:none!important}',
    ].join('')

    /* ------------------------------------------------------------------ *
     * Locale helpers
     * ------------------------------------------------------------------ */

    /** Subscribe to locale revisions so translated copy re-renders on switch. */
    function useLocaleRevision(locale) {
      const [revision, setRevision] = useState(0)
      useEffect(() => {
        if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => setRevision((value) => value + 1))
      }, [locale])
      return revision
    }

    /** The plugin translator, kept live across locale switches. */
    function useT(ctx) {
      const locale = ctx.locale ?? readService(ctx, 'locale')
      useLocaleRevision(locale)
      if (locale === undefined || typeof locale.bind !== 'function') {
        return (key) => key
      }
      return locale.bind(NS)
    }

    /* ------------------------------------------------------------------ *
     * Small helpers
     * ------------------------------------------------------------------ */

    /** Look a service up without letting a missing one break rendering. */
    function readService(ctx, name) {
      try {
        return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
      } catch {
        return undefined
      }
    }

    /** Create one tiny external store. */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set(next) {
          state = typeof next === 'function' ? next(state) : next
          for (const listener of listeners) listener()
        },
      }
    }

    /** Subscribe one component to an external store. */
    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    }

    /** Client bundle ids loaded in this page, or null when the kernel hides them. */
    function activeClientIds(ctx) {
      try {
        const loader = readService(ctx, 'loader')
        const modules = loader?.internal?.manifest?.modules
        if (!Array.isArray(modules)) return null
        const ids = new Set()
        for (const row of modules) {
          if (row !== null && typeof row === 'object' && typeof row.id === 'string') ids.add(row.id)
        }
        return ids
      } catch {
        return null
      }
    }

    /** The browser session catalog, when the host composition exposes it. */
    function sessionCatalog(ctx) {
      const sessions = readService(ctx, 'sessions')
      const list = sessions === undefined || sessions === null ? undefined : sessions.list
      if (list === undefined || list === null) return undefined
      if (typeof list.getSnapshot !== 'function') return undefined
      return list
    }

    /** Normalize one catalog snapshot into ids plus a byId map. */
    function catalogSnapshot(list) {
      let raw
      try {
        raw = list?.getSnapshot?.()
      } catch {
        raw = undefined
      }
      if (raw === null || typeof raw !== 'object') return { ids: [], byId: {} }
      const byId = raw.byId !== null && typeof raw.byId === 'object' ? raw.byId : {}
      const ids = Array.isArray(raw.ids) ? raw.ids : Object.keys(byId)
      return { ids, byId }
    }

    /** One session summary, or undefined. */
    function summaryOf(ctx, sessionId) {
      const list = sessionCatalog(ctx)
      if (list === undefined) return undefined
      return catalogSnapshot(list).byId[sessionId]
    }

    /** The session title from the catalog, or an empty string. */
    function titleOf(ctx, sessionId) {
      const summary = summaryOf(ctx, sessionId)
      if (summary === undefined || typeof summary.title !== 'string') return ''
      return summary.title.trim()
    }

    /** Trailing path segment of a working directory. */
    function baseName(path) {
      if (typeof path !== 'string' || path.length === 0) return ''
      const parts = path.split(/[\\/]+/).filter((part) => part.length > 0)
      return parts.length === 0 ? path : parts[parts.length - 1]
    }

    /** Bounded, readable session id. */
    function shortId(id) {
      return typeof id === 'string' && id.length > 12 ? id.slice(0, 8) + '…' : String(id)
    }

    /** Local time for a message row. */
    function timeText(timestamp) {
      if (!timestamp) return ''
      const date = new Date(timestamp)
      if (!Number.isFinite(date.getTime())) return ''
      const pad = (value) => String(value).padStart(2, '0')
      return pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    /** The label for one action in the current language. */
    function actionLabel(action, lang) {
      if (action === undefined || action === null) return ''
      const labels = action.labels ?? {}
      return labels[lang] ?? labels.zh ?? labels.en ?? action.id ?? ''
    }

    /** The hint for one action in the current language. */
    function actionHint(action, lang) {
      if (action === undefined || action === null) return ''
      const hints = action.hint ?? {}
      return hints[lang] ?? hints.zh ?? hints.en ?? ''
    }

    /** The current UI language: the locale service publishes it on <html lang>. */
    function languageOf() {
      const raw = document.documentElement?.lang || navigator.language || 'en'
      return String(raw).toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    /* ------------------------------------------------------------------ *
     * Icons (16×16, currentColor)
     * ------------------------------------------------------------------ */

    function IconStar({ filled }) {
      return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', {
          d: 'M8 1.9l1.85 3.9 4.15.55-3 3 .72 4.25L8 11.55 4.28 13.6 5 9.35l-3-3 4.15-.55z',
          fill: filled ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinejoin: 'round',
        }))
    }

    function IconCheck() {
      return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2.6 8.4l3.3 3.2 7.3-7.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))
    }

    function IconArchive({ unarchive }) {
      return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2.2 3h11.6v2.6H2.2z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M3.3 5.6h9.4v7.4H3.3z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinejoin: 'round',
        }),
        unarchive
          ? h('path', { d: 'M8 11.6V7.4m-1.9 1.8L8 7.3l1.9 1.9', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' })
          : h('path', { d: 'M8 7.4v4.2m-1.9-1.8L8 11.7l1.9-1.9', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function IconPin({ filled }) {
      return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', {
          d: 'M9.9 1.9l4.2 4.2-1.1 1.1-.6-.2-2.6 2.6.3 2.1-1.2 1.2-2.4-2.4L2 13.3l2.8-4.5-2.4-2.4 1.2-1.2 2.1.3 2.6-2.6-.2-.6z',
          fill: filled ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: 1.15,
          strokeLinejoin: 'round',
        }))
    }

    function IconCopy() {
      return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('rect', { x: 5.4, y: 5.4, width: 8.4, height: 8.4, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.25 }),
        h('path', { d: 'M10.6 5.2V3.6c0-.9-.7-1.6-1.6-1.6H3.6C2.7 2 2 2.7 2 3.6v5.4c0 .9.7 1.6 1.6 1.6h1.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round' }))
    }

    function IconSliders({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M2.6 5.4h6.1M11.4 5.4h2', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
        h('circle', { cx: 10.1, cy: 5.4, r: 1.6, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { d: 'M2.6 10.6h2M7.9 10.6h5.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
        h('circle', { cx: 6.1, cy: 10.6, r: 1.6, stroke: 'currentColor', strokeWidth: 1.4 }))
    }

    function IconChevron({ up }) {
      return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', {
          d: up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))
    }

    /* ------------------------------------------------------------------ *
     * Host-backed layout store (optimistic writes, live server pushes)
     * ------------------------------------------------------------------ */

    function emptyDoc() {
      return {
        version: 1,
        updatedAt: 0,
        global: { items: [], takeover: true, updatedAt: 0 },
        sessions: {},
        actions: {},
        subscriptions: {},
        knownSessions: {},
        log: [],
        messages: [],
      }
    }

    /** Copy and validate a pushed document. */
    function normalizeDoc(raw) {
      if (raw === null || typeof raw !== 'object') return emptyDoc()
      const doc = emptyDoc()
      const global = raw.global ?? {}
      doc.global.items = Array.isArray(global.items)
        ? global.items.filter((item) => item !== null && typeof item === 'object' && typeof item.id === 'string')
          .map((item) => ({ id: item.id, visible: item.visible !== false }))
        : []
      doc.global.takeover = global.takeover !== false
      doc.global.updatedAt = Number(global.updatedAt) || 0
      if (raw.sessions !== null && typeof raw.sessions === 'object') {
        for (const [sessionId, value] of Object.entries(raw.sessions)) {
          if (value === null || typeof value !== 'object' || !Array.isArray(value.items)) continue
          doc.sessions[sessionId] = {
            items: value.items.filter((item) => item !== null && typeof item === 'object' && typeof item.id === 'string')
              .map((item) => ({ id: item.id, visible: item.visible !== false })),
            updatedAt: Number(value.updatedAt) || 0,
          }
        }
      }
      if (raw.actions !== null && typeof raw.actions === 'object') doc.actions = raw.actions
      if (raw.subscriptions !== null && typeof raw.subscriptions === 'object') doc.subscriptions = raw.subscriptions
      if (raw.knownSessions !== null && typeof raw.knownSessions === 'object') doc.knownSessions = raw.knownSessions
      if (Array.isArray(raw.log)) doc.log = raw.log
      if (Array.isArray(raw.messages)) doc.messages = raw.messages
      doc.updatedAt = Number(raw.updatedAt) || 0
      return doc
    }

    function createConfigStore() {
      let state = { status: 'loading', config: null, error: null, saving: false }
      const listeners = new Set()
      let inflight = null
      let chain = Promise.resolve()
      let warned = false

      function publish(next) {
        state = next
        for (const listener of listeners) listener()
      }

      function report(error) {
        if (warned) return
        warned = true
        console.warn('[session-quickbar] the layout route failed:', error)
      }

      function applyServer(raw) {
        publish({ status: 'ready', config: normalizeDoc(raw), error: null, saving: state.saving })
      }

      function refresh() {
        if (inflight !== null) return inflight
        inflight = (async () => {
          try {
            const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' }, cache: 'no-store' })
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const payload = await response.json()
            if (payload?.ok !== true) throw new Error(payload?.error ?? 'invalid response')
            applyServer(payload.config)
            warned = false
          } catch (error) {
            report(error)
            publish({ status: state.status === 'ready' ? 'ready' : 'error', config: state.config, error, saving: state.saving })
          } finally {
            inflight = null
          }
        })()
        return inflight
      }

      /** Optimistic mutation, then one queued POST; the response wins. */
      function write(payload, optimistic) {
        if (state.config !== null && typeof optimistic === 'function') {
          publish({ status: 'ready', config: optimistic(state.config), error: null, saving: true })
        } else {
          publish({ ...state, saving: true })
        }
        chain = chain
          .then(async () => {
            const response = await fetch(ENDPOINT, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify(payload),
            })
            const result = await response.json().catch(() => null)
            if (!response.ok || result?.ok !== true) throw new Error(result?.error ?? 'HTTP ' + response.status)
            applyServer(result.config)
            warned = false
          })
          .catch((error) => {
            report(error)
            publish({ status: 'ready', config: state.config, error, saving: false })
          })
        return chain.then(() => publish({ ...state, saving: false }))
      }

      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        refresh,
        write,
        applyServer,
      }
    }

    /* ------------------------------------------------------------------ *
     * Optional adapters: session-stars and session-todos own their data
     * ------------------------------------------------------------------ */

    function createRatingsStore() {
      let state = { status: 'loading', ratings: {}, available: true }
      const listeners = new Set()
      let inflight = null
      let warned = false

      function publish(next) {
        state = next
        for (const listener of listeners) listener()
      }

      function refresh() {
        if (inflight !== null) return inflight
        inflight = (async () => {
          try {
            const response = await fetch(STARS_ENDPOINT, { headers: { accept: 'application/json' }, cache: 'no-store' })
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const payload = await response.json()
            if (payload?.ok !== true) throw new Error(payload?.error ?? 'invalid response')
            publish({ status: 'ready', ratings: payload.ratings ?? {}, available: true })
            warned = false
          } catch (error) {
            if (!warned) {
              warned = true
              console.warn('[session-quickbar] the session-stars route is unavailable:', error)
            }
            publish({ status: 'ready', ratings: {}, available: false })
          } finally {
            inflight = null
          }
        })()
        return inflight
      }

      function applyServer(raw) {
        publish({ status: 'ready', ratings: raw ?? {}, available: true })
      }

      async function setRating(sessionId, stars) {
        const previous = state
        publish({ ...state, ratings: { ...state.ratings, [sessionId]: { stars, updatedAt: Date.now() } } })
        try {
          const response = await fetch(STARS_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sessionId, stars }),
          })
          if (response.status === 404) {
            setPluginScan({ status: 'restart', rows: [], error: null })
            return
          }
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? 'HTTP ' + response.status)
          if (payload.ratings !== null && typeof payload.ratings === 'object') publish({ status: 'ready', ratings: payload.ratings, available: true })
          return { ok: true }
        } catch (error) {
          publish(previous)
          console.warn('[session-quickbar] could not change the star:', error)
          return { ok: false, error }
        }
      }

      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        refresh,
        applyServer,
        setRating,
      }
    }

    function createTodosStore() {
      let state = { status: 'loading', todos: {}, available: true }
      const listeners = new Set()
      let inflight = null
      let warned = false

      function publish(next) {
        state = next
        for (const listener of listeners) listener()
      }

      function refresh() {
        if (inflight !== null) return inflight
        inflight = (async () => {
          try {
            const response = await fetch(TODOS_ENDPOINT, { headers: { accept: 'application/json' }, cache: 'no-store' })
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const payload = await response.json()
            if (payload?.ok !== true) throw new Error(payload?.error ?? 'invalid response')
            publish({ status: 'ready', todos: payload.todos ?? {}, available: true })
            warned = false
          } catch (error) {
            if (!warned) {
              warned = true
              console.warn('[session-quickbar] the session-todos route is unavailable:', error)
            }
            publish({ status: 'ready', todos: {}, available: false })
          } finally {
            inflight = null
          }
        })()
        return inflight
      }

      function applyServer(raw) {
        publish({ status: 'ready', todos: raw ?? {}, available: true })
      }

      async function setDone(sessionId, done, title) {
        const previous = state
        publish({
          ...state,
          todos: { ...state.todos, [sessionId]: { ...(state.todos[sessionId] ?? {}), done, title: title ?? '' } },
        })
        try {
          const response = await fetch(TODOS_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sessionId, action: 'set', done, title: title ?? '' }),
          })
          if (response.status === 404) {
            setPluginScan({ status: 'restart', rows: [], error: null })
            return
          }
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? 'HTTP ' + response.status)
          if (payload.todos !== null && typeof payload.todos === 'object') publish({ status: 'ready', todos: payload.todos, available: true })
          return { ok: true }
        } catch (error) {
          publish(previous)
          console.warn('[session-quickbar] could not change the todo:', error)
          return { ok: false, error }
        }
      }

      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        refresh,
        applyServer,
        setDone,
      }
    }

    /* ------------------------------------------------------------------ *
     * Optional adapters: finish alerts and session packing
     * ------------------------------------------------------------------ */

    /** The notify plugin's watch list, read and written over its own route. */
    function createNotifyStore() {
      let state = { status: 'loading', watched: {}, available: true }
      const listeners = new Set()
      let inflight = null
      let warned = false

      function publish(next) {
        state = next
        for (const listener of listeners) listener()
      }

      function refresh() {
        if (inflight !== null) return inflight
        inflight = (async () => {
          try {
            const response = await fetch(NOTIFY_ENDPOINT, { headers: { accept: 'application/json' }, cache: 'no-store' })
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const payload = await response.json()
            if (payload?.ok !== true) throw new Error(payload?.error ?? 'invalid response')
            publish({ status: 'ready', watched: payload.watched ?? {}, available: true })
            warned = false
          } catch (error) {
            if (!warned) {
              warned = true
              console.warn('[session-quickbar] the session-notify route is unavailable:', error)
            }
            publish({ status: 'ready', watched: {}, available: false })
          } finally {
            inflight = null
          }
        })()
        return inflight
      }

      function applyServer(raw) {
        publish({ status: 'ready', watched: raw ?? {}, available: true })
      }

      async function toggle(sessionId, title) {
        const previous = state
        const watching = state.watched[sessionId] !== undefined
        const nextWatched = { ...state.watched }
        if (watching) delete nextWatched[sessionId]
        else nextWatched[sessionId] = { title }
        publish({ ...state, watched: nextWatched })
        try {
          const response = await fetch(NOTIFY_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              sessionId,
              action: watching ? 'unwatch' : 'watch',
              title,
              locale: languageOf(),
            }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? 'HTTP ' + response.status)
          if (payload.watched !== null && typeof payload.watched === 'object') {
            publish({ status: 'ready', watched: payload.watched, available: true })
          }
          return { ok: true }
        } catch (error) {
          publish(previous)
          console.warn('[session-quickbar] could not change the finish alert:', error)
          return { ok: false, error }
        }
      }

      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        refresh,
        applyServer,
        toggle,
      }
    }

    /** Download one session pack through the transfer plugin's export route. */
    async function packSession(ctx, sessionId, onProgress) {
      const title = titleOf(ctx, sessionId)
      const query = new URLSearchParams({ sessionId })
      if (title !== '') query.set('title', title)
      const response = await fetch(TRANSFER_EXPORT + '?' + query.toString(), { cache: 'no-store' })
      if (!response.ok) {
        let payload
        try {
          payload = await response.json()
        } catch {
          payload = undefined
        }
        const error = new Error(typeof payload?.error === 'string' && payload.error !== '' ? payload.error : 'HTTP ' + response.status)
        error.code = typeof payload?.code === 'string' ? payload.code : 'HTTP_' + response.status
        throw error
      }
      const total = Number(response.headers.get('content-length')) || 0
      const disposition = response.headers.get('content-disposition') ?? ''
      const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) ?? /filename="?([^";]+)"?/i.exec(disposition)
      const filename = match === null
        ? 'session-' + sessionId.slice(0, 8) + '.dshpack'
        : decodeURIComponent(match[1])
      const reader = response.body.getReader()
      const chunks = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        onProgress(received, total)
      }
      const blob = new Blob(chunks, { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 5000)
      return { filename, bytes: received }
    }

    /** Bell: follow this session's finish alerts (session-notify). */
    function NotifyButton({ ctx, sessionId, notify, t }) {
      const state = useStore(notify)
      const watched = state.watched[sessionId] !== undefined
      const [busy, setBusy] = useState(false)
      const label = watched ? t('bar.notifyOn') : t('bar.notify')
      return h(BarButton, {
        label,
        active: watched,
        disabled: busy,
        onClick: async () => {
          setBusy(true)
          await notify.toggle(sessionId, titleOf(ctx, sessionId))
          setBusy(false)
        },
      }, h(IconBell, { filled: watched }))
    }

    /** Arrow: pack this session into a portable .dshpack (session-transfer). */
    function PackButton({ ctx, sessionId, t }) {
      const [phase, setPhase] = useState('idle')
      const [failure, setFailure] = useState('')
      const timer = useRef(0)
      useEffect(() => () => window.clearTimeout(timer.current), [])
      const label = phase === 'busy'
        ? t('bar.packBusy')
        : phase === 'done' ? t('bar.packDone') : phase === 'failed' ? t('bar.packFailed') : t('bar.pack')
      return h(BarButton, {
        label,
        title: phase === 'failed' && failure !== '' ? t('bar.packFailedReason', { reason: failure }) : undefined,
        active: phase === 'done',
        tone: phase === 'failed' ? 'warn' : undefined,
        disabled: phase === 'busy',
        onClick: async () => {
          if (phase === 'busy') return
          setPhase('busy')
          setFailure('')
          try {
            await packSession(ctx, sessionId, () => {})
            setPhase('done')
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => setPhase('idle'), 2500)
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            console.warn('[session-quickbar] could not pack the session:', error?.code ?? 'UNKNOWN', reason)
            setFailure(reason)
            setPhase('failed')
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => setPhase('idle'), 3000)
          }
        },
      }, h(IconPack))
    }

    /* ------------------------------------------------------------------ *
     * Optional adapters: token usage and session boxes
     * ------------------------------------------------------------------ */

    /** Compact token counts for the strip and the popover. */
    function formatTokens(value) {
      const n = Number(value) || 0
      if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B'
      if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
      return String(Math.round(n))
    }

    /** Money for the token popover. */
    function formatCost(value) {
      const n = Number(value) || 0
      return '$' + (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3))
    }

    /** The token-usage plugin's per-session report, refreshed lazily. */
    function createTokenStore() {
      let state = { status: 'loading', available: true, byId: {} }
      const listeners = new Set()
      let inflight = null
      let fetchedAt = 0
      let warned = false

      function publish(next) {
        state = next
        for (const listener of listeners) listener()
      }

      function refresh(force) {
        if (inflight !== null) return inflight
        if (force !== true && state.status === 'ready' && Date.now() - fetchedAt < 60_000) return Promise.resolve()
        inflight = (async () => {
          try {
            const response = await fetch(TOKEN_ENDPOINT, { headers: { accept: 'application/json' }, cache: 'no-store' })
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const payload = await response.json()
            if (payload?.ok !== true) throw new Error(payload?.error ?? 'invalid response')
            const byId = {}
            for (const row of Array.isArray(payload.sessions) ? payload.sessions : []) {
              if (row === null || typeof row !== 'object' || typeof row.sessionId !== 'string') continue
              byId[row.sessionId] = {
                total: Number(row.total) || 0,
                input: Number(row.input) || 0,
                output: Number(row.output) || 0,
                cacheRead: Number(row.cacheRead) || 0,
                cacheWrite: Number(row.cacheWrite) || 0,
                cost: Number(row.cost) || 0,
                cacheHitRate: Number(row.cacheHitRate) || 0,
                turns: Number(row.turns) || 0,
                days: Array.isArray(row.days) ? row.days.slice(-7) : [],
              }
            }
            fetchedAt = Date.now()
            publish({ status: 'ready', available: true, byId })
            warned = false
          } catch (error) {
            if (!warned) {
              warned = true
              console.warn('[session-quickbar] the token-usage route is unavailable:', error)
            }
            publish({ status: 'ready', available: false, byId: {} })
          } finally {
            inflight = null
          }
        })()
        return inflight
      }

      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        refresh,
      }
    }

    /** The session-boxes plugin's boxes and memberships. */
    function createBoxesStore() {
      let state = { status: 'loading', available: true, boxes: [], memberships: {} }
      const listeners = new Set()
      let inflight = null
      let warned = false

      function publish(next) {
        state = next
        for (const listener of listeners) listener()
      }

      function applyState(raw) {
        const boxes = []
        const memberships = {}
        const source = raw === null || typeof raw !== 'object' ? {} : raw
        for (const box of Array.isArray(source.boxes) ? source.boxes : []) {
          if (box === null || typeof box !== 'object' || typeof box.id !== 'string') continue
          boxes.push({
            id: box.id,
            name: typeof box.name === 'string' ? box.name : box.id,
            color: typeof box.color === 'string' ? box.color : 'gray',
            parentId: typeof box.parentId === 'string' ? box.parentId : null,
            order: Number(box.order) || 0,
          })
        }
        for (const [sessionId, ids] of Object.entries(source.memberships ?? {})) {
          if (Array.isArray(ids)) memberships[sessionId] = ids.filter((id) => typeof id === 'string')
        }
        publish({ status: 'ready', available: true, boxes, memberships })
      }

      function refresh() {
        if (inflight !== null) return inflight
        inflight = (async () => {
          try {
            const response = await fetch(BOXES_ENDPOINT, { headers: { accept: 'application/json' }, cache: 'no-store' })
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const payload = await response.json()
            if (payload?.ok !== true) throw new Error(payload?.error ?? 'invalid response')
            applyState(payload.state)
            warned = false
          } catch (error) {
            if (!warned) {
              warned = true
              console.warn('[session-quickbar] the session-boxes route is unavailable:', error)
            }
            publish({ status: 'ready', available: false, boxes: [], memberships: {} })
          } finally {
            inflight = null
          }
        })()
        return inflight
      }

      async function assign(sessionId, boxIds) {
        const previous = state
        publish({ ...state, memberships: { ...state.memberships, [sessionId]: boxIds } })
        try {
          const response = await fetch(BOXES_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ action: 'assign', sessionId, boxIds }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? 'HTTP ' + response.status)
          if (payload.state !== undefined) applyState(payload.state)
          return { ok: true }
        } catch (error) {
          publish(previous)
          console.warn('[session-quickbar] could not change the box membership:', error)
          return { ok: false, error }
        }
      }

      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        refresh,
        assign,
      }
    }

    /** Boxes in display order, children right after their parent. */
    function flattenBoxes(boxes) {
      const rows = []
      const tops = boxes.filter((box) => box.parentId === null).sort((left, right) => left.order - right.order)
      for (const top of tops) {
        rows.push({ ...top, depth: 0 })
        const children = boxes.filter((box) => box.parentId === top.id).sort((left, right) => left.order - right.order)
        for (const child of children) rows.push({ ...child, depth: 1 })
      }
      for (const box of boxes) {
        if (!rows.some((row) => row.id === box.id)) rows.push({ ...box, depth: 0 })
      }
      return rows
    }

    /** Anchor one popover under (or above) the button that opened it. */
    function popoverPosition(rect) {
      const width = 268
      const height = 280
      const margin = 10
      const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
      const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
      const left = Math.max(margin, Math.min(rect.right - width, viewportWidth - width - margin))
      const below = rect.bottom + 8
      const top = below + height > viewportHeight ? Math.max(margin, rect.top - height - 8) : below
      return { left, top, width }
    }

    /** Open one popover for a session from a bar button. */
    function openPopover(popover, kind, sessionId, event) {
      const rect = event.currentTarget.getBoundingClientRect()
      popover.set({
        kind,
        sessionId,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      })
    }

    function TokenButton({ ctx, sessionId, token, popover, t }) {
      const state = useStore(token)
      const entry = state.byId[sessionId]
      if (entry === undefined) return null
      const label = t('bar.token', { n: formatTokens(entry.total), cost: formatCost(entry.cost) })
      return h('button', {
        type: 'button',
        className: 'sq-btn sq-token',
        title: label,
        'aria-label': label,
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          openPopover(popover, 'token', sessionId, event)
        },
        onPointerDown: (event) => event.stopPropagation(),
      }, formatTokens(entry.total))
    }

    function BoxButton({ sessionId, boxes, popover, t }) {
      const state = useStore(boxes)
      const ids = state.memberships[sessionId] ?? []
      const first = state.boxes.find((box) => box.id === ids[0])
      const label = ids.length === 0
        ? t('bar.boxes')
        : t('bar.boxesOn', { n: ids.length, name: first === undefined ? '' : first.name })
      return h('button', {
        type: 'button',
        className: 'sq-btn sq-boxbtn',
        title: label,
        'aria-label': label,
        'data-active': ids.length > 0 ? 'true' : 'false',
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          openPopover(popover, 'boxes', sessionId, event)
        },
        onPointerDown: (event) => event.stopPropagation(),
      },
        ids.length === 0
          ? h(IconBox)
          : h('span', { className: 'sq-boxdot', 'data-color': first === undefined ? 'gray' : first.color }),
        ids.length > 1 ? h('span', { className: 'sq-boxcount' }, String(ids.length)) : null)
    }

    function IconBox() {
      return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2.6 4.6l5.4-2 5.4 2v6.8l-5.4 2-5.4-2z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M2.6 4.6L8 6.6l5.4-2M8 6.6v6.8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, strokeLinejoin: 'round' }))
    }

    function kvRow(label, value) {
      return h(React.Fragment, { key: label }, h('dt', null, label), h('dd', null, value))
    }

    /** Token breakdown for one session. */
    function TokenPanel({ sessionId, ctx, token, t }) {
      const state = useStore(token)
      const entry = state.byId[sessionId]
      const title = titleOf(ctx, sessionId)
      return h('div', { className: 'sq-popover-body' },
        h('div', { className: 'sq-popover-head' }, title === '' ? shortId(sessionId) : title),
        entry === undefined
          ? h('p', { className: 'sq-note' }, t('popover.noUsage'))
          : h(React.Fragment, null,
            h('div', { className: 'sq-token-total' },
              formatTokens(entry.total),
              h('span', { className: 'sq-token-cost' }, formatCost(entry.cost))),
            h('dl', { className: 'sq-kv' },
              kvRow(t('popover.input'), formatTokens(entry.input)),
              kvRow(t('popover.output'), formatTokens(entry.output)),
              kvRow(t('popover.cacheRead'), formatTokens(entry.cacheRead)),
              kvRow(t('popover.cacheWrite'), formatTokens(entry.cacheWrite)),
              kvRow(t('popover.cacheHit'), (entry.cacheHitRate * 100).toFixed(1) + '%')),
            entry.days.length === 0
              ? null
              : h('div', { className: 'sq-days' }, entry.days.map((day) => h('div', { key: day.day, className: 'sq-day' },
                h('span', null, String(day.day).slice(5)),
                h('span', null, formatTokens(Number(day.total) || 0)))))))
    }

    /** Box membership picker for one session. */
    function BoxPanel({ sessionId, boxes, t }) {
      const state = useStore(boxes)
      const ids = state.memberships[sessionId] ?? []
      const rows = flattenBoxes(state.boxes)
      return h('div', { className: 'sq-popover-body' },
        h('div', { className: 'sq-popover-head' }, t('popover.boxesTitle')),
        rows.length === 0
          ? h('p', { className: 'sq-note' }, t('popover.noBoxes'))
          : h('div', { className: 'sq-boxlist' }, rows.map((box) => {
            const on = ids.includes(box.id)
            return h('button', {
              key: box.id,
              type: 'button',
              className: 'sq-boxrow',
              'data-on': on ? 'true' : 'false',
              'data-depth': box.depth,
              onClick: () => {
                void boxes.assign(sessionId, on ? ids.filter((id) => id !== box.id) : [...ids, box.id])
              },
            },
              h('span', { className: 'sq-boxdot', 'data-color': box.color }),
              h('span', { className: 'sq-boxname' }, box.name),
              on ? h(IconCheck) : null)
          })),
        ids.length === 0
          ? null
          : h('button', {
            type: 'button',
            className: 'sq-btn-ghost sq-boxclear',
            onClick: () => { void boxes.assign(sessionId, []) },
          }, t('popover.clearBoxes')))
    }

    /** The single overlay that hosts both popovers. */
    function QuickbarPopover({ ctx, deps }) {
      const { popover, token, boxes } = deps
      const request = useStore(popover)
      const t = useT(ctx)
      const surface = useRef(null)
      useEffect(() => {
        if (request === null) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          popover.set(null)
        }
        const onDown = (event) => {
          const node = surface.current
          if (node !== null && node.contains(event.target)) return
          popover.set(null)
        }
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('pointerdown', onDown, true)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          document.removeEventListener('pointerdown', onDown, true)
        }
      }, [request, popover])
      if (request === null) return null
      return h('div', {
        className: 'sq-popover',
        style: popoverPosition(request.rect),
        ref: surface,
        role: 'dialog',
        'aria-label': request.kind === 'token' ? t('popover.token') : t('popover.boxes'),
      }, request.kind === 'token'
        ? h(TokenPanel, { sessionId: request.sessionId, ctx, token, t })
        : h(BoxPanel, { sessionId: request.sessionId, boxes, t }))
    }

    /* ------------------------------------------------------------------ *
     * Action registry shared with other plugins
     * ------------------------------------------------------------------ */

    function createRegistry() {
      const actions = new Map()
      const listeners = new Set()
      let revision = 0

      function emit() {
        revision += 1
        for (const listener of listeners) listener()
      }

      /** Report one registration to the Host so agents and the page can see it. */
      function report(descriptor) {
        try {
          void fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              action: 'register-action',
              id: descriptor.id,
              labels: descriptor.labels ?? {},
              hint: descriptor.hint ?? {},
              owner: descriptor.owner ?? null,
              order: typeof descriptor.order === 'number' ? descriptor.order : 500,
            }),
          }).catch(() => {})
        } catch {
          /* the Host registry is best effort; the bar still renders */
        }
      }

      function validate(descriptor) {
        if (descriptor === null || typeof descriptor !== 'object') return 'a descriptor object is required'
        if (typeof descriptor.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(descriptor.id)) {
          return 'id must be lowercase letters, digits, dot, dash, or underscore'
        }
        if (descriptor.builtin !== true && BUILTIN_IDS.includes(descriptor.id)) {
          return descriptor.id + ' is a built-in action id'
        }
        if (descriptor.Component !== undefined && typeof descriptor.Component !== 'function') {
          return 'Component must be a function'
        }
        if (descriptor.builtin !== true && descriptor.Component === undefined
          && typeof descriptor.onActivate !== 'function') {
          return 'Component or onActivate is required'
        }
        return null
      }

      return {
        version: () => revision,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        get: (id) => actions.get(id)?.descriptor,
        list: () => [...actions.values()].map((entry) => entry.descriptor),
        register(descriptor) {
          const problem = validate(descriptor)
          if (problem !== null) {
            console.warn('[session-quickbar] refused an action registration: ' + problem)
            return () => {}
          }
          const id = descriptor.id
          const previous = actions.get(id)
          if (previous !== undefined) previous.subs.forEach((stop) => { try { stop() } catch { /* ignore */ } })
          const subs = []
          if (typeof descriptor.subscribe === 'function') {
            try {
              const stop = descriptor.subscribe(() => emit())
              if (typeof stop === 'function') subs.push(stop)
            } catch (error) {
              console.warn('[session-quickbar] an action subscription failed:', error)
            }
          }
          actions.set(id, { descriptor, subs })
          emit()
          if (descriptor.builtin !== true) report(descriptor)
          return () => {
            if (actions.get(id)?.descriptor !== descriptor) return
            subs.forEach((stop) => { try { stop() } catch { /* ignore */ } })
            actions.delete(id)
            emit()
          }
        },
        unregister(id) {
          const entry = actions.get(id)
          if (entry === undefined) return
          entry.subs.forEach((stop) => { try { stop() } catch { /* ignore */ } })
          actions.delete(id)
          emit()
        },
      }
    }

    /* ------------------------------------------------------------------ *
     * Layout math
     * ------------------------------------------------------------------ */

    /** The order a registry entry asks for, or a late default. */
    function descriptorOrder(descriptor) {
      return typeof descriptor?.order === 'number' && Number.isFinite(descriptor.order) ? descriptor.order : 500
    }

    /** The layout in force for one Session, mirroring the Host rule. */
    function effectiveItems(config, sessionId) {
      const override = sessionId === null ? undefined : config.sessions[sessionId]
      if (override !== undefined) return { items: override.items, source: 'session' }
      if (config.global.items.length > 0) return { items: config.global.items, source: 'global' }
      return { items: null, source: 'default' }
    }

    /** Resolve one layout into renderable entries, defaulting to the registry. */
    function resolveEntries({ config, sessionId, registry, ratings, todos, notify, token, boxes, language }) {
      const layout = effectiveItems(config, sessionId)
      const explicit = layout.items
      let items
      if (explicit !== null) {
        items = explicit
      } else {
        items = registry.list()
          .filter((descriptor) => descriptor.hiddenByDefault !== true)
          .sort((left, right) => descriptorOrder(left) - descriptorOrder(right))
          .map((descriptor) => ({ id: descriptor.id, visible: true }))
      }
      const entries = []
      for (const item of items) {
        if (item.visible === false) continue
        const descriptor = registry.get(item.id)
        if (descriptor === undefined) continue
        if (item.id === 'star' && ratings.available !== true) continue
        if (item.id === 'todo' && todos.available !== true) continue
        if (item.id === 'notify' && notify.available !== true) continue
        if (item.id === 'token' && (token.available !== true || token.byId[sessionId] === undefined)) continue
        if (item.id === 'boxes' && boxes.available !== true) continue
        entries.push({ ...item, descriptor, labels: actionLabel(descriptor, language), hint: actionHint(descriptor, language) })
      }
      return entries
    }

    /* ------------------------------------------------------------------ *
     * Built-in actions
     * ------------------------------------------------------------------ */

    function IconBell({ filled }) {
      return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', {
          d: 'M8 2.1c-2.1 0-3.5 1.6-3.5 3.8v2.2L3.1 10.1h9.8L11.5 8.1V5.9c0-2.2-1.4-3.8-3.5-3.8z',
          fill: filled ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M6.4 11.7a1.7 1.7 0 003.2 0',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinecap: 'round',
        }))
    }

    function IconPack() {
      return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', {
          d: 'M8 2.4v7.1M5.6 7.2L8 9.6l2.4-2.4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M2.9 11.3v1.3c0 .6.5 1.1 1.1 1.1h8c.6 0 1.1-.5 1.1-1.1v-1.3',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }))
    }

    /** A row button: 22px, theme tokens, native tooltip, no row navigation. */
    function BarButton({ label, title, active, tone, disabled, onClick, children }) {
      return h('button', {
        type: 'button',
        className: 'sq-btn',
        'data-active': active === true ? 'true' : 'false',
        'data-tone': tone,
        'data-busy': disabled === true ? 'true' : undefined,
        title: title ?? label,
        'aria-label': label,
        'aria-pressed': active === undefined ? undefined : active === true,
        disabled: disabled === true,
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          onClick?.(event)
        },
        onPointerDown: (event) => event.stopPropagation(),
        onDoubleClick: (event) => event.stopPropagation(),
      }, children)
    }

    /** Star: toggles the session-stars rating between 0 and 1. */
    function StarButton({ ctx, sessionId, ratings, t }) {
      const state = useStore(ratings)
      const entry = state.ratings[sessionId]
      const stars = entry !== undefined && Number(entry.stars) > 0 ? Number(entry.stars) : 0
      const [busy, setBusy] = useState(false)
      const label = stars > 0 ? t('bar.starOn') : t('bar.star')
      return h(BarButton, {
        label,
        active: stars > 0,
        disabled: busy,
        onClick: async () => {
          setBusy(true)
          await ratings.setRating(sessionId, stars > 0 ? 0 : 1)
          setBusy(false)
        },
      }, h(IconStar, { filled: stars > 0 }))
    }

    /** Todo: one square, done state from the session-todos route. */
    function TodoButton({ ctx, sessionId, todos, t }) {
      const state = useStore(todos)
      const running = useRunning(ctx, sessionId)
      const entry = state.todos[sessionId]
      const done = entry !== undefined && entry.done === true
      const [busy, setBusy] = useState(false)
      const label = done ? t('bar.todoDone') : running ? t('bar.todoDoing') : t('bar.todo')
      return h(BarButton, {
        label,
        active: done,
        disabled: busy,
        onClick: async () => {
          // The catalog read supplies the cached title; without it the click
          // would throw before the write.
          const summary = summaryOf(ctx, sessionId)
          const title = summary !== undefined && typeof summary.title === 'string' ? summary.title : ''
          setBusy(true)
          await todos.setDone(sessionId, !done, title)
          setBusy(false)
        },
      }, h('span', {
        className: 'sq-square',
        'data-state': done ? 'done' : running ? 'doing' : 'todo',
        'aria-hidden': 'true',
      }, done ? h(IconCheck) : null))
    }

    /** Whether one Session is running right now, kept live for its row. */
    function useRunning(ctx, sessionId) {
      const list = sessionCatalog(ctx)
      const [running, setRunning] = useState(false)
      useEffect(() => {
        if (list === undefined) return undefined
        const read = () => {
          const summary = catalogSnapshot(list).byId[sessionId]
          setRunning(summary !== undefined && summary.running === true)
        }
        read()
        if (typeof list.subscribe !== 'function') return undefined
        const off = list.subscribe(read)
        return typeof off === 'function' ? off : undefined
      }, [list, sessionId])
      return running
    }

    /** Pin: workspace pin state, toggled through the public Workspace service. */
    function PinButton({ ctx, sessionId, workspaces, t }) {
      const pinned = useWorkspaceSet(workspaces, 'pinnedSessionIds', sessionId)
      const archived = useWorkspaceSet(workspaces, 'archivedSessionIds', sessionId)
      const service = readService(ctx, 'uiWorkspace')
      if (archived) return null
      const label = pinned ? t('bar.unpin') : t('bar.pin')
      return h(BarButton, {
        label,
        active: pinned,
        onClick: () => {
          if (service === undefined) return
          try {
            if (pinned) service.unpinSession?.(sessionId)
            else service.pinSession?.(sessionId)
          } catch (error) {
            console.warn('[session-quickbar] could not change the pin:', error)
          }
        },
      }, h(IconPin, { filled: pinned }))
    }

    /** Archive: the host confirmation is mirrored for a session that is working. */
    function ArchiveButton({ ctx, sessionId, workspaces, confirm, t }) {
      const archived = useWorkspaceSet(workspaces, 'archivedSessionIds', sessionId)
      const label = archived ? t('bar.unarchive') : t('bar.archive')
      const service = readService(ctx, 'uiWorkspace')
      async function run() {
        if (service === undefined) return
        try {
          if (archived) await service.unarchiveSession?.(sessionId)
          else await service.archiveSession?.(sessionId)
        } catch (error) {
          const activity = error?.name === 'WorkspaceArchiveError' && error?.rpcError?.code === 'workspace/session-active'
            ? error.rpcError.details?.activity ?? []
            : null
          if (activity === null) {
            console.warn('[session-quickbar] could not archive:', error)
            return
          }
          confirm.set({ sessionId, count: Array.isArray(activity) ? activity.length : 0 })
        }
      }
      return h(BarButton, {
        label,
        active: archived,
        onClick: () => { void run() },
      }, h(IconArchive, { unarchive: archived }))
    }

    /** Copy id: no visual state beyond a short confirmation. */
    function CopyIdButton({ sessionId, t }) {
      const [copied, setCopied] = useState(false)
      const timer = useRef(0)
      useEffect(() => () => window.clearTimeout(timer.current), [])
      const label = copied ? t('bar.copied') : t('bar.copy')
      return h(BarButton, {
        label,
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(sessionId)
            setCopied(true)
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
          } catch (error) {
            console.warn('[session-quickbar] could not copy the session id:', error)
          }
        },
      }, copied ? h(IconCheck) : h(IconCopy))
    }

    /** A button contributed through the registry API. */
    function RegistryButton({ descriptor, sessionId, ctx }) {
      const [busy, setBusy] = useState(false)
      const active = typeof descriptor.isActive === 'function' ? descriptor.isActive(sessionId) === true : false
      const label = actionLabel(descriptor, languageOf()) || descriptor.id
      if (typeof descriptor.Component === 'function') {
        return h(descriptor.Component, { sessionId, ctx, active })
      }
      async function activate() {
        setBusy(true)
        try {
          await descriptor.onActivate(sessionId)
        } catch (error) {
          console.warn('[session-quickbar] an action failed:', error)
        }
        setBusy(false)
      }
      return h(BarButton, { label, active, disabled: busy, onClick: () => { void activate() } },
        typeof descriptor.icon === 'string'
          ? h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, h('path', { d: descriptor.icon, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))
          : h('span', { 'aria-hidden': 'true', style: { width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'block' } }))
    }

    /** Subscribe to one membership set in the Workspace store. */
    function useWorkspaceSet(workspaces, key, sessionId) {
      const list = workspaces?.list
      const [member, setMember] = useState(false)
      useEffect(() => {
        if (list === undefined || typeof list.getSnapshot !== 'function') return undefined
        const read = () => {
          const snapshot = list.getSnapshot()
          const values = snapshot?.[key]
          setMember(Array.isArray(values) && values.includes(sessionId))
        }
        read()
        if (typeof list.subscribe !== 'function') return undefined
        const off = list.subscribe(read)
        return typeof off === 'function' ? off : undefined
      }, [list, key, sessionId])
      return member
    }

    /* ------------------------------------------------------------------ *
     * The bar
     * ------------------------------------------------------------------ */

    /** Ask the layout to open its settings page on one Session. */
    function openSettings(ctx, panelIntent, sessionId) {
      panelIntent.set({ token: Date.now(), scope: 'session', sessionId })
      const layout = readService(ctx, 'layout')
      if (layout !== undefined && typeof layout.selectPanel === 'function') {
        try {
          layout.selectPanel(PANEL_ID)
        } catch (error) {
          console.warn('[session-quickbar] could not open the settings page:', error)
        }
      }
    }

    function QuickBar({ ctx, sessionId, deps }) {
      const { configStore, registry, ratings, todos, notify, token, boxes, popover, confirm, panelIntent } = deps
      const state = useStore(configStore)
      const revision = useStore(registryStoreVersion(registry))
      useStore(ratings)
      useStore(todos)
      useStore(notify)
      useStore(token)
      useStore(boxes)
      const t = useT(ctx)
      const language = languageOf()
      if (state.config === null) return null
      const entries = resolveEntries({ config: state.config, sessionId, registry, ratings: ratings.getSnapshot(), todos: todos.getSnapshot(), notify: notify.getSnapshot(), token: token.getSnapshot(), boxes: boxes.getSnapshot(), language })
      const pendingCount = state.config.messages.filter((message) => message.to === sessionId && message.deliveredAt === 0).length
      if (entries.length === 0 && pendingCount === 0) return null
      const takeover = state.config.global.takeover !== false
      return h('div', {
        className: 'sq-bar',
        'data-dsh-quickbar': '',
        'data-sq-keep': takeover ? undefined : 'true',
        role: 'group',
        'aria-label': t('page.title'),
      }, entries.map((entry) => {
        const key = entry.id
        const id = entry.id
        if (id === 'star') return h(StarButton, { key, ctx, sessionId, ratings, t })
        if (id === 'todo') return h(TodoButton, { key, ctx, sessionId, todos, t })
        if (id === 'pin') return h(PinButton, { key, ctx, sessionId, workspaces: deps.workspaces, t })
        if (id === 'archive') return h(ArchiveButton, { key, ctx, sessionId, workspaces: deps.workspaces, confirm, t })
        if (id === 'notify') return h(NotifyButton, { key, ctx, sessionId, notify: deps.notify, t })
        if (id === 'pack') return h(PackButton, { key, ctx, sessionId, t })
        if (id === 'token') return h(TokenButton, { key, ctx, sessionId, token, popover, t })
        if (id === 'boxes') return h(BoxButton, { key, ctx, sessionId, boxes, popover, t })
        if (id === 'copy-id') return h(CopyIdButton, { key, sessionId, t })
        return h(RegistryButton, { key, descriptor: entry.descriptor, sessionId, ctx })
      }), pendingCount > 0
        ? h('span', {
          key: 'pending',
          className: 'sq-pending',
          title: t('bar.pending', { n: pendingCount }),
          'aria-label': t('bar.pending', { n: pendingCount }),
        }, String(pendingCount))
        : null)
    }

    /** A version store that mirrors registry revisions. */
    function registryStoreVersion(registry) {
      return registry.versionStore
    }

    /* ------------------------------------------------------------------ *
     * Settings page
     * ------------------------------------------------------------------ */

    /** One row of the layout editor. */
    function ActionRow({ entry, index, total, language, t, onToggle, onMove }) {
      const source = entry.source === 'builtin' ? t('page.source.builtin') : entry.source === 'tool' ? t('page.source.tool') : t('page.source.client')
      return h('div', { className: 'sq-row', 'data-hidden': entry.visible === false ? 'true' : undefined },
        h('button', {
          type: 'button',
          role: 'checkbox',
          className: 'sq-check',
          'aria-checked': entry.visible !== false,
          'aria-label': entry.visible !== false ? t('page.hide') : t('page.show'),
          title: entry.visible !== false ? t('page.hide') : t('page.show'),
          onClick: () => onToggle(entry.id),
        }, entry.visible !== false ? h(IconCheck) : null),
        h('span', { className: 'sq-row-icon' }, entry.preview ?? h('span', { 'aria-hidden': 'true' })),
        h('span', { className: 'sq-row-label' },
          h('span', { className: 'sq-row-name' }, entry.label),
          entry.hint === '' ? null : h('span', { className: 'sq-row-hint' }, entry.hint)),
        entry.ownerSession === null ? null : h('span', { className: 'sq-tag' }, t('page.owner', { id: shortId(entry.ownerSession) })),
        h('span', { className: 'sq-tag' }, source),
        h('button', {
          type: 'button',
          className: 'sq-move',
          title: t('page.moveUp'),
          'aria-label': t('page.moveUp'),
          disabled: index === 0,
          onClick: () => onMove(entry.id, -1),
        }, h(IconChevron, { up: true })),
        h('button', {
          type: 'button',
          className: 'sq-move',
          title: t('page.moveDown'),
          'aria-label': t('page.moveDown'),
          disabled: index === total - 1,
          onClick: () => onMove(entry.id, 1),
        }, h(IconChevron, { up: false })))
    }

    /** The settings page: scope picker, ordered layout editor, channel history. */
    function QuickbarPage({ ctx, deps }) {
      const { configStore, registry, panelIntent } = deps
      const state = useStore(configStore)
      const registryState = useStore(registry.versionStore)
      const intent = useStore(panelIntent)
      const catalog = useCatalog(ctx)
      const t = useT(ctx)
      const language = languageOf()
      const [scope, setScope] = useState('global')
      const [selected, setSelected] = useState(null)
      const [search, setSearch] = useState('')
      const [pluginScan, setPluginScan] = useState({ status: 'idle', rows: [], error: null })
      const scanPlugins = useCallback(async () => {
        setPluginScan((current) => ({ ...current, status: 'loading' }))
        try {
          const response = await fetch('/session-quickbar/plugins', { headers: { accept: 'application/json' }, cache: 'no-store' })
          if (response.status === 404) {
            setPluginScan({ status: 'restart', rows: [], error: null })
            return
          }
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? 'HTTP ' + response.status)
          setPluginScan({ status: 'ready', rows: Array.isArray(payload.plugins) ? payload.plugins : [], error: null })
        } catch (error) {
          setPluginScan({ status: 'error', rows: [], error })
        }
      }, [])
      useEffect(() => { void scanPlugins() }, [scanPlugins])
      const reported = useRef('')

      useEffect(() => {
        if (state.status === 'loading') void configStore.refresh()
      }, [state.status, configStore])

      // Adopt a "Quick bar…" request from a row menu.
      useEffect(() => {
        if (intent === null) return
        if (typeof intent.sessionId === 'string') {
          setSelected(intent.sessionId)
          setScope('session')
        }
      }, [intent])

      // Report session titles so the Host can resolve a title for channel targets.
      useEffect(() => {
        const rows = []
        for (const id of catalog.ids.slice(0, MAX_CATALOG_ROWS)) {
          const summary = catalog.byId[id]
          if (summary === undefined) continue
          rows.push({
            id,
            title: typeof summary.title === 'string' ? summary.title : '',
            cwd: typeof summary.cwd === 'string' ? summary.cwd : '',
            updatedAt: Number(summary.updatedAt) || 0,
            archived: summary.archived === true,
            running: summary.running === true,
          })
        }
        if (rows.length === 0) return
        const signature = rows.map((row) => row.id + ':' + row.title + ':' + Number(row.running)).join('|')
        if (signature === reported.current) return
        reported.current = signature
        try {
          void fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ action: 'catalog', rows }),
          }).catch(() => {})
        } catch {
          /* best effort */
        }
      }, [catalog])

      const config = state.config
      const sessionEntry = config === null || selected === null ? undefined : config.sessions[selected]
      const baseItems = useMemo(() => {
        if (config === null) return []
        if (scope === 'session' && sessionEntry !== undefined) return sessionEntry.items
        if (config.global.items.length > 0) return config.global.items
        return registry.list()
          .filter((descriptor) => descriptor.hiddenByDefault !== true)
          .sort((left, right) => descriptorOrder(left) - descriptorOrder(right))
          .map((descriptor) => ({ id: descriptor.id, visible: true }))
      }, [config, scope, sessionEntry, registryState])

      const rows = useMemo(() => {
        if (config === null) return []
        const byId = new Map()
        for (const item of baseItems) {
          const descriptor = registry.get(item.id)
          const meta = config.actions[item.id] ?? {}
          byId.set(item.id, {
            id: item.id,
            visible: item.visible !== false,
            label: actionLabel(descriptor ?? meta, language) || item.id,
            hint: actionHint(descriptor ?? meta, language),
            source: meta.source ?? (descriptor !== undefined ? 'client' : 'builtin'),
            ownerSession: meta.ownerSession ?? null,
            sortOrder: baseItems.findIndex((entry) => entry.id === item.id),
          })
        }
        for (const [id, meta] of Object.entries(config.actions)) {
          if (byId.has(id)) continue
          byId.set(id, {
            id,
            visible: false,
            label: actionLabel(meta, language) || id,
            hint: actionHint(meta, language),
            source: meta.source ?? 'client',
            ownerSession: meta.ownerSession ?? null,
            sortOrder: Number.MAX_SAFE_INTEGER,
          })
        }
        for (const descriptor of registry.list()) {
          if (byId.has(descriptor.id)) continue
          byId.set(descriptor.id, {
            id: descriptor.id,
            visible: false,
            label: actionLabel(descriptor, language) || descriptor.id,
            hint: actionHint(descriptor, language),
            source: 'client',
            ownerSession: null,
            sortOrder: Number.MAX_SAFE_INTEGER,
          })
        }
        return [...byId.values()]
          .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
          .map((entry, index) => ({ ...entry, position: index }))
          .map((entry) => ({ ...entry, unusable: config.actions[entry.id] !== undefined && registry.get(entry.id) === undefined && !['star', 'todo', 'pin', 'archive', 'copy-id'].includes(entry.id) }))
      }, [config, baseItems, registryState, language])

      const writeItems = useCallback((items) => {
        const payload = { action: 'set', scope, sessionId: scope === 'session' ? selected : undefined, items }
        void configStore.write(payload, (doc) => (scope === 'session' && selected !== null
          ? { ...doc, sessions: { ...doc.sessions, [selected]: { items, updatedAt: Date.now() } } }
          : { ...doc, global: { ...doc.global, items, updatedAt: Date.now() } }))
      }, [configStore, scope, selected])

      const toggle = (id) => {
        const next = rows.map((row) => ({ id: row.id, visible: row.id === id ? row.visible === false : row.visible !== false }))
        writeItems(next)
      }

      const move = (id, delta) => {
        const ordered = rows.map((row) => ({ id: row.id, visible: row.visible !== false }))
        const from = ordered.findIndex((row) => row.id === id)
        const to = from + delta
        if (from === -1 || to < 0 || to >= ordered.length) return
        const [moved] = ordered.splice(from, 1)
        ordered.splice(to, 0, moved)
        writeItems(ordered)
      }

      const resetScope = () => {
        if (scope === 'session' && selected === null) return
        if (scope === 'session' && selected !== null) {
          void configStore.write({ action: 'reset', scope: 'session', sessionId: selected }, (doc) => {
            const sessions = { ...doc.sessions }
            delete sessions[selected]
            return { ...doc, sessions }
          })
          return
        }
        void configStore.write({ action: 'reset', scope: 'global' }, (doc) => ({
          ...doc,
          global: { items: [], takeover: true, updatedAt: Date.now() },
        }))
      }

      const toggleTakeover = () => {
        if (config === null) return
        const takeover = config.global.takeover === false
        void configStore.write({ action: 'set', scope: 'global', items: config.global.items, takeover }, (doc) => ({
          ...doc,
          global: { ...doc.global, takeover, updatedAt: Date.now() },
        }))
      }

      const filteredSessions = useMemo(() => {
        const needle = search.trim().toLowerCase()
        const list = []
        for (const id of catalog.ids) {
          const summary = catalog.byId[id]
          if (summary === undefined || summary.archived === true) continue
          const title = typeof summary.title === 'string' && summary.title.trim() !== '' ? summary.title : id
          if (needle !== '' && !title.toLowerCase().includes(needle) && !id.toLowerCase().includes(needle)) continue
          list.push({ id, title, cwd: summary.cwd, running: summary.running === true })
        }
        list.sort((left, right) => Number(right.running) - Number(left.running))
        return list.slice(0, 60)
      }, [catalog, search])

      const builtinOwners = { 'dsh-session-stars': ['star'], 'dsh-session-todos': ['todo'] }
      const pluginRows = useMemo(() => {
        if (config === null) return []
        const active = activeClientIds(ctx)
        const owners = new Map()
        for (const entry of Object.values(config.actions)) {
          if (typeof entry.owner !== 'string' || entry.owner === '') continue
          if (!owners.has(entry.owner)) owners.set(entry.owner, [])
          owners.get(entry.owner).push(entry.id)
        }
        const rank = { builtin: 0, registered: 1, candidate: 2, inactive: 3 }
        const source = pluginScan.rows.length > 0
          ? pluginScan.rows
          : active !== null ? [...active].map((id) => ({ name: id, client: true })) : []
        return source
          .filter((row) => row !== null && typeof row === 'object' && row.client === true
            && row.name !== 'dsh-session-quickbar' && !String(row.name).startsWith('@deepseek-ai/'))
          .map((row) => {
            const builtin = builtinOwners[row.name] ?? []
            const registered = owners.get(row.name) ?? []
            const status = builtin.length > 0
              ? 'builtin'
              : registered.length > 0
                ? 'registered'
                : active !== null && !active.has(row.name) ? 'inactive' : 'candidate'
            return {
              name: String(row.name),
              version: typeof row.version === 'string' ? row.version : '',
              description: typeof row.description === 'string' ? row.description : '',
              status,
              actions: builtin.length > 0 ? builtin : registered,
            }
          })
          .sort((left, right) => rank[left.status] - rank[right.status] || left.name.localeCompare(right.name))
      }, [config, pluginScan.rows, ctx])

      if (state.status === 'error') {
        return h('section', { className: 'sq-page' },
          h('div', { className: 'sq-scroll' }, h('p', { className: 'sq-note' }, t('page.loadError'))))
      }
      if (config === null) {
        return h('section', { className: 'sq-page' }, h('div', { className: 'sq-scroll' }, h('p', { className: 'sq-note' }, '…')))
      }

      const inherited = scope === 'session' && (selected === null || sessionEntry === undefined)
      const scopeNote = scope === 'global'
        ? t('page.subtitle')
        : selected === null
          ? t('page.pick')
          : sessionEntry === undefined ? t('page.inherit') : t('page.override')

      const sessionTitle = (id) => {
        const known = config.knownSessions[id]
        if (known !== undefined && typeof known.title === 'string' && known.title.trim() !== '') return known.title
        return shortId(id)
      }
      const statusTextOf = (status) => (status === 'builtin'
        ? t('page.pluginBuiltin')
        : status === 'registered'
          ? t('page.pluginRegistered')
          : status === 'inactive' ? t('page.pluginInactive') : t('page.pluginCandidate'))
      const messages = [...config.messages].slice(-20).reverse()
      const subscriptions = Object.entries(config.subscriptions)
      const pendingBySession = new Map()
      for (const message of config.messages) {
        if (message.deliveredAt !== 0) continue
        const entry = pendingBySession.get(message.to)
        if (entry === undefined) pendingBySession.set(message.to, { sessionId: message.to, count: 1, oldestAt: message.at })
        else {
          entry.count += 1
          entry.oldestAt = Math.min(entry.oldestAt, message.at)
        }
      }
      const pendingRows = [...pendingBySession.values()].sort((left, right) => left.oldestAt - right.oldestAt)

      return h('section', { className: 'sq-page' },
        h('header', { className: 'sq-head' },
          h('div', null,
            h('h1', { className: 'sq-title' }, t('page.title')),
            h('p', { className: 'sq-sub' }, scopeNote)),
          h('div', { className: 'sq-mode', role: 'tablist' },
            h('button', {
              type: 'button',
              role: 'tab',
              'data-on': scope === 'global' ? 'true' : 'false',
              'aria-selected': scope === 'global',
              onClick: () => setScope('global'),
            }, t('page.global')),
            h('button', {
              type: 'button',
              role: 'tab',
              'data-on': scope === 'session' ? 'true' : 'false',
              'aria-selected': scope === 'session',
              onClick: () => setScope('session'),
            }, t('page.session')))),
        h('div', { className: 'sq-scroll' },
          scope === 'session' ? h('div', { className: 'sq-card' },
            h('div', { className: 'sq-cardhead' },
              h('h2', { className: 'sq-cardtitle' }, t('page.pick')),
              h('input', {
                className: 'sq-search',
                type: 'search',
                placeholder: t('page.search'),
                value: search,
                onChange: (event) => setSearch(event.target.value),
              })),
            h('div', { className: 'sq-picker' },
              filteredSessions.length === 0
                ? h('p', { className: 'sq-note' }, t('page.search'))
                : filteredSessions.map((row) => h('button', {
                  key: row.id,
                  type: 'button',
                  className: 'sq-pick',
                  'data-on': row.id === selected ? 'true' : undefined,
                  onClick: () => setSelected(row.id),
                },
                  row.running ? h('span', { className: 'sq-dot', 'aria-hidden': 'true' }) : null,
                  h('span', { className: 'sq-pick-title' }, row.title),
                  h('span', { className: 'sq-pick-meta' }, baseName(row.cwd ?? ''))))))
            : null,
          h('div', { className: 'sq-card' },
            h('div', { className: 'sq-cardhead' },
              h('h2', { className: 'sq-cardtitle' }, t('page.actions')),
              h('span', { className: 'sq-note' }, t('page.count', { n: rows.filter((row) => row.visible).length }))),
            scope === 'global' ? h('div', { className: 'sq-switch' },
              h('input', {
                type: 'checkbox',
                checked: config.global.takeover !== false,
                'aria-label': t('page.takeover'),
                onChange: toggleTakeover,
              }),
              h('label', { className: 'sq-note' }, t('page.takeover') + ' — ' + t('page.takeoverHint'))) : null,
            scope === 'session' && selected === null
              ? h('p', { className: 'sq-note' }, t('page.pick'))
              : rows.length === 0
              ? h('p', { className: 'sq-note' }, t('page.empty'))
              : h('div', { className: 'sq-rows' }, rows.map((entry, index) => h(ActionRow, {
                key: entry.id,
                entry,
                index,
                total: rows.length,
                language,
                t,
                onToggle: toggle,
                onMove: move,
              })),
                h('p', { className: 'sq-note' }, t('page.actionsHint'))),
            h('div', { className: 'sq-footer' },
              h('div', { className: 'sq-toolbar' },
                h('button', { type: 'button', className: 'sq-btn-ghost', onClick: resetScope },
                  scope === 'session' ? t('page.resetSession') : t('page.reset')),
                inherited ? h('span', { className: 'sq-note' }, t('page.inherit')) : null),
              h('span', {
                className: 'sq-state',
                'data-error': state.error !== null ? 'true' : undefined,
              }, state.error !== null ? t('page.error') : state.saving ? t('page.saving') : t('page.saved')))),
          h('div', { className: 'sq-card' },
            h('div', { className: 'sq-cardhead' },
              h('h2', { className: 'sq-cardtitle' }, t('page.plugins')),
              h('div', { className: 'sq-toolbar' },
                h('span', { className: 'sq-note' }, t('page.pluginsCount', { n: pluginRows.length })),
                h('button', {
                  type: 'button',
                  className: 'sq-btn-ghost',
                  onClick: () => { void scanPlugins() },
                }, t('page.pluginsRefresh')))),
            h('p', { className: 'sq-note' }, t('page.pluginsHint')),
            pluginScan.status === 'error'
              ? h('p', { className: 'sq-note' }, t('page.pluginsError'))
              : pluginRows.length === 0
                ? h('p', { className: 'sq-note' }, pluginScan.status === 'restart' ? t('page.pluginsRestart') : t('page.pluginsEmpty'))
                : h('div', { className: 'sq-rows' }, pluginRows.map((row) => h('div', { key: row.name, className: 'sq-row' },
                  h('span', { className: 'sq-row-label' },
                    h('span', { className: 'sq-row-name' }, row.name + (row.version === '' ? '' : ' · ' + row.version)),
                    row.description === '' ? null : h('span', { className: 'sq-row-hint' }, row.description)),
                  h('span', {
                    className: 'sq-tag',
                    'data-state': row.status,
                    title: row.actions.length === 0 ? undefined : row.actions.join(', '),
                  }, statusTextOf(row.status))))),
            pluginScan.status === 'restart' && pluginRows.length > 0
              ? h('p', { className: 'sq-note' }, t('page.pluginsRestart'))
              : null,
            h('p', { className: 'sq-note' }, t('page.pluginsNote'))),
          h('div', { className: 'sq-card' },
            h('div', { className: 'sq-cardhead' },
              h('h2', { className: 'sq-cardtitle' }, t('page.channel')),
              h('span', { className: 'sq-note' }, t('page.channelHint'))),
            h('div', { className: 'sq-cardhead' },
              h('h3', { className: 'sq-cardtitle' }, t('page.pending')),
              h('span', { className: 'sq-note' }, pendingRows.length === 0 ? t('page.noPending') : t('page.pendingHint'))),
            pendingRows.length === 0
              ? null
              : h('div', { className: 'sq-rows' }, pendingRows.map((row) => h('div', { key: row.sessionId, className: 'sq-row' },
                h('span', { className: 'sq-badge' }, t('page.pendingBadge', { n: row.count })),
                h('span', { className: 'sq-row-label' },
                  h('span', { className: 'sq-row-name' }, sessionTitle(row.sessionId)),
                  h('span', { className: 'sq-row-hint' }, timeText(row.oldestAt)))))),
            h('div', { className: 'sq-cardhead' },
              h('h3', { className: 'sq-cardtitle' }, t('page.subscriptions')),
              h('span', { className: 'sq-note' }, String(subscriptions.length))),
            subscriptions.length === 0
              ? h('p', { className: 'sq-note' }, t('page.noSubscriptions'))
              : h('div', { className: 'sq-rows' }, subscriptions.map(([id, value]) => h('div', { key: id, className: 'sq-row' },
                h('span', { className: 'sq-row-label' },
                  h('span', { className: 'sq-row-name' }, sessionTitle(id)),
                  h('span', { className: 'sq-row-hint' }, (value.note ?? '') === '' ? timeText(value.since) : value.note))))),
            h('div', { className: 'sq-cardhead' },
              h('h3', { className: 'sq-cardtitle' }, t('page.messages')),
              h('span', { className: 'sq-note' }, t('page.messagesCount', { n: config.messages.length }))),
            messages.length === 0
              ? h('p', { className: 'sq-note' }, t('page.noMessages'))
              : messages.map((message) => h('div', { key: message.id, className: 'sq-message' },
                h('div', { className: 'sq-message-meta' },
                  h('span', null, sessionTitle(message.from)),
                  h('span', null, '→'),
                  h('span', null, sessionTitle(message.to)),
                  h('span', null, timeText(message.at)),
                  h('span', {
                    'data-state': message.deliveredAt === 0 ? 'queued' : 'delivered',
                    title: message.deliveredAt === 0 ? t('page.pendingHint') : t('page.delivered', { time: timeText(message.deliveredAt) }),
                  }, message.deliveredAt === 0 ? t('page.queued') : '✓')),
                h('div', { className: 'sq-message-text' }, message.text))),
            h('p', { className: 'sq-note' }, t('page.live')))))
    }

    /** The page's sidebar entry glyph, sized by the host panel seat. */
    function PanelIcon({ size = 18 }) {
      return h(IconSliders, { size })
    }

    /** The row-menu entry: opens the page on this Session. */
    function SessionMenuEntry({ ctx, sessionId, useMenuOpenState, deps }) {
      const t = useT(ctx)
      const useMenu = typeof useMenuOpenState === 'function' ? useMenuOpenState : () => [false, () => {}]
      const menu = useMenu()
      const setOpen = Array.isArray(menu) && typeof menu[1] === 'function' ? menu[1] : () => {}
      return h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'sq-menu-item',
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          openSettings(ctx, deps.panelIntent, sessionId)
        },
      }, h('span', { className: 'sq-row-icon' }, h(IconSliders)), h('span', { className: 'sq-row-label' },
        h('span', { className: 'sq-row-name' }, t('menu.label'))))
    }

    /** The archive confirmation dialog behind the bar's archive button. */
    function ArchiveDialog({ ctx, deps }) {
      const { confirm } = deps
      const request = useStore(confirm)
      const t = useT(ctx)
      const cardRef = useRef(null)
      useEffect(() => {
        if (request === null) return undefined
        const frame = requestAnimationFrame(() => {
          cardRef.current?.focus?.({ preventScroll: true })
        })
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          confirm.set(null)
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          cancelAnimationFrame(frame)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [request, confirm])
      if (request === null) return null
      const service = readService(ctx, 'uiWorkspace')
      return h(React.Fragment, null,
        h('div', { className: 'sq-backdrop', role: 'presentation', onClick: () => confirm.set(null) }),
        h('div', {
          className: 'sq-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('dialog.title'),
          tabIndex: -1,
          ref: cardRef,
        },
          h('h2', null, t('dialog.title')),
          h('p', null, t('dialog.body')),
          h('p', { className: 'sq-note' }, t('dialog.activity', { n: request.count })),
          h('div', { className: 'sq-dialog-actions' },
            h('button', { type: 'button', className: 'sq-btn-ghost', onClick: () => confirm.set(null) }, t('dialog.cancel')),
            h('button', {
              type: 'button',
              className: 'sq-primary',
              onClick: async () => {
                confirm.set(null)
                try {
                  await service?.archiveSession?.(request.sessionId, { stopActivity: true })
                } catch (error) {
                  console.warn('[session-quickbar] could not archive:', error)
                }
              },
            }, t('dialog.confirm')))))
    }

    /** Subscribe the page to the catalog. */
    function useCatalog(ctx) {
      const list = sessionCatalog(ctx)
      const [snapshot, setSnapshot] = useState(() => catalogSnapshot(list))
      useEffect(() => {
        if (list === undefined) return undefined
        const read = () => setSnapshot(catalogSnapshot(list))
        read()
        if (typeof list.subscribe !== 'function') return undefined
        const off = list.subscribe(read)
        return typeof off === 'function' ? off : undefined
      }, [list])
      return snapshot
    }

    /* ------------------------------------------------------------------ *
     * Client plugin
     * ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const configStore = createConfigStore()
        const ratings = createRatingsStore()
        const todos = createTodosStore()
        const notify = createNotifyStore()
        const token = createTokenStore()
        const boxes = createBoxesStore()
        const popover = createStore(null)
        const registry = createRegistry()
        registry.versionStore = createStore(0)
        registry.subscribe(() => registry.versionStore.set((value) => value + 1))
        const confirm = createStore(null)
        const panelIntent = createStore(null)
        const workspaces = readService(ctx, 'workspaces')
        const deps = { configStore, registry, ratings, todos, notify, token, boxes, popover, confirm, panelIntent, workspaces }

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin-css', 'dsh-session-quickbar/QuickBar.css')
          style.textContent = CSS + '\n' + SUPPRESS_CSS
          document.head.appendChild(style)
          return () => {
            style.remove()
          }
        }, 'session-quickbar: styles')

        ctx.effect(() => ctx.locale.register(NS, LOCALES), 'session-quickbar: dictionaries')

        ctx.effect(() => {
          const refresh = () => {
            if (document.visibilityState === 'hidden') return
            void configStore.refresh()
            void ratings.refresh()
            void todos.refresh()
            void notify.refresh()
          void token.refresh()
          void boxes.refresh()
            void token.refresh()
            void boxes.refresh()
          }
          window.addEventListener('focus', refresh)
          document.addEventListener('visibilitychange', refresh)
          void configStore.refresh()
          void ratings.refresh()
          void todos.refresh()
          void notify.refresh()
          void token.refresh()
          void boxes.refresh()
          return () => {
            window.removeEventListener('focus', refresh)
            document.removeEventListener('visibilitychange', refresh)
          }
        }, 'session-quickbar: layout sync')

        ctx.effect(() => {
          if (typeof EventSource !== 'function') return undefined
          const sources = []
          const listen = (url, event, apply) => {
            const source = new EventSource(url)
            const handler = (payload) => {
              try {
                const data = JSON.parse(payload.data)
                if (data?.ok === true) apply(data)
              } catch {
                /* a malformed push is ignored; the next one or a focus refresh repairs it */
              }
            }
            const onError = () => {}
            source.addEventListener(event, handler)
            source.addEventListener('error', onError)
            sources.push({ source, event, handler, onError })
          }
          listen(EVENTS, 'config', (data) => configStore.applyServer(data.config))
          listen(STARS_EVENTS, 'ratings', (data) => ratings.applyServer(data.ratings))
          listen(TODOS_EVENTS, 'todos', (data) => todos.applyServer(data.todos))
          listen(NOTIFY_EVENTS, 'watched', (data) => notify.applyServer(data.watched))
          return () => {
            for (const entry of sources) {
              entry.source.removeEventListener(entry.event, entry.handler)
              entry.source.removeEventListener('error', entry.onError)
              entry.source.close()
            }
          }
        }, 'session-quickbar: live sync')

        // The public contract for other client plugins.
        ctx.effect(() => {
          const api = {
            version: API_VERSION,
            register: (descriptor) => registry.register(descriptor),
            unregister: (id) => registry.unregister(id),
            list: () => registry.list().map((descriptor) => ({ id: descriptor.id, labels: descriptor.labels ?? {}, order: descriptor.order ?? 500 })),
            token: registry,
          }
          const previous = window.dshSessionQuickbar
          window.dshSessionQuickbar = api
          return () => {
            if (window.dshSessionQuickbar === api) {
              if (previous === undefined) delete window.dshSessionQuickbar
              else window.dshSessionQuickbar = previous
            }
          }
        }, 'session-quickbar: action registry')

        // Built-in actions ride the same registry as plugin-contributed ones.
        ctx.effect(() => {
          const builtins = [
            { id: 'star', order: 10, hiddenByDefault: true, labels: { zh: '星标', en: 'Star' }, hint: { zh: '给这个会话打星标（复用会话星标插件的数据）', en: 'Star this session (uses the session-stars plugin data)' } },
            { id: 'todo', order: 20, labels: { zh: '待办', en: 'Todo' }, hint: { zh: '勾选这个会话的待办（复用会话待办插件的数据）', en: 'Check this session todo (uses the session-todos plugin data)' } },
            { id: 'archive', order: 30, hiddenByDefault: true, labels: { zh: '归档', en: 'Archive' }, hint: { zh: '归档或取消归档这个会话', en: 'Archive or unarchive this session' } },
            { id: 'pin', order: 40, hiddenByDefault: true, labels: { zh: '置顶', en: 'Pin' }, hint: { zh: '置顶或取消置顶这个会话', en: 'Pin or unpin this session' } },
            { id: 'copy-id', order: 50, hiddenByDefault: true, labels: { zh: '复制 ID', en: 'Copy ID' }, hint: { zh: '复制这个会话的 ID', en: 'Copy this session id' } },
            { id: 'notify', order: 60, labels: { zh: '完成提醒', en: 'Finish alert' }, hint: { zh: '这个会话结束时在右下角弹出提醒（复用会话提醒插件）', en: 'Show a desktop card when this session finishes (uses the session-notify plugin)' } },
            { id: 'pack', order: 70, hiddenByDefault: true, labels: { zh: '打包', en: 'Pack' }, hint: { zh: '把这个会话打包成可移植文件（复用会话迁移插件）', en: 'Pack this session into a portable file (uses the session-transfer plugin)' } },
            { id: 'token', order: 80, hiddenByDefault: true, labels: { zh: '用量', en: 'Usage' }, hint: { zh: '这个会话的 token 用量，点开看明细（复用 Token 用量插件）', en: 'Token usage for this session, click for the breakdown (uses the token-usage plugin)' } },
            { id: 'boxes', order: 90, hiddenByDefault: true, labels: { zh: '盒子', en: 'Boxes' }, hint: { zh: '把这个会话放进分组盒子（复用会话盒子插件）', en: 'Put this session into a group box (uses the session-boxes plugin)' } },
          ]
          const disposers = builtins.map((descriptor) => registry.register({ ...descriptor, builtin: true }))
          return () => {
            for (const dispose of disposers) dispose()
          }
        }, 'session-quickbar: built-in actions')

        const Bar = (props) => h(QuickBar, { ...props, deps, ctx })
        const Page = (props) => h(QuickbarPage, { ...props, deps, ctx })
        const MenuItem = (props) => h(SessionMenuEntry, { ...props, deps, ctx })
        const Dialog = (props) => h(ArchiveDialog, { ...props, deps, ctx })
        const Popover = (props) => h(QuickbarPopover, { ...props, deps, ctx })
        const Icon = (props) => h(PanelIcon, props)
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.row.action',
          id: 'session-quickbar',
          order: 40,
          locale: NS,
        }, Bar))

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'session-quickbar-menu',
          order: 200,
          locale: NS,
        }, MenuItem))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, Page))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 7,
          label: () => t('panel'),
          locale: NS,
        }, Icon))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-quickbar-dialog',
          order: 60,
          locale: NS,
        }, Dialog))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-quickbar-popover',
          order: 61,
          locale: NS,
        }, Popover))
      },
    }
  },
})
