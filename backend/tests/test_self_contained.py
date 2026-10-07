"""「本句自证」通道自检：占比互补 / 分项合计 / 同句增速，以及三条"不许误报"的护栏。

【为什么这组测试重要】这是"植入错误能不能查出来"的回归。
用户把原文「占比 60.67%/39.33%」改成「55.00%/39.33%」，旧链路一条都没报出来 ——
因为算式是模型给的（分母挑成了全页营收 28.78），复核一看是"我方配错"就把整条排掉了。
本句自证通道把分母改成"两分项之和"（句子里就写着），于是 20.11÷(20.11+13.04)=60.66
与原文 55.00 的差距无法再用"配错"解释。
"""
from __future__ import annotations

import asyncio

from app.agents.calculator_checker import Calculator_checker, item_scope, self_contained_recall, validate_item
from app.infra.tools import calculator

ORIGINAL = "2025 年公司电子陶瓷材料及元件、第三代半导体器件及模块收入分别为20.11/13.04 亿元，占比60.67%/39.33%。"
PLANTED = "2025 年公司电子陶瓷材料及元件、第三代半导体器件及模块收入分别为20.11/13.04 亿元，占比55.00%/39.33%。"


def run_page(text: str) -> list[tuple[str, float, bool]]:
    """照判定链把一句话跑一遍：返回 [(算式, 复算值, 是否一致)]，过不了本地硬校验的直接失败。"""
    out: list[tuple[str, float, bool]] = []
    for item in self_contained_recall(text):
        ok, why = validate_item(item, text, text)
        assert ok, f"本地硬校验必须通过：{why}（{item['expression']}）"
        assert item_scope(item, text) == "sentence", "本句自证的输入必须全部落在句内"
        result = calculator.evaluate(item["expression"])
        assert result["ok"], item["expression"]
        # 按条目自己的容差判（判定链就是这么做的）：① 类严判 0.5%，③ 类对四舍五入放宽到 10%
        compared = calculator.compare(
            float(result["result"]), float(item["claimed"]), rel_tol=float(item.get("tolerance_pct", 0.5)) / 100.0
        )
        out.append((item["expression"], round(float(result["result"]), 4), bool(compared["consistent"])))
    return out


def test_planted_error_is_caught_while_original_is_clean():
    """同一句话：被改过的必须算出来"不一致"；原文（60.67%）不许被误报。"""
    planted = run_page(PLANTED)
    original = run_page(ORIGINAL)

    # 20.11 ÷ (20.11+13.04) × 100 = 60.6637（与原文 55.00 差 5.66 个百分点；与原文 60.67 只差 0.006）
    assert ("20.11/(20.11+13.04)*100", 60.6637, False) in planted, f"植入的错误没查出来：{planted}"
    assert ("20.11/(20.11+13.04)*100", 60.6637, True) in original, f"原文被误报了：{original}"
    assert all(ok for _e, _v, ok in original), f"原文这一句不该有任何不一致：{original}"


def test_denominator_is_the_sum_of_the_two_parts_not_the_page_total():
    """分母必须是本句两分项之和 —— 这正是旧链路被 28.78（全页营收）带偏的地方。"""
    expressions = [item["expression"] for item in self_contained_recall(PLANTED)]
    assert "20.11/(20.11+13.04)*100" in expressions
    assert all("28.78" not in expression for expression in expressions)


def test_note_tells_where_the_problem_is():
    """备注要能让人一眼看懂问题出在哪：两个占比相加应为 100%。"""
    why = " ".join(str(item.get("why") or "") for item in self_contained_recall(PLANTED))
    assert "94.33" in why, f"备注里应写出「两占比之和 94.33% ≠ 100%」：{why}"
    assert "100%" in why


def test_parts_sum_equals_total():
    """分项之和 = 合计：对的通过、改错的报出来。"""
    good = "两项收入分别为 20.11、13.04 亿元，合计 33.15 亿元。"
    bad = "两项收入分别为 20.11、13.04 亿元，合计 30.00 亿元。"
    assert [ok for _e, _v, ok in run_page(good)] == [True]
    assert [ok for _e, _v, ok in run_page(bad)] == [False]


def test_growth_from_to_in_one_sentence():
    """同句增速：由 A 增至 B，增长 C% —— 对得上通过，对不上报出来。"""
    good = "公司营业收入由 10.00 亿元增至 16.00 亿元，增长 60.00%。"
    bad = "公司营业收入由 10.00 亿元增至 16.00 亿元，增长 50.00%。"
    assert all(ok for _e, _v, ok in run_page(good))
    assert any(not ok for _e, _v, ok in run_page(bad))


def test_unlisted_parts_are_not_reported_to_avoid_false_positive():
    """护栏：分项没列全（只抓到两个、其实有四个）时宁可不报 —— 漏报好过报错。"""
    assert self_contained_recall("四项分别为 1、2、3、4，合计 10。") == []


def test_ambiguous_growth_wording_is_left_to_the_model():
    """护栏：出现"两年/复合/累计"这类口径词时不在本通道下结论（那属于需要读懂口径的判断）。

    实测样本：原文「由 2025 年 165 亿美元增长至 2026 年 260 亿美元，两年增速均为 +60%」。
    """
    text = "AI 集群用光模块与 CPO 市场由 2025 年 165 亿美元增长至 2026 年 260 亿美元，两年增速均为 +60%。"
    assert self_contained_recall(text) == []


def test_works_without_any_model():
    """不接模型也要能查出这处错误 —— 确定性通道的意义就在这里。"""
    checker = Calculator_checker(llm=None)
    items = asyncio.run(checker.recall(PLANTED))
    expressions = [item["expression"] for item in items]
    assert "20.11/(20.11+13.04)*100" in expressions, f"没有模型时也该召回：{expressions}"
    assert all(item["source"] == "rule_selfcontained" for item in items)
    assert checker.stats["self_contained"] >= 1


def test_multi_pair_sentence_is_left_to_the_model():
    """护栏：同一句里有多组「由 A 增至 B」时配对不可靠，本通道不下结论。

    实测样本（第 13 页）：把 223% 配给 (1.71→4.26) 就是误报 ——
    那个 223% 其实属于同句的 (1335→4318)，单独算出来 223.4% 是对的。
    """
    text = "归母净利润由 1.71 增至 4.26，同时经营现金流由 1335 增至 4318，同比增长 223.0%。"
    assert self_contained_recall(text) == []


def test_rounded_values_do_not_produce_a_false_positive():
    """护栏：报表用的是**未四舍五入的原值**，拿页面上印的 2.3/2.1 反推得 8.7%，
    与原文 8.0% 差 0.7 个百分点 —— 属精度差，不许报（③ 类容差 10%）。

    实测样本：第 16 页「毛利率由 2.3 降至 2.1，同比下降 8.0%」。
    """
    text = "公司毛利率由 2.3 降至 2.1，同比下降 8.0%。"
    items = self_contained_recall(text)
    assert items, "应该有这一条（只是不该判成不一致）"
    assert all(ok for _e, _v, ok in run_page(text)), "精度差导致的不一致必须被容差吸收"
