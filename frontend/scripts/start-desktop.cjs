/**
 * scripts/start-desktop.cjs —— 一条命令启动桌面端：先起前端服务，再拉起桌面窗口
 *
 * 【为什么需要它】
 *   桌面端要求"前端服务先就绪，窗口再打开"，否则白屏。
 *   这个脚本负责：起前端服务 → 轮询等它就绪 → 带地址拉起窗口 → 关窗口时顺手收掉前端服务。
 *   用户只需要敲一次 npm run desktop。
 */
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const PORT = Number(process.env.RQC_DEV_PORT || 5173)
const URL = 'http://localhost:' + PORT
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

/** 轮询前端地址，直到能连上（或超时） */
function waitReady(timeoutMs = 60000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(URL, (res) => {
        res.resume()
        resolve(true)
      })
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('前端服务启动超时：' + URL))
        else setTimeout(tick, intervalMs)
      })
    }
    tick()
  })
}

function main() {
  console.log('[desktop] 启动前端服务 …')
  const feServer = spawn(npx, ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  waitReady()
    .then(() => {
      console.log('[desktop] 前端就绪，打开桌面窗口 …')
      const win = spawn(npx, ['electron', '.'], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: { ...process.env, VITE_DEV_SERVER_URL: URL },
      })
      win.on('exit', (code) => {
        console.log('[desktop] 窗口已关闭，收尾退出（code=' + code + '）')
        feServer.kill()
        process.exit(code ?? 0)
      })
    })
    .catch((error) => {
      console.error('[desktop] 启动失败：' + error.message)
      feServer.kill()
      process.exit(1)
    })

  process.on('SIGINT', () => {
    feServer.kill()
    process.exit(0)
  })
}

main()