# dsh-model-menu-search

给 **DeepSeek Harness WebUI 的模型下拉菜单**加一个实时搜索框。点开输入框右下角的模型胶囊后，菜单顶部会出现一个输入框，直接打字就能过滤模型，不用再用鼠标滚。

## 用法

1. 点输入框右下角的**模型胶囊**（带 ▼ 的那个按钮）。
2. 菜单顶部出现搜索框，**直接打字**：

| 输入 | 效果 |
|---|---|
| `glm` | 按名称子串过滤（大小写无关） |
| `glm53` | 归一化匹配：忽略 `-` `_` `.` `/` 空格，命中 `glm-5.3-prime` |
| `dsr1` | 子序列/缩写匹配：命中 `deepseek-reasoner-1` |
| `@bailian` | 只看某个供应商（`@` 前缀） |
| `@bailian qwen` | 供应商 + 关键词组合 |
| `reasoner; 32b` | 空格 / 逗号 / 分号 / 斜杠 / 竖线都当分隔符 |

键盘：`↓` `↑` 在**可见的**模型行之间移动，`Enter` 直接选中，`Esc` 先清空输入框、再按一次关闭菜单。

## 为什么 DSH 更新也不容易坏

这是专门针对"插件被 DSH 版本更新搞挂"设计的：

1. **不抢 slot、不改共享服务。** 不注册 `conversation.input.model` 座位，不包装 `modelDirectories` / `directory.select`。宿主内部服务改名、改签名都不影响这里。
2. **只用 ARIA 语义属性定位。** 靠 `role="menu"` / `role="group"` / `role="menuitemradio"`，不依赖任何哈希类名（DSH 的 CSS Module 类名形如 `IecIca_menu`，每次构建都变）。并且有三层退化策略，最坏情况下从模型行反推容器。
3. **零 import、零 peer 依赖。** 不 require 任何 `@deepseek-ai/*` 包，所以不会因为核心包版本漂移（rc.7 → rc.8 → 0.1.5-rc.2 …）而崩。
4. **绝不抛错。** 每一步都有 try/catch，失败只 `console.warn`，不会把一个纯装饰插件变成"整棵插件树失败、窗口打不开"的故障源。
5. **保证可见。** 原生菜单是 `top = 触发按钮顶部 - 8 - 菜单高度` 定位、并夹在 `[12, 视口高-菜单高-12]`。菜单比视口还高时 `top` 会变成负数，顶部（搜索框所在处）被顶出窗口。插件会把高度夹进视口并把 `top` 拉回 12px。

## 安装在哪儿

装在 desktop profile 里，用 `link:` 指向本目录（符号/联接而非拷贝）：

- 依赖：`~/.dsh/profiles/desktop/package.json` → `"dsh-model-menu-search": "link:D:/workplace/dsh-model-menu-search"`
- 名单：同上文件的 `dsh.profile.bundles` 里多一项 `dsh-model-menu-search`
- 模块：`~/.dsh/profiles/desktop/node_modules/dsh-model-menu-search` → 指向本目录的目录联接

**好处**：改本目录里的 `lib/client.js` 后，只要**刷新页面**（或重启 DSH）就生效，不需要重新安装、不会被插件市场升级覆盖——这和那些必须改 `node_modules` 打补丁的插件不一样。

## 更新日志

- **1.0.1** —— 修「每次打开列表要滚一下鼠标才出现搜索框」。
  根因：原生 `place()` 的依赖是 `[open, pane, state]`，目录加载完成会再跑一次；此时菜单已包含搜索框（更高），重算出的 `top` 可能为负，把顶部（搜索框所在处）顶出视口。原版只在 `scroll`/`resize` 时才重新夹取，所以要滚一下才修正。
  修法：① 插入后开一段约 150 帧的"沉降期"逐帧重扫并重新夹取；② 用 `ResizeObserver` 盯菜单尺寸变化；③ 用单独的 `MutationObserver` 盯菜单的 `style` 属性（原生重算 `top` 时高度未必变）；④ 搜索框被 React 重渲染抹掉时能自动重建。
  控制台里 `__dshModelMenuSearch.version` 可以确认当前加载的是哪个版本。

## 卸载

```powershell
# 1) 从 profile 的 package.json 里删掉依赖和 bundles 里的那一项
# 2) 删掉联接
Remove-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-model-menu-search" -Force
```

## 排查

浏览器控制台（DSH 窗口里按 `Ctrl+Shift+I` → Console）里所有日志都带前缀 `[dsh-model-menu-search]`：

- `client plugin apply() running` —— 浏览器半边已挂载
- `observer installed; watching for the model menu` —— 观察器已装
- `attached {...}` —— 搜索框已插入，并打印菜单/搜索框的几何信息（`menuTop` / `wrapTop` / `visible`）
- `menu clamped into viewport {...}` —— 菜单被夹进视口
- `scan: no model menu in DOM yet` —— 还没检测到菜单（正常，打开菜单后会自动挂上）
- 任何以 `... failed` 结尾的都是被 catch 住的异常，不会影响 DSH

控制台里还有手动诊断入口：

```js
__dshModelMenuSearch.menus()   // 当前识别到的菜单：[{cls, groups, items, hasBox}]
__dshModelMenuSearch.scan()    // 立刻重扫一次，返回识别到的菜单数量
```

## 测试

```powershell
node test/dom-smoke.mjs
```

用最小假 DOM 跑真实的 `lib/client.js`，覆盖：挂载、样式注入、菜单识别（故意用哈希类名）、搜索框插入位置、高度夹取、归一化/子序列/`@provider` 匹配、空状态、清空、键盘导航、以及"没有菜单时不抛错"。
