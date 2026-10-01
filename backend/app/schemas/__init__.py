"""响应/请求模型：与前端 src/api/types.ts **逐字段对齐**（这是接口契约的代码化）。

为什么单独一层：FastAPI 用这些模型做 ① 出参校验 ② 自动文档（/docs 就是前端要的接口表）
③ 请求体校验。字段名写错会在这里被立刻发现，而不是等前端联调才发现"页面永远空白"。

约定：所有模型 model_config = ConfigDict(from_attributes=True)，
所以领域对象（dataclasses）与 ORM 对象都能直接返回，不用手写转换。
"""
