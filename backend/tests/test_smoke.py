"""冒烟测试：证明骨架**真的能跑**，而且"未实现"的语义符合约定。

这些断言就是骨架的验收标准：
  1. /health 活着；
  2. 路由表里真的注册了 P0 那几条（少一条就是骨架没搭全）；
  3. 唯一已实现的接口（GET /dimensions）返回真实数据；
  4. 未实现接口返回 501 + 统一错误体 + 中文说明（前端会据此明确报错，不会静默）；
  5. X-Trace-Id 会被原样回传（用户报障靠它）。
"""
from __future__ import annotations

P0_PATHS = [
    ("POST", "/reports/ensure"),
    ("POST", "/tasks"),
    ("GET", "/tasks/{task_id}"),
    ("GET", "/tasks/{task_id}/events"),
    ("GET", "/reports/{report_id}/blocks"),
    ("GET", "/reports/{report_id}/claims"),
    ("POST", "/claims/{claim_id}/reviews"),
]


def test_health(client) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_p0_routes_registered(client, api) -> None:
    """P0 七条必须都在路由表里（骨架的完整性检查）。

    注意：OpenAPI 里的路径带 /api/v1 前缀 —— 前端也是拼这个前缀的。
    """
    spec = client.get("/openapi.json").json()
    registered = {(m.upper(), path) for path, item in spec["paths"].items() for m in item}
    missing = [p for p in P0_PATHS if (p[0], api + p[1]) not in registered]
    assert not missing, f"路由表缺 P0 接口: {missing}"


def test_dimensions_returns_real_data(client, api) -> None:
    """维度注册表是唯一"骨架期就已经实现"的接口（数据来自 domain 层）。"""
    resp = client.get(f"{api}/dimensions")
    assert resp.status_code == 200
    items = resp.json()
    codes = {d["code"] for d in items}
    assert {"calc", "fact", "norm"} <= codes, "P0 三个维度必须在注册表里"
    assert all("enabled_in_modes" in d and "required_inputs" in d for d in items)


def test_unimplemented_returns_501_with_contract_body(client, api) -> None:
    """未实现接口 -> 501 + 统一错误体：前端会明确报错，而不是拿到空数据。"""
    resp = client.get(f"{api}/reports/rpt-1/blocks")
    assert resp.status_code == 501
    body = resp.json()
    assert body["code"] == "NOT_IMPLEMENTED"
    assert "还没实现" in body["message"]


def test_trace_id_echoed(client, api) -> None:
    """X-Trace-Id 必须原样回传（响应头 + 错误体里都要有）。"""
    resp = client.get(f"{api}/reports/rpt-1/blocks", headers={"X-Trace-Id": "tr-test-0001"})
    assert resp.headers["X-Trace-Id"] == "tr-test-0001"
    assert resp.json()["trace_id"] == "tr-test-0001"


def test_validation_error_shape(client, api) -> None:
    """参数不合法 -> 统一错误体（前端按 code 显示字段级提示）。"""
    resp = client.post(f"{api}/tasks", json={})
    assert resp.status_code == 422
    assert resp.json()["code"] == "VALIDATION_ERROR"
