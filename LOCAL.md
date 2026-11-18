# 本地版（LOCAL）

[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 的本地版：
**只保留它的路由骨架，不接任何消息平台，也不绑定某一个仓库**。

主干还是原来那条链路，一行没删：

```
入口(Source) → Intake 去重/过滤/线程关联 → Eval 主 Session 判断
   → Decision 接单/并单/忽略/停止 → Ticket + 执行目录 → 执行器 Session 干活
   → orchestrator_report 报告 → 面板与本地 outbox → 后续消息按 followup 回到对应工单
```

变的是三个"接口层"：

| 位置 | 上游 | 本地版 |
| --- | --- | --- |
| 入口 | GitHub 通知、飞书事件 | **主对话**：你在主 Session 里说的话就是请求（`src/sources/chat.ts`） |
| 工单落在哪 | 一个仓库 + 一条 prepare 命令 | **项目注册表**：登记若干「名字 + 来源」，来源是本机目录或仓库链接，路由时选一个（`src/policy.ts` 的 `ProjectSchema`） |
| 启动条件 | 必须 `gh` 登录且能 push | 没有仓库/CLI 即以本地模式启动（`src/deployment.ts`） |

GitHub 与飞书两个 Source 代码都在，bundle 里默认 `disabled: true`；本地收件箱 Source 也在（同样默认关）。

## 怎么用

```sh
pnpm install && pnpm build            # 建议在 ext4 上（如 /root/work），sdcard 做不了符号链接
dsh plugin --profile superagent add "link:$PWD"
```

`$DSH_HOME/profiles/superagent/cordis.patch.yml`：

```yaml
- id: webserver
  config: { host: 127.0.0.1, port: 3082 }
- id: dsh-superagent
  config: { stateDir: /绝对路径/.dsh/state/superagent }
```

`dsh --profile superagent` 启动，侧边栏 **Superagent** 打开面板。第一次启动会自动写入一条策略：
规则 **Local requests**，允许发起人 `operator`（主对话里只有这一个身份）。

然后在面板里配三件东西：

1. **设置 › 模型**：主 Session 和执行器各选一个模型。
2. **设置 › 执行器 › 项目**：加行，填
   - 项目名：`webapp`（小写字母/数字/短横，路由时用它点名）
   - 项目目录或仓库链接：`/root/src/webapp` 本机绝对路径，或 `https://github.com/me/webapp.git`、`git@github.com:me/webapp.git` 这样的仓库链接（链接里不要带密码）
   - prepare 命令：**留空自动准备** —— 仓库链接克隆成工单目录，本机 git 仓库开一个工作树，两者都在 `agent/$DSH_SUPERAGENT_NAME` 分支上；非 git 目录直接复制；也可以自己写一条命令。
3. 没有第 3 件：直接在主对话里说需求。

登记过项目以后，主对话的输入框会多出一个项目选择，选中 `webapp` 就是给这次对话定下目标；也可以不动它，直接在话里点名。

于是：你在主对话说「在 webapp 里把 README 的 recieve 改成 receive」，或者在项目选择里选中 `webapp` 后直接说「把 README 的 recieve 改成 receive」→ 主 Session 收到候选 →
`orchestrator_route` 接单并点名 `project: webapp` → 工单目录 `<work>/webapp/<工单名>` 从 `/root/src/webapp` 准备（填的是仓库链接就克隆） →
执行器 Session 在那里改、跑检查、提交到 `agent/<名字>` 分支 → `orchestrator_report` 报告 →
主 Session 把结果写进面板，并追加到 `<stateDir>/outbox/chat.md` → 人 review；明确同意合并后，执行器把 `agent/<名字>` 合并进项目目录当前检出的分支，再报告合并结果。

## 工单拿到的变量

| 变量 | 含义 |
| --- | --- |
| `DSH_SUPERAGENT_DIR` | 工单目录（执行器 Session 的工作目录） |
| `DSH_SUPERAGENT_NAME` | 工单短名，也是分支名后缀 |
| `DSH_SUPERAGENT_PROJECT` | 路由选中的项目名 |
| `DSH_SUPERAGENT_PROJECT_DIR` | 项目登记的来源，本机目录或仓库链接（工单目录从它准备出来） |
| `DSH_SUPERAGENT_BLOCKED_COMMANDS` | 这个执行环境禁用的命令 |

## 其它入口（默认关闭）

- `dsh-superagent-local`：读一个本地目录里的 `.md`/`.txt`，一个文件一条线索，内容变了就是新请求。适合批处理、脚本投递。
- `dsh-superagent-github` / `dsh-superagent-feishu`：接回平台用。把 `cordis.patch.yml` 里对应条目的 `disabled: true` 去掉、在面板填仓库/CLI 即可；仓库名一旦填上，提示词、skill、`gh` 包装脚本全部回到上游行为（本地覆盖只在「没有仓库」时生效）。

## 已知限制

- 不开 PR，所以没有 CI、没有 review 流水线：`ready` 只代表 agent 自检通过。
- 合并由执行器在项目目录里执行：合并进它当前检出的分支，要求工作区干净；仓库链接和非 git 目录没有本地基分支，仍由人合并。
- 仓库链接由执行器的 git 克隆，凭据来自你本机的 git 配置（`~/.gitconfig` 里的 `credential.helper`、`~/.git-credentials`、`~/.ssh` 里的密钥或 SSH agent）：公开仓库直接可用，私有仓库只要这台机器上的 git 不用你输入密码或确认就能克隆，工单也能。克隆不会弹出提示，需要现场输入凭据时会失败。DSH 读这些配置，不往里写东西；工单开始后，执行器的 git 也用这台机器的 git 配置，提交署名与凭据都来自那里。
- 主对话只有一个身份 `operator`，没有多人白名单。
- 面板上的回复落在面板与 `outbox/chat.md`，不会作为消息再塞回对话。
- `tests/sources.spec.ts` 里飞书事件消费者那条用例在整包并行跑时偶尔超时（子进程起得慢），单独跑稳定，与本地版改动无关。
