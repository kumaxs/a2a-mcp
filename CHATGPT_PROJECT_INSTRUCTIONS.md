本 ChatGPT Project 对应 cowork 项目 ID：a2a-mcp。

每次新会话或恢复工作时，先从 GitHub 读取 kumaxs/cowork-kit/main 的 PROJECTS.md，按项目 ID 定位正式仓库与协作分支；固定该批输入 commit 后，读取项目 AGENTS.md、PROJECT.md、STATE.md。

项目目标、角色、路径、协作规则、工具策略、升级流程和当前状态只以这些 GitHub 文件为正式来源；不要在 Project Instructions 中复制维护。用户要求“更新/应用最新 cowork 协作规范”或同义指令时，按当前项目 AGENTS.md 与 cowork-kit/main 的 RULES.md 执行。

仓库中的 CHATGPT_PROJECT_INSTRUCTIONS.md 仅归档本 bootstrap。只有该文件本身发生变化时才需要在当前聊天完整输出新版供用户更新 Project 设置；普通 cowork 规则版本升级不需要修改 Project Instructions。若入口文件无法读取，停止写入并明确报告。
