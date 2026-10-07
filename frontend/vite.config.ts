/**
 * vite.config.ts —— 构建与本地开发服务器配置
 *
 * 【这个文件负责什么】
 *   1. React 插件、路径别名（@ 指向 src，方便 import 不再写一长串 ../../）
 *   2. 开发服务器把 /api 请求代理给后端，前端代码里只写相对路径 /api/v1/xxx
 *   3. 代理必须为 SSE 关闭缓冲，否则进度条会"憋很久才一次性出来"
 *
 * 【谁依赖它】
 *   src/api/client.ts 里 API_BASE_URL 的默认值 '/api/v1' 就是靠这个代理生效。
 *   想换后端地址：设置环境变量 VITE_PROXY_TARGET（如 http://192.168.1.10:8000），
 *   或者直接改下面的 PROXY_TARGET 默认值 —— 前端业务代码一行都不用动。
 */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/** 后端默认地址。比赛演示时后端一般就跑在本机 8000 端口（见 06_工程规范.md §4.2） */
const PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'

export default defineConfig(({ mode }) => {
  // loadEnv 只是为了把 .env.[mode] 里的变量读进来做日志打印，业务代码用 import.meta.env 直接读
  loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react()],

    resolve: {
      alias: {
        // 用 @ 代表 src，路径更短也不怕文件挪位置
        '@': path.resolve(__dirname, 'src'),
      },
    },

    server: {
      port: 5173,
      // 允许局域网访问，方便队友/评委用手机或别的电脑打开演示
      host: true,
      proxy: {
        '/api': {
          target: PROXY_TARGET,
          changeOrigin: true,
          // 关键：SSE（任务进度、追问回答）是长连接，不能被代理缓冲
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              if (String(proxyRes.headers['content-type'] || '').includes('text/event-stream')) {
                proxyRes.headers['cache-control'] = 'no-cache, no-transform'
                proxyRes.headers['x-accel-buffering'] = 'no' // 给 nginx 看的，禁用缓冲
              }
            })
          },
        },
      },
    },

    build: {
      outDir: 'dist',
      // 告警线不是"抬到不告警"，而是"比当前最大的包再高一点"：
      // 现在最大的包是 react 那组（约 20KB）之后重新排过的 antd 组，
      // 定 700 意味着以后再往首屏塞一个大库（例如又引一个 UI 库）就会立刻告警。
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          // 【按包名拆库，而不是把 antd 整个塞一个包】
          // 上一版把 antd 与 @ant-design/icons 合成一个 chunk，实测那个包 1.18MB —— 刚好越过
          // 自己设的 1200KB 告警线（自己定的线被自己越过，等于没有线）。
          // 事实是：图标只占 24KB，真正撑大的是 antd 依赖的那批 rc-* 组件库。
          // 所以这里改成按"库"分组，每组一个包，单包体积都回到几百 KB 以内。
          // 图表库（1MB）单独成包后**不再进首屏** —— 只有评估页懒加载时才取它。
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined // 业务代码交给 vite 自己分包
            const inPackage = (name: string) => id.includes('node_modules/' + name) || id.includes('node_modules\\' + name)
            if (inPackage('react-dom') || inPackage('react-router') || inPackage('react/') || inPackage('scheduler') || inPackage('@remix-run')) {
              return 'react'
            }
            if (inPackage('echarts') || inPackage('zrender') || inPackage('tslib')) return 'echarts'
            // PDF 原件渲染器（勘误批注页用）：约 400KB，只有那一页懒加载时才需要。
            // 不单独拆的话它会掉进 vendor（=首屏包），把首屏拖大 400KB —— 与 echarts 同一处理。
            if (inPackage('pdfjs-dist')) return 'pdfjs'
            if (inPackage('antd/')) return 'antd'
            // rc-xxx / @rc-component / @ant-design（cssinjs、icons）都是 antd 的内部件，**必须同包**：
            // 它们互相 import（cssinjs ↔ @rc-component），拆开时 rollup 会报
            // "Circular chunk: antd-internal -> antd-rc -> antd-internal"，warning 就是这么来的。
            if (inPackage('@ant-design') || inPackage('rc-') || inPackage('@rc-component')) return 'antd-internal'
            if (inPackage('dayjs')) return 'dayjs'
            return 'vendor'
          },
        },
      },
    },
  }
})