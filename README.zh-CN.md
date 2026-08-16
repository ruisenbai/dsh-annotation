# dsh-inline-annotations

[English](README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19%20%7C%7C%20%3E%3D24-43853d.svg)](package.json)

这是一个可独立发布到 GitHub 的 DeepSeek Harness 插件，用于直接审阅 AI 回复正文：选中原文、添加评论或要求、保留多条可编辑草稿，最后以一个可安全重试的批次发送到当前任务。

> **兼容性提示：**项目面向 DeepSeek Harness `0.1.0-rc.5` 与 `0.1.0-rc.6`。DSH 仍处于预发布阶段。由于当前没有助手正文内部 Slot，本插件必须覆盖三个内置会话渲染器。升级 DSH 前请阅读[兼容性说明](docs/compatibility.md)。

## 功能

- 在一条已完成的助手回复内选中文字后立即打开注解输入框，无需先操作菜单或再次点击。
- 在选区旁直接显示紧凑输入框，右侧只有取消和保存图标。空内容点击外部会关闭；有内容点击外部会保持打开、显示红边并震动，直到选择一个图标操作。
- 输入停止 400ms 后自动保存编辑中内容并显示本地保存状态；刷新后可恢复，但不会因此变成已提交注解。
- 将两行注解记录分成“待发送”“确认结果/待重试”“权威队列”“已发送”四类，并复用 DSH 官方按钮、状态点、图标、Tooltip 和 Toast。
- 对齐官方 Web 的助手正文流、思考过程折叠行、停止标记、输入区 Dock、图标按钮尺寸、表单字号、语义颜色、浮层表面和用户消息气泡，同时为“定位原文”保留最初的地图定位图标。
- 支持撤销最近一次草稿删除、导出当前 Session 恢复 JSON、清空未提交草稿，并显示本地存储占用。
- 保存完整原文、前后文选择器、助手消息 ID、事件序号、注解 ID 与提交 ID。
- 对代码记录语言与起止行；对表格记录起止行列。
- 选区重叠时合并到原有草稿，避免高亮堆叠歧义。
- 空闲时开启下一轮；任务运行时在下一安全步骤加入；等待确认时排队到下一轮。
- 发送按钮显示本批注解数量，并在旁边说明空闲、运行中、等待确认、已归档或重试状态下的实际去向。
- 使用不同的 DSH Toast 提示权威队列、持久发送和可重试失败；只有批次仍在已观测队列中时才显示撤回操作。
- 对已归档会话先复制为新任务，再发送注解。
- 编号位于选区结束位置所在完整正文行之后；预留防溢出区域并保持升序，同时合并思考过程展开、视口、字体和缩放触发的布局测量。
- 点击定位后，将数字编号所在的正文行垂直居中到真实会话或窗口滚动区域，并校正 CSS 缩放。
- 使用 `localStorage` 恢复未发送草稿、编辑中内容和不可变重试记录。
- 用由提交 ID 派生的稳定消息 ID 去重网络中断后的重试。
- 只有模型明确返回对应注解 ID，状态才从“已发送”变为“已处理”。
- 浏览器不支持 CSS Custom Highlight API 时，仍保留编号标记和定位能力。

## 快速开始

### 从源码构建

```bash
git clone https://github.com/YOUR_ORG/dsh-inline-annotations.git
cd dsh-inline-annotations
corepack enable
pnpm install
pnpm verify
```

把构建后的目录安装到 Web Profile：

```bash
dsh plugin --profile web add .
dsh web --profile web
```

打开 DSH Web 页面，在一条已完成回复中选中文字，紧凑输入框会立即出现。填写意见后点击对号创建草稿，或点击叉号取消。草稿会出现在输入框上方；检查分组列表、按需填写整体要求，然后发送。

### 安装 GitHub Release

每个 `v*.*.*` 标签都会构建可安装 Tarball 并附加到 GitHub Release。下载后可以直接安装预构建包，无需执行仓库构建脚本：

```bash
gh release download v0.1.0 --repo YOUR_ORG/dsh-inline-annotations --pattern '*.tgz'
dsh plugin --profile web add ./dsh-inline-annotations-0.1.0.tgz
```

如果 Profile 明确允许这个可信包执行 `prepare` 构建，也可以安装固定标签的 Git 依赖：

```bash
dsh plugin --profile web add git+https://github.com/YOUR_ORG/dsh-inline-annotations.git#v0.1.0
```

发布你自己的仓库前，请替换本文和 `package.json` 中的 `YOUR_ORG`。

## 任务状态与发送方式

| 会话状态       | 含数量操作              | 去向说明               | Host 行为                                       |
| -------------- | ----------------------- | ---------------------- | ----------------------------------------------- |
| 空闲           | 发送 N 条注解到任务     | 发送后启动任务         | `Agent.followup()` 开始下一轮                   |
| 运行中         | 发送 N 条注解到当前任务 | 进入下一个安全执行节点 | `Agent.steer()` 在下一安全步骤接收批次          |
| 等待审批或提问 | 确认后排队 N 条注解     | 确认完成后排队         | `Agent.followup()` 等待下一轮                   |
| 已归档         | 复制并发送 N 条注解     | 复制到新任务           | `ISessions.fork()` 创建并打开子任务，再排队发送 |

插件不会把传输已接受直接显示成已排队。只有 `ConversationSnapshot.queue` 包含稳定消息 ID 后才显示“已排队”Toast 和撤回操作；持久化 `user/message` 出现后改为“已发送”并移除撤回。失败 Toast 会保留并显示原不可变提交 ID，供用户重试。

网络错误不会删除草稿，而会保留同一个不可变提交内容和提交 ID，供稍后安全重试；发送结果未知时即使刷新页面，同一批次也会恢复为可重试状态。一旦标准 `user/message` 事件写入历史，插件不会修改这段历史；后续补充会创建一条关联原注解的新草稿。

## 状态定义

- **草稿：**仅在浏览器中，可编辑。
- **已排队：**已进入 DSH Inbox，尚未写入模型历史。
- **已发送：**由持久化的注解 `user/message` 事件重建。
- **已处理：**模型回复明确携带提交 ID 和注解 ID 后才设置。

插件不会根据等待时长、轮次结束或界面时序推测“已处理”。

## 配置

Bundle 会插入一个 `dsh-inline-annotations` 行。可在当前 Profile Composition 中覆盖：

| 配置项                        |                      默认值 | 作用                                     |
| ----------------------------- | --------------------------: | ---------------------------------------- |
| `commandName`                 | `inline_annotations_submit` | 浏览器到 Host 的内部传输命令名           |
| `maxPayloadBytes`             |                    `524288` | 解码后 JSON 批次上限；超限拒绝，绝不截断 |
| `maxAnnotationsPerSubmission` |                       `100` | 单批注解数上限                           |
| `warnSelectionChars`          |                     `12000` | 长选区需要额外确认的阈值                 |
| `locateHistoryPages`          |                        `20` | 定位原文时最多加载的历史页数             |

Host 与 Client 共享同一个 Cordis 行配置，因此修改 `commandName` 时两端会保持一致。

## 隐私与持久化

未发送原文、评论、编辑中内容和重试记录保存在 `dsh-inline-annotations:v1:<session-id>` 对应的 `localStorage` 中。可见存储键继续使用 `v1`，其中经过校验的数据值采用 `storageVersion: 2`，旧版值会在读取时迁移。用户提交前不会发送到 Host 或模型。提交后，原文和评论会进入当前 Session 日志和模型上下文。插件不包含分析、遥测或外部网络客户端。详见[隐私说明](docs/privacy.md)。

## 模型体验

- **提交前：**不产生 Prompt、Token 或 KV Cache 影响。
- **提交时：**写入一条标准用户消息，包含完整批次、稳定 ID、原文、评论、结构坐标和可选整体要求。
- **处理确认：**消息要求模型在确实处理后返回一个列出注解 ID 的机器标记。Client 渲染前隐藏标记，但原始模型文本仍可重放。
- **Token：**成本随完整选区和评论增长；插件不做静默截断。超出字节限制会在入队前拒绝。
- **KV Cache：**Steer 或 Follow-up 与普通用户消息一样改变后续模型上下文。

## 开发

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:coverage
pnpm build
pnpm verify:bundle
pnpm publint
pnpm pack
```

CI 会在 Node 22 与 24 上执行类型检查、Lint、单元测试、生产构建、Bundle 验证和打包，并在 Node 24 上运行真实 Chromium 回归测试。更多信息见[开发指南](docs/development.md)、[架构](docs/architecture.md)和[数据模型](docs/data-model.md)。

## 已知限制

- DSH 暂无助手 Markdown 内部 Slot。本插件以优先级 `-100` 覆盖 `assistant-step`、`user` 与 `steering` 渲染单元；上游渲染器变化需要重新兼容验证。
- 未发送草稿只存在当前浏览器，不会跨设备同步；已发送批次可从 Session 日志恢复。
- 模型确认属于协作协议。模型遗漏或破坏标记时，状态保持“已发送”，不会猜测为“已处理”。
- DSH 归档目前是展示状态，没有公开的取消归档操作；插件采用受支持的安全路径：复制到新任务。
- CSS Custom Highlight 取决于浏览器支持；不支持时仍可使用编号标记和时间线定位。
- 一次选区必须位于同一条助手回复内，跨消息选区会被拒绝。
- DSH 暂无私有命令注册标记，因此经过严格校验的内部传输命令可能出现在斜杠命令目录中。

## 社区

- [贡献指南](CONTRIBUTING.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [安全策略](SECURITY.md)
- [支持渠道](SUPPORT.md)
- [发布指南](RELEASING.md)
- [更新日志](CHANGELOG.md)

项目采用 [MIT License](LICENSE)。
