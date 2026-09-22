/**
 * dsh-model-menu-search — 宿主半边（无操作占位）。
 *
 * 为什么需要它：一个包要被当作 profile bundle 加载，它的 `dsh.bundle.patch`
 * 必须插入一条**宿主** loader 条目；没有宿主条目，boot 会拒绝加载整个 bundle。
 * 本插件的全部功能都在浏览器半边（`exports["./client"]` → lib/client.js）。
 *
 * 设计约束（为了“DSH 怎么更新都能用”）：
 * - 零 import、零 peer 依赖 —— 不碰 @deepseek-ai/* 的版本漂移。
 * - apply 里什么都不做，更不会抛错 —— 宿主半边永远不会成为启动失败的源头。
 */

export const name = 'dsh-model-menu-search'

export const inject = []

export function apply() {
  // 故意留空：功能全在浏览器半边。
}
