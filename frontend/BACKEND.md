# 后端开发说明（后端同学先看这一份）

> 更新时间：2026-09 · 面向对象：接手后端的工程师
> 阅读顺序：**这一份 → `src/api/README.md`（接口总表）→ `src/api/types.ts`（字段契约）→ `src/api/mock/mockHandlers.ts`（可运行的参考实现）**
> 设计文档在上一层目录：`../03_后端架构.md`（后端怎么设计）、`../05_数据模型与接口契约.md`（字段与接口定义）、`../06_工程规范与开发计划.md`（排期与规范）。

---

## 0. 三十秒看懂现状

| 问题 | 现在的答案 |
| --- | --- |
| 项目是什么 | 研报核查与质量评估平台。一份研报 → 在「项目」里做三件事：**研报勘误（逐句）/ 研报评估（整篇）/ 人工复核（裁决）** |
| 前端做完了吗 | **做完了，而且全都能点通**：13 个页面、6 套自检（`npm run verify` 共 112 项断言全绿） |
| 后端呢 | **一行都没有**。所有业务数据来自前端内置的"假后端"（`src/api/mock/`），桌面端外壳（Electron）只负责一件事：本地文件与文件夹 |
| 那为什么前端能跑 | `src/api/mock/mockHandlers.ts` 是一份**能跑通全部页面的假后端**：50 条 HTTP 接口 + 2 条流式通道都有实现，字段与真实后端要求完全一致 |
| 你要做什么 | 把这 50 条接口按契约实现出来，然后把前端一个环境变量切过去（`VITE_USE_MOCK=false`），业务代码**一行都不用改** |
| 最小可用目标是哪几条 | 见 §2「P0 七条」——把这七条做出来，主流程（建项目 → 发任务 → 看进度 → 看结论 → 复核）就通了 |

**一句话记住分工**：本地文件系统走 Electron（IPC），业务数据走后端（HTTP）。你只管 HTTP 那一半，不用管文件和文件夹。

---

## 1. 你现在要接手的东西在哪

```
软件实现/frontend/
├── src/api/                      ★ 只有这个目录与后端有关
│   ├── README.md                    接口总表（按资源分组，约 50 条 HTTP + 2 条流式通道）+ 联调排查顺序
│   ├── types.ts                     字段契约（1004 行）：所有请求体/响应体/实体定义
│   ├── enums.ts                     英文枚举 → 中文说法/颜色的唯一映射
│   ├── client.ts                    唯一请求出口：拼 URL、鉴权头、超时、错误归一、401 自动续期
│   ├── sse.ts                       两条流式通道（重连退避 + 降级轮询）
│   ├── endpoints/                   12 个文件，一个资源一个文件，函数与总表逐条对应
│   └── mock/                        假后端（★ 你的参考实现，见 §5）
└── electron/                    桌面端外壳（选文件、建项目文件夹、读写 settings.json）——**与后端无关**
```

三条硬规矩（前端已经在遵守，请你也遵守）：

1. **字段名以 `src/api/types.ts` 为准**。你加字段前端不用动；**你改字段名或删字段，必须同时告诉前端**（否则类型报错会暴露全部影响点）。
2. **页面里没有任何 URL 字符串和字段名硬编码**，所以改接口只需改 `endpoints/*.ts` 一处。
3. **不要在响应里"顺手多包一层"**。列表接口直接返回 `Page<T>`，详情接口直接返回实体本身，错误走 HTTP 状态码 + 统一错误体（见 §4）。

---

## 2. 先做哪些：接口优先级清单

接口全表在 `src/api/README.md` §2（按资源分组，约 50 条 HTTP + 2 条流式通道；条数是脚本从 `endpoints/*.ts` 逐条数出来的）。
**不要五十条平铺着做**，按下面顺序来。

### P0：七条，做完主流程就通了（建议第一周）

| 顺序 | 接口 | 谁在用 | 做不对会怎样 |
| --- | --- | --- | --- |
| 1 | `POST /reports/ensure` | 打开项目时（幂等） | 项目界面三个入口都没有"报告"可挂，什么都点不开 |
| 2 | `POST /tasks` | 任务单「发送」 | 发不出任务，演示直接卡住 |
| 3 | `GET /tasks/{id}` | 进度页快照（**5 秒轮询 + 每次重连都拉**） | 进度页白屏或永远加载 |
| 4 | `GET /tasks/{id}/events`（SSE） | 进度实时推送 | 进度条不动（前端会降级成轮询，但你得先有轮询源） |
| 5 | `GET /reports/{id}/blocks` | 复核裁决左栏原文 | 复核裁决页空态 |
| 6 | `GET /reports/{id}/claims` | 复核裁决右栏结论 | 复核裁决页"没有结论"（**＝误报没问题，属于产品事故**） |
| 7 | `POST /claims/{id}/reviews` | 人工裁决（接受/驳回/已核实/人工修改） | 复核做不了，且**驳回必须带理由** |

### P1：让三个入口都有内容（第二周）

`GET /reports/{id}/assessment`（评估明细）、`GET /assessments`（评估列表）、`GET /reviews/summary`、`GET /reviews/reports`、`GET /reviews/{reportId}/queue`、`POST /reviews/batch`、`GET /claims/{id}/findings`、`GET /findings/{findingId}`、`GET /claims/{id}/reviews`、`POST /reports/{id}/export`。

### P2：支撑类，可以晚一点

鉴权四条（`/auth/login|register|refresh`、`/me`）、审计两条（`/audit/events`、`/audit/trace/{id}`）、知识库五条、经验学习七条（含三条删除，规矩见 §4.5）、`GET /dimensions`、帮助文档两条。

### 明确**不用**你做的

| 东西 | 谁负责 |
| --- | --- |
| 新建项目、项目列表、project.json | 桌面端 Electron（本地文件夹，见 `electron/projectStore.cjs`） |
| 系统"选择文件/文件夹"窗口 | Electron 主进程 |
| 设置项（模型、判据、知识库检索参数） | 本地 `settings.json`，由桌面端读写；**但**这些配置会随任务提交带给你（见 `TaskSubmitPayload`） |
| PDF 页数 | 桌面端无依赖自读（读不到时界面让用户手填） |
| 任务请求留档 | 桌面端写到 `<项目>/data/tasks/`（本地凭证，与后端日志互补） |
| 项目云归档、团队共享 | `endpoints/projects.ts` 已留好接口，**现在前端不调用**，将来做时直接启用 |

---

## 3. 五分钟把前端接到你的服务上

```bash
# 1) 起你的后端（默认约定 8000 端口）
python -m uvicorn app:api --port 8000

# 2) 前端工程根目录（就是仓库根目录）建 .env.local
VITE_USE_MOCK=false
VITE_API_BASE_URL=/api/v1          # 前端所有请求都拼在这个前缀之后
# 后端不在本机时，两种方式任选：
# VITE_API_DIRECT_URL=http://192.168.1.10:8000/api/v1
# 或 VITE_PROXY_TARGET=http://192.168.1.10:8000

# 3) 起桌面端（一条命令：起前端服务 → 拉起应用窗口）
npm run desktop

# 4) 打开窗口 → 工作台 → 导入已有项目 → 进项目 → 点「勘误」→ 填任务单 → 发送
```

**运行期也能切**：应用里的「设置 → 工作区与数据」改「数据模式 / 后端接口地址」**立即生效，不用重启**（走 `client.ts` 的运行时覆盖层）。所以联调时不用来回改 `.env`。

**接口没实现时会发生什么**（这是刻意的设计，方便你定位）：前端会直接报错并显示"假数据里还没有实现这个接口：GET /xxx"——**不会静默返回空数据**。所以联调时你就看页面报的错，一条条补即可。

---

## 4. 必须写对的地方（前端的红线）

### 4.1 请求侧：前端会发什么

| 项 | 约定 |
| --- | --- |
| 前缀 | 所有路径都拼在 `VITE_API_BASE_URL`（默认 `/api/v1`）之后 |
| 鉴权 | `Authorization: Bearer <access_token>`（登录后每个请求都带） |
| 追踪号 | `X-Trace-Id: <前端生成>`，**请把它写进你的日志**，并在错误体里回传 `trace_id`（用户报障时给的就是它） |
| 参数 | GET 走 query；POST/PATCH 是 JSON body；**上传研报是 `multipart/form-data`**（file + project_id + title + company + ticker + report_date） |
| 并发 | 提交复核带 `If-Match: <claim.revision>`；版本不一致 → `409 CLAIM_REVISION_CONFLICT` |
| 超时 | 默认 15 秒（`VITE_REQUEST_TIMEOUT`），请保证单请求在该时间内返回；长任务用任务/SSE，不要长轮询挂住 |

### 4.2 响应侧：成功与失败

成功：**直接返回数据本体**。

```jsonc
// 列表接口统一返回 Page<T>
{ "items": [...], "total": 137, "page": 1, "page_size": 20 }
```

失败：**HTTP 状态码 + 统一错误体**（`types.ts` 的 `ApiErrorBody`）。

```jsonc
// 409 TASK_MISSING_INPUTS 示例
{ "code": "TASK_MISSING_INPUTS", "message": "缺少外部研报库，同业一致性维度无法核查",
  "details": { "missing_inputs": ["external_reports"] }, "trace_id": "tr-..." }
```

- `message` 是**给用户看的中文**，前端直接展示、不自己编业务文案 → 所以请写人话。
- 错误码词典在 `client.ts`（`ERROR_CODE` + `ERROR_CODE_HINT`），**新增错误码请同时告诉前端**（前端会给它配一句"怎么办"的提示）。
- **401 的处理**：前端拿 refresh 换一次新票并自动重试；换不到才跳登录。所以 `POST /auth/refresh` 要能稳定工作。
- **404 请真的 404**：不要"查不到就返回第一条"（这是我们刚修掉的一个真 bug：打开不存在的任务会打开成别人的任务）。同理，`GET /tasks/{id}` 未知 id 必须 404。

### 4.3 三类"绝对不能糊弄"的语义

这三条前端已经到处在防，但它们的前提取决于你的响应：

| 语义 | 必须这样返回 | 为什么 |
| --- | --- | --- |
| **未覆盖 ≠ 通过** | 没查成 → `status: "uncovered"` + 原因；**不许**返回 `pass`、空数组或 `covered: 0` 冒充"没问题" | 前端会把它显示成"通过"，用户以为查过了——这是产品事故 |
| **没做过 ≠ 0 分** | 未评估 → `status: "not_started"`、`reference_score: null` | 显示 0 分会被理解成"评估过且很差" |
| **三态结论** | 每条主张同时给 `ai_conclusion` / `human_conclusion` / `effective_conclusion`；**没有人工动作时生效结论是"待复核"**，不是"通过" | 复核页靠它区分"AI 说什么、人说什么、最终算什么" |

### 4.4 排序、分页、覆盖率口径

- **排序由后端定，前端不传排序参数**：原文块按 `block_index` 升序、`claims` 按 `block_index` 升序返回、复核队列按**风险降序**（同级再按是否有证据）。前端不做二次排序，避免两处口径不一致。
- **`offset` 必须是全文绝对区间**：`ClaimSpan` 与 `Evidence` 的区间用来在原文上做高亮，错一位就整条高亮错位（前端有 20 项断言专门防这个，但它防不住你给错数据）。
- **覆盖率的口径写死**：`覆盖率 = 有结论的条数 ÷ 主张总数`，"未覆盖"和"核查失败"都不算有结论。前端左栏、工作台、评估页用的是同一个口径。

### 4.5 删除类接口的三条不同规矩（经验学习）

| 删什么 | 能不能删 | 附加条件 |
| --- | --- | --- |
| 学习候选 | **任何状态都能删** | 已审核过的（approved/rejected）**必须带 `reason`**，否则 400 |
| 经验案例 | 任何状态都能删 | 无 |
| 规则版本 | **任何状态都能删（含生效中）** | 删掉生效中的版本时，**自动把同一 key 下最近的历史版本切回 `active`**，并在返回值 `promoted` 里说明切到了哪一版；无历史版本则 `promoted: null` |

删除一律写审计事件（"东西怎么没了"永远查得到）。**别用 409 拒绝删除**——能删 + 自动兜底，比不许删好。

### 4.6 两条流式通道（SSE）

| 通道 | 路径 | 事件 |
| --- | --- | --- |
| 任务进度 | `GET /tasks/{id}/events` | `stage` / `counters` / `task` / `error` / `heartbeat` |
| 单条追问 | `POST /claims/{id}/ask` | `chunk` / `done` |

事件字段见 `types.ts` 的 `TaskSseEvent`（例：`stage` = `{stage_code, status, progress, message?, stat?}`；`error` = `{stage_code, message, retryable}`）。

三件容易踩的事：

1. **前端用 `fetch + ReadableStream` 手写解析**（浏览器原生 `EventSource` 不能带 `Authorization` 头）→ 所以 SSE 这条也走 **CORS**，请允许 `Authorization` 与 `X-Trace-Id` 头。
2. **必须关缓冲**：`Content-Type: text/event-stream` + `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no`，否则事件会"憋很久一次性出来"。开发时 vite 代理已处理（见 `vite.config.ts`），生产要由你的网关保证。
3. **每 5 秒至少一个 `heartbeat`**：前端据此判断连接还活着；连续失败会**自动降级为 5 秒轮询**并在页面提示用户（`GET /tasks/{id}` 因此必须能被频繁调用且便宜）。

### 4.7 任务对象里三个"我踩过坑才加上"的字段

```jsonc
{
  "id": "task-...", "report_id": "rpt-...",
  "kind": "errata",                  // ★ 必填：勘误还是评估 —— 前端靠它决定"查看结果"去哪个界面
  "status": "running", "progress": 65,
  "current_stage": "check",
  "stages": [
    { "id": "task-1-st1", "task_id": "task-1",
      "stage_code": "parse",         // ★ 必须是 StageCode 里的值（parse/claim_split/claim_classify/check/aggregate）
      "status": "done", "attempt": 1, "progress": 100,
      "stat": { "blocks": 20 }, "started_at": "...", "finished_at": "...", "duration_ms": 12000 }
  ],
  "counters": {                      // ★ 字段名固定，别再叫 findings/high/medium/low
    "claims_total": 16, "findings_high": 3, "findings_medium": 2, "findings_low": 1, "uncovered": 3
  }
}
```

这三个字段名（`kind` / `stages[].stage_code` / `counters.findings_*`）以前和前端读的不一致，导致"新建任务后阶段列表永远不更新、评估任务跑完跳进勘误页"——**刚修完，别再改回去**。

---

## 5. 假后端是你的可执行规格说明

`src/api/mock/mockHandlers.ts`（1300 行）不只是测试数据，它是**一份已经通过了 112 项自检的参考实现**：

- 每个路由的注释里都写着它对应哪条真实接口（例：`note: '对应 POST /tasks：创建核查任务…'`）；
- 它实现了真实写操作：提交复核会改状态并 `revision + 1`、批量核实、启停知识库、审核候选、删除与自动兜底；
- 它刻意实现了错误路径：`409 TASK_MISSING_INPUTS`、`400 REVIEW_REASON_REQUIRED`、`409 CLAIM_REVISION_CONFLICT`、`404 任务不存在`——**你的实现也要能触发这些**。

所以最省事的做法是：**照抄它的行为，但把内存数组换成数据库**。改完之后：

```bash
npm run verify:mock     # 17 项：删除、该拦的拦住（驳回必须填理由）、删掉被依赖的对象后自动兜底
npm run verify          # 112 项：落盘 36 + 假后端 17 + 核心逻辑 20 + 主线切换器 18 + 图表 9 + 页面渲染 12
```

切到真后端后这些断言不再覆盖你的代码，但 `npm run desktop` + 逐页点一遍仍然是最快的验收方式（页面渲染冒烟覆盖了 12 个页面，见 `scripts/smoke-render.tsx`）。

---

## 6. 常见坑（都是真实发生过的）

| 坑 | 怎么避 |
| --- | --- |
| 响应多包一层 `{code, data}` | 前端直接读数据本体，多包一层会让所有页面取不到值 |
| 用 `0` / 空数组表示"没做" | 必须用 `null` / `not_started` / `uncovered`（§4.3） |
| 未知 id 返回第一条记录 | 必须 404（前端会据此显示错误态，而不是"打开成别人的东西"） |
| 时间戳用本地时间 / 毫秒数 | 统一 ISO 8601 UTC 字符串（`2026-09-24T02:11:03Z`） |
| 金额、比率用浮点数 | 用**字符串**返回，避免精度丢失（前端只展示、不参与计算） |
| 枚举返回中文或大写 | 一律小写蛇形（`high` / `uncovered` / `claim_split`），中文标签在前端 `enums.ts` 里映射 |
| 上传接口用 JSON 传文件路径 | 前端只发 `multipart` 文件流；本地路径不走后端 |
| 导出接口返回 JSON | `GET /reports/{id}/export?format=docx` 必须是**文件响应**（前端 `window.open` 直接下载，大文件不进内存） |
| 长任务同步等待 | 创建任务立即返回 task，进度走 SSE；创建时缺资料就 409，不要卡住请求 |
| 让前端传排序参数 | 排序由后端定（§4.4） |

---

## 7. 第一天/第一周建议动作

1. **半天**：读 `src/api/README.md` §2 总表 + `types.ts` 的"通用基础类型（§0）"与三个主角实体（Report / Claim / Finding）。
2. **半天**：把 `src/api/mock/mockHandlers.ts` 按你的技术栈翻译成一层路由骨架（先把 P0 七条的 URL 与返回**空数据**打通，让前端不再报"没实现"）。
3. **两天**：实现 `POST /reports/ensure` + `POST /tasks` + `GET /tasks/{id}`（含 `stages` 契约），跑通"建项目 → 发任务 → 进度页".
4. **两天**：实现 `GET /reports/{id}/blocks` + `GET /reports/{id}/claims`（**offset 必须绝对区间**）+ 复核提交（`If-Match` + 驳回必填理由），跑通"复核裁决 → 裁决"。
5. **一天**：`GET /tasks/{id}/events` 接上 SSE（含 heartbeat 与 404），观察前端是否自动切回"实时"。
6. 每到一步，用 `npm run desktop` 在真实窗口里点一遍；有报错就把页面上的 `trace_id` 拿来查自己的日志。

---

## 8. 需要你回给前端的两样东西

1. **接口变更通知**：字段增删改、错误码新增、状态机变化 → 前端改 `types.ts` + `enums.ts` 即可，但**必须同时改**（它会连锁报错，这是特性不是缺陷）。
2. **联调地址与账号**：把 `VITE_PROXY_TARGET` 或 `VITE_API_DIRECT_URL` 填对，并在设置页把"数据模式"切到真实即可。

> 有任何字段拿不准，**以 `src/api/types.ts` 为准**；有任何行为拿不准，**以 `src/api/mock/mockHandlers.ts` 为准**。
> 这两处都是前端离你最近、也最不会骗人的地方。
