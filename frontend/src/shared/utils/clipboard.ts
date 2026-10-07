/**
 * shared/utils/clipboard.ts —— 复制到剪贴板（"成功/失败"要拿得到）
 *
 * 【为什么不能写 `navigator.clipboard?.writeText(x)` 然后直接提示成功】
 *   clipboard.writeText 是**异步且会失败**的：非安全上下文（用 http 打开）、
 *   用户没授权、窗口失焦、Electron 里焦点在别处，都会 reject。
 *   原写法把 reject 变成"未处理的 Promise 拒绝"，而用户看到的却是"已复制"——
 *   粘贴时才发现是空的。这里统一 await + catch，失败就走兜底方案并如实返回 false。
 *
 * 【兜底方案】老式的隐藏 textarea + document.execCommand('copy')：
 *   execCommand 虽已废弃，但在剪贴板 API 不可用时仍是最可靠的兼容手段。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 走到下面的兜底：剪贴板 API 存在但被拒绝（无权限 / 非安全上下文）
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
