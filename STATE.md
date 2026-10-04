# 当前进度

项目：a2a-mcp。cowork 接入日期：2026-10-04。

已完成：现有独立 GitHub 仓库 `kumaxs/a2a-mcp` 保持不变；业务实现、Git 历史、remote、README 与目录结构均未被 adopt 覆盖。当前完整双向 A2A ↔ MCP / MCP Events 实现仍保留在 `feat/bidirectional-mcp-events`（接入前远端 commit `01576b1da39bf78bfd4358f6630fe58be41e23f7`），包括 Hermes↔ChatGPT 通信、持久化 task correlation、MCP Events、active wake switch 以及 OpenAI Secure MCP Tunnel / 插件接入说明。

cowork：按 `kumaxs/cowork-kit@28cd1716c1976e488168f83498899a02590a745a` 的 cowork-v1.13 规则执行原地 adopt；正式协作分支为 `main`。本次只新增/更新 cowork 受管协作文件，不修改 A2A/MCP 业务代码或运行配置。

待确认：cowork adoption 合并并从 GitHub main 精确读回；cowork PROJECTS 索引登记并读回。业务功能分支是否何时并入 main 属于原项目后续发布决策，不在本次 cowork 接入中擅自处理。

未特指格式时，笔记、进度、交接和其他记录保存为 Markdown（.md）；代码和必要机器配置保留原生格式。
