"""提示词加载与版本解析。

为什么要版本化：审计事件里要记 prompt_version（结论能追溯到"当时用的是哪版提示词"）。
改动提示词 = 新增一个 vN 文件，**不要原地改**（否则历史结论无法复现）。

【文件命名】`{key}.v{版本号}.md`，例如 `extract_numbers.v1.md`。
取提示词时不给版本，就取该 key 下**最大版本号**的文件（= 最新）。

【占位符语法】模板里用 `{{变量名}}`（双方括号），不是 Python 的 `{变量名}`。
原因很实际：这两份提示词里大段是 JSON 示例，满屏 `{` `}`；若用 str.format，
必须把每个 JSON 花括号写成 `{{`，改一次提示词就要重数一遍括号，
迟早有人写错、提示词直接渲染失败。用 `{{ }}` 就完全避开了这个坑。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

PROMPT_DIR = Path(__file__).parent

# {{ 变量名 }}，变量名只允许 ascii 标识符
_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
_PROMPT_FILE = re.compile(r"^(?P<key>.+)\.v(?P<version>\d+)\.md$")


@dataclass(frozen=True)
class Prompt:
    key: str
    version: int
    template: str        # 里面用 {{变量}} 占位


class PromptNotFound(KeyError):
    """没有这个提示词（拼错 key 或忘了建文件）。"""


class PromptVariableMissing(KeyError):
    """模板里的变量没传值 —— 必须报错，不许把 {{xxx}} 原样发给模型。"""


class PromptRegistry:
    def load(self, key: str, version: int | None = None) -> Prompt:
        """取提示词：不给版本就取最大版本号（最新）。"""
        found: dict[int, Path] = {}
        if PROMPT_DIR.exists():
            for path in PROMPT_DIR.glob(f"{key}.v*.md"):
                match = _PROMPT_FILE.match(path.name)
                if match and match.group("key") == key:
                    found[int(match.group("version"))] = path
        if not found:
            raise PromptNotFound(f"提示词不存在：{key}（应有 {PROMPT_DIR / (key + '.v1.md')}）")
        picked = version if version is not None else max(found)
        if picked not in found:
            raise PromptNotFound(f"提示词 {key} 没有 v{picked}（现有：{sorted(found)}）")
        path = found[picked]
        return Prompt(key=key, version=picked, template=path.read_text(encoding="utf-8"))

    def render(self, prompt: Prompt, **variables: object) -> str:
        """把变量填进模板；缺变量要报错（不要留一个 {{xxx}} 在提示词里）。"""

        def replace(match: re.Match[str]) -> str:
            name = match.group(1)
            if name not in variables:
                raise PromptVariableMissing(
                    f"提示词 {prompt.key}.v{prompt.version} 需要变量 {name}，但调用方没给"
                )
            return str(variables[name])

        return _PLACEHOLDER.sub(replace, prompt.template)

    def placeholders(self, prompt: Prompt) -> list[str]:
        """模板里声明的全部变量名（自检用：保证调用方与模板不脱节）。"""
        return sorted({m.group(1) for m in _PLACEHOLDER.finditer(prompt.template)})
