"""命令行跑一次「数字复算」勘误（不用起前端、不用起服务）。

用法：
    cd backend
    python scripts/run_errata_lab.py "D:\\研报\\某份研报.pdf"
    python scripts/run_errata_lab.py 某份.pdf --pages 1-8 --max-sentences 40
    python scripts/run_errata_lab.py 某份.pdf --no-llm --json out.json

它复用与页面完全相同的链路（同一份 service / checker / 复算器），
所以命令行跑出来的结论，与页面上看到的逐条一致 —— 用来先证明引擎，
再联调页面，出问题时能立刻分清"是引擎还是界面"。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

# 允许直接 python scripts/xxx.py 运行（把 backend/ 加进 sys.path）
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.application.errata_lab_service import ErrataLabService  # noqa: E402
from app.config import get_settings  # noqa: E402

STATUS_LABEL = {
    "risk": "!! 有问题",
    "pass": "✔ 复算一致",
    "uncovered": "· 未覆盖",
    "error": "× 核查失败",
}


def parse_pages(raw: str | None) -> dict[str, int] | None:
    if not raw:
        return None
    if "-" not in raw:
        value = int(raw)
        return {"from": value, "to": value}
    low, _, high = raw.partition("-")
    return {"from": int(low), "to": int(high)}


async def main() -> int:
    parser = argparse.ArgumentParser(description="跑一次数字复算勘误（命令行）")
    parser.add_argument("report", help="研报 PDF 路径")
    parser.add_argument("--pages", help="页码范围，如 1-8；不填=全篇")
    parser.add_argument("--types", default="calc_number", help="勾选的勘误项 code（逗号分隔）")
    parser.add_argument("--max-pages", type=int, default=None, help="最多核查多少页（一页一次模型调用）")
    parser.add_argument("--no-llm", action="store_true", help="强制走规则兜底（不调大模型）")
    parser.add_argument("--json", dest="json_out", help="把完整结果写成 JSON 文件")
    args = parser.parse_args()

    settings = get_settings()
    service = ErrataLabService(settings)
    llm_status = service.llm_status()
    print(f"模型状态：{'已接入 ' + llm_status['model'] if llm_status['available'] else '未接入 — ' + str(llm_status['reason'])}")
    print(f"提示词版本：{service.prompt_versions()}")

    result = await service.run(
        report_path=args.report,
        types=[code.strip() for code in args.types.split(",") if code.strip()],
        page_range=parse_pages(args.pages),
        use_llm=not args.no_llm,
        max_pages=args.max_pages,
    )

    stats = result["stats"]
    print(f"\n{result['report_name']}｜共 {result['pages_total']} 页｜耗时 {result['elapsed_ms']} ms")
    print(
        f"扫描含数字句子 {stats['sentences_scanned']} 句 → 批注 {stats['annotations_total']} 条"
        f"（有问题 {stats['risk']} / 一致 {stats['pass']} / 未覆盖 {stats['uncovered']}）"
        f"｜算式来自：AI {stats['extracted_by_llm']} 条、规则 {stats['extracted_by_rule']} 条"
    )
    llm = result["llm"]
    print(f"模型调用：{llm['calls']} 次，约 {llm['tokens_est']} tokens，耗时 {llm['elapsed_ms']} ms")
    for note in result["notes"]:
        print(f"提示：{note}")

    print("\n" + "=" * 78)
    for index, annotation in enumerate(result["annotations"], 1):
        label = STATUS_LABEL.get(annotation["status"], annotation["status"])
        page = annotation["page"]
        print(f"\n[{index}] 第 {page} 页 {label}  （算式来源：{annotation['extracted_by']}）")
        print(f"    原文：{annotation['statement'][:110]}")
        if annotation["expression"]:
            steps = "；".join(f"{s['expression']}={s['value']}" for s in annotation["steps"][-3:])
            print(f"    算式：{annotation['expression']}  →  {steps}")
            print(f"    复算：{annotation['computed']}{annotation['unit']}   原文声称：{annotation['claimed']}{annotation['unit']}")
        print(f"    批注：{annotation['conclusion']}")
        if annotation.get("suggestion"):
            print(f"    建议：{annotation['suggestion']}")

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n完整结果已写入：{args.json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
