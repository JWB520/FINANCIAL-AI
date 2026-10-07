"""版面定位自检：批注能不能在 PDF 上换回"那一行的矩形框"。

【为什么单独一份】这是"别让我满篇找它在哪一行"这条需求的实现层，
判断标准很硬：框必须**落在文字实际所在的位置**（不是随便给个框），
匹配不上时要么退回用数字定位、要么老实留空 —— 画错位置比不画更糟。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.infra.parsers.pdf_parser import locate_text_boxes

LINE = "Revenue rose from 0.30 to 0.42, up 55.0% year on year."


@pytest.fixture()
def line_pdf(tmp_path: Path) -> Path:
    """一页、一行英文（字体必然可用，避免不同机器缺中文字体导致框位置飘）。"""
    fitz = pytest.importorskip("fitz")
    path = tmp_path / "locate.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), LINE, fontsize=11)  # 基线 y=100，字号 11
    doc.save(str(path))
    doc.close()
    return path


def test_rect_is_located_on_the_actual_text_line(line_pdf: Path) -> None:
    """按原文句子匹配：框要落在那一行上（y≈100、字号 11 → 框顶在 85~115 之间）。"""
    result = locate_text_boxes(str(line_pdf), [{"page": 1, "statement": LINE, "number": "55.0"}])
    item = result[0]

    assert item["rect_match"] == "statement"
    assert item["rects"], "必须给出至少一个行框"
    assert item["page_width"] > 0 and item["page_height"] > 0

    rect = item["rects"][0]
    assert 0 <= rect["x0"] < rect["x1"] <= item["page_width"], "横向必须落在页内"
    assert 0 <= rect["y0"] < rect["y1"] <= item["page_height"], "纵向必须落在页内"
    assert 85 <= rect["y0"] <= 115, f"框没落在文字那一行：y0={rect['y0']}"
    # 这一行从 x=72 开始写，框左边界不该离开这附近
    assert 60 <= rect["x0"] <= 90, f"框左边界不对：x0={rect['x0']}"


def test_match_is_whitespace_insensitive(line_pdf: Path) -> None:
    """抽取器与 PDF 的空格/换行处理不同，同一句话在两边不逐字相同 —— 去空白后必须仍能匹配。"""
    messy = "Revenue rose from 0.30\n  to 0.42,   up 55.0% year on  year."
    item = locate_text_boxes(str(line_pdf), [{"page": 1, "statement": messy, "number": ""}])[0]
    assert item["rect_match"] == "statement", "空白差异不该导致定位失败"
    assert item["rects"]


def test_falls_back_to_the_number_when_sentence_not_found(line_pdf: Path) -> None:
    """句子匹配不上时，退回用原文数字定位（数字几乎不会被改写，是最稳的兜底锚点）。"""
    item = locate_text_boxes(
        str(line_pdf), [{"page": 1, "statement": "这句原文在 PDF 里根本不存在", "number": "55.0"}]
    )[0]
    assert item["rect_match"] == "number"
    assert item["rects"], "用数字兜底时也要给出框"
    assert 85 <= item["rects"][0]["y0"] <= 115


def test_returns_empty_instead_of_guessing(line_pdf: Path) -> None:
    """都匹配不上时留空 —— 宁可这一条不画框，也不假装知道位置。"""
    item = locate_text_boxes(str(line_pdf), [{"page": 1, "statement": "不存在的句子", "number": "9999"}])[0]
    assert item["rect_match"] == "none"
    assert item["rects"] == []
    # 页码信息仍要带回来（前端至少能跳到那一页）
    assert item["page_width"] > 0


def test_missing_page_is_tolerated(line_pdf: Path) -> None:
    """页码越界（页码范围与批注页码对不上时）不能抛异常。"""
    item = locate_text_boxes(str(line_pdf), [{"page": 99, "statement": LINE, "number": ""}])[0]
    assert item["rect_match"] == "none" and item["rects"] == []


def test_multiple_annotations_are_located_independently(line_pdf: Path) -> None:
    """一次传多条：各自返回各自的框，不能串位。"""
    result = locate_text_boxes(
        str(line_pdf),
        [
            {"page": 1, "statement": LINE, "number": "55.0"},
            {"page": 1, "statement": "不存在的句子", "number": "9999"},
            {"page": 1, "statement": "", "number": "0.42"},
        ],
    )
    assert [item["rect_match"] for item in result] == ["statement", "none", "number"]
