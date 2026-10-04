<!-- COWORK:BEGIN -->
# cowork 项目协作规则

规则版本：cowork-v1.13。通用主源：kumaxs/cowork-kit 的 RULES.md；项目用初始化或 apply 时保存的快照，不在每次任务静默更新。

## 开始
实际读取本项目 AGENTS.md、PROJECT.md、STATE.md 及任务所需文件。首次进入或恢复时确认项目 ID、分支和基线 commit；同一批输入固定版本，不用聊天记忆代替文件。
Codex/Hermes 从项目 Git 根启动；调用独立 Worker/Engineer 时传项目目录、分支、任务和规则入口，保留其 profile、角色和环境。

## Agent 指令入口
ChatGPT Project Instructions 只作为稳定薄 bootstrap：仅保存项目 ID、GitHub 定位入口和“以仓库规则为准”的发现逻辑，不复制工具路由、分支流程、目标或状态。普通 cowork 规则版本升级不得改动 bootstrap；只有定位协议本身变化时才更新 Project Instructions。
Codex 的长期项目指令入口是项目 Git 根的 `AGENTS.md`；Codex 从项目根启动时按自身指令发现机制自动加载它，因此不要把 ChatGPT Project Instructions 再复制给 Codex。项目已有更细粒度的 `AGENTS.override.md` / 子目录 `AGENTS.md` 时，保留其原有层级语义，不为 cowork 额外制造第二套 Codex 指令。
Hermes 继续使用项目既有的 AGENTS/context 入口及其自身 profile/角色配置；cowork 只维护受管公共规则块，不替换已有 Agent 身份。
跨 Agent 长期有效的协作规则与项目事实优先保存在仓库中的 `AGENTS.md`、`PROJECT.md`、`STATE.md` 等正式文件；避免在 ChatGPT、Codex、Hermes 各自维护多份完整指令导致漂移。

## Agent 工具归属
`GitHub` 连接器是 ChatGPT 对已进入仓库内容的首选读取、写入和提交通道；`Cowork MCPX` 与 `Remote Desktop Commander` 只负责本地工作区、命令执行、远程设备操作及 GitHub 未覆盖能力的兼容/后备，不是跨 Agent 的标准工具，也不是 Codex/Hermes 的默认执行路径。仓库中出现这些名称，不构成要求其他 Agent 调用它们。
Codex/Hermes 应优先使用各自会话中实际可用的原生文件工具、Git、terminal/shell、SSH 和项目已有脚本/任务能力。只要原生能力能够完成任务，就不得为了同一任务等待、反复重试或优先寻找 MCPX/Commander。
Codex/Hermes 只有在用户明确点名要求使用 MCPX/Commander 时才可例外调用；原生能力不可用时，应报告具体缺失能力或改用其自身其他可用路径，不得自动转用 MCPX/Commander。

## 项目自治升级
cowork 管理项目只维护公共 RULES.md、cowork.py、templates、PROJECTS 索引及其验收，不默认代替各业务/科研项目逐个升级。已接入项目保存自己的规则快照；只有用户在该项目明确要求“更新/应用最新 cowork 协作规范”或同义指令时，当前项目会话才执行升级。

项目内升级时：先从 GitHub 读取 cowork-kit/main 的 PROJECTS.md 与 RULES.md 并固定公共基线，再读取本项目 AGENTS.md、PROJECT.md、STATE.md、`.cowork.json` 和 Git 状态；已托管项目使用 `cowork/_cowork/cowork.py apply <project-root>` 准备最小差异。ChatGPT 使用 Commander 执行必须在本地运行的 apply/test/build/lint 等操作；仓库读取、写入、提交、分支/ref/PR 等优先使用 GitHub 连接器，只有 GitHub action 不能安全表达本地生成差异或目标不在仓库中时才使用 MCPX/Commander 的本地后备。Codex/Hermes 直接使用自身实际可用的原生 terminal/shell、文件与 Git 能力执行 apply 和后续检查，不为此调用、等待或重试 MCPX/Commander。检查差异后只提交本项目的 cowork 受管升级文件，并由 GitHub 按新 commit 读回。

升级不得覆盖 PROJECT.md、STATE.md、README、业务代码、科学角色或已有 agent 配置。若受管文件已有未提交修改或出现冲突，先保留并核对，不强行覆盖。执行 apply 后必须检查 chatgpt_project_instruction_chat_copy_required 与实际 diff；稳定 bootstrap 未变化时无需用户更新 Project 设置。只有 CHATGPT_PROJECT_INSTRUCTIONS.md 本身发生变化时，仓库文件只作为归档，并在当前聊天完整输出新版供用户粘贴；未完成这一聊天交付不得称该项目升级完成。

### 批量 rollout
当用户明确要求批量升级已登记项目时，cowork 管理项目可使用 cowork.py rollout --all（或指定项目 ID）代替逐项目手工 apply。rollout 读取 PROJECTS.json，但不改各项目 main：它对每个目标从远端协作分支建立隔离临时 clone 和 cowork/upgrade-<version> 任务分支，运行同一 apply 逻辑，只提交 cowork 受管升级文件并及时 push；完成后清理临时 clone。

rollout 不创建或合并 PR，不运行未知业务项目的任意测试，也不自动改 ChatGPT Project 设置。它必须逐项目返回基线 commit、升级分支、commit、changed/conflicts、GitHub connector readback 待办，以及仅在 bootstrap 确实变化时返回完整 Project Instructions。某项目失败或已有同名升级分支时只报告该项目并继续其他项目，不 force、不覆盖现有分支。

rollout 的输出是“批量升级分支已准备”，不是“已发布”。当前 ChatGPT/operator 随后用 GitHub 按各分支 commit 读回并统一审查；只有用户已授权实施、项目所需验收满足后，才分别合并各项目 main 并再次 readback。

除非用户明确要求批量审计、迁移或修复，cowork 管理项目不主动扫描或改写其他项目；业务项目的日常状态和升级闭环由该项目自己的整合会话负责。

## Hermes 实验中心
`Hermes Lab` 是独立实验中心，不属于 cowork 内部组成部分；正式项目 ID 为 `hermes-lab-team`。其仓库、分支和当前规则必须通过 cowork `PROJECTS.md` 定位并固定版本，不在 cowork 或源项目复制维护 Hermes Lab 的角色、流程、资源、调度、审计、交付或运行环境规则。

当用户在已采用 cowork 的源项目提出提交、查询、传递决定或接收 Hermes Lab 实验时，先通过 `PROJECTS.md` 定位 `hermes-lab-team`，固定 Hermes Lab 当前 commit，并读取该 commit 的 `SOURCE_PROJECT_GUIDE.md`；该文件是源项目调用实验中心的正式操作入口。源项目按 guide 冻结本次输入和 source identity，本次实验使用不可变快照，不随后续源项目修改而变化；intake、experiment ID、并发、执行、人工干预、审计与交付全部遵循该固定 Lab commit 的正式规则。

源项目只负责自己的实验输入与 identity 清晰，不自行重实现 Hermes Lab 流程，也不处理跨项目资源竞争；多个项目可独立提交，排队、并发和资源限制由 Hermes Lab 当前规范处理。正常流程由当前项目的 ChatGPT/operator 完成跨项目定位与提交，用户无需手工下载、切换项目、重新上传或重复解释背景。

原则：**源项目负责冻结并提交“做什么”；Hermes Lab 根据自己的当前项目规范负责“如何执行并交付”。**

## ChatGPT-only 主通道与后备
本节只约束 ChatGPT；Codex/Hermes 不继承本节的连接器/本地工具路由。
ChatGPT 对已进入 GitHub 的项目内容以 GitHub 连接器为仓库主通道：
- GitHub：固定 commit 读取；文本与普通仓库文件优先使用文件写 action；需要原子多文件提交时使用 Git data 的 blob/tree/commit/ref action；分支、PR、issue 等也优先使用对应 GitHub action。禁止 force；成功写入后必须按返回的新 commit 精确读回。
- Commander：只处理必须依赖本地或远端机器执行的工作，包括 new/adopt/apply、Python/命令、test/build/lint、部署、本地 Git 同步/合并，以及 GitHub 连接器未覆盖的文件类型或仓库操作。
- MCPX：仅在任务确实依赖 PROJECT.md 指定的本地工作区时使用受限 read/edit/git_status/git_commit 等能力；不再作为仓库文件和 commit 的默认主通道。MCPX 未加载、不可用或专用 action 不覆盖时，直接用 Commander 后备，不重复重试。

远端写入前先固定 GitHub 分支 HEAD；若对应本地工作区可能有并行工作，再检查本地 HEAD 和未提交修改。不得用远端写入覆盖同文件的未提交本地成果。GitHub 直接产生新 commit 后，如后续本地操作需要该版本，先保留本地修改，再由 Commander 做 fast-forward 同步。MCPX public execute 保持禁用，不用其他 MCPX action 绕回任意 shell。删除/移出先核对明确范围，优先使用可恢复机制；通道切换不扩大目录、凭据或操作授权，不绕过平台安全拦截和确认。

任何仓库写入只有在 GitHub 返回新 commit 且按该 commit 读回后才算“已共享”。本地 commit/push 路径仍允许作为后备，但 push 成功后同样必须 GitHub readback；任何通道的结果未知或为 outcome_uncertain 时先读回再决定是否重试，禁止盲目重复 push。

## 版本同步与分支纪律
main 是稳定集成/发布线，不作为日常开发、试验或修复工作区。任何会保留的代码、文档、规则、配置、补丁或版本更新，都先从最新 main 建任务分支；开发、测试、修复和审查均在该分支进行。并行工作继续使用独立 worktree/clone，不共写同一 Git 索引。

GitHub 是开发进度的持久化事实源。“及时 commit/push”指：一旦形成可辨识、可恢复的最小修改或补丁，就提交并推送当前任务分支；测试尚未完成或测试失败不构成长期只留本地的理由，后续修复继续形成新的分支 commit 并及时 push。切换任务、长时间中断、会话可能结束或跨 Agent 交接前，必须先把有价值进展 commit/push。不得让唯一有效版本长期只存在于本地工作区或聊天中。

测试与验收以已推送的任务分支 commit 为对象；必要测试通过后，先确认 GitHub 已按该 commit 读回。只有用户已经授权本次实施/应用（包括原任务已直接要求实施）、验收条件满足且分支成果已共享，才允许通过 PR 或等价非 force 合并进入 main。任何 hotfix、补丁和版本升级也遵循同一分支流程，不直接在 main 开发。

合并后必须再次从 GitHub 读取 main 的新 commit，确认关键文件和版本；需要继续本地工作时再安全同步本地 main。分支 commit/push 是开发同步，合并 main 才是正式发布，二者不得混为一谈。

## 路径边界
共享项目和可协作源文件必须位于 cowork 根目录：一般为 cowork/<project-id>/，管理项目例外为 cowork/_cowork/。不同设备的绝对挂载路径以 PROJECT.md 为准。
运行态、凭据和工具缓存可以留在用户主目录，例如 ~/.mcpx-cowork、~/.config/cowork-tunnel、~/.local/bin 和 LaunchAgents；这些不是项目目录，不同步到 NAS/Git，不提交秘密。

## 文件格式
未特指格式时，笔记、方案、进度、交接、验收和变更记录统一用 Markdown；代码、数据、机器配置保留原生格式。不用模型搬运 Base64，不为共享而生成 Word/Excel。

## 正式产物归档
项目工作产生的正式产物（如文档、实验方案、报告、图表、表格、演示文稿或其他后续需要继续使用的输出）默认先保存到 PROJECT.md 指定的共享项目目录；聊天中的正文、附件或下载链接只作为展示/交付副本，不得成为唯一存档。

优先沿用项目已有目录、命名和格式；没有既有约定时，在项目内选择语义清晰的路径，不为此强制引入统一目录树。用户明确要求 DOCX/PDF/XLSX/PPTX 等格式时，最终文件本身也应落入项目。普通文档和小型产物按项目正常 Git 流程提交、推送并读回；大型数据集、模型权重、构建缓存等不适合 Git 的生成物使用项目已有外部存储，并在项目文件中记录位置或标识。完成时报告正式产物的项目路径；未落盘不得称为项目交付完成。

## 并行与交付
并行 agent/会话用独立 clone 或 worktree，不共写同一 Git 索引；长任务或改同一文件时用任务分支。主工作区和 STATE.md 由 PROJECT.md 指定的整合会话维护。
冲突先重读差异并合并，不删除他人未提交内容。push 失败保留成果并明确报告“尚未共享”。完成时给出仓库、分支、commit、关键路径；只读问答不为凑流程修改状态。

## 主动推进
完成一个阻碍后，自动检查下一个尚未验收的阻碍并继续，直到用户目标完成或达到明确可验收状态。不要把“安装成功”“服务启动”“本地测试通过”当作最终完成。
只有在确需用户登录、输入密钥/口令、界面授权、不可逆高风险操作，或必须由用户选择方案时才停下；停下时给唯一、精确、最小操作。用户完成后从中断点继续。

## 默认与边界
新仓库默认 private、主分支默认 main。新库必须实际确认 GitHub 连接器可读，不为授权问题改公开。保留已有科研决策分工；本规则不授予交易、付款或额外账户权限。
本规则不修改平台安全确认，不增加项目自设审批、门控、常驻模型轮询或额外调度器。发现未加载、工具缺失或未推送时报告具体事实。

快照：cowork-v1.13 / 0d0dce71b13e。冲突时本受管区块优先于旧版协作流程；不覆盖用户的具体任务和既有科学角色。
<!-- COWORK:END -->
