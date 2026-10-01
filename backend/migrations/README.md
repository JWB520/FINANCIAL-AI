
# 数据库迁移（Alembic）

骨架期还没有表，所以这里只写约定：

1. 表模型写在 `app/infra/models/`（继承 `app/infra/db/base.py` 的 `Base`）；
2. 生成迁移：`alembic revision --autogenerate -m "add reports"`；
3. 应用迁移：`alembic upgrade head`；
4. **迁移文件要提交进仓库**，不要靠"手工改库"。

实现顺序建议：先建 reports / report_versions / blocks / claims / tasks / task_stages 这六张表，
它们足够让 P0 七条接口跑通；其余（findings / evidences / audit / knowledge / learning）随后补。
