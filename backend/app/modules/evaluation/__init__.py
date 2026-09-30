"""评估框架模块：LLM-as-Judge。

流程：
  1. 给 Agent 发送测试 prompt，收集响应
  2. 用 judge model 按评估准则（criteria）打分
  3. 记录每准则得分 + 理由 + 总分
  4. 多次运行形成趋势数据，前端绘制折线图
"""
