/**
 * dsh-model-menu-search 冒烟测试：用最小假 DOM 跑真实的 lib/client.js。
 *
 * 覆盖：
 *   场景 1  主流程：挂载、样式、菜单识别（故意用哈希类名）、插入位置、高度夹取、
 *           匹配语法、空状态、清空、键盘导航、被 React 抹掉后自愈、重排后无需滚动即重新夹取
 *   场景 2  空 DOM（完全没有菜单）不抛错
 *   场景 3  菜单先出现、模型行后到（菜单内部发生 childList 变化）→ 无需滚动即挂上
 *   场景 4  菜单先出现、模型行后到且"没有任何 DOM 事件" → 兜底轮询也要挂上
 *
 * 场景 3/4 就是 "每次打开列表要滚一下鼠标才有搜索框" 的回归用例。
 *
 * 运行：node test/dom-smoke.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

// ── 最小 DOM ────────────────────────────────────────────────────────────────
class El {
  constructor(tag = 'div') {
    this.nodeType = 1          // 真实 DOM 元素就是 1；缺了它会让"相关性判断"全部失败
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parent = null
    this.attrs = Object.create(null)
    this.style = {}
    this.textContent = ''
    this._listeners = Object.create(null)
    this.clicked = 0
    this.__rect = null
  }
  get className() { return this.attrs.class || '' }
  set className(v) { this.attrs.class = String(v) }
  get parentNode() { return this.parent }
  get id() { return this.attrs.id || '' }
  set id(v) { this.attrs.id = String(v) }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null }
  appendChild(c) { c.parent = this; this.children.push(c); return c }
  insertBefore(c, ref) {
    c.parent = this
    const i = ref ? this.children.indexOf(ref) : -1
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c)
    return c
  }
  remove() {
    if (!this.parent) return
    const i = this.parent.children.indexOf(this)
    if (i >= 0) this.parent.children.splice(i, 1)
    this.parent = null
  }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n.__root === true }
  get firstChild() { return this.children[0] || null }
  get firstElementChild() { return this.children[0] || null }
  get nextSibling() {
    if (!this.parent) return null
    const i = this.parent.children.indexOf(this)
    return this.parent.children[i + 1] || null
  }
  descendants(out = []) {
    for (const c of this.children) { out.push(c); c.descendants(out) }
    return out
  }
  querySelectorAll(sel) { return this.descendants().filter((el) => matchesSelector(el, sel)) }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  closest(sel) { let n = this; while (n) { if (matchesSelector(n, sel)) return n; n = n.parent } return null }
  matches(sel) { return matchesSelector(this, sel) }
  addEventListener(t, f) { (this._listeners[t] ||= []).push(f) }
  dispatch(t, ev = {}) {
    for (const f of this._listeners[t] || []) f({ preventDefault() {}, stopPropagation() {}, ...ev })
  }
  focus() { doc.activeElement = this }
  click() { this.clicked++; this.dispatch('click') }
  dispatchEvent() { return true }
  getBoundingClientRect() {
    const r = this.__rect || { top: 100, bottom: 300, height: 200, left: 0, width: 240 }
    return { ...r, right: r.left + (r.width || 0), x: r.left, y: r.top }
  }
}

function compound(sel) {
  const parts = []
  const re = /(\[[^\]]+\])|(\.[A-Za-z0-9_-]+)|([A-Za-z][A-Za-z0-9-]*)/g
  let m
  while ((m = re.exec(sel))) parts.push(m[0])
  return parts
}
function matchCompound(el, comp) {
  for (const p of compound(comp)) {
    if (p.startsWith('[')) {
      const mm = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(p)
      if (!mm) return false
      const v = el.getAttribute(mm[1])
      if (v === null) return false
      if (mm[2] !== undefined && v !== mm[2]) return false
    } else if (p.startsWith('.')) {
      if (!` ${el.className} `.includes(` ${p.slice(1)} `)) return false
    } else if (el.tagName !== p.toUpperCase()) return false
  }
  return true
}
function matchesSelector(el, sel) {
  return sel.split(',').map((s) => s.trim().split(/\s+/)).some((chain) => {
    if (!matchCompound(el, chain[chain.length - 1])) return false
    let node = el.parent
    for (let i = chain.length - 2; i >= 0; i--) {
      let found = false
      while (node) { if (matchCompound(node, chain[i])) { found = true; node = node.parent; break } node = node.parent }
      if (!found) return false
    }
    return true
  })
}

// ── 环境工厂 ────────────────────────────────────────────────────────────────
const PARAMS = [
  'window', 'document', 'MutationObserver', 'ResizeObserver', 'requestAnimationFrame',
  'setInterval', 'clearInterval', 'setTimeout', 'console', 'navigator',
  'KeyboardEvent', 'getComputedStyle', 'module',
]
let doc = null   // 当前环境（供 El.focus 用）

function makeEnv({ lang = 'zh-CN' } = {}) {
  const d = new El('html')
  d.__root = true
  d.head = d.appendChild(new El('head'))
  d.body = d.appendChild(new El('body'))
  d.documentElement = d
  d.activeElement = null
  d.createElement = (t) => new El(t)
  d.getElementById = (id) => d.descendants().find((el) => el.getAttribute('id') === id) || null
  d.addEventListener = () => {}

  const env = { timers: [], observers: [], document: d, doc: d }
  env.window = { innerHeight: 800, addEventListener: () => {}, __ModuleLoader__: { load: (r) => { env.registration = r } } }
  env.MutationObserver = class {
    constructor(cb) { this.cb = cb; env.observers.push(this) }
    observe() {}
    disconnect() {}
    emit(mutations) { this.cb(mutations, this) }
  }
  env.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  env.requestAnimationFrame = (f) => { f(); return 0 }
  env.setInterval = (fn) => { env.timers.push(fn); return env.timers.length }
  env.clearInterval = (id) => { if (id > 0) env.timers[id - 1] = null }
  env.setTimeout = (f) => { f(); return 0 }
  env.console = console
  env.navigator = { language: lang }
  env.KeyboardEvent = class { constructor(t, o) { Object.assign(this, o) } }
  env.getComputedStyle = () => ({ position: 'fixed' })
  env.module = undefined
  env.load = () => new Function(...PARAMS, src)(...PARAMS.map((p) => env[p]))
  env.plugin = () => { env.load(); return env.registration.factory() }
  /** 手动推进兜底轮询的定时器。 */
  env.tick = (n = 1) => { for (let i = 0; i < n; i++) for (const fn of [...env.timers]) if (fn) fn() }
  return env
}

const results = []
const check = (name, ok, extra = '') => { results.push([name, !!ok, extra]); }

function row(label) {
  const b = new El('button')
  b.setAttribute('role', 'menuitemradio')
  b.setAttribute('title', label)
  b.textContent = label
  return b
}
function section(groupId, groupName, rows) {
  const s = new El('section')
  s.setAttribute('role', 'group')
  s.setAttribute('aria-labelledby', `hd-${groupId}`)
  const title = new El('div')
  title.setAttribute('id', `hd-${groupId}`)
  title.textContent = groupName
  s.appendChild(title)
  for (const r of rows) s.appendChild(r)
  return s
}
function newMenu(d) {
  const menu = d.body.appendChild(new El('div'))
  menu.className = 'IecIca_menu'          // 故意用哈希类名：证明不依赖它
  menu.setAttribute('role', 'menu')
  return menu
}

// ═══ 场景 1：主流程 ════════════════════════════════════════════════════════
const env = makeEnv()
doc = env.doc
const d1 = env.doc

const menu = newMenu(d1)
const groupsBox = menu.appendChild(new El('div'))
groupsBox.className = 'IecIca_groups scrollable'
groupsBox.appendChild(section('deepseek', 'DeepSeek', [row('DeepSeek-V41-Flash'), row('DeepSeek-V4-Pro')]))
groupsBox.appendChild(section('bailian', 'bailian', [row('qwen3.8-omni-flash-realtime'), row('glm-5.3-prime')]))
menu.__rect = { top: -120, bottom: 780, height: 900, left: 0, width: 240 }  // 比视口还高、顶部已在视口外

const plugin = env.plugin()
check('注册了 __ModuleLoader__.load', !!env.registration && env.registration.id === 'dsh-model-menu-search')
check('factory 返回 apply/inject', typeof plugin.apply === 'function' && Array.isArray(plugin.inject))

let threw = null
try { plugin.apply() } catch (e) { threw = e }
check('apply() 不抛错', threw === null, threw ? String(threw) : '')
check('注入了样式元素', !!d1.getElementById('dsh-mms-styles'))

const wrap = menu.firstChild
check('搜索框插在菜单最顶部', !!wrap && String(wrap.className).includes('dsh-mms-wrap'))
const input = wrap && wrap.querySelector('input')
check('搜索框里有 input', !!input)
check('调试入口已挂到 window', typeof env.window.__dshModelMenuSearch?.menus === 'function')

check('超高的菜单被夹进视口：maxHeight 生效', menu.style.maxHeight === '776px', `maxHeight=${menu.style.maxHeight}`)
check('超高的菜单 top 被拉回 12px', menu.style.top === '12px', `top=${menu.style.top}`)
check('夹取时开了内部滚动', menu.style.overflowY === 'auto', `overflowY=${menu.style.overflowY}`)

const items = menu.querySelectorAll('[role="menuitemradio"]')
const visibleRows = () => items.filter((el) => el.style.display !== 'none')
const visibleGroups = () => menu.querySelectorAll('[role="group"]').filter((el) => el.style.display !== 'none')

check('初始全部可见（4 行）', visibleRows().length === 4, `visible=${visibleRows().length}`)

input.value = 'glm53'; input.dispatch('input')
check('归一化子串 glm53 命中 glm-5.3-prime', visibleRows().length === 1 && visibleRows()[0].getAttribute('title') === 'glm-5.3-prime',
  visibleRows().map((r) => r.getAttribute('title')).join('|'))
check('无匹配的分组被隐藏', visibleGroups().length === 1)

input.value = 'dsv41f'; input.dispatch('input')
check('子序列 dsv41f 命中 DeepSeek-V41-Flash', visibleRows().length === 1 && visibleRows()[0].getAttribute('title') === 'DeepSeek-V41-Flash',
  visibleRows().map((r) => r.getAttribute('title')).join('|'))

input.value = '@bailian'; input.dispatch('input')
check('@bailian 只留 bailian 组', visibleRows().length === 2 && visibleGroups().length === 1)

input.value = '@bailian qwen'; input.dispatch('input')
check('@bailian qwen 命中 1 行', visibleRows().length === 1 && visibleRows()[0].getAttribute('title') === 'qwen3.8-omni-flash-realtime')

input.value = 'zzzz-not-exist'; input.dispatch('input')
check('无匹配时显示空状态', visibleRows().length === 0 && wrap.nextSibling.style.display !== 'none')

input.value = 'glm'; input.dispatch('input')
wrap.querySelector('button').dispatch('click')
check('清空按钮恢复全部', visibleRows().length === 4, `visible=${visibleRows().length}`)

input.value = 'bailian'; input.dispatch('input')
const vis = visibleRows()
input.dispatch('keydown', { key: 'ArrowDown' })
check('ArrowDown 聚焦第一个可见行', d1.activeElement === vis[0])
input.dispatch('keydown', { key: 'ArrowDown' })
check('再按 ArrowDown 聚焦第二个可见行', d1.activeElement === vis[1])
input.dispatch('keydown', { key: 'Enter' })
check('Enter 点击了当前可见行', vis[1].clicked === 1, `clicked=${vis[1].clicked}`)

// 回归 1：React 重渲染抹掉搜索框后能自愈
menu.firstChild.remove()
check('（前置）搜索框已被移除', !menu.querySelector('.dsh-mms-wrap'))
env.window.__dshModelMenuSearch.scan()
check('回归1：被抹掉后 scan() 能重建搜索框',
  !!menu.querySelector('.dsh-mms-wrap') && String(menu.firstChild.className).includes('dsh-mms-wrap'),
  String(menu.firstChild && menu.firstChild.className))

// 回归 2：原生 place() 用更高的菜单高度重算出负 top，无需滚动即可修正
menu.style.top = ''
menu.style.maxHeight = ''
menu.__rect = { top: -300, bottom: 600, height: 900, left: 0, width: 240 }
env.window.__dshModelMenuSearch.scan()
check('回归2：重排后无需滚动即重新夹取 top', menu.style.top === '12px', `top=${menu.style.top}`)
check('回归2：重排后 maxHeight 重新生效', menu.style.maxHeight === '776px', `maxHeight=${menu.style.maxHeight}`)

menu.style.top = ''
menu.style.maxHeight = ''
menu.__rect = { top: 120, bottom: 520, height: 400, left: 0, width: 240 }
env.window.__dshModelMenuSearch.scan()
check('菜单不溢出时不干预（不设 top/maxHeight）', !menu.style.top && !menu.style.maxHeight,
  `top=${menu.style.top} maxHeight=${menu.style.maxHeight}`)

// ═══ 场景 2：空 DOM 不抛错 ═════════════════════════════════════════════════
{
  const e2 = makeEnv()
  doc = e2.doc
  let t2 = null
  try { e2.plugin().apply() } catch (err) { t2 = err }
  check('空 DOM（没有菜单）下也不抛错', t2 === null, t2 ? String(t2) : '')
  check('空 DOM 下不留下定时器', e2.timers.filter(Boolean).length === 0)
}

// ═══ 场景 3：菜单先在、模型行后到（菜单内部发生 childList 变化）═══════════
{
  const e3 = makeEnv()
  doc = e3.doc
  const d3 = e3.doc
  e3.plugin().apply()
  const bodyObserver = e3.observers[0]

  // 菜单出现，但里面还停在「模型 / 推理档位」这一层 —— 没有任何 menuitemradio
  const m3 = newMenu(d3)
  bodyObserver.emit([{ target: d3.body, addedNodes: [m3], removedNodes: [] }])
  check('场景3：行还没来时不抢先插搜索框', !m3.querySelector('.dsh-mms-wrap'))

  // 用户点了「模型」，或目录加载完成 —— 行在菜单内部被渲染出来。
  // 注意：新增的节点本身（div/section/button）都"不像菜单"。
  const g3 = m3.appendChild(new El('div'))
  g3.className = 'x_groups'
  const s3 = g3.appendChild(section('p', 'P', [row('Model-A'), row('Model-B')]))
  bodyObserver.emit([{ target: g3, addedNodes: [s3], removedNodes: [] }])

  check('场景3：行出现后无需滚动即挂上搜索框', !!m3.querySelector('.dsh-mms-wrap'),
    `wrap=${!!m3.querySelector('.dsh-mms-wrap')}`)
  check('场景3：挂上后立即可用（输入能过滤）', (() => {
    const i3 = m3.querySelector('input')
    if (!i3) return false
    i3.value = 'Model-B'
    i3.dispatch('input')
    const vis3 = m3.querySelectorAll('[role="menuitemradio"]').filter((el) => el.style.display !== 'none')
    return vis3.length === 1 && vis3[0].getAttribute('title') === 'Model-B'
  })())
}

// ═══ 场景 4：菜单先在、行后到，且没有任何 DOM 事件 → 兜底轮询 ══════════════
{
  const e4 = makeEnv()
  doc = e4.doc
  const d4 = e4.doc
  e4.plugin().apply()
  const m4 = newMenu(d4)
  e4.observers[0].emit([{ target: d4.body, addedNodes: [m4], removedNodes: [] }])
  check('场景4：行没来时已排好兜底轮询', e4.timers.filter(Boolean).length > 0,
    `timers=${e4.timers.filter(Boolean).length}`)

  // 行出现，但故意不发任何 DOM 事件（模拟观察器抓不到的时序）
  const g4 = m4.appendChild(new El('div'))
  g4.className = 'x_groups'
  g4.appendChild(section('p', 'P', [row('Model-A'), row('Model-B')]))
  check('场景4：（前置）此刻还没挂上', !m4.querySelector('.dsh-mms-wrap'))

  e4.tick(3)
  check('场景4：兜底轮询在无需滚动的情况下挂上了搜索框', !!m4.querySelector('.dsh-mms-wrap'))
  check('场景4：挂上后轮询自动停止（不再空转）', e4.timers.filter(Boolean).length === 0,
    `alive=${e4.timers.filter(Boolean).length}`)
}

// ═══ 场景 5：推理档位面板不能被当成模型列表（它的行没有 title）═════════════
{
  const e5 = makeEnv()
  doc = e5.doc
  const d5 = e5.doc
  e5.plugin().apply()
  const m5 = newMenu(d5)
  // 原生「推理档位 / 推理等级」面板：若干 button[role=menuitemradio] 直接挂在
  // 菜单下，既没有 role=group，也没有 title —— 与模型行的区别就在这里。
  for (const label of ['供应商默认', 'low', 'medium', 'high', 'max']) {
    const b = new El('button')
    b.setAttribute('role', 'menuitemradio')
    b.textContent = label
    m5.appendChild(b)
  }
  e5.window.__dshModelMenuSearch.scan()
  const wraps5 = d5.querySelectorAll('.dsh-mms-wrap')
  check('场景5：推理档位面板里不插搜索框', wraps5.length === 0, `wraps=${wraps5.length}`)
  check('场景5：推理档位面板没被识别成模型菜单', e5.window.__dshModelMenuSearch.menus().length === 0)
}

// ═══ 场景 6：模型面板 ↔ 推理档位面板来回切，永远只有 1 个搜索框 ═════════════
{
  const e6 = makeEnv()
  doc = e6.doc
  const d6 = e6.doc
  e6.plugin().apply()
  const bodyObs6 = e6.observers[0]
  const m6 = newMenu(d6)
  const g6 = m6.appendChild(new El('div'))
  g6.className = 'x_groups'
  g6.appendChild(section('p', 'P', [row('Model-A'), row('Model-B')]))
  bodyObs6.emit([{ target: d6.body, addedNodes: [m6], removedNodes: [] }])
  check('场景6：模型面板挂上且只有 1 个搜索框', d6.querySelectorAll('.dsh-mms-wrap').length === 1,
    `wraps=${d6.querySelectorAll('.dsh-mms-wrap').length}`)

  // 用户点进「推理档位」：模型列表被卸载，换成 5 个没有 title 的行
  g6.remove()
  for (const label of ['low', 'medium', 'high', 'max', 'xhigh']) {
    const b = new El('button')
    b.setAttribute('role', 'menuitemradio')
    b.textContent = label
    m6.appendChild(b)
  }
  bodyObs6.emit([{ target: m6, addedNodes: [], removedNodes: [g6] }])
  const w6 = d6.querySelectorAll('.dsh-mms-wrap')
  check('场景6：切到推理档位后不是 5 个搜索框，仍然只有 1 个', w6.length === 1, `wraps=${w6.length}`)
  check('场景6：切到推理档位后搜索框被隐藏', w6.length > 0 && w6[0].style.display === 'none',
    `display=${w6[0] && w6[0].style.display}`)

  // 切回模型列表：搜索框应重新出现且仍只有 1 个
  for (const el of [...m6.children]) el.remove()
  const g6b = m6.appendChild(new El('div'))
  g6b.className = 'x_groups'
  g6b.appendChild(section('q', 'Q', [row('Model-C'), row('Model-D')]))
  bodyObs6.emit([{ target: m6, addedNodes: [g6b], removedNodes: [] }])
  const w6b = d6.querySelectorAll('.dsh-mms-wrap')
  check('场景6：切回模型列表后搜索框恢复且仍只有 1 个', w6b.length === 1 && w6b[0].style.display !== 'none',
    `wraps=${w6b.length} display=${w6b[0] && w6b[0].style.display}`)
}

// ═══ 场景 7：散落的搜索框节点会被清理（硬不变量）══════════════════════════
{
  const e7 = makeEnv()
  doc = e7.doc
  const d7 = e7.doc
  e7.plugin().apply()
  const m7 = newMenu(d7)
  const g7 = m7.appendChild(new El('div'))
  g7.className = 'x_groups'
  g7.appendChild(section('p', 'P', [row('Model-A'), row('Model-B')]))
  e7.observers[0].emit([{ target: d7.body, addedNodes: [m7], removedNodes: [] }])
  check('场景7：（前置）正常是 1 个', d7.querySelectorAll('.dsh-mms-wrap').length === 1)

  // 模拟"被插了 5 次"的意外：手工塞 4 个野节点进去
  for (let i = 0; i < 4; i++) {
    const stray = new El('div')
    stray.className = 'dsh-mms-wrap'
    m7.appendChild(stray)
  }
  check('场景7：（前置）现在有 5 个', d7.querySelectorAll('.dsh-mms-wrap').length === 5)
  e7.window.__dshModelMenuSearch.scan()
  check('场景7：扫描后野节点被清掉，只剩受管的 1 个', d7.querySelectorAll('.dsh-mms-wrap').length === 1,
    `wraps=${d7.querySelectorAll('.dsh-mms-wrap').length}`)
}

// ═══ 场景 8：隐藏的残留菜单不该被挂钩 ══════════════════════════════════════
{
  const e8 = makeEnv()
  doc = e8.doc
  const d8 = e8.doc
  e8.plugin().apply()
  const hidden = newMenu(d8)              // 没有尺寸 = 隐藏残留
  hidden.__rect = { top: 0, bottom: 0, height: 0, left: 0, width: 0 }
  const gh = hidden.appendChild(new El('div'))
  gh.className = 'x_groups'
  gh.appendChild(section('p', 'P', [row('Model-A'), row('Model-B')]))
  const visible = newMenu(d8)
  const gv = visible.appendChild(new El('div'))
  gv.className = 'x_groups'
  gv.appendChild(section('q', 'Q', [row('Model-C'), row('Model-D')]))
  e8.window.__dshModelMenuSearch.scan()
  check('场景8：只给可见菜单挂钩（隐藏残留被跳过）',
    d8.querySelectorAll('.dsh-mms-wrap').length === 1 && !!visible.querySelector('.dsh-mms-wrap'),
    `wraps=${d8.querySelectorAll('.dsh-mms-wrap').length}`)
}

// ── 结果 ────────────────────────────────────────────────────────────────────
let failed = 0
for (const [name, ok, extra] of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra && !ok ? '   → ' + extra : ''}`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
