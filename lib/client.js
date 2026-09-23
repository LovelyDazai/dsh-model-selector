/**
 * dsh-model-menu-search — 浏览器半边。
 *
 * 给 DSH WebUI 的**模型下拉菜单**注入一个实时搜索框。做法是纯 DOM 增强：
 * 找到已经渲染出来的菜单，在它顶部插入一个输入框，按输入内容隐藏不匹配的模型行。
 *
 * ── 为什么这样写（针对“DSH 怎么更新都能用”）────────────────────────────────
 * 1. **不抢 slot、不改共享服务。** 不去注册 `conversation.input.model` 座位，
 *    也不去包装 `modelDirectories`/`directory.select`。宿主内部服务改名/改签名
 *    都不会波及这里。
 * 2. **只用语义化 DOM 特征。** 定位靠 `role="menu"` / `role="group"` /
 *    `role="menuitemradio"` 这些 ARIA 属性，不依赖任何哈希类名
 *    （实测 DSH 的 CSS Module 类名是 `IecIca_menu` 这种随构建变化的）。
 *    并且准备了三层退化策略，最坏情况也能从模型行反推容器。
 * 3. **零 import、零 peer 依赖。** 不 require 任何 `@deepseek-ai/*` 包。
 * 4. **绝不抛错。** 每一步都有 try/catch，失败只 console.warn，
 *    避免把一个纯装饰插件变成拖垮插件树的故障源。
 * 5. **保证可见。** 原生菜单是贴着输入框往上弹的，菜单过高时顶部会被顶出
 *    窗口外——而搜索框恰好插在顶部。所以插入后会把菜单高度夹到视口内。
 * 6. **全程日志。** 前缀 `[dsh-model-menu-search]`，卡在哪一步一眼可见。
 */

window.__ModuleLoader__.load({
  id: 'dsh-model-menu-search',
  factory: () => {
    const TAG = '[dsh-model-menu-search]'
    const STYLE_ID = 'dsh-mms-styles'
    const WRAP_CLASS = 'dsh-mms-wrap'
    const INPUT_CLASS = 'dsh-mms-input'
    const CLEAR_CLASS = 'dsh-mms-clear'
    const EMPTY_CLASS = 'dsh-mms-empty'

    const log = (...a) => { try { console.log(TAG, ...a) } catch { /* ignore */ } }
    const warn = (...a) => { try { console.warn(TAG, ...a) } catch { /* ignore */ } }

    // ── 文案 ────────────────────────────────────────────────────────────────
    const I18N = {
      zh: {
        placeholder: '搜索模型 / 供应商…（可打 @bailian 这类定向）',
        empty: '没有匹配的模型',
        clear: '清空',
        label: '搜索模型',
      },
      en: {
        placeholder: 'Search models / providers… (try @provider)',
        empty: 'No matching model',
        clear: 'Clear',
        label: 'Search models',
      },
    }
    const strings = () => {
      let lang = 'en'
      try {
        lang = String(
          (document.documentElement && document.documentElement.lang) ||
          (typeof navigator !== 'undefined' && navigator.language) ||
          'en',
        ).toLowerCase()
      } catch { /* ignore */ }
      return lang.startsWith('zh') ? I18N.zh : I18N.en
    }

    // ── 样式 ────────────────────────────────────────────────────────────────
    const CSS = `
.${WRAP_CLASS} {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22));
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, transparent));
  position: sticky;
  top: 0;
  z-index: 5;
  flex: 0 0 auto;
}
.${INPUT_CLASS} {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
  border-radius: 8px;
  outline: none;
  font: inherit;
  font-size: 12px;
  line-height: 30px;
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08));
}
.${INPUT_CLASS}:focus {
  border-color: var(--dsw-alias-brand-primary, #4c7dff);
}
.${INPUT_CLASS}::placeholder {
  color: var(--dsw-alias-label-tertiary, rgba(128,128,128,.75));
}
.${CLEAR_CLASS} {
  flex: 0 0 auto;
  border: none;
  background: none;
  padding: 0 4px;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary, rgba(128,128,128,.85));
}
.${CLEAR_CLASS}:hover {
  color: var(--dsw-alias-label-primary, inherit);
}
.${EMPTY_CLASS} {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, rgba(128,128,128,.85));
}
`

    function injectStyles() {
      try {
        if (document.getElementById(STYLE_ID)) return
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.setAttribute('data-dsh-plugin', 'dsh-model-menu-search')
        style.textContent = CSS
        ;(document.head || document.documentElement).appendChild(style)
        log('styles injected')
      } catch (e) {
        warn('injectStyles failed', e)
      }
    }

    // ── 匹配：归一化子串优先，子序列兜底（dsr1 → deepseek-reasoner-1）────────
    const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[-_./\s]+/g, '')
    const isSubseq = (hay, q) => {
      let at = 0
      for (let i = 0; i < hay.length && at < q.length; i++) if (hay[i] === q[at]) at++
      return at === q.length
    }
    const hit = (hayRaw, needleRaw) => {
      const needle = norm(needleRaw)
      if (!needle) return true
      const hay = norm(hayRaw)
      if (!hay) return false
      return hay.includes(needle) || isSubseq(hay, needle)
    }
    /** `@provider model-term` → { providers: [...], terms: [...] } */
    function parseQuery(raw) {
      const providers = []
      const terms = []
      const parts = String(raw == null ? '' : raw).split(/[\s,;/|]+/).filter(Boolean)
      for (const part of parts) {
        if (part.startsWith('@')) providers.push(part.slice(1))
        else terms.push(part)
      }
      return { providers, terms }
    }

    // ── 菜单结构识别（三层退化）────────────────────────────────────────────
    const ALL_MENU_SELECTOR = '[role="menu"]'

    /** 菜单里"可点的一行"。模型行的 button 带 `title`（= 模型名）；「推理档位」面板的行没有。 */
    const ROW_SEL = '[role="menuitemradio"][title],[role="menuitem"][title]'
    const GROUPED_ROW_SEL = '[role="group"] [role="menuitemradio"][title],[role="group"] [role="menuitem"][title]'

    function itemText(item, groupTitle) {
      let text = ''
      try {
        text = String(item.getAttribute('title') || '') + ' ' + String(item.textContent || '')
      } catch { /* ignore */ }
      return groupTitle ? groupTitle + ' ' + text : text
    }

    function groupTitleOf(group) {
      try {
        const labelledby = group.getAttribute('aria-labelledby')
        if (labelledby) {
          const node = document.getElementById(labelledby)
          if (node && node.textContent) return node.textContent
        }
        const heading = group.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]')
        if (heading && heading.textContent) return heading.textContent
        const first = group.firstElementChild
        if (first && first.textContent) return first.textContent
      } catch { /* ignore */ }
      return ''
    }

    /**
     * 收集"看起来像模型列表"的容器，按可信度排序。
     *
     * 关键判据是 `title` 属性：原生模型行的 button 带 `title`（= 模型名），
     * 而「推理档位 / 推理等级」面板的行**没有** `title`。没有这条区分，推理档位
     * 面板也会被当成模型列表，于是那里面也会被插上搜索框。
     *
     * 策略 1：role=menu 且 `role=group` 分组里有带 title 的行。
     * 策略 2：任何 role=menu，里面有 ≥2 个带 title 的行（容忍没有分组结构的版本）。
     * 策略 3：没有 role=menu 的版本——从带 title 的行反推分组容器。
     */
    function findMenus() {
      const found = new Set()
      try {
        for (const menu of document.querySelectorAll(ALL_MENU_SELECTOR)) {
          if (menu.querySelectorAll(GROUPED_ROW_SEL).length >= 1) { found.add(menu); continue }
          if (menu.querySelectorAll(ROW_SEL).length >= 2) found.add(menu)
        }
        if (found.size === 0) {
          for (const item of document.querySelectorAll(ROW_SEL)) {
            if (item.closest(ALL_MENU_SELECTOR)) continue
            const group = item.closest('[role="group"]')
            const container = (group && group.parentElement) || item.parentElement
            if (container && container.querySelectorAll(ROW_SEL).length >= 2) found.add(container)
          }
        }
      } catch (e) {
        warn('findMenus failed', e)
      }
      return [...found]
    }

    /** 菜单里的分组快照：每组标题 + 组内可点行。 */
    function readStructure(menu) {
      const groups = []
      try {
        for (const group of menu.querySelectorAll('[role="group"]')) {
          const items = [...group.querySelectorAll(ROW_SEL)]
          if (items.length === 0) continue
          groups.push({ el: group, title: groupTitleOf(group), items })
        }
        if (groups.length === 0) {
          // 无分组结构：把整个菜单当成一组。同样只认带 title 的模型行——
          // 「推理档位」面板的行没有 title，于是这里得到 0 组，搜索框会被隐藏。
          const items = [...menu.querySelectorAll(ROW_SEL)]
          if (items.length > 0) groups.push({ el: menu, title: '', items, menuItself: true })
        }
      } catch (e) {
        warn('readStructure failed', e)
      }
      return groups
    }

    // ── 菜单夹取到视口内 ────────────────────────────────────────────────────
    // 原生 place() 的定位是 top = triggerTop - 8 - menuHeight，并夹在
    // [12, innerHeight - menuHeight - 12]。正常高度下 top >= 12 不会出界；
    // 但菜单比视口还高时，innerHeight - menuHeight - 12 变成负数，top 跟着
    // 变负，菜单顶部（也就是搜索框所在位置）被顶出窗口。
    // 这里把高度夹到视口内，并把 top 拉回 MARGIN，保证搜索框一定看得见。
    const VIEWPORT_MARGIN = 12
    let lastFitKey = ''

    function fitToViewport(menu) {
      try {
        const rect = menu.getBoundingClientRect()
        if (!rect.height) return
        const vh = window.innerHeight || window.document?.documentElement?.clientHeight || 0
        if (!vh) return
        const maxH = Math.max(200, vh - VIEWPORT_MARGIN * 2)
        const overflows = rect.top < VIEWPORT_MARGIN || rect.bottom > vh
        const key = `${Math.round(rect.height)}:${Math.round(rect.top)}:${vh}`
        if (!overflows) return
        if (key === lastFitKey) return
        lastFitKey = key

        menu.style.maxHeight = Math.min(Math.round(rect.height), maxH) + 'px'
        menu.style.overflowY = 'auto'
        try {
          const pos = getComputedStyle(menu).position
          if (pos !== 'fixed' && pos !== 'absolute') menu.style.position = 'fixed'
        } catch { /* ignore */ }
        menu.style.top = VIEWPORT_MARGIN + 'px'

        const after = menu.getBoundingClientRect()
        log('menu clamped into viewport', {
          beforeTop: Math.round(rect.top), beforeH: Math.round(rect.height),
          afterTop: Math.round(after.top), afterH: Math.round(after.height),
          viewportH: vh,
        })
      } catch (e) {
        warn('fitToViewport failed', e)
      }
    }

    // ── 硬不变量：文档里只能有一个受管的搜索框 ──────────────────────────────
    /**
     * 清掉所有不属于"当前受管状态"的搜索框节点。
     *
     * 为什么需要：插入是往 React 管的容器里塞外来节点，任何时序意外（菜单节点被
     * 重建、同一个菜单被多次判定、旧节点残留）都可能让界面上出现多个搜索框。
     * 与其逐个堵时序，不如每次插入前扫一遍全局、只留受管的那个。
     */
    function purgeStrayBoxes() {
      try {
        const sel = '.' + WRAP_CLASS + ',.' + EMPTY_CLASS
        const nodes = document.querySelectorAll(sel)
        if (nodes.length === 0) return 0
        let removed = 0
        for (const node of nodes) {
          const owner = typeof node.closest === 'function' ? node.closest(ALL_MENU_SELECTOR) : null
          const state = owner ? tracked.get(owner) : undefined
          if (state && (node === state.wrap || node === state.empty)) continue
          try { node.remove() } catch { /* ignore */ }
          removed++
        }
        if (removed > 0) warn('purged', removed, 'stray search box node(s)')
        return removed
      } catch (e) {
        warn('purgeStrayBoxes failed', e)
        return 0
      }
    }

    // ── 几何变化监听：让夹取跟着原生重排走，不等用户滚动 ────────────────────
    let resizeObserver = null
    const styleWatched = new WeakSet()
    let burstFrames = 0
    let burstRunning = false

    function observeMenu(menu) {
      try {
        if (typeof ResizeObserver === 'undefined') return
        if (resizeObserver === null) {
          resizeObserver = new ResizeObserver(() => { queueScan(); burst(40) })
        }
        resizeObserver.observe(menu)
      } catch (e) {
        warn('observeMenu failed', e)
      }
    }

    function unobserveMenu(menu) {
      try { if (resizeObserver) resizeObserver.unobserve(menu) } catch { /* ignore */ }
    }

    /** 单独盯住菜单的 style 属性：原生 place() 重算 top 时会改它，而高度未必变。 */
    function observeMenuStyle(menu) {
      try {
        if (styleWatched.has(menu) || typeof MutationObserver === 'undefined') return
        styleWatched.add(menu)
        const mo = new MutationObserver(() => { queueScan() })
        mo.observe(menu, { attributes: true, attributeFilter: ['style'] })
      } catch (e) {
        warn('observeMenuStyle failed', e)
      }
    }

    /**
     * 沉降期：菜单打开后的一小段时间里逐帧重扫。
     *
     * 为什么需要：原生 place() 的依赖是 [open, pane, state]，目录加载完成会再跑一次；
     * 那时菜单已经包含我们的搜索框（更高），重算出的 top 可能为负，把顶部（搜索框
     * 所在处）顶出视口。只靠 scroll 事件修正会导致"必须先滚一下鼠标才看得见搜索框"。
     */
    function burst(frames = 120) {
      burstFrames = Math.max(burstFrames, frames)
      if (burstRunning) return
      burstRunning = true
      const tick = () => {
        if (burstFrames <= 0) { burstRunning = false; return }
        burstFrames--
        try { scan() } catch { /* scan 自己兜错 */ }
        try { requestAnimationFrame(tick) } catch { burstRunning = false }
      }
      try { requestAnimationFrame(tick) } catch { burstRunning = false }
    }

    /**
     * 兜底轮询：菜单已经出现在 DOM 里、但还没挂上搜索框时，短时间高频重扫。
     *
     * 为什么必须有：菜单是先渲染出来的，里面的模型行往往晚一步（面板默认停在
     * 「模型 / 推理档位」两级入口，或目录还在异步加载）。如果这一刻没挂上，
     * 就必须自己继续试，否则要等用户滚一下鼠标被动触发——这正是"要滚一下才
     * 出现搜索框"的直接原因。
     */
    let retryTimer = null
    let retryDeadline = 0

    function armRetry(ms = 5000, interval = 200) {
      retryDeadline = Math.max(retryDeadline, Date.now() + ms)
      if (retryTimer !== null) return
      retryTimer = setInterval(() => {
        if (Date.now() > retryDeadline || !document.querySelector(ALL_MENU_SELECTOR)) {
          clearInterval(retryTimer)
          retryTimer = null
          return
        }
        // scan() 返回"这次刷新了几个受管搜索框"；大于 0 说明已经挂上了，停止轮询。
        if (scan() > 0) {
          clearInterval(retryTimer)
          retryTimer = null
        }
      }, interval)
    }

    // ── 一个菜单的搜索框实例 ────────────────────────────────────────────────
    const tracked = new WeakMap()
    /** 同一个菜单被反复抹掉的计数（短窗口内连续失败就放弃，防止"抹掉→重建"雪崩）。 */
    const reattach = { menu: null, count: 0, since: 0 }

    function attachSearch(menu) {
      // 硬不变量：整个文档里只允许存在"受管"的搜索框节点，多余的一律清掉。
      // 这样即使出现"同一个菜单被插了多次"或"旧菜单残留"之类的时序问题，
      // 也绝不会同时在界面上出现多个搜索框。
      purgeStrayBoxes()

      const existing = tracked.get(menu)
      if (existing) {
        if (existing.wrap.isConnected && existing.wrap.parentNode === menu) return existing
        // React 重渲染时可能把外来的搜索框抹掉（它不认识这个节点）：清掉残骸后重建。
        // 但要防止"抹掉→重建→又被抹掉"的雪崩：短窗口内连续失败就放弃这个菜单。
        const now = Date.now()
        if (reattach.menu !== menu || now - reattach.since > 3000) {
          reattach.menu = menu
          reattach.count = 0
          reattach.since = now
        }
        reattach.count++
        if (reattach.count > 8) {
          warn('search box keeps being removed by re-renders; giving up on this menu')
          detachSearch(menu)
          return null
        }
        warn(`search box disappeared (React re-render?); re-attaching (${reattach.count})`)
        detachSearch(menu)
      }

      const t = strings()
      const wrap = document.createElement('div')
      wrap.className = WRAP_CLASS
      wrap.setAttribute('role', 'search')

      const input = document.createElement('input')
      input.type = 'text'
      input.className = INPUT_CLASS
      input.placeholder = t.placeholder
      input.setAttribute('aria-label', t.label)
      input.setAttribute('autocomplete', 'off')
      input.setAttribute('spellcheck', 'false')

      const clear = document.createElement('button')
      clear.type = 'button'
      clear.className = CLEAR_CLASS
      clear.textContent = '×'
      clear.setAttribute('aria-label', t.clear)

      const empty = document.createElement('div')
      empty.className = EMPTY_CLASS
      empty.textContent = t.empty
      empty.style.display = 'none'

      wrap.appendChild(input)
      wrap.appendChild(clear)

      const state = { wrap, input, clear, empty, groups: [], menu }

      const refresh = () => {
        try { state.groups = readStructure(menu) } catch { state.groups = [] }
      }

      const applyFilter = () => {
        try {
          refresh()
          const { providers, terms } = parseQuery(input.value)
          let visible = 0
          for (const group of state.groups) {
            const groupOk = providers.length === 0
              || providers.some((p) => hit(group.title, p))
            let visibleInGroup = 0
            for (const item of group.items) {
              const ok = groupOk && terms.every((term) => hit(itemText(item, group.title), term))
              item.style.display = ok ? '' : 'none'
              if (ok) visibleInGroup++
            }
            // 分组容器就是菜单本身时（无分组结构的退化情况）绝不能去改它的 display，
            // 否则会把整个菜单藏掉。
            if (!group.menuItself) group.el.style.display = visibleInGroup > 0 ? '' : 'none'
            visible += visibleInGroup
          }
          empty.style.display = visible === 0 ? '' : 'none'
          return visible
        } catch (e) {
          warn('applyFilter failed', e)
          return 0
        }
      }

      const visibleItems = () =>
        [...menu.querySelectorAll(ROW_SEL)]
          .filter((el) => el.style.display !== 'none')

      /**
       * 每次扫描都调一次。覆盖两个"行比菜单晚到"的时序：
       *   · 面板还停在「模型 / 推理档位」这一层（没有 menuitemradio）
       *   · 目录还在加载，行是稍后渲染出来的
       * 行没来时把搜索框藏起来（免得挡住两级入口），行来了再显示并重新过滤。
       */
      state.refreshNow = () => {
        refresh()
        const hasRows = state.groups.length > 0
        wrap.style.display = hasRows ? '' : 'none'
        if (hasRows) applyFilter()
        else empty.style.display = 'none'
      }

      input.addEventListener('input', () => {
        const n = applyFilter()
        log('filter', JSON.stringify(input.value), 'visible =', n)
      })

      clear.addEventListener('click', (ev) => {
        ev.preventDefault()
        input.value = ''
        applyFilter()
        input.focus()
      })

      input.addEventListener('keydown', (ev) => {
        try {
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault()
            ev.stopPropagation()
            const items = visibleItems()
            if (items.length === 0) return
            const idx = items.indexOf(document.activeElement)
            const next = ev.key === 'ArrowDown'
              ? (idx < 0 ? 0 : (idx + 1) % items.length)
              : (idx <= 0 ? items.length - 1 : idx - 1)
            items[next].focus()
            return
          }
          if (ev.key === 'Enter') {
            ev.preventDefault()
            ev.stopPropagation()
            const items = visibleItems()
            const target = items.includes(document.activeElement) ? document.activeElement : items[0]
            if (target) target.click()
            return
          }
          if (ev.key === 'Escape') {
            ev.stopPropagation()
            if (input.value !== '') {
              ev.preventDefault()
              input.value = ''
              applyFilter()
            } else {
              // 交给原生菜单处理关闭
              menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            }
          }
        } catch (e) {
          warn('keydown handler failed', e)
        }
      })

      // 插到菜单最顶部，空状态提示跟在后面
      try {
        menu.insertBefore(wrap, menu.firstChild)
        menu.insertBefore(empty, wrap.nextSibling)
      } catch (e) {
        warn('insert failed', e)
        return null
      }

      tracked.set(menu, state)
      state.refreshNow()
      fitToViewport(menu)
      observeMenu(menu)
      observeMenuStyle(menu)
      // 用更高的菜单高度重算过的 top 会在沉降期里被立刻修正，不必等用户滚鼠标
      burst(150)

      // 关键诊断：把几何信息打出来，万一还是看不见，一眼就知道为什么
      try {
        const wr = wrap.getBoundingClientRect()
        const mr = menu.getBoundingClientRect()
        log('attached', {
          menuTop: Math.round(mr.top), menuBottom: Math.round(mr.bottom), menuH: Math.round(mr.height),
          wrapTop: Math.round(wr.top), wrapH: Math.round(wr.height),
          visible: wr.top >= 0 && wr.bottom <= (window.innerHeight || 0),
          groups: state.groups.length,
          items: state.items ? state.items.length : state.groups.reduce((n, g) => n + g.items.length, 0),
        })
        if (wr.top < 0) warn('search box is ABOVE the viewport; menu is too tall — clamp did not help')
      } catch (e) {
        warn('geometry log failed', e)
      }

      try { input.focus({ preventScroll: true }) } catch { /* ignore */ }
      return state
    }

    function detachSearch(menu) {
      const state = tracked.get(menu)
      if (!state) return
      try { state.wrap.remove() } catch { /* ignore */ }
      try { state.empty.remove() } catch { /* ignore */ }
      unobserveMenu(menu)
      tracked.delete(menu)
    }

    // ── 扫描 ────────────────────────────────────────────────────────────────
    let emptyScanLogged = false

    /** 菜单是否真的有尺寸（别给隐藏的残留节点挂钩）。 */
    function isVisible(el) {
      try {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      } catch {
        return true
      }
    }

    /**
     * 扫一遍文档：给"模型列表"挂上搜索框、给"受管但当前不是模型列表"的菜单
     * （例如用户切到了「推理档位」面板）刷新结构——`refreshNow` 会把搜索框藏起来。
     * @returns 这次刷新了几个受管搜索框（0 表示还没挂上，调用方可以继续重试）。
     */
    function scan() {
      try {
        purgeStrayBoxes()
        const menuEls = [...document.querySelectorAll(ALL_MENU_SELECTOR)]
        const candidates = findMenus()
        if (menuEls.length === 0 && candidates.length === 0) {
          if (!emptyScanLogged) {
            emptyScanLogged = true
            log('scan: no model menu in DOM yet (打开模型菜单后会自动挂上)')
          }
          return 0
        }
        emptyScanLogged = false

        const candidateSet = new Set(candidates)
        let refreshed = 0
        for (const menu of candidates) {
          if (!isVisible(menu)) continue
          const state = attachSearch(menu)
          if (!state) continue
          // 每次扫描都刷新结构 + 重新过滤 + 重新夹取。覆盖「行是稍后渲染出来的」
          // 「面板 root → 模型列表切换」「原生重排 top」这几种时序。
          try { state.refreshNow() } catch { /* ignore */ }
          fitToViewport(menu)
          refreshed++
        }
        // 受管、但当前已经不是模型列表的菜单：刷新结构（搜索框会被隐藏）。
        // 这一步保证「推理档位」面板里不会留着搜索框。
        for (const menu of menuEls) {
          if (candidateSet.has(menu)) continue
          const state = tracked.get(menu)
          if (state && state.wrap.isConnected) {
            try { state.refreshNow() } catch { /* ignore */ }
            refreshed++
          }
        }
        if (candidates.length === 0) armRetry(5000)
        return refreshed
      } catch (e) {
        warn('scan failed', e)
        return 0
      }
    }

    let scanQueued = false
    function queueScan() {
      if (scanQueued) return
      scanQueued = true
      const run = () => { scanQueued = false; scan() }
      try { requestAnimationFrame(run) } catch { setTimeout(run, 16) }
    }

    function looksLikeMenuNode(node) {
      try {
        if (!node || node.nodeType !== 1) return false
        if (typeof node.matches === 'function' && node.matches(ALL_MENU_SELECTOR)) return true
        if (typeof node.querySelector === 'function' && node.querySelector(ALL_MENU_SELECTOR)) return true
      } catch { /* ignore */ }
      return false
    }

    /** 我们自己的搜索框被增删也要触发重扫（React 重渲染可能把它抹掉）。 */
    function looksRelevantNode(node) {
      if (looksLikeMenuNode(node)) return true
      try {
        if (!node || node.nodeType !== 1) return false
        const sel = '.' + WRAP_CLASS
        if (typeof node.matches === 'function' && node.matches(sel)) return true
        if (typeof node.querySelector === 'function' && node.querySelector(sel)) return true
      } catch { /* ignore */ }
      return false
    }

    // ── 生命周期 ────────────────────────────────────────────────────────────
    let observer = null

    function start() {
      injectStyles()
      scan()
      if (typeof MutationObserver === 'undefined' || !document.body) {
        warn('MutationObserver or document.body unavailable — falling back to polling')
        setInterval(scan, 1500)
        return
      }
      observer = new MutationObserver((mutations) => {
        let relevant = false
        for (const m of mutations) {
          // 已知菜单内部的变化（行是稍后渲染出来的、面板 root→模型 切换）也要重扫。
          // 只看"新增节点本身像不像菜单"是不够的：模型行是普通 button/section，
          // 会被判定为无关——那正是"必须滚一下才挂上"的根源。
          try {
            const t = m.target
            if (t && t.nodeType === 1 && typeof t.closest === 'function' && t.closest(ALL_MENU_SELECTOR)) {
              relevant = true
              break
            }
          } catch { /* ignore */ }
          for (const node of m.addedNodes) { if (looksRelevantNode(node)) { relevant = true; break } }
          if (relevant) break
          for (const node of m.removedNodes) { if (looksRelevantNode(node)) { relevant = true; break } }
          if (relevant) break
        }
        if (relevant) { queueScan(); burst(30) }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      // 原生 place() 在 scroll/resize 后会重排菜单；跟着重算夹取
      window.addEventListener('resize', queueScan, { passive: true })
      window.addEventListener('scroll', queueScan, { passive: true, capture: true })
      log('observer installed; watching for the model menu')
    }

    function apply() {
      log('client plugin apply() running')
      try {
        if (document.body) start()
        else document.addEventListener('DOMContentLoaded', () => { try { start() } catch (e) { warn('start failed', e) } }, { once: true })
      } catch (e) {
        warn('apply failed', e)
      }
    }

    // 手动诊断入口：控制台里跑 __dshModelMenuSearch.scan() / .menus()
    try {
      window.__dshModelMenuSearch = {
        scan: () => { scan(); return findMenus().length },
        menus: () => findMenus().map((m) => ({
          cls: String(m.className),
          groups: m.querySelectorAll('[role="group"]').length,
          items: m.querySelectorAll('[role="menuitemradio"]').length,
          hasBox: !!m.querySelector('.' + WRAP_CLASS),
        })),
        state: () => tracked,
        version: '1.0.3',
      }
    } catch { /* ignore */ }

    const plugin = { name: 'dsh-model-menu-search', apply, inject: [] }
    try { if (typeof module !== 'undefined' && module) module.exports = plugin } catch { /* ignore */ }
    return plugin
  },
})
