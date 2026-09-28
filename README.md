# DSH 注解

[English](README.en.md)

在 DeepSeek Harness Web 的助手回复中选中原文，写下注解，并随下一条消息一起发送。注解记录属于当前会话；已发送的注解可以重新附加，不会生成重复记录或气泡。

**适用宿主：DeepSeek Harness `0.1.7-rc.2`。** 插件通过官方输入框发送文字、图片、文件和注解，不修改宿主源码。

## 使用流程

### 1. 选中原文

在一条助手回复中选中文字，点击 **添加注解**。重叠选区也可以直接创建独立注解。数字气泡贴在选区末字附近，随正文滚动；平时不为原文添加常驻背景或下划线，悬浮或点击气泡时才高亮。

![在助手回复中选择原文并添加注解](docs/assets/annotation-selection.png)

### 2. 保存注解

输入条显示在选区下方。按 Enter 或点击对号保存，Shift+Enter 换行；内容可留空，只标记原文。输入区从一行自动增高，最多显示七行，更多内容在内部滚动。点击数字气泡可用同样的界面查看或编辑。

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

在 **设置 → 注解** 中启用或停用插件，并设置保存新注解后是否自动附加。关闭自动附加后，仍可在记录中手动点击回形针。设置页还会在 dsh-market 提供公开更新接口时显示插件更新操作。停用插件会移除界面和输入框附着，本地注解数据仍会保留。

![DSH 设置中的注解选项](docs/assets/annotation-settings.png)

## 安装与兼容

发行包只在 [GitHub Releases](https://github.com/ruisenbai/dsh-annotation/releases/tag/v1.0.0) 发布，不发布到 npm。以下命令将固定版本 `1.0.0` 安装到 DSH Web 的 `web` profile；目标宿主必须是 `0.1.7-rc.2`。

### 手动安装

```bash
dsh --version
dsh plugin --profile web add https://github.com/ruisenbai/dsh-annotation/releases/download/v1.0.0/dsh-annotation.tgz
dsh plugin --profile web why dsh-annotation
```

第一条命令应输出 `0.1.7-rc.2`，最后一条应显示 `dsh-annotation@1.0.0`。使用自定义 profile 时，将两处 `web` 换成实际名称。安装后重启该 profile 的 Web 宿主，在 **设置 → 注解** 中确认插件可用。构建与本地验证步骤见[开发说明](docs/development.md#install-and-verify)；精确依赖和已执行的验证见[兼容性说明](docs/compatibility.md)。

### 交给 AI agent 安装

将下面的提示词交给能够操作本机终端的 AI agent：

```text
请在本机为我的 DeepSeek Harness Web profile 安装 dsh-annotation 1.0.0。先确认目标 profile 名称；如果没有自定义名称，就使用 web。运行 dsh --version，只有结果严格等于 0.1.7-rc.2 才继续；版本不匹配时停止并报告，不修改宿主依赖。
使用 dsh plugin --profile <实际 profile 名称> add https://github.com/ruisenbai/dsh-annotation/releases/download/v1.0.0/dsh-annotation.tgz 安装，然后运行 dsh plugin --profile <实际 profile 名称> why dsh-annotation，确认显示 dsh-annotation@1.0.0。
不要修改 DSH 或插件源码，也不要清理会话和浏览器数据。如果 Web 宿主正在运行，提醒我重启该 profile。最后报告实际执行的命令、版本、安装结果和任何警告。
```

新对话没有注解时，不显示记录框或空状态文案。插件仅提供注解相关功能，不隐藏思考、工具调用或其他会话内容。代码 Diff 批注的新增与编辑功能已移除；旧 Diff 批注及快照仍可在历史消息中只读查看。

未发送注解、暂存编辑和重试记录保存在当前浏览器。多标签页使用独立待归并记录和浏览器锁保护写入；遇到损坏或未来版本的存储时，保留原数据并提示，不以空状态覆盖。发送时固定本批注解和附件身份，失败重试沿用同一载荷；历史协议和已发送消息不会被迁移时改写。详见[数据模型](docs/data-model.md)与[隐私说明](docs/privacy.md)。

## 限制

- 未发送草稿不会跨浏览器同步；已发送记录可从会话历史恢复。
- 选区不能跨助手消息。Markdown、代码和表格内的定位依赖宿主当前正文 DOM。
- 没有 CSS Custom Highlight API 时，数字气泡和定位原文仍可使用。
- 模型返回有效的注解确认标记后，记录才会显示为已处理。

[贡献指南](CONTRIBUTING.md) · [更新记录](CHANGELOG.md) · [许可证](LICENSE)
