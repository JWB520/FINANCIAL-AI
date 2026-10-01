"""把后端真实注册的路由全打印出来，并与前端调用点对账。

用法（在 backend 目录下）：
    python scripts/dump_routes.py

输出的三块（都是交付时要贴给用户的证据）：
  1. 按标签分组的路由清单 + 总数
  2. 前端 endpoints/*.ts 里的调用点，哪些后端没有对应路由（应为 0）
  3. P0 七条是否都已注册
"""
from __future__ import annotations

import pathlib
import re
import sys

BE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BE))

from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402

FE_ENDPOINTS = BE.parent / "frontend" / "src" / "api" / "endpoints"

P0 = [
    ("POST", "/reports/ensure"),
    ("POST", "/tasks"),
    ("GET", "/tasks/{p}"),
    ("GET", "/tasks/{p}/events"),
    ("GET", "/reports/{p}/blocks"),
    ("GET", "/reports/{p}/claims"),
    ("POST", "/claims/{p}/reviews"),
]


def _args_of_calls(text: str):
    """抽出每个调用表达式里"第一个参数"的原始文本（到该参数结束为止）。"""
    for m in re.finditer(r"client\.(get|post|patch|put|delete)(?:<[^>]*>)?\(", text):
        meth = m.group(1)
        i, depth, buf = m.end(), 1, []
        while i < len(text) and depth:
            ch = text[i]
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth -= 1
                if depth == 0:
                    break
            if ch == "," and depth == 1:
                break
            buf.append(ch)
            i += 1
        yield meth, "".join(buf).strip()


def _path_of(arg: str) -> str | None:
    """把第一个参数还原成路径模板。

    要处理三种写法：
        '/reports/' + reportId + '/blocks'   拼串
        `/reports/${reportId}/blocks`        模板串
        '/reports/ensure'                    纯字面量
    做法：按 + 拆 token，字面量取内容（${..} 换成 {p}），表达式一律换成 {p}。
    """
    if not arg or arg[0] not in "'\"`":
        return None
    parts: list[str] = []
    for tok in re.split(r"\s*\+\s*", arg):
        tok = tok.strip()
        if tok[:1] in ("'", '"', "`") and tok[-1:] == tok[:1] and len(tok) >= 2:
            lit = tok[1:-1]
            lit = re.sub(r"\$\{[^}]+\}", "{p}", lit)
            parts.append(lit)
        else:
            parts.append("{p}")
    return _norm("".join(parts))


def _frontend_calls(text: str) -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for meth, arg in _args_of_calls(text):
        path = _path_of(arg)
        if path:
            found.add((meth.upper(), path))
    return found


def _norm(path: str) -> str:
    """把路径参数统一成 {p}，便于两边比较。

    要同时处理两种写法：后端的 {report_id} 与前端的 ${reportId}（模板串）。
    """
    path = re.sub(r"\$\{[^}]+\}", "{p}", path)
    return re.sub(r"\{[^}]+\}", "{p}", path).rstrip("/")


def main() -> int:
    prefix = get_settings().api_prefix

    routes: list[tuple[str, str, str]] = []
    for r in app.routes:
        path = getattr(r, "path", None)
        methods = getattr(r, "methods", None)
        if not path or not methods or not path.startswith(prefix):
            continue
        tag = (getattr(r, "tags", None) or ["(无)"])[0]
        for m in sorted(methods - {"HEAD", "OPTIONS"}):
            routes.append((tag, m, path))

    print("=== 后端真实注册的端点（按标签分组）===")
    by_tag: dict[str, list[str]] = {}
    for tag, m, path in routes:
        by_tag.setdefault(tag, []).append(f"{m:6s} {path}")
    for tag, items in by_tag.items():
        print(f"\n-- {tag}（{len(items)} 条）")
        for it in sorted(items):
            print("   ", it)
    print(f"\n端点合计 = {len(routes)} 条")

    be = {(m, _norm(path[len(prefix):])) for _, m, path in routes}

    fe: set[tuple[str, str]] = set()
    if FE_ENDPOINTS.exists():
        for f in FE_ENDPOINTS.glob("*.ts"):
            fe |= _frontend_calls(f.read_text(encoding="utf-8"))

    print("\n=== 前端调用点对账 ===")
    print(f"前端调用点（正则能抓到的）= {len(fe)} 个")
    missing = sorted(f"{m} {p}" for m, p in fe if (m, p) not in be)
    for x in missing:
        print("   缺:", x)
    if not missing:
        print("   -> 前端每一条调用都能在后端找到路由 ✓")

    print("\n=== P0 七条 ===")
    ok = True
    for m, p in P0:
        hit = (m, p) in be
        ok = ok and hit
        print(f"   {m:5s} {p:35s} {'✓ 已注册' if hit else '✗ 缺'}")
    return 0 if ok and not missing else 1


if __name__ == "__main__":
    raise SystemExit(main())
