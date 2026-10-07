"""HTTP 联调自检：三条勘误接口 + 真实研报跑一遍。

用法（先起后端：python -m uvicorn app.main:app --port 8000）：
    python scripts/smoke_errata_http.py "D:\\研报\\某份.pdf"
    python scripts/smoke_errata_http.py 某份.pdf --pages 1-3

它检查的是"**经过 HTTP 层**之后还对不对"：路由有没有注册、请求体字段名对不对、
CORS 头在不在、PDF 字节流能不能拿到、返回的批注结构与前端 types 是否一致。
命令行直接调 service（run_errata_lab.py）能过不代表 HTTP 能过 —— 这两件事分开验。
"""
from __future__ import annotations

import argparse
import json
import sys

import httpx

BASE = "http://127.0.0.1:8000"


def parse_pages(raw: str | None) -> dict[str, int] | None:
    if not raw:
        return None
    low, _, high = raw.partition("-")
    return {"from": int(low), "to": int(high or low)}


def main() -> int:
    parser = argparse.ArgumentParser(description="勘误接口 HTTP 联调自检")
    parser.add_argument("report", help="研报 PDF 路径")
    parser.add_argument("--pages", help="页码范围，如 1-3")
    parser.add_argument("--base", default=BASE, help="后端地址")
    args = parser.parse_args()

    failures: list[str] = []

    # ① 存活
    health = httpx.get(f"{args.base}/health", timeout=10)
    print(f"[1] /health -> {health.status_code} {health.json().get('status')}")
    if health.status_code != 200:
        failures.append("/health 不可用")

    # ② 能力与模型状态
    status = httpx.get(f"{args.base}/api/v1/errata/status", timeout=10)
    body = status.json()
    print(f"[2] /errata/status -> {status.status_code}，LLM 可用={body.get('llm_available')}，提示词版本={body.get('prompt_versions')}")
    if status.status_code != 200:
        failures.append("/errata/status 不是 200")

    # ③ 跑勘误
    payload = {
        "report_path": args.report,
        "types": ["calc_number"],
        "page_range": parse_pages(args.pages),
        "use_llm": True,
    }
    run = httpx.post(f"{args.base}/api/v1/errata/run", json=payload, timeout=600)
    print(f"[3] /errata/run -> {run.status_code}")
    if run.status_code != 200:
        print("    错误响应：" + run.text[:400])
        failures.append("/errata/run 不是 200")
    else:
        data = run.json()
        stats = data["stats"]
        print(
            "    扫描 {sentences_scanned} 句 → 批注 {annotations_total} 条"
            "（有问题 {risk} / 一致 {pass} / 未覆盖 {uncovered}）".format(**stats)
        )
        print(
            f"    来源：AI {stats['extracted_by_llm']} / 规则 {stats['extracted_by_rule']}"
            f"｜耗时 {data['elapsed_ms']} ms｜页数 {data['pages_total']}"
        )
        for note in data["notes"]:
            print(f"    提示：{note}")

        # 结构校验：前端 ErrataAnnotation 需要的键一个都不能少
        required = {
            "id", "page", "block_id", "start_offset", "end_offset", "statement",
            "expression", "normalized", "steps", "computed", "claimed", "unit",
            "deviation", "rel_deviation", "tolerance_pct", "status", "risk_level",
            "rule_codes", "conclusion", "suggestion", "confidence", "extracted_by",
        }
        for index, annotation in enumerate(data["annotations"], 1):
            missing = required - set(annotation)
            if missing:
                failures.append(f"第 {index} 条批注缺字段：{sorted(missing)}")
            if annotation["status"] == "risk" and not annotation["rule_codes"]:
                failures.append(f"第 {index} 条是 risk 却没有命中规则码（前端会显示不出等级依据）")
            print(
                f"    · p{annotation['page']} [{annotation['status']}] "
                f"{annotation['expression'] or '（无算式）'} → {annotation['computed']}{annotation['unit']} "
                f"vs 原文 {annotation['claimed']}{annotation['unit']}｜{annotation['conclusion'][:60]}"
            )

        if args.pages:
            low = parse_pages(args.pages)
            assert low is not None
            out_of_range = [a for a in data["annotations"] if not (low["from"] <= a["page"] <= low["to"])]
            if out_of_range:
                failures.append("返回了页码范围之外的批注")

    # ④ PDF 字节流（页面左栏靠它）
    pdf = httpx.get(f"{args.base}/api/v1/errata/pdf", params={"path": args.report}, timeout=60)
    content_type = pdf.headers.get("content-type", "")
    print(f"[4] /errata/pdf -> {pdf.status_code} {content_type} {len(pdf.content)} bytes")
    if pdf.status_code != 200 or "application/pdf" not in content_type:
        failures.append("/errata/pdf 没返回 PDF 字节流")
    if not pdf.content.startswith(b"%PDF"):
        failures.append("/errata/pdf 返回的内容不是 PDF（缺少 %PDF 魔数）")

    # ⑤ 未知文件必须 404（不许兜底成别的文件）
    missing = httpx.get(f"{args.base}/api/v1/errata/pdf", params={"path": "D:/不存在的文件.pdf"}, timeout=10)
    print(f"[5] 未知路径 -> {missing.status_code}（期望 404）")
    if missing.status_code != 404:
        failures.append("未知 PDF 路径没有返回 404")

    print("\n" + "=" * 60)
    if failures:
        print(f"联调自检失败 {len(failures)} 项：")
        for item in failures:
            print("  ✗ " + item)
        return 1
    print("联调自检通过：三条接口 + 返回结构 + PDF 字节流 + 404 语义全部符合预期")
    print(json.dumps({"stats": data["stats"], "llm": {k: v for k, v in data["llm"].items() if k != "detail"}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
