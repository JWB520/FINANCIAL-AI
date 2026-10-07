/**
 * shared/utils/download.ts —— 触发一次浏览器下载（不依赖后端、不依赖 Electron）
 *
 * 【为什么单独抽出来】
 *   导出功能有两处要用（评估报告导出、将来的勘误清单导出），而"造 Blob + 点一个隐藏的 a 标签"
 *   这段 DOM 代码和业务无关；抽出来之后页面里只留一句 downloadText(...)。
 *
 * 【为什么不用 window.open】演示模式（假后端）没有真实文件可下，
 *   用 window.open 会打开一个不存在的地址（浏览器还可能把它当站内路由），
 *   所以演示模式改成在本地生成文本再下载，见 reports.ts 的 previewText()。
 */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // 立刻释放：否则这个 Blob 会一直留在内存里（导出多次就是多次泄漏）
  URL.revokeObjectURL(url)
}
