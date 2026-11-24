# 开发、测试与打包

[English](development.en.md) · [发布步骤](../RELEASING.md)

<a id="prerequisites"></a>
<a id="install-and-verify"></a>

## 从干净目录开始

需要 Node.js `^24.22.3 || >=26.13.1`、pnpm 11.28.5，以及运行 Chromium 的环境。公开版宿主和插件依赖由 `pnpm-lock.yaml` 锁定。master 基线使用 Zod 4.6.6，插件与接收凭据的校验也要保持相同版本。

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm verify
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:profile
pnpm test:profile:side-chat
pnpm test:coverage
```

`pnpm verify` 包含类型和格式检查、静态检查、单元测试、构建和安装包入口检查。公开包可能缺少部分调试源映射；以测试和覆盖率的退出结果判断是否通过。

<a id="side-chat-verification"></a>

## 验证侧栏

用 `pnpm test:profile:side-chat` 对官方宿主验证上下文隔离、正文起点、工作区列表、独立打开、归档恢复和发送途中重连。设置 `DSH_ANNOTATION_PACKAGED_DIR` 可验证本机 Linux 安装目录下的 Web，追加 `--desktop` 则运行同一安装目录中的 GUI。测试使用临时配置和离线模型。

<a id="historical-diff-verification"></a>
<a id="test-layout"></a>
<a id="web-smoke-test"></a>

## 不同测试能说明什么

- `tests/` 中的单元和组件测试覆盖选区、浮窗、存储、并发合并、旧格式、附件与重试。
- `pnpm test:browser` 用真实 Chromium 检查宽屏与窄屏的编辑框、气泡、附加按钮、记录排序和回收站确认框。
- `pnpm test:profile` 用真实加载器、官方输入框、文件与差异预览核对标准会话日志、测试模型输入及历史只读行为。图形应用、操作系统输入法和第三方模型需分别验证。
- 记录回放保留宿主会话 v3/v4 的既有样本及新侧栏示例。测试样本只使用虚构数据，机器目录使用占位符。

<a id="official-source-verification"></a>

## 对照官方源码

持续集成会检出 `source-baseline.json` 指定的官方提交，构建宿主、Cordis 和必要的原生包，再使用 `scripts/prepare-source-verification.mjs` 创建独立测试目录。该脚本拒绝错误提交、带修改的宿主源码、版本不符或缺包的输入。临时目录的包声明、覆盖地址和锁文件不能代替正式发行文件。具体参数与命令见[完整源码验证步骤](development.en.md#official-source-verification)。

<a id="record-performance"></a>

## 记录列表性能

`node scripts/profile-smoke.mjs --record-perf-only` 可测量同一环境中 50、500、2000 条合成记录的展开、取消附加和输入延迟。结果记录样本、运行环境和构建摘要；它不是跨机器的速度保证。

<a id="packaging"></a>

## 制作可安装的压缩包

在锁文件对应的验证目录完成以上检查后，用 `pnpm --config.ignoreScripts=true pack --pack-destination artifacts` 打包。此选项只用于避免重复执行已经完成的检查。若在临时源码验证目录打包，先还原发布仓库的 `package.json`，不发布本机依赖覆盖。

```bash
tar -tzf artifacts/dsh-annotation-1.3.3.tgz
tar -xOf artifacts/dsh-annotation-1.3.3.tgz package/package.json
```

安装包应含 `lib/index.js`、`lib/client.js`、`lib/invariant.js`、类型、配置补丁、中文文档、截图及许可。用隔离的 `DSH_HOME` 将它安装到 `web` 配置；`dsh plugin --profile web why dsh-annotation` 应显示 1.3.3。再通过公开版宿主实际加载并核对安装包内的客户端内容。

<a id="release-checklist"></a>

## 发布与复核

按[发布步骤](../RELEASING.md)上传两个内容相同的安装包和独立 HTML 原型，核对 GitHub 的公开下载，再提交中文市场介绍。
