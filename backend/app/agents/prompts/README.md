# 提示词目录

命名：`<用途>.<版本>.md`，例如 `extract_numbers.v3.md`、`classify_claim.v2.md`。

规则：
1. **一版一个文件，不要原地改** —— 审计事件里记的是 `prompt_version`，改了旧版就复现不出历史结论；
2. 变量用 `{名字}` 占位，由 `registry.render()` 填充（缺变量会报错）；
3. 每个提示词文件开头写清：输入是什么、输出 JSON 的字段有哪些、模型不许做什么。

待补的提示词（与 dimensions.py 的 prompt_key 对应）：
| key | 用途 | 现状 |
| --- | --- | --- |
| `extract_numbers` | 从段落里抽出算式与参数（计算核查用） | 待实现 |
| `classify_claim` | 判定主张类型（calc/fact/valuation/forecast/norm/judgement） | 待实现 |
| `verify_fact` | 事实核查：判断表述与证据是否一致 | 待实现 |
| `check_compliance` | 规范核查：判断表述是否违反内部规范 | 待实现 |
