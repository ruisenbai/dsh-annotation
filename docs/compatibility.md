# 兼容性与升级

[English](compatibility.en.md) · [安装与升级](../README.md#installation)

<a id="host-requirement"></a>
<a id="dependency-source"></a>

## 支持的宿主

1.2.0 的最低要求是 DeepSeek Harness `0.2.2-rc.1` 和 Node.js `24.9.0`。公开版依赖锁定在仓库的 `pnpm-lock.yaml`；[源码基线](../source-baseline.json)为官方提交 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`。同一版本号的定制桌面构建可能额外提供会话管理接口。

| 仍在使用的宿主                    | 对应插件版本  |
| --------------------------------- | ------------- |
| `0.2.2-rc.1`                      | 1.2.0         |
| `0.2.2-alpha.3`                   | 1.1.7         |
| `0.2.2-alpha.2`                   | 1.1.6         |
| `0.2.1-rc.2`                      | 1.1.5         |
| `0.2.1-alpha.2` / `0.2.1-alpha.1` | 1.1.2 / 1.1.1 |
| `0.2.0` 系列                      | 1.1.0         |

<a id="verification"></a>
<a id="side-chat-host-build"></a>

## 侧栏在不同宿主上有什么区别

主会话和侧栏的选区、新建与重开、只标记原文、记录汇总及随消息发送使用公开版接口。侧边标签上的归档和永久删除还依赖宿主提供标签操作、共享确认和删除状态查询；公开版 `0.2.2-rc.1` 不包含全部扩展。缺少删除查询时，插件不会把一个暂时从列表消失的侧栏聊天当作已永久删除。

独立 Web 配置测试使用真实插件加载器、浏览器、会话记录和可预测的测试模型。它可以核对内容确实送入目标会话，不能用来证明外部模型的回答质量，也不等于本次在每个操作系统都运行过桌面程序。

<a id="marketplace-placement"></a>
<a id="marketplace-update-api"></a>
<a id="main-settings-integration"></a>

## 安装来源和设置

dsh-market 在“会话与消息”分类收录本插件，使用 GitHub Release 的 `dsh-annotation.tgz` 固定下载名。市场界面语言决定采用中文还是英文一句话说明。通过“设置 → 注解”更新需要 dsh-market 的公开 v1 更新接口；市场不存在或过旧时仍可手动安装。

宿主保存启用状态、自动附加和两个官方来源开关。恢复旧版设置时，只导入该插件缺失的受支持布尔值；不覆盖已设置的值，不删除宿主保留的导入档案。

<a id="protocol-storage-and-command-compatibility"></a>
<a id="historical-diff-compatibility-and-persistence-acknowledgement"></a>
<a id="cross-conversation-annotation-persistence-acknowledgement"></a>

## 数据格式与降级

新提交使用注解协议 v6，本地注解写入 v7；`source.sessionId` 记录原文会话，接收会话单独标识。当前插件可读协议 v1–v5 和本地存储 v1–v6，旧版不能读取跨会话新记录。侧边聊天关联存储 v2、旧引用协议 v1 和宿主会话格式是不同的版本号。历史 Git 差异始终只读。

关闭仍运行旧插件的页面，同时更新客户端和宿主端插件，再刷新。升级前后无需清理浏览器。旧侧栏中未冻结的待发送引用，会在新注解保存成功后才移除；已冻结、发送结果未知和历史记录保留原样。详见[侧边注解迁移步骤](upgrade-guide/v1.1.8/side-annotations/guide.zh.md)。

<a id="high-risk-integration-points"></a>
<a id="upgrade-checklist"></a>

## 升级后这样核对

1. 用 `dsh --version` 和 `dsh plugin --profile web why dsh-annotation` 核对版本，桌面版把 `web` 换为 `desktop`。
2. 在主聊天选中文字，点“在侧边添加注解”，直接保存，再点原文的气泡。确认编辑器在原文旁，侧栏记录中仍有选中的原文。
3. 写一条带意见的注解，从侧栏发送。检查草稿、附加按钮、旧记录和文件或代码差异的定位；不要将结果未知的旧请求改作新的发送。
4. 如果刚更新桌面端，重启桌面应用；Web 端重启服务并刷新。缺少某个标签操作时，先对照上面的宿主能力说明。

<a id="browser-behavior"></a>
<a id="codex-ui"></a>
<a id="storage-and-source-markers"></a>
<a id="forward-compatibility-goal"></a>

## 浏览器与第三方界面

本次真实页面验证使用 Chromium。浏览器禁用站点存储时，草稿可能只在当前页面有效。Codex UI 的适配根据实际加载的界面注册启停；第三方插件与后续宿主版本仍需分别验证。请勿把此前版本的组合测试当作对任意新组合的保证。
