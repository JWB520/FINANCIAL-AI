"""基础设施层：实现 domain/ports 里的端口（仓储、模型网关、工具、解析、检索、存储、审计、进度）。

一条纪律：本层可以 import domain，**domain 永远不 import 本层**（依赖单向，03_后端架构.md §0）。
骨架期这里全是接口 + 待实现的类，实现顺序建议：db/session -> repos -> llm/gateway -> tools。
"""
