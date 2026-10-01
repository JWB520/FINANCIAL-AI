"""单条追问（P0）：围绕一条结论的受限对话。

对应维度：见 app/domain/dimensions.py 里 checker_key="ask_agent" 的那一项。
"""
from __future__ import annotations

from app.agents.base import BaseChecker, CheckContext, FindingDraft


class Ask_agent(BaseChecker):
    """单条追问（P0）：围绕一条结论的受限对话。"""

    dimension_code = ""

    async def check(self, ctx: CheckContext) -> list[FindingDraft]:
        """实现要点：
      1. 只允许检索这一条主张 + 它的结论/证据/核算过程，不要让它"自由发挥"；
      2. 逐段产出 chunk 事件，最后一条 done 事件里带 citations（引用到 claim/evidence）；
      3. **追问的回答不会写进核查结论**（前端帮助里也这么写，别打破这条）。"""
        raise NotImplementedError("ask_agent.check")
