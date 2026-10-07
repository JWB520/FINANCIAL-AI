/**
 * features/pdf-viewer/PdfDocumentViewer.tsx —— PDF 原件渲染器（左栏）
 *
 * 【为什么自己用 pdf.js 渲染，而不是 <iframe> 直接指向 PDF】
 *   试过 iframe 那条路，两个坑：
 *     ① Electron 默认不开内置 PDF 插件（plugins: false），iframe 里是一片空白；
 *     ② 就算开了，我们也**拿不到页码**——批注要"点一下就跳到第 3 页"，
 *        iframe 只能靠 #page= 改 URL，页面内部的滚动位置与当前页对不上。
 *   自己渲染后：每一页是一个 canvas，页码、滚动定位、每页批注数都在我们手里。
 *
 * 【清晰度（第一版被用户点名的"很糊"，根因在这）】
 *   canvas 有两个尺寸：**像素尺寸**（canvas.width/height，决定分辨率）与
 *   **CSS 尺寸**（style.width/height，决定在屏幕上占多大）。第一版两者相等，
 *   于是高分屏（devicePixelRatio=1.5/2）上一个 CSS 像素要摊到多个物理像素上 → 糊。
 *   现在：像素尺寸 = CSS 尺寸 × DPR，再用 transform 把绘制内容同比放大。
 *   上限封 2（4K 屏上 PDF 页会吃几百 MB 显存，得不偿失）。
 *
 * 【pdf.js 6.x 的两个 API 变化（踩过）】
 *   · render() 要传 `canvas`；想自己控制尺寸与 context，就传 `canvas: null` + canvasContext；
 *   · 销毁用 loadingTask.destroy()，PDFDocumentProxy 上已经没有 destroy()。
 */
import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import * as workerModule from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Alert, Spin } from 'antd'

/**
 * worker 地址。worker 必须显式指定，否则 pdf.js 退回主线程解析，大文件会卡住整个界面。
 *
 * 【为什么写成命名空间取值，而不是 `import workerSrc from '…?url'`】
 *   渲染冒烟（npm run verify:render）用 esbuild 把页面直接打进 node 跑，而 esbuild 不认 vite 的 `?url`：
 *   它把带 ?url 的路径当普通模块解析，于是报 `No matching export … for import "default"`，
 *   整条渲染自检直接起不来 —— 而 tsc 与 vite build 都发现不了这件事。
 *   改成命名空间后两边都对：vite 仍会给 default（`?url` 的产物就是 `export default "地址"`）；
 *   esbuild 那边拿不到 default → 不设置 worker，node 里本来也不渲染 PDF，脚本能正常跑完。
 */
const workerSrc: string = (workerModule as { default?: string }).default ?? ''
if (workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

/** 版面上的一个标注框（坐标是"占页面宽高的百分比"，所以与缩放/高分屏/DPR 无关） */
export interface BoxMark {
  /** 属于哪条批注（点框 → 选中右栏对应的卡） */
  id: string
  /** 同一批注的第几个框（多框时角标显示 1/2、2/2），用作 React key */
  seq: number
  /** 角标文字，例如「#3」或「#3 · 1/2」 */
  label: string
  /** 悬停提示：这条框是什么意思 */
  title: string
  tone: 'risk' | 'uncovered'
  left: number
  top: number
  width: number
  height: number
}

/** 某一页上的批注统计（页角徽标上显示"本页 N 条"）+ 要画的框 */
export interface PageMark {
  total: number
  risk: number
  boxes: BoxMark[]
}

interface Props {
  url: string
  /** 页码 -> 该页批注统计 */
  marks: Record<number, PageMark>
  /** 要滚到哪一页（点右侧批注卡时变） */
  focusPage: number | null
  /** 用户点了某一页（用来选中该页第一条批注） */
  onPickPage: (page: number) => void
  /** 当前选中的批注 id（它对应的框会高亮，并且滚动时优先滚到框） */
  activeAnnotationId: string | null
  /** 用户点了版面上的某个框（用来选中右栏对应的卡） */
  onPickAnnotation: (id: string) => void
}

export function PdfDocumentViewer({
  url,
  marks,
  focusPage,
  onPickPage,
  activeAnnotationId,
  onPickAnnotation,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef(new Map<number, HTMLDivElement>())
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  /** 标注框元素（键是 `页码-批注id`）：选中卡片时要直接滚到框，而不是只滚到页 */
  const boxRefs = useRef(new Map<string, HTMLDivElement>())
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 容器宽度变了就 +1，触发重渲染（PDF 是位图，宽度变了必须重画） */
  const [renderKey, setRenderKey] = useState(0)

  /** 容器宽度变化时重渲染（窗口缩放、侧栏折叠都要跟上；位移小于 40px 不动，避免抖动） */
  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let lastWidth = element.clientWidth
    const observer = new ResizeObserver(() => {
      if (Math.abs(element.clientWidth - lastWidth) < 40) return
      lastWidth = element.clientWidth
      setRenderKey((key) => key + 1)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /** 加载文档 → 先渲染页壳 → 逐页把 canvas 画进去 */
  useEffect(() => {
    let cancelled = false
    const task = pdfjsLib.getDocument({ url })

    const run = async () => {
      setLoading(true)
      setError(null)
      setNumPages(0)
      try {
        const doc = await task.promise
        if (cancelled) return
        setNumPages(doc.numPages)
        // 等 React 把页壳挂到 DOM 上，再往里画 canvas（否则拿不到 slot）
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (cancelled) return

        // 减去容器左右 padding（10+10）与竖滚动条，避免横向溢出
        const containerWidth = Math.max(320, (containerRef.current?.clientWidth ?? 820) - 34)
        const ratio = Math.min(window.devicePixelRatio || 1, 2)

        for (let index = 1; index <= doc.numPages; index += 1) {
          if (cancelled) return
          const page = await doc.getPage(index)
          const baseViewport = page.getViewport({ scale: 1 })
          // 按容器宽度等比缩放；上限 1.6 倍，避免宽屏上把一页撑成大饼
          const scale = Math.min(containerWidth / baseViewport.width, 1.6)
          const viewport = page.getViewport({ scale })
          const slot = slotRefs.current.get(index)
          if (!slot) continue

          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          if (!context) continue
          // 像素尺寸按 DPR 放大（清晰度），CSS 尺寸按 viewport（版面大小），两者分开
          canvas.width = Math.floor(viewport.width * ratio)
          canvas.height = Math.floor(viewport.height * ratio)
          canvas.style.width = `${Math.floor(viewport.width)}px`
          canvas.style.height = `${Math.floor(viewport.height)}px`
          canvas.style.display = 'block' // 去掉行内元素的基线间隙
          slot.replaceChildren(canvas)

          await page.render({
            canvas: null, // 传 null = "用我给的这个 context，别自己建 canvas"
            canvasContext: context,
            viewport,
            transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
          }).promise
        }
      } catch (err) {
        if (!cancelled) setError((err as Error)?.message || 'PDF 渲染失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [url, renderKey])

  /** 点右侧批注卡 -> 滚到对应页 */
  useEffect(() => {
    if (!focusPage) return
    // 这一条在版面上有框 → 直接滚到**框**（用户不必自己满篇找位置）；没有才退回滚到页
    const box = activeAnnotationId ? boxRefs.current.get(`${focusPage}-${activeAnnotationId}`) : null
    if (box) {
      box.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    pageRefs.current.get(focusPage)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focusPage, activeAnnotationId])

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="PDF 原件加载失败"
        description={`${error}。请确认后端已启动（PDF 原件由后端提供），以及这份研报仍在原路径。`}
      />
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: '#e9ebef',
        borderRadius: 8,
        padding: '10px 10px 34px',
      }}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
          <Spin tip="正在加载 PDF 原件…">
            <div style={{ width: 160, height: 80 }} />
          </Spin>
        </div>
      ) : null}

      {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => {
        const mark = marks[page]
        return (
          <div
            key={page}
            ref={(node) => {
              if (node) pageRefs.current.set(page, node)
              else pageRefs.current.delete(page)
            }}
            style={{ position: 'relative', margin: '0 auto 30px', width: 'fit-content' }}
          >
            {/* 页面图像 + 标注层套在同一个 relative 容器里：
                "占页面宽高的百分比"必须只相对**页面图像**，不能连页脚那一行一起算。 */}
            <div style={{ position: 'relative' }}>
              <div
                ref={(node) => {
                  if (node) slotRefs.current.set(page, node)
                  else slotRefs.current.delete(page)
                }}
                onClick={() => onPickPage(page)}
                style={{
                  background: '#fff',
                  boxShadow: '0 1px 6px rgba(0,0,0,0.16)',
                  cursor: mark ? 'pointer' : 'default',
                  lineHeight: 0,
                  minWidth: 300,
                  minHeight: 180,
                }}
              />

              {/* 标注层：把"这条批注在版面上的位置"直接画在原文旁边 —— 用户不必自己满篇找。
                  坐标全部是百分比，所以缩放 / 高分屏 / DPR 都不用管。
                  点框 = 选中右栏对应那张卡（选卡时本层里对应的框也会高亮并滚到视野中间）。 */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {(mark?.boxes ?? []).map((box) => {
                  const active = activeAnnotationId === box.id
                  const color = box.tone === 'risk' ? '#ff4d4f' : '#d4a017'
                  const soft = box.tone === 'risk' ? 'rgba(255,77,79,0.18)' : 'rgba(212,160,23,0.22)'
                  return (
                    <div
                      key={`${box.id}-${box.seq}`}
                      ref={(node) => {
                        const key = `${page}-${box.id}`
                        if (node) boxRefs.current.set(key, node)
                        else boxRefs.current.delete(key)
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        onPickAnnotation(box.id)
                      }}
                      title={box.title}
                      style={{
                        position: 'absolute',
                        left: `${box.left}%`,
                        top: `${box.top}%`,
                        width: `${box.width}%`,
                        height: `${box.height}%`,
                        background: soft,
                        border: `1.5px solid ${color}`,
                        boxShadow: active ? `0 0 0 3px ${soft}` : 'none',
                        borderRadius: 2,
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                      }}
                    >
                      {/* 角标：这条框属于右栏哪张卡（一条批注多行时标 1/2、2/2） */}
                      <span
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          transform: 'translate(0, -100%)',
                          fontSize: 10,
                          lineHeight: '14px',
                          padding: '0 4px',
                          borderRadius: '3px 3px 0 0',
                          background: color,
                          color: '#fff',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {box.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            {/* 页码 + 本页批注徽标：放在页面**下方一行**。
                为什么不再挂在页面右上角：徽标本来伸到页面右边界之外（right:-6 + translateX(100%)），
                而容器是 overflowX:hidden —— 它会被右边界裁掉半截，还会挤到滚动条上；
                出现在页角又容易压住 PDF 正文。放到下面一行，既不裁也不压。 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginTop: 6,
                minHeight: 20,
              }}
            >
              <span style={{ fontSize: 11, color: '#86909c' }}>
                第 {page} 页 / 共 {numPages} 页
              </span>
              {/* 本页批注徽标：点了就跳到右侧那一条 */}
              {mark ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onPickPage(page)
                  }}
                  style={{
                    border: '1px solid',
                    borderColor: mark.risk ? '#ffa39e' : '#b7eb8f',
                    background: mark.risk ? '#fff1f0' : '#f6ffed',
                    color: mark.risk ? '#cf1322' : '#389e0d',
                    borderRadius: 12,
                    fontSize: 11,
                    lineHeight: '18px',
                    padding: '0 8px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {mark.total} 条{mark.risk ? ` · ${mark.risk} 有问题` : ''}
                </button>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
