# 前端接口层（★ 与后端挂钩的东西，全都在这个目录里）

**这里就是你要找的地方。** 前端所有与后端打交道的东西 —— 接口函数、数据结构、枚举、鉴权、流式通道、假数据 ——
全部集中在 `src/api/` 下，业务页面里不会出现任何 `fetch`、URL 字符串或字段名硬编码。

> 如果你是**新接手后端**的开发：先读仓库根目录的 **`BACKEND.md`**（三十秒看懂现状、先做哪七条、哪些字段不能错），
> 再回来看本文件的接口总表与 `types.ts` 的字段契约。

## 0. 建议的阅读顺序（30 分钟能全部看完）

| 顺序 | 文件 | 看什么 | 行数 |
| --- | --- | --- | --- |
| ① | `types.ts` | **字段契约**：请求体、响应体、实体的全部字段定义（后端字段名以它为准） | 1004 |
| ② | `README.md`（本文件）§2 | **接口总表**：按资源分组，约 50 条 HTTP 接口 + 2 条流式通道 | — |
| ③ | `endpoints/*.ts` | **接口函数**：一个资源一个文件，函数签名与总表一一对应 | 12 个文件 |
| ④ | `client.ts` | **请求出口**：拼 URL、鉴权头、`X-Trace-Id`、超时、错误归一、401 自动续期 | 411 |
| ⑤ | `enums.ts` | 后端英文枚举代号 → 中文说法（`finding_status` 这类） | 366 |
| ⑥ | `sse.ts` | 两条流式通道的实现（含重连与降级） | 223 |
| ⑦ | `mock/` | 假后端：字段与真实接口完全一致，切换开关不用改业务代码 | — |

> 只想确认"某个功能调了哪个接口"：直接搜 `endpoints/` 里对应资源文件的函数名，或看下面第 2 节的总表。

## 1. 文件分工

| 文件 | 作用 | 对应文档 |
| --- | --- | --- |
| `types.ts` | 全部数据结构定义。**后端字段名以它为准** | `05_数据模型与接口契约.md` §2 §4 |
| `enums.ts` | 英文枚举代号 → 中文说法 / 颜色 / 图标 | `05` §3 |
| `client.ts` | 唯一请求出口；`ApiError`、`authToken`、`request()` 都在这里 | `05` §7 |
| `sse.ts` | 流式通道：任务进度、单条追问 | `05` §6 |
| `endpoints/auth.ts` | 登录、注册、当前用户、退出 | `05` §5.1 |
| `local/desktop.ts` | **桌面端本地能力**：选研报文件、选知识库文件夹、建/列/打开项目（走 Electron，不走 HTTP） | — |
| `endpoints/projects.ts` | 项目的**云端**增删改查（当前前端不调用，保留给后端做项目云归档） | 新增实体 |
| `endpoints/reports.ts` | 研报上传、列表、原文块、版本差异、导出、（重新）核查 | `05` §5.2 |
| `endpoints/tasks.ts` | 任务创建、列表、终止、单阶段重试 | `05` §5.3 |
| `endpoints/claims.ts` | 主张、结论、复核动作（人工裁决） | `05` §5.4 |
| `endpoints/reviews.ts` | 复核列表（报告级 / 主张级）与批量核实 | `05` §5.5 |
| `endpoints/assessments.ts` | **研报评估**列表与明细（整篇质量） | `05` §5.5 |
| `endpoints/knowledge.ts` | 知识库：文档、启停、分片 | `05` §5.6 |
| `endpoints/learning.ts` | 经验学习：案例 → 候选 → 审核发布 → 回滚 | `05` §5.7 |
| `endpoints/audit.ts` | 审计事件（可删性为零，只追加） | `05` §5.8 |
| `endpoints/dimensions.ts` | 维度注册表（驱动核查设置页） | `05` §5.9 |
| `endpoints/help.ts` | 帮助文档 | `05` §5.10 |
| `mock/*` | 假数据适配器（后端未就绪时用） | — |
| `index.ts` | 统一出口，页面只从这里 import | — |

## 2. 接口总表（当前代码里实际存在的全部接口）

> 前缀：所有路径都拼在 `VITE_API_BASE_URL`（默认 `/api/v1`）之后。

### 2.1 认证 `authApi`（endpoints/auth.ts）

| HTTP | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/login` | 返回 access / refresh / user |
| POST | `/auth/register` | 注册（公司 + 角色） |
| POST | `/auth/refresh` | 用 refresh 换新 access；**由 `client.ts` 在 401 时自动调用一次**，页面不直接调 |
| GET | `/me` | 刷新页面恢复登录态 |
| POST | `/auth/logout` | 退出（前端同时清本地令牌） |

### 2.2 项目 `projectApi`（endpoints/projects.ts）

> **当前状态（重要）**：项目目前由**桌面端以本地文件夹管理**
> （`<文档>/RQC 项目库/<项目名>/project.json`，见 `electron/projectStore.cjs`），前端**不调用**下面的接口。
> 它们保留在契约里，供后端将来做「项目云归档 / 团队共享」时启用；
> 唯一需要后端配合的是 **`POST /reports/ensure`**（打开本地项目时把研报路径与后端报告实体对上，幂等）。

| HTTP | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects` | 列表；筛选 `status`(active/archived) / `q` / 分页 |
| POST | `/projects` | 新建项目（body: name, description?） |
| GET | `/projects/{projectId}` | 详情：项目统计 + `reports[]`（每份研报的勘误/评估/复核状态） |
| PATCH | `/projects/{projectId}` | 改项目名 / 说明 |
| POST | `/projects/{projectId}/archive` | 归档（只改状态，历史数据全留） |

### 2.3 研报 `reportApi`（endpoints/reports.ts）

| HTTP | 路径 | 说明 |
| --- | --- | --- |
| POST | `/reports/ensure` | **打开本地项目时调用**：按 `project_id` + `report_path` 确保报告存在（幂等，不许重复建） |
| POST | `/reports` | **multipart 上传**：file + `project_id` + title + company + ticker + report_date |
| GET | `/reports` | 列表；筛选 `project_id`（本次新增）/ company / status / keyword / 分页 |
| GET | `/reports/{reportId}` | 报告详情（含 versions、latest_task） |
| GET | `/reports/{reportId}/blocks` | 原文块；**offset 是全文绝对区间**（复核裁决的左右联动靠它） |
| GET | `/reports/{reportId}/claims` | 该报告的全部主张（**必须按 block_index 升序返回**） |
| GET | `/reports/{reportId}/assessment` | 该报告的评估结果（四个质量维度 + 参考分） |
| POST | `/reports/{reportId}/versions` | 上传新版本（multipart） |
| GET | `/reports/{reportId}/versions/{fromVersion}/diff` | 版本差异（改了哪些块、结论增删） |
| GET | `/reports/{reportId}/export` | 导出 docx/pdf（前端用 `window.open` 下载） |
| GET | `/reports/{reportId}/export-preview` | **演示模式专用**：假后端没有文件字节，返回文本摘要给前端下载；真后端只需实现上面那条 `/export` |
| POST | `/reports/{reportId}/recheck` | 按新配置重新核查（产生新批次，旧结论保留） |

### 2.4 任务 `taskApi`（endpoints/tasks.ts）

| HTTP | 路径 | 说明 |
| --- | --- | --- |
| POST | `/tasks` | 创建核查任务；缺资料返回 409 `TASK_MISSING_INPUTS` |
| GET | `/tasks` | 任务列表（status 筛选 + 分页） |
| GET | `/tasks/{taskId}` | 任务详情（含 stages、counters） |
| POST | `/tasks/{taskId}/cancel` | 终止（已完成阶段的产物保留） |
| POST | `/tasks/{taskId}/stages/{stageCode}/retry` | 单阶段重试 |

### 2.5 主张、结论与人工复核（endpoints/claims.ts）

| HTTP | 路径 | 说明 |
| --- | --- | --- |
| GET | `/claims/{claimId}` | 主张详情（含三态结论与复核历史） |
| GET | `/claims/{claimId}/findings` | 该主张在各维度下的全部结论 |
| GET | `/findings/{findingId}` | 单条结论详情（证据、核算过程、命中规则） |
| POST | `/claims/{claimId}/reviews` | **提交人工裁决**：带 `If-Match: <revision>`；驳回必须带 reason（缺理由返回 400） |
| GET | `/claims/{claimId}/reviews` | 复核历史（只追加，AI 原始结论永远可见） |

### 2.6 复核列表 `reviewApi`（endpoints/reviews.ts）

| HTTP | 路径 | 说明 |
| --- | --- | --- |
| GET | `/reviews/summary` | 工作台的四个数字 |
| GET | `/reviews/reports` | 复核列表第一层（报告级） |
| GET | `/reviews/{reportId}/queue` | 复核列表第二层（主张级，**由后端按风险降序排**） |
| POST | `/reviews/batch` | 批量标记已核实（**只允许 verify**，批量驳回前后端都拒） |

### 2.7 研报评估 `assessmentApi`（endpoints/assessments.ts）★ 本次新增

| HTTP | 路径 | 说明 |
| --- | --- | --- |
| GET | `/assessments` | 评估列表；筛选 `project_id` / `status`；未评估返回 `status=not_started` 且 `reference_score=null`（**不要用 0 代替**） |
| GET | `/reports/{reportId}/assessment` | 评估明细（同 2.3 里那一条，两个视角共用） |

### 2.8 知识库 / 经验学习 / 审计 / 帮助 / 维度

| 资源 | HTTP | 路径 | 说明 |
| --- | --- | --- | --- |
| `knowledgeApi` | GET | `/knowledge/docs` | 文档列表（type / q / 分页） |
| | POST | `/knowledge/docs` | 上传资料（multipart；type 决定它支撑哪个维度） |
| | PATCH | `/knowledge/docs/{docId}/enable` | 启停（**只影响后续任务**） |
| | DEL | `/knowledge/docs/{docId}` | 删除（软删，审计保留） |
| | GET | `/knowledge/chunks` | 分片（排查"为什么这条规范没被检索到"） |
| `learningApi` | GET | `/learning/cases` | 经验案例 |
| | GET | `/learning/candidates` | 学习候选 |
| | POST | `/learning/candidates` | 手动触发候选生成 |
| | POST | `/learning/candidates/{candidateId}/review` | 审核（通过=发布新版本 / 驳回必填理由） |
| | GET | `/learning/versions` | 规则版本列表 |
| | POST | `/learning/versions/{versionId}/rollback` | 回滚（生成新版本，不删历史） |
| `auditApi` | GET | `/audit/events` | 审计事件（task_id / event_type / trace_id / 状态 / 分页） |
| | GET | `/audit/trace/{traceId}` | 按追踪号拉全链路 |
| `helpApi` | GET | `/help/articles` | 帮助文档列表 |
| | GET | `/help/articles/{slug}` | 单篇 |
| `dimensionApi` | GET | `/dimensions` | 维度注册表（含 required_inputs / enabled_in_modes） |

### 2.9 流式通道（endpoints 之外，见 sse.ts）

| 函数 | 方式 | 路径 | 事件 |
| --- | --- | --- | --- |
| `subscribeTaskProgress(taskId, ...)` | SSE | `GET /tasks/{taskId}/events` | `stage` / `counters` / `task` / `error` / `heartbeat` |
| `askClaimStream(claimId, question, ...)` | SSE | `POST /claims/{claimId}/ask` | `chunk` / `done` |

> SSE 用 `fetch + ReadableStream` 手写（浏览器原生 `EventSource` 不能带 Authorization 头）。
> 断线指数退避重连；连续失败自动降级为轮询并提示用户。

## 3. 假数据开关（后端没起来也能跑）

```ini
# （仓库根目录）/.env.development
VITE_USE_MOCK=true    # 走 src/api/mock 的假数据（默认）
VITE_USE_MOCK=false   # 打真实后端（vite 代理 /api → http://localhost:8000）
```

- 假数据覆盖全部页面与两条流式通道，**字段与真实接口完全一致**：切换开关不用改任何业务代码。
- 联调别人的后端：`VITE_API_DIRECT_URL=http://192.168.1.10:8000/api/v1`，或改 `vite.config.ts` 的 `VITE_PROXY_TARGET`。
- **假数据在这 5 个文件里**（`mockHandlers.ts` 只管路由分派，其余装数据）：

| 文件 | 内容 |
| --- | --- |
| `mock/mockHandlers.ts` | 假后端的路由分派 + 真实写操作（复核、批量核实、启停知识库、审核候选、删除…） |
| `mock/mockData.ts` | 研报原文块、16 条主张与结论、证据、核算过程、报告级评估 |
| `mock/mockDataMore.ts` | 报告列表、任务与阶段、审计事件、知识库、经验学习、帮助文档（`MOCK_HELP_ARTICLES`） |
| `mock/mockAssessments.ts` | 评估列表；`buildAssessmentRows()` 由报告明细汇总，统计数字不许手写 |
| `mock/mockStream.ts` | 两条流式通道（任务进度、单条追问）的模拟 |

> **没有"项目"假数据** —— 项目改成桌面端本地文件夹管理了（见第 6 节），
> 只有研报、评估这类业务数据还在后端契约里；`endpoints/projects.ts` 保留给将来的"项目云归档 / 团队共享"。

## 4. 对接时的四条约定

1. **字段名以 `types.ts` 为准**：后端加字段前端不用动；**删字段或改名必须两边同时改**。
2. **错误体统一** `{ code, message, details, trace_id }`；前端直接展示 `message`，不自己编业务文案。
3. **排序由后端定**：原文顺序、复核队列风险降序、复核优先级的 tie-break —— 前端不传排序参数，避免两处口径不一致。
4. **"没做"≠"没问题"**：未覆盖 / 未评估 / 待复核必须如实返回（`uncovered`、`not_started`、`pending`），
   不要用 0 分、空数组或 `pass` 代替 —— 前端会把它显示成"通过"，那是产品事故。

## 5. 联调排查顺序（出现问题时按这个顺序查）

1. `.env.local` 里 `VITE_USE_MOCK` 是不是 true（默认 true，会拦住真实请求）；
2. 浏览器 Network 里看请求有没有发出去、路径对不对（前缀 `/api/v1`）；
3. 401 → 看 `Authorization: Bearer` 与 `/auth/refresh`；409 → 多半是 `TASK_MISSING_INPUTS`（缺资料）或复核 `revision` 冲突；
4. 字段对不上 → 打开 `types.ts` 对照；状态显示成"通过"但实际没查 → 看第 4 节第 4 条；
5. 拿报错里的 `trace_id` 去 `GET /audit/trace/{traceId}`，或让前端点开"审计日志"页粘贴该 trace_id。

> 本表是从 `endpoints/*.ts` 的实际调用逐条提取的（**约 50 条 HTTP + 2 条流式通道**；此前这里写的 36 是旧数，
> 新增接口后没有跟着更新，已按代码重新数过）。
> **新增接口时必须同时改两处：`endpoints/` 下的函数 + 本文件第 2 节的表**，否则下表就会骗人。
---

## 6. 桌面端本地能力（不走 HTTP，别去后端找）

这些操作必须由系统原生完成（浏览器拿不到真实路径），所以走 Electron 主进程；
页面只调用 `src/api/local/desktop.ts` 包装好的 7 个方法：

| 方法 | 对应主进程 IPC | 作用 |
| --- | --- | --- |
| `desktop.pickReportFile()` | `project:pickReportFile` | 系统「打开文件」窗口 → 返回研报**绝对路径**（取消返回 null） |
| `desktop.pickKnowledgeDir()` | `project:pickKnowledgeDir` | 系统「选择文件夹」窗口 → 返回知识库**绝对路径** |
| `desktop.createProject(payload)` | `project:create` | 在工作区建项目文件夹 + 写 `project.json` + 建 `data/` |
| `desktop.listProjects()` | `project:list` | 列工作区全部项目（按创建时间倒序；坏配置自动跳过） |
| `desktop.openProject(id)` | `project:open` | 读某个项目的配置 |
| `desktop.openInExplorer(path)` | `project:openInExplorer` | 在资源管理器里打开项目文件夹 |
| `desktop.workspaceDir()` | `project:workspaceDir` | 工作区根目录（界面显示「文件都存在哪」） |

- 工作区：`<文档>/RQC 项目库`；一个项目 = 一个文件夹（`project.json` + `data/`）。
- 重名自动加后缀、非法字符自动清洗、坏配置不炸列表、PDF 页数（含压缩对象流）与配置读写 —— 36 项测试覆盖（`npm run verify:store`）。
- 纯浏览器打开时 `window.rqc` 不存在，`desktop.isDesktop()` 返回 false，工作台会提示改用桌面端启动。
---

## 7. 应用配置（也不走 HTTP，存在本地 settings.json 里）

设置页里那些选项不是后端接口，而是**本地配置文件**，由桌面端主进程读写：

| 走哪 | 说明 |
| --- | --- |
| 文件位置 | 应用数据目录下的 `settings.json`（设置页右上角"配置文件位置"能直接打开） |
| 读写方式 | `src/api/local/desktop.ts` 的 `getSettings() / saveSettings(patch) / resetSettings() / pickWorkspaceDir()` |
| 默认值 | 定义在 `electron/projectStore.cjs` 的 `DEFAULT_SETTINGS`；读取时**以默认值为底做深合并**，所以老配置文件缺字段不会出问题 |
| 生效方式 | 保存后立刻接进 api 层（`setRuntimeApiOptions`，见 `client.ts`）：**改数据模式 / 接口地址不用重启应用** |

配置分五栏：**工作区与数据 / 模型与推理 / 核查判据 / 知识库检索 / 界面偏好**。
其中"模型 / 判据 / 知识库"这三栏会随每次任务提交给后端（见 `TaskSubmitPayload`），
也就是说：**这些配置真的会影响核查行为，不是摆设**。

## 8. 删除类接口（经验学习）

经验学习以前只有"增加"，现在补齐了删除。三条规矩不一样，后端也要各自拦：

| 方法 | 路径 | 谁能删 | 附加条件 |
| --- | --- | --- | --- |
| DELETE | `/learning/candidates/{id}` | **任何状态都能删** | 已审核过的（approved / rejected）**必须带 `reason`**，否则 400 —— 它记着"当初为什么通过 / 驳回" |
| DELETE | `/learning/cases/{id}` | 任何案例都能删 | 无 |
| DELETE | `/learning/versions/{id}` | **任何状态都能删（含生效中）** | 删掉生效中的版本时，后端**自动把同一 key 下最近的历史版本切回 `active`**，并通过返回值 `promoted` 告知切到了哪一版；若该 key 已无历史版本，`promoted` 为 `null`（该规则退回默认判据） |

**删除一律写审计事件**（`auditEvents` 里加一条 `*_deleted`，生效版本还会记下"自动切回了哪一版"），所以"东西怎么没了"永远查得到 —— 删除不等于抹掉痕迹。
