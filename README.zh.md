# DSH 注解

[English](README.md) | 中文

在 DeepSeek Harness Web 的助手回复中选中原文，写下注解，并随下一条消息一起发送；也可以在官方文件预览和官方 turn-Diff 中批注。注解记录属于当前会话；已发送的注解可以重新附加，不会生成重复记录或气泡。

**适用宿主：DeepSeek Harness `0.2.0-rc.1`。** 插件通过官方输入框发送文字、图片、文件和注解，不修改宿主源码。

## 使用流程

### 1. 选中原文

在一条助手回复中选中文字，点击 **添加注解**。重叠选区也可以直接创建独立注解。数字气泡贴在选区末字附近，随正文滚动；平时不为原文添加常驻背景或下划线，悬浮或点击气泡时才高亮。

![在助手回复中选择原文并添加注解](docs/assets/annotation-selection.png)

### 2. 保存注解

输入条显示在选区下方。按 Enter 或点击对号保存，Shift+Enter 换行；主动保存的空白选区注解只标记原文。新建内容去除首尾空白后为空时，前两次点击外部会轻微抖动，第三次直接取消，不创建记录。在消息输入框开始输入也会取消空白新建。输入区从一行自动增高，最多显示七行，更多内容在内部滚动。点击数字气泡可用同样的界面查看或编辑。

![在选区旁输入注解](docs/assets/annotation-editor.png)

![通过数字气泡查看和编辑注解](docs/assets/annotation-bubble.png)

### 3. 查看记录并附加

新注解默认附加到下一条消息，不会自动展开记录框。输入框左上角显示附加数量；悬浮可预览原文和注解，点击可展开或折叠记录。模型选择按钮左侧的注解按钮也可控制记录框。记录中的回形针控制本次附加，地图定位图标跳转原文；空注解内容保持空白。

![注解记录和输入框中的附加提示](docs/assets/annotation-record.png)

### 4. 发送和再次发送

通过官方输入框发送后，用户消息正文上方显示注释数量。单条注释可悬浮预览、双击定位；多条注释可点击展开或折叠，并逐条定位原文。记录框在全部注解都已发送时自动隐藏。已发送注解仍可用回形针重新附加，注解 ID 与原文气泡保持不变。

![已发送消息上方的注释信息](docs/assets/annotation-sent.png)

![将已发送注解重新附加到输入框](docs/assets/annotation-reattach.png)

### 5. 设置

在 **设置 → 注解** 中启用或停用插件，分别控制文件预览批注和官方 turn-Diff 批注，并设置保存新注解后是否自动附加。关闭任一官方来源入口不会删除已有记录；关闭自动附加后，仍可在记录中手动点击回形针。设置页还会在 dsh-market 提供公开更新接口时显示插件更新操作。停用插件会移除界面和输入框附着，本地注解数据仍会保留。

![DSH 设置中的注解选项](docs/assets/annotation-settings.png)

### 6. 批注官方文件与本轮 Diff

打开官方文件预览后，可以批注整文件；文本、代码和 Markdown 预览还支持选区。HTML、图片、PDF、Office 和表格预览提供整文件操作。新记录保存文件地址、资源版本、字节数、坐标、引用上下文及已校验的片段摘要，不逐条复制整份文件。短暂加载或定位失败时，已存记录与草稿仍保留。

从本轮改动卡片打开官方 Diff 侧栏，可以选择 Diff 范围，也可以用 **批注此来源** 标注整文件。选区使用与助手正文相同的浮动编辑器和编号气泡。点击 **定位来源** 会打开官方 Diff 侧栏，等待内容就绪，并高亮同一注解 ID 对应的文字。会话中至少有两种来源时才显示类型筛选；旧 Git Diff 记录继续只读。

## 安装与兼容

本工作区适配 DSH `0.2.0-rc.1`。[已发布的 `1.0.0` 包](https://github.com/ruisenbai/dsh-annotation/releases/tag/v1.0.0)早于本次适配；安装到临时 Web profile 前，先构建并验证本工作区。

### 手动安装

```bash
dsh --version
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm run verify
pnpm --config.ignoreScripts=true pack --pack-destination artifacts
dsh plugin --profile annotation-dev add ./artifacts/dsh-annotation-1.0.0.tgz
dsh plugin --profile annotation-dev why dsh-annotation
```

第一条命令应输出 `0.2.0-rc.1`，最后一条应显示本地构建包的 `dsh-annotation@1.0.0`。安装后重启临时 profile 的 Web 宿主，在 **设置 → 注解** 中确认插件可用。构建步骤见[开发说明](docs/development.md#install-and-verify)；已执行的验证见[兼容性说明](docs/compatibility.md)。

### 交给 AI agent 安装

将下面的提示词交给能够操作本机终端的 AI agent：

```text
Build this dsh-annotation checkout for DeepSeek Harness Web 0.2.0-rc.1. Run dsh --version and stop if it differs. Run the plugin's frozen install, verify, and local pack commands, then install that local archive into a disposable annotation-dev profile. Confirm dsh plugin --profile annotation-dev why dsh-annotation shows dsh-annotation@1.0.0. Do not use the older published archive or change Host dependencies. Report the commands, version, installation result, and warnings.
```

新对话没有注解时，不显示记录框或空状态文案。插件仅提供注解相关功能，不隐藏思考、工具调用或其他会话内容。记录行显示意见和状态，来源类型、创建入口及已保存的上下文在详情中显示。存在至少两种来源时才显示 `全部/正文/Diff/文件` 筛选。历史 Git Diff 批注及快照仍然只读；新的官方 turn-Diff 批注仅从 Diff 侧栏创建，悬浮预览没有添加注解入口。已有悬浮来源记录仍可读取，定位会用原 annotationId 打开侧栏。文件与 Diff 的整文件批注必须填写意见，记录保留来源身份。文件预览支持文本、Markdown、代码、HTML、图片、PDF、Office、Excel、CSV 和 TSV 等官方渲染内容；非文本内容保存官方预览版本身份，不从磁盘推断文件内容。

未发送注解、暂存编辑和重试记录保存在当前浏览器。多标签页使用独立待归并记录和浏览器锁保护写入；遇到损坏或未来版本的存储时，保留原数据并提示，不以空状态覆盖。发送时固定本批注解和附件身份，失败重试沿用同一载荷；历史协议和已发送消息不会被迁移时改写。详见[数据模型](docs/data-model.md)与[隐私说明](docs/privacy.md)。

## 限制

- 未发送草稿不会跨浏览器同步；已发送记录可从会话历史恢复。
- 选区不能跨助手消息。Markdown、代码和表格内的定位依赖宿主当前正文 DOM。
- 没有 CSS Custom Highlight API 时，数字气泡和定位原文仍可使用。
- 模型返回有效的注解确认标记后，记录才会显示为已处理。

[贡献指南](CONTRIBUTING.md) · [更新记录](CHANGELOG.md) · [许可证](LICENSE)
