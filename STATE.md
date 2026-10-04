# 当前进度

项目：a2a-mcp。cowork 接入日期：2026-10-04。

已完成：现有独立 GitHub 仓库 `kumaxs/a2a-mcp` 保持不变；业务实现、Git 历史、remote、README 与目录结构均未被 adopt 覆盖。当前完整双向 A2A ↔ MCP / MCP Events 实现仍保留在 `feat/bidirectional-mcp-events`（验收 commit `01576b1da39bf78bfd4358f6630fe58be41e23f7`），包括 Hermes↔ChatGPT 通信、持久化 task correlation、MCP Events、active wake switch 以及 OpenAI Secure MCP Tunnel / 插件接入说明。

cowork：按固定基线 `kumaxs/cowork-kit@28cd1716c1976e488168f83498899a02590a745a` 的 cowork-v1.13 规则完成原地 adopt；正式协作分支为 `main`。cowork PROJECTS 索引已登记 `a2a-mcp → kumaxs/a2a-mcp / main` 并从 cowork-kit main 回读确认。

验收：adoption 任务分支已从 GitHub 精确读回并通过普通 PR merge；cowork 差异仅涉及受管协作文件，README 未变化。原业务分支 `npm test` 为 3 个测试文件、8 个测试用例全部通过，`npm run typecheck` 通过，测试后工作树保持干净且本地/远端业务 commit 一致。

ChatGPT Project Instructions：本次首次生成 `CHATGPT_PROJECT_INSTRUCTIONS.md`，需要用户将仓库中的完整 bootstrap 更新到本 ChatGPT Project 设置；后续普通 cowork 规则升级如该文件无变化则无需再次更新。

业务功能分支是否何时并入 main 属于原项目后续发布决策，不在本次 cowork 接入中擅自处理。

未特指格式时，笔记、进度、交接和其他记录保存为 Markdown（.md）；代码和必要机器配置保留原生格式。
