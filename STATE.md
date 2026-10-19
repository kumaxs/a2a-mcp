# 当前进度

项目：a2a-mcp。cowork 接入日期：2026-10-04。

已完成：现有独立 GitHub 仓库 `kumaxs/a2a-mcp` 保持不变；业务实现、Git 历史、remote、README 与目录结构均未被 adopt 覆盖。当前完整双向 A2A ↔ MCP / MCP Events 实现仍保留在 `feat/bidirectional-mcp-events`（验收 commit `01576b1da39bf78bfd4358f6630fe58be41e23f7`），包括 Hermes↔ChatGPT 通信、持久化 task correlation、MCP Events、active wake switch 以及 OpenAI Secure MCP Tunnel / 插件接入说明。

cowork：按固定基线 `kumaxs/cowork-kit@28cd1716c1976e488168f83498899a02590a745a` 的 cowork-v1.13 规则完成原地 adopt；正式协作分支为 `main`。cowork PROJECTS 索引已登记 `a2a-mcp → kumaxs/a2a-mcp / main` 并从 cowork-kit main 回读确认。

验收：adoption 任务分支已从 GitHub 精确读回并通过普通 PR merge；cowork 差异仅涉及受管协作文件，README 未变化。原业务分支 `npm test` 为 3 个测试文件、8 个测试用例全部通过，`npm run typecheck` 通过，测试后工作树保持干净且本地/远端业务 commit 一致。

ChatGPT Project Instructions：本次首次生成 `CHATGPT_PROJECT_INSTRUCTIONS.md`，需要用户将仓库中的完整 bootstrap 更新到本 ChatGPT Project 设置；后续普通 cowork 规则升级如该文件无变化则无需再次更新。

业务功能分支是否何时并入 main 属于原项目后续发布决策，不在本次 cowork 接入中擅自处理。

未特指格式时，笔记、进度、交接和其他记录保存为 Markdown（.md）；代码和必要机器配置保留原生格式。

## 2026-10-19：ChatGPT A2A 连接目标切换

- Hermes-1 已创建独立 Hermes profile：展示名 `A2Agent`，规范化 ID `a2agent`，配置位于 `~/.hermes/profiles/a2agent/`。使用独立会话和 A2A 双向凭证，仅迁移所需的 `commandcode` 推理凭证，不复制 dev 的 Bot 凭证、会话和业务状态。
- 新 profile 的 A2A Agent Card：`http://127.0.0.1:9901/.well-known/agent-card.json`，名称 `A2Agent`。保留原 `dev` profile 及其独立 Gateway（`9900`）。新 Gateway 使用 Hermes 自带 launchd 服务 `ai.hermes.gateway-a2agent`，配置 `gateway.standalone: true`，避免改变既有 Gateway/多 profile 的部署。
- ChatGPT 的现有 `a2a-mcp` 桥接服务（`8931`，原 Secure MCP Tunnel 保持不变）已把直接注册目标 `hermes-dev` 替换为 `A2Agent`；`a2a_list_agents` 仅返回 `A2Agent`。其他 Hermes profiles 和 school 的 Agent 未自动注册。
- 端到端验证：ChatGPT 使用 `a2a_send_message(agent="A2Agent")` 得到 `TASK_STATE_COMPLETED`，且精确回复 `A2AGENT_OK`，不包含推理过程或工具进度。旧 `hermes-dev` 别名不再可查。Bridge / Gateway 正常监听，旧 dev Agent Card 仍可访问。
- Bridge 的 active wake 仍为 `OFF`（本地 `wake-state.json` 的 `enabled=false`）。桥接运行凭证仅存放于本机 owner-only 环境文件；切换前运行文件已私有备份，不入 Git。仓库业务代码、`feat/bidirectional-mcp-events` 分支及原 dev 业务配置未修改。
- 现有 dev/fron 与 default 的消息凭证重复使全局 multiplex Gateway 迁移需要另行评估；本次只启用独立 profile 兼容方式，不在本任务变更现有 Bot。
