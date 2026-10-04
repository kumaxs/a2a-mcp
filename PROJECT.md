# Hermes A2A MCP

- 项目 ID：a2a-mcp
- 目标：
  Maintain the existing small bidirectional A2A ↔ MCP bridge so ChatGPT and Hermes can communicate through MCP tools and MCP Events, preserving durable task correlation, OpenAI Secure MCP Tunnel/plugin integration, security boundaries, and the project’s minimal architecture.
- 本地逻辑目录：a2a-mcp/；沿用现有 Git 仓库，不复制第二套项目。
- 本地工作树：沿用现有 clone；公共仓库不固化设备绝对路径。
- 正式仓库：kumaxs/a2a-mcp
- 协作分支：main
- 主工作区与 STATE.md 整合者：ChatGPT cowork adoption 2026-10-04
- 科学角色：沿用用户已有分工，本模板不重分配科学决策权。
- 完成标准：目标对应的实际文件、必要验证及可读取的远端提交。

默认 GitHub 读写。GitHub 连接器是 ChatGPT 的仓库主通道，仓库文件写入、commit 与受支持的 ref/branch/PR 操作优先 GitHub 并按新 commit 读回；Commander 负责必须在本地/远端机器执行的 new/adopt/apply、Python/命令、test/build/lint、部署、本地 Git 同步/合并及 GitHub 未覆盖操作；MCPX 仅在确需本地工作区时作为受限 read/edit/git_status/git_commit 等后备。Codex/Hermes 优先使用自身实际可用的原生文件、Git、terminal/shell、SSH 与项目任务能力，不因 ChatGPT 插件不可用而阻塞。

main 保持稳定；任何修改/补丁/版本更新先从最新 main 建任务分支，在分支中开发测试并及时 commit+push，确认实施且验收通过后才合并。

Agent 指令入口：ChatGPT Project Instructions 只保留项目定位 bootstrap；Codex 从项目 Git 根启动并自动使用根 `AGENTS.md` 作为长期项目指令入口，不复制 ChatGPT UI 指令；Hermes 保留项目既有 AGENTS/context 与自身 profile。跨 Agent 的长期规则和项目事实以仓库中的 `AGENTS.md`、`PROJECT.md`、`STATE.md` 为准。

## Hermes 实验中心
涉及提交、查询、传递决定或接收 Hermes Lab 实验时，通过 cowork `PROJECTS.md` 定位 `hermes-lab-team`，固定当前 Lab commit，并读取该 commit 的 `SOURCE_PROJECT_GUIDE.md` 后执行；本项目不保存 Hermes Lab 内部流程副本。原则：源项目负责冻结并提交“做什么”，Hermes Lab 负责“如何执行并交付”。

首个任务按目标推进；只把影响实质结果的未知项作为问题，不重新协商已经固定的协作约定。
