"""每日闸门：推代码前跑这一个命令就够了。

    python scripts/gate.py

四道检查，任何一道失败就 exit 1（不允许"先推后修"）：
    1. 单元测试      pytest -q                     骨架与契约、领域口径
    2. 静态检查      ruff check app tests scripts
    3. 语法编译      compileall
    4. 接口对账      dump_routes.py                前端每个调用点后端都有路由

为什么要有它：三条跑道并行时，最容易出现"我这边绿、合起来红"。
闸门把四个人的检查合成一条命令：谁推代码谁先跑，红了先修再推，别让别人替你发现。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
LINE = "=" * 62


def run(title: str, args: list[str]) -> bool:
    print(LINE)
    print("=== " + title)
    print(LINE)
    proc = subprocess.run(args, cwd=BACKEND, capture_output=True, text=True, encoding="utf-8")
    out = (proc.stdout or "") + (proc.stderr or "")
    lines = [line for line in out.splitlines() if line.strip()]
    tail = lines[-10:] if len(lines) > 10 else lines      # 只回显最后几行，避免刷屏
    for line in tail:
        print("   ", line)
    ok = proc.returncode == 0
    print("    -> " + ("通过" if ok else "失败") + "（退出码 " + str(proc.returncode) + "）")
    print()
    return ok


def main() -> int:
    results = {
        "单元测试": run("1/4 单元测试（pytest）", [sys.executable, "-m", "pytest", "-q"]),
        "静态检查": run(
            "2/4 静态检查（ruff）",
            [sys.executable, "-m", "ruff", "check", "app", "tests", "scripts"],
        ),
        "语法编译": run(
            "3/4 语法编译（compileall）",
            [sys.executable, "-m", "compileall", "-q", "app", "tests", "scripts"],
        ),
        "接口对账": run(
            "4/4 接口对账（前端调用点 vs 后端路由）",
            [sys.executable, "scripts/dump_routes.py"],
        ),
    }

    print(LINE)
    print("闸门汇总")
    print(LINE)
    for name, ok in results.items():
        print("   " + ("✓ " if ok else "✗ ") + name)

    failed = [name for name, ok in results.items() if not ok]
    print()
    if failed:
        print("结果：不通过（" + "、".join(failed) + "）—— 先修好再推，别让别人替你发现。")
        return 1
    print("结果：全部通过 —— 可以推。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
