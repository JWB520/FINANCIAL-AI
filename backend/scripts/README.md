
# 脚本目录

放"一次性但会重复用"的脚本，每个都要能重复执行（幂等）：

| 脚本 | 用途 | 现状 |
| --- | --- | --- |
| `seed_demo.py` | 灌一份演示数据（一份研报 + 若干主张 + 结论），让联调不依赖前端 mock | 待实现 |
| `reindex_kb.py` | 重建知识库索引（改了切片策略后重跑） | 待实现 |
| `check_contract.py` | 手工跑一次契约比对（等价于 `pytest tests/test_contract.py`） | 待实现 |
| `gate.py` | **已实现**：每日闸门（pytest + ruff + compileall + 接口对账），推代码前必跑 | 可用 |
| `dump_routes.py` | **已实现**：打印后端全部路由，并与前端 `endpoints/*.ts` 的调用点对账（交付/回归时跑它） | 可用 |

约定：脚本一律用 `python -m scripts.xxx` 跑，并支持 `--dry-run`。
