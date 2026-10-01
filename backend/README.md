# RQC 后端 · 研报核查与质量评估平台（骨架）

这一份是**能跑起来的骨架**：路由、契约、分层、错误码、领域规则都定好了，
每个端点的函数体是 `not_implemented(...)` —— 调它返回 **501 + 中文说明**，
所以前端联调时能立刻看到"这条还没做"，而不会静默拿到空数据（那最容易被误读成"没有问题"）。

契约的唯一事实来源是前端 `frontend/src/api/types.ts`；实现顺序见 `frontend/BACKEND.md` 的 P0 七条。

> **三个人怎么分工、边界在哪、每天怎么推代码** → 见 [`docs/团队分工与协作约定.md`](docs/团队分工与协作约定.md)。
> 推代码前跑一次闸门：`python scripts/gate.py`（测试 / 静态检查 / 语法编译 / 接口对账四道）。

---

## 1. 五分钟跑起来

```bash
cd backend
pip install -r requirements.txt          # 或 pip install -e ".[dev]"
cp .env.example .env                     # 按需改端口/模型 Key
python -m uvicorn app.main:app --reload
```

三个地址，联调前先自己看一眼：

| 地址 | 看什么 |
| --- | --- |
| `http://localhost:8000/health` | 存活探针，返回 `{"status": "ok"}` |
| `http://localhost:8000/docs` | 交互式接口文档 —— **骨架期它就是待办清单**（每个端点都有中文说明与响应模型） |
| `http://localhost:8000/api/v1/dimensions` | 唯一已经返回真实数据的接口（维度注册表来自 `app/domain/dimensions.py`） |

自测（不需要数据库、不需要模型 Key）：

```bash
python -m pytest -q                       # 12 项：冒烟 + 契约对齐 + 领域口径
```

不装队列也能跑：`celery` 只在真正投递任务时才需要（骨架期 import 失败会退化成占位对象）。

## 2. 目录导览：每一层谁负责什么

严格单向依赖（`03_后端架构.md §0`）：**接口层 → 应用层 → 领域层 ← 基础设施层**。

| 目录 | 负责 | 不负责（红线） | 对应前端 |
| --- | --- | --- | --- |
| `app/api/routers/` | 收参数、校验、鉴权、调用例、组响应 | 不写 SQL、不写业务分支、不调模型 | `src/api/endpoints/*.ts` |
| `app/schemas/` | 响应/请求模型（契约的代码化） | 不做业务判断 | `src/api/types.ts` |
| `app/application/` | 编排用例、事务边界、投队列、写审计 | 不拼提示词、不自己算数 | 每个 `*_service` 对应一个资源 |
| `app/agents/` | 调工具与模型，产出**结论草稿** | 不直接写库、不改状态 | — |
| `app/domain/` | 实体、枚举、维度表、定级规则、覆盖率口径、端口 | 不 import 基础设施、不连库 | `src/api/enums.ts` |
| `app/infra/` | 实现 `domain/ports` 的端口（仓储/模型网关/工具/解析/检索/存储/审计/进度） | 不写业务规则 | — |
| `app/workers/` | 消费队列、驱动五个阶段、重试、发进度 | 不承载 HTTP 逻辑 | SSE / 进度页 |
| `app/common/` | 日志、trace、分页、文本偏移、时间 | — | `client.ts` 的错误体 |
| `docs/` | 团队分工与协作约定（谁做什么、边界、共同约定） | — | — |
| `scripts/` | `gate.py` 每日闸门 · `dump_routes.py` 接口对账 | — | — |

三个"骨架期就已经能看"的地方：
`app/domain/dimensions.py`（维度只在这加）、`app/domain/coverage.py`（覆盖率唯一口径）、
`app/api/errors.py`（错误码与前端词典逐字一致）。

## 3. 实现一条接口的固定四步

以 `GET /reports/{reportId}/blocks` 为例，**不要跳步**：

| 步 | 做什么 | 落到哪个文件 |
| --- | --- | --- |
| 1 | 实现用例 | `app/application/report_service.py` 的 `list_blocks()`：改成真实现，返回领域对象 |
| 2 | 实现取数 | `app/infra/repos/`：先 `memory.py` 跑通，再写 SQL 版（行为对齐 memory） |
| 3 | 摘掉占位 | `app/api/routers/reports.py` 里把 `not_implemented(...)` 换成 `return await svc.list_blocks(...)` |
| 4 | 加测试 | `tests/test_smoke.py` 里补一条：断言 200 + 字段名 + 顺序（按 `block_index` 升序） |

第 3 步之后跑 `python -m pytest -q` 与 `python -m ruff check app`，两条都干净才算完。

**顺序硬要求**：`blocks` 按 `block_index` 升序、`claims` 也按它升序（前端左右联动靠这个顺序）；
未知 id 必须 404，**禁止兜底成第一条**（前端会以为打开了另一份报告）。

## 4. P0 七条（先做这七条，前端三条主线就全通了）

| # | 接口 | 前端什么时候调 | 后端落点 | 注意 |
| --- | --- | --- | --- | --- |
| 1 | `POST /reports/ensure` | 打开本地项目 | `report_service.ensure` | **必须幂等**：同 project+path 不许建两份 |
| 2 | `POST /tasks` | 任务单点「发送」 | `task_service.create` | 缺资料 → 409 `TASK_MISSING_INPUTS`，`details.missing_inputs` 列清单 |
| 3 | `GET /tasks/{id}` | 进度页 5 秒轮询 | `task_service.get` | 要便宜；未知 id 404 |
| 4 | `GET /tasks/{id}/events` | 进度页 SSE | `workers/progress` + `api/sse_util` | 每 5 秒一个 heartbeat，否则前端降级成轮询 |
| 5 | `GET /reports/{id}/blocks` | 复核裁决页左栏 | `report_service.list_blocks` | 绝对字符区间（前端高亮靠它） |
| 6 | `GET /reports/{id}/claims` | 复核裁决页右栏 | `report_service.list_claims` | 按 `block_index` 升序 |
| 7 | `POST /claims/{id}/reviews` | 提交人工裁决 | `review_service.submit` | 驳回必填理由；`If-Match` 比 `revision` |

第 7 条不做，整个「人工复核」主线就断了；第 1 条不做，项目里三个入口都点不开。

## 5. 五条不能违背的约定（产品红线，测试与评审都会查）

1. **未覆盖 ≠ 通过**：没查成 → `status="uncovered"` + `uncovered_reason`，绝不写 `pass`；
2. **没做过 ≠ 0 分**：未评估的指标是 `null`，不是 `0`（参考分、覆盖率同理）；
3. **三态结论**：`ai_conclusion` / `human_conclusion` / `effective_conclusion` 同时给，
   没有人工动作时生效结论是「待复核」而不是「通过」；
4. **凡删必留痕**：删除一律软删 + 审计事件；删生效中的规则版本要自动把上一版切回生效，
   并在返回里用 `promoted` 说明切到了哪一版；
5. **驳回必须写理由**：`reason` 为空 → 400 `REVIEW_REASON_REQUIRED`（它是经验学习的原料）。

## 6. 自测：三件事都要会跑

| 命令 | 作用 |
| --- | --- |
| `python -m pytest -q` | 全量：冒烟（骨架完整性与 501 语义）+ 契约对齐 + 领域口径 |
| `python -m pytest tests/test_contract.py -q` | 只跑契约：拿前端 `types.ts` 逐字段比对我们的模型（防止字段漂移） |
| `python -m ruff check app` | 静态检查 |

**新写的自检必须能失败**：故意把 `Finding.status` 改名跑一次，契约测试要变红、改回要变绿 ——
不会失败的自检等于没有自检。

## 7. 与前端联调

1. 后端起在 8000（`RQC_HTTP_BIND_PORT` 可改），前端 `vite.config.ts` 已把 `/api` 代理到这里；
2. 前端把 `VITE_USE_MOCK` 关掉（`.env.development` 里改 `false`）就会走真接口；
3. 未实现的接口会返回 `code=NOT_IMPLEMENTED`，前端会明确报错 —— **这是设计好的行为**，
   实现完自然就没了；
4. 报障时让用户把页面上的 trace_id 给你，用 `GET /audit/trace/{traceId}` 拉全链路。

## 8. 还剩什么（grep 就能查）

```bash
grep -rn "not_implemented(" app/api/routers | wc -l     # 还没实现的端点
grep -rn "NotImplementedError" app/ | wc -l             # 还没实现的层内方法
grep -rn "TODO(实现)" app/                              # 留了实现提示的地方
```

优先级：P0 七条 → P1（版本 diff、导出、知识库、评估）→ P2（学习、审计、项目云归档）。
每实现一条，顺手把 `frontend/BACKEND.md` 的对应行标成已完成 —— 那份文档是前后端的交接单。
